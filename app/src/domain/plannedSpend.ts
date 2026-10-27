/**
 * Money the owner says is going to go out: "9k in tuition pending", "I plan
 * to spend 3000 on a trip", "rent of 4,500 due", "I need to pay 2k for the
 * repair".
 *
 * The owner, 26 October 2026: "If I have 9k in tuition pending how much do i
 * need including my budget to survive next month? Do some calculations". The
 * 9k was read as income ("the PHP 9,000.00 you expect"), and the budget was
 * cut down to it. A sum beside a thing that costs money, or beside "pending",
 * "due" or "to pay", is spending that is coming: it goes on top of the usual
 * month and is never cut, and it is never read as money coming in.
 */
import { notTheMonth } from "./budgetAsk";
import { withoutYears, type Centavos } from "./money";
import { withoutModelNumbers } from "./modelNumbers";
import type { IsoDate } from "./types";

export interface PlannedSpend {
  /** What it is for, as said: "Tuition", "Trip". "Planned spending" when not said. */
  readonly name: string;
  readonly amount: Centavos;
}

/**
 * Things that cost money, in the owner's words (English and Tagalog). Not
 * "bills" or "fees" alone: "set spending to 12000 and bills to 2000" is a
 * budget's own parts.
 */
const COSTS =
  /\b(tuition|school\s+fees?|enrol+ment|miscellaneous\s+fees?|matriculation|rent|upa|trip|travel|vacation|outing|birthday|gift|regalo|wedding|repairs?|phone|laptop|gadget|medical|hospital|dentist|check-?up|medicine|gamot|insurance|debt|loan|utang|emergency|christmas|pasko|party|project|books?|uniform|concert|tickets?|groceries|grocery|downpayment|down\s+payment|deposit|registration|graduation|thesis|review(?:er|\s+center)?|exam|board\s+exam|license|renewal)\b/i;

/** Said to be still to pay. */
const COMING =
  /\b(pending|due|to\s+pay|unpaid|upcoming|coming\s+up|coming|outstanding|babayaran|bayarin|i\s+(?:have|need|will\s+have)\s+to\s+pay|i\s+(?:will|'ll|am\s+going\s+to|'m\s+going\s+to|gonna|plan\s+to|need\s+to)\s+(?:pay|spend|buy)|plan(?:ning)?\s+to\s+(?:spend|pay|buy)|will\s+(?:spend|pay)|going\s+to\s+(?:spend|pay))\b/i;

/** The sum is money in, kept, or a budget's own figure, not a cost. */
const NOT_A_COST =
  /\b(allowance|salary|sahod|income|kita|revenue|earn\w*|receiv\w*|expect\w*\s+(?:to\s+)?(?:get|receive)|save|saving|savings|ipon|set\s+aside|keep|budget\s+(?:of|is|to|at)|set\s+(?:it|my\s+budget|the\s+budget|\w+)\s+to|limit)\b/i;

const NUM = /(?:₱|php\s*)?(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)\s*(k)?\b/gi;

const title = (word: string): string => word.trim().replace(/\s+/g, " ").replace(/^./, (c) => c.toUpperCase());

/**
 * Each sum said to be going out, with what it is for. A sum is a cost when a
 * thing that costs money is within a few words of it and no word for income,
 * saving or a budget's own figure is beside it; or when it is said to be
 * pending, due or to be paid.
 */
export function plannedSpendIn(said: string): PlannedSpend[] {
  // Only a year where it is one ("November 2026", "in 2027"): "spend 2000" is two thousand pesos.
  // Nor a model number: "rtx 4060" is a graphics card, not PHP 4,060.00 (`modelNumbers.ts`).
  const text = withoutModelNumbers(withoutYears(said));
  const found: PlannedSpend[] = [];
  for (const m of text.matchAll(NUM)) {
    const raw = m[1]?.replace(/,/g, "");
    if (!raw || m.index === undefined) continue;
    const pesos = Number(raw) * (m[2] ? 1000 : 1);
    // A day of the month or a count is not a sum: "on the 15th", "3 months".
    if (!Number.isFinite(pesos) || pesos < 100) continue;
    const at = m.index;
    const end = at + m[0].length;
    if (/^\s*(?:st|nd|rd|th|days?|weeks?|months?|years?|%|percent|times?|x)\b/i.test(text.slice(end, end + 10))) continue;
    // The words just before and after the sum: the clause it sits in.
    const before = text.slice(Math.max(0, at - 40), at).split(/[.?!;]|\b(?:and|but|then|also)\b/i).pop() ?? "";
    const after = text.slice(end, end + 45).split(/[.?!;]|\b(?:and|but|then|also|how|what|can|is it)\b/i)[0] ?? "";
    const near = `${before} ${after}`;
    if (NOT_A_COST.test(near)) continue;
    const cost = COSTS.exec(after) ?? COSTS.exec(before);
    const coming = COMING.test(near);
    if (!cost && !coming) continue;
    const amount = Math.round(pesos * 100);
    found.push({ name: cost?.[1] ? title(cost[1]) : "Planned spending", amount });
  }
  // The same sum said twice is one thing.
  return found.filter((p, i) => found.findIndex((q) => q.amount === p.amount && q.name === p.name) === i);
}

/** The words with the planned sums taken out, so nothing else reads them as income. */
export function withoutPlannedSpend(said: string): string {
  const planned = plannedSpendIn(said);
  if (planned.length === 0) return said;
  let out = said;
  for (const m of said.matchAll(NUM)) {
    const raw = m[1]?.replace(/,/g, "");
    if (!raw || m.index === undefined) continue;
    const amount = Math.round(Number(raw) * (m[2] ? 1000 : 1) * 100);
    if (planned.some((p) => p.amount === amount)) out = `${out.slice(0, m.index)}${" ".repeat(m[0].length)}${out.slice(m.index + m[0].length)}`;
  }
  return out;
}

/**
 * "How much do I need to survive next month?", "is my money enough for
 * November?", "how much will I need next month with the tuition?": what a
 * month will take, against what will be there. Not a savings target
 * (`goalAsk.ts`) and not what is owed (`debtAsk.ts`).
 */
export function asksWhatItNeeds(said: string): boolean {
  const t = said.toLowerCase();
  if (/\b(?:save|saving|ipon|owe|utang ko)\b/.test(t)) return false;
  const month = /\b(?:next\s+month|this\s+month|the\s+month|january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec)\b/.test(t);
  const need =
    /\bhow\s+much\b[^?.!]{0,40}\b(?:do\s+i|will\s+i|would\s+i|i|should\s+i)\s+need\b/.test(t) ||
    /\b(?:survive|get\s+by|make\s+it\s+through|last\s+(?:the|until|till)|kakailanganin|kailangan\s+ko)\b/.test(t) ||
    /\b(?:is|will|would)\b[^?.!]{0,30}\b(?:money|it|that|wallets?)\b[^?.!]{0,20}\b(?:be\s+)?enough\b/.test(t) ||
    /\benough\s+(?:money\s+)?for\s+(?:next\s+month|the\s+month|[a-z]+\s+month)\b/.test(t);
  return need && (month || /\b(?:survive|get\s+by|budget)\b/.test(t));
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * The first month ahead a sentence names: "next month", or a month by name
 * that is still to come ("November 5", "in december"), a month already past
 * this year being next year's. Null when it names none, or only this month.
 * "I will spend 2000 for my birthday on November 5" is about November, and
 * was read as being about no month at all (26 October 2026).
 */
export function aheadMonthIn(said: string, asOf: IsoDate): { readonly year: number; readonly month: number } | null {
  const year = Number(asOf.slice(0, 4));
  const now = Number(asOf.slice(5, 7));
  if (/\bnext\s+month\b|\bsusunod\s+na\s+buwan\b/i.test(said)) return now === 12 ? { year: year + 1, month: 1 } : { year, month: now + 1 };
  const text = notTheMonth(said).toLowerCase();
  for (const m of text.matchAll(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b(?:\s+(20\d{2}))?/g)) {
    const month = MONTHS.indexOf((m[1] ?? "").slice(0, 3)) + 1;
    if (month <= 0) continue;
    const y = m[2] ? Number(m[2]) : month < now ? year + 1 : year;
    if (y * 12 + month > year * 12 + now) return { year: y, month };
  }
  return null;
}
