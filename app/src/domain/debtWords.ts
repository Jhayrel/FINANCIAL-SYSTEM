/**
 * What each debt movement is called, in one place.
 *
 * The Add form, the chat's debt card, the Debt screen and the latest entries
 * each kept their own list of these words, and they had already drifted: the
 * form said "Pay it down" where the card said "Paid it down" and the history
 * said "Paid back". A new movement (`charge`) and a new kind of debt (money
 * passing through for someone else) would have had to be taught to four
 * lists. They are taught here once.
 *
 * The words depend on the debt as well as the movement. Paying back a credit
 * line is "Paid". Handing on money you held for your mother is "Released",
 * and it is the same movement in the ledger.
 *
 * ── On behalf ─────────────────────────────────────────────────────────────
 *
 * Money paid, sent or held for another person is not a loan to the owner,
 * who asked on 2026-09-17 for it to stand apart from Debt, in professional
 * words rather than everyday ones. It is still stored as a debt movement,
 * because until it is settled somebody is owed it, and that is what keeps it
 * out of income and spending. Only the words and the screens differ:
 *
 *   They owe you     Advance, Reimbursed, Write off
 *   You hold theirs  Held, Released, Retained
 */

import type { Debt, DebtEffect } from "./debt";

type Shape = Pick<Debt, "kind"> & { readonly form?: Debt["form"] };

const passing = (debt: Shape | undefined): boolean => debt?.form === "pass-through";

/** The fifth type of entry, beside Spending, Revenue, Transfer and Debt. */
export const ON_BEHALF = "On behalf";

/** Which side of an on-behalf balance: money they owe you, or money you hold of theirs. */
export type BehalfSide = "owed" | "held";

export const BEHALF_SIDE_LABEL: Record<BehalfSide, string> = {
  owed: "They owe you",
  held: "You hold theirs",
};

/** The movements offered on each side, in the order a balance goes through them. */
export const BEHALF_EFFECTS: Record<BehalfSide, readonly DebtEffect[]> = {
  owed: ["lend", "collect", "writeoff"],
  held: ["draw", "repay", "writeoff"],
};

/** The side a movement is on, when the movement alone says so. */
export function sideOfEffect(effect: DebtEffect | undefined): BehalfSide | undefined {
  if (effect === "lend" || effect === "collect") return "owed";
  if (effect === "draw" || effect === "repay") return "held";
  return undefined;
}

/** A choice's label, a word or two. */
export function effectLabel(effect: DebtEffect, debt?: Shape): string {
  if (passing(debt)) {
    if (debt?.kind === "receivable") {
      if (effect === "lend") return "Advance";
      if (effect === "collect") return "Reimbursed";
      if (effect === "writeoff") return "Write off";
    } else {
      if (effect === "draw") return "Held";
      if (effect === "repay") return "Released";
      if (effect === "writeoff") return "Retained";
    }
  }
  if (effect === "writeoff" && debt?.kind === "receivable") return "Given up";
  switch (effect) {
    case "draw":
      return "Borrowed";
    case "charge":
      return "Charge added";
    case "repay":
      return "Paid";
    case "interest":
      return "Interest only";
    case "fee":
      return "Fee";
    case "writeoff":
      return "Waived";
    case "lend":
      return "Lent";
    case "collect":
      return "Paid back";
  }
}

/** What a choice does, in a sentence, shown under the row of choices. */
export function effectMeaning(effect: DebtEffect, debt?: Shape): string {
  if (passing(debt)) {
    if (debt?.kind === "receivable") {
      if (effect === "lend") {
        return "Paid or sent on their behalf, such as a friend's meal they will pay back. It is not spending while they owe it. A transfer fee you pay yourself is spending, so add it on its own.";
      }
      if (effect === "collect") return "They paid you back. It is not income: it was your money all along.";
      if (effect === "writeoff") {
        return "They will not pay it back. What they owe you is cleared, and the amount counts as spending today under the item you pick.";
      }
    } else {
      if (effect === "draw") {
        return "Money that reached your account for someone else, such as a client's payment or money you keep for a relative. It is not income while you hold it.";
      }
      if (effect === "repay") return "You passed their money on. It is not spending: it was never yours.";
      if (effect === "writeoff") {
        return "They let you keep it. What you hold for them is cleared, and the amount counts as income today under the kind you pick.";
      }
    }
  }
  switch (effect) {
    case "draw":
      return "Money you took from it. What you owe goes up by this much. If the lender added fees when you took it, put them in Fees added.";
    case "charge":
      return "A fee, tax, interest or penalty the lender added to what you owe. No money moves now: it counts as spending today, and your next payment clears it.";
    case "repay":
      return "A payment. It lowers what you owe. Only if the bill says part of it was interest that was never added as a charge, put that part in Interest included.";
    case "interest":
      return "Interest or a fee paid out of a wallet on its own. It counts as spending and what you owe stays the same.";
    case "fee":
      return "A fee paid out of a wallet on its own. It counts as spending and what you owe stays the same.";
    case "writeoff":
      return debt?.kind === "receivable"
        ? "Money you have stopped expecting back, with no money moving. What they owe you goes down by this much."
        : "The lender cancelled part of what you owe and no money moved. What you owe goes down by this much.";
    case "lend":
      return "Money you gave them. What they owe you goes up by this much.";
    case "collect":
      return "Money they paid you. What they owe you goes down by this much.";
  }
}

/** The same, lower case, after a name: "Maya Credit, paid". */
export function effectInline(effect: DebtEffect, debt?: Shape): string {
  return effectLabel(effect, debt).toLowerCase();
}

/** What the part saved beside a movement is called: the interest in a payment, the fees on a borrowing. */
export function partWords(effect: DebtEffect | undefined): string {
  return effect === "draw" ? "fees added" : "interest";
}
