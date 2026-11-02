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
import { figuresIn, formatMoney, withoutDays } from "./money";
import { classifyPaper, UNPAID, type PaperKind } from "./paperKind";
import { nearestTaught, trainingFrom, type PaperTraining, type TaughtPaper } from "./paperMemory";
import { formatMedium as formatMediumDay } from "./dates";
import { dayFor } from "./plannerAsk";
import { dateSaid } from "./readEntry";
import type { IsoDate, ReferenceLists } from "./types";
import { billFor } from "./walletReceipt";

export type NotPaidKind = "bill" | "assessment" | "checkout" | "quote" | "letter";

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
  // A photographed letterhead reads "Gollege", "Co1lege", "Universlty": the name is still the name.
  const mended = top.map((l) => l.replace(/\b[CcGg][o0][l1I]{1,2}[e3]g[e3]\b/g, "College").replace(/\bUn[il1]vers[il1]ty\b/gi, "University").replace(/\bSch[o0]{2}[l1]\b/gi, "School"));
  const named = mended.find((l) => /\b(?:inc|corp(?:oration)?|company|co\.|cooperative|electric|water|telecom|college|university|school|academy|institute|office|bank|shop|store)\b/i.test(l) && /[a-z]{3}/i.test(l));
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

/** A paper's own words that the money was paid: "received from", "acknowledge receipt of your payment", "fully paid". */
const SAYS_PAID =
  /\b(?:acknowledge(?:s|d)?\s+(?:the\s+)?receipt\s+of\s+(?:your|the|a)\s+payment|(?:we|i|the\s+office)\s+(?:have\s+|has\s+)?received\s+(?:your\s+payment|the\s+(?:sum|amount)|php|p\s?\d|₱)|received\s+from\s+\S+.{0,60}?\b(?:the\s+)?(?:sum|amount)\s+of|(?:has|have)\s+(?:been\s+)?(?:fully\s+)?paid\s+(?:in\s+full|the\s+(?:amount|sum))|fully\s+paid|paid\s+in\s+full|payment\s+(?:was|has\s+been)\s+received|thank\s+you\s+for\s+your\s+payment)\b/i;

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
  if (kind === "letter") {
    /*
     * A letter's own sentence names what it asks for: "the payment ...
     * amounting to Fourteen thousand nine hundred fifty pesos only (Php
     * 14,950.00)". The largest figure said as a payment is the amount; a
     * smaller fee beside it is a part ("the notary fee ... Php 100.00").
     */
    const flat = text.replace(/\s+/g, " ");
    const asked = [...flat.matchAll(/\b(?:payment|amounting\s+to|amount\s+of|the\s+sum\s+of|contribution|fee|fees|dues|to\s+be\s+(?:paid|settled))\b[^.]{0,160}?(?:₱|php|p)\s*([\d,]+\.\d{2})/gi)].map((m) => ({
      c: Number((m[1] ?? "0").replace(/,/g, "")) * 100,
      // What the sentence calls it: "the notary fee", "a registration fee".
      what: /(?:^|\s)([a-z]{4,}\s+(?:fee|fees|charge|contribution|dues))\b/i.exec(flat.slice(Math.max(0, (m.index ?? 0) - 40), (m.index ?? 0) + m[0].length).replace(/^\S*\s/, " "))?.[1]?.toLowerCase(),
    })).filter((a) => a.c > 0);
    // One per amount, named as the first reading names it.
    const byAmount = new Map<Centavos, (typeof asked)[number]>();
    for (const a of asked) if (!byAmount.has(a.c) || (!byAmount.get(a.c)!.what && a.what)) byAmount.set(a.c, a);
    const sorted = [...byAmount.values()].sort((a, b) => b.c - a.c);
    const amount = sorted[0]?.c ?? null;
    const parts = sorted.slice(1).map((a) => `${formatMoney(a.c)}${a.what && !/^(?:the|and|for|this)\s/.test(a.what) ? ` ${a.what}` : ""} also named`);
    return { kind, from, amount, ...(due ? { due } : {}), parts, figures };
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
  /*
   * A letter that says the money was received or paid in full is a receipt
   * worded as a letter ("acknowledge receipt of your payment", "has fully
   * paid"): never held back, since holding back a paid paper loses an entry.
   */
  if (kind === "letter" && !near && SAYS_PAID.test(text.replace(/\s+/g, " "))) return null;
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
  letter: "a letter or notice",
};

/** What the model is told, with the reading. */
export function notPaidNote(doc: NotPaid, paid: boolean): string {
  const amount = doc.amount !== null ? formatMoney(doc.amount).replace("₱", "PHP ") : "";
  if (doc.kind === "letter") {
    const asks = amount ? ` It asks for ${amount}${doc.due ? ` to be paid by ${doc.due}` : ""}${doc.parts.length > 0 ? `, and names ${doc.parts.length === 1 ? "another amount" : "other amounts"}` : ""}.` : "";
    return paid
      ? `This is a letter or notice${doc.from ? ` from ${doc.from}` : ""}, not a receipt.${asks} They say it was paid, so propose one row of ${amount || "the amount it asks for"}, spending on what the letter is for. An amount it only mentions is never a row of its own.`
      : `This is a letter or notice${doc.from ? ` from ${doc.from}` : ""}, not a receipt: it records no payment.${asks} Propose nothing from it: a letter moves no money, and neither do the fees or dates in it.`;
  }
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
  if (doc.kind === "letter") {
    const asks = amount ? ` It asks for ${amount}${doc.due ? ` to be paid by ${doc.due}` : ""}.` : " It names no amount to pay.";
    return `That is a letter or notice${doc.from ? ` from ${doc.from}` : ""}, not a receipt, so it records no payment.${asks} Nothing is added. If you paid it, say so with the wallet and the day ("paid it from cash on feb 20"); if it is still to pay, say "plan it".`;
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
  // "paid it from cash on feb 20": the 20 is a day, not PHP 20.00.
  const figures = figuresIn(withoutDays(said));
  const amount = figures.length === 1 ? (figures[0] ?? null) : doc.amount;
  const kindOf = (pattern: RegExp): string =>
    reference.spendingTypes.find((t) => pattern.test(t.name))?.name ?? reference.spendingTypes.find((t) => pattern.test(t.remark))?.name ?? "";
  const bill = doc.kind === "bill" ? billFor(doc.from, reference.bills) : "";
  const item =
    doc.kind === "bill"
      ? bill
      : doc.kind === "checkout"
        ? kindOf(/\bonline|shopee|lazada/i)
        : doc.kind === "assessment" || (doc.kind === "letter" && /\b(?:college|school|university|academy|institute|tour|field\s*trip)\b/i.test(doc.from + " " + doc.parts.join(" ")))
          ? kindOf(/\bschool|tuition|education/i)
          : "";
  const description =
    doc.kind === "checkout"
      ? `Online order${doc.parts.length > 0 ? ` (${doc.parts.join(", ")})` : ""}`
      : doc.kind === "assessment"
        ? `School fees${doc.from ? `, ${doc.from}` : ""}`
        : doc.kind === "letter"
          ? doc.from ? `Payment asked by ${doc.from}` : "Payment asked by letter"
          : doc.from || "Bill";
  // "paid it from cash on feb 20": that day, not today (owner's letter, 1 November 2026).
  const when = dateSaid(said, asOf);
  return {
    ...emptyDraft(asOf),
    ...(when.said && when.date <= asOf ? { date: when.date } : {}),
    flow: "Spending",
    category: doc.kind === "bill" ? "Bills" : "Spending",
    item,
    description,
    amount,
    fromWallet: walletInside(said, accounts),
    status: "Paid",
  };
}

/**
 * A plan to pay what a bill or an assessment asks for, by the day it is due:
 * what it is called on the Planner and when. Null for a checkout or a
 * quotation (nothing is owed until the order is placed), for a paper with no
 * amount, and for a due day already gone or not read.
 */
export function planToPay(doc: NotPaid, dueDay: IsoDate | null, asOf: IsoDate): { readonly title: string; readonly amount: Centavos; readonly due: IsoDate } | null {
  if ((doc.kind !== "bill" && doc.kind !== "assessment" && doc.kind !== "letter") || doc.amount === null || doc.amount <= 0 || !dueDay || dueDay < asOf) return null;
  const from = doc.from.replace(/\s+/g, " ").trim().replace(/[,.]?\s*(?:inc|corp|co|ltd)\.?$/i, "").trim();
  const name = from.length > 0 && from.length <= 40 ? from.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()) : "";
  const title = doc.kind === "assessment" ? (name ? `${name} fees` : "School fees") : doc.kind === "letter" ? (name ? `${name} payment` : "Payment asked by letter") : name ? `${name} bill` : "Bill";
  return { title, amount: doc.amount, due: dueDay };
}

/**
 * The day a paper's due date means. A date with its year is that day. One
 * without ("Due Oct 21") is the nearest: a bill sent in on November 1 that
 * says October 21 is ten days late, not due next October.
 */
export function paperDueDay(due: string, asOf: IsoDate): IsoDate | null {
  const day = dayFor(due, asOf);
  if (!day || /\b20\d{2}\b|\/(?:20)?\d{2}$/.test(due.trim())) return day;
  const year = Number(day.slice(0, 4));
  const back = `${year - 1}${day.slice(4)}`;
  return Date.parse(`${day}T00:00:00Z`) - Date.parse(`${asOf}T00:00:00Z`) > 183 * 86_400_000 ? back : day;
}

/** An entry as the payment check reads it. */
export interface PaidRow {
  readonly recordNumber: number;
  readonly date: IsoDate;
  readonly type: string;
  readonly item: string;
  readonly description: string;
  readonly toWallet?: string | undefined;
  readonly total: Centavos;
}

export interface PaidAlready {
  readonly rows: readonly PaidRow[];
  readonly sum: Centavos;
  /** Its kind or its words match what the paper is for, not only its amount. */
  readonly sure: boolean;
}

const dayShift = (day: IsoDate, days: number): IsoDate => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * For a paper whose day to pay has passed, or one the owner says they paid:
 * the entry that looks like its payment, if the ledger has one. A school's
 * letter asking PHP 14,950.00 by February 28 was sent in on November 1
 * (owner, 2026), and the ledger had paid PHP 15,000.00 for it eleven days
 * before the day: adding it again would count it twice.
 *
 * Money that left: spending, or a transfer to no account of theirs. A move
 * between their own pockets ("Use to pay the field trip", Hidden cash to
 * Cash) is not the payment, only on its way to it. Within sixty days before
 * the day and thirty after, the amount within a peso or 3%; or the payment
 * in parts of the same kind that add up to it. `item` is the kind the paid
 * card would get (`paidDraftFor`): a row of that kind, or one sharing a word
 * with who sent the paper, is a sure match; an amount alone is a maybe.
 */
export function paidAlready(doc: NotPaid, dueDay: IsoDate | null, transactions: readonly PaidRow[], item = ""): PaidAlready | null {
  if (doc.amount === null || doc.amount <= 0 || !dueDay) return null;
  const asked = doc.amount;
  // A bill comes every month: last month's payment of about the same is not this one's.
  const lo = dayShift(dueDay, doc.kind === "bill" ? -25 : -60);
  const hi = dayShift(dueDay, 30);
  const left = transactions.filter((t) => (t.type === "Spending" || (t.type === "Transfer" && !(t.toWallet ?? "").trim())) && t.date >= lo && t.date <= hi && t.total > 0);
  const close = (c: Centavos): boolean => Math.abs(c - asked) <= Math.max(100, Math.round(asked * 0.03));
  const words = doc.from.toLowerCase().match(/[a-z]{5,}/g)?.filter((w) => !/^(?:saint|union|philippines|incorporated|company|office)$/.test(w)) ?? [];
  const fits = (t: PaidRow): boolean =>
    (item !== "" && t.item.trim().toLowerCase() === item.trim().toLowerCase()) || words.some((w) => `${t.item} ${t.description}`.toLowerCase().includes(w));
  const gap = (t: PaidRow): number => Math.abs(Date.parse(`${t.date}T00:00:00Z`) - Date.parse(`${dueDay}T00:00:00Z`));
  const one = left
    .filter((t) => close(t.total))
    .sort((a, b) => Number(fits(b)) - Number(fits(a)) || Math.abs(a.total - asked) - Math.abs(b.total - asked) || gap(a) - gap(b))[0];
  if (one) return { rows: [one], sum: one.total, sure: fits(one) };
  // In parts: rows of the same kind before the day, adding up to it.
  const parts = left.filter((t) => fits(t) && t.date <= dayShift(dueDay, 7) && t.total < asked);
  const sum = parts.reduce((n, t) => n + t.total, 0);
  return parts.length > 1 && close(sum) ? { rows: parts, sum, sure: true } : null;
}

/**
 * What is said about a paper whose day has passed, or one already in the
 * ledger: the payment found, or that none was, and what to do next. Nothing
 * is added either way: a payment found is not added twice, and one not found
 * may have been made outside the app.
 */
export function pastDueWords(doc: NotPaid, dueDay: IsoDate, found: PaidAlready | null, asOf: IsoDate): string {
  const amount = doc.amount !== null ? formatMoney(doc.amount) : "the amount";
  const day = formatMediumDay(dueDay);
  const row = (t: PaidRow): string => `#${String(t.recordNumber).padStart(4, "0")} on ${formatMediumDay(t.date)}, ${formatMoney(t.total)}${t.description.trim() ? ` ("${t.description.trim()}")` : ""}`;
  if (found) {
    const diff = found.sum - (doc.amount ?? found.sum);
    // A difference that is one of the other amounts it names is that amount, paid with it; any other is only said.
    const withPart = diff > 0 ? doc.parts.find((p) => p.startsWith(`${formatMoney(diff)} `) || p === formatMoney(diff)) : undefined;
    const off = diff === 0 ? "" : ` That is ${formatMoney(Math.abs(diff))} ${diff > 0 ? "more" : "less"} than it asks for${withPart ? `: the ${withPart.replace(/ also named$/, "").replace(/^₱[\d,.]+\s*/, "") || "other amount it names"}, paid with it` : ""}.`;
    const lead = found.sure ? "It looks paid already" : "It may be paid already";
    const what = found.rows.length === 1 ? `: ${row(found.rows[0]!)}.` : `, in ${found.rows.length} parts: ${found.rows.map(row).join("; ")}, ${formatMoney(found.sum)} in all.`;
    const check = found.sure ? "" : " Only the amount matches, so check it is the same payment.";
    return `${lead}${what}${off}${check} Nothing is added, so it is not counted twice. If that entry was something else and this is still owed, say "plan it" with a day.`;
  }
  if (dueDay >= asOf) return "";
  return `Its day to pay, ${day}, has passed, and I found no payment near ${amount} between ${formatMediumDay(dayShift(dueDay, -60))} and ${formatMediumDay(dayShift(dueDay, 30))}. If you paid it, say how and when ("paid it from cash on feb 20") and I will make the card; if it is still owed, say "plan it" with a new day.`;
}
