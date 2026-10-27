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
 * the two screens cannot disagree.
 *
 * ── Every chart opens what it shows ───────────────────────────────────────
 *
 * The owner, 27 September 2026: make the dashboard's charts interactable.
 * Pointing at a month on either chart reads it out, and clicking it opens
 * that month in Insights. A kind of spending, here or in the year's top
 * spending, opens Insights on its own entries for the month or the year. Net worth stays broken into its parts (spec
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
import { incomeQuality, netWorth, outstandingOf, positionsOf, type Debt, type DebtEffect } from "../domain/debt";
import type { Settlement } from "../domain/settleLine";
import { borrowedMoney, lenderNames } from "../domain/borrowed";
import { ON_BEHALF } from "../domain/debtWords";
import { getMonth, getYear, MONTH_NAMES_SHORT, monthName } from "../domain/dates";
import { limitLines, limitWords } from "../domain/limitAsk";
import { formatMoney, type Centavos } from "../domain/money";
import { carryOver, carryWords, isOpenBill, monthBrief, nextMonthStart, yesterdayOf } from "../domain/monthPlan";
import { plannedForBudget, viewOf } from "../domain/planner";
import { monthlyTotalsForYear, spendingRanking, totalSpending } from "../domain/totals";
import type { Budgets, IsoDate, ReferenceLists, Transaction, WalletBalance } from "../domain/types";
import type { InsightsAt } from "./Insights";
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
  onOpenInsights,
  onOpenPlan,
  settlementFor,
  onSettle,
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
  /** Clearing what is left on a line in one step (domain/settleLine.ts). */
  settlementFor?: ((debt: Debt) => Settlement | null) | undefined;
  onSettle?: ((debt: Debt) => void) | undefined;
  onGo: (place: Place) => void;
  /** Insights on a month, a year, or a kind of spending's entries. */
  onOpenInsights?: ((at: InsightsAt) => void) | undefined;
  /** A plan on the Planner, opened to record its payment. */
  onOpenPlan?: ((planId: string, pay: boolean) => void) | undefined;
}) {
  const year = getYear(asOf);
  const month = getMonth(asOf);

  const brief = useMemo(
    () => monthBrief({ transactions, reference, budgets, debts, year, month, asOf }),
    [transactions, reference, budgets, debts, year, month, asOf],
  );
  // The month's limits on kinds of spending, the Budget screen's figures, said under each kind's bar.
  const limits = useMemo(
    () => new Map(limitLines(transactions, budgets, debts, year, month).map((l) => [l.kind, l])),
    [transactions, budgets, debts, year, month],
  );
  // "I didn't spend yesterday, should it be 72?" (15 October 2026): what carried over, said where the figure is.
  const yesterday = useMemo(
    () => (brief.safe ? yesterdayOf({ transactions, reference, budgets, debts, year, month, asOf }) : null),
    [brief.safe, transactions, reference, budgets, debts, year, month, asOf],
  );

  // "What happens to the available to spend if the next month sets in??" (25 October 2026): said in the month's last week.
  const next = useMemo(
    () => (brief.safe && brief.safe.daysLeft <= 7 ? nextMonthStart({ transactions, reference, budgets, debts, asOf }, brief.safe) : null),
    [brief.safe, transactions, reference, budgets, debts, asOf],
  );

  const v = useMemo(() => {
    const range = { start: `${year}-01-01`, end: `${year}-12-31` };
    const perMonth = monthlyTotalsForYear(transactions, year);
    /*
     * Money held or paid for someone else is not borrowing (spec 5.6.1, "On
     * behalf", apart from Debt). It was counted with the credit lines, so
     * PHP 25,000.00 held for a relative read as "Borrowed" beside a cash-in
     * figure it was never part of. It is left out of that line and said on
     * its own.
     */
    const behalf = new Set(debts.filter((d) => d.form === "pass-through").map((d) => d.id));
    const isBehalf = (t: Transaction): boolean => t.type === "Debt" && t.debtId !== undefined && behalf.has(t.debtId);
    /*
     * `incomeQuality` already leaves held money out and counts what was kept
     * as yours; taking the On behalf rows away first dropped the kept money
     * from true income (19 October 2026 audit).
     */
    const quality = incomeQuality(transactions, debts, range);
    const inRevenue = quality.cashIn - quality.trueIncome - quality.openingBalance - quality.selfMoves;
    // Still held at the end: received for them, less what was passed on or kept.
    const heldForOthers = Math.max(
      0,
      transactions
        .filter((t) => isBehalf(t) && t.date >= range.start && t.date <= range.end)
        .reduce((sum, t) => sum + (t.debtEffect === "draw" ? t.amount : t.debtEffect === "repay" || t.debtEffect === "writeoff" ? -t.amount : 0), 0),
    );
    return {
      worth: netWorth(
        totalWalletBalance(transactions, reference.wallets),
        totalSavingsBalance(transactions, reference.savings),
        positionsOf(debts, transactions, asOf),
      ),
      income: quality,
      /** Borrowing filed as revenue: part of cash in. */
      borrowedInRevenue: inRevenue,
      /** Borrowing recorded as debt: beside cash in, not part of it. */
      borrowedAsDebt: quality.borrowed - inRevenue,
      heldForOthers,
      /** What of the accounts is the owner's own, borrowed money followed through every transfer (`borrowed.ts`). */
      // Every row, as the balances beside it count them, so own and borrowed add up to what is shown.
      own: borrowedMoney(transactions, debts, [...reference.wallets, ...reference.savings]),
      annual: totalSpending(transactions, range),
      // Money Send and fees are derived, not listed, and still money spent: the bars and the total beside them agree.
      ranking: spendingRanking(transactions, reference.spendingTypes, range, { includeUnlisted: true }).slice(0, 6),
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
  const carried = safe ? carryOver(safe, yesterday) : null;
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
    /*
     * The Planner's plans due by the month's end, overdue ones too: still to
     * pay this month as much as a bill is (27 October 2026). The same plans
     * the Budget screen and Insights list (`plannedForBudget`); one filed
     * under a bill is that bill, above, so it is not listed twice.
     */
    ...(onOpenPlan
      ? plannedForBudget(
          (reference.plans ?? []).map((p) => viewOf(p, { transactions, accounts: [], asOf })),
          year,
          month,
          reference,
          asOf,
        ).spendingViews.map((v) => ({
          key: `plan-${v.plan.id}`,
          name: v.plan.title,
          // A plan not counted in safe to spend is still to pay; said, so the figure above is not read as covering it.
          what: `Planned${v.paid > 0 ? `, ${formatMoney(v.paid)} paid` : ""}${!v.plan.setAside && !v.plan.goalId ? ", not in safe to spend" : ""}`,
          amount: v.left,
          days: v.daysTo as number | undefined,
          on: v.plan.due as IsoDate | undefined,
          action: "Pay",
          record: () => onOpenPlan(v.plan.id, true),
        }))
      : []),
  ].sort((a, b) => (a.days ?? 99) - (b.days ?? 99));

  const paidBills = brief.bills.bills.filter((b) => b.state === "paid");

  useReportScreen(
    () => ({
      screen: "Dashboard",
      lines: [
        `${name} ${year}, ${brief.daysLeft} days left.`,
        safe
          ? `Safe to spend today ${formatMoney(safe.perDay)} (today's share ${formatMoney(safe.todayShare)}, ${formatMoney(safe.spentToday)} spent today). Safe until the month ends ${formatMoney(safe.safe)}: wallets ${formatMoney(safe.wallets)}, less bills and subscriptions still to pay ${formatMoney(safe.reservedBills)}, debt payments due ${formatMoney(safe.reservedDebt)}${safe.reservedPlans > 0 ? ` and plans set aside ${formatMoney(safe.reservedPlans)}` : ""}. From tomorrow ${formatMoney(safe.perDayAfter)} a day. ${carryWords(safe, yesterday, formatMoney).join(" ")}${next ? ` From 1 ${monthName(next.month)}: ${formatMoney(next.perDay)} a day over ${next.days} days, if nothing more is spent and nothing comes in.` : ""}`
          : "",
        noBudget
          ? `No budget set for ${name}. Spent ${formatMoney(t.combined.spent)}.`
          : `Spent ${formatMoney(t.combined.spent)} of ${formatMoney(t.combined.budget)} budgeted.`,
        ...brief.notes,
        upcoming.length > 0
          ? `Still to pay: ${upcoming.map((u) => `${u.name} ${formatMoney(u.amount)} (${whenWords(u.days).toLowerCase()})`).join(", ")}.`
          : "Nothing left to pay this month.",
        `Net worth ${formatMoney(v.worth.total)}: wallets ${formatMoney(v.worth.wallets)}, savings and reserves ${formatMoney(v.worth.savings)}, you owe ${formatMoney(v.worth.youOwe)}${v.worth.heldForOthers > 0 ? `, held for others ${formatMoney(v.worth.heldForOthers)}` : ""}, owed to you ${formatMoney(v.worth.owedToYou + v.worth.advancedForOthers)}.`,
        alerts.length > 0 ? `Needs attention: ${alerts.slice(0, 5).map((a) => a.title).join("; ")}.` : "Nothing needs attention.",
        brief.kinds.length > 0 ? `Where it went: ${brief.kinds.map((k) => `${k.name} ${formatMoney(k.amount)}`).join(", ")}.` : "",
      ],
    }),
    [brief, v, alerts, name, year, noBudget, yesterday, next],
  );

  return (
    <div className="fms-home">
      {/* ── The month ──────────────────────────────────────────────────── */}
      <div className="fms-home-month">
        <Card
          title={`${name} ${year}`}
          subtitle={`${brief.daysLeft} ${brief.daysLeft === 1 ? "day" : "days"} left, including today`}
          action={
            <Button size="sm" variant={noBudget ? "primary" : "secondary"} onClick={() => onGo("budget")}>
              {noBudget ? "Set a budget" : "Open Budget"}
            </Button>
          }
        >
          <div className="fms-month">
            {/*
              Safe to spend, as the owner sums it (6 October 2026): the money
              in the wallets, less the bills and subscriptions still to pay,
              is what is safe until the month ends; today is today's share of
              it, less what today already spent (`monthPlan.ts`).
            */}
            <div className="fms-month-half">
              <div className="fms-month-head">
                <span className="t-label" style={{ color: "var(--ink-2)" }}>
                  Safe to spend today
                </span>
              </div>
              <Money value={safe?.perDay ?? 0} size="xl" tone={(safe?.perDay ?? 0) === 0 ? "var(--over)" : undefined} />
              <span className="t-caption" style={{ color: safe && safe.overToday > 0 ? "var(--over)" : "var(--ink-3)" }}>
                {!safe
                  ? ""
                  : safe.overToday > 0
                    ? `${formatMoney(safe.spentToday)} spent today, not counting bills: ${formatMoney(safe.overToday)} over today's ${formatMoney(safe.todayShare)}`
                    : safe.spentToday > 0
                      ? `${formatMoney(safe.spentToday)} of today's ${formatMoney(safe.todayShare)} spent`
                      : `${formatMoney(safe.safe)} split over ${safe.daysLeft} ${safe.daysLeft === 1 ? "day" : "days"}, including today`}
              </span>
              {/* One short line on what carried over; the chat says the rest (26 October 2026: "too messy"). */}
              {safe && carried && safe.daysLeft > 1 && safe.overToday === 0 && (
                <span className="t-caption" style={{ color: "var(--ink-3)" }}>
                  {`Yesterday's unspent ${formatMoney(yesterday?.unspent ?? 0)} is split over these days. You can use up to ${formatMoney(carried.useToday)} of it today.`}
                </span>
              )}
              <div className="fms-month-lines">
                <Line label="In your wallets" value={safe?.wallets ?? brief.wallets} />
                <Line
                  label="Bills and subscriptions to pay"
                  value={safe && safe.reservedBills > 0 ? -safe.reservedBills : 0}
                  quiet={!safe || safe.reservedBills === 0}
                />
                {safe && safe.reservedDebt > 0 && <Line label="Debt payments due" value={-safe.reservedDebt} />}
                {/* The Planner's plans counted this month (docs/16-PLANNER.md, P5). */}
                {safe && safe.reservedPlans > 0 && <Line label="Set aside for plans" value={-safe.reservedPlans} />}
                <Line label={`Safe to spend until ${name} ends`} value={safe?.safe ?? 0} strong total />
                {safe && safe.daysLeft > 1 && (
                  <Line label={`Per day from tomorrow (${safe.daysLeft - 1} ${safe.daysLeft === 2 ? "day" : "days"})`} value={safe.perDayAfter} quiet />
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

          {/*
            Next month, in the month's last week: one line under both halves,
            so neither runs longer than the other (26 October 2026).
          */}
          {next && (
            <p className="t-body fms-month-next">
              {`From 1 ${monthName(next.month)}: `}
              <strong>{`${formatMoney(next.perDay)} a day`}</strong>
              <span style={{ color: "var(--ink-3)" }}>{next.safe > 0 ? ", after its bills." : " until money comes in."}</span>
            </p>
          )}

          {brief.warnings.length > 0 && (
            <ul className="fms-month-notes">
              {brief.warnings.map((note) => (
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
        <Card title="Your money" subtitle="Net worth and where your money is">
          <Money value={v.worth.total} size="xl" />
          <div className="fms-month-lines">
            {/*
              Lines that add up to the figure above, each said once, as every
              screen says it (`owedTotals`, 6 October 2026). "Savings" here is
              everything set aside, reserves and goals too, so it says so: the
              sidebar's Savings heading is the savings accounts alone.
            */}
            <Line label="Wallets" value={v.worth.wallets} />
            <Line label="Savings and reserves" value={v.worth.savings} />
            <Line label="Owed to you" value={v.worth.owedToYou} quiet={v.worth.owedToYou === 0} />
            {v.worth.advancedForOthers > 0 && <Line label="Paid for others, coming back" value={v.worth.advancedForOthers} />}
            <Line
              label="You owe"
              value={v.worth.youOwe > 0 ? -v.worth.youOwe : 0}
              tone={v.worth.youOwe > 0 ? "var(--flow-debt-text)" : undefined}
              quiet={v.worth.youOwe === 0}
            />
            {v.worth.heldForOthers > 0 && <Line label="Held for others" value={-v.worth.heldForOthers} />}
          </div>
          {/*
            Their own money, apart from what is borrowed or held for someone,
            followed through transfers and withdrawals. The owner, 7 October
            2026: "knows how much money I have that is not from loan or credit".
          */}
          {(v.own.inHand > 0 || v.own.heldForOthers > 0) && (
            <p className="t-caption fms-ownmoney">
              Your own money: <strong>{formatMoney(v.own.own)}</strong>.{" "}
              {v.own.inHand > 0 ? `${formatMoney(v.own.inHand)} in your accounts is borrowed, from ${lenderNames(new Map([...v.own.byLender].filter(([id]) => debts.find((d) => d.id === id)?.form !== "pass-through")), debts)}. ` : ""}
              {v.own.heldForOthers > 0 ? `${formatMoney(v.own.heldForOthers)} is held for others. ` : ""}
              Spending past your own money spends that.
            </p>
          )}
          {/*
            On behalf: money a person owes back or money held for them, apart
            from Debt. The two buttons are the ways it ends: settled, or
            written off (which counts as spending) or retained (as income).
          */}
          {(() => {
            const open = debts
              .filter((d) => !d.archived && d.form === "pass-through")
              .map((d) => ({ d, owed: outstandingOf(transactions, d.id) }))
              .filter((x) => x.owed !== 0);
            return open.length === 0 ? null : (
              <div className="fms-behalfhome">
                <div className="t-label" style={{ color: "var(--ink-2)" }}>
                  {ON_BEHALF}
                </div>
                <ul className="fms-moneylist">
                  {open.map(({ d, owed }) => {
                    const theirs = d.kind === "payable";
                    return (
                      <li key={d.id} className="fms-moneyrow fms-behalfrow">
                        <span className="t-caption fms-truncate">
                          {d.name}
                          <span style={{ color: "var(--ink-3)" }}>{owed < 0 ? (theirs ? " · you gave extra" : " · gave you extra") : theirs ? " · you hold" : " · owes you"}</span>
                        </span>
                        <span className="fms-moneyrow-end">
                          <Money value={Math.abs(owed) as Centavos} size="s" tone={theirs ? "var(--flow-debt-text)" : undefined} />
                        </span>
                        <span className="fms-behalfrow-actions">
                          {/*
                            Paid past zero (Father gave PHP 600.00 back on a PHP 599.00
                            bill): passing more on, or writing off a minus, means
                            nothing. One press clears it instead.
                          */}
                          {owed < 0 ? (
                            onSettle && settlementFor?.(d) ? (
                              <button type="button" className="t-micro fms-linkbtn" title={settlementFor(d)!.words} onClick={() => onSettle(d)}>
                                {settlementFor(d)!.action}
                              </button>
                            ) : null
                          ) : (
                            <>
                              <button type="button" className="t-micro fms-linkbtn" onClick={() => onRecordDebt(d.id, theirs ? "repay" : "collect", owed)}>
                                {theirs ? "Given to them" : "Paid you back"}
                              </button>
                              <button type="button" className="t-micro fms-linkbtn" onClick={() => onRecordDebt(d.id, "writeoff", owed)}>
                                {theirs ? "Kept as yours" : "Let it go"}
                              </button>
                            </>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })()}
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
              : "Bills, subscriptions, debt payments and plans"
          }
        >
          {upcoming.length === 0 ? (
            <>
              <p className="t-body" style={{ margin: 0, color: "var(--ink-2)" }}>
                Nothing left to pay in {name}.
                {brief.bills.bills.length === 0 && " Bills and subscriptions show here once one has been paid."}
              </p>
              {/* What was paid, so the box says what it covered rather than standing empty. */}
              {paidBills.length > 0 && (
                <div className="fms-paidlist">
                  <div className="t-label" style={{ color: "var(--ink-2)" }}>
                    Paid in {name}
                  </div>
                  <div className="fms-month-lines" style={{ marginTop: 0 }}>
                    {paidBills.map((b) => (
                      <Line key={b.item} label={b.paidOn ? `${b.item}, ${shortDay(b.paidOn)}` : b.item} value={b.amount} />
                    ))}
                  </div>
                </div>
              )}
            </>
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
                ? `The 3 most urgent of ${alerts.length}. See them all under the bell at the top.`
                : "Most urgent first. These are also under the bell at the top."
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
            <RankBars
              rows={brief.kinds.map((k) => {
                const diff = k.amount - k.lastMonth;
                const limit = limits.get(k.name);
                return {
                  name: k.name,
                  amount: k.amount,
                  hint:
                    k.lastMonth === 0
                      ? `None in ${previous}`
                      : diff === 0
                        ? `No change from ${previous}`
                        : `${formatMoney(Math.abs(diff))} ${diff > 0 ? "more" : "less"} than ${previous}`,
                  limit: limit ? limitWords(limit) : undefined,
                };
              })}
              {...(onOpenInsights
                ? { onPick: (kind: string) => onOpenInsights({ period: { kind: "month", year, month }, focus: { name: kind, flow: "out" } }) }
                : {})}
            />
          )}
          {(() => {
            // A kind over its limit that is not among the largest above is still said, so no overspend goes unseen here.
            const shown = new Set(brief.kinds.map((k) => k.name));
            const hidden = [...limits.values()].filter((l) => !shown.has(l.kind) && l.spent > l.limit);
            if (hidden.length === 0) return null;
            return (
              <p className="t-caption" style={{ margin: "var(--space-3) 0 0", color: "var(--over)" }}>
                Also over its limit: {hidden.map((l) => `${l.kind}, ${formatMoney(l.spent - l.limit)} over`).join("; ")}.
              </p>
            );
          })()}
        </Card>
      </div>

      {/* ── The year: a desk view ──────────────────────────────────────── */}
      {/* The year, on a phone too: the charts are narrow enough for one. */}
      {
        <>
          <div className="fms-home-top">
            <Card title="Top spending" subtitle={`${year} so far. Select one to see its entries.`} action={<CountChip>{formatMoney(v.annual)}</CountChip>}>
              <RankBars
                rows={v.ranking}
                total={v.annual}
                {...(onOpenInsights
                  ? { onPick: (kind: string) => onOpenInsights({ period: { kind: "year", year }, focus: { name: kind, flow: "out" } }) }
                  : {})}
              />
            </Card>
          </div>
          <div className="fms-home-income">
            <Card title="Income quality" subtitle={`Money received in ${year}, and how much of it is true income`}>
              <div className="fms-incomehead">
                <Money value={v.income.cashIn} size="l" />
                <span className="t-caption" style={{ color: "var(--ink-3)" }}>
                  Recorded as revenue
                </span>
              </div>
              {/*
                One bar, the parts of cash in side by side: how much of what
                came in was earned. The lines under it add up to the figure
                above; what was borrowed as debt, or held for someone, is
                beside it and said apart.
              */}
              {v.income.cashIn > 0 && (
                <div className="fms-split" aria-hidden>
                  {[
                    { value: v.income.trueIncome, colour: "var(--flow-revenue)" },
                    { value: v.borrowedInRevenue, colour: "var(--flow-debt)" },
                    { value: v.income.openingBalance, colour: "var(--hairline-strong)" },
                    { value: v.income.selfMoves, colour: "var(--ink-3)" },
                  ]
                    .filter((p) => p.value > 0)
                    .map((p) => (
                      <span key={p.colour} style={{ flexGrow: p.value, background: p.colour }} />
                    ))}
                </div>
              )}
              <div className="fms-month-lines">
                <Line label={<Keyed colour="var(--flow-revenue)">True income</Keyed>} value={v.income.trueIncome} tone="var(--flow-revenue-text)" strong />
                {v.borrowedInRevenue > 0 && (
                  <Line label={<Keyed colour="var(--flow-debt)">Borrowed, recorded as revenue</Keyed>} value={v.borrowedInRevenue} tone="var(--flow-debt-text)" />
                )}
                <Line label={<Keyed colour="var(--hairline-strong)">Opening balance</Keyed>} value={v.income.openingBalance} quiet />
                <Line label={<Keyed colour="var(--ink-3)">Moved between your own accounts</Keyed>} value={v.income.selfMoves} quiet />
              </div>
              <div className="fms-month-lines fms-income-beside">
                <Line
                  label="Borrowed on credit and loans"
                  value={v.borrowedAsDebt}
                  tone={v.borrowedAsDebt > 0 ? "var(--flow-debt-text)" : undefined}
                  quiet={v.borrowedAsDebt === 0}
                />
                {v.heldForOthers > 0 && <Line label={`Held ${ON_BEHALF.toLowerCase()} of others`} value={v.heldForOthers} quiet />}
              </div>
              <p className="t-micro" style={{ margin: "var(--space-2) 0 0", color: "var(--ink-3)" }}>
                {v.heldForOthers > 0
                  ? "Neither counts as revenue: borrowed money is paid back, and money held for someone belongs to them."
                  : "Not counted as revenue: borrowed money is paid back."}
              </p>
            </Card>
          </div>
          <div className="fms-home-rev">
            <Card title="Revenue and spending" subtitle={`January to ${name} ${year}. Select a month to open it.`}>
              <AreaChart
                labels={MONTH_NAMES_SHORT.slice(0, month)}
                titles={MONTH_NAMES_SHORT.slice(0, month).map((_, i) => `${monthName(i + 1)} ${year}`)}
                series={[
                  { name: "Revenue", values: v.revSeries.slice(0, month), colour: "var(--flow-revenue)" },
                  { name: "Spending", values: v.spendSeries.slice(0, month), colour: "var(--flow-spending)" },
                ]}
                note={(i) => {
                  const kept = (v.revSeries[i] ?? 0) - (v.spendSeries[i] ?? 0);
                  return `${kept < 0 ? "More out than in by" : "Kept"} ${formatMoney(Math.abs(kept))}`;
                }}
                {...(onOpenInsights
                  ? {
                      onPick: (i: number) => onOpenInsights({ period: { kind: "month", year, month: i + 1 } }),
                      pickLabel: (i: number) => `Open ${monthName(i + 1)} in Insights`,
                    }
                  : {})}
              />
            </Card>
          </div>
          <div className="fms-home-bva">
            <Card title="Budget vs actual" subtitle="Red where the month went over. Select a month to open it.">
              <BarChart
                labels={MONTH_NAMES_SHORT.slice(0, month)}
                titles={MONTH_NAMES_SHORT.slice(0, month).map((_, i) => `${monthName(i + 1)} ${year}`)}
                budget={v.budgetSeries.slice(0, month)}
                actual={v.spendSeries.slice(0, month)}
                {...(onOpenInsights
                  ? {
                      onPick: (i: number) => onOpenInsights({ period: { kind: "month", year, month: i + 1 } }),
                      pickLabel: (i: number) => `Open ${monthName(i + 1)} in Insights`,
                    }
                  : {})}
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
  total,
}: {
  label: ReactNode;
  value: Centavos;
  tone?: string | undefined;
  strong?: boolean | undefined;
  quiet?: boolean | undefined;
  signed?: boolean | undefined;
  /** The sum of the lines above it, under a rule. */
  total?: boolean | undefined;
}) {
  return (
    <div className={total ? "fms-line fms-line-total" : "fms-line"}>
      <span className={strong ? "t-body-strong" : "t-caption"} style={{ color: quiet ? "var(--ink-3)" : "var(--ink-2)" }}>
        {label}
      </span>
      <Money value={value} size="s" signed={signed} tone={tone ?? (quiet ? "var(--ink-3)" : undefined)} />
    </div>
  );
}

/** A line's label with the colour of its part of the bar above. */
function Keyed({ colour, children }: { colour: string; children: ReactNode }) {
  return (
    <span className="fms-keyed">
      <span aria-hidden style={{ background: colour }} />
      {children}
    </span>
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
