/**
 * Dashboard: style guide §3.5, spec 7.2.
 *
 * Net worth is the hero and is always broken into its parts, because the
 * whole point of the debt module is that the components are visible. The
 * Excel showed ₱7,670.03 "TOTAL FUNDS" with no idea that ₱2,950 of it was
 * borrowed.
 */

import { useMemo } from "react";

import {
  Alert,
  Button,
  Card,
  CountChip,
  FlowBadge,
  KpiTile,
  Money,
  ProgressBar,
  StatusPill,
} from "../components/primitives";
import { AiAnswerView } from "../components/AiAnswer";
import { useAi } from "./useAi";
import type { AppSettings } from "../domain/settings";
import { AreaChart, BarChart, RankBars } from "../components/charts";
import { assessMonthFor, budgetSummary, dailyPacing } from "../domain/budget";
import type { Debt } from "../domain/debt";
import { incomeQuality, netWorth, positionsOf } from "../domain/debt";
import { getMonth, getYear, monthName } from "../domain/dates";
import { checkIntegrity, actionableIssues } from "../domain/integrity";
import {
  monthTotals,
  monthlyTotalsForYear,
  spendingRanking,
  totalSpending,
} from "../domain/totals";
import { totalSavingsBalance, totalWalletBalance } from "../domain/balances";
import type { Budgets, ReferenceLists, Transaction, WalletBalance } from "../domain/types";
import { financeAlerts } from "../domain/alerts";
import { billStatuses } from "../domain/bills";
import type { Account } from "../domain/accounts";
import type { Centavos } from "../domain/money";

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function Dashboard({
  transactions,
  reference,
  budgets,
  debts,
  balances,
  accounts,
  lowBalanceThreshold,
  asOf,
  onReview,
  settings,
}: {
  transactions: readonly Transaction[];
  reference: ReferenceLists;
  budgets: Budgets;
  debts: readonly Debt[];
  balances: readonly WalletBalance[];
  accounts: readonly Account[];
  lowBalanceThreshold: Centavos;
  asOf: string;
  onReview: () => void;
  settings: AppSettings;
}) {
  /**
   * Everything worth saying, worst first.
   *
   * This replaces a panel that only ever reported integrity findings, which
   * left the low balance threshold and the bill predictions as settings with
   * nothing reading them. See `domain/alerts.ts`.
   */
  const alerts = useMemo(
    () =>
      financeAlerts({
        transactions,
        accounts,
        budgets,
        debts,
        bills: billStatuses(transactions, reference, asOf),
        lowBalanceThreshold,
        asOf,
      }),
    [transactions, accounts, budgets, debts, reference, lowBalanceThreshold, asOf],
  );
  const ai = useAi({ settings, transactions, budgets, feature: "alerts", asOf });

  const year = getYear(asOf);
  const month = getMonth(asOf);

  const v = useMemo(() => {
    const positions = positionsOf(debts, transactions, asOf);
    const wallets = totalWalletBalance(transactions, reference.wallets);
    const savings = totalSavingsBalance(transactions, reference.savings);
    const worth = netWorth(wallets, savings, positions);

    const totals = monthTotals(transactions, year, month);
    const budget = assessMonthFor(transactions, budgets, year, month);
    const pacing = dailyPacing(transactions, budgets, asOf);
    const perMonth = monthlyTotalsForYear(transactions, year);
    const rows = budgetSummary(transactions, budgets, year);

    return {
      positions,
      worth,
      totals,
      budget,
      pacing,
      income: incomeQuality(transactions, debts, { start: `${year}-01-01`, end: `${year}-12-31` }),
      annual: totalSpending(transactions, { start: `${year}-01-01`, end: `${year}-12-31` }),
      ranking: spendingRanking(transactions, reference.spendingTypes, {
        start: `${year}-01-01`,
        end: `${year}-12-31`,
      }).slice(0, 6),
      spendSeries: perMonth.map((m) => m.total),
      revSeries: perMonth.map((m) => m.revenue),
      budgetSeries: rows.map((r) => r.budget),
      issues: actionableIssues(checkIntegrity(transactions)),
    };
  }, [transactions, reference, budgets, debts, year, month, asOf]);

  const upTo = month; // the ledger only runs to the captured month

  return (
    <div className="fms-dash">
      {/* Hero + KPIs */}
      <div className="fms-kpis">
        <KpiTile
          label="Net worth"
          value={v.worth.total}
          components={[
            { label: "Wallets", value: v.worth.wallets },
            { label: "Savings", value: v.worth.savings },
            ...(v.worth.payables > 0
              ? [{ label: "Debt", value: -v.worth.payables, tone: "var(--flow-debt-text)" }]
              : []),
          ]}
        />
        <KpiTile
          label={`${monthName(month)} spending`}
          value={v.totals.total}
          tone={v.budget.combined.status === "OVER THE BUDGET" ? "var(--over)" : undefined}
          footer={
            <>
              <ProgressBar
                value={v.budget.combined.spent}
                max={v.budget.combined.budget}
                pace={v.pacing.daysElapsed / v.pacing.daysInMonth}
              />
              <div className="fms-kpifoot">
                <span className="t-caption" style={{ color: "var(--ink-3)" }}>
                  of <Money value={v.budget.combined.budget} size="s" tone="var(--ink-3)" />
                </span>
                <StatusPill status={v.budget.combined.status === "OVER THE BUDGET" ? "over" : "ok"}>
                  {v.budget.combined.status === "OVER THE BUDGET"
                    ? `over by ${fmt(-v.budget.combined.remaining)}`
                    : `${fmt(v.budget.combined.remaining)} left`}
                </StatusPill>
              </div>
            </>
          }
        />
        <KpiTile
          label={`${monthName(month)} revenue`}
          value={v.totals.revenue}
          tone="var(--flow-revenue-text)"
          footer={
            <span className="t-caption" style={{ color: "var(--ink-3)" }}>
              {v.pacing.daysLeft} day{v.pacing.daysLeft === 1 ? "" : "s"} left · averaging{" "}
              <Money value={v.pacing.burnRate} size="s" tone="var(--ink-3)" />/day
            </span>
          }
        />
        {v.positions.map((p) => (
          <KpiTile
            key={p.debt.id}
            label={p.debt.name}
            value={-p.outstanding}
            tone="var(--flow-debt-text)"
            components={[
              { label: "Drawn", value: p.drawn, tone: "var(--ink-3)" },
              { label: "Repaid", value: p.repaid, tone: "var(--ink-3)" },
              { label: "Interest", value: p.interestPaid, tone: "var(--ink-3)" },
            ]}
            footer={<StatusPill status={p.status === "open" ? "warn" : "ok"}>{p.status}</StatusPill>}
          />
        ))}
      </div>

      {/**
        * The alerts in one paragraph.
        *
        * The VBA refreshed a rotating alert line every thirty seconds and
        * spent an API call each time. This asks once, when asked. The list
        * below is the real content and is always there; this only reads it
        * back as prose, which is easier to take in at a glance than six
        * separate boxes.
        */}
      {alerts.length > 0 && (
        <Card title="What needs attention" subtitle={`${alerts.length} flagged`}>
          {ai.answer ? (
            <AiAnswerView answer={ai.answer} />
          ) : (
            <p className="t-body" style={{ margin: 0, color: "var(--ink-3)" }}>
              {alerts.length} item{alerts.length === 1 ? "" : "s"} below, worst first.
            </p>
          )}
          <div className="fms-addrow" style={{ marginTop: "var(--space-3)" }}>
            <Button loading={ai.loading} onClick={() => void ai.run("alerts")}>
              {ai.answer ? "Say it again" : "Sum it up"}
            </Button>
          </div>
        </Card>
      )}

      {/* Every finding, worst first. Reporting only: nothing here edits a row. */}
      {alerts.length > 0 && (
        <div className="fms-alerts">
          {alerts.map((a) => (
            <Alert key={a.id} status={a.level} title={a.title}>
              <div className="t-caption" style={{ color: "var(--ink-2)" }}>{a.detail}</div>
              {a.area === "review" && (
                <button
                  onClick={onReview}
                  className="t-caption fms-linkbutton"
                  style={{ color: `var(--${a.level})` }}
                >
                  Review in the database
                </button>
              )}
            </Alert>
          ))}
        </div>
      )}

      {/* Charts */}
      <div className="fms-charts">
        <Card title="Revenue and spending" subtitle={`January – ${monthName(month)} ${year}`}>
          <AreaChart
            labels={MONTHS_SHORT.slice(0, upTo)}
            series={[
              { name: "Revenue", values: v.revSeries.slice(0, upTo), colour: "var(--flow-revenue)" },
              { name: "Spending", values: v.spendSeries.slice(0, upTo), colour: "var(--flow-spending)" },
            ]}
          />
        </Card>

        <Card title="Budget vs actual" subtitle="Red where the month went over">
          <BarChart
            labels={MONTHS_SHORT.slice(0, upTo)}
            budget={v.budgetSeries.slice(0, upTo)}
            actual={v.spendSeries.slice(0, upTo)}
          />
        </Card>
      </div>

      <div className="fms-charts">
        <Card title="Top spending" subtitle={`${year} year to date`} action={<CountChip>{fmt(v.annual)}</CountChip>}>
          <RankBars rows={v.ranking} />
        </Card>

        <Card title="Income quality" subtitle="What the revenue line is really made of">
          <div style={{ display: "grid", gap: "var(--space-3)" }}>
            <QualityRow label="Cash in this year" value={v.income.cashIn} strong />
            <QualityRow label="True income" value={v.income.trueIncome} tone="var(--flow-revenue-text)" />
            {v.income.borrowed > 0 && (
              <QualityRow label="Borrowed" value={v.income.borrowed} tone="var(--flow-debt-text)" note="not income" />
            )}
            {v.income.openingBalance > 0 && (
              <QualityRow label="Opening balance" value={v.income.openingBalance} tone="var(--ink-3)" note="not income" />
            )}
            {v.income.selfMoves > 0 && (
              <QualityRow label="Self-moves" value={v.income.selfMoves} tone="var(--ink-3)" note="not income" />
            )}
          </div>
        </Card>
      </div>

      {/* Wallets */}
      <Card title="Wallets and savings" action={<CountChip>{transactions.length} records</CountChip>}>
        <div className="fms-walletgrid">
          {balances.map((w) => (
            <div key={w.name} className="fms-walletcard">
              <span className="t-caption fms-wname" style={{ color: "var(--ink-2)" }}>
                {w.name}
              </span>
              <Money value={w.balance} size="l" tone={w.balance === 0 ? "var(--ink-3)" : undefined} />
              {w.isSavings && <FlowBadge flow="transfer" />}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function QualityRow({
  label,
  value,
  tone,
  note,
  strong,
}: {
  label: string;
  value: number;
  tone?: string;
  note?: string;
  strong?: boolean;
}) {
  return (
    <div className="fms-qrow">
      <span className={strong ? "t-body-strong" : "t-body"} style={{ color: strong ? "var(--ink)" : "var(--ink-2)" }}>
        {label}
        {note && (
          <span className="t-micro" style={{ color: "var(--ink-3)" }}>
            {" "}
            · {note}
          </span>
        )}
      </span>
      <Money value={value} size={strong ? "l" : "m"} {...(tone ? { tone } : {})} />
    </div>
  );
}

const fmt = (c: number): string =>
  `₱${(c / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
