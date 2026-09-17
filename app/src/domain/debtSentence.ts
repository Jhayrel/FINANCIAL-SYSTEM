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
 * ── Charges the lender adds ───────────────────────────────────────────────
 *
 * Lenders charge in different ways and no single formula fits them, so none
 * is used. What a sentence or a statement line says is read as it is:
 *
 *   "borrowed 1050 on maya credit, service fee 78.64 and dst 0.65"
 *        a borrowing of ₱1,050.00 with ₱79.29 of fees added to what is owed
 *   "maya credit late fee 150"
 *        a charge of ₱150.00 added to what is owed, with no money moving
 *
 * Every fee figure in the sentence is added up, whatever it is called: a
 * service or processing fee, documentary stamp tax, a penalty, a finance
 * charge, or interest added when the money was taken.
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
  readonly effect?: "repay" | "draw" | "interest" | "charge" | undefined;
  /** A borrowing's fees, added on top of what was received. */
  readonly charges: Centavos | null;
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

/** A fee the lender adds, by any of the names lenders give them. */
const FEE_WORD = String.raw`(?:service\s+fees?|processing\s+fees?|convenience\s+fees?|late\s+(?:payment\s+)?(?:fees?|charges?)|finance\s+charges?|documentary\s+stamp\s+tax|stamp\s+tax|dst|penalty|penalties|fees?|charges?)`;

/** "service fee 78.64", "dst: 0.65", "penalty of 150". */
const FEE_THEN_FIGURE = new RegExp(String.raw`\b${FEE_WORD}\s*(?:is\s+|was\s+|of\s+|na\s+|:\s*|=\s*|-\s*)?${MONEY}`, "gi");

/** "78.64 service fee", "150 in penalties". */
const FIGURE_THEN_FEE = new RegExp(String.raw`${MONEY}\s*(?:in\s+|of\s+|as\s+|for\s+)?(?:the\s+)?${FEE_WORD}\b`, "gi");

/** Every fee figure in a sentence, added up, and the sentence without them. */
function feesIn(
  text: string,
  readFigure: (raw: string) => Centavos | null,
): { readonly total: Centavos | null; readonly without: string } {
  const taken: { start: number; end: number; value: Centavos }[] = [];
  const overlaps = (start: number, end: number): boolean => taken.some((t) => start < t.end && end > t.start);
  for (const pattern of [FEE_THEN_FIGURE, FIGURE_THEN_FEE]) {
    pattern.lastIndex = 0;
    for (const m of text.matchAll(pattern)) {
      const start = m.index ?? 0;
      const end = start + m[0].length;
      const value = m[1] ? readFigure(m[1]) : null;
      if (value === null || overlaps(start, end)) continue;
      taken.push({ start, end, value });
    }
  }
  if (taken.length === 0) return { total: null, without: text };
  let without = text;
  for (const t of [...taken].sort((a, b) => b.start - a.start)) {
    without = `${without.slice(0, t.start)} ${without.slice(t.end)}`;
  }
  return { total: taken.reduce((sum, t) => sum + t.value, 0), without };
}

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
  // Fees first, so their figures are never mistaken for the amount.
  const fees = feesIn(text, readFigure);
  const body = fees.without;

  const onTop = ON_TOP.exec(body);
  const match = onTop ?? FIGURE_THEN_INTEREST.exec(body) ?? INTEREST_THEN_FIGURE.exec(body);
  const stated = match?.[1] ? readFigure(match[1]) : null;

  const without = match ? `${body.slice(0, match.index)} ${body.slice(match.index + match[0].length)}` : body;
  const principalMatch = PRINCIPAL.exec(without);
  const principal = principalMatch?.[1] ? readFigure(principalMatch[1]) : null;
  const rest = amountOf(without);

  const paying = PAY_VERB.test(text) && !PAID_WITH.test(text);
  const borrowing = BORROW_VERB.test(text);

  /*
   * A borrowing with fees or interest named beside it: the money received,
   * and everything named as added to what is owed.
   */
  if (borrowing && !PAY_VERB.test(text)) {
    const added = (fees.total ?? 0) + (stated ?? 0);
    return {
      effect: "draw",
      amount: rest,
      charges: added > 0 ? added : null,
      interest: null,
      interestUnstated: false,
    };
  }

  /*
   * Fees named with no payment and no borrowing: the lender added a charge.
   * "maya credit late fee 150" moved no money. A figure left over besides
   * the fees is not the charge, so it is left for the owner to look at.
   */
  if (!paying && !borrowing && fees.total !== null) {
    return {
      effect: "charge",
      amount: fees.total + (stated ?? 0),
      charges: null,
      interest: null,
      interestUnstated: false,
    };
  }

  // With a payment, fees named are paid in it, the same as interest.
  const inside = stated !== null || fees.total !== null ? (stated ?? 0) + (fees.total ?? 0) : null;

  let amount: Centavos | null;
  if (inside === null) amount = rest;
  else if (principal !== null) amount = principal + inside;
  else if (onTop && rest !== null) amount = rest + inside;
  else amount = rest ?? inside;

  /** The interest or fee figure is the only figure: the whole payment was that. */
  const allInterest = inside !== null && rest === null;

  let effect: DebtSentence["effect"];
  if ((INTEREST_ONLY.test(text) || allInterest) && !borrowing) effect = "interest";
  else if (paying && !borrowing) effect = "repay";

  // All of it interest: one "Interest only" row, with no part of it to state.
  if (effect === "interest") {
    return { effect, amount, charges: null, interest: null, interestUnstated: false };
  }

  const interest = inside !== null && amount !== null && inside <= amount ? inside : null;
  return {
    effect,
    amount,
    charges: null,
    interest,
    interestUnstated: interest === null && INTEREST_SAID.test(text),
  };
}

/** Money sent for someone who pays it back: "she will pay me back", "inabonohan". */
const FRONTED =
  /\b(pays? me back|paying me back|paid me back|pay (it|this) back|give (it|me|the money|the cash)? ?back|will give (me )?(it|the money|cash|the cash)|return(s)? (it|the money)|reimburse\w*|abono|abonohan|inabonohan|inabonuhan|nag ?abono|babayaran (ako|niya|nya)|bayaran (ako|niya|nya))\b/i;

/** Money received that belongs to someone else: "for the company, I'll pass it on". */
const HELD =
  /\b(not mine|hindi akin|to pass (it )?on|pass (it|this) on|passing it on|forward (it|this) to|ipapasa|ipasa|remit (it|this) to|hand (it|this) over|hold(ing)? it for|for (the |my |our )?(company|client|boss|office|employer)|(client|company|boss)('s)? (payment|money))\b/i;

/**
 * Money that only passes through, said in so many words.
 *
 * The owner's own examples, 2026-09-17: their mother asks them to send money
 * to family and pays it back in cash, or a client's payment lands in their
 * personal account for someone else. Neither is income or spending. Only
 * read when the words say it: a payment back, or money that is not theirs.
 */
export function readPassThrough(text: string): "held" | "fronted" | null {
  if (FRONTED.test(text)) return "fronted";
  if (HELD.test(text)) return "held";
  return null;
}

/**
 * What the chat says above a debt card: what it read, and what is left.
 *
 * It used to say "pick which credit line and what it does" whatever the
 * sentence had said, so "I paid my Maya Credit 1000" was answered as if the
 * line and the payment had not been named. And "including its interest" was
 * passed over in silence, when it is the one figure the card cannot know.
 */
export function debtCardIntro(
  draft: Draft,
  interestUnstated: boolean,
  debts: readonly Debt[],
  passThrough?: "held" | "fronted" | null,
): string {
  const line = debts.find((d) => d.id === draft.debtId)?.name;
  if (passThrough) {
    const who = line ? ` for **${line}**` : "";
    const parts = [
      passThrough === "fronted"
        ? `That reads as money you sent${who} that comes back to you. None of it is spending, and their payment back is not income.`
        : `That reads as money you are holding${who}, to pass on. None of it is income, and passing it on is not spending.`,
    ];
    if (!line) {
      parts.push(
        debts.some((d) => d.form === "pass-through")
          ? "Pick who it is for on the card."
          : "Open it in the form and add who it is for under Someone new: they are kept, so what they owe you or what you hold for them adds up.",
      );
    }
    parts.push("If a fee was charged to send it and you paid it yourself, add the fee as its own spending.");
    return parts.join(" ");
  }
  const what =
    draft.debtEffect === "repay"
      ? "a payment"
      : draft.debtEffect === "draw"
        ? "borrowing"
        : draft.debtEffect === "charge"
          ? "a charge the lender added"
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
  if (draft.debtEffect === "draw" && (draft.charges ?? 0) > 0 && draft.amount !== null) {
    parts.push(
      `**${formatMoney(draft.charges ?? 0)}** of fees was added on top, so what you owe goes up by **${formatMoney(
        draft.amount + (draft.charges ?? 0),
      )}**, and the fees count as spending today.`,
    );
  } else if (draft.debtEffect === "charge" && draft.amount !== null) {
    parts.push(`No money moved: what you owe goes up by **${formatMoney(draft.amount)}**, and it counts as spending today.`);
  } else if (draft.debtEffect === "repay" && (draft.interest ?? null) !== null) {
    parts.push(`**${formatMoney(draft.interest ?? 0)}** of it is interest, so only the rest lowers what you owe.`);
  } else if (interestUnstated) {
    parts.push(
      "You said it includes interest. Put how much in **Interest included**: it is on the bill or in the lender's app. No rate is assumed, since every lender counts it differently.",
    );
  }
  parts.push("Check the card, then add it.");
  return parts.join(" ");
}
