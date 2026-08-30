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
import { offlineAnswer, type AiTask } from "../domain/aiOffline";
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

    const text = typeof payload.text === "string" ? payload.text.trim() : "";
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
