/**
 * Where money sent out went, worked out before anyone is asked.
 *
 * The owner, 12 October 2026, a Maya statement card "PHP 800.00 out, Sent
 * money via InstaPay QRPh, 11 Oct. Where did it go?": "it should know what
 * the source is". The ledger can often say: another of their accounts took
 * in the same amount within a day, so it went there. A QR Ph payment with
 * nothing of theirs taking it in paid for something, so it is a purchase and
 * the question is what it was for. Otherwise it is asked, saying that no
 * account of theirs shows it arriving.
 */

import { addDays, formatMedium } from "./dates";
import type { Draft } from "./entry";
import { formatMoney } from "./money";
import type { Transaction } from "./types";

const QR = /\bqr\s?ph\b|\bqr\b|\bscan(?:ned)? to pay\b|\bmerchant\b/i;

export interface Placed {
  readonly draft: Draft;
  readonly note: string;
}

export function placeSentMoney(draft: Draft, ledger: readonly Transaction[], accounts: readonly string[], others: readonly Draft[] = []): Placed | null {
  if (draft.flow !== "Transfer" || draft.toWallet.trim() || draft.sentOut || !draft.amount) return null;
  const from = draft.fromWallet.trim();
  const near = (d: string): boolean => d >= addDays(draft.date, -1) && d <= addDays(draft.date, 1);
  const ours = accounts.filter((a) => a !== from);
  /*
   * Only money that arrived with nowhere it came from: income, or a transfer
   * in with a blank source. A complete transfer between two accounts already
   * says where its money came from, and taking it as this one's landing
   * counted the same money in twice (12 October 2026 audit, A12).
   */
  const arrivedFromNowhere = (t: Transaction): boolean =>
    (t.type === "Revenue" || (t.type === "Transfer" && !t.fromWallet.trim())) && !t.debtId;
  const landed =
    ledger.find((t) => near(t.date) && t.amount === draft.amount && arrivedFromNowhere(t) && ours.includes(t.toWallet.trim())) ??
    null;
  const card = others.find((d) => d !== draft && near(d.date) && d.amount === draft.amount && (d.flow === "Revenue" || d.flow === "Transfer") && ours.includes(d.toWallet.trim()));
  const into = landed?.toWallet.trim() || card?.toWallet.trim() || "";
  if (into) {
    return {
      draft: { ...draft, toWallet: into },
      note: `Into ${into}: ${into} took in ${formatMoney(draft.amount)} ${landed ? `on ${formatMedium(landed.date)} (#${String(landed.recordNumber).padStart(4, "0")})` : "on another card here"}. Change it if that was other money.`,
    };
  }
  if (QR.test(`${draft.description} ${draft.notes}`)) {
    return {
      draft: { ...draft, flow: "Spending", category: "Spending", toWallet: "", item: "" },
      note: `A QR payment, and none of your accounts took in ${formatMoney(draft.amount)} around ${formatMedium(draft.date)}, so it paid for something. Say what it was for, or "sent to someone".`,
    };
  }
  return null;
}

/** Said with the question when nothing placed it. */
export function notArrivedWords(draft: Draft): string {
  return draft.amount ? `None of your accounts shows ${formatMoney(draft.amount)} arriving around ${formatMedium(draft.date)}, so it most likely went to someone else.` : "";
}
