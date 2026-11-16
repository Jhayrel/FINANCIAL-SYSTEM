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
      if (effect === "lend") return "Paid for them";
      if (effect === "collect") return "Paid you back";
      if (effect === "writeoff") return "Let it go";
    } else {
      if (effect === "draw") return "Received for them";
      if (effect === "repay") return "Given to them";
      if (effect === "writeoff") return "Kept as yours";
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

/**
 * What a choice does, in a sentence, shown under the row of choices.
 *
 * `owedBefore` is what the line stood at before this entry, when known. Money
 * from someone who owed nothing is theirs, held ahead of their bill: "father
 * gave me 1000 for his bill" was told "They paid you back ... it was your
 * money all along" with nothing owed (3 November 2026 process test).
 */
export function effectMeaning(effect: DebtEffect, debt?: Shape, owedBefore?: number): string {
  if (passing(debt)) {
    if (debt?.kind === "receivable") {
      if (effect === "lend" && owedBefore !== undefined && owedBefore < 0) {
        return "Paid for them out of the money they left with you. It is not spending: it was theirs.";
      }
      if (effect === "lend") {
        return "Paid or sent on their behalf, such as a friend's meal they will pay back. It is not spending while they owe it. A transfer fee you pay yourself is spending, so add it on its own.";
      }
      if (effect === "collect" && owedBefore !== undefined && owedBefore <= 0) {
        return "They owe you nothing on this line, so this is their money, held for something of theirs such as their bill. It is not income: pay it from this and the line comes back to zero.";
      }
      if (effect === "collect") return "They paid you back. It is not income: it was your money all along.";
      if (effect === "writeoff") {
        return "They will not pay it back. What they owe you is cleared, and the amount counts as spending today: as Money Send, money given away, or under what it bought if you pick one.";
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

/**
 * The two days a lender's month turns on, named the way a bill reads.
 *
 * They were "Billing day" and "Due day", and the owner, 27 September 2026:
 * "whats the difference in due day and billing day? thats confusing". The
 * first is when the lender adds up what you owe into a bill; the second is
 * the last day to pay that bill. Every screen says them the same way.
 */
export const BILL_CLOSES = "Bill closes";
export const PAYMENT_DUE = "Payment due";

/** The two days, explained once, under wherever they are set. */
export const BILL_DAYS_EXPLAINED =
  "Bill closes: the day each month the lender adds up what you owe into a bill (its app may call it the billing, statement or cutoff date). " +
  "Payment due: the last day to pay that bill, either a day of the month or a number of days after the bill closes, as your lender's terms say. Anything borrowed after the bill closes goes on the next one. " +
  "If your lender gives you only one date, set Payment due.";

/**
 * The same day in both, said plainly, or "" when they differ.
 *
 * The owner, 28 September 2026, with Maya Credit set to the 6th for both:
 * "are you sure about this 2x". It is read one way: what is borrowed before
 * a bill closes on the 6th goes on that bill, and the bill is due that day,
 * the billing date (owner, 17 November 2026: "it will be paid in billing
 * date"). It was read as due on the 6th of the month after, which put a
 * payment Maya wanted on 21 December on 6 January. Whether the lender
 * gives longer only its statement can say, so the note says what the app
 * will do and where to check.
 */
export function sameDayNote(name: string, billingDay: number | undefined, dueDay: number | undefined, dueAfterDays?: number): string {
  if (billingDay && dueAfterDays) {
    // The day it lands on, when that is the same every month.
    const on = billingDay + dueAfterDays <= 28 ? `, on the ${ordinalDay(billingDay + dueAfterDays)}` : "";
    return `${name}: each bill closes on the ${ordinalDay(billingDay)} and is due ${dueAfterDays} ${dueAfterDays === 1 ? "day" : "days"} later${on}. What you borrow after a bill closes goes on the next one.`;
  }
  if (!billingDay || billingDay !== dueDay) return "";
  const day = ordinalDay(billingDay);
  return `${name}: both are the ${day}, so each bill is due the day it closes. What you borrow up to the ${day} is due on the ${day}. Check the due date on the lender's statement: if it is a number of days after the bill closes, pick that under Payment due (for example, "15 days after the bill closes"); if it is another day of the month, pick that day.`;
}

/** A day of the month as a bill says it: 1st, 2nd, 6th, 21st. */
export function ordinalDay(day: number): string {
  const tens = day % 100;
  if (tens >= 11 && tens <= 13) return `${day}th`;
  const last = day % 10;
  return `${day}${last === 1 ? "st" : last === 2 ? "nd" : last === 3 ? "rd" : "th"}`;
}

/** No day set, in a list of days. */
export const NO_BILL_DAY = "Not set";

/** The choices for either day: not set, then 1st to 31st. */
export const BILL_DAY_CHOICES: readonly string[] = [NO_BILL_DAY, ...Array.from({ length: 31 }, (_, i) => ordinalDay(i + 1))];

/** A choice back to its day, or undefined for not set. */
export function dayOfChoice(choice: string): number | undefined {
  const n = Number.parseInt(choice, 10);
  return Number.isInteger(n) && n >= 1 && n <= 31 ? n : undefined;
}

/** A day to its choice. */
export function choiceOfDay(day: number | undefined): string {
  return day !== undefined && day >= 1 && day <= 31 ? ordinalDay(day) : NO_BILL_DAY;
}

/** "15 days after the bill closes". */
export const afterDaysChoice = (n: number): string => `${n} ${n === 1 ? "day" : "days"} after the bill closes`;

/**
 * The choices for when a payment is due: not set, a day of the month, and,
 * where the bill has a closing day, a number of days after it (Maya Credit:
 * "15 days after your billing cutoff date"). Any lender's terms fit one.
 */
export function dueChoices(billingSet: boolean): readonly string[] {
  return billingSet ? [...BILL_DAY_CHOICES, ...Array.from({ length: 31 }, (_, i) => afterDaysChoice(i + 1))] : BILL_DAY_CHOICES;
}

/** A line's due rule as its choice. */
export function dueChoiceOf(debt: { readonly dueDay?: number | undefined; readonly dueAfterDays?: number | undefined; readonly billingDay?: number | undefined }): string {
  if (debt.billingDay && debt.dueAfterDays && debt.dueAfterDays >= 1 && debt.dueAfterDays <= 31) return afterDaysChoice(debt.dueAfterDays);
  return choiceOfDay(debt.dueDay);
}

/** A due choice back to the rule: a day of the month, days after the bill closes, or neither. */
export function dueOfChoice(choice: string): { readonly dueDay?: number; readonly dueAfterDays?: number } {
  const after = /^(\d{1,2}) days? after the bill closes$/.exec(choice);
  if (after) return { dueAfterDays: Number(after[1]) };
  const day = dayOfChoice(choice);
  return day === undefined ? {} : { dueDay: day };
}

/** "due the 6th", or "due 15 days after", for a line's summary. */
export function dueWords(debt: { readonly dueDay?: number | undefined; readonly dueAfterDays?: number | undefined; readonly billingDay?: number | undefined }): string {
  if (debt.billingDay && debt.dueAfterDays) return `due ${debt.dueAfterDays} ${debt.dueAfterDays === 1 ? "day" : "days"} after`;
  return debt.dueDay ? `due the ${ordinalDay(debt.dueDay)}` : "";
}
