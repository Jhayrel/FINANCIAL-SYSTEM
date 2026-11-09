/**
 * Spending still to come: what the Planner, the bills, the allocations and
 * the debts say is ahead, added up here.
 *
 * The owner, 9 November 2026: "Can you show me a list of future spending".
 * The model listed the open plans and added them up itself, so the app had
 * to warn that its totals were "not figures this app worked out"; then "Pie"
 * drew November's spending so far, the one thing the question was not about.
 * The words had been read as a summary of spending (money already gone).
 *
 * Future spending is everything still due out of the owner's money: open
 * plans (with a date or not yet), the bills and subscriptions not paid this
 * month, what the month's allocations still hold, and debt payments due.
 * Plans to save or to move money are said apart: they are not spending.
 */
import { formatMedium, monthName } from "./dates";
import type { DueDebt } from "./monthPlan";
import type { MonthAllocations } from "./monthAllocation";
import type { MonthBills } from "./budgetView";
import { formatMoney, type Centavos } from "./money";
import { NO_DATE, type PlanView } from "./planner";
import type { Chart, ChartRow } from "./charts";
import type { IsoDate } from "./types";

/** "future spending", "upcoming expenses", "what do I still have to pay", "what's coming up". */
const UPCOMING =
  /\b(?:future|upcoming|coming|incoming|planned|pending|scheduled|ahead)\s+(?:spending|spendings|expenses?|expenditures?|payments?|purchases?|costs?|bills?|gastos)\b|\b(?:spending|expenses?|payments?|costs?|bills)\s+(?:ahead|to come|coming up|still to (?:come|pay)|in the future|later)\b|\bwhat(?:'s| is| do i have)?\s+(?:coming up|still to pay|left to pay|due)\b|\bwhat\s+(?:do|must|should)\s+i\s+(?:still\s+)?(?:have to\s+|need to\s+)?pay\b|\b(?:still|yet)\s+to\s+(?:pay|spend|come)\b|\bgastos(?:in)?\s+(?:na\s+)?(?:darating|sa susunod|babayaran)\b|\bbabayaran\s+ko\s+pa\b/i;

/** Whether the words ask for spending still to come, rather than spending done or a forecast of a usual month. */
export function asksUpcoming(text: string): boolean {
  return UPCOMING.test(text) && !/\b(?:forecast|predict\w*|projection|projected|usual month)\b/i.test(text);
}

export interface UpcomingLine {
  readonly label: string;
  readonly amount: Centavos;
  readonly kind: "plan" | "bill" | "allocation" | "debt";
  /** The day it is due; null for a plan with no date yet or what an allocation holds for the month. */
  readonly when: IsoDate | null;
  /** Late, or past its date. */
  readonly late?: boolean | undefined;
}

export interface Upcoming {
  readonly lines: readonly UpcomingLine[];
  readonly plans: Centavos;
  /** Of `plans`, those with no date yet: not set aside anywhere. */
  readonly noDate: Centavos;
  readonly bills: Centavos;
  readonly allocations: Centavos;
  readonly debts: Centavos;
  readonly total: Centavos;
  /** Plans to save or move money, or to pay a debt: said apart, never spending. */
  readonly apart: readonly { readonly label: string; readonly amount: Centavos; readonly when: IsoDate | null; readonly what: "save" | "debt" }[];
}

/** Everything still to come, from the screens' own figures. */
export function upcomingOf(input: {
  readonly views: readonly PlanView[];
  readonly bills: MonthBills | null;
  readonly allocations?: MonthAllocations | null | undefined;
  readonly debts: readonly DueDebt[];
}): Upcoming {
  const lines: UpcomingLine[] = [];
  const apart: Upcoming["apart"][number][] = [];
  for (const v of input.views) {
    if (v.state === "paid" || v.state === "skipped" || v.state === "removed" || v.left <= 0) continue;
    const when = v.plan.due === NO_DATE ? null : v.plan.due;
    if (v.plan.into || v.plan.debtId) {
      apart.push({ label: v.plan.title, amount: v.left, when, what: v.plan.into ? "save" : "debt" });
      continue;
    }
    lines.push({ label: v.plan.title, amount: v.left, kind: "plan", when, ...(v.state === "overdue" ? { late: true } : {}) });
  }
  for (const b of input.bills?.bills ?? []) {
    if (b.state === "paid" || b.amount <= 0) continue;
    lines.push({ label: b.item, amount: b.amount, kind: "bill", when: b.dueOn ?? null, ...(b.state === "late" || b.state === "missed" ? { late: true } : {}) });
  }
  for (const s of input.allocations?.lines ?? []) {
    if (s.twinOf || s.done || s.left <= 0) continue;
    lines.push({ label: `${s.name} allocation`, amount: s.left, kind: "allocation", when: null });
  }
  for (const d of input.debts) {
    if (d.amount <= 0) continue;
    lines.push({ label: d.name, amount: d.amount, kind: "debt", when: d.dueOn, ...(d.daysToDue < 0 ? { late: true } : {}) });
  }
  const sum = (kind: UpcomingLine["kind"]): Centavos => lines.filter((l) => l.kind === kind).reduce((s, l) => s + l.amount, 0);
  const plans = sum("plan");
  const noDate = lines.filter((l) => l.kind === "plan" && l.when === null).reduce((s, l) => s + l.amount, 0);
  const bills = sum("bill");
  const allocations = sum("allocation");
  const debts = sum("debt");
  return { lines, plans, noDate, bills, allocations, debts, total: plans + bills + allocations + debts, apart };
}

const whenWords = (l: { readonly when: IsoDate | null; readonly late?: boolean | undefined }, kind: UpcomingLine["kind"]): string =>
  l.when === null ? (kind === "allocation" ? "this month" : "no date yet") : `${l.late ? "was due" : "due"} ${formatMedium(l.when)}`;

/** The answer in words: the total, each part with its items, and what is apart. */
export function upcomingWords(
  u: Upcoming,
  asOf: IsoDate,
  /** The next month's usual month (the Budget screen's forecast), said beside it when known. */
  forecast?: { readonly name: string; readonly total: Centavos } | null,
): string {
  const month = `${monthName(Number(asOf.slice(5, 7)))}`;
  if (u.lines.length === 0 && u.apart.length === 0) {
    return `Nothing is still to come: no open plans, no bills or subscriptions left to pay this month, and no allocations holding money.${forecast ? ` A usual month still costs about ${formatMoney(forecast.total)}, going by the forecast for ${forecast.name}.` : ""} Say "plan tuition 9000 by December 15" to add one.`;
  }
  const out: string[] = [`**${formatMoney(u.total)} is still to come.**`];
  const group = (title: string, kind: UpcomingLine["kind"], total: Centavos): void => {
    const items = u.lines.filter((l) => l.kind === kind).sort((a, b) => (a.when ?? NO_DATE).localeCompare(b.when ?? NO_DATE) || b.amount - a.amount);
    if (items.length === 0) return;
    out.push(`${title}, ${formatMoney(total)}:`);
    for (const l of items.slice(0, 12)) out.push(`- ${l.label}: ${formatMoney(l.amount)}, ${whenWords(l, kind)}`);
    if (items.length > 12) out.push(`- and ${items.length - 12} more`);
  };
  group("Plans on the Planner", "plan", u.plans);
  group(`Bills and subscriptions still to pay in ${month}`, "bill", u.bills);
  group(`Still held in ${month}'s allocations`, "allocation", u.allocations);
  group("Debt payments due", "debt", u.debts);
  if (u.noDate > 0) {
    out.push(`${formatMoney(u.noDate)} of the plans has no date yet, so nothing is set aside for it. Give each a date on the Planner and safe to spend holds it back from its month.`);
  }
  if (u.apart.length > 0) {
    out.push(`Apart from spending: ${u.apart.map((a) => `${a.label} ${formatMoney(a.amount)} ${a.what === "save" ? "to save" : "on a debt"}${a.when ? `, ${formatMedium(a.when)}` : ""}`).join("; ")}.`);
  }
  if (forecast) out.push(`Beyond these, a usual month costs about ${formatMoney(forecast.total)}, going by the forecast for ${forecast.name}.`);
  return out.join("\n");
}

/**
 * Spending still to come, drawn: each plan, bill, allocation and debt
 * payment as a part of the whole, largest first, the rest together so the
 * parts add up to the total. Null when nothing is to come.
 */
export function buildUpcomingChart(u: Upcoming, pie = false): Chart | null {
  if (u.lines.length === 0 || u.total <= 0) return null;
  const sorted = [...u.lines].sort((a, b) => b.amount - a.amount);
  const keep = sorted.length > 10 ? sorted.slice(0, 9) : sorted;
  const rest = sorted.slice(keep.length);
  const parts: [string, number][] = keep.map((l) => [l.label, l.amount]);
  if (rest.length > 0) parts.push([`The other ${rest.length}`, rest.reduce((s, l) => s + l.amount, 0)]);
  const top = Math.max(...parts.map(([, v]) => v), 1);
  const rows: ChartRow[] = parts.map(([label, value]) => ({ label, value, share: value / top, count: 0 }));
  return {
    title: "Spending still to come",
    by: "item",
    kind: pie ? "pie" : "bars",
    rows,
    total: u.total,
    othersCount: 0,
    direction: "spending",
    measure: "upcoming",
    upcoming: { plans: u.plans, noDate: u.noDate, bills: u.bills, allocations: u.allocations, debts: u.debts },
  };
}
