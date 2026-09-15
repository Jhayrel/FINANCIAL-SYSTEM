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
 * set in the planner beside the month and starts from the ledger. Each card
 * answers one question with the figure every other card uses, and the screen
 * links out: a bill still to pay opens the Add form filled in, a kind of
 * spending opens its rows.
 *
 * ── Any year ──────────────────────────────────────────────────────────────
 *
 * The year and month are one picker, and every year with rows or a budget is
 * on it, plus next year (docs/08, rule Y3).
 *
 * ── Two levels ────────────────────────────────────────────────────────────
 *
 * The two tracks stay the budget: rule 3.6 judges them and the Dashboard
 * reports them. A kind of spending can also have a limit of its own inside
 * the spending track. Bills need none, being followed one by one.
 *
 * ── When a month's budget can change ──────────────────────────────────────
 *
 * A running or future month changes freely and every change is kept. For
 * five days after a month ends it still takes changes, marked as late. After
 * that it is closed: its budget stays as planned, and a correction needs a
 * reason. `domain/budgetLock.ts` holds the rules and the real cases they
 * answer (docs/08, rule Y4).
 *
 * ── On a phone ────────────────────────────────────────────────────────────
 *
 * A phone shows all of it: the month, the planner, limits for kinds of
 * spending and the year's tables, one card under another.
 *
 * Rule 3.6 is untouched: `budgetView.test.ts` asserts the month view carries
 * it exactly.
 */

import { useMemo, useRef, useState, type ReactNode } from "react";

import {
  Alert,
  Button,
  Card,
  EmptyState,
  Money,
  ProgressBar,
  StatusPill,
  type Status,
} from "../components/primitives";
import { AmountInput, Select, TextInput } from "../components/forms";
import { BarChart } from "../components/charts";
import { useConfirm } from "../components/Confirm";
import { PeriodPicker } from "../components/PeriodPicker";
import { budgetForYear, budgetSummary, budgetYearTotals, type MonthBudgetRow } from "../domain/budget";
import {
  describeRevision,
  monthHistory,
  monthLock,
  monthMarks,
  revisionSummary,
  saveLimit,
  saveTracks,
  undoLast,
  type MonthLock,
  type SaveOutcome,
} from "../domain/budgetLock";
import {
  categoryLimits,
  categoryLines,
  monthBills,
  monthPlanView,
  phaseOf,
  planSuggestions,
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
import type {
  BudgetRevision,
  BudgetTrack,
  BudgetYear,
  Budgets,
  ReferenceLists,
  Transaction,
} from "../domain/types";
import { pickableYears } from "../domain/year";
import { useReportScreen } from "./screenReport";

const TRACKS = [
  { id: "spending", label: "Spending" },
  { id: "billsSubs", label: "Bills & subs" },
] as const;

/** Enough to see the shape of a month without a wall of small amounts. */
const TOP_CATEGORIES = 8;

/** A difference worth a look: at least ₱500.00 above the usual, and half as much again. */
const NOTABLE = 50000;

/** A sentence under a control, saying what a save did or why it did not. */
interface Note {
  readonly text: string;
  readonly over: boolean;
}

const monthLabel = (m: number): string => MONTH_NAMES[m - 1] ?? "";

const pct = (ratio: number): string => `${Math.round(ratio * 100)}%`;

const shortDay = (iso: string | undefined): string => {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-PH", { month: "short", day: "numeric" });
};

const changedAt = (at: string): string => {
  const d = new Date(at);
  return Number.isNaN(d.getTime())
    ? at
    : d.toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

/** "August", or "January to August", for months left alone. */
const spanOf = (months: readonly number[]): string => {
  const first = months[0] ?? 1;
  const last = months[months.length - 1] ?? first;
  return first === last ? monthLabel(first) : `${monthLabel(first)} to ${monthLabel(last)}`;
};

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
  /** A year's plan, written once, with a sentence for each change it holds. */
  onReplaceYear: (year: number, next: BudgetYear, changes?: readonly string[]) => void;
  /** Opens the Add form with this bill filled in, for checking before saving. */
  onRecordBill?: ((bill: MonthBill) => void) | undefined;
  /** Opens the Database searched for these words. */
  onShowRows?: ((query: string) => void) | undefined;
}) {
  const asOfYear = getYear(asOf);
  const asOfMonth = getMonth(asOf);

  const [year, setYear] = useState(asOfYear);
  const [month, setMonth] = useState(asOfMonth);
  const [note, setNote] = useState<Note | null>(null);
  const [limitNote, setLimitNote] = useState<Note | null>(null);
  const [limitFor, setLimitFor] = useState<string | null>(null);
  const [allCategories, setAllCategories] = useState(false);
  const plannerRef = useRef<HTMLElement>(null);

  const years = useMemo(
    () => pickableYears(transactions, Object.keys(budgets), asOf),
    [transactions, budgets, asOf],
  );

  /** How many months of the year have happened: all of a past year, none of a future one. */
  const monthsSoFar = year < asOfYear ? 12 : year > asOfYear ? 0 : asOfMonth;

  const y = useMemo(() => {
    const rows = budgetSummary(transactions, budgets, year);
    return {
      rows,
      totals: budgetYearTotals(rows),
      plan: budgetForYear(budgets, year),
      forecast: year === asOfYear ? forecastYear(transactions, year, asOfMonth, debts) : [],
      flow: cashFlow(transactions, year),
    };
  }, [transactions, budgets, debts, year, asOfYear, asOfMonth]);

  /** Months with anything recorded or budgeted: the picker shows the rest quieter. */
  const active = useMemo(
    () => new Set(y.rows.filter((r) => r.spent > 0 || r.budget > 0).map((r) => r.month)),
    [y.rows],
  );

  const stored = budgets[String(year)];
  const limits = useMemo(() => categoryLimits(stored, month), [stored, month]);
  const lock = monthLock(year, month, asOf);
  const marks = monthMarks(stored, month);
  const history = useMemo(() => monthHistory(stored, month), [stored, month]);

  const m = useMemo(
    () => ({
      view: monthPlanView(transactions, budgets, year, month, asOf),
      lines: categoryLines(transactions, year, month, 3, limits),
      bills: monthBills(transactions, reference, year, month, asOf),
      suggestions: planSuggestions(transactions, reference, budgets, year, month, asOf),
    }),
    [transactions, budgets, reference, year, month, asOf, limits],
  );

  const { view, lines, bills, suggestions } = m;
  const previous = suggestions.previous;
  const a = view.assessment;
  const name = monthLabel(month);
  const noPlan = a.combined.budget === 0;
  const pace = view.phase === "current" ? view.elapsed : undefined;
  const spentByKind = lines.reduce((s, l) => s + l.spent, 0);
  const limitsTotal = [...limits.values()].reduce((s, v) => s + v, 0);
  const limitsOpen = lock.state !== "closed";

  const unnamedBills = view.phase === "future" ? 0 : a.billsSubs.spent - bills.paid;

  const usual = suggestions.usualIncome;
  const unusualIncome =
    usual !== null && usual > 0 && view.revenue >= usual * 3 && view.revenue - usual >= 5_000_000;

  const planSpending = y.plan.spending.reduce((s, v) => s + v, 0);
  const planBills = y.plan.billsSubs.reduce((s, v) => s + v, 0);

  const addable = reference.spendingTypes
    .map((s) => s.name)
    .filter((n) => n.trim() && !lines.some((l) => l.name === n));

  const pick = (nextYear: number, nextMonth: number): void => {
    setYear(nextYear);
    setMonth(nextMonth);
    setNote(null);
    setLimitNote(null);
    setLimitFor(null);
  };

  const focusPlanner = (): void => {
    const el = plannerRef.current;
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    el.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
  };

  /**
   * Write what a save produced, or say why it was refused.
   *
   * Every change goes to the trail as its own sentence, and months a save
   * reached but left alone because they are over are named, never skipped
   * in silence (budgetLock B6).
   */
  const commit = (outcome: SaveOutcome, done: string, show: (n: Note) => void): boolean => {
    if (outcome.refused) {
      show({ text: outcome.refused, over: true });
      return false;
    }
    const left =
      outcome.skipped.length > 0
        ? ` ${spanOf(outcome.skipped)} ${outcome.skipped.length === 1 ? "is" : "are"} already over and ${
            outcome.skipped.length === 1 ? "was" : "were"
          } left as planned.`
        : "";
    if (outcome.written.length === 0) {
      show({ text: `Nothing changed: those are already the figures.${left}`, over: false });
      return true;
    }
    onReplaceYear(
      year,
      outcome.plan,
      outcome.revisions.map((r, i) => revisionSummary(year, outcome.written[i] ?? month, r)),
    );
    show({ text: `${done}${left}`, over: false });
    return true;
  };

  const now = (): string => new Date().toISOString();

  const usePrevious = (): void => {
    if (!previous) return;
    commit(
      saveTracks(y.plan, year, month, { spending: previous.spending, billsSubs: previous.billsSubs }, "month", asOf, now()),
      `Saved. ${name} uses the same budget as ${monthLabel(previous.month)}.`,
      setNote,
    );
  };

  const savePlan = (
    value: { spending: Centavos; billsSubs: Centavos },
    scope: PlanScope,
    reason: string,
  ): boolean => {
    const total = formatMoney(value.spending + value.billsSubs);
    const done =
      lock.state === "closed"
        ? `Corrected. ${name} ${year} is now ${total}, and the reason is kept with it.`
        : scope === "month"
          ? `Saved. ${name} is set to ${total}.`
          : scope === "rest"
            ? `Saved. ${name} through December are set to ${total} each.`
            : `Saved. Every month of ${year} still ahead is set to ${total}.`;
    return commit(saveTracks(y.plan, year, month, value, scope, asOf, now(), reason), done, setNote);
  };

  const undo = (): void => {
    commit(
      undoLast(y.plan, year, month, asOf, now()),
      "Undone. The budget is back to what it was before the last change.",
      setNote,
    );
  };

  const saveLimitFor = (kind: string, value: Centavos, scope: PlanScope): void => {
    const months =
      scope === "month" ? `in ${name}` : scope === "rest" ? `from ${name} to December` : `in every month of ${year} still ahead`;
    const ok = commit(
      saveLimit(y.plan, year, month, kind, value, scope, asOf, now()),
      value > 0 ? `Saved. ${kind} is limited to ${formatMoney(value)} a month ${months}.` : `Removed the limit on ${kind} ${months}.`,
      setLimitNote,
    );
    if (ok) setLimitFor(null);
  };

  const previousName = previous
    ? previous.year === year
      ? monthLabel(previous.month)
      : `last ${monthLabel(previous.month)}`
    : "";

  const lastChange = history[0];

  useReportScreen(
    () => ({
      screen: "Budget",
      lines: [
        `Looking at ${name} ${year}: ${
          view.phase === "current" ? `${view.daysLeft} days left` : view.phase === "past" ? "the month is over" : "not started"
        }. Its budget is ${
          lock.state === "open" ? "open to changes" : lock.state === "grace" ? `in its grace days, changeable until ${lock.editableUntil ?? "soon"}` : "closed"
        }.`,
        a.combined.budget === 0
          ? `No budget set for ${name} ${year}. Spent ${formatMoney(a.combined.spent)}.`
          : `Budget ${formatMoney(a.combined.budget)}: spending ${formatMoney(a.spending.spent)} of ${formatMoney(a.spending.budget)}, bills and subscriptions ${formatMoney(a.billsSubs.spent)} of ${formatMoney(a.billsSubs.budget)}.`,
        previous ? `${monthLabel(previous.month)} ${previous.year} was budgeted at ${formatMoney(previous.spending + previous.billsSubs)}; the planner can copy it in one tap.` : "",
        lines.length > 0
          ? `Spending by kind: ${lines
              .slice(0, 6)
              .map((l) => `${l.name} ${formatMoney(l.spent)}${l.limit !== null ? ` of a ${formatMoney(l.limit)} limit` : ""}`)
              .join(", ")}.`
          : "",
        bills.bills.length > 0 ? `Bills: ${bills.bills.map((b) => `${b.item} ${formatMoney(b.amount)} ${b.state}`).join(", ")}.` : "",
        lastChange ? `Last budget change: ${describeRevision(lastChange)}.` : "",
      ],
    }),
    [name, year, view, lock, a, previous, lines, bills, lastChange],
  );

  return (
    <div className="fms-budgetpage">
      <div className="fms-budgetpicker">
        <PeriodPicker
          year={year}
          month={month}
          years={years}
          onChange={pick}
          active={active}
          today={{ year: asOfYear, month: asOfMonth }}
        />
      </div>

      {/* ── The month ────────────────────────────────────────────────────── */}
      <div className="fms-budgettop">
        <Card
          title={`${name} ${year}`}
          subtitle={
            view.phase === "current"
              ? `${view.daysLeft} ${view.daysLeft === 1 ? "day" : "days"} left in the month`
              : view.phase === "future"
                ? "Not started yet"
                : lock.state === "grace"
                  ? `Ended. Its budget can change until ${shortDay(lock.editableUntil)}`
                  : "The month is over and its budget is closed"
          }
          action={
            <span className="fms-marks">
              {marks.corrected && <StatusPill status="warn">Corrected</StatusPill>}
              {marks.late && !marks.corrected && <StatusPill status="info">Set late</StatusPill>}
              <StatusPill status={statusOf(a.combined)}>{statusWord(a.combined, view.phase)}</StatusPill>
            </span>
          }
        >
          {noPlan ? (
            <div className="fms-budgetempty">
              <p className="t-body" style={{ margin: 0, color: "var(--ink-2)" }}>
                {lock.state === "closed"
                  ? `No budget was set for ${name} ${year}, and the month is closed.`
                  : `No budget for ${name} ${year} yet.`}{" "}
                {a.combined.spent > 0
                  ? `${formatMoney(a.combined.spent)} went out with nothing to measure it against.`
                  : lock.state === "closed"
                    ? ""
                    : "Set one and this shows what is left, and what that is a day."}
              </p>
              {lock.state === "closed" ? (
                <Button onClick={focusPlanner}>Correct it, with a reason</Button>
              ) : previous ? (
                <Button variant="primary" onClick={usePrevious}>
                  Use {previousName}'s budget, {formatMoney(previous.spending + previous.billsSubs)}
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

          {lastChange && !noPlan && (
            <p className="t-caption fms-budgetnote">
              Last change, {changedAt(lastChange.at)}: {describeRevision(lastChange)}.
            </p>
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

      {/* ── Setting the budget: a desk task ──────────────────────────────── */}
      {/* On a phone too: setting this month's budget is not a desk task. */}
      {
        <aside ref={plannerRef} className="fms-budgetrail" aria-label={`Set the budget for ${name}`}>
          <Planner
            key={`${year}-${month}-${suggestions.current.spending}-${suggestions.current.billsSubs}`}
            year={year}
            month={month}
            suggestions={suggestions}
            limitsTotal={limitsTotal}
            lock={lock}
            history={history}
            note={note}
            onSave={savePlan}
            onUndo={undo}
          />
        </aside>
      }

      {/* ── The detail ───────────────────────────────────────────────────── */}
        <div className="fms-budgetgrid">
          <Card
            title="Where it went"
            subtitle={
              spentByKind > 0
                ? `${formatMoney(spentByKind)} across ${lines.filter((l) => l.spent > 0).length} kinds of spending`
                : `Spending in ${name}, by kind`
            }
          >
            {limits.size > 0 ? (
                <div className="fms-limitsum">
                  <div className="fms-planner-sumrow">
                    <span className="t-label" style={{ color: "var(--ink-2)" }}>
                      Limits on {limits.size} {limits.size === 1 ? "kind" : "kinds"}
                    </span>
                    <span className="t-caption" style={{ color: "var(--ink-2)" }}>
                      <Money value={limitsTotal} size="s" />
                      {a.spending.budget > 0 && (
                        <>
                          {" "}
                          of <Money value={a.spending.budget} size="s" tone="var(--ink-3)" />
                        </>
                      )}
                    </span>
                  </div>
                  {a.spending.budget > 0 && <ProgressBar value={limitsTotal} max={a.spending.budget} height={6} />}
                  <p className="t-caption fms-planner-note">
                    {a.spending.budget === 0
                      ? "No spending budget for the month yet, so the limits stand on their own."
                      : limitsTotal > a.spending.budget
                        ? `The limits add up to ${formatMoney(limitsTotal - a.spending.budget)} more than the spending budget.`
                        : `${formatMoney(a.spending.budget - limitsTotal)} of the spending budget is for everything without a limit.`}
                    {lock.state === "closed" ? ` ${name} is closed, so its limits stay as they were.` : ""}
                  </p>
                </div>
              ) : lock.state !== "closed" ? (
                <p className="t-caption fms-planner-note fms-limitintro">
                  Any kind of spending can have its own limit inside the spending budget: food, travel,
                  whatever moves month to month. Bills are followed one by one in their own card.
                </p>
              ) : null}

            {limitNote && (
              <p
                className={limitNote.over ? "t-caption fms-note-over" : "t-caption"}
                role="status"
                style={{ margin: "0 0 var(--space-3)", ...(limitNote.over ? {} : { color: "var(--ink-2)" }) }}
              >
                {limitNote.text}
              </p>
            )}

            {lines.length === 0 ? (
              <EmptyState
                message={view.phase === "future" ? `${name} has not started.` : `Nothing spent in ${name}.`}
              />
            ) : (
              <>
                <ol className="fms-budgetcats">
                  {(allCategories ? lines : lines.slice(0, TOP_CATEGORIES)).map((l) => (
                    <CategoryRow
                      key={l.name}
                      line={l}
                      onShow={onShowRows}
                      onLimit={limitsOpen ? () => setLimitFor(limitFor === l.name ? null : l.name) : undefined}
                      editor={
                        limitsOpen && limitFor === l.name ? (
                          <LimitEditor
                            kind={l.name}
                            year={year}
                            month={month}
                            onlyThisMonth={lock.state !== "open"}
                            current={l.limit}
                            usual={l.usual}
                            onSave={(value, scope) => saveLimitFor(l.name, value, scope)}
                            onCancel={() => setLimitFor(null)}
                          />
                        ) : null
                      }
                    />
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

            {limitsOpen && addable.length > 0 && (
              <div className="fms-limitadd">
                <span className="t-caption" style={{ color: "var(--ink-3)" }}>
                  Limit another kind
                </span>
                <span className="fms-grow">
                  <Select
                    value=""
                    onChange={(v) => setLimitFor(v)}
                    options={addable}
                    placeholder="Pick a kind of spending"
                  />
                </span>
              </div>
            )}

            {limitsOpen && limitFor !== null && !lines.some((l) => l.name === limitFor) && (
              <LimitEditor
                kind={limitFor}
                year={year}
                month={month}
                onlyThisMonth={lock.state !== "open"}
                current={null}
                usual={null}
                onSave={(value, scope) => saveLimitFor(limitFor, value, scope)}
                onCancel={() => setLimitFor(null)}
              />
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
                    ? "No bill has been paid in the two months before, so there is nothing to expect yet."
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

      {/* ── The year ─────────────────────────────────────────────────────── */}
      <div className="fms-budgetrest">
        {/* The whole year, on a phone too. */}
        {
          <>
            <Card
              title={`Budget for ${year}`}
              subtitle={`Budgeted ${formatMoney(y.totals.budget)}, spent ${formatMoney(y.totals.spent)}, ${
                y.totals.remaining >= 0
                  ? `${formatMoney(y.totals.remaining)} left`
                  : `${formatMoney(-y.totals.remaining)} over`
              }`}
              action={
                <Button size="sm" onClick={focusPlanner}>
                  {lock.state === "closed" ? `Look at ${name}` : `Change ${name}`}
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
                    {y.rows.map((r, i) => (
                      <tr key={r.month} className={r.month === month ? "fms-budgetplan-on" : undefined}>
                        <td className="t-body-strong fms-rhead">
                          <button
                            type="button"
                            className="fms-monthlink"
                            aria-pressed={r.month === month}
                            onClick={() => pick(year, r.month)}
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
                          <RowStatus
                            row={r}
                            phase={phaseOf(year, r.month, asOf)}
                            closed={monthLock(year, r.month, asOf).state === "closed"}
                            corrected={monthMarks(stored, r.month).corrected}
                          />
                        </td>
                      </tr>
                    ))}
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

            {monthsSoFar > 0 && (
              <>
                <div className="fms-budgetcharts">
                  <Card title="Budget against spending" subtitle="Red where a month went over">
                    <BarChart
                      labels={MONTH_NAMES.slice(0, monthsSoFar).map((n) => n.slice(0, 3))}
                      budget={y.rows.slice(0, monthsSoFar).map((r) => r.budget)}
                      actual={y.rows.slice(0, monthsSoFar).map((r) => r.spent)}
                    />
                  </Card>

                  {y.forecast.some((f) => !f.isActual) && (
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
                  )}
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
                        {y.flow.slice(0, monthsSoFar).map((r) => (
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
              </>
            )}
          </>
        }
      </div>
    </div>
  );
}

// ── Choosing months ────────────────────────────────────────────────────────

/**
 * Which months a save reaches. A month that has ended takes changes only on
 * its own, so for one the choice is not offered at all.
 */
function ScopeChoice({
  year,
  month,
  value,
  onChange,
  label,
}: {
  year: number;
  month: number;
  value: PlanScope;
  onChange: (scope: PlanScope) => void;
  label: string;
}) {
  const short = monthLabel(month).slice(0, 3);
  const options: { id: PlanScope; label: string }[] = [
    { id: "month", label: `${short} only` },
    ...(month < 12 ? [{ id: "rest" as const, label: `${short} to Dec` }] : []),
    { id: "year", label: `All ${year}` },
  ];
  return (
    <div className="fms-segmented fms-scope" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          className={`fms-seg ${value === o.id ? "t-body-strong" : "t-body"}`}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── The planner ────────────────────────────────────────────────────────────

/**
 * Setting a month's budget, and its record.
 *
 * It starts from what the month already has, or else the month before's
 * budget, or else the ledger's own figures, and says which. A month in its
 * grace days says until when; a closed month shows what was planned and
 * offers a correction, which needs a reason. Every change is listed under it,
 * and the last one can be undone while the month still takes changes.
 */
function Planner({
  year,
  month,
  suggestions: s,
  limitsTotal,
  lock,
  history,
  note,
  onSave,
  onUndo,
}: {
  year: number;
  month: number;
  suggestions: PlanSuggestions;
  limitsTotal: Centavos;
  lock: MonthLock;
  history: readonly BudgetRevision[];
  note: Note | null;
  onSave: (value: { spending: Centavos; billsSubs: Centavos }, scope: PlanScope, reason: string) => boolean;
  onUndo: () => void;
}) {
  const name = monthLabel(month);
  const hasPlan = s.current.spending + s.current.billsSubs > 0;
  const closed = lock.state === "closed";
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
  const [correcting, setCorrecting] = useState(false);
  const [reason, setReason] = useState("");
  const [allChanges, setAllChanges] = useState(false);
  const { confirm, dialog } = useConfirm();

  const editable = !closed || correcting;
  const manyMonths = lock.state === "open";

  const total = (bills ?? 0) + (spending ?? 0);
  const changed = (bills ?? 0) !== s.current.billsSubs || (spending ?? 0) !== s.current.spending;
  const keep = s.expectedIncome === null ? null : s.expectedIncome - total;
  const incomeWords =
    s.expectedIncome === null
      ? ""
      : s.expectedFrom === "month"
        ? `the ${formatMoney(s.expectedIncome)} that came in this month`
        : `your usual ${formatMoney(s.expectedIncome)} income`;

  const billNames =
    s.bills.bills
      .slice(0, 4)
      .map((b) => `${b.item} ${formatMoney(b.amount)}`)
      .join(", ") + (s.bills.bills.length > 4 ? `, and ${s.bills.bills.length - 4} more` : "");

  const save = async (): Promise<void> => {
    const value = { spending: spending ?? 0, billsSubs: bills ?? 0 };
    const reach = manyMonths ? scope : "month";
    if (reach !== "month") {
      const ok = await confirm({
        title:
          reach === "rest"
            ? `Set ${name} through December to ${formatMoney(total)} each?`
            : `Set every month of ${year} still ahead to ${formatMoney(total)}?`,
        body: `Each of those months gets ${formatMoney(value.spending)} for spending and ${formatMoney(
          value.billsSubs,
        )} for bills and subscriptions, replacing what it had. Months already over stay as they were planned, and limits for kinds of spending are kept.`,
        confirmLabel: "Set the budget",
        tone: "normal",
      });
      if (!ok) return;
    }
    onSave(value, reach, closed ? reason : "");
  };

  const subtitle = closed
    ? `${name} ${year} is closed.`
    : hasPlan
      ? `${name} ${year} is budgeted at ${formatMoney(s.current.spending + s.current.billsSubs)}.`
      : `Nothing saved for ${name} ${year} yet. Filled in from ${source}, and saved only when you press Save.`;

  return (
    <Card title="Set the budget" subtitle={subtitle}>
      {dialog}
      <div className="fms-planner">
        {lock.state === "grace" && (
          <div className="fms-lockbanner t-caption">
            {name} has ended. Its budget can still be set or changed until {shortDay(lock.editableUntil)},
            marked as changed after the month ended. After that the month closes.
          </div>
        )}

        {closed && (
          <div className="fms-lockbanner t-caption">
            <span>
              Its budget stays as it was planned, so the month is judged against the plan it had rather
              than one set afterwards.
            </span>
            {!correcting && (
              <button type="button" className="t-caption fms-linkbtn" onClick={() => setCorrecting(true)}>
                The budget was wrong: correct it
              </button>
            )}
          </div>
        )}

        {!editable ? (
          <div className="fms-lockfigures">
            <div className="fms-planner-sumrow">
              <span className="t-caption" style={{ color: "var(--ink-2)" }}>
                Bills and subscriptions
              </span>
              <Money value={s.current.billsSubs} size="s" />
            </div>
            <div className="fms-planner-sumrow">
              <span className="t-caption" style={{ color: "var(--ink-2)" }}>
                Spending
              </span>
              <Money value={s.current.spending} size="s" />
            </div>
            <div className="fms-planner-sumrow">
              <span className="t-label" style={{ color: "var(--ink-2)" }}>
                Budget for the month
              </span>
              <Money value={s.current.spending + s.current.billsSubs} size="l" />
            </div>
          </div>
        ) : (
          <>
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
                <p className="t-caption fms-planner-note">No bills paid in the two months before to go by.</p>
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
                {limitsTotal > 0
                  ? `Limits for kinds of spending inside it come to ${formatMoney(limitsTotal)}${
                      (spending ?? 0) < limitsTotal ? ", more than this" : ""
                    }.`
                  : "Everything but bills: what you buy, money sent to other people, transfer fees and interest."}
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

            {closed ? (
              <div className="fms-planner-field">
                <span className="t-label" style={{ color: "var(--ink-2)" }}>
                  Why it needs correcting
                </span>
                <TextInput
                  value={reason}
                  onChange={setReason}
                  placeholder="For example: forgot to set it, or the rent went up"
                  ariaLabel="Why the budget needs correcting"
                />
                <p className="t-caption fms-planner-note">
                  Kept with the correction, under this card and in Activity.
                </p>
              </div>
            ) : manyMonths ? (
              <div className="fms-planner-scope">
                <span className="t-label" style={{ color: "var(--ink-2)" }}>
                  Save it to
                </span>
                <ScopeChoice
                  year={year}
                  month={month}
                  value={scope}
                  onChange={setScope}
                  label="Which months the budget is saved to"
                />
              </div>
            ) : null}

            <div className="fms-limitedit-actions">
              <Button variant="primary" fullWidth onClick={() => void save()}>
                {closed ? "Save the correction" : hasPlan ? "Save changes" : "Save budget"}
              </Button>
              {closed && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setCorrecting(false);
                    setReason("");
                  }}
                >
                  Cancel
                </Button>
              )}
            </div>
          </>
        )}

        {note && (
          <p
            className={note.over ? "t-caption fms-note-over" : "t-caption"}
            role="status"
            style={{ margin: 0, ...(note.over ? {} : { color: "var(--ink-2)" }) }}
          >
            {note.text}
          </p>
        )}

        {history.length > 0 && (
          <div>
            <div className="fms-planner-foot">
              <span className="t-label" style={{ color: "var(--ink-2)" }}>
                Changes to {name}'s budget
              </span>
              {!closed && (
                <button type="button" className="t-caption fms-linkbtn" onClick={onUndo}>
                  Undo the last change
                </button>
              )}
            </div>
            <ol className="fms-history">
              {(allChanges ? history : history.slice(0, 4)).map((r, i) => (
                <li key={`${r.at}-${i}`}>
                  <span className="t-micro fms-history-when">{changedAt(r.at)}</span>
                  <span className="t-caption" style={{ color: "var(--ink-2)" }}>
                    {describeRevision(r)}
                  </span>
                </li>
              ))}
            </ol>
            {history.length > 4 && (
              <button type="button" className="t-caption fms-linkbtn" onClick={() => setAllChanges((x) => !x)}>
                {allChanges ? "Show the last four" : `Show all ${history.length} changes`}
              </button>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

// ── Limits ─────────────────────────────────────────────────────────────────

/** A limit for one kind of spending, and which months it applies to. */
function LimitEditor({
  kind,
  year,
  month,
  onlyThisMonth,
  current,
  usual,
  onSave,
  onCancel,
}: {
  kind: string;
  year: number;
  month: number;
  /** A month that has ended takes a limit only for itself. */
  onlyThisMonth: boolean;
  current: Centavos | null;
  usual: Centavos | null;
  onSave: (value: Centavos, scope: PlanScope) => void;
  onCancel: () => void;
}) {
  // Starts at the limit it has, or its usual month in whole hundreds of pesos.
  const [value, setValue] = useState<Centavos | null>(
    current ?? (usual !== null && usual > 0 ? Math.round(usual / 10000) * 10000 : null),
  );
  // A limit is usually meant to last, so it defaults to the rest of the year.
  const [scope, setScope] = useState<PlanScope>(!onlyThisMonth && month < 12 ? "rest" : "month");

  return (
    <div className="fms-limitedit">
      <span className="t-label" style={{ color: "var(--ink-2)" }}>
        {kind}: limit a month
      </span>
      <AmountInput value={value} onChange={setValue} ariaLabel={`${kind} limit a month`} />
      {onlyThisMonth ? (
        <p className="t-caption fms-planner-note">{monthLabel(month)} has ended, so this is for {monthLabel(month)} only.</p>
      ) : (
        <ScopeChoice
          year={year}
          month={month}
          value={scope}
          onChange={setScope}
          label={`Which months the ${kind} limit is for`}
        />
      )}
      <div className="fms-limitedit-actions">
        <Button size="sm" variant="primary" onClick={() => onSave(value ?? 0, onlyThisMonth ? "month" : scope)}>
          Save limit
        </Button>
        {current !== null && (
          <Button size="sm" tone="danger" onClick={() => onSave(0, onlyThisMonth ? "month" : scope)}>
            Remove
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
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
 * A kind of spending: what it came to, and either its limit or its usual month.
 */
function CategoryRow({
  line,
  onShow,
  onLimit,
  editor,
}: {
  line: CategoryLine;
  onShow?: ((query: string) => void) | undefined;
  onLimit?: (() => void) | undefined;
  editor: ReactNode;
}) {
  const above = line.usual === null ? 0 : line.spent - line.usual;
  const notable =
    line.limit === null && line.usual !== null && above >= NOTABLE && (line.usual === 0 || above >= line.usual / 2);
  const over = line.limit !== null && line.spent > line.limit;

  const usualWords =
    line.usual === null ? "First month on record" : line.usual === 0 ? "Usually nothing" : `Usually ${formatMoney(line.usual)}`;

  return (
    <li className="fms-budgetcat">
      <div className="fms-budgetcat-head">
        {onShow && line.spent > 0 ? (
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
        <span className="fms-budgetcat-figure">
          <Money value={line.spent} size="s" tone={over ? "var(--over)" : undefined} />
          {line.limit !== null && (
            <span className="t-caption" style={{ color: "var(--ink-3)" }}>
              of {formatMoney(line.limit)}
            </span>
          )}
        </span>
      </div>

      {line.limit !== null ? (
        <ProgressBar value={line.spent} max={line.limit} height={6} />
      ) : (
        <div className="fms-budgetcat-bar" aria-hidden>
          <span style={{ width: `${Math.max(2, Math.round(line.share * 100))}%` }} />
        </div>
      )}

      <div className="t-caption fms-budgetcat-foot">
        <span>
          {line.limit === null
            ? usualWords
            : over
              ? `${formatMoney(line.spent - line.limit)} over the limit`
              : `${formatMoney(line.limit - line.spent)} left of the limit`}
        </span>
        <span className="fms-budgetcat-actions">
          {notable && <span className="t-micro fms-budgetcat-flag">{formatMoney(above)} more than usual</span>}
          {onLimit && (
            <button type="button" className="t-caption fms-linkbtn" onClick={onLimit}>
              {line.limit !== null ? "Change limit" : "Set a limit"}
            </button>
          )}
        </span>
      </div>

      {editor}
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

function RowStatus({
  row,
  phase,
  closed,
  corrected,
}: {
  row: MonthBudgetRow;
  phase: MonthPhase;
  closed: boolean;
  corrected: boolean;
}) {
  const verdict =
    row.budget === 0 ? (
      <StatusPill status="none">No budget</StatusPill>
    ) : phase === "future" && row.spent === 0 ? (
      <StatusPill status="info">Planned</StatusPill>
    ) : row.status === "OVER THE BUDGET" ? (
      <StatusPill status="over">Over</StatusPill>
    ) : (
      <StatusPill status="ok">Within</StatusPill>
    );
  return (
    <span className="fms-marks" style={{ justifyContent: "flex-start" }}>
      {verdict}
      {corrected ? (
        <span className="t-micro" style={{ color: "var(--ink-3)" }}>
          corrected
        </span>
      ) : closed ? (
        <span className="t-micro" style={{ color: "var(--ink-3)" }}>
          closed
        </span>
      ) : null}
    </span>
  );
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
