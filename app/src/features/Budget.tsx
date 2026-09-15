/**
 * Budget: spec 7.7, and what a budget is for during a month.
 *
 * ── What changed on 2026-09-15 ────────────────────────────────────────────
 *
 * The screen was the BUDGETING sheet: a grid of twelve months of two numbers,
 * a summary table where every month so far was a red row, and the forecast
 * and cash flow under it. It answered "was I over in March" and nothing a
 * person asks while a month is still running: how much is left, how much
 * that is a day, which bills are still to come, where the money is going,
 * and how the plan compares with what came in.
 *
 * It opens on a month now, and the year is one table under it. Rule 3.6 is
 * untouched: the two tracks, their verdicts and every figure are the same
 * functions as before, and `budgetView.test.ts` asserts the month view
 * carries them exactly.
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
import { billStatuses, type BillStatus } from "../domain/bills";
import { budgetForYear, budgetSummary, budgetYearTotals, type MonthBudgetRow } from "../domain/budget";
import {
  categoryLines,
  copyPlanForward,
  monthPlanView,
  previousPlan,
  withMonthPlan,
  type CategoryLine,
  type MonthPhase,
} from "../domain/budgetView";
import type { Debt } from "../domain/debt";
import { cashFlow, explainBasis, forecastYear } from "../domain/forecast";
import { firstOfMonth, getMonth, getYear, lastOfMonth, MONTH_NAMES } from "../domain/dates";
import { formatMoney, type Centavos } from "../domain/money";
import type { BudgetTrack, BudgetYear, Budgets, ReferenceLists, Transaction } from "../domain/types";

const TRACKS = [
  { id: "spending", label: "Spending", spoken: "spending" },
  { id: "billsSubs", label: "Bills & subs", spoken: "bills and subscriptions" },
] as const;

/** Enough to see the shape of a month without a wall of small amounts. */
const TOP_CATEGORIES = 8;

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
  onChangeBudget,
  onReplaceYear,
}: {
  transactions: readonly Transaction[];
  budgets: Budgets;
  debts: readonly Debt[];
  reference: ReferenceLists;
  asOf: string;
  onChangeBudget: (year: number, month: number, track: "spending" | "billsSubs", value: Centavos) => void;
  /** A whole year's plan at once, for the actions that change several months. */
  onReplaceYear: (year: number, next: BudgetYear) => void;
}) {
  const year = getYear(asOf);
  const asOfMonth = getMonth(asOf);
  const [month, setMonth] = useState(asOfMonth);
  const [editing, setEditing] = useState(false);
  const [allCategories, setAllCategories] = useState(false);
  const planRef = useRef<HTMLDivElement>(null);
  const { confirm, dialog } = useConfirm();

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

  const m = useMemo(() => {
    const view = monthPlanView(transactions, budgets, year, month, asOf);
    const billsAsOf =
      view.phase === "current"
        ? asOf
        : view.phase === "past"
          ? lastOfMonth(year, month)
          : firstOfMonth(year, month);
    return {
      view,
      lines: categoryLines(transactions, year, month),
      bills: billStatuses(transactions, reference, billsAsOf),
      previous: previousPlan(budgets, year, month),
    };
  }, [transactions, budgets, reference, year, month, asOf]);

  const { view, lines, bills, previous } = m;
  const a = view.assessment;
  const name = monthLabel(month);
  const noPlan = a.combined.budget === 0;
  const pace = view.phase === "current" ? view.elapsed : undefined;

  const paid = bills.filter((b) => b.paidThisMonth);
  const paidTotal = paid.reduce((s, b) => s + b.paidThisMonthAmount, 0);
  const stillExpected = bills
    .filter((b) => !b.paidThisMonth && b.timesPaid > 0)
    .reduce((s, b) => s + (b.lastAmount || b.averageAmount), 0);

  const planSpending = y.plan.spending.reduce((s, v) => s + v, 0);
  const planBills = y.plan.billsSubs.reduce((s, v) => s + v, 0);

  const openPlan = (): void => {
    setEditing(true);
    planRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const usePrevious = (): void => {
    if (previous) onReplaceYear(year, withMonthPlan(y.plan, month, previous));
  };

  const copyForward = async (): Promise<void> => {
    if (month >= 12) return;
    const spending = y.plan.spending[month - 1] ?? 0;
    const billsSubs = y.plan.billsSubs[month - 1] ?? 0;
    const ok = await confirm({
      title: `Copy ${name}'s plan to ${monthLabel(month + 1)} through December?`,
      body: `Each of those months becomes ${formatMoney(spending)} for spending and ${formatMoney(billsSubs)} for bills and subscriptions. Months before ${name} stay as they are, and any month can be changed afterwards.`,
      confirmLabel: "Copy the plan",
      tone: "normal",
    });
    if (ok) onReplaceYear(year, copyPlanForward(y.plan, month));
  };

  const previousName = previous
    ? previous.year === year
      ? monthLabel(previous.month)
      : `last ${monthLabel(previous.month)}`
    : "";

  return (
    <div className="fms-dash">
      {dialog}

      <SegmentedControl
        options={MONTH_OPTIONS}
        value={String(month)}
        onChange={(id) => setMonth(Number(id))}
        scroll
        label={`Month of ${year}`}
      />

      {/* ── The month ────────────────────────────────────────────────── */}
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
              No budget set for {name}.{" "}
              {a.combined.spent > 0
                ? `${formatMoney(a.combined.spent)} has gone out with nothing to measure it against.`
                : "Set one and this shows what is left, and what that is a day."}
            </p>
            <div className="fms-budgetempty-actions">
              {previous && (
                <Button variant="primary" onClick={usePrevious}>
                  Use {previousName}'s plan, {formatMoney(previous.spending + previous.billsSubs)}
                </Button>
              )}
              <Button variant={previous ? "secondary" : "primary"} onClick={openPlan}>
                Set it
              </Button>
            </div>
          </div>
        ) : (
          <div className="fms-budgethero">
            <div className="fms-budgethero-figure">
              <span className="t-label" style={{ color: "var(--ink-2)" }}>
                {a.combined.remaining < 0
                  ? "Over the plan by"
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
                {formatMoney(view.projected - a.combined.budget)} past the plan. Keeping to{" "}
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
          <Stat
            label="Plan against income"
            hint={
              view.planShareOfIncome === null
                ? noPlan
                  ? "No plan to compare"
                  : "No income to compare"
                : view.planShareOfIncome > 1
                  ? "The plan spends more than came in"
                  : "Of what came in is planned to go out"
            }
          >
            <span className="t-num-m" style={{ color: "var(--ink)" }}>
              {view.planShareOfIncome === null ? "None" : pct(view.planShareOfIncome)}
            </span>
          </Stat>
        </div>
      </Card>

      <div className="fms-budgetgrid">
        {/* ── Where it went ────────────────────────────────────────────── */}
        <Card
          title="Where it went"
          subtitle={`Spending in ${name}, against the usual for the three months before`}
          action={
            lines.length > 0 ? (
              <span className="t-micro fms-badge fms-badge--count">
                {lines.length} {lines.length === 1 ? "kind" : "kinds"}
              </span>
            ) : undefined
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
                  <CategoryRow key={l.name} line={l} />
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

        {/* ── Bills ────────────────────────────────────────────────────── */}
        <Card
          title="Bills and subscriptions"
          subtitle={`The Bills & subs track: ${formatMoney(a.billsSubs.spent)} of ${formatMoney(a.billsSubs.budget)}`}
          action={
            bills.length > 0 ? (
              <span className="t-micro fms-badge fms-badge--count">
                {paid.length} of {bills.length} paid
              </span>
            ) : undefined
          }
        >
          {bills.length === 0 ? (
            <EmptyState message="No bills or subscriptions yet. Add them in Settings, under Categories." />
          ) : (
            <>
              <ul className="fms-budgetbills">
                {bills.map((b) => (
                  <BillRow key={b.item} bill={b} phase={view.phase} month={name} />
                ))}
              </ul>
              <div className="t-caption fms-budgetfoot">
                <span>
                  Paid <Money value={paidTotal} size="s" />
                </span>
                {view.phase !== "past" && (
                  <span>
                    Still expected <Money value={stillExpected} size="s" tone="var(--ink-2)" />
                  </span>
                )}
              </div>
            </>
          )}
        </Card>
      </div>

      {/* ── The year's plan ──────────────────────────────────────────────── */}
      <div ref={planRef} className="fms-budgetplan">
        <Card
          title={`Plan for ${year}`}
          subtitle={`Set aside ${formatMoney(y.totals.budget)}, spent ${formatMoney(y.totals.spent)}, ${
            y.totals.remaining >= 0
              ? `${formatMoney(y.totals.remaining)} left`
              : `${formatMoney(-y.totals.remaining)} over`
          }`}
          action={
            <div className="fms-budgetplan-actions">
              {editing && month < 12 && (
                <Button size="sm" onClick={() => void copyForward()}>
                  Copy {name} to the months after
                </Button>
              )}
              <Button
                size="sm"
                variant={editing ? "primary" : "secondary"}
                onClick={() => setEditing((e) => !e)}
              >
                {editing ? "Done" : "Edit plan"}
              </Button>
            </div>
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
                          onClick={() => setMonth(r.month)}
                        >
                          {r.monthName}
                        </button>
                      </td>
                      {TRACKS.map((t) => {
                        const value = y.plan[t.id][i] ?? 0;
                        return (
                          <td key={t.id} className="fms-rnum" data-label={t.label}>
                            {editing ? (
                              <AmountInput
                                value={value}
                                onChange={(val) => onChangeBudget(year, i + 1, t.id, val ?? 0)}
                                ariaLabel={`${r.monthName} ${t.spoken} budget`}
                              />
                            ) : (
                              <Money value={value} size="s" tone={value === 0 ? "var(--ink-3)" : undefined} />
                            )}
                          </td>
                        );
                      })}
                      <td className="fms-rnum" data-label="Spent">
                        <Money value={r.spent} size="s" tone={r.spent === 0 ? "var(--ink-3)" : undefined} />
                      </td>
                      <td className="fms-rnum" data-label="Left">
                        {r.budget === 0 ? (
                          <span className="t-caption" style={{ color: "var(--ink-3)" }}>
                            No plan
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
      </div>

      <div className="fms-charts">
        <Card title="Plan against spending" subtitle="Red where a month went over">
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

      <Card title="Net cash flow" subtitle="What came in against what went out, and how much was kept" padded={false}>
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
  );
}

// ── Parts ──────────────────────────────────────────────────────────────────

/** One track: what went out, the plan, a bar with today's pace on it, and the verdict. */
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
            ? "Nothing planned for this track"
            : over
              ? `${formatMoney(-track.remaining)} over`
              : `${formatMoney(track.remaining)} left`}
        </span>
      </div>
    </div>
  );
}

function CategoryRow({ line }: { line: CategoryLine }) {
  let note: string;
  let up = false;
  if (line.usual === null) {
    note = "Nothing earlier to compare with";
  } else if (line.usual === 0) {
    note = "Usually nothing";
  } else {
    const change = Math.round(((line.spent - line.usual) / line.usual) * 100);
    up = change >= 25;
    note = `${change >= 0 ? "+" : "−"}${Math.abs(change)}% against the usual ${formatMoney(line.usual)}`;
  }

  return (
    <li className="fms-budgetcat">
      <div className="fms-rankhead">
        <span className="t-body fms-rankname">{line.name}</span>
        <Money value={line.spent} size="s" />
      </div>
      <div className="fms-budgetcat-bar" aria-hidden>
        <span style={{ width: `${Math.max(2, Math.round(line.share * 100))}%` }} />
      </div>
      <span className={up ? "t-caption fms-budgetcat-foot fms-budgetcat-foot--up" : "t-caption fms-budgetcat-foot"}>
        {note}
      </span>
    </li>
  );
}

function BillRow({ bill, phase, month }: { bill: BillStatus; phase: MonthPhase; month: string }) {
  const open = !bill.paidThisMonth && bill.timesPaid > 0 && bill.daysToDue !== undefined;
  const late = phase === "current" && open && (bill.daysToDue ?? 0) < 0;
  const soon = phase === "current" && open && !late && (bill.daysToDue ?? 99) <= 3;

  let when: string;
  if (bill.paidThisMonth) when = `Paid in ${month}`;
  else if (bill.timesPaid === 0) when = "Never paid";
  else if (phase === "past") when = `Not paid in ${month}`;
  else if (phase === "future") when = "Expected, going by the last payment";
  else if (bill.daysToDue === undefined) when = "Due date unknown";
  else if (bill.daysToDue < 0) {
    const days = -bill.daysToDue;
    when = `${days} ${days === 1 ? "day" : "days"} late, going by last month`;
  } else if (bill.daysToDue === 0) when = "Due today, going by last month";
  else when = `Due in ${bill.daysToDue} ${bill.daysToDue === 1 ? "day" : "days"}`;

  const amount = bill.paidThisMonth ? bill.paidThisMonthAmount : bill.lastAmount || bill.averageAmount;

  return (
    <li className="fms-budgetbill">
      <div className="fms-budgetbill-text">
        <span className="t-body fms-truncate">{bill.item}</span>
        <span className="t-caption" style={{ color: late ? "var(--over)" : "var(--ink-3)" }}>
          {bill.category === "Bills" ? "Bill" : "Subscription"} · {when}
        </span>
      </div>
      <div className="fms-budgetbill-figure">
        <Money value={amount} size="s" tone={bill.paidThisMonth ? undefined : "var(--ink-3)"} />
        <StatusPill status={bill.paidThisMonth ? "ok" : late ? "over" : soon ? "warn" : "none"}>
          {bill.paidThisMonth ? "Paid" : late ? "Late" : phase === "past" ? "Unpaid" : "Due"}
        </StatusPill>
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
