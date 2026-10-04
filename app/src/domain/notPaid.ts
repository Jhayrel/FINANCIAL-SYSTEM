/**
 * A picture of money asked for, not money paid.
 *
 * The owner, 4 October 2026, sent fourteen pictures to train the reader on
 * ("Dont add this just train"). Four of them record no payment at all:
 *
 *   - an electricity company's billing invoice, printed "THIS IS NOT A
 *     RECEIPT UNLESS MACHINE VALIDATED", with "PLEASE PAY ON OR BEFORE";
 *   - a school's assessment of fees, "Enrollment is not yet validated",
 *     with an amount due as the down payment and a grand total;
 *   - two online shop checkout screens with "Place Order" still on them.
 *
 * Each prints totals, tax lines and dates exactly as a receipt does, so a
 * reader that looks for a total finds one and offers it as spending. None
 * of them happened: a bill is owed, an assessment is a schedule, and a
 * checkout is an order not yet placed. So they are told apart here, from
 * the words the document prints about itself, and the card waits for the
 * owner to say it was paid.
 *
 * Pure, on text, so it runs the same on the device and in a test.
 */

import { walletInside } from "./capture";
import { emptyDraft, type Draft } from "./entry";
import type { Centavos } from "./money";
import { figuresIn, formatMoney } from "./money";
import type { IsoDate, ReferenceLists } from "./types";
import { billFor } from "./walletReceipt";

export type NotPaidKind = "bill" | "assessment" | "checkout" | "quote";

export interface NotPaid {
  readonly kind: NotPaidKind;
  /** Who asks for it, as printed at the top ("RIVERSIDE POWER COOPERATIVE, INC."), when it could be read. */
  readonly from: string;
  /** What it asks for now: the bill's amount due, the assessment's down payment, the checkout's total. */
  readonly amount: Centavos | null;
  /** The whole, when it differs: an assessment's grand total. */
  readonly whole?: Centavos;
  /** The day it is due, as printed ("May 27, 2025", "June 10, 2025"). */
  readonly due?: string;
  /** The days a bill covers, as printed. */
  readonly period?: string;
  /** Figures that make up the amount (a checkout's items and shipping), for the model and the owner. */
  readonly parts: readonly string[];
  /** Every figure that is this document's own, so a card on one of them can be held back. */
  readonly figures: readonly Centavos[];
}

const FIGURE = /(?<![\d.,])(?:₱|php|#)?\s?(\d{1,3}(?:,\d{3})+|\d+)\.(\d{2})(?![\d,]|\.\d)/gi;

const figuresOn = (line: string): Centavos[] =>
  [...line.matchAll(FIGURE)].map((m) => Number((m[1] ?? "0").replace(/,/g, "")) * 100 + Number(m[2] ?? "0"));

/** Words the document prints that say it was paid: such a picture is a receipt, read elsewhere. */
const PAID =
  /\b(?:order (?:placed|confirmed|received|successful)|payment (?:successful|complete(?:d)?|received|confirmed|posted)|thank you for (?:your )?(?:order|purchase|payment)|amount paid|total amount paid|validated payment|machine validated:)\b|\bpaid on\s+(?:\d|[a-z]{3,9}\.?\s+\d)/i;

/** The owner saying it was paid, in the message with the picture. */
export function saysItWasPaid(note: string | undefined): boolean {
  if (!note) return false;
  if (/\b(?:not|never|haven'?t|hasn'?t|didn'?t|di pa|hindi pa|wala pa)\s+(?:yet\s+)?(?:paid|placed|ordered|bayad)/i.test(note)) return false;
  return /\b(?:paid|i pay|placed|ordered|i ordered|bought|binayaran|nabayaran|bayad na|nagbayad|settled|checked out)\b/i.test(note);
}

/** The first line that reads as a name at the top: a company, a school, a shop. */
function issuerIn(lines: readonly string[]): string {
  const top = lines.slice(0, 8);
  const named = top.find((l) => /\b(?:inc|corp(?:oration)?|company|co\.|cooperative|electric|water|telecom|college|university|school|academy|institute|office|bank|shop|store)\b/i.test(l) && /[a-z]{3}/i.test(l));
  return (named ?? "")
    .replace(/[^A-Za-z0-9&.,' -]/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/[\s,.-]+$/, "")
    .trim()
    .slice(0, 60);
}

/** "on or before June 10, 2025", "PLEASE PAY ON OR BEFORE May 27", "Due date: 05/29/2025". */
function dueIn(text: string): string | undefined {
  const month = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?";
  const label = "\\b(?:on or before|due(?:[ \\t]+date)?|pay[ \\t]+(?:by|before|until))[ \\t]*[:.]?[ \\t]*[\"']?[ \\t]*";
  // On the same line as its label, in any form; on the next line only as a whole date with its year.
  const m =
    new RegExp(`${label}(${month}[ \\t]+\\d{1,2}(?:,?[ \\t]*20\\d{2})?|\\d{1,2}[ \\t]+${month}(?:[ \\t]+20\\d{2})?|\\d{1,2}[/-]\\d{1,2}[/-](?:20)?\\d{2})\\b`, "i").exec(text) ??
    new RegExp(`${label}\\n[ \\t]*(${month}[ \\t]+\\d{1,2},?[ \\t]*20\\d{2})\\b`, "i").exec(text);
  return m?.[1]?.replace(/\s+/g, " ").trim();
}

/** "04/15/2025-05/15/2025" after "period covered" or "billing period". */
function periodIn(text: string): string | undefined {
  const m = /\b(?:period\s*covered|billing\s*period|service\s*period)\b[^\d\n]{0,20}(\d{1,2}\/\d{1,2}\/\d{4})\s*(?:[-\u2010-\u2015]|to)\s*(\d{1,2}\/\d{1,2}\/\d{4})/i.exec(text);
  return m ? `${m[1]} to ${m[2]}` : undefined;
}

/** The figure most of the labelled lines agree on, and on a tie the largest. */
function agreed(lines: readonly string[], label: RegExp): Centavos | null {
  const votes = new Map<Centavos, number>();
  for (const line of lines) {
    if (!label.test(line)) continue;
    const figures = figuresOn(line);
    const last = figures[figures.length - 1];
    if (last !== undefined && last > 0) votes.set(last, (votes.get(last) ?? 0) + 1);
  }
  const best = [...votes.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
  return best ? best[0] : null;
}

function checkoutIn(lines: readonly string[], text: string): NotPaid | null {
  const onScreen =
    /\bplace\s*(?:my\s*)?order\b/i.test(text) ||
    /\bproceed\s+to\s+(?:checkout|payment)\b/i.test(text) ||
    (/\bcheck\s*-?\s*out\b/i.test(text) && /\b(?:enter voucher|voucher code|shipping fee|delivery option|choose your delivery)\b/i.test(text));
  if (!onScreen) return null;
  // The grand total is the last line that starts with "Total", not a package's "1 Items, Total".
  const totals = lines.filter((l) => /^\W*total\b/i.test(l.trim())).flatMap((l) => figuresOn(l));
  const amount = totals[totals.length - 1] ?? null;
  const subtotal = agreed(lines, /^\W*sub\s*-?\s*total\b/i);
  const shipping = agreed(lines, /\b(?:shipping|delivery)\s*(?:fee)?\b/i);
  const parts = [
    ...(subtotal !== null ? [`${formatMoney(subtotal)} for the items`] : []),
    ...(shipping !== null ? [`${formatMoney(shipping)} shipping`] : []),
  ];
  const figures = lines.flatMap(figuresOn);
  return { kind: "checkout", from: "", amount, parts, figures };
}

function billIn(lines: readonly string[], text: string): NotPaid | null {
  const says =
    /\b(?:this is )?not (?:a|an official) receipt\b/i.test(text) ||
    /\bbilling\s+(?:invoice|statement|notice)\b/i.test(text) ||
    /\bstatement\s+of\s+account\b/i.test(text) ||
    /\bdisconnection\s+notice\b/i.test(text) ||
    /\bplease\s+pay\s+(?:on\s+or\s+before|before|by)\b/i.test(text);
  if (!says) return null;
  const amount = agreed(
    lines,
    /\b(?:grand\s*total|net\s*bill|total\s*amount\s*due|amount\s*due|total\s*due|charges\s*for\s*this|total\s*current\s*bill|amount\s*payable|please\s*pay)\b/i,
  );
  const due = dueIn(text);
  const period = periodIn(text);
  return {
    kind: "bill",
    from: issuerIn(lines),
    amount,
    ...(due ? { due } : {}),
    ...(period ? { period } : {}),
    parts: [],
    figures: lines.flatMap(figuresOn),
  };
}

function assessmentIn(lines: readonly string[], text: string): NotPaid | null {
  if (!/\bassessment\b/i.test(text)) return null;
  if (!/\b(?:amount\s*due|payment\s*schedule|down\s*-?\s*payment|please\s*pay|not\s*yet\s*validated|to\s*validate)\b/i.test(text)) return null;
  const amount = agreed(lines, /\bamount\s*due\b/i);
  const whole = agreed(lines, /\b(?:grand\s*total|total\s*tuition\s*and\s*fees|total\s*assessment)\b/i);
  const due = dueIn(text);
  return {
    kind: "assessment",
    from: issuerIn(lines),
    amount: amount ?? whole,
    ...(whole !== null && whole !== amount ? { whole } : {}),
    ...(due ? { due } : {}),
    parts: [],
    figures: lines.flatMap(figuresOn),
  };
}

function quoteIn(lines: readonly string[], text: string): NotPaid | null {
  if (!/\b(?:quotation|price\s*quote|pro\s*-?\s*forma|estimate(?:d)?\s+(?:cost|total|amount))\b/i.test(text)) return null;
  const amount = agreed(lines, /\b(?:grand\s*total|total\s*amount|total)\b/i);
  return { kind: "quote", from: issuerIn(lines), amount, parts: [], figures: lines.flatMap(figuresOn) };
}

/**
 * The document in one or more readings of one picture, when it asks for
 * money rather than records it paid; null for anything else.
 */
export function readNotPaid(readings: readonly string[]): NotPaid | null {
  const texts = readings.filter((t) => t.trim());
  if (texts.length === 0) return null;
  const text = texts.join("\n");
  if (PAID.test(text)) return null;
  // The reading with the most lines carries the most labels; the others fill a figure it lost.
  const lines = texts.flatMap((t) => t.split(/\r?\n/)).map((l) => l.trim()).filter(Boolean);
  return checkoutIn(lines, text) ?? assessmentIn(lines, text) ?? billIn(lines, text) ?? quoteIn(lines, text);
}

/** Each picture's document, from the readings in pairs (plain, raised) as `extractRead` lays them out. */
export function notPaidIn(readings: readonly string[]): NotPaid[] {
  const out: NotPaid[] = [];
  for (let i = 0; i < readings.length; i += 2) {
    const d = readNotPaid([readings[i] ?? "", readings[i + 1] ?? ""]);
    if (d && !out.some((o) => o.kind === d.kind && o.amount === d.amount)) out.push(d);
  }
  return out;
}

const KIND_WORDS: Record<NotPaidKind, string> = {
  bill: "a bill",
  assessment: "an assessment of fees",
  checkout: "a checkout screen",
  quote: "a quotation",
};

/** What the model is told, with the reading. */
export function notPaidNote(doc: NotPaid, paid: boolean): string {
  const amount = doc.amount !== null ? formatMoney(doc.amount).replace("₱", "PHP ") : "";
  const what =
    doc.kind === "checkout"
      ? `This is an online shop's checkout screen with Place Order still on it: the order had not been placed when it was taken${amount ? `, and its total is ${amount}` : ""}.`
      : `This is ${KIND_WORDS[doc.kind]}${doc.from ? ` from ${doc.from}` : ""}, not a receipt: it asks for money and records no payment${amount ? `. It asks for ${amount}` : ""}${doc.due ? `, due ${doc.due}` : ""}.`;
  return paid
    ? `${what} They say it was paid, so propose one row of ${amount || "the amount it asks for"}: ${doc.kind === "bill" ? "category Bills, item from their bills" : doc.kind === "assessment" ? "spending on school" : "spending on what was ordered, with the shipping in the amount"}. A figure in its breakdown is never a row of its own.`
    : `${what} Propose nothing from it: nothing was paid. Its figures are not spending.`;
}

/** What the owner is told when nothing is offered for it. */
export function notPaidWords(doc: NotPaid): string {
  const amount = doc.amount !== null ? formatMoney(doc.amount) : "";
  if (doc.kind === "checkout") {
    return [
      `That is a checkout screen with Place Order still on it, so the order was not placed when it was taken${amount ? `: ${amount}` : ""}${doc.parts.length > 0 ? ` (${doc.parts.join(", ")})` : ""}.`,
      `Nothing is added. If you placed it, say how you paid ("placed it, paid with gcash") and I will make the card.`,
    ].join(" ");
  }
  const whole = doc.whole !== undefined ? ` (${formatMoney(doc.whole)} in all)` : "";
  const due = doc.due ? `, due ${doc.due}` : "";
  const from = doc.from ? ` from ${doc.from}` : "";
  const asks = amount ? ` It asks for ${amount}${whole}${due}.` : "";
  return `That is ${KIND_WORDS[doc.kind]}${from}, not a receipt, so it records no payment.${asks} Nothing is added. When you pay it, send the receipt, or say "paid it from cash".`;
}

/** Whether a card's amount is one of the document's own figures. */
export function isNotPaidFigure(amount: Centavos | null, docs: readonly NotPaid[]): boolean {
  if (amount === null) return false;
  return docs.some((d) => d.amount === amount || d.whole === amount || d.figures.includes(amount));
}


/**
 * The card for one of them, once the owner says it was paid: "placed it,
 * paid with gcash", "paid it from cash". The amount it asked for unless the
 * owner says another, the account they name, and the kind it is: a bill on
 * the bills list, a checkout as an online purchase, fees as school.
 */
export function paidDraftFor(doc: NotPaid, said: string, reference: ReferenceLists, asOf: IsoDate): Draft {
  const accounts = [...reference.wallets, ...reference.savings];
  const figures = figuresIn(said);
  const amount = figures.length === 1 ? (figures[0] ?? null) : doc.amount;
  const kindOf = (pattern: RegExp): string =>
    reference.spendingTypes.find((t) => pattern.test(t.name))?.name ?? reference.spendingTypes.find((t) => pattern.test(t.remark))?.name ?? "";
  const bill = doc.kind === "bill" ? billFor(doc.from, reference.bills) : "";
  const item =
    doc.kind === "bill"
      ? bill
      : doc.kind === "checkout"
        ? kindOf(/\bonline|shopee|lazada/i)
        : doc.kind === "assessment"
          ? kindOf(/\bschool|tuition|education/i)
          : "";
  const description =
    doc.kind === "checkout"
      ? `Online order${doc.parts.length > 0 ? ` (${doc.parts.join(", ")})` : ""}`
      : doc.kind === "assessment"
        ? `School fees${doc.from ? `, ${doc.from}` : ""}`
        : doc.from || "Bill";
  return {
    ...emptyDraft(asOf),
    flow: "Spending",
    category: doc.kind === "bill" ? "Bills" : "Spending",
    item,
    description,
    amount,
    fromWallet: walletInside(said, accounts),
    status: "Paid",
  };
}
