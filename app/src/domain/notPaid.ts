/**
 * A picture of money asked for, not money paid.
 *
 * A bill, an assessment of fees, a checkout screen and a quotation print
 * totals, tax lines and dates exactly as a receipt does, so a reader that
 * looks for a total finds one and offers it as spending. None of them
 * happened: a bill is owed, an assessment is a schedule, a checkout is an
 * order not yet placed. The card waits for the owner to say it was paid.
 *
 * Which kind a paper is comes from training, not from rules written for
 * particular papers (`paperKind.ts`): the owner, 5 October 2026, "Dont hard
 * code those please train them". A paper that reads like one the owner
 * taught is that kind; otherwise the trained reader decides, and only when
 * it is sure. What is left here is reading the figures off a paper once its
 * kind is known: the amount it asks for, by when, and from whom, helped by
 * the line the owner's own example of it carried its amount on.
 *
 * Pure, on text, so it runs the same on the device and in a test.
 */

import { walletInside } from "./capture";
import { emptyDraft, type Draft } from "./entry";
import type { Centavos } from "./money";
import { figuresIn, formatMoney } from "./money";
import { classifyPaper, UNPAID, type PaperKind } from "./paperKind";
import { nearestTaught, trainingFrom, type PaperTraining, type TaughtPaper } from "./paperMemory";
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

/** How sure the trained reader must be before a picture is held back as unpaid. */
export const SURE_UNPAID = 0.85;

const STOP = new Set(["the", "and", "for", "total", "amount", "php", "with", "this", "your", "from"]);

/**
 * The figure on the line the owner's own example carried its amount on.
 * Their electricity bill's amount sat beside "GRAND TOTAL / NETBILL": this
 * month's does too, whatever else on the page reads as a total.
 */
function byTaughtLine(lines: readonly string[], taught: TaughtPaper | undefined): Centavos | null {
  if (!taught?.amount) return null;
  const shown = (taught.amount / 100).toFixed(2);
  const withCommas = Number(shown).toLocaleString("en-US", { minimumFractionDigits: 2 });
  const line = taught.text.split(/\r?\n/).find((l) => l.includes(shown) || l.includes(withCommas));
  const words = (line ?? "").toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter((w) => w.length >= 3 && !STOP.has(w));
  if (words.length === 0) return null;
  for (const l of lines) {
    const own = l.toLowerCase();
    if (!words.some((w) => own.includes(w))) continue;
    const figures = figuresOn(l);
    const last = figures[figures.length - 1];
    if (last !== undefined && last > 0) return last;
  }
  return null;
}

function checkoutFigures(lines: readonly string[]): Pick<NotPaid, "amount" | "parts"> {
  // The grand total is the last line that starts with "Total", not a package's "1 Items, Total".
  const totals = lines.filter((l) => /^\W*total\b/i.test(l.trim())).flatMap((l) => figuresOn(l));
  const subtotal = agreed(lines, /^\W*(?:sub\s*-?\s*total|merchandise\s*subtotal|items?\s*subtotal)\b/i);
  const shipping = agreed(lines, /\b(?:shipping|delivery)\s*(?:fee|subtotal)?\b/i);
  return {
    amount: totals[totals.length - 1] ?? agreed(lines, /\btotal\b/i),
    parts: [
      ...(subtotal !== null ? [`${formatMoney(subtotal)} for the items`] : []),
      ...(shipping !== null ? [`${formatMoney(shipping)} shipping`] : []),
    ],
  };
}

const DUE_LABEL =
  /\b(?:grand\s*total|net\s*bill|total\s*amount\s*due|amount\s*due|total\s*due|charges\s*for\s*this|total\s*current\s*bill|amount\s*payable|please\s*pay|statement\s*balance|balance\s*due)\b/i;

/** The figures of a paper whose kind is known. */
function figuresFor(kind: NotPaidKind, lines: readonly string[], text: string, taught: TaughtPaper | undefined): NotPaid {
  const fromExample = byTaughtLine(lines, taught);
  const figures = lines.flatMap(figuresOn);
  const from = issuerIn(lines);
  const due = dueIn(text);
  if (kind === "checkout") {
    const c = checkoutFigures(lines);
    return { kind, from: "", amount: fromExample ?? c.amount, parts: c.parts, figures };
  }
  if (kind === "assessment") {
    const amount = fromExample ?? agreed(lines, /\b(?:amount\s*due|due\s*this\s*month|minimum\s*down\s*-?\s*payment|initial\s*payment|down\s*-?\s*payment)\b/i);
    const whole = agreed(lines, /\b(?:grand\s*total|total\s*tuition\s*and\s*fees|total\s*assessment|total\s*fees|total\s*school\s*fees|total\s*amount)\b/i);
    return { kind, from, amount: amount ?? whole, ...(whole !== null && whole !== amount ? { whole } : {}), ...(due ? { due } : {}), parts: [], figures };
  }
  if (kind === "quote") {
    return { kind, from, amount: fromExample ?? agreed(lines, /\b(?:quoted\s*total|estimated\s*(?:total|cost)|grand\s*total|total\s*amount|total)\b/i), parts: [], figures };
  }
  const period = periodIn(text);
  return { kind, from, amount: fromExample ?? agreed(lines, DUE_LABEL), ...(due ? { due } : {}), ...(period ? { period } : {}), parts: [], figures };
}

/**
 * The paper in one or more readings of one picture, when it asks for money
 * rather than records it paid; null for anything else.
 *
 * A paper that reads like one the owner taught is the kind they taught. A
 * new one is the kind the trained reader says, when it is at least
 * `SURE_UNPAID` sure: less sure, it is left to the model as before, because
 * holding back a paid receipt by mistake loses an entry.
 */
export function readNotPaid(readings: readonly string[], training: PaperTraining = trainingFrom()): NotPaid | null {
  const texts = readings.filter((t) => t.trim());
  if (texts.length === 0) return null;
  const text = texts.join("\n");
  const lines = texts.flatMap((t) => t.split(/\r?\n/)).map((l) => l.trim()).filter(Boolean);
  const near = nearestTaught(text, training.taught, 0.5);
  const kind: PaperKind = near ? near.paper.kind : (() => {
    const guess = classifyPaper(text, training.model);
    return guess.p >= SURE_UNPAID ? guess.kind : "receipt";
  })();
  if (!UNPAID.has(kind)) return null;
  return figuresFor(kind as NotPaidKind, lines, text, near?.paper.kind === kind ? near.paper : undefined);
}

/** Each picture's document, from the readings in pairs (plain, raised) as `extractRead` lays them out. */
export function notPaidIn(readings: readonly string[], training: PaperTraining = trainingFrom()): NotPaid[] {
  const out: NotPaid[] = [];
  for (let i = 0; i < readings.length; i += 2) {
    const d = readNotPaid([readings[i] ?? "", readings[i + 1] ?? ""], training);
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
