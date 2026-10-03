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
import { conversationBlock } from "../domain/memory";
import { dayInFileName, dropRepeats, piecesOf, readingFor, rowsIn } from "../domain/ocrText";
import { readReceipt, receiptNote, type ReceiptCheck } from "../domain/receipt";
import { interestNote, readInterestCredit, type InterestCredit } from "../domain/interestCredit";
import { cashWallet, readWithdrawal, withdrawalNote, type Withdrawal } from "../domain/withdrawal";
import { cardSlipNote, readCardSlip, type CardSlip } from "../domain/cardSlip";
import { acceptableWording, onlyTheirFigures, type SpendNote } from "../domain/spendNote";
import { readPicture } from "./ocr";
import { pairBorrowings, readProposals, type Proposal, type ReadBalance, type Refused } from "../domain/proposal";
import type { Attachment } from "./attachments";
import type { IsoDate } from "../domain/types";
import { stopOf } from "../domain/bills";

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
  /** What was said in earlier sessions, dated lines (`domain/memory.ts`). */
  readonly earlier?: string;
  /** Called off by the owner: Stop, or Clear this view. */
  readonly signal?: AbortSignal;
  /** What the model must not forget, sent whole above the conversation (`domain/memory.ts`, `keepInMind`). */
  readonly pinned?: string;
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
  if (options.signal?.aborted) controller.abort();
  options.signal?.addEventListener("abort", () => controller.abort(), { once: true });

  /*
   * The conversation in its own field, apart from the figures.
   *
   * Appended to the figures, it sat below the entries, and a model that
   * refused the size had the figures cut from the end: the conversation went
   * first, and the assistant lost what it had said a message ago ("I am
   * asking about the first you said", 28 September 2026). The server keeps
   * it whole beside the figures, newest lines first when it must shorten it.
   */
  const conversation = conversationBlock(options.earlier ? redact(options.earlier) : "", options.history ?? [], 30_000, options.pinned ? redact(options.pinned) : "");

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
        context: options.contextText ?? contextToText(context),
        ...(conversation ? { conversation } : {}),
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
    if (options.signal?.aborted) return fallback("Stopped before the answer came.");
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
  readonly readPicture?: (dataUrl: string, key?: string) => Promise<{ readonly plain: string; readonly raised: string } | null>;
  /**
   * Whether a model that sees well is set up (`seesPictures`). When it is,
   * each picture is looked at by it, with the device's reading beside it as
   * a check (`lookFirst`). Given by tests; the browser asks the endpoint.
   */
  readonly seesPictures?: () => Promise<boolean>;
  /** Set here, not by callers: only Gemini looks, and a refusal is not tried again, since the device's reading is there to fall back on (`lookFirst`). */
  readonly seeWell?: boolean;
  /** Set here, not by callers: what the device read, for checking the model's amounts against. */
  readonly readings?: readonly string[];
  /** Set here, not by callers: receipts in the pictures, checked by their arithmetic, for checking the model's cards against. */
  readonly receipts?: readonly ReceiptCheck[];
  /** Set here, not by callers: interest credits in the pictures, checked by their arithmetic (`domain/interestCredit.ts`). */
  readonly interest?: readonly InterestCredit[];
  /** Set here, not by callers: ATM withdrawal slips in the pictures, checked by their own figures (`domain/withdrawal.ts`). */
  readonly withdrawals?: readonly Withdrawal[];
  /** Set here, not by callers: card terminal slips in the pictures (`domain/cardSlip.ts`). */
  readonly cardSlips?: readonly CardSlip[];
  /** Set here, not by callers: the day each reading's picture was taken, from its file name. */
  readonly readingDays?: readonly string[];
  /** The owner's own name as a bank prints it: money from or to it is between their own accounts. */
  readonly ownNames?: readonly string[];
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
  /** Why the model that sees well did not read a picture, when it was asked and could not: for the record. */
  readonly sightMissed?: string;
  /** Rows a stitched screenshot showed twice, read once (`dropRepeats`). */
  readonly repeated?: number;
  /** What the device read off the pictures, for the checks after the model (`statementSense`). */
  readonly readings?: readonly string[];
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
  const aged = (name: string): string => {
    // A bill or subscription they stopped paying says so, like an old one.
    const stop = stopOf(name, reference.stopped);
    return stop ? `${name} (stopped ${stop.since})` : itemForReader(name, options.lastUsed, asOf);
  };
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
    // Their own name on a statement is them: "Received money from" it is a transfer from another of their accounts. Only with a statement attached, which carries the name anyway.
    ...((options.ownNames ?? []).length > 0 && attachments.length > 0 ? [`Their own name, as a bank prints it: ${(options.ownNames ?? []).join(", ")}. Money from or to this name is between their own accounts: flow Transfer, never Revenue or Spending.`] : []),
    // Who a payment can be for, and which side: Father's plan paid for him is OnBehalf, not a bill.
    ...((reference.onBehalf ?? []).length > 0
      ? [
          `People they pay for or hold money for (flow OnBehalf, never their own spending or income): ${(reference.onBehalf ?? [])
            .map((p) => `${p.name} (${p.side === "owed" ? "they pay for them and are paid back" : "they hold this person's money"})`)
            .join(", ")}`,
        ]
      : []),
    "",
    "The only items allowed, and which category each one belongs to:",
    `Category "Spending": ${spendingTypes.join(", ") || "none"}`,
    `Category "Bills": ${reference.bills.map(aged).join(", ") || "none"}`,
    `Category "Subscriptions": ${reference.subscriptions.map(aged).join(", ") || "none"}`,
    `Category "Revenue" (income only): ${reference.revenueCategories.map(aged).join(", ") || "none"}`,
    "An item marked old has not been used for over a year, and one marked stopped is a bill or subscription they stopped paying. Choose either only when what they said names it; a word in common is not enough.",
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
  // Whether a model that sees well is set up, asked while the device reads, so the answer is there with the reading.
  const sight = options.seesPictures ?? (typeof document === "undefined" ? undefined : () => seesPictures());
  const sees = sight ? sight().catch(() => false) : Promise.resolve(false);
  // Under its fingerprint, so a reading of the full-size original made at attach time is found (data/ocr.ts).
  const raw = await Promise.all(pictures.map((p) => reader(p.dataUrl as string, p.digest).catch(() => null)));
  // A scroll capture repeats the rows where two screens overlap: each is read once.
  let repeated = 0;
  const readings = raw.map((r) => {
    if (!r) return null;
    const plain = dropRepeats(r.plain);
    const raised = dropRepeats(r.raised);
    repeated += Math.max(plain.dropped, raised.dropped);
    return { plain: plain.text, raised: raised.text };
  });
  // A bank's interest screen: earned, tax and net, and which one arrived (domain/interestCredit.ts).
  const credits = readings.map((r) => (r ? readInterestCredit([r.raised, r.plain]) : null));
  const interest = credits.filter((c): c is InterestCredit => c !== null);
  // An ATM slip: the cash, the fee, and the balance after it (domain/withdrawal.ts).
  const slips = readings.map((r, i) => (r && !credits[i] ? readWithdrawal([r.raised, r.plain]) : null));
  const withdrawals = slips.filter((w): w is Withdrawal => w !== null);
  // A card terminal's slip: one card payment at one merchant (domain/cardSlip.ts).
  const cardReads = readings.map((r, i) => (r && !credits[i] && !slips[i] ? readCardSlip([r.raised, r.plain]) : null));
  const cardSlips = cardReads.filter((c): c is CardSlip => c !== null);
  // Never a shop receipt as well: its "total" there is the interest before tax, or the cash and the fee.
  const receipts = readings.map((r, i) => (r && !credits[i] && !slips[i] ? readReceipt([r.plain, r.raised], options.asOf) : null));
  const found = receipts.filter((r): r is ReceiptCheck => r !== null);
  const asText: Attachment[] = [];
  const stillPictures: Attachment[] = [];
  /** A long list's parts, each its own request (`piecesOf`). */
  const parts: Attachment[] = [];
  /** Each picture's own requests as text: its parts, or its reading, or none. */
  const ownJobs: Attachment[][][] = pictures.map(() => []);
  /** Each picture's reading, to go beside the picture as a check when a model looks at it. */
  const checks: (string | null)[] = pictures.map(() => null);
  /** A list too long for one answer, which is read in parts as text whatever can see. */
  const isLong: boolean[] = pictures.map(() => false);
  pictures.forEach((picture, i) => {
    const reading = readings[i];
    const long = reading ? longest(reading) : "";
    const pieces = long ? piecesOf(long, LIST_PART_ROWS) : [];
    if (pieces.length > 1) {
      isLong[i] = true;
      pieces.forEach((piece, k) => {
        const text = readingFor(picture.name, { plain: piece, raised: "" }, room);
        if (!text) return;
        const said = `${text}\nPart ${k + 1} of ${pieces.length} of this list. The other parts are read separately, so give only the rows in this part.`;
        const part: Attachment = { id: `${picture.id}-${k + 1}`, name: `${picture.name}, part ${k + 1} of ${pieces.length}, read on this device`, kind: "text", bytes: said.length, text: redact(said) };
        parts.push(part);
        ownJobs[i]?.push([part]);
      });
      return;
    }
    const asRead = reading ? readingFor(picture.name, reading, room) : null;
    // A shop receipt carries what its own arithmetic says the total is (domain/receipt.ts).
    const receipt = receipts[i];
    const credit = credits[i];
    const slip = slips[i];
    const text =
      asRead && credit
        ? `${asRead}\n${interestNote(credit)}`
        : asRead && slip
          ? `${asRead}\n${withdrawalNote(slip, cashWallet(options.reference.wallets))}`
          : asRead && cardReads[i]
            ? `${asRead}\n${cardSlipNote(cardReads[i]!)}`
          : asRead && receipt
            ? `${asRead}\n${receiptNote(receipt)}`
            : asRead;
    if (text) {
      const asRead: Attachment = { id: picture.id, name: `${picture.name}, read on this device`, kind: "text", bytes: text.length, text: redact(text) };
      asText.push(asRead);
      ownJobs[i]?.push([asRead]);
      checks[i] = text;
    } else {
      stillPictures.push(picture);
    }
  });

  const others = options.attachments.filter((a) => !(a.kind === "image" && a.dataUrl));
  const read = readings.flatMap((r) => (r ? [r.plain, r.raised] : []));
  // The day each picture was taken, for "Today" in a history list (domain/ocrText.ts, `rowDatesIn`).
  const readDays = readings.flatMap((r, i) => {
    const day = dayInFileName(pictures[i]?.name ?? "") ?? options.asOf;
    return r ? [day, day] : [];
  });
  const withChecks = (attachments: readonly Attachment[], seeWell = false): Promise<ExtractResult> =>
    extractOnce({ ...options, readings: read, readingDays: readDays, receipts: found, interest, withdrawals, cardSlips, attachments, ...(seeWell ? { seeWell } : {}) });

  if ((await sees) && !options.signal?.aborted) {
    return lookFirst({ pictures, others, checks, isLong, ownJobs, read, repeated, signal: options.signal, ask: withChecks });
  }

  if ((asText.length === 0 && parts.length === 0) || options.signal?.aborted) return extractOnce(options);
  const readOnDevice = pictures.length - stillPictures.length;

  /*
   * Each part of a long list, and each picture, is its own request, three at
   * a time, and the answers are put back in order. A picture is never read in
   * with another: sent together, the Maya Credit screen's fees were read onto
   * a Maya withdrawal three rows away (27 September 2026). What one picture
   * shows and another repeats is matched afterwards (pairBorrowings). Files
   * the owner attached go with the first request, so nothing is read twice.
   */
  const jobs: Attachment[][] = [...parts.map((part) => [part]), ...asText.map((text) => [text])];
  if (jobs[0]) jobs[0] = [...others, ...jobs[0]];
  if (stillPictures.length > 0) jobs.push(stillPictures);

  if (jobs.length > 1) {
    const answers = await inTurn(jobs, LIST_PARTS_AT_ONCE, (attachments) =>
      extractOnce({ ...options, readings: read, readingDays: readDays, receipts: found, interest, withdrawals, cardSlips, attachments }),
    );
    const joined = joinAnswers(answers);
    // Nothing usable in any of them: the pictures go to a model that can see, as below.
    if (usable(joined) >= 10 || options.signal?.aborted) return { ...joined, readOnDevice, repeated, readings: read };
    const seen = await extractOnce({ ...options, readings: read, readingDays: readDays, receipts: found, interest, withdrawals, cardSlips });
    return usable(seen) > usable(joined) ? { ...seen, readings: read } : { ...joined, readOnDevice, repeated, readings: read };
  }

  const first = await extractOnce({ ...options, readings: read, readingDays: readDays, receipts: found, interest, withdrawals, cardSlips, attachments: jobs[0] ?? [...others, ...stillPictures] });
  /*
   * Rows it could not use count for nothing here. On 26 September 2026 the
   * text route returned one refused row, "Nothing in that looked like a
   * transaction", which counted as an answer, and the pictures never went to
   * a model that could look at them.
   */
  if (usable(first) >= 10 || options.signal?.aborted) {
    return { ...first, readOnDevice, repeated, readings: read };
  }
  const second = await extractOnce({ ...options, readings: read, readingDays: readDays, receipts: found, interest, withdrawals, cardSlips });
  return usable(second) > usable(first) ? { ...second, readings: read } : { ...first, readOnDevice, repeated, readings: read };
}

/** Rows a list is cut into for reading, and how many parts are read at once. */
const LIST_PART_ROWS = 8;
const LIST_PARTS_AT_ONCE = 3;
/** Pictures looked at at once: two, since each is three models working on the server (`bestInOrder`). */
const PICTURES_AT_ONCE = 2;

/**
 * Each picture looked at by a model that sees, one picture to a request, with
 * the device's reading beside it as a check. A list too long for one answer,
 * and a picture no model could read, go the device's way as before.
 *
 * ── Why ───────────────────────────────────────────────────────────────────
 *
 * Every picture was read on the device and only its text went to a model,
 * because the free models that could see were slow and often blind (26
 * September 2026). The text carried the reader's misreadings, and the model,
 * which never saw the picture, filed them as read: on 30 September and 1
 * October a receipt's item names came back misspelt with a quantity as an
 * amount, and a Maya screen's names as strings of wrong letters. Gemini sees
 * well and quickly, so once it is set up the model reads the picture itself,
 * and the device's reading only settles a figure it cannot make out.
 */
async function lookFirst(job: {
  readonly pictures: readonly Attachment[];
  readonly others: readonly Attachment[];
  readonly checks: readonly (string | null)[];
  readonly isLong: readonly boolean[];
  readonly ownJobs: readonly (readonly (readonly Attachment[])[])[];
  readonly read: readonly string[];
  readonly repeated: number;
  readonly signal?: AbortSignal | undefined;
  readonly ask: (attachments: readonly Attachment[], seeWell?: boolean) => Promise<ExtractResult>;
}): Promise<ExtractResult> {
  const { pictures, others, checks, isLong, ownJobs, read, repeated, ask } = job;
  const looks = pictures.flatMap((picture, i) => (isLong[i] ? [] : [{ i, attachments: [picture, ...checkBeside(picture, checks[i] ?? null)] }]));
  const answers: ExtractResult[][] = pictures.map(() => []);
  // Files the owner attached go with the first request, so nothing is read twice.
  const withOthers = <T extends { readonly attachments: readonly Attachment[] }>(list: readonly T[]): T[] =>
    list.map((j, k) => (k === 0 && others.length > 0 ? { ...j, attachments: [...others, ...j.attachments] } : j));

  const looked = await inTurn(withOthers(looks), PICTURES_AT_ONCE, (l) => ask(l.attachments, true));
  looks.forEach((l, k) => {
    const seen = looked[k];
    if (seen) answers[l.i] = [named(seen, pictures[l.i]?.name ?? "")];
  });

  /*
   * A long list, and a picture Gemini could not read, go the device's way;
   * one the device could not read either goes to every model that can see,
   * as it did before. The owner's own files ride with the first of these
   * when the request they went with found nothing.
   */
  const instead = pictures.flatMap((picture, i) => {
    const seen = answers[i]?.[0];
    if (seen && usable(seen) >= 10) return [];
    const own = ownJobs[i] ?? [];
    return own.length > 0 ? own.map((attachments) => ({ i, attachments, device: true })) : [{ i, attachments: [picture] as readonly Attachment[], device: false }];
  });
  const carry = looks[0]?.i ?? instead[0]?.i;
  const carried = instead.findIndex((j) => j.i === carry);
  const insteadJobs = instead.map((j, k) => (k === carried && others.length > 0 ? { ...j, attachments: [...others, ...j.attachments] } : j));

  let readOnDevice = 0;
  if (instead.length > 0 && !job.signal?.aborted) {
    const got = await inTurn(insteadJobs, LIST_PARTS_AT_ONCE, (j) => ask(j.attachments));
    const byPicture = new Map<number, { readonly answers: ExtractResult[]; readonly device: boolean }>();
    instead.forEach((j, k) => {
      const answer = got[k];
      if (answer) byPicture.set(j.i, { answers: [...(byPicture.get(j.i)?.answers ?? []), answer], device: j.device });
    });
    for (const [i, theirs] of byPicture) {
      const seen = answers[i]?.[0];
      // Kept only when it found more than the model that looked.
      if (!seen || usable(joinAnswers(theirs.answers)) > usable(seen)) {
        answers[i] = theirs.device ? theirs.answers : theirs.answers.map((a) => named(a, pictures[i]?.name ?? ""));
        if (theirs.device) readOnDevice += 1;
      }
    }
  }
  const joined = joinAnswers(answers.flat());
  // 3 October 2026: a picture read the device's way after the deploy, and the record could not say why.
  const missed = looks.map((_, k) => looked[k]).find((a) => a !== undefined && a.source !== "model")?.reason;
  return { ...joined, repeated, readings: read, ...(readOnDevice > 0 ? { readOnDevice } : {}), ...(missed ? { sightMissed: missed.slice(0, 160) } : {}) };
}

/** The device's reading of a picture, sent beside it to check a figure against, never to read instead of it. */
function checkBeside(picture: Attachment, text: string | null): Attachment[] {
  if (!text) return [];
  const said = `For checking only. You can see the picture ${picture.name} itself; this is what this device's text reader made of it, misreadings and all. Read the picture, and use this only for a figure you cannot make out there.\n${text}`;
  return [{ id: `${picture.id}-check`, name: `${picture.name}, the device's reading, for checking only`, kind: "text", bytes: said.length, text: redact(said) }];
}

/** Each row names its picture, so "you missed one" knows which pictures gave cards (`AskPanel`). */
function named(answer: ExtractResult, name: string): ExtractResult {
  if (!name || answer.source !== "model") return answer;
  const mark = <T extends { readonly sourceRef: string }>(p: T): T => (p.sourceRef.includes(name) ? p : { ...p, sourceRef: p.sourceRef.trim() ? `${name}, ${p.sourceRef.trim()}` : name });
  return { ...answer, proposals: answer.proposals.map(mark) };
}

/**
 * Whether a model that reads pictures well, Gemini, is set up here.
 *
 * Asked at most once in ten minutes, and only which providers have keys, not
 * their catalogues. False when it cannot be known, which keeps the device's
 * way of reading, the one that works with any provider.
 */
let sightKnown: { readonly at: number; readonly sees: boolean } | null = null;
const SIGHT_MS = 10 * 60_000;

export async function seesPictures(options: { fetcher?: typeof fetch; token?: () => Promise<string | null> } = {}): Promise<boolean> {
  if (sightKnown && Date.now() - sightKnown.at < SIGHT_MS) return sightKnown.sees;
  const auth = await (options.token ?? idToken)();
  if (!auth) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6_000);
  try {
    const response = await (options.fetcher ?? fetch)(`${ENDPOINT}?configured`, { headers: { authorization: `Bearer ${auth}` }, signal: controller.signal });
    if (!response.ok || !(response.headers.get("content-type") ?? "").includes("application/json")) return false;
    const body = (await response.json()) as { configured?: { gemini?: unknown } };
    const sees = body.configured?.gemini === true;
    sightKnown = { at: Date.now(), sees };
    return sees;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** How much an answer holds that can be used: a found row counts, a refusal barely does. */
function usable(r: ExtractResult): number {
  return r.source !== "model" ? -1 : (r.proposals.length + (r.balances?.length ?? 0)) * 10 + r.refused.length;
}

/** The fuller of a picture's two readings, which is the one worth cutting into parts. */
function longest(reading: { readonly plain: string; readonly raised: string }): string {
  return rowsIn(reading.raised) >= rowsIn(reading.plain) ? reading.raised : reading.plain;
}

/** `work` over every job, at most `at` running at once, the answers in the jobs' order. */
async function inTurn<J, R>(jobs: readonly J[], at: number, work: (job: J) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(jobs.length);
  let next = 0;
  const lane = async (): Promise<void> => {
    while (next < jobs.length) {
      const k = next++;
      out[k] = await work(jobs[k] as J);
    }
  };
  await Promise.all(Array.from({ length: Math.min(at, jobs.length) }, lane));
  return out;
}

/**
 * The answers for a list's parts, as one answer.
 *
 * A part that found nothing says nothing: "Nothing in that looked like a
 * transaction" about a stretch of dates and headings is not news when the
 * rest of the list was read. A part that could not be read at all is said,
 * so a gap in the dates has a reason on screen.
 */
export function joinAnswers(answers: readonly ExtractResult[]): ExtractResult {
  const found = answers.filter((a) => a.source === "model");
  if (found.length === 0) return answers[0] ?? { proposals: [], refused: [], source: "offline", reason: "Nothing was read." };
  // One borrowing on the credit line's screen and in the wallet's list, read in separate parts, is one (pairBorrowings).
  const proposals = pairBorrowings(found.flatMap((a) => a.proposals));
  const balances = found.flatMap((a) => a.balances ?? []);
  const anything = proposals.length + balances.length > 0;
  const refused = [
    ...found.flatMap((a) => (anything && a.proposals.length + (a.balances?.length ?? 0) === 0 ? [] : a.refused)),
    ...answers.flatMap((a, k) =>
      a.source === "model"
        ? []
        : [{ sourceRef: `part ${k + 1}`, reason: `Part ${k + 1} of ${answers.length} of the list could not be read (${a.reason ?? "no answer"}). Send a screenshot of just those rows to add them.` }],
    ),
  ];
  const model = found.find((a) => a.model)?.model;
  return { proposals, refused, source: "model", ...(balances.length > 0 ? { balances } : {}), ...(model ? { model } : {}) };
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
        ...(options.seeWell && images.length > 0 ? { seeWell: true } : {}),
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
      if (attempt + 1 < TRIES && !options.seeWell && worthRetrying(response.status, message)) {
        await wait(PAUSE_MS[attempt + 1] ?? 2000);
        return extractOnce({ ...options, attempt: attempt + 1 });
      }
      return empty(message);
    }

    const read = readProposals(payload.data, options.reference, options.asOf, {
      note: options.note,
      readings: options.readings ?? [],
      readingDays: options.readingDays ?? [],
      receipts: options.receipts ?? [],
      interest: options.interest ?? [],
      withdrawals: options.withdrawals ?? [],
      cardSlips: options.cardSlips ?? [],
    });

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
    `What it was, in their words: ${redact(said)}`,
    "",
    "Their items, and what each one covers:",
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
  readonly gemini: readonly string[];
  readonly workers: readonly string[];
  /** The order the endpoint tries them in when nothing is chosen, `provider:model`. */
  readonly chain: readonly string[];
  readonly configured: { readonly groq: boolean; readonly openrouter: boolean; readonly gemini: boolean; readonly workers: boolean };
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
      gemini: ids(body.gemini),
      workers: ids(body.workers),
      chain: ids(body.chain),
      configured: {
        groq: Boolean(body.configured?.groq),
        openrouter: Boolean(body.configured?.openrouter),
        gemini: Boolean(body.configured?.gemini),
        workers: Boolean(body.configured?.workers),
      },
    };
  } catch {
    return null;
  }
}

/**
 * Figures the app worked out, in the model's words, or null for the device's.
 *
 * The model is given the facts and nothing else: no balances, no rows, no
 * history. What comes back is kept only when `accept` passes it (every
 * figure one of the facts', no preaching) and it comes back in time.
 */
async function wordFacts(
  task: "note" | "outlook",
  facts: readonly string[],
  deviceText: string,
  accept: (text: string) => boolean,
  options: {
    readonly provider?: string;
    readonly model?: string;
    readonly fetcher?: typeof fetch;
    readonly token?: () => Promise<string | null>;
    readonly timeoutMs?: number;
  },
): Promise<{ text: string; model: string } | null> {
  const auth = await (options.token ?? idToken)().catch(() => null);
  if (!auth) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 7_000);
  try {
    const response = await (options.fetcher ?? fetch)(ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${auth}` },
      body: JSON.stringify({
        task,
        tone: "brief",
        question: task === "note" ? "Word this note." : "Explain these figures.",
        context: ["The facts:", ...facts, "", "As the app would say it:", deviceText].join(String.fromCharCode(10)),
        ...(options.provider && options.model ? { provider: options.provider, model: options.model } : {}),
      }),
    });
    if (!response.ok || !(response.headers.get("content-type") ?? "").includes("application/json")) return null;
    const payload = (await response.json()) as OkPayload;
    const text = typeof payload.text === "string" ? plainText(payload.text).replace(/\s+/g, " ").trim() : "";
    return text && accept(text) ? { text, model: typeof payload.model === "string" ? payload.model : "" } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** A note after spending, in the model's words, or null for the device's (`spendNote.ts`). */
export async function phraseNote(
  note: SpendNote,
  options: { readonly provider?: string; readonly model?: string; readonly fetcher?: typeof fetch; readonly token?: () => Promise<string | null>; readonly timeoutMs?: number } = {},
): Promise<string | null> {
  const got = await wordFacts("note", note.facts, note.text, (t) => acceptableWording(t, note), options);
  return got?.text ?? null;
}

/** The months ahead explained by the model, or null for the device's words (`outlook.ts`). */
export async function explainOutlook(
  facts: readonly string[],
  deviceText: string,
  options: { readonly provider?: string; readonly model?: string; readonly fetcher?: typeof fetch; readonly token?: () => Promise<string | null>; readonly timeoutMs?: number } = {},
): Promise<{ text: string; model: string } | null> {
  return wordFacts("outlook", facts, deviceText, (t) => onlyTheirFigures(t, facts, 900), { timeoutMs: 20_000, ...options });
}
