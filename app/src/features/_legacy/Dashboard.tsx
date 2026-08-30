import { useMemo } from "react";

import { Bar, Badge, Card, EmptyState, Money, Stat } from "../components/ui";
import {
  totalSavingsBalance,
  totalWalletBalance,
  walletBalances,
} from "../domain/balances";
import { assessMonthFor, dailyPacing } from "../domain/budget";
import { formatMedium, getMonth, getYear, monthName } from "../domain/dates";
import { formatMoney } from "../domain/money";
import { checkIntegrity, summarise } from "../domain/integrity";
import { monthTotals, spendingRanking } from "../domain/totals";
import type { Ledger } from "../data/localSource";

export function Dashboard({ ledger, asOf }: { ledger: Ledger; asOf: string }) {
  const { transactions, reference, budgets } = ledger;
  const year = getYear(asOf);
  const month = getMonth(asOf);

  const view = useMemo(() => {
    const wallets = walletBalances(transactions, reference.wallets, reference.savings);
    const savings = walletBalances(transactions, reference.savings, reference.savings);
    const walletTotal = totalWalletBalance(transactions, reference.wallets);
    const savingsTotal = totalSavingsBalance(transactions, reference.savings);
    const totals = monthTotals(transactions, year, month);
    const budget = assessMonthFor(transactions, budgets, year, month);
    const pacing = dailyPacing(transactions, budgets, asOf);
    const ranking = spendingRanking(transactions, reference.spendingTypes, {
      start: `${year}-01-01`,
      end: `${year}-12-31`,
    }).slice(0, 8);
    const issues = summarise(checkIntegrity(transactions));

    return {
      wallets,
      savings,
      walletTotal,
      savingsTotal,
      totals,
      budget,
      pacing,
      ranking,
      issues,
    };
  }, [transactions, reference, budgets, year, month, asOf]);

  if (!ledger.loaded) {
    return (
      <Card>
        <EmptyState
          title="No ledger data loaded"
          hint={
            <>
              Run <code className="font-mono">python tools/extract_fixture.py</code> to
              load your Excel data, or connect Firebase.
            </>
          }
        />
      </Card>
    );
  }

  const { budget, pacing, totals } = view;
  const topSpend = view.ranking[0]?.amount ?? 1;

  return (
    <div className="space-y-4">
      {/* Headline figures */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Total funds"
          value={view.walletTotal + view.savingsTotal}
          sub={`${formatMoney(view.walletTotal)} wallets · ${formatMoney(view.savingsTotal)} savings`}
        />
        <Stat
          label={`${monthName(month)} spend`}
          value={totals.total}
          sub={`of ${formatMoney(budget.combined.budget)} budgeted`}
          tone={budget.combined.status === "OVER THE BUDGET" ? "bad" : "neutral"}
        />
        <Stat
          label={`${monthName(month)} revenue`}
          value={totals.revenue}
          tone="good"
        />
        <Stat
          label="Daily allowance"
          value={pacing.perDay}
          sub={`${pacing.daysLeft} day${pacing.daysLeft === 1 ? "" : "s"} left`}
          tone={pacing.perDay === 0 ? "bad" : "neutral"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Wallets */}
        <Card title="Wallets & savings">
          <ul>
            {[...view.wallets, ...view.savings].map((w) => (
              <li
                key={w.name}
                className="flex items-center justify-between gap-3 border-b px-4 py-2.5 last:border-b-0"
                style={{ borderColor: "var(--border)" }}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-sm">{w.name}</span>
                  {w.isSavings && <Badge>savings</Badge>}
                </span>
                <Money
                  value={w.balance}
                  className={`text-sm font-semibold ${w.balance === 0 ? "opacity-40" : ""}`}
                />
              </li>
            ))}
          </ul>
        </Card>

        {/* Budget, two tracks */}
        <Card title={`${monthName(month)} ${year} budget`}>
          <div className="space-y-4 px-4 py-4">
            {(
              [
                ["Spending", budget.spending],
                ["Bills & subscriptions", budget.billsSubs],
              ] as const
            ).map(([label, t]) => {
              const over = t.status === "OVER THE BUDGET";
              return (
                <div key={label}>
                  <div className="mb-1.5 flex items-baseline justify-between gap-2">
                    <span className="text-sm font-medium">{label}</span>
                    <Badge tone={over ? "bad" : t.budget === 0 ? "neutral" : "good"}>
                      {over
                        ? `over by ${formatMoney(-t.remaining, { symbol: false })}`
                        : t.budget === 0
                          ? "no budget"
                          : `${formatMoney(t.remaining, { symbol: false })} left`}
                    </Badge>
                  </div>
                  <Bar
                    value={t.spent}
                    max={t.budget || t.spent}
                    tone={over ? "danger" : "brand"}
                  />
                  <div
                    className="tnum mt-1 flex justify-between text-xs"
                    style={{ color: "var(--text-3)" }}
                  >
                    <span>{formatMoney(t.spent)} spent</span>
                    <span>{formatMoney(t.budget)}</span>
                  </div>
                </div>
              );
            })}

            <div
              className="rounded-lg px-3 py-2.5 text-xs"
              style={{
                background: pacing.onTrackToOverspend
                  ? "var(--danger-bg)"
                  : "var(--surface-3)",
                color: pacing.onTrackToOverspend
                  ? "var(--danger)"
                  : "var(--text-2)",
              }}
            >
              Averaging <strong className="tnum">{formatMoney(pacing.burnRate)}</strong>/day
              over {pacing.daysElapsed} days
              {pacing.onTrackToOverspend ? (
                <>
                  {" "}
                 , on track for{" "}
                  <strong className="tnum">{formatMoney(pacing.projected)}</strong> by
                  month end.
                </>
              ) : (
                ", within pace."
              )}
            </div>
          </div>
        </Card>
      </div>

      {/* Spending ranking */}
      <Card title={`Top spending · ${year}`}>
        {view.ranking.length === 0 ? (
          <EmptyState title="No spending recorded yet" />
        ) : (
          <ul className="px-4 py-3">
            {view.ranking.map((r) => (
              <li key={r.name} className="py-1.5">
                <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                  <span className="truncate">{r.name}</span>
                  <span className="tnum shrink-0 font-medium">{formatMoney(r.amount)}</span>
                </div>
                <Bar value={r.amount} max={topSpend} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Integrity, the Excel had no equivalent */}
      {view.issues.errors + view.issues.warnings > 0 && (
        <Card title="Data health">
          <div className="px-4 py-3 text-sm" style={{ color: "var(--text-2)" }}>
            <p>
              {view.issues.errors > 0 && (
                <span style={{ color: "var(--danger)" }}>
                  {view.issues.errors} error{view.issues.errors === 1 ? "" : "s"}
                  {view.issues.warnings > 0 ? ", " : " "}
                </span>
              )}
              {view.issues.warnings > 0 && (
                <span style={{ color: "var(--warn)" }}>
                  {view.issues.warnings} warning
                  {view.issues.warnings === 1 ? "" : "s"}
                </span>
              )}{" "}
              found across {ledger.transactions.length} records
              {view.issues.misreported > 0 && (
                <>
                  {" "}
                 , <strong className="tnum">{formatMoney(view.issues.misreported)}</strong>{" "}
                  potentially misreported.
                </>
              )}
            </p>
            <p className="mt-1 text-xs" style={{ color: "var(--text-3)" }}>
              Open the Ledger to review flagged rows.
            </p>
          </div>
        </Card>
      )}

      <p className="pb-2 text-center text-xs" style={{ color: "var(--text-3)" }}>
        Showing data as of {formatMedium(asOf)}
      </p>
    </div>
  );
}
