/**
 * Talking to the AI endpoint.
 *
 * ── What the browser is allowed to send ───────────────────────────────────
 *
 * A context string built by `domain/aiContext.ts`, a task name from a fixed
 * list, and a tone. That is all. No rows, no descriptions, no free text the
 * owner typed, and no prompt: the prompt lives server-side precisely so it
 * cannot be rewritten from here.
 *
 * ── Why every failure ends up in the same place ───────────────────────────
 *
 * There are more ways for this to not answer than to answer: no key set, every
 * free model rate limited at once, a phone with no signal, or `vite dev`, which
 * has no Functions runtime and serves `index.html` for `/api/ai` with a 200 and
 * a content type of text/html. The last one is the nastiest, because it looks
 * like success until JSON parsing fails on a doctype.
 *
 * So every one of those collapses to the same outcome: `source: "offline"`,
 * the sentence in `MODEL_DOWN`, and a reason worth showing. The caller never
 * has to handle a null.
 *
 * ── Why a failure no longer writes a summary instead ──────────────────────
 *
 * It used to answer from `domain/aiOffline.ts` whenever the model could not,
 * so a failure still produced a paragraph about the month. The owner found
 * that confusing: a question came back answered with a different question's
 * answer, and nothing said the AI had failed. On 2026-09-15 they asked for a
 * plain sentence instead, and that is what every AI surface shows now, with
 * the reason underneath.
 */

import { contextToText, type AiContext } from "../domain/aiContext";
import { cleanDescription, describePlan } from "../domain/describe";
import {
  acceptCategory,
  categoryPlan,
  UNSURE,
  type CategoryAnswer,
} from "../domain/categorise";
import type { ReferenceLists } from "../domain/types";
import type { Draft } from "../domain/entry";
import type { Transaction } from "../domain/types";
import type { AiTask } from "../domain/aiOffline";
import { plainText } from "../domain/aiText";
import { idToken } from "./auth";
import { redact } from "../domain/aiRedact";
import { readingFor } from "../domain/ocrText";
import { readPicture } from "./ocr";
import { readProposals, type Proposal, type ReadBalance, type Refused } from "../domain/proposal";
import type { Attachment } from "./attachments";
import type { IsoDate } from "../domain/types";

export type { AiTask };

/** What every AI surface says when the model could not answer. The owner's words. */
export const MODEL_DOWN = "The AI model is not working. Please try again.";

export interface AiAnswer {
  readonly text: string;
  /** "model" when a provider answered, "offline" when this device wrote it. */
  readonly source: "model" | "offline";
  /** `provider:model` when one answered. */
  readonly model?: string;
  /** Why the model was not used. Present only when source is "offline". */
  readonly reason?: string;
  /**
   * When this answer was produced, if it came back from the cache.
   *
   * Shown to the reader, because a sentence about figures from last week
   * looks identical to one about this morning, and only the timestamp
   * separates them.
   */
  readonly at?: number;
}

export interface AskOptions {
  readonly context: AiContext;
  readonly task: AiTask;
  /**
   * The question, and enough of the conversation to follow a "what about
   * last month" without the endpoint keeping any of it.
   *
   * The server is deliberately stateless: nothing accumulates there and
   * there is no session to leak. So the thread travels with each request,
   * bounded to the last few turns, which is all a follow-up needs.
   */
  readonly question?: string;
  readonly history?: readonly { readonly role: "you" | "assistant"; readonly text: string }[];
  /**
   * A context built somewhere other than `contextToText`.
   *
   * The chat needs the ledger, not just the month's figures, and building
   * that needs the question, which `buildContext` never sees. So the caller
   * builds it (`domain/aiChatContext.ts`) and passes it in. Everything else
   * still gets the plain snapshot.
   */
  readonly contextText?: string;
  readonly tone: string;
  /**
   * The model picked in Settings. The endpoint tries it first when its
   * provider offers it, and answers from its own list otherwise.
   */
  readonly provider?: string;
  readonly model?: string;
  /** Overridable so tests do not touch the network. */
  readonly fetcher?: typeof fetch;
  readonly timeoutMs?: number;
  /** Overridable so tests do not need a Firebase session. */
  readonly token?: () => Promise<string | null>;
  /** Which pass this is. Set by the retry, never by a caller. */
  readonly attempt?: number;
}

const ENDPOINT = "/api/ai";
const DEFAULT_TIMEOUT_MS = 25_000;

/**
 * How long to wait for the routing answer.
 *
 * ── Why this is not the default ───────────────────────────────────────────
 *
 * Routing is asked about every message now, before any rule in the panel
 * looks at it, which is the order the owner asked for. That puts it on the
 * critical path for everything: a question waits for this call and then waits
 * again for the answer call behind it.
 *
 * What is being asked for here is a few hundred tokens in and one word back.
 * A provider that has not managed that in six seconds is degraded, and the
 * only thing a longer wait buys is a later arrival at the same fallback. So
 * the deadline is short and the fallback is unchanged: `routeMessage` returns
 * null, the local rules run exactly as they always have, and the owner gets a
 * slightly worse reading six seconds sooner instead of an identical one
 * twelve seconds later.
 *
 * This trades a little routing accuracy for latency, deliberately, and only
 * in the case where the model was already failing to answer.
 */
const ROUTE_TIMEOUT_MS = 6_000;

/**
 * How many times to try before giving up.
 *
 * "Every model in the chain failed" was reported after a single pass, and on
 * free models that is usually not true: they are rate limited per minute, so
 * the same request a few seconds later goes through. Three passes with a
 * growing pause turns most of those failures into an answer, and the ones it
 * cannot fix are reported with the provider's own reasons rather than as a
 * flat statement that everything is broken.
 */
const TRIES = 3;
const PAUSE_MS = [0, 1200, 3500];

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * True when trying again could plausibly work.
 *
 * A rate limit clears, a busy provider frees up, a chain that was exhausted a
 * moment ago is not exhausted a moment later. A refused request, a missing
 * key or a bad task will fail identically every time, and retrying those
 * wastes the owner's time to reach the same message.
 */
function worthRetrying(status: number, message: string): boolean {
  if (status === 429 || status === 502 || status === 503 || status === 504) return true;
  return /rate.?limit|timed out|temporarily|try again|overloaded|busy/i.test(message);
}

/** The provider's own reasons, so "it failed" says what failed. */
function reasonFrom(payload: { error?: unknown; attempts?: unknown }): string {
  const said = typeof payload.error === "string" ? payload.error : "The request failed.";
  const attempts = Array.isArray(payload.attempts) ? payload.attempts : [];

  const reasons = attempts
    .map((a) => (a && typeof a === "object" ? (a as { model?: string; reason?: string }) : null))
    .filter((a): a is { model?: string; reason?: string } => Boolean(a?.reason))
    .map((a) => `${a.model ?? "a model"} ${a.reason}`);

  return reasons.length > 0 ? `${said} Tried: ${reasons.slice(0, 4).join(", ")}.` : said;
}

/**
 * What the owner reads when nothing answered.
 *
 * Almost always "the AI model is not working", because almost always that is
 * what happened. A request refused for its size is different: nothing is
 * broken, the message was bigger than a free model takes in one go, and the
 * owner can fix it in a second by sending less. Saying "not working" there
 * sends them looking for a fault that is not there.
 *
 * The reason carries the endpoint's sentence and then the list of models it
 * tried. Only the sentence is worth putting in front of them.
 */
export function downSentence(reason: string | undefined): string {
  if (!reason) return MODEL_DOWN;
  const said = reason.split(" Tried:")[0] ?? reason;
  return /more than the models take|too (?:big|large)|bigger than/i.test(said) ? said : MODEL_DOWN;
}

interface OkPayload {
  readonly text?: unknown;
  readonly model?: unknown;
  readonly error?: unknown;
}

export async function askAi(options: AskOptions): Promise<AiAnswer> {
  const { context, task, tone } = options;
  const doFetch = options.fetcher ?? fetch;
  const attempt = options.attempt ?? 0;

  const fallback = (reason: string): AiAnswer => ({
    text: MODEL_DOWN,
    source: "offline",
    reason,
  });

  /**
   * The endpoint spends the owner's provider quota, so it will not answer
   * without proof of who is calling. No session means no model, which is the
   * normal state in local development and is not an error.
   */
  const auth = await (options.token ?? idToken)();
  if (!auth) {
    return fallback("Not signed in, so the figures were not sent anywhere.");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const response = await doFetch(ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${auth}`,
      },
      body: JSON.stringify({
        /*
         * The question travels in its own field.
         *
         * Appended to the end of the context it was the first thing cut when
         * a model refused the size, and the model then answered from the
         * summaries alone: "No question was asked", and four questions
         * answered with one paragraph, 20 September 2026.
         */
        ...(options.question ? { question: options.question } : {}),
        context: [
          options.contextText ?? contextToText(context),
          options.history?.length
            ? ["", "Earlier in this conversation:", ...options.history.map((h) => `${h.role}: ${h.text}`)].join(String.fromCharCode(10))
            : "",
        ]
          .filter(Boolean)
          .join(String.fromCharCode(10)),
        task,
        tone,
        ...(options.provider && options.model ? { provider: options.provider, model: options.model } : {}),
      }),
    });

    /**
     * The dev-server trap. `vite dev` answers /api/ai with the SPA shell, so
     * the status is 200 and the body is HTML. Checking the content type is
     * what separates "no endpoint here" from a real answer.
     */
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      return fallback(
        response.ok
          ? "No AI endpoint on this address. It exists only on the deployed site, not in local development."
          : `The endpoint returned ${response.status}.`,
      );
    }

    const payload = (await response.json()) as OkPayload;

    if (!response.ok) {
      const message = reasonFrom(payload);
      /**
       * Try again rather than declaring everything broken.
       *
       * Free models are rate limited per minute, so an exhausted chain is
       * usually exhausted for the next few seconds and not for the next few
       * minutes. `attempt` counts the passes; the caller sets it.
       */
      if (attempt + 1 < TRIES && worthRetrying(response.status, message)) {
        await wait(PAUSE_MS[attempt + 1] ?? 2000);
        return askAi({ ...options, attempt: attempt + 1 });
      }
      return { text: downSentence(message), source: "offline", reason: message };
    }

    /**
     * Stripped here rather than trusted from the prompt. Models bold figures
     * and open with headings whatever they are told, and this app renders
     * text, not Markdown, so those marks would reach the screen literally.
     */
    /**
     * Cleaned, with its structure kept for the renderer.
     *
     * The chat parsed emphasis and lists into real elements and every other
     * surface had them stripped, because those surfaces printed one string
     * into one element. They do not any more: every answer from here is shown
     * through `AiAnswerView` or the chat, and both render it with `Rich`. So a
     * summary on Insights, the alerts paragraph and the Settings try-out keep
     * their bold, their bullets and their numbers too (the owner, 26
     * September 2026: "in other parts of the system the bold text and bullet
     * points and numbering is not working"). No asterisk reaches the screen
     * either way: `Rich` parses the marks, it never prints them.
     */
    const text =
      typeof payload.text === "string"
        ? plainText(payload.text, { keepStructure: true })
        : "";
    if (!text) return fallback("The model returned nothing.");

    return {
      text,
      source: "model",
      ...(typeof payload.model === "string" ? { model: payload.model } : {}),
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return fallback(
      message.toLowerCase().includes("abort")
        ? "The model took too long to answer."
        : "Could not reach the AI endpoint. You may be offline.",
    );
  } finally {
    clearTimeout(timer);
  }
}

export interface DescribeResult {
  readonly text: string;
  /** Where the wording came from, so the UI can say. */
  readonly source: "history" | "model" | "none";
}

/**
 * Propose a description for a half-filled entry.
 *
 * Separate from `askAi` because it is a different shape of question: it sends
 * a draft rather than a snapshot of the month, and its answer goes into a
 * field rather than onto a panel. Sharing a function would have meant one that
 * does neither job well.
 *
 * `describePlan` decides whether anything is sent at all. When the item has
 * been entered before, the owner's own past wording wins and no request is
 * made: it is instant, private, and better than an invention.
 */
export async function describeDraft(
  draft: Draft,
  transactions: readonly Transaction[],
  options: {
    /**
     * False when AI is off, or when descriptions are off in Settings. The
     * history path still runs: it is local, and switching the model off is
     * not a request to stop reusing your own past wording.
     */
    readonly allowModel?: boolean;
    readonly tone?: string;
    readonly fetcher?: typeof fetch;
    readonly token?: () => Promise<string | null>;
    readonly timeoutMs?: number;
  } = {},
): Promise<DescribeResult> {
  const plan = describePlan(draft, transactions);
  if (plan.kind === "not-yet") return { text: "", source: "none" };
  if (plan.kind === "history") return { text: plan.text, source: "history" };
  if (options.allowModel === false) return { text: "", source: "none" };

  const doFetch = options.fetcher ?? fetch;
  const auth = await (options.token ?? idToken)();
  if (!auth) return { text: "", source: "none" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 12_000);

  try {
    const response = await doFetch(ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${auth}` },
      body: JSON.stringify({ context: plan.fields, task: "describe", tone: options.tone ?? "brief" }),
    });

    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok || !contentType.includes("application/json")) {
      return { text: "", source: "none" };
    }

    const payload = (await response.json()) as { text?: unknown };
    const raw = typeof payload.text === "string" ? payload.text : "";
    const text = cleanDescription(plainText(raw));

    return text ? { text, source: "model" } : { text: "", source: "none" };
  } catch {
    /**
     * A failed suggestion is not an error worth showing. The field is already
     * usable, the owner was going to type something anyway, and an error
     * toast for an optional convenience is worse than silence.
     */
    return { text: "", source: "none" };
  } finally {
    clearTimeout(timer);
  }
}


export interface CategoryResult {
  readonly category: string;
  readonly confidence: CategoryAnswer["confidence"];
  /** Where it came from, so the UI can say and the owner can judge. */
  readonly source: "history" | "model" | "none";
  /** How many past entries agreed, when history answered. */
  readonly seen?: number;
}

/**
 * Propose a category for a half-filled entry.
 *
 * `categoryPlan` decides whether anything is sent. When the item has been
 * filed the same way twice, the ledger answers and no request is made: that
 * is instant, private, and more likely to be right than a model reading a
 * list, because it is what the owner actually did.
 */
export async function suggestCategory(
  draft: Draft,
  transactions: readonly Transaction[],
  options: {
    readonly allowModel?: boolean;
    readonly fetcher?: typeof fetch;
    readonly token?: () => Promise<string | null>;
    readonly timeoutMs?: number;
  } = {},
): Promise<CategoryResult> {
  const nothing: CategoryResult = { category: "", confidence: "low", source: "none" };

  const plan = categoryPlan(draft, transactions);
  if (plan.kind === "not-yet") return nothing;
  if (plan.kind === "known") {
    return {
      category: plan.category,
      // The owner's own repeated filing is the strongest evidence there is.
      confidence: "high",
      source: "history",
      seen: plan.seen,
    };
  }

  if (options.allowModel === false) return nothing;

  const doFetch = options.fetcher ?? fetch;
  const auth = await (options.token ?? idToken)();
  if (!auth) return nothing;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 12_000);

  try {
    const response = await doFetch(ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${auth}` },
      body: JSON.stringify({
        context: [
          plan.request.fields,
          "",
          `Allowed categories: ${plan.request.allowed.join(", ")}`,
        ].join(String.fromCharCode(10)),
        task: "categorise",
        tone: "brief",
      }),
    });

    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok || !contentType.includes("application/json")) return nothing;

    const payload = (await response.json()) as { category?: unknown; confidence?: unknown };
    const answer = acceptCategory(
      typeof payload.category === "string" ? payload.category : "",
      typeof payload.confidence === "string" ? payload.confidence : "",
      plan.request.allowed,
    );

    // Unsure is not an answer worth showing; it is the absence of one.
    if (answer.category === UNSURE) return nothing;

    return { category: answer.category, confidence: answer.confidence, source: "model" };
  } catch {
    // A failed suggestion is not an error worth raising: the picker works.
    return nothing;
  } finally {
    clearTimeout(timer);
  }
}
// ── Reading a photo, a file, or a sentence into rows ────────────────────────

/**
 * Vision takes longer than a sentence, and the chain may try more than one
 * model before one answers. A cap sized for a summary would time out on a
 * receipt that was going to work.
 */
const EXTRACT_TIMEOUT_MS = 45_000;

/**
 * How much attached text can travel. The endpoint's own ceiling is 24 KB and
 * the reference lists and instructions need room inside it, so the files get
 * the rest rather than all of it.
 */
const MAX_ATTACHED_CHARS = 14_000;

export interface ExtractOptions {
  /** What the owner typed alongside the files. May be empty. */
  readonly note: string;
  readonly attachments: readonly Attachment[];
  readonly reference: ReferenceLists;
  readonly asOf: IsoDate;
  readonly fetcher?: typeof fetch;
  readonly timeoutMs?: number;
  readonly token?: () => Promise<string | null>;
  /** Which pass this is. Set by the retry, never by a caller. */
  readonly attempt?: number;
  /**
   * Called off by the Stop button.
   *
   * Separate from the timeout's own controller: both should be able to end
   * the request, and only one of them is a decision the owner made.
   */
  readonly signal?: AbortSignal;
  /** The last day each item was used, from `itemsLastUsed`, so an old item is marked as old. */
  readonly lastUsed?: ReadonlyMap<string, IsoDate>;
  /**
   * Reads a picture's text on this device (`data/ocr.ts`). Replaceable for
   * tests; left out where there is no page to draw on, and then every
   * picture goes to a vision model as before.
   */
  readonly readPicture?: (dataUrl: string) => Promise<{ readonly plain: string; readonly raised: string } | null>;
}

/** The last day each item appears in the ledger. */
export function itemsLastUsed(transactions: readonly Transaction[]): Map<string, IsoDate> {
  const last = new Map<string, IsoDate>();
  for (const t of transactions) {
    if (!t.item) continue;
    const seen = last.get(t.item);
    if (!seen || t.date > seen) last.set(t.item, t.date);
  }
  return last;
}

/**
 * An item's name for the reader, marked when it has not been used for a year.
 *
 * On 26 September 2026 "I paid 723.45 in online" came back as the
 * subscription "Other online payments", a line of the 2022 workbook's GCash
 * table that the migration brought into the lists. The word "online" matched
 * it, and nothing told the model it had not been used in four years while
 * Online Buy was used every week. An item never used yet is left unmarked:
 * that is one the owner has only just added.
 */
export function itemForReader(name: string, lastUsed: ReadonlyMap<string, IsoDate> | undefined, asOf: IsoDate): string {
  const seen = lastUsed?.get(name);
  if (!seen) return name;
  const yearAgo = `${Number(asOf.slice(0, 4)) - 1}${asOf.slice(4)}`;
  return seen < yearAgo ? `${name} (old, last used ${seen.slice(0, 4)})` : name;
}

export interface ExtractResult {
  readonly proposals: readonly Proposal[];
  /** Account balances shown in the pictures: what an account holds, not a movement. */
  readonly balances?: readonly ReadBalance[];
  /** Rows the model found but this app will not act on, with the reason. */
  readonly refused: readonly Refused[];
  readonly source: "model" | "offline";
  readonly model?: string;
  /** Why nothing came back. Present only when source is "offline". */
  readonly reason?: string;
  /** How many pictures were read on this device and sent as text. */
  readonly readOnDevice?: number;
}

/**
 * The allowed values, written out for the model.
 *
 * Sent every time rather than assumed, because the whole point is that it
 * copies from this list instead of inventing a wallet. Costs a few hundred
 * bytes and removes the most common way an extraction goes wrong.
 */
function extractContext(options: ExtractOptions): string {
  const { reference, asOf, note, attachments } = options;
  const nl = String.fromCharCode(10);

  /**
   * The lists, grouped and annotated, rather than one flat pile of names.
   *
   * A flat list gave the model no way to tell a spending type from a bill
   * from a subscription, so it picked the category by guessing and put Globe
   * at Home under Spending. Grouping them says which category each name
   * belongs to, and the owner's own note beside each spending type says what
   * counts as it, which is the thing worth reading before choosing.
   */
  const aged = (name: string): string => itemForReader(name, options.lastUsed, asOf);
  const spendingTypes = reference.spendingTypes.map((t) =>
    t.remark ? `${aged(t.name)} (${t.remark})` : aged(t.name),
  );

  const files = attachments
    .filter((a) => a.kind === "text" && a.text)
    .map((a) => [`File: ${a.name}`, a.text ?? ""].join(nl));

  const lines = [
    `Today is ${asOf}.`,
    `Their wallets: ${[...reference.wallets, ...reference.savings].join(", ") || "none set up yet"}`,
    `Their credit lines, loans and people they hold or send money for: ${(reference.credits ?? []).join(", ") || "none"}`,
    "",
    "The only items allowed, and which category each one belongs to:",
    `Category "Spending": ${spendingTypes.join(", ") || "none"}`,
    `Category "Bills": ${reference.bills.map(aged).join(", ") || "none"}`,
    `Category "Subscriptions": ${reference.subscriptions.map(aged).join(", ") || "none"}`,
    `Category "Revenue" (income only): ${reference.revenueCategories.map(aged).join(", ") || "none"}`,
    "An item marked old has not been used for over a year. Choose it only when what they said names it; a word in common is not enough.",
    "",
    // Redacted even though the endpoint never logs: a key pasted here would
    // otherwise reach the provider, which is a place this app cannot reach.
    note ? `What they said: ${redact(note)}` : "",
    ...files,
  ].filter(Boolean);

  return lines.join(nl).slice(0, MAX_ATTACHED_CHARS);
}

/**
 * Read attachments and a sentence into proposed rows.
 *
 * Returns proposals, never rows. Nothing here saves anything: the caller shows
 * each one, `checkDraft` decides whether it may be saved at all, and the owner
 * presses the button. See `domain/proposal.ts`.
 */
export async function extractProposals(options: ExtractOptions): Promise<ExtractResult> {
  const pictures = options.attachments.filter((a) => a.kind === "image" && a.dataUrl);
  const reader = options.readPicture ?? (typeof document === "undefined" ? undefined : readPicture);
  if ((options.attempt ?? 0) > 0 || !reader || pictures.length === 0) return extractOnce(options);

  /*
   * Read, then analyse, then check: the owner's order.
   *
   * Each picture is read here first. One that reads well goes on as its
   * text, to the fast text models; one that does not stays a picture, for a
   * model that can see. If the text finds nothing at all, the pictures go
   * to the vision models after all, so reading here can only ever add a
   * faster answer, never lose one.
   */
  const room = Math.floor(10_000 / pictures.length);
  const readings = await Promise.all(pictures.map((p) => reader(p.dataUrl as string).catch(() => null)));
  const asText: Attachment[] = [];
  const stillPictures: Attachment[] = [];
  pictures.forEach((picture, i) => {
    const reading = readings[i];
    const text = reading ? readingFor(picture.name, reading, room) : null;
    if (text) {
      asText.push({ id: picture.id, name: `${picture.name}, read on this device`, kind: "text", bytes: text.length, text: redact(text) });
    } else {
      stillPictures.push(picture);
    }
  });
  if (asText.length === 0 || options.signal?.aborted) return extractOnce(options);

  const others = options.attachments.filter((a) => !(a.kind === "image" && a.dataUrl));
  const first = await extractOnce({ ...options, attachments: [...others, ...asText, ...stillPictures] });
  const found = first.proposals.length + first.refused.length + (first.balances?.length ?? 0);
  if ((first.source === "model" && found > 0) || options.signal?.aborted) {
    return { ...first, readOnDevice: asText.length };
  }
  const second = await extractOnce(options);
  return second.source === "model" || first.source !== "model" ? second : first;
}

/** One request, with whatever pictures and text it is given. */
async function extractOnce(options: ExtractOptions): Promise<ExtractResult> {
  const doFetch = options.fetcher ?? fetch;
  const attempt = options.attempt ?? 0;
  const empty = (reason: string): ExtractResult => ({
    proposals: [],
    refused: [],
    source: "offline",
    reason,
  });

  const images = options.attachments
    .filter((a) => a.kind === "image" && a.dataUrl)
    .map((a) => a.dataUrl as string);

  const auth = await (options.token ?? idToken)();
  if (!auth) {
    return empty("Not signed in, so nothing was sent anywhere.");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? EXTRACT_TIMEOUT_MS);
  // Stopping is the owner's decision and ends the request the same way a
  // timeout does, so it hangs off the same controller.
  options.signal?.addEventListener("abort", () => controller.abort(), { once: true });

  try {
    const response = await doFetch(ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${auth}` },
      body: JSON.stringify({
        task: "extract",
        tone: "brief",
        context: extractContext(options),
        images,
      }),
    });

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      return empty(
        response.ok
          ? "No AI endpoint on this address. It exists only on the deployed site, not in local development."
          : `The endpoint returned ${response.status}.`,
      );
    }

    const payload = (await response.json()) as {
      data?: unknown;
      model?: unknown;
      error?: unknown;
      attempts?: unknown;
    };

    if (!response.ok) {
      const message = reasonFrom(payload);
      /**
       * Reading a picture is the request most worth retrying: it is the
       * slowest, the one with the fewest free models that can do it, and the
       * one where giving up means the owner types the whole receipt by hand.
       */
      if (attempt + 1 < TRIES && worthRetrying(response.status, message)) {
        await wait(PAUSE_MS[attempt + 1] ?? 2000);
        return extractOnce({ ...options, attempt: attempt + 1 });
      }
      return empty(message);
    }

    const read = readProposals(payload.data, options.reference, options.asOf);

    return {
      proposals: read.proposals,
      refused: read.refused,
      balances: read.balances,
      source: "model",
      ...(typeof payload.model === "string" ? { model: payload.model } : {}),
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);

    /**
     * Say which thing went wrong, because they need different answers.
     *
     * "You may be offline" was printed for every failure that was not a
     * timeout, including the case where the endpoint answered promptly and
     * said the model had been too slow. The owner saw it on a picture that
     * read perfectly well on the next try, so the message sent them looking
     * at their connection when nothing was wrong with it.
     */
    const lower = message.toLowerCase();
    if (lower.includes("abort")) {
      return empty("Reading that took too long. A smaller or clearer picture usually works.");
    }
    if (/failed to fetch|networkerror|load failed/.test(lower)) {
      return empty("Could not reach the AI endpoint. You may be offline.");
    }
    return empty(`The picture could not be read: ${message.slice(0, 120)}`);
  } finally {
    clearTimeout(timer);
  }
}

// ── What a thing is, when the ledger has never seen it ─────────────────────

/**
 * Ask the model which of the owner's spending types something belongs to.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * "I paid 300 Jollibee today" created a new spending type called Jolibee.
 * Nothing in the ledger mentioned it and neither did any of the owner's notes,
 * so every local rule correctly found nothing. This is the one job where a
 * model's general knowledge beats the ledger: it knows Jollibee is a
 * restaurant, and the owner's note on Food says "Meals, snacks, drinks".
 *
 * ── Why this is not a web search ──────────────────────────────────────────
 *
 * It does not need one. The question is "what kind of thing is this", which
 * is exactly what a language model already holds, and the answer is
 * constrained to a list of at most a few dozen names the owner wrote
 * themselves. A search API would add a key, a bill, and a second source of
 * wrong answers, to learn something the model already knows.
 *
 * ── What it cannot do ─────────────────────────────────────────────────────
 *
 * Return anything that is not on the list. The reply is checked against the
 * list here, so a model that invents a type gets ignored rather than obeyed.
 */
export async function classifyItem(
  text: string,
  allowed: readonly { readonly name: string; readonly remark: string }[],
  options: {
    readonly fetcher?: typeof fetch;
    readonly token?: () => Promise<string | null>;
    readonly timeoutMs?: number;
  } = {},
): Promise<{ readonly item: string; readonly confidence: string } | null> {
  const said = text.trim();
  if (!said || allowed.length === 0) return null;

  const auth = await (options.token ?? idToken)();
  if (!auth) return null;

  const nl = String.fromCharCode(10);
  const context = [
    `They bought: ${redact(said)}`,
    "",
    "Their spending types, and what each one covers:",
    ...allowed.map((a) => (a.remark ? `${a.name}: ${a.remark}` : a.name)),
  ].join(nl);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 12_000);

  try {
    const response = await (options.fetcher ?? fetch)(ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${auth}` },
      body: JSON.stringify({ task: "classify", tone: "brief", context }),
    });

    if (!response.ok || !(response.headers.get("content-type") ?? "").includes("application/json")) {
      return null;
    }

    const payload = (await response.json()) as { category?: unknown; confidence?: unknown };
    const answer = typeof payload.category === "string" ? payload.category.trim() : "";
    if (!answer) return null;

    // Checked against the list, so an invented type is ignored rather than saved.
    const match = allowed.find((a) => a.name.toLowerCase() === answer.toLowerCase());
    if (!match) return null;

    return {
      item: match.name,
      confidence: typeof payload.confidence === "string" ? payload.confidence : "low",
    };
  } catch {
    // A failed classification is not an error: the field stays as typed.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ── What a message wants ───────────────────────────────────────────────────

export type Intent =
  | "entry"
  | "question"
  | "chart"
  | "correction"
  | "answer"
  | "delete"
  | "restore"
  | "editEntry"
  | "investigate"
  /** Set or change a budget or a limit, over any months: a card to apply. */
  | "budget"
  /** A file: a spreadsheet, a backup or a statement. */
  | "export"
  | "chat";

export interface Routed {
  readonly intent: Intent;
  /** Which entry they meant, in their words, or "last". */
  readonly target: string;
  /** The window they named, in their words. */
  readonly period: string;
}

const INTENTS: readonly Intent[] = [
  "entry",
  "question",
  "chart",
  "correction",
  "answer",
  "delete",
  "restore",
  "editEntry",
  "investigate",
  "budget",
  "export",
  "chat",
];

/**
 * Ask the model what this message wants.
 *
 * ── Why this is not a regular expression ──────────────────────────────────
 *
 * It was, and every branch of it got things wrong. "Delete that last" found
 * nothing because "last" was stripped as a filler word. "how about this week"
 * was answered in prose because the pattern for a chart follow-up did not
 * know about weeks. "edit the last one" was answered with "I cannot change
 * anything here". None of those are patterns: they are sentences that mean
 * something only next to what came before them, which is exactly what a
 * language model is for and exactly what a regular expression is not.
 *
 * ── Why it is worth a round trip ──────────────────────────────────────────
 *
 * It is small: a few hundred tokens and a one-word answer. The alternative is
 * sending the message down the wrong branch entirely, which costs a wrong
 * answer, a wasted call, and the owner's trust.
 *
 * Returns null when there is no model or it could not answer. The caller then
 * falls back to the local rules, which are wrong sometimes rather than absent.
 */
export async function routeMessage(options: {
  readonly text: string;
  readonly history: readonly { readonly role: "you" | "assistant"; readonly text: string }[];
  readonly onScreen: {
    readonly openCard: boolean;
    readonly chart: boolean;
    readonly awaitingAnswer: string;
  };
  readonly fetcher?: typeof fetch;
  readonly token?: () => Promise<string | null>;
  readonly timeoutMs?: number;
}): Promise<Routed | null> {
  const said = options.text.trim();
  if (!said) return null;

  const auth = await (options.token ?? idToken)();
  if (!auth) return null;

  const nl = String.fromCharCode(10);
  const context = [
    "On their screen right now:",
    options.onScreen.awaitingAnswer
      ? `The assistant asked them for the ${options.onScreen.awaitingAnswer} and is waiting for the reply.`
      : "Nothing is waiting for a reply.",
    options.onScreen.openCard ? "An entry card is showing, not yet added." : "No entry card.",
    options.onScreen.chart ? "A chart is showing." : "No chart.",
    "",
    "Recently said:",
    ...options.history.slice(-6).map((h) => `${h.role}: ${redact(h.text).slice(0, 200)}`),
    "",
    `Their message: ${redact(said)}`,
  ].join(nl);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? ROUTE_TIMEOUT_MS);

  try {
    const response = await (options.fetcher ?? fetch)(ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${auth}` },
      body: JSON.stringify({ task: "route", tone: "brief", context }),
    });

    if (!response.ok || !(response.headers.get("content-type") ?? "").includes("application/json")) {
      return null;
    }

    const payload = (await response.json()) as { data?: unknown };
    const data = payload.data as { intent?: unknown; target?: unknown; period?: unknown } | undefined;
    const intent = typeof data?.intent === "string" ? data.intent : "";

    // Checked against the list, so an invented intent is ignored rather than
    // dispatched to a branch that does not exist.
    if (!INTENTS.includes(intent as Intent)) return null;

    return {
      intent: intent as Intent,
      target: typeof data?.target === "string" ? data.target.slice(0, 120) : "",
      period: typeof data?.period === "string" ? data.period.slice(0, 60) : "",
    };
  } catch {
    // A failed routing is not an error worth showing: the local rules answer.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** What the endpoint can answer with right now, for the model picker in Settings. */
export interface ModelsOnOffer {
  readonly groq: readonly string[];
  readonly openrouter: readonly string[];
  /** The order the endpoint tries them in when nothing is chosen, `provider:model`. */
  readonly chain: readonly string[];
  readonly configured: { readonly groq: boolean; readonly openrouter: boolean };
}

/**
 * Ask the endpoint which models the providers offer at this moment.
 *
 * The Settings box used to be free text, and whatever was typed there was
 * never sent, so it could name a model that did not exist and nothing would
 * say so. The list comes from the providers themselves, the same place the
 * endpoint builds its chain from. Null when there is no endpoint to ask
 * (local development) or no session.
 */
export async function modelsOnOffer(options: { fetcher?: typeof fetch; token?: () => Promise<string | null> } = {}): Promise<ModelsOnOffer | null> {
  const auth = await (options.token ?? idToken)();
  if (!auth) return null;
  try {
    const response = await (options.fetcher ?? fetch)(ENDPOINT, { headers: { authorization: `Bearer ${auth}` } });
    if (!response.ok || !(response.headers.get("content-type") ?? "").includes("application/json")) return null;
    const body = (await response.json()) as Partial<ModelsOnOffer>;
    const ids = (value: unknown): string[] =>
      Array.isArray(value) ? value.filter((id): id is string => typeof id === "string" && !id.startsWith("(")) : [];
    return {
      groq: ids(body.groq),
      openrouter: ids(body.openrouter),
      chain: ids(body.chain),
      configured: {
        groq: Boolean(body.configured?.groq),
        openrouter: Boolean(body.configured?.openrouter),
      },
    };
  } catch {
    return null;
  }
}
