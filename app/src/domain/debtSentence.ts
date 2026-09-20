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

import type { Debt, DebtEffect } from "./debt";
import type { Draft } from "./entry";
import { formatMoney, type Centavos } from "./money";
import { effectLabel, effectMeaning } from "./debtWords";

export interface DebtSentence {
  /** The effect the words state beyond doubt, or undefined to leave it for the owner. */
  readonly effect?: "repay" | "draw" | "interest" | "charge" | "lend" | "collect" | undefined;
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

/** Money lent to someone: "I lent 500 to Juan", "pinautang". */
const LEND_VERB = /\b(lent|lend|lending|loaned (?:it |the money )?to|pinautang|nagpautang|pautang|inutangan|gave \S+ (?:a )?loan)\b/i;

/** Money lent coming back: "Juan paid me back 200", "ibinalik". */
const COLLECT_VERB =
  /\b(paid me back|paid back to me|gave (?:it |the money |my money )?back|returned (?:the |my )?(?:money|loan|utang)|collected|nagbayad sa akin|binayaran (?:ako|niya|nya)|ibinalik)\b/i;

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
  // Money you lent, going out and coming back. Checked first: "paid me back" is not you paying.
  if (COLLECT_VERB.test(text)) {
    return { effect: "collect", amount: amountOf(text), charges: null, interest: null, interestUnstated: false };
  }
  if (LEND_VERB.test(text) && !BORROW_VERB.test(text)) {
    return { effect: "lend", amount: amountOf(text), charges: null, interest: null, interestUnstated: false };
  }
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
  /\b(will pay me back|pays me back|going to pay me back|to pay me back|pay me back later|will pay (it|this) back|give (it|me|the money|the cash)? ?back|will give (me )?(it|the money|cash|the cash)|return(s)? (it|the money)|reimburse\w*|abono|abonohan|inabonohan|inabonuhan|nag ?abono|babayaran (ako|niya|nya)|bayaran (ako|niya|nya))\b/i;

/** Money received that belongs to someone else: "for the company, I'll pass it on". */
const HELD =
  /\b(not mine|hindi akin|to pass (it )?on|pass (it|this) on|passing it on|forward (it|this) to|ipapasa|ipasa|remit (it|this) to|hand (it|this) over|hold(ing)? it for|for (the |my |our )?(company|client|boss|office|employer)|(client|company|boss)('s)? (payment|money))\b/i;

/**
 * Money that arrived with an instruction attached.
 *
 * The owner, 20 September 2026: "My mom send 1000 in my gcash and ask me
 * to send it to someone to my aunt for medical help". Their note under it
 * reads "wrong that should be recived and on behalf", and they were right:
 * it came back as a plain transfer with no destination, which books the
 * whole thousand as money they spent.
 *
 * None of the phrases above fit it. What marks this one is the
 * instruction: someone gave you money and asked you to move it on to a
 * third person. It is theirs the whole way through.
 */
const ASKED_TO_PASS =
  /\b(?:ask(?:ed|s)?|told|wants?|sabi|pakiusap|requested)\b[^.]{0,30}?\bme\b[^.]{0,30}?\bto\s+(?:send|give|transfer|pass|deliver|remit|forward|ipadala|ibigay|hatid)\b|\b(?:send|give|transfer|pass|remit|forward)\s+(?:it|this|the money|the cash|ito|iyon|yun)\s+to\b|\b(?:sabi|utos|bilin|pakiusap)\b[^.]{0,40}?\b(?:ipadala|ibigay|ipasa|iabot|hatid)\b|\b(?:ipadala|ibigay|ipasa|iabot)\s+ko\s+(?:sa|kay)\b/i;

/** Somebody other than the owner will pay: "he will repay me later", "my mother will pay for it". */
const THEY_WILL_PAY =
  /\b(he|she|they|his|her|mama|mom|mother|nanay|papa|dad|father|tatay|kuya|ate|tita|tito|lola|lolo|friend|freind|client|boss|brother|sister|bro|sis)\b[^.]{0,24}?\b(will|would|is going to|are going to|promised to|said (?:he|she|they)(?:'ll| will))\s+(?:re)?pay\b|\b(?:repay me|pay me (?:back )?later|will repay)\b/i;

/** The same, with a name: "Stephen will repay me". Case matters here, so a name is told from "I". */
const NAME_WILL_PAY = /\b[A-Z][a-z]+\s+(?:will|would|is going to|promised to)\s+(?:re)?pay\b/;

/** They will not: written off, which counts as spending. */
const WRITE_OFF =
  /\b(write (?:it |this |that )?off|written off|writeoff|count (?:it )?as (?:spending|expense)|consider (?:it )?(?:as )?(?:spending|expense)|no longer expect\w*)\b|\b(?:he|she|they|mama|mom|mother|papa|dad|kuya|ate|tita|tito|friend|freind|client|boss|brother|sister)\b[^.]{0,20}?\b(?:won'?t|will not|didn'?t|did not|never|refuses? to|is not going to)\s+(?:re)?pay\b/i;
const NAME_WONT_PAY = /\b[A-Z][a-z]+\s+(?:won'?t|will not|didn'?t|did not|never|refuses to|is not going to)\s+(?:re)?pay\b/;

/** They let the owner keep it: retained, which counts as income. */
const RETAIN =
  /\b(let me keep|lets me keep|told me to keep|said (?:i can |to )?keep|you can keep|i can keep|keep the (?:money|change|rest)|it'?s mine now|akin (?:na|daw))\b/i;

/**
 * Their money passed on: "gave my boss his 5000", "remitted it to the company".
 *
 * The person comes between the verb and "his": "gave her 200 in cash" is a
 * gift of the owner's own money, and "her" there is who got it.
 */
const RELEASE =
  /\b(?:gave|give|handed|passed|sent|forwarded|returned)\s+(?:to\s+)?(?:my |the |our )?[a-z]+\s+(?:his|her|their)\s+(?:money|share|payment|cash|funds?|₱|php|\d)|\b(?:remitted|forwarded|handed over|passed on|turned over)\b/i;

/** Holding someone's money: "I hold 1000 for my brother", "keeping 500 for mama". */
const HOLDING = /\b(?:hold|holding|safekeep\w*|keeping|itinatago)\b[^.]{0,30}?\bfor\s+(?:my |her |his |the |our )?[a-z]+/i;

/**
 * On someone's behalf, said in so many words, and what happened.
 *
 * The owner's scenarios, 2026-09-17: paying for a friend's meal who repays
 * later, sending money a mother pays back, holding money for someone, and a
 * friend who never pays, which becomes spending. Checked in that order of
 * certainty: keeping it and writing it off are the most explicit, holding
 * the least. A payment back ("paid me back") is left to the person named,
 * because it reads the same for a loan.
 */
export function readBehalf(text: string): { side: "owed" | "held"; effect: DebtEffect } | null {
  if (RETAIN.test(text)) return { side: "held", effect: "writeoff" };
  if (WRITE_OFF.test(text) || NAME_WONT_PAY.test(text)) return { side: "owed", effect: "writeoff" };
  if (COLLECT_VERB.test(text)) return null;
  if (FRONTED.test(text) || THEY_WILL_PAY.test(text) || NAME_WILL_PAY.test(text)) return { side: "owed", effect: "lend" };
  if (RELEASE.test(text)) return { side: "held", effect: "repay" };
  if (HELD.test(text) || HOLDING.test(text) || ASKED_TO_PASS.test(text)) return { side: "held", effect: "draw" };
  return null;
}

/** Where the sentence starts saying how it comes back, so the wallet is read from before it. */
export function payBackClauseAt(text: string): number {
  /*
   * From the word before "will pay", not from the person named earlier:
   * "i paid my friend food 180 cash and he will pay me back" paid from Cash,
   * and cutting at "friend" threw the wallet away with the clause.
   */
  const clause = /(?:\b(?:and|but|so)\s+)?\b[a-z]+\s+(?:will|would|is going to|are going to|promised to)\s+(?:re)?pay\b|\b(?:repay me|pay me (?:back )?later)\b/i;
  const found = [FRONTED, clause]
    .map((re) => re.exec(text)?.index ?? -1)
    .filter((i) => i >= 0);
  return found.length > 0 ? Math.min(...found) : text.length;
}

/**
 * Money that only passes through, said in so many words.
 *
 * The owner's own examples, 2026-09-17: their mother asks them to send money
 * to family and pays it back in cash, or a client's payment lands in their
 * personal account for someone else. Neither is income or spending. Only
 * read when the words say it: a payment back, or money that is not theirs.
 */
export function readPassThrough(text: string): "held" | "fronted" | null {
  const said = readBehalf(text);
  if (said?.side === "owed" && said.effect === "lend") return "fronted";
  if (said?.side === "held" && said.effect === "draw") return "held";
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
  if (draft.behalf) {
    const shape = { kind: draft.behalf === "owed" ? ("receivable" as const) : ("payable" as const), form: "pass-through" as const };
    const parts = [
      draft.debtEffect
        ? `That reads as On behalf: **${effectLabel(draft.debtEffect, shape)}**${line ? ` with **${line}**` : ""}. ${effectMeaning(draft.debtEffect, shape)}`
        : `That reads as On behalf${line ? ` with **${line}**` : ""}. Pick what happened on the card.`,
    ];
    if (!line) parts.push("Pick who it is on the card, or keep the new name it read.");
    if (draft.debtEffect === "writeoff" && !draft.item) parts.push("Pick what it counts as on the card.");
    parts.push("Check the card, then add it.");
    return parts.join(" ");
  }
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
    draft.debtEffect === "lend"
      ? "money you lent"
      : draft.debtEffect === "collect"
        ? "money paid back to you"
        : draft.debtEffect === "repay"
      ? "a payment"
      : draft.debtEffect === "draw"
        ? "borrowing"
        : draft.debtEffect === "charge"
          ? "a charge the lender added"
          : draft.debtEffect === "interest"
            ? "interest paid on its own"
            : "debt";
  const with_ = draft.debtEffect === "lend" ? "to" : draft.debtEffect === "collect" ? "from" : "on";
  const parts = [`That reads as ${what}${line ? ` ${with_} **${line}**` : ""}.`];
  const toYou = draft.debtEffect === "lend" || draft.debtEffect === "collect";
  const missing = [!line ? (toYou ? "who it is" : "which debt") : "", !draft.debtEffect ? "what it does" : ""].filter(Boolean);
  if (missing.length > 0) {
    parts.push(
      `Pick ${missing.join(" and ")} on the card: ${missing.length === 2 ? "those are" : "that is"} not something to guess with money that is owed.`,
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
