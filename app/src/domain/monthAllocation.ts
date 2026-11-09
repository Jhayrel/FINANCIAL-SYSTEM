/**
 * Allocations: money set aside, for one month, for one kind of spending that
 * happens again and again in it (docs/17-ALLOCATIONS.md).
 *
 * The owner, 4 November 2026, with the notes they kept by hand: "800 - gas
 * for 4 weeks 200 per week", "the goal is to set aside a plan budget like
 * example for gas 1200 and 300 per week". Nothing here is stored but the
 * lines themselves: what was spent against each is worked out from the ledger
 * every time, so an edit, a bin or a restore moves the money at once (A4).
 *
 * Not `allocation.ts`, which is the older daily split of safe to spend (spec
 * rule 5.7) and a different thing.
 *
 * Pure: no React, no storage. Money is integer centavos throughout.
 */
import { spreadCovered } from "./covers";
import { daysInMonth, firstOfMonth, formatMedium, lastOfMonth, monthName } from "./dates";
import { formatMoney, type Centavos } from "./money";
import { costOf } from "./totals";
import type { IsoDate, ReferenceLists, Transaction } from "./types";

/** How the month's amount is made up, and the pace it is checked against (A6). */
export type AllocationPace = "week" | "time";

export interface AllocationLine {
  readonly id: string;
  /** The month it is for: "2026-11". */
  readonly month: string;
  /** What the owner calls it. The kind when not given. */
  readonly name: string;
  /** The kind of spending whose entries count against it (a spending type). */
  readonly kind: string;
  /** Only entries of that kind whose description or notes say one of these, comma between. Empty for every entry of it. */
  readonly words: string;
  /** For the whole month. */
  readonly amount: Centavos;
  /** "₱300.00 a week": each, and how many (A6). Absent for a plain monthly amount. */
  readonly each?: Centavos | undefined;
  readonly times?: number | undefined;
  readonly per?: AllocationPace | undefined;
  /** Where it is paid from, for "need to withdraw" (A11). Empty when not said. */
  readonly wallet: string;
  /** The day it was made. */
  readonly createdOn: IsoDate;
  /**
   * The day it was removed: kept, shown under Removed, and put back with one
   * press, as a skipped plan is (A7; owner, 8 November 2026: "in planner even
   * the skip can see and I can pull it back"). A removed line holds nothing.
   */
  readonly removedOn?: IsoDate | undefined;
}

/** What the form and the chat hand in. */
export interface AllocationInput {
  readonly name?: string | undefined;
  readonly kind: string;
  readonly words?: string | undefined;
  readonly amount: Centavos | null;
  readonly each?: Centavos | null | undefined;
  readonly times?: number | null | undefined;
  readonly per?: AllocationPace | undefined;
  readonly wallet?: string | undefined;
}

/** One change to the allocations, from Budget or the chat: the one path every change takes. */
export type AllocationChange =
  | { readonly kind: "add"; readonly month: string; readonly input: AllocationInput }
  | { readonly kind: "edit"; readonly id: string; readonly input: AllocationInput }
  | { readonly kind: "remove"; readonly id: string }
  | { readonly kind: "restore"; readonly id: string }
  | { readonly kind: "copy"; readonly from: string; readonly to: string };

export const MAX_LINES_A_MONTH = 30;
const MAX_AMOUNT: Centavos = 100_000_000_000;

/** "2026-11" from a day. */
export const monthOfDay = (d: IsoDate): string => d.slice(0, 7);

/** "November 2026". */
export function monthWords(ym: string): string {
  return `${monthName(Number(ym.slice(5, 7)))} ${ym.slice(0, 4)}`;
}

/** The month before: "2026-10" for "2026-11", "2025-12" for "2026-01". */
export function monthBefore(ym: string): string {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** The month after. */
export function monthAfter(ym: string): string {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/** The lines of one month that hold money, in the order they were made. Removed lines are not among them. */
export function linesIn(lines: readonly AllocationLine[] | undefined, ym: string): AllocationLine[] {
  return (lines ?? []).filter((l) => l.month === ym && !l.removedOn);
}

/** The lines of one month that were removed, newest removed first: shown under Removed, each to put back. */
export function removedIn(lines: readonly AllocationLine[] | undefined, ym: string): AllocationLine[] {
  return (lines ?? []).filter((l) => l.month === ym && l.removedOn).sort((a, b) => (b.removedOn ?? "").localeCompare(a.removedOn ?? ""));
}

/** The words a line looks for, lower case. Each matches at the start of a word: "gym" finds "gym" and "gyms", never "agym". */
function wordsOf(line: Pick<AllocationLine, "words">): string[] {
  return line.words
    .split(/[,;]+/)
    .map((w) => w.trim().toLowerCase())
    .filter((w) => w.length > 0);
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whether an entry counts against a line: its kind, and one of its words when it has any (A4). */
export function countsAgainst(t: Pick<Transaction, "item" | "description" | "notes">, line: Pick<AllocationLine, "kind" | "words">): boolean {
  if (t.item.trim().toLowerCase() !== line.kind.trim().toLowerCase()) return false;
  const words = wordsOf(line);
  if (words.length === 0) return true;
  const said = `${t.description} ${t.notes}`.toLowerCase();
  return words.some((w) => new RegExp(`(?<![a-z0-9])${escape(w)}`, "i").test(said));
}

/** A line's kind and words, as one key: two live lines with the same key in a month are the same allocation twice. */
export function lineKey(line: Pick<AllocationLine, "kind" | "words">): string {
  return `${line.kind.trim().toLowerCase()}|${wordsOf(line).join(",")}`;
}

/**
 * The one line an entry counts against (A4): the first made whose words it
 * says, else the line for the whole kind. Never two: Self Care for everything
 * and Gym for "gym" are two envelopes, and a gym entry counted against both
 * took its cost out of both, so spending ₱100.00 at the gym raised safe to
 * spend by ₱100.00 (scenario analysis, 9 November 2026).
 */
export function lineFor<L extends Pick<AllocationLine, "kind" | "words">>(t: Pick<Transaction, "item" | "description" | "notes">, lines: readonly L[]): L | null {
  const ofKind = lines.filter((l) => l.kind.trim().toLowerCase() === t.item.trim().toLowerCase());
  return ofKind.find((l) => wordsOf(l).length > 0 && countsAgainst(t, l)) ?? ofKind.find((l) => wordsOf(l).length === 0) ?? null;
}

/** The name the owner sees: theirs, else the kind with its words. */
export function lineName(line: Pick<AllocationLine, "name" | "kind" | "words">): string {
  if (line.name.trim()) return line.name.trim();
  const words = wordsOf(line);
  return words.length > 0 ? `${line.kind} (${words.join(", ")})` : line.kind;
}

/** The week of the month a day falls in: 1 for the 1st to the 7th ... 5 for the 29th on (A6). */
export function weekOfMonth(d: IsoDate): number {
  return Math.floor((Number(d.slice(8, 10)) - 1) / 7) + 1;
}

/** The days of a week of the month, the pace's last week running to the month's end. */
export function weekDays(ym: string, week: number, weeksInPace: number): { readonly from: IsoDate; readonly to: IsoDate } {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));
  const days = daysInMonth(y, m);
  const fromDay = (week - 1) * 7 + 1;
  // Four weeks of a 30 day month: the fourth runs to the 30th.
  const toDay = week >= weeksInPace ? days : Math.min(days, week * 7);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return { from: `${ym}-${pad(Math.min(fromDay, days))}`, to: `${ym}-${pad(toDay)}` };
}

export interface AllocationWeek {
  /** 1 to the number of weeks in the pace. */
  readonly index: number;
  readonly from: IsoDate;
  readonly to: IsoDate;
  /** This week's share: each. */
  readonly share: Centavos;
  readonly spent: Centavos;
  /** Share less spent; negative when past it. */
  readonly left: Centavos;
}

export interface AllocationStatus {
  readonly line: AllocationLine;
  readonly name: string;
  /** What counts against it this month. */
  readonly spent: Centavos;
  /** Amount less spent; negative when over. */
  readonly left: Centavos;
  /** How far past it, 0 when not. */
  readonly over: Centavos;
  /** What it holds out of safe to spend: only in the running month, never below zero, plans inside counted once (A5). */
  readonly held: Centavos;
  /** How many entries counted. */
  readonly entries: number;
  /** Counted today, and how much of that the allocation covered (A5: today's share is not used by it). */
  readonly spentToday: Centavos;
  readonly coveredToday: Centavos;
  /** The week running, for a "week" pace in the running month. */
  readonly week: AllocationWeek | null;
  /** For a "time" pace: how many times used of how many. */
  readonly timesUsed: number | null;
  /** Plans of the same kind this month, held inside this allocation rather than twice (A5). */
  readonly plansInside: readonly { readonly id: string; readonly title: string; readonly left: Centavos }[];
  /**
   * The name of the line made before it with the same kind and words, when
   * this one repeats it: two phones adding Gas offline, or a merge. It holds
   * nothing and counts nothing, and is reported to be removed (A7), never
   * removed by itself.
   */
  readonly twinOf: string | null;
}

/** A plan as the allocations need it: its kind, its title and notes, what is left and whether it counts this month. */
export interface PlanHold {
  readonly id: string;
  readonly title: string;
  readonly item: string;
  readonly notes: string;
  readonly left: Centavos;
  readonly counts: boolean;
}

export interface MonthAllocations {
  readonly month: string;
  /** "running", "past" or "ahead", from the day it is read on. */
  readonly phase: "running" | "past" | "ahead";
  readonly lines: readonly AllocationStatus[];
  readonly allocated: Centavos;
  readonly spent: Centavos;
  /** What every line holds, together: what safe to spend loses (A5). */
  readonly held: Centavos;
  /** Over, together. */
  readonly over: Centavos;
  /** Unused, together: what was left when a past month ended. */
  readonly unused: Centavos;
  /** Covered today, together. */
  readonly coveredToday: Centavos;
  /** The plans held inside allocations, by id: the Planner's hold leaves these out (A5). */
  readonly plansInside: ReadonlySet<string>;
}

/**
 * The month's allocations against the ledger.
 *
 * `rows` are the rows the budget reads (an entry over several days is a row a
 * day), so an allocation agrees with the Budget screen to the centavo.
 */
export function monthAllocations(
  lines: readonly AllocationLine[] | undefined,
  rows: readonly Transaction[],
  ym: string,
  asOf: IsoDate,
  plans: readonly PlanHold[] = [],
  /** The wallets today's share is spent from: only what left them is covered today (A5). All when not given. */
  spendingWallets?: ReadonlySet<string>,
): MonthAllocations {
  // In the order they were made, so "the first made" means the same thing on every device.
  const mine = linesIn(lines, ym).sort((a, b) => a.createdOn.localeCompare(b.createdOn));
  const firstOfKey = new Map<string, AllocationLine>();
  for (const l of mine) if (!firstOfKey.has(lineKey(l))) firstOfKey.set(lineKey(l), l);
  const counting = mine.filter((l) => firstOfKey.get(lineKey(l)) === l);
  const now = monthOfDay(asOf);
  const phase = ym === now ? "running" : ym < now ? "past" : "ahead";
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));
  const from = firstOfMonth(y, m);
  const to = lastOfMonth(y, m);
  const inMonth = mine.length === 0 ? [] : rows.filter((t) => t.date >= from && t.date <= to && !(t as Transaction & { deletedAt?: string }).deletedAt && costOf(t) > 0);
  const taken = new Set<string>();
  const byLine = new Map<string, Transaction[]>();
  for (const t of inMonth) {
    const l = lineFor(t, counting);
    if (l) byLine.set(l.id, [...(byLine.get(l.id) ?? []), t]);
  }
  const statuses: AllocationStatus[] = mine.map((line) => {
    const first = firstOfKey.get(lineKey(line))!;
    if (first !== line) {
      return { line, name: lineName(line), spent: 0, left: 0, over: 0, held: 0, entries: 0, spentToday: 0, coveredToday: 0, week: null, timesUsed: null, plansInside: [], twinOf: lineName(first) };
    }
    const counted = byLine.get(line.id) ?? [];
    const spent = counted.reduce((s, t) => s + costOf(t), 0);
    const left = line.amount - spent;
    const todays = counted.filter((t) => t.date === asOf).reduce((s, t) => s + costOf(t), 0);
    const before = spent - todays - counted.filter((t) => t.date > asOf).reduce((s, t) => s + costOf(t), 0);
    const fromWallets = spendingWallets ? counted.filter((t) => t.date === asOf && spendingWallets.has(t.fromWallet)).reduce((s, t) => s + costOf(t), 0) : todays;
    const coveredToday = phase === "running" ? Math.min(fromWallets, Math.max(0, line.amount - before)) : 0;
    // Plans of this kind, counted this month, that its words would take in (A5).
    const inside =
      phase === "running"
        ? plans.filter((p) => p.counts && p.left > 0 && !taken.has(p.id) && lineFor({ item: p.item, description: p.title, notes: p.notes }, counting) === line)
        : [];
    for (const p of inside) taken.add(p.id);
    const insideLeft = inside.reduce((s, p) => s + p.left, 0);
    const held = phase === "running" ? Math.max(Math.max(0, left), insideLeft) : 0;
    let week: AllocationWeek | null = null;
    if (phase === "running" && line.per === "week" && line.each && line.times) {
      const index = Math.min(weekOfMonth(asOf), line.times);
      const days = weekDays(ym, index, line.times);
      const weekSpent = counted.filter((t) => t.date >= days.from && t.date <= days.to).reduce((s, t) => s + costOf(t), 0);
      week = { index, from: days.from, to: days.to, share: line.each, spent: weekSpent, left: line.each - weekSpent };
    }
    const entries = new Set(counted.map((t) => t.coveredBy ?? t.id)).size;
    return {
      line,
      name: lineName(line),
      spent,
      left,
      over: Math.max(0, -left),
      held,
      entries,
      spentToday: todays,
      coveredToday,
      week,
      timesUsed: line.per === "time" && line.times ? entries : null,
      plansInside: inside.map((p) => ({ id: p.id, title: p.title, left: p.left })),
      twinOf: null,
    };
  });
  const sum = (pick: (s: AllocationStatus) => Centavos): Centavos => statuses.reduce((t, s) => t + pick(s), 0);
  return {
    month: ym,
    phase,
    lines: statuses,
    // A repeated line is not money set aside twice.
    allocated: sum((s) => (s.twinOf ? 0 : s.line.amount)),
    spent: sum((s) => s.spent),
    held: sum((s) => s.held),
    over: sum((s) => s.over),
    unused: phase === "past" ? sum((s) => Math.max(0, s.left)) : 0,
    coveredToday: sum((s) => s.coveredToday),
    plansInside: taken,
  };
}

/** What a month's lines come to, before anything is spent. */
export function allocatedIn(lines: readonly AllocationLine[] | undefined, ym: string): Centavos {
  return linesIn(lines, ym).reduce((s, l) => s + l.amount, 0);
}

// ── Making and changing ────────────────────────────────────────────────────

/** The month's amount from what was said: each times how many, else the amount. */
export function amountOf(input: Pick<AllocationInput, "amount" | "each" | "times">): Centavos | null {
  if (input.each && input.each > 0 && input.times && input.times > 0) return input.each * input.times;
  return input.amount && input.amount > 0 ? input.amount : null;
}

/** Bills and subscriptions are held already: never allocated (A4). */
export function isBillKind(kind: string, reference: Pick<ReferenceLists, "bills" | "subscriptions">): boolean {
  const k = kind.trim().toLowerCase();
  return [...reference.bills, ...reference.subscriptions].some((b) => b.trim().toLowerCase() === k) || /^(?:bills?|subscriptions?)$/i.test(kind.trim());
}

/** The kinds an allocation can be on: the spending types, bills and subscriptions apart. */
export function allocatableKinds(reference: Pick<ReferenceLists, "spendingTypes" | "bills" | "subscriptions">): string[] {
  return reference.spendingTypes.map((t) => t.name).filter((n) => n.trim() && !isBillKind(n, reference));
}

/**
 * What stops a line being saved, in words, or null when it can be. `others`
 * are the allocations as they are (the one being changed left out); removed
 * lines do not count.
 */
export function checkAllocation(
  input: AllocationInput,
  ym: string,
  others: readonly AllocationLine[],
  reference: Pick<ReferenceLists, "spendingTypes" | "bills" | "subscriptions" | "wallets" | "savings">,
): string | null {
  const kind = input.kind.trim();
  if (!kind) return "Pick the kind of spending it is for.";
  if (isBillKind(kind, reference)) return `${kind} is a bill or subscription. Those are held already as bills still to pay, so they are not allocated.`;
  if (!reference.spendingTypes.some((t) => t.name.trim().toLowerCase() === kind.toLowerCase())) return `${kind} is not one of your kinds of spending. Add it in Settings, Categories first.`;
  const amount = amountOf(input);
  if (amount === null) return "Say how much: an amount for the month, or how much a week and for how many weeks.";
  if (amount > MAX_AMOUNT) return "That amount is too large to be right. Check it.";
  if (input.times !== undefined && input.times !== null && (input.times < 1 || input.times > 31 || !Number.isInteger(input.times))) return "How many times is a whole number from 1 to 31.";
  if (input.wallet && ![...reference.wallets, ...reference.savings].includes(input.wallet)) return `${input.wallet} is not one of your accounts.`;
  const live = linesIn(others, ym);
  const key = lineKey({ kind, words: input.words ?? "" });
  const twin = live.find((o) => lineKey(o) === key);
  if (twin) return `${monthWords(ym)} has an allocation for ${lineName(twin)} already. Edit that one.`;
  if (live.length >= MAX_LINES_A_MONTH) return `${monthWords(ym)} has ${MAX_LINES_A_MONTH} allocations, the most a month holds.`;
  return null;
}

/** Why a removed line cannot be put back, or null when it can: one line a kind a month. */
export function checkRestore(line: AllocationLine, all: readonly AllocationLine[]): string | null {
  const twin = linesIn(all, line.month).find((o) => o.id !== line.id && lineKey(o) === lineKey(line));
  if (twin) return `${monthWords(line.month)} has an allocation for ${lineName(twin)} already. Change that one instead.`;
  if (linesIn(all, line.month).length >= MAX_LINES_A_MONTH) return `${monthWords(line.month)} has ${MAX_LINES_A_MONTH} allocations, the most a month holds.`;
  return null;
}

/** A new line. Check it with `checkAllocation` first. */
export function makeAllocation(input: AllocationInput, ym: string, asOf: IsoDate, id: string): AllocationLine {
  const amount = amountOf(input) ?? 0;
  const paced = Boolean(input.each && input.each > 0 && input.times && input.times > 0 && input.per);
  return {
    id,
    month: ym,
    name: (input.name ?? "").trim(),
    kind: input.kind.trim(),
    words: (input.words ?? "").trim(),
    amount,
    ...(paced ? { each: input.each as Centavos, times: input.times as number, per: input.per } : {}),
    wallet: (input.wallet ?? "").trim(),
    createdOn: asOf,
  };
}

/** A line changed: what the form says now, the id, month and day made kept. */
export function editAllocation(line: AllocationLine, input: AllocationInput): AllocationLine {
  return makeAllocation(input, line.month, line.createdOn, line.id);
}

/** A line as the form shows it, to be changed. */
export function inputOfLine(l: AllocationLine): AllocationInput {
  return { name: l.name, kind: l.kind, words: l.words, amount: l.amount, each: l.each ?? null, times: l.times ?? null, ...(l.per ? { per: l.per } : {}), wallet: l.wallet };
}

/**
 * Last month's lines for this one: amounts and pace, never what was left
 * (A7). Lines already there for a kind are kept as they are; removed lines
 * are not copied.
 */
export function copyLines(lines: readonly AllocationLine[] | undefined, from: string, to: string, asOf: IsoDate, newId: () => string): AllocationLine[] {
  const there = linesIn(lines, to);
  const have = new Set(there.map(lineKey));
  const seen = new Set<string>();
  return linesIn(lines, from)
    // A line already there is kept, and a month's twin is copied once.
    .filter((l) => !have.has(lineKey(l)) && !seen.has(lineKey(l)) && Boolean(seen.add(lineKey(l))))
    .slice(0, Math.max(0, MAX_LINES_A_MONTH - there.length))
    .map((l) => {
      const { removedOn: _gone, ...rest } = l;
      return { ...rest, id: newId(), month: to, createdOn: asOf };
    });
}

/** A kind or a wallet renamed in Settings: the lines on it follow (A7). */
export function renameAllocations(lines: readonly AllocationLine[] | undefined, field: "kind" | "wallet", from: string, to: string): AllocationLine[] {
  return (lines ?? []).map((l) => (field === "kind" ? (l.kind === from ? { ...l, kind: to } : l) : l.wallet === from ? { ...l, wallet: to } : l));
}

/** Whatever came back from storage, as lines: anything malformed is left out rather than crashing a screen. */
export function normaliseAllocations(raw: unknown): AllocationLine[] {
  if (!Array.isArray(raw)) return [];
  const out: AllocationLine[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const l = r as Record<string, unknown>;
    if (typeof l.id !== "string" || typeof l.month !== "string" || !/^\d{4}-\d{2}$/.test(l.month)) continue;
    if (typeof l.kind !== "string" || !l.kind.trim()) continue;
    if (typeof l.amount !== "number" || !Number.isInteger(l.amount) || l.amount <= 0) continue;
    const paced =
      typeof l.each === "number" && Number.isInteger(l.each) && l.each > 0 && typeof l.times === "number" && Number.isInteger(l.times) && l.times > 0 && (l.per === "week" || l.per === "time");
    out.push({
      id: l.id,
      month: l.month,
      name: typeof l.name === "string" ? l.name : "",
      kind: l.kind,
      words: typeof l.words === "string" ? l.words : "",
      amount: l.amount,
      ...(paced ? { each: l.each as number, times: l.times as number, per: l.per as AllocationPace } : {}),
      wallet: typeof l.wallet === "string" ? l.wallet : "",
      createdOn: typeof l.createdOn === "string" ? l.createdOn : `${l.month}-01`,
      ...(typeof l.removedOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(l.removedOn) ? { removedOn: l.removedOn } : {}),
    });
  }
  return out;
}

// ── Need to withdraw (A11) ─────────────────────────────────────────────────

export interface WalletNeed {
  readonly wallet: string;
  /** What the month's allocations paid from it still hold. */
  readonly needs: Centavos;
  readonly holds: Centavos;
  /** What it lacks: needs less holds, 0 when it holds enough. */
  readonly short: Centavos;
}

export function walletNeeds(month: MonthAllocations, balanceOf: (wallet: string) => Centavos): WalletNeed[] {
  const by = new Map<string, Centavos>();
  for (const s of month.lines) if (s.line.wallet && s.held > 0) by.set(s.line.wallet, (by.get(s.line.wallet) ?? 0) + s.held);
  return [...by.entries()].map(([wallet, needs]) => {
    const holds = balanceOf(wallet);
    return { wallet, needs, holds, short: Math.max(0, needs - Math.max(0, holds)) };
  });
}

// ── Words ──────────────────────────────────────────────────────────────────

const php = (c: Centavos): string => formatMoney(c);

/** "₱300.00 a week, 4 weeks" or "₱50.00 a time, 8 times", or "" for a plain monthly amount. */
export function paceWords(line: Pick<AllocationLine, "each" | "times" | "per">): string {
  if (!line.each || !line.times || !line.per) return "";
  return line.per === "week"
    ? `${php(line.each)} a week, ${line.times} ${line.times === 1 ? "week" : "weeks"}`
    : `${php(line.each)} a time, ${line.times} ${line.times === 1 ? "time" : "times"}`;
}

/** One line in a sentence: "Gas: ₱300.00 spent of ₱1,200.00, ₱900.00 left (week 1: ₱300.00 of ₱300.00)". */
export function statusWords(s: AllocationStatus, phase: MonthAllocations["phase"]): string {
  const head = `${s.name}: ${php(s.spent)} spent of ${php(s.line.amount)}`;
  const tail = s.over > 0 ? `, ${php(s.over)} over` : phase === "past" ? (s.left > 0 ? `, ${php(s.left)} not used` : ", all of it used") : `, ${php(s.left)} left`;
  const week = s.week ? ` (week ${s.week.index}: ${php(s.week.spent)} of ${php(s.week.share)}${s.week.left < 0 ? `, ${php(-s.week.left)} past it` : ""})` : "";
  const times = s.timesUsed !== null && s.line.times ? ` (${s.timesUsed} of ${s.line.times} times)` : "";
  const inside = s.plansInside.length > 0 ? ` Held once with the plan${s.plansInside.length === 1 ? "" : "s"} ${s.plansInside.map((p) => `"${p.title}"`).join(", ")}.` : "";
  return `${head}${tail}${week}${times}.${inside}`;
}

/** The month's allocations as the chat and the model are told them. */
export function monthWordsFor(month: MonthAllocations): string {
  if (month.lines.length === 0) return `No allocations for ${monthWords(month.month)}.`;
  const lines = month.lines.map((s) => `- ${statusWords(s, month.phase)}`);
  const total =
    month.phase === "running"
      ? `Allocated ${php(month.allocated)}, spent ${php(month.spent)}; ${php(month.held)} is set aside out of safe to spend.${month.over > 0 ? ` ${php(month.over)} went over, out of money that was free.` : ""}`
      : month.phase === "past"
        ? `Allocated ${php(month.allocated)}, spent ${php(month.spent)}.${month.unused > 0 ? ` ${php(month.unused)} was not used.` : ""}${month.over > 0 ? ` ${php(month.over)} went over.` : ""}`
        : `Allocated ${php(month.allocated)}. Nothing is held until ${monthWords(month.month)} starts.`;
  return [`Allocations for ${monthWords(month.month)}:`, ...lines, total].join("\n");
}

/** What the Add form says under a kind with an allocation, and whether this entry takes it over. */
export function addFormNote(
  month: MonthAllocations,
  kind: string,
  words: { readonly description: string; readonly notes: string },
  cost: Centavos,
): { readonly text: string; readonly over: boolean } | null {
  const line = lineFor({ item: kind, description: words.description, notes: words.notes }, month.lines.filter((x) => !x.twinOf).map((x) => x.line));
  const s = line ? month.lines.find((x) => x.line === line) : undefined;
  if (!s) return null;
  const left = Math.max(0, s.left);
  const after = left - Math.max(0, cost);
  const week = s.week ? ` (this week ${php(Math.max(0, s.week.left))} of ${php(s.week.share)} left)` : "";
  // Already past it: every peso of this is out of safe to spend, said as this entry's own figure.
  if (s.over > 0) {
    return {
      text:
        cost > 0
          ? `${s.name} is already ${php(s.over)} over its ${php(s.line.amount)} allocation, so all ${php(cost)} of this comes out of safe to spend.`
          : `${s.name} is already ${php(s.over)} over its ${php(s.line.amount)} allocation: more of it comes out of safe to spend.`,
      over: true,
    };
  }
  if (cost > 0 && after < 0) {
    return {
      text: `This takes ${s.name} ${php(-after)} over its ${php(s.line.amount)} allocation: ${left > 0 ? `${php(left)} of this is covered by what is left of it, and ` : ""}${php(-after)} comes out of safe to spend.`,
      over: true,
    };
  }
  return { text: `${s.name} allocation: ${php(Math.max(0, s.left))} of ${php(s.line.amount)} left${week}${cost > 0 ? `, ${php(after)} after this` : ""}.`, over: false };
}

/**
 * The Add form's note for an entry as it will be saved (A8): its rows, spread
 * a day each as the budget reads them, against the month it falls in. The
 * entry being edited is left out of what is already spent, so changing a
 * ₱300.00 gas entry to ₱350.00 is ₱50.00 more, never ₱350.00 more.
 */
export function entryAllocationNote(
  lines: readonly AllocationLine[] | undefined,
  ledger: readonly Transaction[],
  entry: readonly Transaction[],
  editingId: string | null,
  asOf: IsoDate,
): { readonly text: string; readonly over: boolean } | null {
  const main = entry[0];
  if (!main || !lines || lines.length === 0) return null;
  const ym = monthOfDay(main.date);
  const others = editingId ? ledger.filter((t) => t.id !== editingId && t.partOf !== editingId) : ledger;
  const month = monthAllocations(lines, spreadCovered(others), ym, asOf);
  if (month.lines.length === 0 || month.phase === "past") return null;
  const cost = spreadCovered(entry).filter((r) => monthOfDay(r.date) === ym).reduce((sum, r) => sum + Math.max(0, costOf(r)), 0);
  return addFormNote(month, main.item, { description: main.description, notes: main.notes }, cost);
}

/**
 * A kind's allocation in a word, for the lists of where money went (Dashboard,
 * Insights): "₱600.00 left of its ₱1,200.00 allocation", "₱200.00 over its
 * ₱1,200.00 allocation", or, for a month that ended, "₱300.00 of its ₱1,200.00
 * allocation not used". Every live line of the kind together; none, nothing.
 */
export function kindAllocationWords(month: MonthAllocations | null | undefined, kind: string): { readonly text: string; readonly over: boolean } | undefined {
  if (!month) return undefined;
  const mine = month.lines.filter((s) => !s.twinOf && s.line.kind.trim().toLowerCase() === kind.trim().toLowerCase());
  if (mine.length === 0) return undefined;
  const amount = mine.reduce((t, s) => t + s.line.amount, 0);
  const over = mine.reduce((t, s) => t + s.over, 0);
  const left = mine.reduce((t, s) => t + Math.max(0, s.left), 0);
  const its = mine.length === 1 ? `its ${php(amount)} allocation` : `its ${mine.length} allocations, ${php(amount)}`;
  if (over > 0) return { text: `${php(over)} over ${its}`, over: true };
  if (month.phase === "past") return { text: left > 0 ? `${php(left)} of ${its} not used` : `All of ${its} used`, over: false };
  return { text: `${php(left)} left of ${its}`, over: false };
}

/** A line said for Activity: "Gas, ₱1,200.00 for November 2026 (₱300.00 a week, 4 weeks), paid from Cash". */
export function lineSummary(l: AllocationLine): string {
  const pace = paceWords(l);
  return `${lineName(l)}, ${php(l.amount)} for ${monthWords(l.month)}${pace ? ` (${pace})` : ""}${l.wallet ? `, paid from ${l.wallet}` : ""}`;
}

// ── The bell (A7) ──────────────────────────────────────────────────────────

export interface AllocationAlert {
  readonly id: string;
  readonly level: "warning" | "info";
  readonly title: string;
  readonly detail: string;
}

/** Over an allocation, past this week's share, and the first-week copy offer. */
export function allocationAlerts(month: MonthAllocations, lines: readonly AllocationLine[] | undefined, asOf: IsoDate): AllocationAlert[] {
  const out: AllocationAlert[] = [];
  if (month.phase !== "running") return out;
  for (const s of month.lines) {
    if (s.twinOf) {
      out.push({
        id: `alloc-twin-${s.line.id}`,
        level: "warning",
        title: `${s.twinOf} is allocated twice in ${monthWords(month.month)}`,
        detail: `Two lines for the same thing, likely added on two devices. The first counts; the second holds nothing until one is removed on Budget, Allocations.`,
      });
      continue;
    }
    if (s.over > 0) {
      out.push({
        id: `alloc-over-${s.line.id}-${s.over}`,
        level: "warning",
        title: `${s.name} is ${php(s.over)} over its allocation`,
        detail: `${php(s.spent)} spent of ${php(s.line.amount)} set aside for ${monthWords(month.month)}. The extra came out of money that was free, so safe to spend is lower by it. Raise the allocation on Budget if this month needs more.`,
      });
    } else if (s.week && s.week.left < 0) {
      out.push({
        id: `alloc-week-${s.line.id}-${s.week.index}`,
        level: "info",
        title: `${s.name} is ${php(-s.week.left)} past this week's share`,
        detail: `${php(s.week.spent)} spent in week ${s.week.index} (${formatMedium(s.week.from)} to ${formatMedium(s.week.to)}) of the ${php(s.week.share)} a week. ${php(Math.max(0, s.left))} is left for the rest of ${monthWords(month.month)}.`,
      });
    }
  }
  // The first week of a month with none, after one that had some: offered, never done.
  const day = Number(asOf.slice(8, 10));
  const before = linesIn(lines, monthBefore(month.month));
  if (month.lines.length === 0 && before.length > 0 && day <= 7) {
    out.push({
      id: `alloc-copy-${month.month}`,
      level: "info",
      title: `No allocations for ${monthWords(month.month)} yet`,
      detail: `${monthWords(monthBefore(month.month))} had ${before.length} (${before.map(lineName).join(", ")}). Copy them on Budget, Allocations, and change what this month needs.`,
    });
  }
  return out;
}
