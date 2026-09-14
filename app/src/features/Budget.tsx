/**
 * Budget: spec 7.7.
 *
 * The 12-month grid, editable in place, plus the forecast and net cash flow
 * tables from the BUDGETING sheet.
 *
 * ── Months down the side ──────────────────────────────────────────────────
 *
 * The grid ran the twelve months across, as the BUDGETING sheet does, which
 * needs about 1300px. Anywhere narrower than a 1920px monitor it scrolled
 * sideways inside its card, and on a phone it was three visible months in a
 * box you had to drag. A year of budget is twelve rows of two figures, which
 * fits every screen and reads in the same direction as the monthly summary
 * under it.
 *
 * Every table here is an `.fms-rtable` (components.css): a table on a card
 * wide enough for it, and a list of labelled rows on a card that is not.
 */

import { useMemo, useState } from "react";

import { Button, Card, CountChip, Money, StatusPill } from "../components/primitives";
import { AmountInput } from "../components/forms";
import { BarChart } from "../components/charts";
import { budgetForYear, budgetSummary, budgetYearTotals } from "../domain/budget";
import type { Debt } from "../domain/debt";
import { cashFlow, explainBasis, forecastYear } from "../domain/forecast";
import { getMonth, getYear, MONTH_NAMES } from "../domain/dates";
import type { Budgets, Transaction } from "../domain/types";
import type { Centavos } from "../domain/money";

const TRACKS = [
  { id: "spending", label: "Spending", spoken: "spending" },
  { id: "billsSubs", label: "Bills & subs", spoken: "bills and subscriptions" },
] as const;

export function Budget({
  transactions,
  budgets,
  debts,
  asOf,
  onChangeBudget,
}: {
  transactions: readonly Transaction[];
  budgets: Budgets;
  debts: readonly Debt[];
  asOf: string;
  onChangeBudget: (year: number, month: number, track: "spending" | "billsSubs", value: Centavos) => void;
}) {
  const year = getYear(asOf);
  const asOfMonth = getMonth(asOf);
  const [editing, setEditing] = useState(false);

  const v = useMemo(() => {
    const rows = budgetSummary(transactions, budgets, year);
    return {
      rows,
      totals: budgetYearTotals(rows),
      year: budgetForYear(budgets, year),
      forecast: forecastYear(transactions, year, asOfMonth, debts),
      flow: cashFlow(transactions, year),
    };
  }, [transactions, budgets, debts, year, asOfMonth]);

  return (
    <div className="fms-dash">
      {/* Budget input grid */}
      <Card
        title="Budget"
        subtitle={`${year} · two tracks per month`}
        action={
          <Button size="sm" variant={editing ? "primary" : "secondary"} onClick={() => setEditing((e) => !e)}>
            {editing ? "Done" : "Edit"}
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
              </tr>
            </thead>
            <tbody>
              {MONTH_NAMES.map((name, i) => (
                <tr key={name}>
                  <td className="t-body-strong fms-rhead">{name}</td>
                  {TRACKS.map((t) => {
                    const value = v.year[t.id][i] ?? 0;
                    return (
                      <td key={t.id} className="fms-rnum" data-label={t.label}>
                        {editing ? (
                          <AmountInput
                            value={value}
                            onChange={(val) => onChangeBudget(year, i + 1, t.id, val ?? 0)}
                            ariaLabel={`${name} ${t.spoken} budget`}
                          />
                        ) : (
                          <Money value={value} size="s" tone={value === 0 ? "var(--ink-3)" : undefined} />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Monthly summary */}
      <Card
        title="Monthly summary"
        subtitle="Budget against what actually happened"
        padded={false}
        action={<CountChip>{fmt(v.totals.remaining)} remaining</CountChip>}
      >
        <div className="fms-rtable-wrap">
          <table className="fms-rtable">
            <thead>
              <tr>
                <th className="t-th">Month</th>
                <th className="t-th fms-rnum">Budget</th>
                <th className="t-th fms-rnum">Spent</th>
                <th className="t-th fms-rnum">Remaining</th>
                <th className="t-th">Status</th>
              </tr>
            </thead>
            <tbody>
              {v.rows.map((r) => {
                const over = r.status === "OVER THE BUDGET";
                return (
                  <tr key={r.month} style={{ background: over ? "var(--over-bg)" : undefined }}>
                    <td className="t-body fms-rhead">{r.monthName}</td>
                    <td className="fms-rnum" data-label="Budget">
                      <Money value={r.budget} size="s" tone={r.budget === 0 ? "var(--ink-3)" : undefined} />
                    </td>
                    <td className="fms-rnum" data-label="Spent">
                      <Money value={r.spent} size="s" tone={r.spent === 0 ? "var(--ink-3)" : undefined} />
                    </td>
                    <td className="fms-rnum" data-label="Remaining">
                      <Money value={r.remaining} size="s" />
                    </td>
                    <td data-label="Status">
                      <StatusPill status={over ? "over" : r.budget === 0 ? "none" : "ok"}>
                        {over ? "Over" : r.budget === 0 ? "No budget" : "Within"}
                      </StatusPill>
                    </td>
                  </tr>
                );
              })}
              <tr className="fms-rtotal">
                <td className="t-body-strong fms-rhead">Total</td>
                <td className="fms-rnum" data-label="Budget">
                  <Money value={v.totals.budget} />
                </td>
                <td className="fms-rnum" data-label="Spent">
                  <Money value={v.totals.spent} />
                </td>
                <td className="fms-rnum" data-label="Remaining">
                  <Money value={v.totals.remaining} />
                </td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <div className="fms-charts">
        <Card title="Budget vs actual" subtitle="Red where the month went over">
          <BarChart
            labels={MONTH_NAMES.slice(0, asOfMonth).map((m) => m.slice(0, 3))}
            budget={v.rows.slice(0, asOfMonth).map((r) => r.budget)}
            actual={v.rows.slice(0, asOfMonth).map((r) => r.spent)}
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
                {v.forecast.filter((f) => !f.isActual).map((f) => (
                  <tr key={f.month}>
                    <td className="t-body fms-rhead">{MONTH_NAMES[f.month - 1]}</td>
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

      {/* Net cash flow */}
      <Card title="Net cash flow" subtitle="What came in against what went out" padded={false}>
        <div className="fms-rtable-wrap">
          <table className="fms-rtable">
            <thead>
              <tr>
                <th className="t-th">Month</th>
                <th className="t-th fms-rnum">Revenue</th>
                <th className="t-th fms-rnum">Expense</th>
                <th className="t-th fms-rnum">Transfers</th>
                <th className="t-th fms-rnum">Net</th>
              </tr>
            </thead>
            <tbody>
              {v.flow.slice(0, asOfMonth).map((r) => (
                <tr key={r.month}>
                  <td className="t-body fms-rhead">{MONTH_NAMES[r.month - 1]}</td>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

const fmt = (c: number): string =>
  `₱${(c / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
