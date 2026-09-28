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
import { daysInMonth, makeDate, monthName } from "./dates";
import { costOf, incomeOf, spendingAttribution, totalsFor } from "./totals";
import { forecastYear } from "./forecast";
import type { Debt } from "./debt";
import type { IsoDate, Transaction } from "./types";

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
  /** The spending track: items, fees and interest. */
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
}

export function budgetAdvice(input: AdviceInput): BudgetAdvice {
  const { year, month, asOf } = input;
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
  for (let n = 1; n <= REACH && read.length < WINDOW; n += 1) {
    const m = back(year, month, n);
    const k = key(m.year, m.month);
    // A month still to come has nothing to say about a normal one.
    if (k > asOf.slice(0, 7)) continue;
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
  const spending = items.reduce((sum, l) => sum + l.amount, 0) + feeLine + interestLine;
  const billsSubs = [...bills, ...subscriptions].reduce((sum, l) => sum + l.amount, 0);
  const debts = input.debts ?? [];
  const asOfMonth = year === Number(asOf.slice(0, 4)) ? Number(asOf.slice(5, 7)) : year < Number(asOf.slice(0, 4)) ? 12 : 0;
  const debtDue = debts.length > 0 ? (forecastYear(rows, year, asOfMonth, debts, asOf)[month - 1]?.debtService ?? 0) : 0;

  // ── 5. Held to what is coming in ───────────────────────────────────────────
  let fit: BudgetAdvice["fit"];
  if (input.income && input.income > 0) {
    const keep = Math.max(0, input.keep ?? 0);
    const room = down(input.income - billsSubs - debtDue - keep);
    if (spending <= room) {
      fit = { income: input.income, room, fits: true, spending, cuts: [], short: 0, keep };
    } else {
      /*
       * The wants give, each by the same share, rather than the largest going
       * to nothing: a month with no Treat at all is not a budget anyone keeps.
       * Only when every want is gone is a need touched, and then it is not
       * cut but reported as the gap.
       */
      const over = spending - Math.max(0, room);
      const wants = items.filter((l) => WANTS.test(l.name));
      const wanted = wants.reduce((sum, l) => sum + l.amount, 0);
      const cuts: { name: string; from: Centavos; to: Centavos }[] =
        wanted <= over
          ? wants.map((l) => ({ name: l.name, from: l.amount, to: 0 }))
          : wants.map((l) => ({ name: l.name, from: l.amount, to: down(Math.floor((l.amount * (wanted - over)) / wanted)) }));
      const after = spending - cuts.reduce((sum, c) => sum + (c.from - c.to), 0);
      fit = { income: input.income, room, fits: false, spending: after, cuts, short: Math.max(0, after - Math.max(0, room)), keep };
    }
  }

  return {
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
export function adviceWords(a: BudgetAdvice, options: { readonly split?: boolean } = {}): string {
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

  if (a.fit) {
    const kept = a.fit.keep > 0 ? ` with ${money(a.fit.keep)} kept to save` : "";
    if (a.fit.fits) {
      out.push(`It fits the ${money(a.fit.income)} you expect${kept}${a.debtDue > 0 ? ` after ${money(a.debtDue)} of debt payments due` : ""}, leaving **${money(a.fit.income - a.total - a.debtDue)}** unspent${a.fit.keep > 0 ? ", your savings included" : " to save"}.`);
    } else {
      const cuts = a.fit.cuts.map((c) => `${c.name} from ${money(c.from)} to ${money(c.to)}`);
      out.push(
        `Your usual month (${money(a.total)}) is more than the ${money(a.fit.income)} you expect${kept}${a.debtDue > 0 ? ` less ${money(a.debtDue)} of debt payments due` : ""}, so the spending part is held to ${money(spendingAt)}${cuts.length > 0 ? `, by cutting ${cuts.join(", ")}` : ""}.`,
      );
      if (a.fit.short > 0) {
        out.push(`Even with every want cut it is **${money(a.fit.short)}** short: the needs alone (${a.items.filter((l) => !WANTS.test(l.name)).map((l) => l.name).join(", ")}) cost more than that leaves. The gap has to come from ${a.fit.keep > 0 ? "saving less this month, " : ""}savings or more income.`);
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
    out.push(`**Spending, ${money(spendingAt)}**, each item's usual month:`);
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
  if (/^\s*(set|change|update|make|put|copy|apply|use|add)\b/.test(text) && !/\?\s*$/.test(text)) return false;
  return (
    // Spelled as typed on a phone: "proporse", "propoised", "reccomend", "sugest".
    /\b(re?c+om+e?n?d\w*|sug+est\w*|prop[a-z]*s[a-z]*|realistic|reasonable|ideal|advi[cs]e)\b/.test(text) ||
    /\bwhat\b[^.?!]{0,20}\bbudget\b[^.?!]{0,15}\b(?:you|u)\b/.test(text) ||
    /\b(magkano|ilan)\b[^.?!]{0,30}\bbudget\b/.test(text) ||
    /\b(what|how much|magkano|ilan)\b[^.?!]{0,40}\bbudget\b[^.?!]{0,20}\b(be|should|dapat|set|for|next|need)\b/.test(text) ||
    /\bwhat\s+(?:should|would|could)\b[^.?!]{0,30}\bbudget\b/.test(text) ||
    /\b(give|make|plan|work out|build|create)\s+(?:me\s+)?(?:a\s+|my\s+)?(?:new\s+|realistic\s+)?budget\b/.test(text)
  );
}

/**
 * What the owner says they will receive: "if I only expect 8000 allowance",
 * "my allowance is 8k", "I'll get 12,000 next month", "sahod ko 15000".
 */
export function expectedIncomeIn(said: string): Centavos | null {
  const text = said.toLowerCase().replace(/(\d+(?:\.\d+)?)\s*k\b/g, (_m, n: string) => String(Math.round(Number(n) * 1000)));
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
  const text = said.toLowerCase();
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
): string[] {
  const rows = transactions.filter((t) => !(t as Transaction & { deletedAt?: string }).deletedAt);
  const key = `${year}-${String(month).padStart(2, "0")}`;
  const inMonth = rows.filter((t) => t.date.startsWith(key));
  const totals = totalsFor(inMonth);
  const spent = totals.spending + totals.fees + totals.interest;
  const bills = totals.bills + totals.subscriptions;
  const total = budget.spending + budget.billsSubs;
  if (total === 0) return [];
  const usual = budgetAdvice({ transactions: rows, year, month, asOf });
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
    for (const r of above.slice(0, 8)) lines.push(`- ${r.n}: ${money(r.amount)}, usually ${money(r.usual)}, ${money(r.amount - r.usual)} more`);
  }
  if (totals.interest > 0) lines.push(`- Debt interest and charges: ${money(totals.interest)}, usually ${money(usual.interest)}`);
  const below = now.map(([n, amount]) => ({ n, amount, usual: usualOf.get(n.toLowerCase()) ?? 0 })).filter((r) => r.amount < r.usual);
  const missing = usual.items.filter((l) => !now.some(([n]) => n.toLowerCase() === l.name.toLowerCase()));
  if (below.length + missing.length > 0) {
    lines.push(`Below their usual month: ${[...below.map((r) => `${r.n} ${money(r.amount)} (usually ${money(r.usual)})`), ...missing.map((l) => `${l.name} nothing (usually ${money(l.amount)})`)].slice(0, 8).join(", ")}.`);
  }
  return lines;
}
