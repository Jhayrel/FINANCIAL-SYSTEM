/**
 * "If I can only save [a sum] a month from December, which plan first, and
 * when am I done with all of them?": the plans named, put in order, and
 * paid month by month.
 *
 * ── Why ────────────────────────────────────────────────────────────────────
 *
 * The owner, 10 November 2026, in Taglish: "Tuition, motor repair, at
 * Groceries, wala pang date lahat. Kung [a sum] lang kaya kong itabi kada
 * buwan simula December, alin ang uunahin, at kailan ko matatapos lahat?
 * Huwag galawin ang savings." It was read as a plan to spend that sum a
 * month starting now, and the answer put Tuition first, Groceries three
 * months later (its note says it is for Christmas), and the end a month
 * late, with the total flagged as a figure the app had not worked out.
 *
 * So the device works it out: the order (a plan with a day first, by its
 * day, a day its own words give included, "for Christmas"; then needs
 * before wants; then the smaller first, so one is done sooner), and each
 * month's saving paid into the first plan not yet done, what is left of it
 * into the next. The day each is done, and the whole, follow from that.
 */
import { formatMedium } from "./dates";
import { formatMoney, type Centavos } from "./money";
import { NO_DATE, type Plan } from "./planner";
import type { IsoDate } from "./types";

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTH_NAMES = MONTHS.map((m) => m.charAt(0).toUpperCase() + m.slice(1));
const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|enero|pebrero|marso|abril|mayo|hunyo|hulyo|agosto|setyembre|oktubre|nobyembre|disyembre)";
const TAGALOG: Record<string, number> = { enero: 1, pebrero: 2, marso: 3, abril: 4, mayo: 5, hunyo: 6, hulyo: 7, agosto: 8, setyembre: 9, oktubre: 10, nobyembre: 11, disyembre: 12 };

/** By the month: "a month", "kada buwan", "monthly". */
const MONTHLY = /\b(?:a|per|each|every|kada|bawat)\s+(?:month|buwan)\b|\bmonthly\b|\bbuwan-?buwan\b/i;
/** Asking the order, or when it is all done. */
const ORDER =
  /\b(?:which\s+(?:one\s+|plan\s+)?first|what\s+first|(?:u?u)?unahin|priorit\w*|in\s+what\s+order|order|when\s+(?:will|can|would|do)\s+i\s+(?:finish|be\s+done|complete|have|pay)|kailan\s+(?:ko\s+)?(?:matatapos|mababayaran|mabayaran|makukumpleto)|matatapos|how\s+long|ilang\s+buwan)\b/i;

/** Words of a plan's title that are its own: "repair" in "Motorcycle setup and repair", not "and". */
const GENERIC = /^(?:plan|plans|setup|and|for|the|buy|pay|new|my|with|from|into|money|fund)$/;

/** Every open plan the message names, by its title or a word of it. */
export function plansNamedAll(text: string, plans: readonly Plan[]): Plan[] {
  const lower = text.toLowerCase();
  const words = lower.split(/[^a-z0-9]+/).filter(Boolean);
  const oneOff = (a: string, b: string): boolean => {
    if (a.length < 5 || b.length < 5 || Math.abs(a.length - b.length) > 1) return false;
    if (a.length === b.length) {
      const diff = [...a].map((c, i) => (c !== b[i] ? i : -1)).filter((i) => i >= 0);
      return diff.length === 1 || (diff.length === 2 && diff[1] === (diff[0] ?? -2) + 1 && a[diff[0] ?? 0] === b[diff[1] ?? 0] && a[diff[1] ?? 0] === b[diff[0] ?? 0]);
    }
    const [s, l] = a.length < b.length ? [a, b] : [b, a];
    for (let i = 0; i < l.length; i += 1) if (l.slice(0, i) + l.slice(i + 1) === s) return true;
    return false;
  };
  return plans.filter((p) => {
    if (p.status !== "open") return false;
    const title = p.title.trim().toLowerCase();
    if (title && lower.includes(title)) return true;
    const own = title.split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !GENERIC.test(w));
    return own.some((w) => words.some((x) => x === w || x === `${w}s` || oneOff(x, w)));
  });
}

/** The amount saved each month, never a day or a year. */
function perMonthSaid(text: string): Centavos | null {
  for (const m of text.matchAll(/(?:₱|php\s*)?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/gi)) {
    const whole = Number((m[1] ?? "").replace(/,/g, ""));
    if (whole < 100 || (whole >= 1900 && whole <= 2100 && !/[₱,]|php/i.test(m[0]))) continue;
    return whole * 100 + Number((m[2] ?? "").padEnd(2, "0") || 0);
  }
  return null;
}

const monthIndex = (name: string): number => TAGALOG[name] ?? MONTHS.findIndex((m) => m.startsWith(name.slice(0, 3))) + 1;

/** The month the saving starts: "simula December", "starting January", else next month. */
function startSaid(text: string, asOf: IsoDate): { readonly year: number; readonly month: number } {
  const y = Number(asOf.slice(0, 4));
  const now = Number(asOf.slice(5, 7));
  const m = new RegExp(`\\b(?:simula|starting(?:\\s+in)?|start(?:ing)?\\s+(?:in\\s+)?|from|beginning|mula)\\s+(?:sa\\s+)?(?:this\\s+|next\\s+)?${MONTH_RE}\\b`, "i").exec(text);
  if (m?.[1]) {
    const month = monthIndex(m[1].toLowerCase());
    return { year: month < now ? y + 1 : y, month };
  }
  if (/\b(?:this\s+month|ngayong\s+buwan|now|ngayon)\b/i.test(text)) return { year: y, month: now };
  return now === 12 ? { year: y + 1, month: 1 } : { year: y, month: now + 1 };
}

export interface ScheduleAsk {
  readonly plans: readonly Plan[];
  readonly perMonth: Centavos;
  readonly start: { readonly year: number; readonly month: number };
  readonly keepSavings: boolean;
}

/** Two or more plans, a saving by the month, and the order or the end asked. */
export function readScheduleAsk(text: string, plans: readonly Plan[], asOf: IsoDate): ScheduleAsk | null {
  if (!MONTHLY.test(text) || !ORDER.test(text)) return null;
  const named = plansNamedAll(text, plans);
  if (named.length < 2) return null;
  const perMonth = perMonthSaid(text);
  if (perMonth === null) return null;
  const keepSavings = /\b(?:without|not|never|no|huwag|wag)\s+(?:touching|using|touch|use|galawin|gamitin|galaw)\b[^.?!]{0,30}\bsavings?\b|\b(?:huwag|wag)\s+(?:galawin|gamitin)\s+(?:ang\s+)?(?:aking\s+|ko\s+)?savings?\b/i.test(text);
  return { plans: named, perMonth, start: startSaid(text, asOf), keepSavings };
}

/** A day the plan's own words give: "for Christmas" is the 24th of December. */
function dayInWords(p: Plan, asOf: IsoDate): IsoDate | null {
  const words = `${p.title} ${p.notes}`.toLowerCase();
  const y = Number(asOf.slice(0, 4));
  if (/\b(?:christmas|xmas|pasko|noche\s+buena)\b/.test(words)) return asOf > `${y}-12-24` ? `${y + 1}-12-24` : `${y}-12-24`;
  if (/\b(?:new\s+year|bagong\s+taon|media\s+noche)\b/.test(words)) return asOf > `${y}-12-31` ? `${y + 1}-12-31` : `${y}-12-31`;
  return null;
}

export interface ScheduledPlan {
  readonly plan: Plan;
  readonly left: Centavos;
  /** Its own day, or one its words give, and which. */
  readonly by: IsoDate | null;
  readonly byWords: boolean;
  /** The month it is done in, "YYYY-MM", and what that month's saving had to spare after it. */
  readonly doneIn: string;
  readonly spare: Centavos;
  /** The months whose saving went into it, first and last. */
  readonly from: string;
  /** Done in a month after its day. */
  readonly late: boolean;
}

export interface Schedule {
  readonly ask: ScheduleAsk;
  readonly total: Centavos;
  readonly order: readonly ScheduledPlan[];
  readonly months: number;
  readonly endsIn: string;
}

const ym = (year: number, month: number): string => `${year}-${String(month).padStart(2, "0")}`;
const nameOf = (key: string): string => `${MONTH_NAMES[Number(key.slice(5, 7)) - 1] ?? ""} ${key.slice(0, 4)}`;

/**
 * The plans in order and paid month by month. `left` is what each still
 * needs (`viewOf(...).left`), by plan id.
 */
export function schedulePlans(ask: ScheduleAsk, left: ReadonlyMap<string, Centavos>, asOf: IsoDate): Schedule {
  const rows = ask.plans.map((p) => {
    const own = p.due !== NO_DATE ? p.due : null;
    const words = own ? null : dayInWords(p, asOf);
    return { plan: p, left: Math.max(0, left.get(p.id) ?? p.amount), by: own ?? words, byWords: own === null && words !== null };
  });
  rows.sort((a, b) => {
    if (a.by && b.by) return a.by.localeCompare(b.by);
    if (a.by || b.by) return a.by ? -1 : 1;
    if (a.plan.need !== b.plan.need) return a.plan.need ? -1 : 1;
    return a.left - b.left;
  });
  const out: ScheduledPlan[] = [];
  let year = ask.start.year;
  let month = ask.start.month;
  let pot = 0;
  let months = 0;
  let i = 0;
  let need = rows[0]?.left ?? 0;
  let firstMonth = ym(year, month);
  while (i < rows.length && months < 240 && ask.perMonth > 0) {
    pot += ask.perMonth;
    months += 1;
    const key = ym(year, month);
    while (i < rows.length && pot >= need) {
      pot -= need;
      const r = rows[i] as (typeof rows)[number];
      out.push({ ...r, doneIn: key, spare: pot, from: firstMonth, late: r.by !== null && key > r.by.slice(0, 7) });
      i += 1;
      need = rows[i]?.left ?? 0;
      // The next plan starts with what this month has left, or next month when nothing is.
      firstMonth = pot > 0 ? key : ym(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1);
    }
    if (i < rows.length) {
      need -= pot;
      pot = 0;
    }
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  const total = rows.reduce((s, r) => s + r.left, 0);
  return { ask, total, order: out, months, endsIn: out[out.length - 1]?.doneIn ?? "" };
}

export function scheduleWords(s: Schedule): string {
  const { ask } = s;
  const start = ym(ask.start.year, ask.start.month);
  if (s.order.length < ask.plans.length) {
    return `${formatMoney(s.total)} in all at ${formatMoney(ask.perMonth)} a month from ${nameOf(start)} takes more than twenty years: save more each month, or take a plan off.`;
  }
  const why = (r: ScheduledPlan, k: number): string => {
    const reason = r.by
      ? r.byWords
        ? `its own words say it is for ${/christmas|xmas|pasko|noche/i.test(`${r.plan.title} ${r.plan.notes}`) ? "Christmas" : "the New Year"}, so it is needed by ${formatMedium(r.by)}`
        : `it is due ${formatMedium(r.by)}`
      : `${r.plan.need ? "a need" : "a want"} with no date`;
    const sameMonth = r.from === r.doneIn;
    const paid = sameMonth ? `${nameOf(r.doneIn)}'s saving covers it` : `Paid from ${nameOf(r.from)} to ${nameOf(r.doneIn)}`;
    const last = k === s.order.length - 1;
    const spare = r.spare > 0 ? `, with ${formatMoney(r.spare)} of ${nameOf(r.doneIn)}'s saving ${last ? "left over" : "left for the next"}` : "";
    const late = r.late && r.by ? ` That is after ${formatMedium(r.by)}: ${formatMoney(ask.perMonth)} a month is not enough to have it by then.` : "";
    return `${k + 1}. **${r.plan.title}, ${formatMoney(r.left)}**: ${k === 0 ? "first, because " : ""}${reason}. ${paid}, done in ${nameOf(r.doneIn)}${spare}.${late}`;
  };
  const tie = s.order.filter((r) => !r.by && r.plan.need).length >= 2 ? " Among needs with no date, the smaller goes first, so one is done sooner." : "";
  const lines = [
    `**${formatMoney(s.total)} in all, at ${formatMoney(ask.perMonth)} a month from ${nameOf(start)}: ${s.order.length === 2 ? "both are" : `all ${s.order.length} are`} done in ${nameOf(s.endsIn)}, ${s.months} ${s.months === 1 ? "month" : "months"}.**`,
    `The order:${tie}`,
    ...s.order.map(why),
    ask.keepSavings ? "None of it comes from your savings, as you asked." : "",
    s.order.some((r) => !r.by) ? `A plan with no date can still have one: if ${s.order.filter((r) => !r.by).map((r) => r.plan.title).join(" or ")} has a day it must be paid by, say it, and the order is worked out again.` : "",
  ].filter(Boolean);
  return lines.join("\n");
}
