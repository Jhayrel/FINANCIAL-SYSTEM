/**
 * "I want to save 5000 by December", "how long to save 10k?", "how much a
 * day to save 3000 by November 30?", answered by the app.
 *
 * The owner, 26 October 2026: "I want it to do more". A savings target is a
 * sum and a date, and both are arithmetic the model must not do: the amount
 * a day, a week and a month to the date, and whether the owner's own recent
 * months, what came in less what went out (the Dashboard's "Kept so far"),
 * have kept that much. Without a date, how long it takes at that pace.
 */
import { addDays, daysBetween, formatMedium, MONTH_NAMES } from "./dates";
import { monthBrief } from "./monthPlan";
import { parseAmount, withoutYears, type Centavos } from "./money";
import type { Debt } from "./debt";
import type { Budgets, IsoDate, ReferenceLists, Transaction } from "./types";

export interface GoalAsk {
  readonly target: Centavos;
  /** The last day to have it by, or null for "how long". */
  readonly by: IsoDate | null;
  /** What it is for, when said ("for christmas"). */
  readonly purpose: string;
}

const SAVE = /\b(?:save|saving|ipon|mag-?ipon|set aside|put aside|keep aside)\b/i;

const MONTH_INDEX: Readonly<Record<string, number>> = Object.fromEntries(
  MONTH_NAMES.flatMap((m, i) => [[m.toLowerCase(), i + 1], [m.toLowerCase().slice(0, 3), i + 1]]),
);

const lastDayOf = (y: number, m: number): IsoDate => `${y}-${String(m).padStart(2, "0")}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;

/** The target and the date, or null when this is not a savings goal with a figure. */
export function readGoalAsk(text: string, asOf: IsoDate): GoalAsk | null {
  const t = text.trim();
  if (!SAVE.test(t)) return null;
  // Asking about what was saved already, or a budget, is another question.
  if (/\b(?:how much (?:did|have) i (?:save|saved)|budget|limit|interest)\b/i.test(t)) return null;
  const figure = /(?:₱|php\s*)?(\d[\d,]*(?:\.\d{1,2})?)\s*(k)?\b(?!\s*(?:days?|weeks?|months?|years?|%))/i.exec(withoutYears(t));
  if (!figure?.[1]) return null;
  const base = parseAmount(figure[1]);
  if (base === null || base <= 0) return null;
  const target = figure[2] ? base * 1000 : base;

  const y = Number(asOf.slice(0, 4));
  const m = Number(asOf.slice(5, 7));
  let by: IsoDate | null = null;
  const inSpan = /\b(?:in|within|for the next|over)\s+(\d{1,2}|a|an|one|two|three|four|five|six)\s+(days?|weeks?|months?)\b/i.exec(t);
  const named = /\b(?:by|until|before|on|this|for)\s+(?:the\s+end\s+of\s+)?(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\.?(?:\s+(\d{1,2})(?:st|nd|rd|th)?)?(?:,?\s+(20\d{2}))?\b/i.exec(t);
  if (inSpan) {
    const words: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
    const n = /^\d+$/.test(inSpan[1] ?? "") ? Number(inSpan[1]) : (words[(inSpan[1] ?? "").toLowerCase()] ?? 1);
    const unit = (inSpan[2] ?? "").toLowerCase();
    by = unit.startsWith("day") ? addDays(asOf, n) : unit.startsWith("week") ? addDays(asOf, n * 7) : (() => {
      const at = new Date(`${asOf}T00:00:00Z`);
      at.setUTCMonth(at.getUTCMonth() + n);
      return at.toISOString().slice(0, 10);
    })();
  } else if (named) {
    const mm = MONTH_INDEX[(named[1] ?? "").toLowerCase().slice(0, 3)] ?? 0;
    let yy = named[3] ? Number(named[3]) : y;
    if (!named[3] && mm < m) yy += 1;
    by = named[2] ? `${yy}-${String(mm).padStart(2, "0")}-${String(Math.min(Number(named[2]), 31)).padStart(2, "0")}` : lastDayOf(yy, mm);
    if (by <= asOf) by = named[3] ? by : lastDayOf(yy + 1, mm);
  } else if (/\bchristmas\b/i.test(t)) {
    by = `${m === 12 && asOf > `${y}-12-25` ? y + 1 : y}-12-25`;
  }
  const purpose = /\bfor\s+(?:a\s+|an\s+|my\s+|the\s+)?([a-z][a-z ]{2,30}?)(?=\s+(?:by|until|before|in|within)\b|[?.!,]|$)/i.exec(t)?.[1]?.trim() ?? "";
  return { target, by, purpose: /^(?:the\s+)?(?:next|end)\b/i.test(purpose) ? "" : purpose };
}

export function goalAnswer(
  ask: GoalAsk,
  input: {
    readonly transactions: readonly Transaction[];
    readonly reference: ReferenceLists;
    readonly budgets: Budgets;
    readonly debts: readonly Debt[];
    readonly asOf: IsoDate;
  },
  money: (c: Centavos) => string,
): string {
  const { asOf } = input;
  const y = Number(asOf.slice(0, 4));
  const m = Number(asOf.slice(5, 7));

  // What the last three whole months kept: came in less went out, as the Dashboard counts it.
  const months = [1, 2, 3].map((back) => {
    const at = y * 12 + (m - 1) - back;
    const yy = Math.floor(at / 12);
    const mm = (at % 12) + 1;
    const b = monthBrief({ ...input, year: yy, month: mm });
    return { name: `${MONTH_NAMES[mm - 1] ?? ""} ${yy}`, kept: b.kept, cameIn: b.cameIn, wentOut: b.wentOut };
  });
  const kept = Math.floor(months.reduce((s, x) => s + x.kept, 0) / months.length);
  const span = `${months[2]?.name ?? ""} to ${months[0]?.name ?? ""}`;
  const pace = kept > 0 ? `Your last three months (${span}) kept ${money(kept)} a month on average, what came in less what went out.` : `Your last three months (${span}) spent ${money(-kept)} a month more than came in, on average.`;
  const now = monthBrief({ ...input, year: y, month: m }).safe;
  const what = `${money(ask.target)}${ask.purpose ? ` for ${ask.purpose}` : ""}`;

  if (ask.by) {
    const days = Math.max(1, daysBetween(asOf, ask.by));
    const perDay = Math.ceil(ask.target / days);
    const perMonth = Math.ceil((ask.target * 30) / days);
    const lines = [
      `**To have ${what} by ${formatMedium(ask.by)}: ${money(perDay)} a day** for ${days} days, about ${money(perDay * 7)} a week or ${money(perMonth)} a month.`,
      pace,
      kept >= perMonth
        ? `At that pace it fits, with ${money(kept - perMonth)} a month to spare.`
        : `That is ${money(perMonth - Math.max(0, kept))} a month more than you have been keeping, so something has to give: less spending, or more coming in.`,
    ];
    if (now) {
      lines.push(
        now.perDay >= perDay
          ? `Putting ${money(perDay)} aside today leaves ${money(now.perDay - perDay)} of today's ${money(now.perDay)} safe to spend.`
          : `Today's safe to spend is ${money(now.perDay)}, less than ${money(perDay)}, so until money comes in it cannot come out of this month's spending money.`,
      );
    }
    lines.push("To follow it on the Dashboard, add it as a goal under Settings, Accounts.");
    return lines.join("\n");
  }

  if (kept <= 0) {
    return [pace, `At that pace ${what} is not reached. Putting ${money(Math.ceil(ask.target / 90))} aside a day gets there in about three months.`].join("\n");
  }
  const monthsNeeded = Math.ceil(ask.target / kept);
  const at = new Date(`${asOf}T00:00:00Z`);
  at.setUTCMonth(at.getUTCMonth() + monthsNeeded);
  return [
    `**About ${monthsNeeded} ${monthsNeeded === 1 ? "month" : "months"}** to save ${what} at your recent pace, by ${MONTH_NAMES[at.getUTCMonth()] ?? ""} ${at.getUTCFullYear()}.`,
    pace,
    "Say a date (\"by December\") and I will work out what it takes a day.",
  ].join("\n");
}
