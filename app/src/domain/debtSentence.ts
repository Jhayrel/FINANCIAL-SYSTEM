/**
 * What a sentence about a debt says outright: the interest inside a payment,
 * and, when the words leave no doubt, whether it was a payment or borrowing.
 *
 * ── The question this answers ─────────────────────────────────────────────
 *
 * The owner asked how "I paid 1000 including its interest" could ever be
 * recorded right. The ₱1,000.00 is easy. How much of it was interest is not
 * in the ledger and cannot be worked out: every lender counts interest its
 * own way, so no rate is assumed anywhere. What a sentence can do is give the
 * figure ("120 of it interest"), or say there was interest without one, and
 * the card then asks for the figure off the bill.
 *
 * ── Including, or on top ──────────────────────────────────────────────────
 *
 *   "paid 1000 including 120 interest"     ₱1,000.00 paid, 120 of it interest
 *   "paid 1000, 120 of it was interest"    the same
 *   "interest is 120, paid 1000"           the same
 *   "paid 1000 plus 120 interest"          ₱1,120.00 paid, 120 of it interest
 *   "paid 880 principal and 120 interest"  ₱1,000.00 paid, 120 of it interest
 *
 * "with 120 interest" is read as including: the other figure is what was
 * paid. The card shows both figures and what each does before anything is
 * saved, so a sentence meant the other way is one number to change.
 *
 * ── Paid or borrowed ──────────────────────────────────────────────────────
 *
 * Which credit line and what the movement does are picked on the card,
 * because a sentence usually does not carry them and reading the effect
 * wrong turns borrowing into income. Some sentences carry it beyond doubt:
 * "I paid my Maya Credit" is a payment. "I paid with Maya Credit" is not, it
 * is buying on credit, so a payment verb counts only when the credit line is
 * not what was paid with, and that sentence is left for the owner to pick.
 * A sentence with both a payment and a borrowing in it is left alone too.
 */

import type { Debt } from "./debt";
import type { Draft } from "./entry";
import { formatMoney, type Centavos } from "./money";

export interface DebtSentence {
  /** The effect the words state beyond doubt, or undefined to leave it for the owner. */
  readonly effect?: "repay" | "draw" | "interest" | undefined;
  /** Everything paid. The sentence's own figure unless it built the payment out of parts. */
  readonly amount: Centavos | null;
  /** The interest inside the payment, as a figure the sentence gave. */
  readonly interest: Centavos | null;
  /** It says the payment included interest and gives no figure for it. */
  readonly interestUnstated: boolean;
}

const MONEY = String.raw`(?:₱|php\s*)?(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)(?:\s*(?:pesos?|php))?`;
const INTEREST = String.raw`(?:interest|interes|intrest|intereset|tubo)`;

/** "and 120 interest", "plus 120 in interest", "+ 120 interest": added to the other figure. */
const ON_TOP = new RegExp(
  String.raw`(?:\bplus|\band|\+)\s*${MONEY}\s*(?:in\s+|of\s+|for\s+)?${INTEREST}\b`,
  "i",
);

/** "120 interest", "120 of it interest", "120 of that was interest", "120 pesos in interest". */
const FIGURE_THEN_INTEREST = new RegExp(
  String.raw`${MONEY}\s*(?:of\s+(?:it|that|which|this)\s+)?(?:is\s+|was\s+|are\s+|were\s+|went\s+to\s+|for\s+|as\s+|in\s+)?(?:the\s+)?${INTEREST}\b`,
  "i",
);

/** "interest 120", "interest is 120", "interest of 120", "interest: 120". */
const INTEREST_THEN_FIGURE = new RegExp(
  String.raw`\b${INTEREST}\s*(?:is\s+|was\s+|of\s+|na\s+|ay\s+|:\s*|=\s*|-\s*)?${MONEY}`,
  "i",
);

/** "880 principal", the other part named. */
const PRINCIPAL = new RegExp(String.raw`${MONEY}\s*(?:is\s+|was\s+|for\s+|as\s+)?(?:the\s+)?(?:principal|capital)\b`, "i");

/** Interest said, with no figure beside it. */
const INTEREST_SAID = new RegExp(
  String.raw`\b(?:includ\w*|inclusive\s+of|with|plus|and|incl)\s+(?:the\s+|its\s+|it's\s+|my\s+|the\s+)?${INTEREST}\b`,
  "i",
);

/** A payment made to the debt. */
const PAY_VERB =
  /\b(?:paid|pay|payed|paying|repaid|repay|settled|settle|cleared|bayad|nagbayad|binayaran|magbayad|hulog|naghulog|inihulog)\b/i;

/** Paying with a credit line rather than paying it off: buying on credit. */
const PAID_WITH =
  /\b(?:with|using|via|thru|through|gamit|by)\s+(?:my\s+|the\s+|ang\s+)?(?:[a-z]+\s+){0,2}(?:credit|loan|spaylater|paylater)\b/i;

/** Money taken from a credit line or a lender. */
const BORROW_VERB =
  /\b(?:borrowed|borrow|borrowing|loaned|nangutang|umutang|inutang|took\s+(?:a\s+)?loan|drew\s+from)\b/i;

/** Paying the charge alone, with nothing against the balance. */
const INTEREST_ONLY = new RegExp(
  String.raw`\b(?:only\s+(?:the\s+)?${INTEREST}|${INTEREST}\s+only|just\s+(?:the\s+)?${INTEREST})\b`,
  "i",
);

/**
 * Read it.
 *
 * `amountOf` is the general reader's own figure finder, so this agrees with
 * it about dates, years and names with digits in them. It is asked twice:
 * of the whole sentence, and of the sentence with the interest phrase taken
 * out, which is how "interest is 120, paid 1000" finds the 1000.
 */
export function readDebtSentence(
  text: string,
  amountOf: (text: string) => Centavos | null,
  readFigure: (raw: string) => Centavos | null,
): DebtSentence {
  const onTop = ON_TOP.exec(text);
  const match = onTop ?? FIGURE_THEN_INTEREST.exec(text) ?? INTEREST_THEN_FIGURE.exec(text);
  const stated = match?.[1] ? readFigure(match[1]) : null;

  const without = match ? `${text.slice(0, match.index)} ${text.slice(match.index + match[0].length)}` : text;
  const principalMatch = PRINCIPAL.exec(without);
  const principal = principalMatch?.[1] ? readFigure(principalMatch[1]) : null;
  const rest = stated !== null ? amountOf(without) : amountOf(text);

  let amount: Centavos | null;
  if (stated === null) amount = rest;
  else if (principal !== null) amount = principal + stated;
  else if (onTop && rest !== null) amount = rest + stated;
  else amount = rest ?? stated;

  /** The interest figure is the only figure: the whole payment was interest. */
  const allInterest = stated !== null && rest === null;

  const paying = PAY_VERB.test(text) && !PAID_WITH.test(text);
  const borrowing = BORROW_VERB.test(text);

  let effect: DebtSentence["effect"];
  if ((INTEREST_ONLY.test(text) || allInterest) && !borrowing) effect = "interest";
  else if (paying && !borrowing) effect = "repay";
  else if (borrowing && !PAY_VERB.test(text)) effect = "draw";

  // All of it interest: one "Interest only" row, with no part of it to state.
  if (effect === "interest") {
    return { effect, amount, interest: null, interestUnstated: false };
  }

  const interest = stated !== null && amount !== null && stated <= amount && effect !== "draw" ? stated : null;
  return {
    effect,
    amount,
    interest,
    interestUnstated: interest === null && effect !== "draw" && INTEREST_SAID.test(text),
  };
}

/**
 * What the chat says above a debt card: what it read, and what is left.
 *
 * It used to say "pick which credit line and what it does" whatever the
 * sentence had said, so "I paid my Maya Credit 1000" was answered as if the
 * line and the payment had not been named. And "including its interest" was
 * passed over in silence, when it is the one figure the card cannot know.
 */
export function debtCardIntro(draft: Draft, interestUnstated: boolean, debts: readonly Debt[]): string {
  const line = debts.find((d) => d.id === draft.debtId)?.name;
  const what =
    draft.debtEffect === "repay"
      ? "a payment"
      : draft.debtEffect === "draw"
        ? "borrowing"
        : draft.debtEffect === "interest"
          ? "interest paid on its own"
          : "debt";
  const parts = [`That reads as ${what}${line ? ` on **${line}**` : ""}.`];
  const missing = [!line ? "which credit line" : "", !draft.debtEffect ? "what it does" : ""].filter(Boolean);
  if (missing.length > 0) {
    parts.push(
      `Pick ${missing.join(" and ")} on the card: ${missing.length === 2 ? "those are" : "that is"} not something to guess with borrowed money.`,
    );
  }
  if (draft.debtEffect === "repay" && (draft.interest ?? null) !== null) {
    parts.push(`**${formatMoney(draft.interest ?? 0)}** of it is interest, so only the rest lowers what you owe.`);
  } else if (interestUnstated) {
    parts.push(
      "You said it includes interest. Put how much in **Interest included**: it is on the bill or in the lender's app. No rate is assumed, since every lender counts it differently.",
    );
  }
  parts.push("Check the card, then add it.");
  return parts.join(" ");
}
