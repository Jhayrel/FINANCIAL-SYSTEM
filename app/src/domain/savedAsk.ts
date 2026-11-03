/**
 * "What did I save this month?", "how much did I put in savings last
 * month?", "magkano naipon ko this year": money moved into the savings
 * accounts in a period, by account, less what was taken back out, with
 * interest and income paid straight into savings said apart.
 *
 * With the AI off it got the month's summary instead (3 November 2026
 * replay): the answer was in the ledger all along.
 */
import { formatMedium, lastOfMonth, MONTH_NAMES } from "./dates";
import { formatMoney, type Centavos } from "./money";
import type { IsoDate, Transaction } from "./types";

export interface SavedAsk {
  readonly from: IsoDate;
  readonly to: IsoDate;
  readonly name: string;
}

const ASKS = /\b(?:what|how\s+much|magkano)\b[^?.!]{0,40}\b(?:did\s+i\s+|have\s+i\s+|i\s+|ko\s+)?(?:save|saved|saving|savings|ipon|naipon|deposit(?:ed)?|put\s+(?:in|into)\s+(?:my\s+)?savings?)\b/i;

export function readSavedAsk(text: string, asOf: IsoDate): SavedAsk | null {
  const t = text.trim();
  if (!ASKS.test(t) || /\b(?:plan|goal|need|should|to\s+save|can\s+i|will|for\s+a)\b/i.test(t) || /\d{3,}/.test(t.replace(/\b20\d{2}\b/g, ""))) return null;
  const y = Number(asOf.slice(0, 4));
  const mo = Number(asOf.slice(5, 7));
  const month = (yy: number, mm: number): SavedAsk => ({ from: `${yy}-${String(mm).padStart(2, "0")}-01`, to: lastOfMonth(yy, mm), name: `${MONTH_NAMES[mm - 1]} ${yy}` });
  if (/\blast\s+month\b/i.test(t)) return mo === 1 ? month(y - 1, 12) : month(y, mo - 1);
  if (/\b(?:this|the)\s+year\b|\bso\s+far\s+this\s+year\b|\bytd\b/i.test(t)) return { from: `${y}-01-01`, to: asOf, name: `${y} so far` };
  if (/\blast\s+year\b/i.test(t)) return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31`, name: String(y - 1) };
  return { ...month(y, mo), to: asOf, name: `${MONTH_NAMES[mo - 1]} ${y} so far` };
}

/** The answer, from the ledger: transfers into savings less out of them, and what landed there on its own. */
export function savedAnswer(ask: SavedAsk, transactions: readonly Transaction[], wallets: readonly string[], savings: readonly string[]): string {
  const spend = new Set(wallets);
  const save = new Set(savings);
  const inPeriod = transactions.filter((t) => t.date >= ask.from && t.date <= ask.to);
  const into = new Map<string, Centavos>();
  let moved = 0;
  let back = 0;
  let grew = 0;
  const numbers: string[] = [];
  for (const t of inPeriod) {
    if (t.type === "Transfer" && !save.has(t.fromWallet) && save.has(t.toWallet)) {
      moved += t.amount;
      into.set(t.toWallet, (into.get(t.toWallet) ?? 0) + t.amount);
      numbers.push(`#${String(t.recordNumber).padStart(4, "0")}`);
    } else if (t.type === "Transfer" && save.has(t.fromWallet) && spend.has(t.toWallet)) {
      back += t.amount;
    } else if (t.type === "Revenue" && save.has(t.toWallet)) {
      grew += t.amount;
    }
  }
  const net = moved - back;
  const where = [...into.entries()].sort((a, b) => b[1] - a[1]).map(([a, c]) => `${formatMoney(c)} into ${a}`);
  const lead =
    moved === 0
      ? `Nothing was moved into savings in ${ask.name}.`
      : `In ${ask.name} you moved ${formatMoney(moved)} into savings: ${where.join(", ")}${numbers.length <= 4 ? ` (${numbers.join(", ")})` : ""}.`;
  const out = back > 0 ? ` ${formatMoney(back)} was taken back out to your wallets, so savings grew by ${formatMoney(net)} from what you moved.` : moved > 0 ? " Nothing was taken back out." : "";
  const extra = grew > 0 ? ` On top of that, ${formatMoney(grew)} came straight into savings (interest and the like).` : "";
  const when = ask.to < ask.from ? "" : ` Counted from ${formatMedium(ask.from)} to ${formatMedium(ask.to)}.`;
  return `${lead}${out}${extra}${when}`;
}
