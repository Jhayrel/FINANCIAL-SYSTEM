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
 * So every one of those collapses to the same outcome: `source: "offline"` with
 * text from `domain/aiOffline.ts` and a reason worth showing. The caller never
 * has to handle a null, and the feature never simply stops working.
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
import { offlineAnswer, type AiTask } from "../domain/aiOffline";
import { plainText } from "../domain/aiText";
import { idToken } from "./auth";

export type { AiTask };

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
  readonly tone: string;
  /** Overridable so tests do not touch the network. */
  readonly fetcher?: typeof fetch;
  readonly timeoutMs?: number;
  /** Overridable so tests do not need a Firebase session. */
  readonly token?: () => Promise<string | null>;
}

const ENDPOINT = "/api/ai";
const DEFAULT_TIMEOUT_MS = 25_000;

interface OkPayload {
  readonly text?: unknown;
  readonly model?: unknown;
  readonly error?: unknown;
}

export async function askAi(options: AskOptions): Promise<AiAnswer> {
  const { context, task, tone } = options;
  const doFetch = options.fetcher ?? fetch;

  const fallback = (reason: string): AiAnswer => ({
    text: offlineAnswer(context, task),
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
      body: JSON.stringify({ context: contextToText(context), task, tone }),
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
      const message = typeof payload.error === "string" ? payload.error : `Request failed (${response.status}).`;
      return fallback(message);
    }

    /**
     * Stripped here rather than trusted from the prompt. Models bold figures
     * and open with headings whatever they are told, and this app renders
     * text, not Markdown, so those marks would reach the screen literally.
     */
    const text = typeof payload.text === "string" ? plainText(payload.text) : "";
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
  reference: ReferenceLists,
  options: {
    readonly allowModel?: boolean;
    readonly fetcher?: typeof fetch;
    readonly token?: () => Promise<string | null>;
    readonly timeoutMs?: number;
  } = {},
): Promise<CategoryResult> {
  const nothing: CategoryResult = { category: "", confidence: "low", source: "none" };

  const plan = categoryPlan(draft, transactions, reference);
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