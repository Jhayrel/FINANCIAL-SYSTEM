/**
 * Insights: spec 7.6.
 *
 * A month calendar with spend intensity, the two-track budget, bills due, and
 * the smart daily allocation.
 *
 * The AI sits on top of these figures, never instead of them: it is handed the
 * numbers this screen already computed and asked to put them into a sentence.
 * Nothing on this screen depends on a model answering.
 */

import { useMemo, useState } from "react";

import {
  Alert,
  Button,
  Card,
  CountChip,
  EmptyState,
  Money,
  ProgressBar,
  SegmentedControl,
  StatusPill,
} from "../components/primitives";
import { AiAnswerView } from "../components/AiAnswer";
import { useAi } from "./useAi";
import type { AppSettings } from "../domain/settings";
import { RankBars } from "../components/charts";
import { learnPatterns, planDay, REASON_LABEL } from "../domain/allocation";
import { billStatuses, overdue, paidThisMonth, upcoming } from "../domain/bills";
import { assessMonthFor, dailyPacing } from "../domain/budget";
import { totalWalletBalance } from "../domain/balances";
import type { Debt } from "../domain/debt";
import { positionsOf } from "../domain/debt";
import {
  daysInMonth,
  dayOfWeek,
  firstOfMonth,
  formatMedium,
  getMonth,
  getYear,
  makeDate,
  monthName,
  MONTH_NAMES,
} from "../domain/dates";
import { dailySpending, expenseRanking, monthTotals, spendingRanking } from "../domain/totals";
import type { Budgets, ReferenceLists, Transaction } from "../domain/types";

const DAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"];

export function Insights({
  transactions,
  reference,
  budgets,
  debts,
  asOf,
  settings,
}: {
  transactions: readonly Transaction[];
  reference: ReferenceLists;
  budgets: Budgets;
  debts: readonly Debt[];
  asOf: string;
  settings: AppSettings;
}) {
  const year = getYear(asOf);
  const [month, setMonth] = useState(getMonth(asOf));

  /**
   * The summary follows the month picker, not the clock. Looking at March and
   * reading a description of August would be wrong in a way that is very hard
   * to spot, because every figure in it would be real.
   */
  const viewing = month === getMonth(asOf) ? asOf : makeDate(year, month, 1);
  const ai = useAi({
    settings,
    transactions,
    budgets,
    reference,
    feature: "insightSummary",
    asOf: viewing,
  });

  const v = useMemo(() => {
    const totals = monthTotals(transactions, year, month);
    const budget = assessMonthFor(transactions, budgets, year, month);
    const pacing = dailyPacing(transactions, budgets, makeDate(year, month, Math.min(getMonth(asOf) === month ? Number(asOf.slice(8)) : 1, daysInMonth(year, month))));
    const days = dailySpending(transactions, year, month, daysInMonth(year, month));
    const bills = billStatuses(transactions, reference, asOf);
    const positions = positionsOf(debts, transactions, asOf);
    const walletBalance = totalWalletBalance(transactions, reference.wallets);
    const plan = planDay(walletBalance, learnPatterns(transactions, asOf), positions, asOf);

    return {
      totals,
      budget,
      pacing,
      days,
      bills,
      plan,
      range: { start: firstOfMonth(year, month), end: makeDate(year, month, daysInMonth(year, month)) },
    };
  }, [transactions, reference, budgets, debts, year, month, asOf]);

  const ranking = useMemo(
    () => spendingRanking(transactions, reference.spendingTypes, v.range).slice(0, 6),
    [transactions, reference.spendingTypes, v.range],
  );

  const billsRanking = useMemo(
    () => [
      ...expenseRanking(transactions, "Bills", v.range),
      ...expenseRanking(transactions, "Subscriptions", v.range),
    ].sort((a, b) => b.amount - a.amount),
    [transactions, v.range],
  );

  const due = upcoming(v.bills);
  const late = overdue(v.bills);
  const paid = paidThisMonth(v.bills);
  const maxDay = Math.max(1, ...v.days);

  return (
    <div className="fms-dash">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap" }}>
        <SegmentedControl
          options={MONTH_NAMES.slice(0, 12).map((m, i) => ({ id: String(i + 1), label: m.slice(0, 3) }))}
          value={String(month)}
          onChange={(id) => setMonth(Number(id))}
        />
        <CountChip>{monthName(month)} {year}</CountChip>
      </div>

      <Card
        title={`${monthName(month)} in a sentence`}
        subtitle={ai.disabled ? "Written on this device" : "Ask the model to describe the month"}
      >
        {ai.answer ? (
          <AiAnswerView answer={ai.answer} />
        ) : (
          <p className="t-body" style={{ margin: 0, color: "var(--ink-3)" }}>
            Nothing asked yet. The figures below are already correct; this only puts them into
            words.
          </p>
        )}

        <div className="fms-addrow" style={{ marginTop: "var(--space-3)" }}>
          <Button variant="primary" loading={ai.loading} onClick={() => void ai.run("summary")}>
            {ai.answer ? "Ask again" : "Describe this month"}
          </Button>
          <Button onClick={() => void ai.run("patterns")}>Look for a pattern</Button>
        </div>
      </Card>

      {late.length > 0 && (
        <Alert status="over" title={`${late.length} bill${late.length === 1 ? "" : "s"} overdue`}>
          {late.map((b) => b.item).join(", ")}: predicted due before today and not yet paid.
        </Alert>
      )}

      <div className="fms-charts">
        {/* Calendar heat */}
        <Card title="Spending calendar" subtitle="Darker means a heavier day">
          <div className="fms-cal">
            {DAY_INITIALS.map((d, i) => (
              <div key={i} className="t-micro fms-calhead">{d}</div>
            ))}
            {Array.from({ length: dayOfWeek(firstOfMonth(year, month)) }, (_, i) => (
              <div key={`pad${i}`} />
            ))}
            {v.days.map((amount, i) => {
              const intensity = amount / maxDay;
              return (
                <div
                  key={i}
                  className="fms-calday"
                  title={amount > 0 ? `${i + 1}: ₱${(amount / 100).toLocaleString("en-PH", { minimumFractionDigits: 2 })}` : `${i + 1}: nothing`}
                  style={{
                    background: amount > 0 ? `color-mix(in srgb, var(--flow-spending) ${Math.round(12 + intensity * 68)}%, var(--surface))` : "var(--surface-sunk)",
                    color: intensity > 0.5 ? "var(--on-brand)" : "var(--ink-2)",
                  }}
                >
                  {i + 1}
                </div>
              );
            })}
          </div>
        </Card>

        {/* Two-track budget */}
        <Card title="Budget vs actual" subtitle="Two independent tracks">
          <div style={{ display: "grid", gap: "var(--space-4)" }}>
            {([
              ["Spending", v.budget.spending],
              ["Bills & subscriptions", v.budget.billsSubs],
            ] as const).map(([label, track]) => {
              const over = track.status === "OVER THE BUDGET";
              return (
                <div key={label}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "var(--space-2)", marginBottom: 6 }}>
                    <span className="t-body-strong">{label}</span>
                    <StatusPill status={over ? "over" : track.budget === 0 ? "none" : "ok"}>
                      {over ? `over by ${fmt(-track.remaining)}` : track.budget === 0 ? "no budget" : `${fmt(track.remaining)} left`}
                    </StatusPill>
                  </div>
                  <ProgressBar value={track.spent} max={track.budget} pace={v.pacing.daysElapsed / v.pacing.daysInMonth} />
                  <div className="fms-qrow" style={{ border: 0, paddingTop: 6 }}>
                    <span className="t-caption" style={{ color: "var(--ink-3)" }}>spent</span>
                    <span>
                      <Money value={track.spent} size="s" /> <span className="t-caption" style={{ color: "var(--ink-3)" }}>of</span>{" "}
                      <Money value={track.budget} size="s" tone="var(--ink-3)" />
                    </span>
                  </div>
                </div>
              );
            })}

            <div className="fms-qrow">
              <span className="t-body-strong">Month total</span>
              <Money value={v.totals.total} size="l" />
            </div>
            {v.totals.interest > 0 && (
              <div className="fms-qrow">
                <span className="t-caption" style={{ color: "var(--ink-2)" }}>of which debt interest</span>
                <Money value={v.totals.interest} size="s" tone="var(--flow-debt-text)" />
              </div>
            )}
          </div>
        </Card>
      </div>

      <div className="fms-charts">
        {/* Smart allocation */}
        <Card title="Smart daily allocation" subtitle="Learned from how you actually spend">
          {v.plan.allocations.length === 0 ? (
            <EmptyState message="Not enough budget left to allocate. Add revenue or wait for next month." />
          ) : (
            <div style={{ display: "grid", gap: "var(--space-3)" }}>
              <div className="fms-qrow">
                <span className="t-caption" style={{ color: "var(--ink-2)" }}>
                  {v.plan.daysLeft} day{v.plan.daysLeft === 1 ? "" : "s"} left
                </span>
                <span>
                  <Money value={v.plan.dailyBudget} size="l" />
                  <span className="t-caption" style={{ color: "var(--ink-3)" }}>/day</span>
                </span>
              </div>

              {v.plan.debtClaim > 0 && (
                <Alert status="warn">
                  <Money value={v.plan.debtClaim} size="s" /> of debt is due inside this window and was
                  set aside before allocating.
                </Alert>
              )}

              {v.plan.allocations.map((a) => (
                <div key={a.name} className="fms-qrow">
                  <span className="t-body">
                    {a.name}
                    {a.reason !== "usual" && (
                      <span className="t-micro" style={{ color: "var(--ink-3)" }}> · {REASON_LABEL[a.reason]}</span>
                    )}
                  </span>
                  <Money value={a.amount} />
                </div>
              ))}

              <div className="fms-qrow">
                <span className="t-body-strong">Suggested total</span>
                <Money value={v.plan.suggestedTotal} size="l" />
              </div>
            </div>
          )}
        </Card>

        {/* Bills */}
        <Card title="Bills and subscriptions" subtitle="Predicted one month after the last payment">
          <div style={{ display: "grid", gap: "var(--space-4)" }}>
            <section>
              <div className="t-label" style={{ color: "var(--ink-2)", marginBottom: "var(--space-2)" }}>
                Due soon
              </div>
              {due.length === 0 ? (
                <p className="t-caption" style={{ margin: 0, color: "var(--ink-3)" }}>All recurring bills are paid.</p>
              ) : (
                due.map((b) => (
                  <div key={b.item} className="fms-qrow">
                    <span className="t-body">
                      {b.item}
                      {b.nextDue && (
                        <span className="t-micro" style={{ color: b.daysToDue !== undefined && b.daysToDue < 0 ? "var(--over)" : "var(--ink-3)" }}>
                          {" "}· {b.daysToDue !== undefined && b.daysToDue < 0 ? `${Math.abs(b.daysToDue)}d overdue` : `in ${b.daysToDue}d`}
                        </span>
                      )}
                    </span>
                    <Money value={b.lastAmount || b.averageAmount} size="s" />
                  </div>
                ))
              )}
            </section>

            <section>
              <div className="t-label" style={{ color: "var(--ink-2)", marginBottom: "var(--space-2)" }}>
                Paid in {monthName(month)}
              </div>
              {paid.length === 0 ? (
                <p className="t-caption" style={{ margin: 0, color: "var(--ink-3)" }}>Nothing paid yet this month.</p>
              ) : (
                paid.map((b) => (
                  <div key={b.item} className="fms-qrow">
                    <span className="t-body">{b.item}</span>
                    <Money value={b.paidThisMonthAmount} size="s" tone="var(--ok)" />
                  </div>
                ))
              )}
            </section>
          </div>
        </Card>
      </div>

      <div className="fms-charts">
        <Card title="Top spending" subtitle={`${monthName(month)} ${year}`}>
          {ranking.length === 0 ? <EmptyState message="No spending recorded this month." /> : <RankBars rows={ranking} />}
        </Card>
        <Card title="Bills and subscriptions" subtitle={`${monthName(month)} ${year}`}>
          {billsRanking.length === 0 ? <EmptyState message="No bills paid this month." /> : <RankBars rows={billsRanking} />}
        </Card>
      </div>

      <p className="t-caption" style={{ color: "var(--ink-3)", textAlign: "center" }}>
        Figures as of {formatMedium(asOf)}
      </p>
    </div>
  );
}

const fmt = (c: number): string =>
  `₱${(c / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
