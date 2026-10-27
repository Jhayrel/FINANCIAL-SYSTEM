/**
 * "Am I spending too much on food?", answered from the ledger.
 *
 * A judgement, so it says what it is measured against (alerts.ts: "You are
 * spending too much" is not an answer on its own): this month so far beside
 * the same days of the three months before, and the kind's limit when one is
 * set. The same per-row cost the Insights screen adds up (`totals.ts`).
 *
 * The owner, 27 October 2026: "make sure it knows if its plan, questions
 * etc". This one went to the model, and with the AI off got the month's
 * summary in place of an answer.
 */
import { formatMedium, MONTH_NAMES } from "./dates";
import { formatMoney, type Centavos } from "./money";
import { costOf } from "./totals";
import type { IsoDate, Transaction } from "./types";

const ASKS =
  /\b(?:am\s+i|are\s+we|have\s+i\s+been|do\s+i|did\s+i)\s+(?:spending|spend|using|paying|spent)\s+(?:too\s+much|a\s+lot|so\s+much|more\s+than\s+(?:usual|normal|before|i\s+should))|\bam\s+i\s+over\s*-?\s*spending\b|\b(?:is|was)\s+my\s+(?:[a-z]+\s+){0,2}(?:spending|expenses?|gastos)\s+(?:too\s+(?:much|high)|high|ok(?:ay)?|normal|bad)\b|\b(?:sobra|masyado)\s+(?:na\s+)?(?:ba\s+)?(?:ang\s+)?(?:gastos|paggastos|gumagastos|magastos)\b|\bmasyado\s+(?:ba\s+)?(?:akong\s+)?(?:gumagastos|magastos)\b/i;

export interface PaceAsk {
  /** The kind, as the ledger names it; null for all spending. */
  readonly item: string | null;
}

/** The question, or null when it is not one. `items` is every kind of spending the ledger uses. */
export function readPaceAsk(text: string, items: readonly string[]): PaceAsk | null {
  if (!ASKS.test(text)) return null;
  const lower = text.toLowerCase();
  const item =
    [...items]
      .filter((n) => n.trim().length > 2)
      .sort((a, b) => b.length - a.length)
      .find((n) => new RegExp(`\\b${n.trim().toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?\\b`).test(lower)) ?? null;
  return { item };
}

const lastDay = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();
const iso = (y: number, m: number, d: number): IsoDate => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** The answer: this month to today against the same days of the three months before, and the limit. */
export function paceAnswer(ask: PaceAsk, transactions: readonly Transaction[], asOf: IsoDate, limit: Centavos | null = null): string {
  const y = Number(asOf.slice(0, 4));
  const m = Number(asOf.slice(5, 7));
  const day = Number(asOf.slice(8, 10));
  const matches = (t: Transaction): boolean => ask.item === null || t.item.trim().toLowerCase() === ask.item.trim().toLowerCase();
  const live = transactions.filter((t) => !(t as Transaction & { deletedAt?: string }).deletedAt && matches(t) && costOf(t) > 0);
  const sum = (from: IsoDate, to: IsoDate): Centavos => live.filter((t) => t.date >= from && t.date <= to).reduce((s, t) => s + costOf(t), 0);
  const money = (c: Centavos): string => formatMoney(c);

  const now = sum(iso(y, m, 1), asOf);
  const before = [1, 2, 3].map((back) => {
    const k = y * 12 + (m - 1) - back;
    const yy = Math.floor(k / 12);
    const mm = (k % 12) + 1;
    return { name: MONTH_NAMES[mm - 1] ?? "", spent: sum(iso(yy, mm, 1), iso(yy, mm, Math.min(day, lastDay(yy, mm)))) };
  });
  const usual = Math.round(before.reduce((s, b) => s + b.spent, 0) / before.length);
  const what = ask.item ? ask.item : "spending";
  const by = `by ${formatMedium(asOf).replace(/, \d{4}$/, "")}`;
  const months = `${before[2]!.name}, ${before[1]!.name} and ${before[0]!.name}`;

  let verdict: string;
  if (usual === 0) verdict = now === 0 ? `Nothing on ${what} this month, and nothing in the same days of ${months}.` : `${money(now)} on ${what} this month so far, and nothing in the same days of ${months}, so there is no usual to measure it against.`;
  else {
    const ratio = now / usual;
    const lead = ratio > 1.25 ? "Yes, more than usual" : ratio < 0.8 ? "No, less than usual" : "About as usual";
    const diff = now - usual;
    verdict = `${lead}: ${money(now)} on ${what} ${by}, against ${money(usual)} on average ${by} in ${months}${Math.abs(diff) >= 100 && lead !== "About as usual" ? ` (${money(Math.abs(diff))} ${diff > 0 ? "more" : "less"})` : ""}.`;
  }
  const lines = [verdict, `Each month ${by}: ${before.map((b) => `${b.name} ${money(b.spent)}`).reverse().join(", ")}.`];
  if (limit !== null && limit > 0) {
    lines.push(now > limit ? `It is over its ${MONTH_NAMES[m - 1]} limit of ${money(limit)} by ${money(now - limit)}.` : `Its ${MONTH_NAMES[m - 1]} limit is ${money(limit)}: ${money(limit - now)} left.`);
  }
  return lines.join(" ");
}
