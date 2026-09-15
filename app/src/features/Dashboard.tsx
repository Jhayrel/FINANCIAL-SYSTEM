/**
 * Dashboard: spec 7.2, and what the owner opens the app to find out.
 *
 * ── What changed on 2026-09-15 ────────────────────────────────────────────
 *
 * The owner's words: the system is there to track spending and to help spend
 * better. The Dashboard opened on four tiles and a stack of seven coloured
 * boxes, and could not answer the question asked every morning: how much can
 * I spend today? With no budget set, its spending tile read "₱-13,968.36
 * left" in green.
 *
 * It opens on this month now: what is safe to spend a day, how the budget
 * stands, what is still to pay with a button to record each, and where the
 * money went against last month. Your money sits beside it, with any account
 * below zero said so. The findings moved to the bell in the top bar, which
 * every screen has; the worst three are repeated here.
 *
 * ── Boxes in rows ─────────────────────────────────────────────────────────
 *
 * Zoomed out, the first version was a tall column of three boxes beside a
 * short column of three, so the edges never met and the page read as
 * unfinished. Every box now sits in a row with the box beside it and shares
 * its top and bottom edges: the month beside your money, what is due beside
 * what needs attention, then where it went, the year's top spending and income
 * quality, then the two charts.
 *
 * The month's figures are `domain/monthPlan.ts`, the brief Insights reads, so
 * the two screens cannot disagree. Net worth stays broken into its parts (spec
 * 7.2) and counts every debt, archived ones included: money still owed is owed
 * whether or not the line is still in use.
 */

import { useMemo, type ReactNode } from "react";

import { Button, Card, CountChip, Money, ProgressBar, StatusPill } from "../components/primitives";
import { AreaChart, BarChart, RankBars } from "../components/charts";
import type { Alert as Finding } from "../domain/alerts";
import { totalSavingsBalance, totalWalletBalance } from "../domain/balances";
import { budgetSummary } from "../domain/budget";
import type { MonthBill } from "../domain/budgetView";
import { incomeQuality, netWorth, positionsOf, type Debt, type DebtEffect } from "../domain/debt";
import { getMonth, getYear, MONTH_NAMES_SHORT, monthName } from "../domain/dates";
import { formatMoney, type Centavos } from "../domain/money";
import { isOpenBill, monthBrief } from "../domain/monthPlan";
import { monthlyTotalsForYear, spendingRanking, totalSpending } from "../domain/totals";
import type { Budgets, IsoDate, ReferenceLists, Transaction, WalletBalance } from "../domain/types";
import { useReportScreen } from "./screenReport";

type Place = "budget" | "insights" | "debt";

/** "3 days late", "Due today", "Due in 4 days". */
export function whenWords(days: number | undefined): string {
  if (days === undefined) return "No date";
  if (days < 0) return `${-days} ${days === -1 ? "day" : "days"} late`;
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  return `Due in ${days} days`;
}

const shortDay = (iso: IsoDate): string => {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-PH", { month: "short", day: "numeric" });
};

export function Dashboard({
  transactions,
  reference,
  budgets,
  debts,
  balances,
  lowBalanceThreshold,
  asOf,
  alerts,
  onOpenAlert,
  onRecordBill,
  onRecordDebt,
  onGo,
}: {
  transactions: readonly Transaction[];
  reference: ReferenceLists;
  budgets: Budgets;
  debts: readonly Debt[];
  balances: readonly WalletBalance[];
  lowBalanceThreshold: Centavos;
  asOf: string;
  /** Every finding, worst first: the bell's list. */
  alerts: readonly Finding[];
  onOpenAlert: (finding: Finding) => void;
  /** The Add form with this bill filled in, for checking before saving. */
  onRecordBill: (bill: MonthBill) => void;
  /** The Add form with this debt movement filled in. */
  onRecordDebt: (debtId: string, effect: DebtEffect, amount: Centavos | null) => void;
  onGo: (place: Place) => void;
}) {
  const year = getYear(asOf);
  const month = getMonth(asOf);

  const brief = useMemo(
    () => monthBrief({ transactions, reference, budgets, debts, year, month, asOf }),
    [transactions, reference, budgets, debts, year, month, asOf],
  );

  const v = useMemo(() => {
    const range = { start: `${year}-01-01`, end: `${year}-12-31` };
    const perMonth = monthlyTotalsForYear(transactions, year);
    return {
      worth: netWorth(
        totalWalletBalance(transactions, reference.wallets),
        totalSavingsBalance(transactions, reference.savings),
        positionsOf(debts, transactions, asOf),
      ),
      income: incomeQuality(transactions, debts, range),
      annual: totalSpending(transactions, range),
      ranking: spendingRanking(transactions, reference.spendingTypes, range).slice(0, 6),
      spendSeries: perMonth.map((m) => m.total),
      revSeries: perMonth.map((m) => m.revenue),
      budgetSeries: budgetSummary(transactions, budgets, year).map((r) => r.budget),
    };
  }, [transactions, reference, budgets, debts, year, asOf]);

  const t = brief.tracks;
  const noBudget = t.combined.budget <= 0;
  const over = !noBudget && t.combined.remaining < 0;
  const elapsed = (brief.daysInMonth - brief.daysLeft + 1) / brief.daysInMonth;
  const safe = brief.safe;
  const name = monthName(month);
  const previous = monthName(month === 1 ? 12 : month - 1);

  /** Everything still to pay or collect this month, soonest first. */
  const upcoming = [
    ...brief.debts.map((d) => ({
      key: `debt-${d.debtId}`,
      name: d.name,
      what: d.kind === "payable" ? "Debt payment" : "Owed to you",
      amount: d.amount,
      days: d.daysToDue as number | undefined,
      on: d.dueOn as IsoDate | undefined,
      action: d.kind === "payable" ? "Record payment" : "Record it",
      record: () => onRecordDebt(d.debtId, d.kind === "payable" ? "repay" : "collect", d.amount),
    })),
    ...brief.bills.bills.filter(isOpenBill).map((b) => ({
      key: `bill-${b.item}`,
      name: b.item,
      what: b.category === "Bills" ? "Bill" : "Subscription",
      amount: b.amount,
      days: b.daysToDue,
      on: b.dueOn,
      action: "Record payment",
      record: () => onRecordBill(b),
    })),
  ].sort((a, b) => (a.days ?? 99) - (b.days ?? 99));

  const paidBills = brief.bills.bills.filter((b) => b.state === "paid");
  const kindMax = Math.max(1, ...brief.kinds.map((k) => k.amount));

  useReportScreen(
    () => ({
      screen: "Dashboard",
      lines: [
        `${name} ${year}, ${brief.daysLeft} days left.`,
        safe
          ? `Safe to spend ${formatMoney(safe.perDay)} a day, ${formatMoney(safe.safe)} for the rest of the month: wallets ${formatMoney(safe.wallets)}, bills still due ${formatMoney(safe.reservedBills)}, debt payments due ${formatMoney(safe.reservedDebt)}.`
          : "",
        noBudget
          ? `No budget set for ${name}. Spent ${formatMoney(t.combined.spent)}.`
          : `Spent ${formatMoney(t.combined.spent)} of ${formatMoney(t.combined.budget)} budgeted.`,
        ...brief.notes,
        upcoming.length > 0
          ? `Still to pay: ${upcoming.map((u) => `${u.name} ${formatMoney(u.amount)} (${whenWords(u.days).toLowerCase()})`).join(", ")}.`
          : "Nothing left to pay this month.",
        `Net worth ${formatMoney(v.worth.total)}: wallets ${formatMoney(v.worth.wallets)}, savings ${formatMoney(v.worth.savings)}, owed ${formatMoney(v.worth.payables)}.`,
        alerts.length > 0 ? `Needs attention: ${alerts.slice(0, 5).map((a) => a.title).join("; ")}.` : "Nothing needs attention.",
        brief.kinds.length > 0 ? `Where it went: ${brief.kinds.map((k) => `${k.name} ${formatMoney(k.amount)}`).join(", ")}.` : "",
      ],
    }),
    [brief, v, alerts, name, year, noBudget],
  );

  return (
    <div className="fms-home">
      {/* ── The month ──────────────────────────────────────────────────── */}
      <div className="fms-home-month">
        <Card
          title={`${name} ${year}`}
          subtitle={`${brief.daysLeft} ${brief.daysLeft === 1 ? "day" : "days"} left, today included`}
          action={
            <Button size="sm" variant={noBudget ? "primary" : "secondary"} onClick={() => onGo("budget")}>
              {noBudget ? "Set a budget" : "Open Budget"}
            </Button>
          }
        >
          <div className="fms-month">
            <div className="fms-month-half">
              <div className="fms-month-head">
                <span className="t-label" style={{ color: "var(--ink-2)" }}>
                  Safe to spend a day
                </span>
              </div>
              <Money value={safe?.perDay ?? 0} size="xl" tone={(safe?.perDay ?? 0) === 0 ? "var(--over)" : undefined} />
              <span className="t-caption" style={{ color: "var(--ink-3)" }}>
                {formatMoney(safe?.safe ?? 0)} for the rest of {name}
              </span>
              <div className="fms-month-lines">
                <Line label="In your wallets" value={safe?.wallets ?? brief.wallets} />
                <Line label="Bills still due" value={safe && safe.reservedBills > 0 ? -safe.reservedBills : 0} quiet={!safe || safe.reservedBills === 0} />
                <Line label="Debt payments due" value={safe && safe.reservedDebt > 0 ? -safe.reservedDebt : 0} quiet={!safe || safe.reservedDebt === 0} />
                {safe && safe.budgetLeft !== null ? (
                  <Line label="Left of the spending budget" value={safe.budgetLeft} tone={safe.budgetLeft < 0 ? "var(--over)" : undefined} />
                ) : (
                  <TextLine label="Spending budget" text="None set" />
                )}
              </div>
            </div>

            <div className="fms-month-half">
              <div className="fms-month-head">
                <span className="t-label" style={{ color: "var(--ink-2)" }}>
                  Spent in {name}
                </span>
                {noBudget ? (
                  <StatusPill status="none">No budget set</StatusPill>
                ) : (
                  <StatusPill status={over ? "over" : "ok"}>
                    {over ? `${formatMoney(-t.combined.remaining)} over` : `${formatMoney(t.combined.remaining)} left`}
                  </StatusPill>
                )}
              </div>
              <Money value={t.combined.spent} size="xl" tone={over ? "var(--over)" : undefined} />
              <span className="t-caption" style={{ color: "var(--ink-3)" }}>
                {noBudget ? "Nothing to measure it against yet" : `of ${formatMoney(t.combined.budget)} budgeted`}
              </span>
              <ProgressBar value={t.combined.spent} max={t.combined.budget} {...(noBudget ? {} : { pace: elapsed })} />
              <div className="fms-month-lines">
                <TrackLine label="Spending" spent={t.spending.spent} budget={t.spending.budget} />
                <TrackLine label="Bills and subscriptions" spent={t.billsSubs.spent} budget={t.billsSubs.budget} />
                <Line label="Came in" value={brief.cameIn} tone="var(--flow-revenue-text)" />
                <Line label={brief.kept < 0 ? "More out than in" : "Kept so far"} value={brief.kept} signed />
              </div>
            </div>
          </div>

          {brief.notes.length > 0 && (
            <ul className="fms-month-notes">
              {brief.notes.map((note) => (
                <li key={note} className="t-body">
                  {note}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* ── Your money ─────────────────────────────────────────────────── */}
      <div className="fms-home-money">
        <Card title="Your money" subtitle="Net worth, and where it is">
          <Money value={v.worth.total} size="xl" />
          <div className="fms-month-lines">
            <Line label="Wallets" value={v.worth.wallets} />
            <Line label="Savings" value={v.worth.savings} />
            <Line label="Owed to you" value={v.worth.receivables} quiet={v.worth.receivables === 0} />
            <Line
              label="You owe"
              value={v.worth.payables > 0 ? -v.worth.payables : 0}
              tone={v.worth.payables > 0 ? "var(--flow-debt-text)" : undefined}
              quiet={v.worth.payables === 0}
            />
          </div>
          <ul className="fms-moneylist">
            {balances.map((w) => {
              const below = w.balance < 0;
              const low = !below && !w.isSavings && lowBalanceThreshold > 0 && w.balance < lowBalanceThreshold;
              return (
                <li key={w.name} className="fms-moneyrow">
                  <span className="t-caption fms-truncate" style={{ color: w.balance === 0 ? "var(--ink-3)" : "var(--ink)" }}>
                    {w.name}
                  </span>
                  <span className="fms-moneyrow-end">
                    {below && <StatusPill status="over">Below zero</StatusPill>}
                    {low && <StatusPill status="warn">Low</StatusPill>}
                    <Money value={w.balance} size="s" tone={below ? "var(--over)" : w.balance === 0 ? "var(--ink-3)" : undefined} />
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>

      {/* ── Still to pay ───────────────────────────────────────────────── */}
      <div className="fms-home-due">
        <Card
          title="Still to pay this month"
          subtitle={
            brief.bills.bills.length > 0
              ? `${paidBills.length} of ${brief.bills.bills.length} bills paid, ${formatMoney(brief.bills.paid)} so far`
              : "Bills, subscriptions and debt payments"
          }
        >
          {upcoming.length === 0 ? (
            <p className="t-body" style={{ margin: 0, color: "var(--ink-2)" }}>
              Nothing left to pay in {name}.
              {brief.bills.bills.length === 0 && " Bills and subscriptions show here once one has been paid."}
            </p>
          ) : (
            <ul className="fms-duelist">
              {upcoming.map((u) => (
                <li key={u.key} className="fms-duerow">
                  <div className="fms-duerow-text">
                    <span className="t-body-strong fms-truncate">{u.name}</span>
                    <span className="t-caption" style={{ color: u.days !== undefined && u.days < 0 ? "var(--over)" : "var(--ink-3)" }}>
                      {u.what} · {whenWords(u.days)}
                      {u.on ? `, ${shortDay(u.on)}` : ""}
                    </span>
                  </div>
                  <div className="fms-duerow-end">
                    <Money value={u.amount} size="s" />
                    <Button size="sm" onClick={u.record}>
                      {u.action}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {safe && safe.habits.length > 0 && (
            <p className="t-caption fms-habits">
              Usually before the month ends:{" "}
              {safe.habits
                .map((h) => `${h.name} ${formatMoney(h.amount)} ${h.nextOn <= asOf ? "about now" : `around ${shortDay(h.nextOn)}`}`)
                .join(", ")}
              .
            </p>
          )}
        </Card>
      </div>

      {/* ── Needs attention ────────────────────────────────────────────── */}
      <div className="fms-home-attn">
        <Card
          title="Needs attention"
          subtitle={
            alerts.length === 0
              ? "Checked every time the ledger changes"
              : alerts.length > 3
                ? `The worst 3 of ${alerts.length}. The bell at the top has every one.`
                : "Worst first. The bell at the top has these too."
          }
        >
          {alerts.length === 0 ? (
            <p className="t-body" style={{ margin: 0, color: "var(--ink-2)" }}>
              Nothing right now: no bill late, no account below zero, nothing that looks entered twice.
            </p>
          ) : (
            <ul className="fms-attn">
              {alerts.slice(0, 3).map((a) => (
                <li key={a.id}>
                  <button type="button" className="fms-attn-item" onClick={() => onOpenAlert(a)}>
                    <span aria-hidden className="fms-attn-dot" style={{ background: `var(--${a.level})` }} />
                    <span className="fms-attn-text">
                      <span className="t-body-strong">{a.title}</span>
                      <span className="t-caption" style={{ color: "var(--ink-3)" }}>
                        {a.detail}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* ── Where it went ──────────────────────────────────────────────── */}
      <div className="fms-home-where">
        <Card
          title="Where it went"
          subtitle={`${name}'s spending by kind, against ${previous}`}
          action={
            <Button size="sm" onClick={() => onGo("insights")}>
              Open Insights
            </Button>
          }
        >
          {brief.kinds.length === 0 ? (
            <p className="t-body" style={{ margin: 0, color: "var(--ink-2)" }}>
              Nothing spent in {name} yet.
            </p>
          ) : (
            <ol className="fms-kinds">
              {brief.kinds.map((k) => {
                const diff = k.amount - k.lastMonth;
                return (
                  <li key={k.name} className="fms-kind">
                    <div className="fms-rankhead">
                      <span className="t-body fms-rankname">{k.name}</span>
                      <Money value={k.amount} size="s" />
                    </div>
                    <div className="fms-budgetcat-bar" aria-hidden>
                      <span style={{ width: `${Math.max(2, Math.round((k.amount / kindMax) * 100))}%` }} />
                    </div>
                    <span className="t-micro" style={{ color: "var(--ink-3)" }}>
                      {k.lastMonth === 0
                        ? `None in ${previous}`
                        : diff === 0
                          ? `The same as ${previous}`
                          : `${formatMoney(Math.abs(diff))} ${diff > 0 ? "more" : "less"} than ${previous}`}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </Card>
      </div>

      {/* ── The year: a desk view ──────────────────────────────────────── */}
      {/* The year, on a phone too: the charts are narrow enough for one. */}
      {
        <>
          <div className="fms-home-top">
            <Card title="Top spending" subtitle={`${year} so far`} action={<CountChip>{formatMoney(v.annual)}</CountChip>}>
              <RankBars rows={v.ranking} />
            </Card>
          </div>
          <div className="fms-home-income">
            <Card title="Income quality" subtitle="What the revenue line is really made of">
              <div className="fms-month-lines" style={{ marginTop: 0 }}>
                <Line label="Cash in this year" value={v.income.cashIn} strong />
                <Line label="True income" value={v.income.trueIncome} tone="var(--flow-revenue-text)" />
                <Line label="Borrowed, not income" value={v.income.borrowed} tone={v.income.borrowed > 0 ? "var(--flow-debt-text)" : undefined} quiet={v.income.borrowed === 0} />
                <Line label="Opening balance, not income" value={v.income.openingBalance} quiet />
                <Line label="Self-moves, not income" value={v.income.selfMoves} quiet />
              </div>
            </Card>
          </div>
          <div className="fms-home-rev">
            <Card title="Revenue and spending" subtitle={`January to ${name} ${year}`}>
              <AreaChart
                labels={MONTH_NAMES_SHORT.slice(0, month)}
                series={[
                  { name: "Revenue", values: v.revSeries.slice(0, month), colour: "var(--flow-revenue)" },
                  { name: "Spending", values: v.spendSeries.slice(0, month), colour: "var(--flow-spending)" },
                ]}
              />
            </Card>
          </div>
          <div className="fms-home-bva">
            <Card title="Budget vs actual" subtitle="Red where the month went over">
              <BarChart
                labels={MONTH_NAMES_SHORT.slice(0, month)}
                budget={v.budgetSeries.slice(0, month)}
                actual={v.spendSeries.slice(0, month)}
              />
            </Card>
          </div>
        </>
      }
    </div>
  );
}

function Line({
  label,
  value,
  tone,
  strong,
  quiet,
  signed,
}: {
  label: ReactNode;
  value: Centavos;
  tone?: string | undefined;
  strong?: boolean | undefined;
  quiet?: boolean | undefined;
  signed?: boolean | undefined;
}) {
  return (
    <div className="fms-line">
      <span className={strong ? "t-body-strong" : "t-caption"} style={{ color: quiet ? "var(--ink-3)" : "var(--ink-2)" }}>
        {label}
      </span>
      <Money value={value} size="s" signed={signed} tone={tone ?? (quiet ? "var(--ink-3)" : undefined)} />
    </div>
  );
}

function TextLine({ label, text }: { label: string; text: string }) {
  return (
    <div className="fms-line">
      <span className="t-caption" style={{ color: "var(--ink-2)" }}>
        {label}
      </span>
      <span className="t-caption" style={{ color: "var(--ink-3)" }}>
        {text}
      </span>
    </div>
  );
}

function TrackLine({ label, spent, budget }: { label: string; spent: Centavos; budget: Centavos }) {
  return (
    <div className="fms-line">
      <span className="t-caption" style={{ color: "var(--ink-2)" }}>
        {label}
      </span>
      <span className="t-caption" style={{ color: "var(--ink-3)" }}>
        <Money value={spent} size="s" tone={budget > 0 && spent > budget ? "var(--over)" : undefined} />
        {budget > 0 ? ` of ${formatMoney(budget)}` : ", no budget"}
      </span>
    </div>
  );
}
