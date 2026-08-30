/**
 * Budget: spec 7.7.
 *
 * The 12-month grid, editable in place, plus the forecast and net cash flow
 * tables from the BUDGETING sheet.
 */

import { useMemo, useState } from "react";

import { Card, CountChip, Money, StatusPill } from "../components/primitives";
import { AmountInput } from "../components/forms";
import { BarChart } from "../components/charts";
import { budgetForYear, budgetSummary, budgetYearTotals } from "../domain/budget";
import type { Debt } from "../domain/debt";
import { cashFlow, explainBasis, forecastYear } from "../domain/forecast";
import { getMonth, getYear, MONTH_NAMES } from "../domain/dates";
import type { Budgets, Transaction } from "../domain/types";
import type { Centavos } from "../domain/money";

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
          <button
            onClick={() => setEditing((e) => !e)}
            className="t-caption"
            style={{
              background: "none",
              border: "1px solid var(--hairline-strong)",
              borderRadius: "var(--radius-md)",
              padding: "6px var(--space-3)",
              color: "var(--ink-2)",
            }}
          >
            {editing ? "Done" : "Edit"}
          </button>
        }
        padded={false}
      >
        <div className="scroll-slim" style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
            <thead>
              <tr style={{ background: "var(--surface-sunk)" }}>
                <th className="t-th" style={thStyle}>Track</th>
                {MONTH_NAMES.map((m) => (
                  <th key={m} className="t-th" style={{ ...thStyle, textAlign: "right" }}>
                    {m.slice(0, 3)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(["spending", "billsSubs"] as const).map((track) => (
                <tr key={track}>
                  <td className="t-body-strong" style={tdStyle}>
                    {track === "spending" ? "Spending" : "Bills & subs"}
                  </td>
                  {MONTH_NAMES.map((_, i) => (
                    <td key={i} style={{ ...tdStyle, textAlign: "right", minWidth: 92 }}>
                      {editing ? (
                        <AmountInput
                          value={v.year[track][i] ?? 0}
                          onChange={(val) => onChangeBudget(year, i + 1, track, val ?? 0)}
                        />
                      ) : (
                        <Money
                          value={v.year[track][i] ?? 0}
                          size="s"
                          tone={(v.year[track][i] ?? 0) === 0 ? "var(--ink-3)" : undefined}
                        />
                      )}
                    </td>
                  ))}
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
        <div className="scroll-slim" style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "var(--surface-sunk)" }}>
                <th className="t-th" style={thStyle}>Month</th>
                <th className="t-th" style={{ ...thStyle, textAlign: "right" }}>Budget</th>
                <th className="t-th" style={{ ...thStyle, textAlign: "right" }}>Spent</th>
                <th className="t-th" style={{ ...thStyle, textAlign: "right" }}>Remaining</th>
                <th className="t-th" style={thStyle}>Status</th>
              </tr>
            </thead>
            <tbody>
              {v.rows.map((r) => {
                const over = r.status === "OVER THE BUDGET";
                return (
                  <tr key={r.month} style={{ background: over ? "var(--over-bg)" : undefined }}>
                    <td className="t-body" style={tdStyle}>{r.monthName}</td>
                    <td style={{ ...tdStyle, textAlign: "right" }}><Money value={r.budget} size="s" tone={r.budget === 0 ? "var(--ink-3)" : undefined} /></td>
                    <td style={{ ...tdStyle, textAlign: "right" }}><Money value={r.spent} size="s" tone={r.spent === 0 ? "var(--ink-3)" : undefined} /></td>
                    <td style={{ ...tdStyle, textAlign: "right" }}><Money value={r.remaining} size="s" /></td>
                    <td style={tdStyle}>
                      <StatusPill status={over ? "over" : r.budget === 0 ? "none" : "ok"}>
                        {over ? "Over" : r.budget === 0 ? "No budget" : "Within"}
                      </StatusPill>
                    </td>
                  </tr>
                );
              })}
              <tr style={{ background: "var(--surface-sunk)" }}>
                <td className="t-body-strong" style={tdStyle}>Total</td>
                <td style={{ ...tdStyle, textAlign: "right" }}><Money value={v.totals.budget} /></td>
                <td style={{ ...tdStyle, textAlign: "right" }}><Money value={v.totals.spent} /></td>
                <td style={{ ...tdStyle, textAlign: "right" }}><Money value={v.totals.remaining} /></td>
                <td style={tdStyle} />
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
          <div className="scroll-slim" style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "var(--surface-sunk)" }}>
                  <th className="t-th" style={thStyle}>Month</th>
                  <th className="t-th" style={{ ...thStyle, textAlign: "right" }}>Spending</th>
                  <th className="t-th" style={{ ...thStyle, textAlign: "right" }}>Bills</th>
                  <th className="t-th" style={{ ...thStyle, textAlign: "right" }}>Total</th>
                  <th className="t-th" style={thStyle}>Basis</th>
                </tr>
              </thead>
              <tbody>
                {v.forecast.filter((f) => !f.isActual).map((f) => (
                  <tr key={f.month}>
                    <td className="t-body" style={tdStyle}>{MONTH_NAMES[f.month - 1]}</td>
                    <td style={{ ...tdStyle, textAlign: "right" }}><Money value={f.spending} size="s" /></td>
                    <td style={{ ...tdStyle, textAlign: "right" }}><Money value={f.billsSubs} size="s" /></td>
                    <td style={{ ...tdStyle, textAlign: "right" }}><Money value={f.total} size="s" /></td>
                    <td className="t-micro" style={{ ...tdStyle, color: "var(--ink-3)" }}>{explainBasis(f.basis)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {/* Net cash flow */}
      <Card title="Net cash flow" subtitle="What came in against what went out" padded={false}>
        <div className="scroll-slim" style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "var(--surface-sunk)" }}>
                <th className="t-th" style={thStyle}>Month</th>
                <th className="t-th" style={{ ...thStyle, textAlign: "right" }}>Revenue</th>
                <th className="t-th" style={{ ...thStyle, textAlign: "right" }}>Expense</th>
                <th className="t-th" style={{ ...thStyle, textAlign: "right" }}>Transfers</th>
                <th className="t-th" style={{ ...thStyle, textAlign: "right" }}>Net</th>
              </tr>
            </thead>
            <tbody>
              {v.flow.slice(0, asOfMonth).map((r) => (
                <tr key={r.month}>
                  <td className="t-body" style={tdStyle}>{MONTH_NAMES[r.month - 1]}</td>
                  <td style={{ ...tdStyle, textAlign: "right" }}><Money value={r.revenue} size="s" tone="var(--flow-revenue-text)" /></td>
                  <td style={{ ...tdStyle, textAlign: "right" }}><Money value={r.expense} size="s" tone="var(--flow-spending-text)" /></td>
                  <td style={{ ...tdStyle, textAlign: "right" }}><Money value={r.transfer} size="s" tone="var(--ink-3)" /></td>
                  <td style={{ ...tdStyle, textAlign: "right" }}><Money value={r.net} size="s" signed /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

const thStyle = {
  padding: "var(--space-3) var(--space-4)",
  textAlign: "left" as const,
  color: "var(--ink-2)",
  whiteSpace: "nowrap" as const,
  borderBottom: "1px solid var(--hairline)",
};

const tdStyle = {
  padding: "var(--space-2) var(--space-4)",
  borderBottom: "1px solid var(--hairline)",
  whiteSpace: "nowrap" as const,
};

const fmt = (c: number): string =>
  `₱${(c / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
