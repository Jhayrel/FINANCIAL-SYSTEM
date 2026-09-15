/**
 * Budget: spec 7.7, and what a budget is for during a month.
 *
 * ── What changed on 2026-09-15 ────────────────────────────────────────────
 *
 * The screen was the BUDGETING sheet: a grid of twelve months of two numbers,
 * a summary table where every month so far was a red row, and the forecast
 * and cash flow under it. It answered "was I over in March" and nothing a
 * person asks while a month is still running.
 *
 * It opens on a month now, with the year as one table under it. A budget is
 * set in the planner beside the month rather than typed into a grid, and
 * starts from the ledger.
 *
 * ── Tidied the same day ───────────────────────────────────────────────────
 *
 * The first version was right and read as noise. Every kind of spending had
 * an orange percentage under it ("+560% against the usual ₱285.00"), the
 * month card offered two buttons as well as the planner beside it, cards
 * showed "None" and "₱0.00 due", and the planner and the bills card gave two
 * different figures for the same bills. Now each card answers one question
 * with the figure every other card uses, a difference is shown in pesos and
 * only when it is worth a look, and the screen links out: a bill still to
 * pay opens the Add form filled in, a kind of spending opens its rows.
 *
 * Rule 3.6 is untouched: the two tracks, their verdicts and every figure are
 * the same functions as before, and `budgetView.test.ts` asserts the month
 * view carries them exactly.
 */

import { useMemo, useRef, useState, type ReactNode } from "react";

import {
  Alert,
  Button,
  Card,
  EmptyState,
  Money,
  ProgressBar,
  SegmentedControl,
  StatusPill,
  type Status,
} from "../components/primitives";
import { AmountInput } from "../components/forms";
import { BarChart } from "../components/charts";
import { useConfirm } from "../components/Confirm";
import { budgetForYear, budgetSummary, budgetYearTotals, type MonthBudgetRow } from "../domain/budget";
import {
  applyPlan,
  categoryLines,
  monthBills,
  monthPlanView,
  planSuggestions,
  withMonthPlan,
  type BillState,
  type CategoryLine,
  type MonthBill,
  type MonthPhase,
  type PlanScope,
  type PlanSuggestions,
} from "../domain/budgetView";
import type { Debt } from "../domain/debt";
import { cashFlow, explainBasis, forecastYear } from "../domain/forecast";
import { getMonth, getYear, MONTH_NAMES } from "../domain/dates";
import { formatMoney, type Centavos } from "../domain/money";
import type { BudgetTrack, BudgetYear, Budgets, ReferenceLists, Transaction } from "../domain/types";

const TRACKS = [
  { id: "spending", label: "Spending" },
  { id: "billsSubs", label: "Bills & subs" },
] as const;

/** Enough to see the shape of a month without a wall of small amounts. */
const TOP_CATEGORIES = 8;

/**
 * A difference worth a look: at least ₱500.00 above the usual, and half as
 * much again. Below that a percentage of a small figure only alarms: ₱285.00
 * becoming ₱1,880.00 is worth saying, ₱40.00 becoming ₱90.00 is not.
 */
const NOTABLE = 50000;

const monthLabel = (m: number): string => MONTH_NAMES[m - 1] ?? "";

const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => ({
  id: String(i + 1),
  label: monthLabel(i + 1).slice(0, 3),
}));

const pct = (ratio: number): string => `${Math.round(ratio * 100)}%`;

const statusOf = (t: BudgetTrack): Status =>
  t.status === "NO BUDGET SET" ? "none" : t.status === "OVER THE BUDGET" ? "over" : "ok";

function statusWord(t: BudgetTrack, phase: MonthPhase): string {
  if (t.status === "NO BUDGET SET") return "No budget";
  if (t.status === "OVER THE BUDGET") return "Over";
  return phase === "future" ? "Planned" : "Within";
}

export function Budget({
  transactions,
  budgets,
  debts,
  reference,
  asOf,
  onReplaceYear,
  onRecordBill,
  onShowRows,
}: {
  transactions: readonly Transaction[];
  budgets: Budgets;
  debts: readonly Debt[];
  reference: ReferenceLists;
  asOf: string;
  /** A year's plan, written once, whichever months a save touched. */
  onReplaceYear: (year: number, next: BudgetYear) => void;
  /** Opens the Add form with this bill filled in, for checking before saving. */
  onRecordBill?: ((bill: MonthBill) => void) | undefined;
  /** Opens the Database searched for these words. */
  onShowRows?: ((query: string) => void) | undefined;
}) {
  const year = getYear(asOf);
  const asOfMonth = getMonth(asOf);
  const [month, setMonth] = useState(asOfMonth);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [allCategories, setAllCategories] = useState(false);
  const plannerRef = useRef<HTMLElement>(null);

  const y = useMemo(() => {
    const rows = budgetSummary(transactions, budgets, year);
    return {
      rows,
      totals: budgetYearTotals(rows),
      plan: budgetForYear(budgets, year),
      forecast: forecastYear(transactions, year, asOfMonth, debts),
      flow: cashFlow(transactions, year),
    };
  }, [transactions, budgets, debts, year, asOfMonth]);

  const m = useMemo(
    () => ({
      view: monthPlanView(transactions, budgets, year, month, asOf),
      lines: categoryLines(transactions, year, month),
      bills: monthBills(transactions, reference, year, month, asOf),
      suggestions: planSuggestions(transactions, reference, budgets, year, month, asOf),
    }),
    [transactions, budgets, reference, year, month, asOf],
  );

  const { view, lines, bills, suggestions } = m;
  const previous = suggestions.previous;
  const a = view.assessment;
  const name = monthLabel(month);
  const noPlan = a.combined.budget === 0;
  const pace = view.phase === "current" ? view.elapsed : undefined;
  const spentByKind = lines.reduce((s, l) => s + l.spent, 0);

  /**
   * Bills and subscriptions rows with no item are counted by the track and
   * cannot be put against a named bill, so they are said once, not lost.
   */
  const unnamedBills = view.phase === "future" ? 0 : a.billsSubs.spent - bills.paid;

  /**
   * An income far above the usual month. Often it is money that was already
   * there, typed as income, which inflates "Came in" and "Kept" alike.
   */
  const usual = suggestions.usualIncome;
  const unusualIncome =
    usual !== null && usual > 0 && view.revenue >= usual * 3 && view.revenue - usual >= 5_000_000;

  const planSpending = y.plan.spending.reduce((s, v) => s + v, 0);
  const planBills = y.plan.billsSubs.reduce((s, v) => s + v, 0);

  const pickMonth = (next: number): void => {
    setMonth(next);
    setSavedNote(null);
  };

  const focusPlanner = (): void => {
    const el = plannerRef.current;
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    el.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
  };

  const usePrevious = (): void => {
    if (!previous) return;
    onReplaceYear(year, withMonthPlan(y.plan, month, previous));
    setSavedNote(`Saved. ${name} uses the same plan as ${monthLabel(previous.month)}.`);
  };

  const savePlan = (value: { spending: Centavos; billsSubs: Centavos }, scope: PlanScope): void => {
    onReplaceYear(year, applyPlan(y.plan, month, value, scope));
    const total = formatMoney(value.spending + value.billsSubs);
    setSavedNote(
      scope === "month"
        ? `Saved. ${name} is set to ${total}.`
        : scope === "rest"
          ? `Saved. ${name} through December are set to ${total} each.`
          : `Saved. Every month of ${year} is set to ${total}.`,
    );
  };

  const previousName = previous
    ? previous.year === year
      ? monthLabel(previous.month)
      : `last ${monthLabel(previous.month)}`
    : "";

  return (
    <div className="fms-budgetpage">
      {/* ── The month ────────────────────────────────────────────────────── */}
      <div className="fms-budgettop">
        <SegmentedControl
          options={MONTH_OPTIONS}
          value={String(month)}
          onChange={(id) => pickMonth(Number(id))}
          scroll
          label={`Month of ${year}`}
        />

        <Card
          title={`${name} ${year}`}
          subtitle={
            view.phase === "current"
              ? `${view.daysLeft} ${view.daysLeft === 1 ? "day" : "days"} left in the month`
              : view.phase === "past"
                ? "The month is over"
                : "Not started yet"
          }
          action={<StatusPill status={statusOf(a.combined)}>{statusWord(a.combined, view.phase)}</StatusPill>}
        >
          {noPlan ? (
            <div className="fms-budgetempty">
              <p className="t-body" style={{ margin: 0, color: "var(--ink-2)" }}>
                No budget for {name} yet.{" "}
                {a.combined.spent > 0
                  ? `${formatMoney(a.combined.spent)} has gone out with nothing to measure it against.`
                  : "Set one and this shows what is left, and what that is a day."}
              </p>
              {previous ? (
                <Button variant="primary" onClick={usePrevious}>
                  Use {previousName}'s plan, {formatMoney(previous.spending + previous.billsSubs)}
                </Button>
              ) : (
                <Button variant="primary" onClick={focusPlanner}>
                  Set the budget
                </Button>
              )}
            </div>
          ) : (
            <div className="fms-budgethero">
              <div className="fms-budgethero-figure">
                <span className="t-label" style={{ color: "var(--ink-2)" }}>
                  {a.combined.remaining < 0
                    ? "Over the budget by"
                    : view.phase === "past"
                      ? "Left unspent"
                      : "Left to spend"}
                </span>
                <Money
                  value={Math.abs(a.combined.remaining)}
                  size="xl"
                  tone={a.combined.remaining < 0 ? "var(--over)" : undefined}
                />
                <span className="t-caption" style={{ color: "var(--ink-3)" }}>
                  {formatMoney(a.combined.spent)} spent of {formatMoney(a.combined.budget)}
                  {view.phase !== "past" && view.perDay > 0 ? ` · ${formatMoney(view.perDay)} a day` : ""}
                </span>
              </div>
              <div className="fms-budgettracks">
                {TRACKS.map((t) => (
                  <TrackRow key={t.id} label={t.label} track={a[t.id]} pace={pace} />
                ))}
              </div>
            </div>
          )}

          {view.projected !== null &&
            a.combined.budget > 0 &&
            a.combined.remaining >= 0 &&
            view.projected > a.combined.budget && (
              <div style={{ marginTop: "var(--space-4)" }}>
                <Alert status="warn" title="On pace to go over">
                  At the rate so far {name} ends near {formatMoney(view.projected)},{" "}
                  {formatMoney(view.projected - a.combined.budget)} past the budget. Keeping to{" "}
                  {formatMoney(view.perDay)} a day holds it inside.
                </Alert>
              </div>
            )}

          <div className="fms-budgetincome">
            <Stat label="Came in" hint="Income, not counting starting balances">
              <Money value={view.revenue} size="m" tone="var(--flow-revenue-text)" />
            </Stat>
            <Stat label="Went out" hint="Everything the two tracks count">
              <Money value={a.combined.spent} size="m" tone="var(--flow-spending-text)" />
            </Stat>
            <Stat
              label="Kept"
              hint={view.keptRate === null ? "No income this month" : `${pct(view.keptRate)} of what came in`}
            >
              <Money value={view.kept} size="m" signed />
            </Stat>
            {view.planShareOfIncome !== null && (
              <Stat
                label="Budget against income"
                hint={
                  view.planShareOfIncome > 1
                    ? "The budget spends more than came in"
                    : "Of what came in is budgeted to go out"
                }
              >
                <span className="t-num-m" style={{ color: "var(--ink)" }}>
                  {pct(view.planShareOfIncome)}
                </span>
              </Stat>
            )}
          </div>

          {unusualIncome && usual !== null && (
            <p className="t-caption fms-budgetnote">
              {formatMoney(view.revenue)} came in, against a usual month of {formatMoney(usual)}. If
              some of it was money you already had, add it as a starting balance instead, so it
              stops counting as income here and on the Dashboard.
            </p>
          )}
        </Card>
      </div>

      {/* ── Setting the budget ───────────────────────────────────────────── */}
      <aside ref={plannerRef} className="fms-budgetrail" aria-label={`Set the budget for ${name}`}>
        <Planner
          key={`${year}-${month}-${suggestions.current.spending}-${suggestions.current.billsSubs}`}
          year={year}
          month={month}
          suggestions={suggestions}
          note={savedNote}
          onSave={savePlan}
        />
      </aside>

      {/* ── The detail, and the year ─────────────────────────────────────── */}
      <div className="fms-budgetrest">
        <div className="fms-budgetgrid">
          <Card
            title="Where it went"
            subtitle={
              lines.length > 0
                ? `${formatMoney(spentByKind)} across ${lines.length} ${
                    lines.length === 1 ? "kind" : "kinds"
                  } of spending, each beside its usual month`
                : `Spending in ${name}, by kind`
            }
          >
            {lines.length === 0 ? (
              <EmptyState
                message={view.phase === "future" ? `${name} has not started.` : `Nothing spent in ${name}.`}
              />
            ) : (
              <>
                <ol className="fms-budgetcats">
                  {(allCategories ? lines : lines.slice(0, TOP_CATEGORIES)).map((l) => (
                    <CategoryRow key={l.name} line={l} onShow={onShowRows} />
                  ))}
                </ol>
                {lines.length > TOP_CATEGORIES && (
                  <div style={{ marginTop: "var(--space-4)" }}>
                    <Button size="sm" onClick={() => setAllCategories((x) => !x)}>
                      {allCategories ? `Show the top ${TOP_CATEGORIES}` : `Show all ${lines.length}`}
                    </Button>
                  </div>
                )}
              </>
            )}
          </Card>

          <Card
            title="Bills and subscriptions"
            subtitle={
              a.billsSubs.budget > 0
                ? `${formatMoney(a.billsSubs.spent)} of the ${formatMoney(a.billsSubs.budget)} budgeted`
                : `${formatMoney(a.billsSubs.spent)} so far, with nothing budgeted`
            }
            action={
              bills.bills.length > 0 ? (
                <span className="t-micro fms-badge fms-badge--count">
                  {bills.bills.filter((b) => b.state === "paid").length} of {bills.bills.length} paid
                </span>
              ) : undefined
            }
          >
            {bills.bills.length === 0 ? (
              <EmptyState
                message={
                  bills.neverPaid.length > 0
                    ? "No bill has been paid in the last two months, so there is nothing to expect yet."
                    : "No bills or subscriptions yet. Add them in Settings, under Categories."
                }
              />
            ) : (
              <>
                <ul className="fms-budgetbills">
                  {bills.bills.map((b) => (
                    <BillRow
                      key={b.item}
                      bill={b}
                      month={name}
                      onRecord={onRecordBill ? () => onRecordBill(b) : undefined}
                    />
                  ))}
                </ul>
                <div className="t-caption fms-budgetfoot">
                  <span>
                    Paid <Money value={bills.paid} size="s" />
                  </span>
                  {view.phase !== "past" && (
                    <span>
                      Still expected <Money value={bills.stillExpected} size="s" tone="var(--ink-2)" />
                    </span>
                  )}
                  <span>
                    {name} <Money value={bills.total} size="s" />
                  </span>
                </div>
              </>
            )}
            {unnamedBills > 0 && (
              <p className="t-caption fms-budgetnote">
                Another {formatMoney(unnamedBills)} was filed under Bills or Subscriptions with no item, so
                it counts toward the track without a name here.
              </p>
            )}
            {bills.neverPaid.length > 0 && (
              <p className="t-caption fms-budgetnote">
                Never paid, so not expected: {bills.neverPaid.join(", ")}.
              </p>
            )}
          </Card>
        </div>

        <Card
          title={`Budget for ${year}`}
          subtitle={`Budgeted ${formatMoney(y.totals.budget)}, spent ${formatMoney(y.totals.spent)}, ${
            y.totals.remaining >= 0
              ? `${formatMoney(y.totals.remaining)} left`
              : `${formatMoney(-y.totals.remaining)} over`
          }`}
          action={
            <Button size="sm" onClick={focusPlanner}>
              Change {name}
            </Button>
          }
          padded={false}
        >
          <div className="fms-rtable-wrap">
            <table className="fms-rtable">
              <thead>
                <tr>
                  <th className="t-th">Month</th>
                  {TRACKS.map((t) => (
                    <th key={t.id} className="t-th fms-rnum">
                      {t.label}
                    </th>
                  ))}
                  <th className="t-th fms-rnum">Spent</th>
                  <th className="t-th fms-rnum">Left</th>
                  <th className="t-th">Status</th>
                </tr>
              </thead>
              <tbody>
                {y.rows.map((r, i) => {
                  const phase: MonthPhase =
                    r.month < asOfMonth ? "past" : r.month > asOfMonth ? "future" : "current";
                  return (
                    <tr key={r.month} className={r.month === month ? "fms-budgetplan-on" : undefined}>
                      <td className="t-body-strong fms-rhead">
                        <button
                          type="button"
                          className="fms-monthlink"
                          aria-pressed={r.month === month}
                          onClick={() => pickMonth(r.month)}
                        >
                          {r.monthName}
                        </button>
                      </td>
                      {TRACKS.map((t) => {
                        const value = y.plan[t.id][i] ?? 0;
                        return (
                          <td key={t.id} className="fms-rnum" data-label={t.label}>
                            <Money value={value} size="s" tone={value === 0 ? "var(--ink-3)" : undefined} />
                          </td>
                        );
                      })}
                      <td className="fms-rnum" data-label="Spent">
                        <Money value={r.spent} size="s" tone={r.spent === 0 ? "var(--ink-3)" : undefined} />
                      </td>
                      <td className="fms-rnum" data-label="Left">
                        {r.budget === 0 ? (
                          <span className="t-caption" style={{ color: "var(--ink-3)" }}>
                            No budget
                          </span>
                        ) : (
                          <Money value={r.remaining} size="s" />
                        )}
                      </td>
                      <td data-label="Status">
                        <RowStatus row={r} phase={phase} />
                      </td>
                    </tr>
                  );
                })}
                <tr className="fms-rtotal">
                  <td className="t-body-strong fms-rhead">Total</td>
                  <td className="fms-rnum" data-label="Spending">
                    <Money value={planSpending} />
                  </td>
                  <td className="fms-rnum" data-label="Bills & subs">
                    <Money value={planBills} />
                  </td>
                  <td className="fms-rnum" data-label="Spent">
                    <Money value={y.totals.spent} />
                  </td>
                  <td className="fms-rnum" data-label="Left">
                    <Money value={y.totals.remaining} />
                  </td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        </Card>

        <div className="fms-charts">
          <Card title="Budget against spending" subtitle="Red where a month went over">
            <BarChart
              labels={MONTH_NAMES.slice(0, asOfMonth).map((n) => n.slice(0, 3))}
              budget={y.rows.slice(0, asOfMonth).map((r) => r.budget)}
              actual={y.rows.slice(0, asOfMonth).map((r) => r.spent)}
            />
          </Card>

          <Card title="Forecast" subtitle="Estimates for the months still ahead" padded={false}>
            <div className="fms-rtable-wrap">
              <table className="fms-rtable">
                <thead>
                  <tr>
                    <th className="t-th">Month</th>
                    <th className="t-th fms-rnum">Spending</th>
                    <th className="t-th fms-rnum">Bills</th>
                    <th className="t-th fms-rnum">Total</th>
                    <th className="t-th">Basis</th>
                  </tr>
                </thead>
                <tbody>
                  {y.forecast
                    .filter((f) => !f.isActual)
                    .map((f) => (
                      <tr key={f.month}>
                        <td className="t-body fms-rhead">{monthLabel(f.month)}</td>
                        <td className="fms-rnum" data-label="Spending">
                          <Money value={f.spending} size="s" />
                        </td>
                        <td className="fms-rnum" data-label="Bills">
                          <Money value={f.billsSubs} size="s" />
                        </td>
                        <td className="fms-rnum" data-label="Total">
                          <Money value={f.total} size="s" />
                        </td>
                        <td className="t-micro" data-label="Basis" style={{ color: "var(--ink-3)" }}>
                          {explainBasis(f.basis)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        <Card
          title="Net cash flow"
          subtitle="What came in against what went out, and how much was kept"
          padded={false}
        >
          <div className="fms-rtable-wrap">
            <table className="fms-rtable">
              <thead>
                <tr>
                  <th className="t-th">Month</th>
                  <th className="t-th fms-rnum">Revenue</th>
                  <th className="t-th fms-rnum">Expense</th>
                  <th className="t-th fms-rnum">Transfers</th>
                  <th className="t-th fms-rnum">Net</th>
                  <th className="t-th fms-rnum">Kept</th>
                </tr>
              </thead>
              <tbody>
                {y.flow.slice(0, asOfMonth).map((r) => (
                  <tr key={r.month}>
                    <td className="t-body fms-rhead">{monthLabel(r.month)}</td>
                    <td className="fms-rnum" data-label="Revenue">
                      <Money value={r.revenue} size="s" tone="var(--flow-revenue-text)" />
                    </td>
                    <td className="fms-rnum" data-label="Expense">
                      <Money value={r.expense} size="s" tone="var(--flow-spending-text)" />
                    </td>
                    <td className="fms-rnum" data-label="Transfers">
                      <Money value={r.transfer} size="s" tone="var(--ink-3)" />
                    </td>
                    <td className="fms-rnum" data-label="Net">
                      <Money value={r.net} size="s" signed />
                    </td>
                    <td className="fms-rnum t-caption" data-label="Kept" style={{ color: "var(--ink-2)" }}>
                      {r.revenue > 0 ? pct(r.net / r.revenue) : "No income"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}

// ── The planner ────────────────────────────────────────────────────────────

/**
 * Setting a month's budget.
 *
 * It starts from what the month already has, or else the month before's
 * budget, or else the ledger's own figures, and says which, so a filled-in
 * field is never mistaken for one already saved. Each figure it offers is a
 * button that fills the field, never a value written in silently.
 */
function Planner({
  year,
  month,
  suggestions: s,
  note,
  onSave,
}: {
  year: number;
  month: number;
  suggestions: PlanSuggestions;
  note: string | null;
  onSave: (value: { spending: Centavos; billsSubs: Centavos }, scope: PlanScope) => void;
}) {
  const name = monthLabel(month);
  const hasPlan = s.current.spending + s.current.billsSubs > 0;
  const source = s.previous
    ? `${s.previous.year === year ? monthLabel(s.previous.month) : `last ${monthLabel(s.previous.month)}`}'s budget`
    : "your ledger";
  const start = hasPlan
    ? s.current
    : s.previous
      ? { spending: s.previous.spending, billsSubs: s.previous.billsSubs }
      : { spending: s.spendingUsual ?? 0, billsSubs: s.bills.total };

  const [bills, setBills] = useState<Centavos | null>(start.billsSubs);
  const [spending, setSpending] = useState<Centavos | null>(start.spending);
  const [scope, setScope] = useState<PlanScope>("month");
  const { confirm, dialog } = useConfirm();

  const total = (bills ?? 0) + (spending ?? 0);
  const changed = (bills ?? 0) !== s.current.billsSubs || (spending ?? 0) !== s.current.spending;
  const keep = s.expectedIncome === null ? null : s.expectedIncome - total;
  const incomeWords =
    s.expectedIncome === null
      ? ""
      : s.expectedFrom === "month"
        ? `the ${formatMoney(s.expectedIncome)} that came in this month`
        : `your usual ${formatMoney(s.expectedIncome)} income`;

  const scopes: { id: PlanScope; label: string }[] = [
    { id: "month", label: `${name.slice(0, 3)} only` },
    ...(month < 12 ? [{ id: "rest" as const, label: `${name.slice(0, 3)} to Dec` }] : []),
    { id: "year", label: `All ${year}` },
  ];

  const billNames =
    s.bills.bills
      .slice(0, 4)
      .map((b) => `${b.item} ${formatMoney(b.amount)}`)
      .join(", ") + (s.bills.bills.length > 4 ? `, and ${s.bills.bills.length - 4} more` : "");

  const save = async (): Promise<void> => {
    const value = { spending: spending ?? 0, billsSubs: bills ?? 0 };
    if (scope !== "month") {
      const ok = await confirm({
        title:
          scope === "rest"
            ? `Set ${name} through December to ${formatMoney(total)} each?`
            : `Set every month of ${year} to ${formatMoney(total)}?`,
        body: `Each of those months gets ${formatMoney(value.spending)} for spending and ${formatMoney(
          value.billsSubs,
        )} for bills and subscriptions, replacing what it had. ${
          scope === "year" ? "Months already over are included." : `Months before ${name} stay as they are.`
        }`,
        confirmLabel: "Set the budget",
        tone: "normal",
      });
      if (!ok) return;
    }
    onSave(value, scope);
  };

  return (
    <Card
      title="Set the budget"
      subtitle={
        hasPlan
          ? `${name} ${year} is budgeted at ${formatMoney(s.current.spending + s.current.billsSubs)}.`
          : `Nothing saved for ${name} yet. Filled in from ${source}, and saved only when you press Save.`
      }
    >
      {dialog}
      <div className="fms-planner">
        <div className="fms-planner-field">
          <span className="t-label" style={{ color: "var(--ink-2)" }}>
            Bills and subscriptions
          </span>
          <AmountInput value={bills} onChange={setBills} ariaLabel={`${name} bills and subscriptions budget`} />
          {s.bills.bills.length > 0 ? (
            <>
              <div className="fms-planner-chips">
                <Button size="sm" onClick={() => setBills(s.bills.total)}>
                  {name}'s bills, {formatMoney(s.bills.total)}
                </Button>
              </div>
              <p className="t-caption fms-planner-note">{billNames}.</p>
            </>
          ) : (
            <p className="t-caption fms-planner-note">No bills paid in the last two months to go by.</p>
          )}
        </div>

        <div className="fms-planner-field">
          <span className="t-label" style={{ color: "var(--ink-2)" }}>
            Spending
          </span>
          <AmountInput value={spending} onChange={setSpending} ariaLabel={`${name} spending budget`} />
          {(s.spendingLastMonth !== null || s.spendingUsual !== null || (s.spendingKeepFifth ?? 0) > 0) && (
            <div className="fms-planner-chips">
              {s.spendingLastMonth !== null && (
                <Button size="sm" onClick={() => setSpending(s.spendingLastMonth)}>
                  Last month, {formatMoney(s.spendingLastMonth)}
                </Button>
              )}
              {s.spendingUsual !== null && (
                <Button size="sm" onClick={() => setSpending(s.spendingUsual)}>
                  Usual, {formatMoney(s.spendingUsual)}
                </Button>
              )}
              {s.spendingKeepFifth !== null && s.spendingKeepFifth > 0 && (
                <Button size="sm" onClick={() => setSpending(s.spendingKeepFifth)}>
                  Keep a fifth, {formatMoney(s.spendingKeepFifth)}
                </Button>
              )}
            </div>
          )}
          <p className="t-caption fms-planner-note">
            Everything but bills: what you buy, money sent to other people, transfer fees and interest.
          </p>
        </div>

        <div className="fms-planner-sum">
          <div className="fms-planner-sumrow">
            <span className="t-label" style={{ color: "var(--ink-2)" }}>
              {hasPlan && !changed ? "Budget for the month" : "New budget for the month"}
            </span>
            <Money value={total} size="l" />
          </div>
          {keep === null ? (
            <p className="t-caption fms-planner-note">No income before {name} to compare it with.</p>
          ) : keep >= 0 ? (
            <p className="t-caption" style={{ margin: 0, color: "var(--ink-2)" }}>
              Leaves {formatMoney(keep)} of {incomeWords}.
            </p>
          ) : (
            <p className="t-caption" style={{ margin: 0, color: "var(--over)" }}>
              {formatMoney(-keep)} more than {incomeWords}.
            </p>
          )}
        </div>

        <div className="fms-planner-scope">
          <span className="t-label" style={{ color: "var(--ink-2)" }}>
            Save it to
          </span>
          <div className="fms-segmented" role="radiogroup" aria-label="Which months the budget is saved to">
            {scopes.map((o) => (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={scope === o.id}
                className={`fms-seg ${scope === o.id ? "t-body-strong" : "t-body"}`}
                onClick={() => setScope(o.id)}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        <Button variant="primary" fullWidth onClick={() => void save()}>
          {hasPlan ? "Save changes" : "Save budget"}
        </Button>

        {note && (
          <p className="t-caption" role="status" style={{ margin: 0, color: "var(--ink-2)" }}>
            {note}
          </p>
        )}
      </div>
    </Card>
  );
}

// ── Parts ──────────────────────────────────────────────────────────────────

/** One track: what went out, the budget, a bar with today's pace on it, and the verdict. */
function TrackRow({ label, track, pace }: { label: string; track: BudgetTrack; pace?: number | undefined }) {
  const none = track.status === "NO BUDGET SET";
  const over = track.status === "OVER THE BUDGET";
  return (
    <div className="fms-budgettrack">
      <div className="fms-rankhead">
        <span className="t-body-strong fms-rankname">{label}</span>
        <span className="t-caption fms-budgettrack-figs">
          <Money value={track.spent} size="s" />
          <span>of</span>
          <Money value={track.budget} size="s" tone="var(--ink-3)" />
        </span>
      </div>
      <ProgressBar value={track.spent} max={track.budget} {...(pace !== undefined ? { pace } : {})} />
      <div className="t-caption fms-budgettrack-foot">
        <StatusPill status={statusOf(track)}>{none ? "No budget" : over ? "Over" : "Within"}</StatusPill>
        <span>
          {none
            ? "Nothing budgeted for this track"
            : over
              ? `${formatMoney(-track.remaining)} over`
              : `${formatMoney(track.remaining)} left`}
        </span>
      </div>
    </div>
  );
}

/**
 * A kind of spending: what it came to, its share, and its usual month.
 *
 * The difference is in pesos, and only flagged when it is worth a look.
 */
function CategoryRow({
  line,
  onShow,
}: {
  line: CategoryLine;
  onShow?: ((query: string) => void) | undefined;
}) {
  const above = line.usual === null ? 0 : line.spent - line.usual;
  const notable = line.usual !== null && above >= NOTABLE && (line.usual === 0 || above >= line.usual / 2);

  return (
    <li className="fms-budgetcat">
      <div className="fms-budgetcat-head">
        {onShow ? (
          <button
            type="button"
            className="t-body fms-linkish"
            onClick={() => onShow(line.name)}
            title={`Show the ${line.name} rows in the Database`}
          >
            {line.name}
          </button>
        ) : (
          <span className="t-body">{line.name}</span>
        )}
        <Money value={line.spent} size="s" />
      </div>
      <div className="fms-budgetcat-bar" aria-hidden>
        <span style={{ width: `${Math.max(2, Math.round(line.share * 100))}%` }} />
      </div>
      <div className="t-caption fms-budgetcat-foot">
        <span>
          {line.usual === null
            ? "First month on record"
            : line.usual === 0
              ? "Usually nothing"
              : `Usually ${formatMoney(line.usual)}`}
        </span>
        {notable && <span className="t-micro fms-budgetcat-flag">{formatMoney(above)} more than usual</span>}
      </div>
    </li>
  );
}

const BILL_PILL: Record<BillState, readonly [Status, string]> = {
  paid: ["ok", "Paid"],
  late: ["over", "Late"],
  soon: ["warn", "Soon"],
  due: ["none", "Due"],
  expected: ["none", "Expected"],
  missed: ["none", "Not paid"],
};

function BillRow({
  bill,
  month,
  onRecord,
}: {
  bill: MonthBill;
  month: string;
  onRecord?: (() => void) | undefined;
}) {
  let when: string;
  switch (bill.state) {
    case "paid":
      when = `Paid in ${month}`;
      break;
    case "missed":
      when = `Not paid in ${month}`;
      break;
    case "expected":
      when = "Expected at the last amount paid";
      break;
    case "late": {
      const days = -(bill.daysToDue ?? 0);
      when = `${days} ${days === 1 ? "day" : "days"} late, going by last month`;
      break;
    }
    default:
      when =
        bill.daysToDue === undefined
          ? "Due this month"
          : bill.daysToDue === 0
            ? "Due today"
            : `Due in ${bill.daysToDue} ${bill.daysToDue === 1 ? "day" : "days"}`;
  }

  const [status, word] = BILL_PILL[bill.state];
  const open = bill.state !== "paid" && bill.state !== "missed";

  return (
    <li className="fms-budgetbill">
      <div className="fms-budgetbill-text">
        <span className="t-body fms-truncate">{bill.item}</span>
        <span className="t-caption" style={{ color: bill.state === "late" ? "var(--over)" : "var(--ink-3)" }}>
          {bill.category === "Bills" ? "Bill" : "Subscription"} · {when}
        </span>
      </div>
      <div className="fms-budgetbill-figure">
        <Money value={bill.amount} size="s" tone={bill.state === "paid" ? undefined : "var(--ink-3)"} />
        {open && onRecord ? (
          <Button size="sm" onClick={onRecord}>
            Record payment
          </Button>
        ) : (
          <StatusPill status={status}>{word}</StatusPill>
        )}
      </div>
    </li>
  );
}

function RowStatus({ row, phase }: { row: MonthBudgetRow; phase: MonthPhase }) {
  if (row.budget === 0) return <StatusPill status="none">No budget</StatusPill>;
  if (phase === "future" && row.spent === 0) return <StatusPill status="info">Planned</StatusPill>;
  if (row.status === "OVER THE BUDGET") return <StatusPill status="over">Over</StatusPill>;
  return <StatusPill status="ok">Within</StatusPill>;
}

function Stat({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return (
    <div className="fms-budgetstat">
      <span className="t-label" style={{ color: "var(--ink-2)" }}>
        {label}
      </span>
      {children}
      <span className="t-caption" style={{ color: "var(--ink-3)" }}>
        {hint}
      </span>
    </div>
  );
}
