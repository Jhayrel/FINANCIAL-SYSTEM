/**
 * A realistic budget for a month, worked out on the device.
 *
 * ── Why this is not left to the model ──────────────────────────────────────
 *
 * 28 September 2026. "what's your realistic budget recommendation next
 * month? be realistic" came back "PHP 15,000.00, based on July", one month
 * picked by the model because it looked normal. "tell me whats the
 * separation of that budget?" was then answered about September's budget,
 * and "I am asking about the first you said" about subscriptions. Earlier
 * the same day "what budget do you recommend for October if I only expect
 * 8000 allowance?" was asked five times and never answered at all.
 *
 * A budget is arithmetic over the ledger, and the model is not allowed to do
 * arithmetic. So the app does it, the same way every time, and says how:
 *
 *   1. The months it reads are the six before the one being planned, skipping
 *      any with nothing recorded, and reaching back up to a year to find three.
 *      The month still running counts only once three quarters of it has
 *      passed: on the 3rd it holds three days, and read as a month it would
 *      pull every item's usual month down.
 *   2. Each item gets its own usual month: the median of what it cost in each
 *      of those months, counting a month without it as nothing. A median is
 *      what a normal month looks like; a mean lets one Shopee order of
 *      PHP 30,978.00 set every month after it.
 *   3. Bills and subscriptions are the ones still running: paid in at least
 *      two of the last three months, not marked stopped, at the last amount
 *      paid.
 *   4. The entries left out, the one-offs, are named, so the owner can put
 *      one back if it is coming again.
 *   5. When the owner says what they expect to receive, the budget is held
 *      to it, and the cuts that make it fit are named, the ones that are
 *      wants before the ones that are needs.
 *
 * Every figure is integer centavos. Each line is rounded up to the next
 * PHP 50.00 so the budget reads like one a person would write, and the
 * totals are the sums of those lines, so the parts always add up to the
 * whole that is quoted.
 */

import type { Centavos } from "./money";
import { formatMoney } from "./money";
import { addDays, daysBetween, daysInMonth, localDay, makeDate, monthName } from "./dates";
import { daysIn } from "./readEntry";
import { costOf, incomeOf, spendingAttribution, totalsFor } from "./totals";
import { forecastYear } from "./forecast";
import type { Debt } from "./debt";
import type { BudgetAssessment, Budgets, IsoDate, Necessity, Transaction } from "./types";
import { notTheMonth } from "./budgetAsk";
import { withoutPlannedSpend } from "./plannedSpend";

/** Months read, at most, before the one being planned. */
const WINDOW = 6;
/** Months with entries needed before the figure means anything. */
const ENOUGH = 3;
/** How far back to reach for them. */
const REACH = 12;
/** Each line rounds up to this, in centavos. */
const STEP = 5_000;

/**
 * Wants, which give first when a budget has to shrink.
 *
 * Needs are left alone until the wants are gone: cutting Food to pay for a
 * Treat is not advice anyone would take. An item not named here counts as a
 * want only if its name says so.
 */
const WANTS = /\b(treat|fun|online buy|shopping|travel|random|unknown|leisure|games?|gadgets?|hobby|eat(?:ing)? out|money send|self care|load)\b/i;

export interface AdviceLine {
  readonly name: string;
  readonly amount: Centavos;
  /** In how many of the months read it happened at all. */
  readonly months?: number;
}

export interface OneOff {
  readonly date: IsoDate;
  readonly item: string;
  readonly amount: Centavos;
  readonly description: string;
}

export interface BudgetAdvice {
  /** The items counted as wants, by the owner's marks first. */
  readonly wants?: readonly string[];
  readonly year: number;
  readonly month: number;
  /** "October 2026". */
  readonly name: string;
  /** The months read, oldest first, as "2026-04". */
  readonly read: readonly string[];
  /** Day to day spending, each item at its usual month, largest first. */
  readonly items: readonly AdviceLine[];
  /** Items that came up in some months only, left out and named. */
  readonly sometimes: readonly AdviceLine[];
  /** Transfer fees and debt interest, the rest of the spending track. */
  readonly fees: Centavos;
  readonly interest: Centavos;
  readonly bills: readonly AdviceLine[];
  readonly subscriptions: readonly AdviceLine[];
  /** Subscriptions marked stopped, and so left out. */
  readonly stopped: readonly string[];
  /**
   * What the owner said is coming in the month on top of the usual ("9k in
   * tuition pending"): spending, never cut, never income (`plannedSpend.ts`).
   */
  readonly planned?: readonly AdviceLine[];
  /** The spending track: items, fees and interest, and anything planned. */
  readonly spending: Centavos;
  /** The bills and subscriptions track. */
  readonly billsSubs: Centavos;
  readonly total: Centavos;
  /** The median month, everything in it, for comparison. */
  readonly typicalMonth: Centavos;
  /** The median month's income over the same months. */
  readonly typicalIncome: Centavos;
  /** Debt payments due in the month: money needed, but not part of a budget. */
  readonly debtDue: Centavos;
  readonly oneOffs: readonly OneOff[];
  /** Held to what the owner said they expect to receive, when they did. */
  readonly fit?: {
    readonly income: Centavos;
    /** What the spending track can be after bills and debt payments. */
    readonly room: Centavos;
    readonly fits: boolean;
    /** The spending track after the cuts, when it did not fit. */
    readonly spending: Centavos;
    readonly cuts: readonly { readonly name: string; readonly from: Centavos; readonly to: Centavos }[];
    /** Short even after every want is gone. */
    readonly short: Centavos;
    /** Kept back to save before anything is budgeted, when they said so. */
    readonly keep: Centavos;
  };
}

/** Rounded up to the next PHP 50.00. Nothing stays nothing. */
const up = (c: Centavos): Centavos => (c <= 0 ? 0 : Math.ceil(c / STEP) * STEP);
/** Rounded down, for a ceiling that must not be passed. */
const down = (c: Centavos): Centavos => (c <= 0 ? 0 : Math.floor(c / STEP) * STEP);

/** The middle value, the lower of the two middles averaged, in whole centavos. */
export function median(values: readonly Centavos[]): Centavos {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[mid] ?? 0) : Math.round(((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2);
}

const key = (year: number, month: number): string => `${year}-${String(month).padStart(2, "0")}`;
const back = (year: number, month: number, n: number): { year: number; month: number } => {
  const index = year * 12 + (month - 1) - n;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
};
const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

export interface AdviceInput {
  readonly transactions: readonly Transaction[];
  readonly year: number;
  readonly month: number;
  readonly asOf: IsoDate;
  /** Names marked stopped in Settings, with the day they stopped. */
  readonly stopped?: readonly { readonly name: string; readonly since: IsoDate }[];
  readonly debts?: readonly Debt[];
  /** What the owner said they expect to receive in the month. */
  readonly income?: Centavos | null;
  /** What they want kept back to save, out of that income. */
  readonly keep?: Centavos | null;
  /**
   * The month to read back from, when not the month planned. The months
   * ahead are all read from the same recent months (`outlook.ts`), so
   * December is not planned from fewer months than October.
   */
  readonly readBefore?: { readonly year: number; readonly month: number };
  /**
   * The owner's own marks: a kind marked discretionary is a want, essential
   * or emergency a need. Home Needs, marked discretionary, was kept as a need
   * and the shortfall overstated (19 October 2026 audit).
   */
  readonly spendingTypes?: readonly { readonly name: string; readonly necessity?: Necessity | undefined }[];
  /** Spending the owner said is coming in the month, on top of the usual: tuition, a trip. */
  readonly planned?: readonly { readonly name: string; readonly amount: Centavos }[];
}

/** A want, by the owner's mark, else by its name. */
function wantBy(types: AdviceInput["spendingTypes"]): (name: string) => boolean {
  const marks = new Map((types ?? []).filter((t) => t.necessity).map((t) => [t.name.trim().toLowerCase(), t.necessity]));
  return (name) => {
    const mark = marks.get(name.trim().toLowerCase());
    return mark ? mark === "discretionary" : WANTS.test(name);
  };
}

export function budgetAdvice(input: AdviceInput): BudgetAdvice {
  const { year, month, asOf } = input;
  const isWant = wantBy(input.spendingTypes);
  const rows = input.transactions.filter((t) => !(t as Transaction & { deletedAt?: string }).deletedAt);

  // ── 1. The months read ─────────────────────────────────────────────────────
  const byMonth = new Map<string, Transaction[]>();
  for (const t of rows) {
    const k = t.date.slice(0, 7);
    const list = byMonth.get(k);
    if (list) list.push(t);
    else byMonth.set(k, [t]);
  }
  const read: string[] = [];
  const anchor = input.readBefore ?? { year, month };
  const thisMonth = asOf.slice(0, 7);
  const thisMonthCounts = Number(asOf.slice(8, 10)) * 4 >= daysInMonth(Number(asOf.slice(0, 4)), Number(asOf.slice(5, 7))) * 3;
  for (let n = 1; n <= REACH && read.length < WINDOW; n += 1) {
    const m = back(anchor.year, anchor.month, n);
    const k = key(m.year, m.month);
    // A month still to come has nothing to say about a normal one.
    if (k > thisMonth) continue;
    if (k === thisMonth && !thisMonthCounts) continue;
    if ((byMonth.get(k) ?? []).length > 0) read.push(k);
    if (n >= WINDOW && read.length >= ENOUGH) break;
  }
  read.reverse();
  const inRead = (k: string): readonly Transaction[] => byMonth.get(k) ?? [];

  // ── 2. Each item's usual month ─────────────────────────────────────────────
  const perItem = new Map<string, Centavos[]>();
  const fees: Centavos[] = [];
  const interest: Centavos[] = [];
  const monthTotal: Centavos[] = [];
  const income: Centavos[] = [];
  read.forEach((k, i) => {
    const list = inRead(k);
    const [y, m] = [Number(k.slice(0, 4)), Number(k.slice(5, 7))];
    const range = { start: makeDate(y, m, 1), end: makeDate(y, m, daysInMonth(y, m)) };
    const totals = totalsFor(list);
    monthTotal.push(totals.total);
    income.push(list.reduce((sum, t) => sum + incomeOf(t), 0));
    fees.push(totals.fees);
    // The spending track holds everything the items below do not.
    let attributed = 0;
    for (const [name, amount] of spendingAttribution(list, range)) {
      if (same(name, "Transaction Fee")) continue;
      attributed += amount;
      const found = perItem.get(name) ?? Array.from({ length: read.length }, () => 0);
      found[i] = (found[i] ?? 0) + amount;
      perItem.set(name, found);
    }
    interest.push(Math.max(0, totals.spending + totals.fees + totals.interest - attributed - totals.fees));
  });

  const items: AdviceLine[] = [];
  const sometimes: AdviceLine[] = [];
  for (const [name, values] of perItem) {
    const months = values.filter((v) => v > 0).length;
    const usual = up(median(values));
    if (usual > 0) items.push({ name, amount: usual, months });
    else if (months > 0) sometimes.push({ name, amount: up(median(values.filter((v) => v > 0))), months });
  }
  items.sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));
  sometimes.sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));
  const feeLine = up(median(fees));
  const interestLine = up(median(interest));

  // ── 3. Bills and subscriptions still running ───────────────────────────────
  const stopped = (input.stopped ?? []).filter((s) => s.since <= asOf).map((s) => s.name);
  const recent = read.slice(-3);
  const running = new Map<string, { category: string; amount: Centavos; date: IsoDate; months: Set<string> }>();
  for (const k of read) {
    for (const t of inRead(k)) {
      if (t.type !== "Spending" || (t.category !== "Bills" && t.category !== "Subscriptions")) continue;
      const name = t.item.trim() || t.category;
      const found = running.get(name.toLowerCase());
      const months = found?.months ?? new Set<string>();
      if (recent.includes(k)) months.add(k);
      if (!found || t.date >= found.date) running.set(name.toLowerCase(), { category: t.category, amount: t.total, date: t.date, months });
      else found.months.add(k);
    }
  }
  const bills: AdviceLine[] = [];
  const subscriptions: AdviceLine[] = [];
  const leftOut: string[] = [];
  for (const [lower, r] of running) {
    const shown = rows.find((t) => (t.category === "Bills" || t.category === "Subscriptions") && t.item.trim().toLowerCase() === lower)?.item.trim() ?? lower;
    if (stopped.some((s) => same(s, shown))) {
      leftOut.push(shown);
      continue;
    }
    if (r.months.size < Math.min(2, recent.length)) continue;
    (r.category === "Bills" ? bills : subscriptions).push({ name: shown, amount: r.amount, months: r.months.size });
  }
  for (const s of stopped) if (!leftOut.some((x) => same(x, s))) leftOut.push(s);
  bills.sort((a, b) => b.amount - a.amount);
  subscriptions.sort((a, b) => b.amount - a.amount);

  // ── 4. One-offs, named ─────────────────────────────────────────────────────
  const usualOf = new Map(items.map((l) => [l.name.toLowerCase(), l.amount]));
  const oneOffs: OneOff[] = [];
  for (const k of read) {
    for (const t of inRead(k)) {
      const cost = costOf(t);
      if (cost < 200_000 || t.category === "Bills" || t.category === "Subscriptions") continue;
      const bucket = t.type === "Transfer" ? "Money Send" : t.item.trim();
      const usual = usualOf.get(bucket.toLowerCase()) ?? 0;
      if (cost >= Math.max(200_000, usual * 2)) {
        oneOffs.push({ date: t.date, item: bucket || "Unnamed", amount: cost, description: t.description.trim() });
      }
    }
  }
  oneOffs.sort((a, b) => b.amount - a.amount);

  // ── The totals, as the sums of the lines ───────────────────────────────────
  const usualSpending = items.reduce((sum, l) => sum + l.amount, 0) + feeLine + interestLine;
  const planned: AdviceLine[] = (input.planned ?? []).filter((p) => p.amount > 0).map((p) => ({ name: p.name, amount: p.amount }));
  const plannedTotal = planned.reduce((sum, l) => sum + l.amount, 0);
  const spending = usualSpending + plannedTotal;
  const billsSubs = [...bills, ...subscriptions].reduce((sum, l) => sum + l.amount, 0);
  const debts = input.debts ?? [];
  const asOfMonth = year === Number(asOf.slice(0, 4)) ? Number(asOf.slice(5, 7)) : year < Number(asOf.slice(0, 4)) ? 12 : 0;
  const debtDue = debts.length > 0 ? (forecastYear(rows, year, asOfMonth, debts, asOf)[month - 1]?.debtService ?? 0) : 0;

  // ── 5. Held to what is coming in ───────────────────────────────────────────
  let fit: BudgetAdvice["fit"];
  if (input.income && input.income > 0) {
    const keep = Math.max(0, input.keep ?? 0);
    // What is planned is paid whatever happens: the usual spending gives way to it, never the other way.
    const room = down(input.income - billsSubs - debtDue - keep - plannedTotal);
    if (usualSpending <= room) {
      fit = { income: input.income, room, fits: true, spending, cuts: [], short: 0, keep };
    } else {
      /*
       * The wants give, each by the same share, rather than the largest going
       * to nothing: a month with no Treat at all is not a budget anyone keeps.
       * Only when every want is gone is a need touched, and then it is not
       * cut but reported as the gap.
       */
      const over = usualSpending - Math.max(0, room);
      const wants = items.filter((l) => isWant(l.name));
      const wanted = wants.reduce((sum, l) => sum + l.amount, 0);
      const cuts: { name: string; from: Centavos; to: Centavos }[] =
        wanted <= over
          ? wants.map((l) => ({ name: l.name, from: l.amount, to: 0 }))
          : wants.map((l) => ({ name: l.name, from: l.amount, to: down(Math.floor((l.amount * (wanted - over)) / wanted)) }));
      const after = usualSpending - cuts.reduce((sum, c) => sum + (c.from - c.to), 0);
      fit = { income: input.income, room, fits: false, spending: after + plannedTotal, cuts, short: Math.max(0, after - Math.max(0, room)), keep };
    }
  }

  return {
    wants: items.filter((l) => isWant(l.name)).map((l) => l.name),
    year,
    month,
    name: `${monthName(month)} ${year}`,
    read,
    items,
    sometimes,
    fees: feeLine,
    interest: interestLine,
    bills,
    subscriptions,
    stopped: leftOut,
    ...(planned.length > 0 ? { planned } : {}),
    spending,
    billsSubs,
    total: spending + billsSubs,
    typicalMonth: median(monthTotal),
    typicalIncome: median(income),
    debtDue,
    oneOffs: oneOffs.slice(0, 5),
    ...(fit ? { fit } : {}),
  };
}

/** The kind of usual spending each planned thing may already be part of. */
const FAMILIES: readonly (readonly [RegExp, RegExp])[] = [
  [/\b(?:tuition|school|enrol+ment|matriculation|miscellaneous|books?|uniform|thesis|exam|graduation|project|review|registration)\b/i, /\b(?:school|tuition|education|stud(?:y|ies))\b/i],
  [/\b(?:trip|travel|vacation|outing)\b/i, /\b(?:travel|trip)\b/i],
  [/\b(?:rent|upa)\b/i, /\brent\b/i],
  [/\brepairs?\b/i, /\brepair/i],
  [/\b(?:medical|hospital|dentist|check-?up|medicine|gamot)\b/i, /\b(?:medical|health|medicine|hospital)\b/i],
  [/\b(?:groceries|grocery)\b/i, /\b(?:grocer\w*|home needs)\b/i],
];

/**
 * Where something planned may already be inside the usual month: tuition and
 * the usual School line. Said, with what it does to the total, rather than
 * guessed either way: the owner knows whether the tuition is that spending.
 */
export function overlapWords(a: BudgetAdvice): string {
  const said: string[] = [];
  for (const p of a.planned ?? []) {
    const family = FAMILIES.find(([planned]) => planned.test(p.name));
    const usual = family ? a.items.find((l) => family[1].test(l.name) && l.amount > 0) : undefined;
    if (usual) {
      said.push(
        ` Your usual month already has ${usual.name} at ${money(usual.amount)}: if the ${p.name.toLowerCase()} is that spending rather than on top of it, the total is ${money(a.total - usual.amount)}.`,
      );
    }
  }
  return said.join("");
}

/**
 * "How much do I need to survive next month?": what the month takes, and the
 * money for it, said step by step so every figure can be checked.
 *
 * What it takes is the usual month (spending, bills and subscriptions), what
 * the owner said is coming on top, and the debt payments due. The money for
 * it is the income they said, else the income of their usual month, then
 * what carries over from now if nothing more is spent, then their savings,
 * named and never counted as spending money. Each is a line, so the answer
 * is the sums and not a summary of them (26 October 2026: "do some
 * calculations").
 */
export function needWords(
  a: BudgetAdvice,
  money_: {
    /** The income they said for the month, or null to go by the usual month's. */
    readonly incomeSaid: Centavos | null;
    /** What is safe until this month ends: what carries over if nothing more is spent. Null when the month asked about is not the next one. */
    readonly carry: Centavos | null;
    /** Savings and reserve accounts, by name, with what they hold. */
    readonly savings: readonly { readonly name: string; readonly amount: Centavos }[];
    /** "Can I afford it?", "is it enough?": a yes or no first. */
    readonly verdict?: boolean;
  },
): string {
  const plannedTotal = (a.planned ?? []).reduce((sum, l) => sum + l.amount, 0);
  const usual = a.total - plannedTotal;
  const need = a.total + a.debtDue;
  const lines: string[] = [];
  const income0 = money_.incomeSaid ?? a.typicalIncome;
  const call =
    money_.verdict && income0 > 0
      ? need <= income0
        ? "Yes, going by what comes in. "
        : need <= income0 + Math.max(0, money_.carry ?? 0)
          ? "Only with what carries over from now. "
          : "Not as things usually go. "
      : "";
  lines.push(`**${call}You need ${money(need)} for ${a.name}.** Worked out:`);
  lines.push(`- Your usual month: ${money(usual)} (${money(a.spending - plannedTotal)} spending, ${money(a.billsSubs)} bills and subscriptions), the middle of ${monthsRead(a.read)}.`);
  for (const l of a.planned ?? []) lines.push(`- ${l.name}, which you said is coming: ${money(l.amount)}.`);
  if (a.debtDue > 0) lines.push(`- Debt payments due in ${monthName(a.month)}: ${money(a.debtDue)}.`);
  const parts = [money(usual), ...(a.planned ?? []).map((l) => money(l.amount)), ...(a.debtDue > 0 ? [money(a.debtDue)] : [])];
  if (parts.length > 1) lines.push(`- Together: ${parts.join(" + ")} = **${money(need)}**.`);
  const overlap = overlapWords(a).trim();
  if (overlap) lines.push(overlap);

  const income = money_.incomeSaid ?? a.typicalIncome;
  if (income <= 0) {
    lines.push(`There is no income in ${monthsRead(a.read)} to set against it. Tell me what you expect to receive ("I expect 10000") and I will work out what is left.`);
    return lines.join("\n");
  }
  lines.push("");
  lines.push(
    money_.incomeSaid !== null
      ? `**The money for it:** the ${money(income)} you said you expect.`
      : `**The money for it:** your usual month brings in ${money(income)}, the middle of the same months. If ${monthName(a.month)} will bring in a different amount, say it and I will work it out again.`,
  );
  const gap = need - income;
  lines.push(gap > 0 ? `${money(need)} − ${money(income)}: **${money(gap)} short**.` : `${money(income)} − ${money(need)}: **${money(-gap)} to spare**.`);
  if (gap > 0 && money_.carry !== null && money_.carry > 0) {
    const after = gap - money_.carry;
    lines.push(
      after > 0
        ? `If nothing more is spent this month, ${money(money_.carry)} carries over from your wallets: still **${money(after)} short**.`
        : `If nothing more is spent this month, the ${money(money_.carry)} that carries over from your wallets covers it, with ${money(-after)} to spare.`,
    );
  }
  const stillShort = gap - Math.max(0, money_.carry ?? 0);
  if (gap > 0 && stillShort > 0) {
    const held = money_.savings.filter((x) => x.amount > 0);
    const heldTotal = held.reduce((sum, x) => sum + x.amount, 0);
    if (heldTotal > 0) {
      lines.push(
        `Your savings hold ${money(heldTotal)} (${held.map((x) => `${x.name} ${money(x.amount)}`).join(", ")}): ${heldTotal >= stillShort ? "enough to cover the gap, if you choose to use them" : `${money(stillShort - heldTotal)} less than the gap even if all of it were used`}. They are not counted above.`,
      );
    }
    lines.push("Or the wants give way: the budget below is held to the money, with the cuts named.");
  }
  return lines.join("\n");
}

/**
 * "I will spend 2000 for my birthday on November 5, can I still keep my
 * budget?": the budget already set for the month, against the usual month
 * with what is coming, and what keeping it would take. It made a card setting
 * November's budget to PHP 2,000.00 (26 October 2026).
 *
 * `held` is the same advice held to the budget set, so its cuts are what
 * keeping the budget means: the wants give way, never the needs or what is
 * coming.
 */
export function keepWords(a: BudgetAdvice, held: BudgetAdvice, set: { readonly spending: Centavos; readonly billsSubs: Centavos }): string {
  const plannedTotal = (a.planned ?? []).reduce((sum, l) => sum + l.amount, 0);
  const setTotal = set.spending + set.billsSubs;
  const usual = a.total - plannedTotal;
  const what = (a.planned ?? []).map((l) => l.name.toLowerCase()).join(" and ") || "what is coming";
  const lines: string[] = [];
  if (a.total <= setTotal) {
    lines.push(`**Yes: ${a.name}'s budget is ${money(setTotal)}, and your usual month with the ${what} comes to ${money(a.total)}, ${money(setTotal - a.total)} under it.**`);
    lines.push(`- Usual month ${money(usual)} + ${(a.planned ?? []).map((l) => `${l.name} ${money(l.amount)}`).join(" + ")} = ${money(a.total)}.`);
    return lines.join("\n");
  }
  lines.push(`**Not as things usually go: ${a.name}'s budget is ${money(setTotal)}, and your usual month with the ${what} comes to ${money(a.total)}, ${money(a.total - setTotal)} over it.**`);
  lines.push(`- Usual month ${money(usual)} + ${(a.planned ?? []).map((l) => `${l.name} ${money(l.amount)}`).join(" + ")} = ${money(a.total)}.`);
  if (usual > setTotal) lines.push(`- Your usual month alone is already ${money(usual - setTotal)} over it, before the ${what}.`);
  const fit = held.fit;
  if (fit && fit.cuts.length > 0) {
    lines.push(
      `To keep it, the wants give way: ${fit.cuts.map((c) => `${c.name} from ${money(c.from)} to ${money(c.to)}`).join(", ")}.${fit.short > 0 ? ` Even then it is **${money(fit.short)}** over: the needs and the ${what} cost more than the budget.` : ""}`,
    );
  } else if (fit && fit.short > 0) {
    lines.push(`Even with every want cut it is **${money(fit.short)}** over: the needs and the ${what} cost more than the budget.`);
  }
  lines.push(`Or raise the budget to fit it: say "set ${monthName(a.month)} to ${Math.ceil(a.total / 100)}".`);
  return lines.join("\n");
}

/** "April to September 2026", or "November 2025 to April 2026". */
export function monthsRead(read: readonly string[]): string {
  const first = read[0];
  const last = read[read.length - 1];
  if (!first || !last) return "no months";
  const name = (k: string): string => monthName(Number(k.slice(5, 7)));
  if (first === last) return `${name(first)} ${first.slice(0, 4)}`;
  return first.slice(0, 4) === last.slice(0, 4)
    ? `${name(first)} to ${name(last)} ${last.slice(0, 4)}`
    : `${name(first)} ${first.slice(0, 4)} to ${name(last)} ${last.slice(0, 4)}`;
}

const money = (c: Centavos): string => formatMoney(c).replace(/^₱/, "PHP ").replace(/^-₱/, "-PHP ").replace(/^−₱/, "−PHP ");

/**
 * The advice, in words, with the split under it.
 *
 * The first sentence is the form `proposedBudgetIn` reads ("I recommend a
 * budget of PHP 14,450.00 for October 2026"), so "set it" after it becomes
 * a card, as it does after a model's recommendation.
 */
export function adviceWords(a: BudgetAdvice, options: { readonly split?: boolean; readonly plannedSaid?: boolean } = {}): string {
  const split = options.split ?? true;
  if (a.read.length === 0) {
    return `There is nothing recorded before ${a.name} to work a budget out from. Add a month of entries, or tell me a figure: "set ${monthName(a.month)} to 9000".`;
  }
  const spendingAt = a.fit && !a.fit.fits ? a.fit.spending : a.spending;
  const total = spendingAt + a.billsSubs;
  const out: string[] = [];
  out.push(
    `I recommend a budget of **${money(total)}** for ${a.name}: ${money(spendingAt)} for spending and ${money(a.billsSubs)} for bills and subscriptions.`,
  );
  out.push(
    `It is each item's usual month over ${monthsRead(a.read)}${a.read.length < ENOUGH ? ` (only ${a.read.length} month${a.read.length === 1 ? "" : "s"} with entries, so treat it as rough)` : ""}, the middle value rather than the average, so one big month does not set it.`,
  );
  const plannedTotal = (a.planned ?? []).reduce((sum, l) => sum + l.amount, 0);
  // Said already when the answer opened with what the month needs (`needWords`).
  if (plannedTotal > 0 && !options.plannedSaid) {
    out.push(`On top of it is what you said is coming: ${(a.planned ?? []).map((l) => `${l.name} ${money(l.amount)}`).join(", ")}. That is spending, counted in full and never cut.${overlapWords(a)}`);
  }

  if (a.fit) {
    const kept = a.fit.keep > 0 ? ` with ${money(a.fit.keep)} kept to save` : "";
    if (a.fit.fits) {
      out.push(`It fits the ${money(a.fit.income)} you expect${kept}${a.debtDue > 0 ? ` after ${money(a.debtDue)} of debt payments due` : ""}, leaving **${money(a.fit.income - a.total - a.debtDue)}** unspent${a.fit.keep > 0 ? ", your savings included" : " to save"}.`);
    } else {
      const cuts = a.fit.cuts.map((c) => `${c.name} from ${money(c.from)} to ${money(c.to)}`);
      out.push(
        `Your usual month${plannedTotal > 0 ? ` with what is coming` : ""} (${money(a.total)}) is more than the ${money(a.fit.income)} you expect${kept}${a.debtDue > 0 ? ` less ${money(a.debtDue)} of debt payments due` : ""}, so the spending part is held to ${money(spendingAt)}${cuts.length > 0 ? `, by cutting ${cuts.join(", ")}` : ""}.`,
      );
      if (a.fit.short > 0) {
        out.push(`Even with every want cut it is **${money(a.fit.short)}** short: the needs alone (${a.items.filter((l) => !(a.wants ? a.wants.includes(l.name) : WANTS.test(l.name))).map((l) => l.name).join(", ")}) cost more than that leaves. The gap has to come from ${a.fit.keep > 0 ? "saving less this month, " : ""}savings or more income.`);
      }
    }
  } else if (a.typicalIncome > 0) {
    const left = a.typicalIncome - a.total - a.debtDue;
    out.push(
      left >= 0
        ? `Your usual month brought in ${money(a.typicalIncome)} over the same months, which covers it with ${money(left)} to spare. Tell me what you expect to receive and I will hold the budget to that.`
        : `Your usual month brought in ${money(a.typicalIncome)} over the same months, ${money(-left)} less than this. Tell me what you expect to receive and I will hold the budget to that.`,
    );
  }

  if (split) {
    out.push("");
    out.push(`**Spending, ${money(spendingAt)}**, each item's usual month${plannedTotal > 0 ? ", and what is coming" : ""}:`);
    for (const l of a.planned ?? []) out.push(`- ${l.name}: ${money(l.amount)} (you said it is coming)`);
    const cutTo = new Map((a.fit?.cuts ?? []).map((c) => [c.name, c.to]));
    for (const l of a.items) {
      const to = cutTo.get(l.name);
      out.push(`- ${l.name}: ${to === undefined ? money(l.amount) : `${money(to)} (usually ${money(l.amount)})`}`);
    }
    if (a.fees > 0) out.push(`- Transfer fees: ${money(a.fees)}`);
    if (a.interest > 0) out.push(`- Debt interest and charges: ${money(a.interest)}`);
    out.push("");
    out.push(`**Bills and subscriptions, ${money(a.billsSubs)}**, the ones still running, at the last amount paid:`);
    for (const l of [...a.bills, ...a.subscriptions]) out.push(`- ${l.name}: ${money(l.amount)}`);
    if (a.bills.length + a.subscriptions.length === 0) out.push("- None paid in two of the last three months.");
    if (a.stopped.length > 0) out.push(`Left out, marked stopped: ${a.stopped.join(", ")}.`);
    if (a.debtDue > 0) {
      out.push("");
      out.push(`Debt payments due in ${monthName(a.month)}: ${money(a.debtDue)}. Not part of the budget, since paying debt is not spending, but the money has to be there.`);
    }
    if (a.oneOffs.length > 0 || a.sometimes.length > 0) {
      out.push("");
      const offs = a.oneOffs.map((o) => `${o.item} ${money(o.amount)} on ${o.date}${o.description ? ` (${o.description.slice(0, 40)})` : ""}`);
      if (offs.length > 0) out.push(`Left out as one-offs: ${offs.join("; ")}.`);
      if (a.sometimes.length > 0) {
        out.push(`Only some months, so not in it: ${a.sometimes.map((l) => `${l.name} (${l.months} of ${a.read.length} months, about ${money(l.amount)} when it happens)`).join(", ")}. Add one back if it is coming in ${monthName(a.month)}.`);
      }
    }
  }
  out.push("");
  out.push(`Say "set it" and it goes on a budget card, both parts, for you to apply. Your usual month over those months, one-offs and all, was ${money(a.typicalMonth)}.`);
  return out.join("\n");
}

/**
 * A request for a budget figure, rather than a change to one.
 *
 * "what's your realistic budget recommendation next month?", "what budget
 * do you recommend for October if I only expect 8000 allowance?", "how
 * much should my budget be", "suggest a budget", "magkano dapat budget ko".
 * A figure to set ("set October to 9000") is a command, read elsewhere.
 */
export function asksBudgetAdvice(said: string): boolean {
  const text = said.toLowerCase().replace(/\b(buget|budjet|bugdet|budgt|budet|bujet)\b/g, "budget");
  if (!/\bbudget/.test(text)) return false;
  // How many times it changed is a question about its history, never a request for advice (`asksBudgetHistory`).
  if (/\b(how many times|how often|history|when did i)\b/.test(text)) return false;
  if (/^\s*(set|change|update|make|put|copy|apply|use|add)\b/.test(text) && !/\?\s*$/.test(text)) return false;
  if (judgesSetBudget(said)) return true;
  return (
    // Spelled as typed on a phone: "proporse", "propoised", "reccomend", "sugest".
    /\b(re?c+om+e?n?d\w*|sug+est\w*|prop[a-z]*s[a-z]*|realistic|reasonable|ideal|advi[cs]e)\b/.test(text) ||
    /\bwhat\b[^.?!]{0,20}\bbudget\b[^.?!]{0,15}\b(?:you|u)\b/.test(text) ||
    /\b(magkano|ilan)\b[^.?!]{0,30}\bbudget\b/.test(text) ||
    /\b(what|how much|magkano|ilan)\b[^.?!]{0,40}\bbudget\b[^.?!]{0,20}\b(be|should|dapat|set|for|next|need)\b/.test(text) ||
    /\bwhat\s+(?:should|would|could)\b[^.?!]{0,30}\bbudget\b/.test(text) ||
    /\b(give|make|plan|work out|build|create)\s+(?:me\s+)?(?:a\s+|my\s+)?(?:new\s+|realistic\s+)?budget\b/.test(text) ||
    /*
     * A plan to be worked out, with no figure of the owner's: "I plan to
     * adjusted my budget this month, can you set a plan? Like based on my
     * income and spending" was answered by the device asking what the budget
     * should be (4 October 2026). The figure is the app's to work out and
     * the model's to recommend.
     */
    /\b(set|make|give|create|build|work out|do|draft)\s+(?:me\s+|up\s+)?(?:a\s+|my\s+)?(?:new\s+)?(?:budget\s+)?plan\b/.test(text) ||
    /\b(?:based on|base(?:d)? sa|according to)\s+(?:my\s+|the\s+|ang\s+)?(?:usual\s+)?(?:income|allowance|salary|sahod|kita|spendings?|expenses|gastos)\b/.test(text) ||
    (!/\d/.test(text) && /\b(?:adjust\w*|redo|rework|plan(?:ning)?)\b[^.?!]{0,30}\bbudget\b/.test(text))
  );
}

/**
 * What the owner says they will receive: "if I only expect 8000 allowance",
 * "my allowance is 8k", "I'll get 12,000 next month", "sahod ko 15000".
 */
export function expectedIncomeIn(said: string): Centavos | null {
  // A sum that is going out ("9k in tuition pending") is never what comes in (26 October 2026).
  const text = withoutPlannedSpend(said).toLowerCase().replace(/(\d+(?:\.\d+)?)\s*k\b/g, (_m, n: string) => String(Math.round(Number(n) * 1000)));
  const NUM = String.raw`(?:₱|php\s*)?(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)`;
  const INCOME = String.raw`(?:allowance|income|salary|sahod|kita|pay(?:check)?|budget money|money coming in|revenue)`;
  const patterns = [
    new RegExp(String.raw`\b(?:expect|expecting|get|getting|receive|receiving|earn|earning|make|making|have|only have|will have|matatanggap|makukuha)\w*\s+(?:only\s+|about\s+|around\s+|just\s+)?${NUM}`),
    new RegExp(String.raw`${NUM}\s*(?:pesos?\s+)?(?:lang\s+|only\s+|na\s+)?(?:of\s+)?(?:as\s+)?(?:my\s+|ang\s+)?${INCOME}`),
    // "my allowance for October is only 8000": a few words may stand between.
    new RegExp(String.raw`${INCOME}\b[^.?!\d]{0,30}?(?:\bis|\bof|\bwill be|\bwould be|=|:|\bay|\blang)?\s*(?:only\s+|about\s+|around\s+|just\s+)?${NUM}`),
  ];
  for (const p of patterns) {
    const m = p.exec(text);
    const raw = m?.[1]?.replace(/,/g, "");
    if (!raw) continue;
    const value = Math.round(Number(raw) * 100);
    // A year or a day of the month is not an income.
    if (Number.isFinite(value) && value >= 10_000 && !/^20\d{2}$/.test(raw)) return value;
  }
  return null;
}

/**
 * "the separation of that budget", "breakdown", "split", "where does it
 * go", "hati", "per item": the last recommendation again, with its parts.
 */
export function asksForTheSplit(said: string): boolean {
  const text = said.toLowerCase();
  return /\b(separat\w*|breakdown|break\s+(?:it\s+)?down|split|splits|parts?|per item|each item|by item|itemi[sz]e\w*|allocation|allocate\w*|distribut\w*|hati\w*|detail\w*|where does it go|what (?:is|are) (?:in|inside) it)\b/.test(text);
}

/**
 * What they want kept back: "I want to save 2000", "set aside 1,500",
 * "ipon 1000", "keep 2k for savings". Not "how much would I save", which
 * asks rather than says.
 */
export function savingsGoalIn(said: string): Centavos | null {
  const text = said.toLowerCase().replace(/(\d+(?:\.\d+)?)\s*k\b/g, (_m, n: string) => String(Math.round(Number(n) * 1000)));
  if (/\bhow much (?:would|could|can|will) i save\b/.test(text) && !/\b(want|plan|goal|aim|need)\w* to save\b/.test(text)) return null;
  const NUM = String.raw`(?:₱|php\s*)?(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)`;
  const patterns = [
    new RegExp(String.raw`\b(?:save|saving|set aside|put aside|keep|ipon|mag-?ipon|itabi)\s+(?:ng\s+|at least\s+|around\s+|about\s+|mga\s+)*${NUM}`),
    new RegExp(String.raw`${NUM}\s*(?:pesos?\s+)?(?:for|to|into|as|sa)\s+(?:my\s+)?(?:savings?|ipon)\b`),
    new RegExp(String.raw`\bsavings?\s+(?:goal\s+)?(?:of|is|=|:)\s*${NUM}`),
  ];
  for (const p of patterns) {
    const raw = p.exec(text)?.[1]?.replace(/,/g, "");
    if (!raw) continue;
    const value = Math.round(Number(raw) * 100);
    if (Number.isFinite(value) && value >= 10_000 && !/^20\d{2}$/.test(raw)) return value;
  }
  return null;
}

const MONTH_WORDS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * The month a budget is being asked for, in a message that may name others.
 *
 * "I spent a lot in May and June because of school. What budget do you
 * recommend for October?" is about October; the first month named is not
 * the one. Read from the words beside "budget", then "next month".
 */
export function adviceMonthIn(said: string, asOf: IsoDate): { year: number; month: number } | null {
  /*
   * "may" the verb is not the month. The fix of 5 October was made where a
   * budget is set (`budgetAsk.ts`) and not here, so "what budget may I set"
   * worked figures out for May 2027 (6 October 2026 back-read).
   */
  const text = notTheMonth(said).toLowerCase();
  const year = Number(asOf.slice(0, 4));
  const now = Number(asOf.slice(5, 7));
  const MONTH = String.raw`(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)`;
  const found =
    new RegExp(String.raw`\bbudget\b[^.?!]{0,60}?\b(?:for|in|on|sa|ng|this|coming)\s+(?:the\s+)?(?:month\s+of\s+)?${MONTH}\b(?:\s+(20\d{2}))?`).exec(text) ??
    new RegExp(String.raw`\b${MONTH}(?:\s+(20\d{2}))?(?:'s)?\s+budget\b`).exec(text);
  if (found?.[1]) {
    const month = MONTH_WORDS.indexOf(found[1].slice(0, 3)) + 1;
    // A month already past this year means next year's, unless a year is said.
    const y = found[2] ? Number(found[2]) : month < now ? year + 1 : year;
    return { year: y, month };
  }
  if (/\bnext month\b|\bsusunod na buwan\b|\bcoming month\b/.test(text)) return now === 12 ? { year: year + 1, month: 1 } : { year, month: now + 1 };
  // "how about december what budget you propose?": the one month it names.
  const named = [...text.matchAll(new RegExp(String.raw`\b${MONTH}\b`, "g"))].map((m) => MONTH_WORDS.indexOf((m[1] ?? "").slice(0, 3)) + 1).filter((m) => m > 0);
  const months = [...new Set(named)];
  if (months.length === 1 && months[0] !== undefined && !/\blast month\b/.test(text)) {
    const month = months[0];
    return { year: month < now ? year + 1 : year, month };
  }
  if (/\bbudget\b[^.?!]{0,40}\bthis month\b|\bthis month'?s budget\b/.test(text)) return { year, month: now };
  return null;
}

/**
 * Judging a budget already set, as against asking for one.
 *
 * 5 October 2026: "is the new budget reasonable?", just after October's
 * budget changed, was answered with a recommendation for November, and
 * then "No" from the first five days' average. "Can you verify if this
 * budget would work this month based on the spendings" was not read as
 * about a budget at all. A question about the budget that is set is
 * answered about that budget: against the usual month, and against what is
 * left of it.
 */
const JUDGES =
  /\b(?:is|are|will|would|does|do|can|could|was)\b[^.?!]{0,40}\bbudget\b[^.?!]{0,40}\b(?:reasonable|realistic|enough|ok(?:ay)?|work|works|fine|good|right|doable|achievable|possible|kaya|too (?:low|high|much|little|tight|big|small))\b|\b(?:verify|check|review|assess|evaluate|judge|rate)\b[^.?!]{0,30}\bbudget\b/;
const ASKS_FOR_ONE = /\b(?:re?c+om+e?n?d\w*|sug+est\w*|propos\w*|what (?:budget|should)|how much should|give me|make me|set me|work out)\b/;

export function judgesSetBudget(said: string): boolean {
  const text = notTheMonth(said).toLowerCase().replace(/\b(buget|budjet|bugdet|budgt|budet|bujet)\b/g, "budget");
  return /\bbudget/.test(text) && JUDGES.test(text) && !ASKS_FOR_ONE.test(text);
}

/** The month of the newest change to a month's two budgets, if one was made in the last 31 days. */
export function newestBudgetChange(budgets: Budgets, asOf: IsoDate): { readonly year: number; readonly month: number } | null {
  let newest: { at: string; year: number; month: number } | null = null;
  for (const [year, plan] of Object.entries(budgets)) {
    for (const [month, list] of Object.entries(plan.revisions ?? {})) {
      for (const r of list) {
        if (r.what !== "tracks") continue;
        if (!newest || r.at > newest.at) newest = { at: r.at, year: Number(year), month: Number(month) };
      }
    }
  }
  if (!newest) return null;
  const day = localDay(newest.at);
  return day <= asOf && day >= addDays(asOf, -31) ? { year: newest.year, month: newest.month } : null;
}

/**
 * The budget that is set, against the usual month and what is left of it,
 * in plain sentences for the top of the figures. Null when nothing is set
 * for the month, which is a question for a recommendation instead.
 */
export function judgeWords(
  a: BudgetAdvice,
  tracks: BudgetAssessment,
  daysLeft: number,
  /**
   * What is safe to spend until the month ends, for the month running. A
   * budget raised to PHP 16,700.00 was judged against the usual month alone
   * and called no more care than usual, while the wallets held thousands
   * less than the budget left; the next day nothing was safe to spend
   * (backup of 7 October 2026).
   */
  held: { readonly safe: Centavos; readonly perDay: Centavos } | null = null,
): string | null {
  const set = tracks.spending.budget + tracks.billsSubs.budget;
  if (set <= 0) return null;
  const out: string[] = [];
  out.push(
    `The budget set for ${a.name}: ${money(tracks.spending.budget)} for spending and ${money(tracks.billsSubs.budget)} for bills and subscriptions, ${money(set)} in all.`,
  );
  if (a.read.length > 0) {
    out.push(
      `The usual month, each item's middle month over ${monthsRead(a.read)} with one-offs left out: ${money(a.spending)} of spending and ${money(a.billsSubs)} of bills and subscriptions still running.`,
    );
    /*
     * A month that is running is judged by what is left a day against the
     * usual day, not by the budget's size: with 98% of it spent and 13 days
     * to go it was called "no more care than a usual month" (19 October 2026
     * audit).
     */
    const inMonth = daysInMonth(a.year, a.month);
    const running = daysLeft > 0 && daysLeft < inMonth;
    const usualDay = Math.floor(a.spending / inMonth);
    const leftDay = running ? Math.floor(Math.max(0, tracks.spending.remaining) / daysLeft) : 0;
    const gap = tracks.spending.budget - a.spending;
    out.push(
      running
        ? leftDay >= usualDay
          ? `What is left of the spending budget is ${money(leftDay)} a day, at or above a usual ${money(usualDay)} a day, so keeping to it needs no more care than usual.`
          : `What is left of the spending budget is ${money(leftDay)} a day against a usual ${money(usualDay)} a day, so keeping to it means spending ${usualDay > 0 && leftDay * 2 < usualDay ? "far " : ""}less than usual for the rest of ${a.name}.`
        : gap >= 0
          ? `The spending budget is ${money(gap)} above the usual month, so keeping to it needs no more care than a usual month.`
          : `The spending budget is ${money(-gap)} below the usual month, so keeping to it means spending less than usual.`,
    );
    const bills = tracks.billsSubs.budget - a.billsSubs;
    if (bills < 0) out.push(`The bills and subscriptions budget is ${money(-bills)} less than the ones still running cost in a usual month.`);
  }
  if (daysLeft > 0 && daysLeft >= daysInMonth(a.year, a.month)) {
    // Not started: no "so far", no "today included".
    out.push(`That is ${money(Math.floor(Math.max(0, tracks.spending.budget) / daysLeft))} a day for the ${daysLeft} days of ${a.name}.`);
  } else if (daysLeft > 0) {
    const left = tracks.spending.remaining;
    out.push(
      left >= 0
        ? `So far ${money(tracks.spending.spent)} of spending: ${money(left)} of the spending budget is left for the ${daysLeft} ${daysLeft === 1 ? "day" : "days"} left, today included, ${money(Math.floor(left / daysLeft))} a day.`
        : `So far ${money(tracks.spending.spent)} of spending: already ${money(-left)} over the spending budget, with ${daysLeft} ${daysLeft === 1 ? "day" : "days"} left.`,
    );
  } else {
    out.push(`${a.name} is over: ${money(tracks.spending.spent)} of spending against the ${money(tracks.spending.budget)} budget.`);
  }
  if (held && daysLeft > 0 && tracks.spending.remaining > 0) {
    const left = tracks.spending.remaining;
    const safe = Math.max(0, held.safe);
    out.push(
      safe < left
        ? `Against the money: ${money(safe)} is safe to spend until ${a.name} ends, ${money(left - safe)} less than the spending budget left, so the money allows ${money(Math.floor(safe / daysLeft))} a day, not ${money(Math.floor(left / daysLeft))}, unless more comes in. The budget cannot be kept from what is held now.`
        : `Against the money: ${money(safe)} is safe to spend until ${a.name} ends, which covers the ${money(left)} of the spending budget left.`,
    );
  }
  return out.join(" ");
}

/**
 * Why a month is over its budget, item by item against the usual month.
 *
 * "why is this month over the budget" was answered from the month's total
 * alone. What makes a month over is the items that ran above their normal:
 * each item this month against its median over the six months before it,
 * the same usual month the recommendation uses, so the two always agree.
 */
export function whyOver(
  transactions: readonly Transaction[],
  budget: { readonly spending: Centavos; readonly billsSubs: Centavos },
  year: number,
  month: number,
  asOf: IsoDate,
  /** The usual month already worked out for this month, so a caller's figures and these agree. */
  given?: BudgetAdvice,
): string[] {
  const rows = transactions.filter((t) => !(t as Transaction & { deletedAt?: string }).deletedAt);
  const key = `${year}-${String(month).padStart(2, "0")}`;
  const inMonth = rows.filter((t) => t.date.startsWith(key));
  const totals = totalsFor(inMonth);
  const spent = totals.spending + totals.fees + totals.interest;
  const bills = totals.bills + totals.subscriptions;
  const total = budget.spending + budget.billsSubs;
  if (total === 0) return [];
  const usual = given && given.year === year && given.month === month ? given : budgetAdvice({ transactions: rows, year, month, asOf });
  const usualOf = new Map([...usual.items, ...usual.sometimes.map((l) => ({ ...l, amount: 0 }))].map((l) => [l.name.toLowerCase(), l.amount]));
  const range = { start: makeDate(year, month, 1), end: makeDate(year, month, daysInMonth(year, month)) };
  const now = [...spendingAttribution(inMonth, range)].filter(([n]) => !/^transaction fee$/i.test(n));
  const lines: string[] = [];
  const over = spent + bills - total;
  lines.push(
    `Budget ${money(total)} (spending ${money(budget.spending)}, bills and subscriptions ${money(budget.billsSubs)}); spent ${money(spent + bills)}, ${over > 0 ? `over by ${money(over)}` : `${money(-over)} left`}.`,
  );
  lines.push(
    `Spending part: ${money(spent)} of ${money(budget.spending)}, ${spent > budget.spending ? `over by ${money(spent - budget.spending)}` : `${money(budget.spending - spent)} left`}. Bills and subscriptions part: ${money(bills)} of ${money(budget.billsSubs)}, ${bills > budget.billsSubs ? `over by ${money(bills - budget.billsSubs)}` : `${money(budget.billsSubs - bills)} left`}.`,
  );
  const above = now
    .map(([n, amount]) => ({ n, amount, usual: usualOf.get(n.toLowerCase()) ?? 0 }))
    .filter((r) => r.amount > r.usual)
    .sort((a, b) => b.amount - b.usual - (a.amount - a.usual));
  if (above.length > 0) {
    lines.push(`Items above their usual month (the median of ${monthsRead(usual.read)}), most above first:`);
    // Something a usual month does not have is said so, never "usually PHP 0.00" (12 October 2026 audit, A17).
    for (const r of above.slice(0, 8)) lines.push(r.usual > 0 ? `- ${r.n}: ${money(r.amount)}, usually ${money(r.usual)}, ${money(r.amount - r.usual)} more` : `- ${r.n}: ${money(r.amount)}, not in a usual month`);
  }
  if (totals.interest > 0) lines.push(`- Debt interest and charges: ${money(totals.interest)}, usually ${money(usual.interest)}`);
  const below = now.map(([n, amount]) => ({ n, amount, usual: usualOf.get(n.toLowerCase()) ?? 0 })).filter((r) => r.amount < r.usual);
  const missing = usual.items.filter((l) => !now.some(([n]) => n.toLowerCase() === l.name.toLowerCase()));
  if (below.length + missing.length > 0) {
    lines.push(`Below their usual month: ${[...below.map((r) => `${r.n} ${money(r.amount)} (usually ${money(r.usual)})`), ...missing.map((l) => `${l.name} nothing (usually ${money(l.amount)})`)].slice(0, 8).join(", ")}.`);
  }
  return lines;
}

/**
 * A budget asked for a day or a week, not a month: "Give me a proposed
 * budget for this week", "what budget do you recommend for today?". It was
 * answered with next month's whole budget (backup of 7 October 2026). A
 * month named as well keeps it a month's question.
 */
export function asksShortBudget(text: string, asOf: IsoDate): boolean {
  if (!asksBudgetAdvice(text) || adviceMonthIn(text, asOf) !== null) return false;
  if (/\b(?:this|next|the)\s+week\b|\bweekly\b|\bfor\s+(?:today|tomorrow|tonight)\b|\bper\s+(?:day|week)\b|\b(?:a|each|every)\s+(?:day|week)\b|\bdaily\b|\bngayong\s+(?:araw|linggo)\b|\bbukas\b/i.test(text)) return true;
  // A run of days, "next 3 days", "this weekend", "oct 13 to 15": what is safe over it, never next month's budget (MODEL-5).
  if (/\b(?:next|coming|following)\s+(?:\d+|few|two|three|four|five|six|seven|couple(?:\s+of)?)\s+days?\b|\b(?:this|the|next)\s+weekend\b|\bweekend\b/i.test(text)) return true;
  const days = daysIn(text, asOf);
  return days !== null && days.to >= days.from && daysBetween(days.from, days.to) < 27;
}

