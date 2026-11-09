/**
 * The budget in a statement (owner, 9 November 2026: "add budgets too in the
 * statement all parts in the statement"): for each month the statement
 * covers, the two budget tracks against what was spent, the limits set on
 * kinds of spending, and the allocations. The figures are the Budget
 * screen's own (`assessMonth`, `categoryLimits`, `monthAllocations`), so the
 * statement, its PDF and its spreadsheet never disagree with Budget.
 *
 * Only where a budget belongs: the account statement and the expense sheet
 * (both tracks, limits, allocations: the two tracks add up to the expense
 * sheet's total) and bills and subscriptions (that track). A budget measures; it moves no money, so nothing here changes
 * a row, a total or a balance of the statement above it.
 *
 * Pure. Money is integer centavos.
 */
import { assessMonth, budgetForMonth, budgetForYear } from "./budget";
import { categoryLimits } from "./budgetView";
import { spreadCovered } from "./covers";
import { formatMedium, MONTH_NAMES } from "./dates";
import { type Centavos } from "./money";
import { monthAllocations, type AllocationLine } from "./monthAllocation";
import type { StatementType } from "./statements";
import { costOf, monthTotals } from "./totals";
import type { Budgets, IsoDate, Transaction } from "./types";

export interface BudgetFigure {
  /** What was set; 0 when nothing was. */
  readonly budget: Centavos;
  readonly spent: Centavos;
  /** Budget less spent; negative when over. Null when nothing was set. */
  readonly left: Centavos | null;
}

export interface BudgetPart extends BudgetFigure {
  /** "Spending", "Bills and subscriptions", "Limit: Food", "Allocation: Gas". */
  readonly label: string;
  readonly kind: "spending" | "bills" | "limit" | "allocation";
}

export interface BudgetMonth {
  /** "2026-11". */
  readonly month: string;
  /** "November 2026". */
  readonly label: string;
  /** The statement stops before the month ends: spent so far. */
  readonly partial: boolean;
  readonly parts: readonly BudgetPart[];
}

export interface SheetBudget {
  readonly months: readonly BudgetMonth[];
  /** The two tracks over the whole period, as far as the statement covers them. */
  readonly totals: readonly BudgetPart[];
  /** Said under the table. */
  readonly notes: readonly string[];
}

/** The statements a budget belongs in, and which of its parts. */
const PARTS: Partial<Record<StatementType, readonly BudgetPart["kind"][]>> = {
  account: ["spending", "bills", "limit", "allocation"],
  // Its total counts bills and subscriptions too, so both tracks: they add up to it.
  expense: ["spending", "bills", "limit", "allocation"],
  bills: ["bills"],
};

export const hasBudget = (type: StatementType): boolean => PARTS[type] !== undefined;

const figure = (budget: Centavos, spent: Centavos): BudgetFigure => ({ budget, spent, left: budget > 0 ? budget - spent : null });

/** Each month from `from` to `to`, inclusive. */
function monthsBetween(from: IsoDate, to: IsoDate): string[] {
  const out: string[] = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const end = to.slice(0, 7);
  for (let i = 0; i < 600; i += 1) {
    const ym = `${y}-${String(m).padStart(2, "0")}`;
    if (ym > end) break;
    out.push(ym);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/**
 * The budget section for a statement over `from` to `to`, or null when the
 * statement is of a kind a budget does not belong in. Months are whole: a
 * budget is for a month, and a statement that stops part way says so and
 * counts what was spent up to its last day.
 */
export function statementBudget(
  type: StatementType,
  transactions: readonly Transaction[],
  budgets: Budgets,
  from: IsoDate,
  to: IsoDate,
  allocations: readonly AllocationLine[] = [],
  asOf: IsoDate = to,
): SheetBudget | null {
  const kinds = PARTS[type];
  if (!kinds) return null;
  // As the Budget screen reads them: an entry over several days is a row a day, and nothing after the statement's last day.
  const rows = spreadCovered(transactions).filter((t) => t.date <= to);
  const months: BudgetMonth[] = [];
  let spendingBudget = 0;
  let spendingSpent = 0;
  let billsBudget = 0;
  let billsSpent = 0;
  for (const ym of monthsBetween(from, to)) {
    const y = Number(ym.slice(0, 4));
    const m = Number(ym.slice(5, 7));
    const assessed = assessMonth(monthTotals(rows, y, m), budgetForMonth(budgets, y, m));
    const parts: BudgetPart[] = [];
    if (kinds.includes("spending")) {
      parts.push({ label: "Spending", kind: "spending", ...figure(assessed.spending.budget, assessed.spending.spent) });
      spendingBudget += assessed.spending.budget;
      spendingSpent += assessed.spending.spent;
    }
    if (kinds.includes("bills")) {
      parts.push({ label: "Bills and subscriptions", kind: "bills", ...figure(assessed.billsSubs.budget, assessed.billsSubs.spent) });
      billsBudget += assessed.billsSubs.budget;
      billsSpent += assessed.billsSubs.spent;
    }
    if (kinds.includes("limit")) {
      const limits = categoryLimits(budgetForYear(budgets, y), m);
      for (const [kind, limit] of [...limits].sort((a, b) => a[0].localeCompare(b[0]))) {
        const spent = rows.filter((t) => t.date.slice(0, 7) === ym && t.type === "Spending" && t.item.trim().toLowerCase() === kind.trim().toLowerCase()).reduce((s, t) => s + costOf(t), 0);
        parts.push({ label: `Limit: ${kind}`, kind: "limit", ...figure(limit, spent) });
      }
    }
    if (kinds.includes("allocation")) {
      for (const s of monthAllocations(allocations, rows, ym, asOf).lines) {
        if (s.twinOf) continue;
        parts.push({ label: `Allocation: ${s.name}${s.done ? " (done)" : ""}`, kind: "allocation", ...figure(s.line.amount, s.spent) });
      }
    }
    const last = `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
    months.push({ month: ym, label: `${MONTH_NAMES[m - 1]} ${y}`, partial: to < last, parts });
  }
  const totals: BudgetPart[] = [
    ...(kinds.includes("spending") ? [{ label: "Spending", kind: "spending" as const, ...figure(spendingBudget, spendingSpent) }] : []),
    ...(kinds.includes("bills") ? [{ label: "Bills and subscriptions", kind: "bills" as const, ...figure(billsBudget, billsSpent) }] : []),
  ];
  const notes = [
    "A budget measures; it moves no money, so it changes no row, total or balance above.",
    ...(kinds.includes("spending") ? ["Spending counts transfer fees and debt interest, as the Budget screen does; a limit is a ceiling inside the spending budget, and an allocation is money set aside for one kind of spending."] : []),
    ...(months.some((x) => x.partial) ? [`${months.filter((x) => x.partial).map((x) => x.label).join(" and ")} ${months.filter((x) => x.partial).length === 1 ? "is" : "are"} counted up to ${formatMedium(to)}, the statement's last day.`] : []),
    ...(months.every((x) => x.parts.every((p) => p.budget === 0)) ? ["No budget was set for these months. Set one on Budget."] : []),
  ];
  return { months, totals, notes };
}

/** The budget as spreadsheet rows, under the entries: Month, Part, Budget, Spent, Left. */
export function budgetCsvRows(budget: SheetBudget, money: (c: Centavos) => string): string[][] {
  const out: string[][] = [[], ["Budget"], ["Month", "Part", "Budget", "Spent", "Left"]];
  for (const m of budget.months) {
    for (const p of m.parts) out.push([`${m.label}${m.partial ? " (to date)" : ""}`, p.label, p.budget > 0 ? money(p.budget) : "", money(p.spent), p.left === null ? "" : money(p.left)]);
  }
  for (const p of budget.totals) out.push(["Whole period", p.label, p.budget > 0 ? money(p.budget) : "", money(p.spent), p.left === null ? "" : money(p.left)]);
  return out;
}
