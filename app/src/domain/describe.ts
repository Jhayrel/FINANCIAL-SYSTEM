/**
 * Proposing the description on the Add screen.
 *
 * ── Where this differs from the VBA, deliberately ─────────────────────────
 *
 * Module8 sent the model a block of the owner's own past descriptions as style
 * examples, plus a locally built baseline drawn from them. It got good results
 * that way. It also meant the most sensitive free text in the ledger left the
 * device on almost every entry: descriptions are where a person writes "paid
 * Tita back for the hospital bill".
 *
 * That contradicts the boundary in `aiContext.ts`, which excludes free text on
 * purpose. Rather than quietly relax the rule for this one screen, the work is
 * split by where each half is actually better:
 *
 *   HISTORY, on device   When this item has been entered before, the previous
 *                        description is reused. No network, instant, and it
 *                        matches the owner's own wording exactly, which is
 *                        better than anything a model would invent.
 *
 *   MODEL, structured    Only when there is no history to draw on. That is
 *                        precisely the case where there is no past free text
 *                        to leak, so the model gets the fields alone: flow,
 *                        wallets, category, item, amount. Never a description.
 *
 * So the model fills the gap the local generator cannot, and the case where
 * the local generator is strong is the case that never leaves the device.
 */

import { suggest } from "./autofill";
import type { Draft } from "./entry";
import { formatMoney } from "./money";
import type { Transaction } from "./types";

export type DescribePlan =
  /** History had an answer. Use it as is; ask nothing. */
  | { readonly kind: "history"; readonly text: string }
  /** Nothing to go on. These fields, and only these, may be sent. */
  | { readonly kind: "model"; readonly fields: string }
  /** Too little filled in to describe anything yet. */
  | { readonly kind: "not-yet" };

export function describePlan(
  draft: Draft,
  transactions: readonly Transaction[],
): DescribePlan {
  // An item is the minimum: "Spending from Maya" is not a description.
  if (!draft.flow || !draft.item.trim()) return { kind: "not-yet" };

  const fromHistory = suggest({ ...draft, description: "" }, transactions).description;
  if (fromHistory && fromHistory.trim()) {
    return { kind: "history", text: fromHistory.trim() };
  }

  return { kind: "model", fields: describeFields(draft) };
}

/**
 * The only thing that may be sent for a description.
 *
 * Every value here is one the owner picked from a list the app controls, or a
 * number. Nothing typed as prose appears, which is what makes this safe to
 * send when the history path cannot answer.
 */
export function describeFields(draft: Draft): string {
  const lines = [`Flow: ${draft.flow}`];

  if (draft.category) lines.push(`Category: ${draft.category}`);
  if (draft.item.trim()) lines.push(`Item: ${draft.item.trim()}`);
  if (draft.fromWallet) lines.push(`From: ${draft.fromWallet}`);
  if (draft.toWallet) lines.push(`To: ${draft.toWallet}`);
  if (draft.amount !== null && draft.amount > 0) {
    lines.push(`Amount: PHP ${formatMoney(draft.amount, { symbol: false })}`);
  }
  if (draft.date) lines.push(`Date: ${draft.date}`);

  return lines.join("\n");
}

/**
 * Trim a proposal down to something that belongs in the box.
 *
 * Ported from `CleanAISuggestion`, which existed because models answer a
 * request for five words with a sentence explaining the five words. The
 * preamble list is the VBA's, which was clearly built from watching it happen.
 *
 * Markdown is not handled here: `aiText.plainText` has already run by the time
 * a proposal reaches this.
 */
const PREAMBLE =
  /^\s*(?:here(?:'s| is)|suggested|suggestion|description|sample|example|content)\b[^:]*:\s*/i;

const MAX_WORDS = 7;

export function cleanDescription(raw: string): string {
  let s = raw.trim();
  if (!s) return "";

  /**
   * Order matters here, and getting it wrong is easy.
   *
   * The preamble comes off first, because the quotes a model adds sit inside
   * it: `Here is a description: "Lunch at Jollibee."`. Stripping quotes first
   * finds none at the ends, and the opening quote then survives into the
   * field. Trailing punctuation goes before the final unquote for the same
   * reason, since the full stop is inside the closing quote.
   */
  s = s.replace(PREAMBLE, "");

  // One line. A description that wraps is a description that is too long.
  s = (s.split("\n").find((line) => line.trim()) ?? "").trim();

  s = unquote(s);
  // A trailing full stop reads wrong in a table cell.
  s = s.replace(/[.\s]+$/, "");
  s = unquote(s);

  const words = s.split(/\s+/).filter(Boolean);
  return words.slice(0, MAX_WORDS).join(" ");
}

const unquote = (s: string): string =>
  s.replace(/^["'“‘]+/, "").replace(/["'”’]+$/, "").trim();
