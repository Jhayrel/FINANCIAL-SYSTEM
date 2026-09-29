/**
 * A card terminal's slip, read and checked on the device.
 *
 * ── The slip this exists for ───────────────────────────────────────────────
 *
 * 29 September 2026: a Maya Business terminal's customer copy from Mang
 * Inasal, "PAYMENT CHANNEL Credit Card", "APP. LABEL Visa Credit", "AMOUNT
 * ₱2,082.00", "APPR. CODE 654321", sent with the restaurant's own receipt,
 * which prints the same ₱2,082.00 and the same approval code.
 *
 * A slip is proof of one card payment at one merchant. Three things on it
 * read as though they say more than they do, and none of them is kept:
 *
 *   - "Credit Card", "Visa Credit" and "I promise to pay" are printed for
 *     nearly every Visa or Mastercard, debit and prepaid included.
 *   - "maya" across the top is the company whose terminal it is, not the
 *     card, and not the owner's Maya Credit line.
 *   - The terminal's own numbers (merchant, terminal, batch, trace, ref)
 *     are not money.
 *
 * Which of the owner's accounts paid is their own history's answer
 * (`cardAccount`). A slip and a shop receipt of the same payment are one
 * entry (`samePayment`).
 */

import type { Centavos } from "./money";
import type { IsoDate, Transaction } from "./types";

export interface CardSlip {
  readonly amount: Centavos;
  /** The merchant as printed at the top ("MANG INASAL MI3523"). */
  readonly merchant: string;
  readonly date?: IsoDate;
  readonly time?: string;
  /** The approval code, which the shop's receipt prints too. */
  readonly approval?: string;
  /** The card's last four digits, when they could be read. */
  readonly last4?: string;
  readonly network?: string;
  /** A refund or a void rather than a sale. */
  readonly kind: "sale" | "refund" | "void";
}

const figuresOn = (line: string): Centavos[] =>
  [...line.matchAll(/(?<![\d.])(?:[₱#P]|php)?\s?(\d{1,3}(?:,\d{3})+|\d+)\.(\d{2})(?!\d)/gi)].map(
    (m) => Number((m[1] ?? "0").replace(/,/g, "")) * 100 + Number(m[2] ?? "0"),
  );

/** "654321" from "APPR. CODE654321", "ApprCode: 654321", "AUTH CODE 1A2B3C". An O read for a zero is put back. */
export function approvalIn(text: string): string | undefined {
  // The first letter is the one a camera loses: "ppprCode: 654321" is ApprCode (29 September 2026).
  const m = /\b(?:[a-z]?p{1,3}r(?:oval)?\.?\s*(?:code|no)|auth(?:orization)?\.?\s*(?:code|no))\s*[:#.]?\s*([A-Z0-9]{6})\b/i.exec(text);
  return m?.[1]?.toUpperCase().replace(/O/g, "0");
}

function dateIn(text: string): { date?: IsoDate; time?: string } {
  const pad = (n: number): string => String(n).padStart(2, "0");
  const ymd = /\b(20\d{2})[/-](\d{1,2})[/-](\d{1,2})\b/.exec(text);
  const mdy = /\b(\d{1,2})\/(\d{1,2})\/(20\d{2}|\d{2})\b/.exec(text);
  const date = ymd
    ? `${ymd[1]}-${pad(Number(ymd[2]))}-${pad(Number(ymd[3]))}`
    : mdy
      ? `${(mdy[3] ?? "").length === 2 ? `20${mdy[3]}` : mdy[3]}-${pad(Number(mdy[1]))}-${pad(Number(mdy[2]))}`
      : undefined;
  // "19:16:47", "19 16:47" with a colon lost, "191647" run together after the date, or "19:16".
  const clock =
    /\b(\d{2})[\s:](\d{2}):\d{2}\b/.exec(text) ??
    /\b20\d{2}[/-]\d{1,2}[/-]\d{1,2}\s+(\d{2})(\d{2})\d{2}\b/.exec(text) ??
    /\b(\d{1,2}):(\d{2})\b/.exec(text);
  const time = clock ? `${pad(Number(clock[1]))}:${clock[2]}` : undefined;
  return { ...(date ? { date } : {}), ...(time ? { time } : {}) };
}

/**
 * A card slip in what the device read off a picture, or null.
 *
 * Only a slip: an approval, a sale, the card's marks and one amount. A shop's
 * own receipt is read by `receipt.ts`, and an ATM slip by `withdrawal.ts`.
 */
export function readCardSlip(readings: readonly string[]): CardSlip | null {
  for (const text of readings) {
    if (!text.trim()) continue;
    const approved = /\bapproved\b|\bappr(?:oval)?\.?\s*code\b|\bauth(?:orization)?\.?\s*code\b/i.test(text);
    const card = /\bcard\s*(?:no|type|number)\b|\bterminal\s*id\b|\bmerchant\s*id\b|\b(?:tid|mid)\s*[:#]|\bpan\b|\baid\s*:/i.test(text);
    const sale = /\b(?:sale|purchase|refund|void)\b/i.test(text);
    if (!approved || !card || !sale) continue;
    if (/\bwithdraw/i.test(text)) continue;
    const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    const amountLine = lines.find((l) => /\b(?:amount|total|amt)\b/i.test(l) && figuresOn(l).length > 0);
    const amount = amountLine ? figuresOn(amountLine).pop() : undefined;
    if (amount === undefined || amount <= 0) continue;

    // The merchant: the first line with a name in it, above the terminal's own numbers.
    const stop = lines.findIndex((l) => /\bmerchant\b|\bterminal\b|\bcard\b/i.test(l));
    const head = lines.slice(0, stop > 0 ? stop : 3);
    const merchant = (head.find((l) => /[a-z]{3}/i.test(l) && !/^(?:maya|paymaya|bdo|bpi|gcash|metrobank)\b/i.test(l.trim()) && !/\bcity\b.*\b(?:union|manila|cebu)\b/i.test(l)) ?? "")
      .replace(/[^A-Za-z0-9 &.'-]/g, "")
      .trim();
    const last4 = /\b(?:card\s*no|pan)\b[^\n]*?(\d{4})\s*(?:\(|$)/im.exec(text)?.[1];
    const network = /\bvisa\b/i.test(text) ? "Visa" : /master\s?card/i.test(text) ? "Mastercard" : /\bjcb\b/i.test(text) ? "JCB" : /\bamex|american express/i.test(text) ? "Amex" : undefined;
    const kind = /\bvoid\b/i.test(text) ? "void" : /\brefund\b/i.test(text) ? "refund" : "sale";
    const approval = approvalIn(text);
    return {
      amount,
      merchant,
      ...dateIn(text),
      ...(approval ? { approval } : {}),
      ...(last4 ? { last4 } : {}),
      ...(network ? { network } : {}),
      kind,
    };
  }
  return null;
}

/**
 * Every slip among what was read, once each. A picture is read two ways and
 * one may catch the approval code the other garbled, so the two readings of
 * one slip are one slip, with what either of them found.
 */
export function cardSlipsIn(readings: readonly string[]): CardSlip[] {
  const out: CardSlip[] = [];
  for (const r of readings) {
    const s = readCardSlip([r]);
    if (!s) continue;
    // Not by date: one reading made 2026 into 2020. Two approval codes are two payments.
    const at = out.findIndex((o) => o.amount === s.amount && (!o.approval || !s.approval || o.approval === s.approval));
    if (at < 0) out.push(s);
    else {
      // The reading that caught the approval code is the fuller one, and wins; the other fills its gaps.
      const first = out[at]!;
      const [base, other] = s.approval && !first.approval ? [s, first] : [first, s];
      out[at] = { ...other, ...base };
    }
  }
  return out;
}

/**
 * Whether a slip and a shop's receipt are the same payment: the same
 * approval code, or the same amount on the same day within a quarter hour.
 */
export function samePayment(
  slip: CardSlip,
  receipt: { readonly total: Centavos; readonly date?: IsoDate; readonly time?: string; readonly approval?: string },
): boolean {
  if (slip.amount !== receipt.total) return false;
  if (slip.approval && receipt.approval) return slip.approval === receipt.approval;
  if (slip.date && receipt.date && slip.date !== receipt.date) return false;
  if (slip.time && receipt.time) {
    const mins = (t: string): number => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
    return Math.abs(mins(slip.time) - mins(receipt.time)) <= 15;
  }
  return Boolean(slip.date && receipt.date);
}

/**
 * The account the owner's card payments come out of, from their own ledger:
 * purchases filed the way a card or a store terminal shows them ("Purchase
 * at MCDO 878", "JOLLIBEE JB3829"), the most recent twenty. A purchase
 * filed as bought on a credit line counts for that line. Null when the
 * ledger does not say, and the card asks.
 */
export function cardAccount(
  transactions: readonly Transaction[],
  accounts: readonly string[],
): { readonly account: string; readonly line?: string; readonly count: number } | null {
  const looksLikeCard = (t: Transaction): boolean =>
    /\bpurchased?\s+at\b|\bpos\b|\bcard\b|\bvisa\b|\bmaster\s*card\b|\bswipe/i.test(`${t.description} ${t.notes}`) || /\b[A-Z]{1,3}\d{3,5}\b/.test(t.description);
  const recent = [...transactions]
    .filter((t) => !(t as Transaction & { deletedAt?: string }).deletedAt)
    .filter(
      (t) =>
        (looksLikeCard(t) && t.type === "Spending" && accounts.includes(t.fromWallet)) ||
        // Bought on a credit line: the borrowing row the purchase stands beside.
        (t.type === "Debt" && t.debtEffect === "draw" && /\bbought on credit\b|\bpurchased?\s+(?:via|on|with)\b/i.test(t.description)),
    )
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 20);
  const tally = new Map<string, number>();
  for (const t of recent) {
    const key = t.type === "Debt" ? `line:${t.debtId ?? ""}` : t.fromWallet;
    tally.set(key, (tally.get(key) ?? 0) + 1);
  }
  const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1]);
  const top = ranked[0];
  if (!top || (ranked[1] && ranked[1][1] * 2 > top[1])) return null;
  return top[0].startsWith("line:") ? { account: "", line: top[0].slice(5), count: top[1] } : { account: top[0], count: top[1] };
}

/** What the model is told, beside the text read off the slip. */
export function cardSlipNote(slip: CardSlip): string {
  const peso = (c: Centavos): string => `PHP ${Math.floor(c / 100).toLocaleString("en-US")}.${String(c % 100).padStart(2, "0")}`;
  return [
    `This is a card terminal's slip, checked on this device: one card ${slip.kind === "refund" ? "refund" : "payment"} of ${peso(slip.amount)}${slip.merchant ? ` at ${slip.merchant}` : ""}${slip.date ? ` on ${slip.date}` : ""}${slip.time ? ` at ${slip.time}` : ""}${slip.approval ? `, approval code ${slip.approval}` : ""}.`,
    `It is one proposal: flow Spending on what was bought there (a restaurant is Food unless they say it was a treat), amountPesos ${slip.amount / 100}, fromWallet empty: the app fills it from where their card payments come from.`,
    `"Credit Card", "Visa Credit" and "I promise to pay" are printed for nearly every card, and the terminal company's name at the top (Maya, BDO, BPI) is not the card: never a Debt and never a credit line because of them. If a shop receipt for the same amount${slip.approval ? " or the same approval code" : ""} is here too, it is the same payment: one proposal, not two.`,
  ].join(" ");
}
