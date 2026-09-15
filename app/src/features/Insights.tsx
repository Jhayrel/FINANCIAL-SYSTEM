/**
 * Insights: spec 7.6, a month in brief.
 *
 * ── What changed on 2026-09-15 ────────────────────────────────────────────
 *
 * The owner's workbook closed its Insights sheet on a written summary: the
 * budget, the balances, each track against its budget, the top categories,
 * bills paid with their dates, bills still to come with theirs, and a daily
 * allocation ending in one sentence, "After bills (Php 358), spend under
 * Php 65 daily". This screen had the parts spread over six cards and never
 * said that sentence. Its allocation divided every peso in the wallets by the
 * days left, as if no bill were coming.
 *
 * It opens on the summary now, in sentences with the figures beside them.
 * Then what is safe to spend and why, the bills with their dates and a button
 * to record each, a calendar that lists a day's spending when tapped, and
 * where the money went against the month before. All of it is
 * `domain/monthPlan.ts`, the brief the Dashboard reads, for any month of any
 * year (docs/08, rule Y3).
 *
 * The AI sits on top of these figures, never instead of them: nothing on this
 * screen depends on a model answering.
 */

import { useMemo, useState, type ReactNode } from "react";

import { Button, Card, EmptyState, Money, ProgressBar, StatusPill } from "../components/primitives";
import { PeriodPicker } from "../components/PeriodPicker";
import { AiAnswerView } from "../components/AiAnswer";
import { useAi } from "./useAi";
import type { AppSettings } from "../domain/settings";
import { aiSurfaceOn } from "../domain/aiSurface";
import type { MonthBill } from "../domain/budgetView";
import type { Debt } from "../domain/debt";
import { dayOfWeek, daysInMonth, firstOfMonth, formatMedium, getMonth, getYear, makeDate, monthName } from "../domain/dates";
import { formatMoney, type Centavos } from "../domain/money";
import { isOpenBill, monthBrief } from "../domain/monthPlan";
import { costOf, dailySpending } from "../domain/totals";
import type { Budgets, IsoDate, ReferenceLists, Transaction } from "../domain/types";
import { pickableYears } from "../domain/year";
import { whenWords } from "./Dashboard";

const DAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"];

const shortDay = (iso: IsoDate | undefined): string => {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-PH", { month: "short", day: "numeric" });
};

export function Insights({
  transactions,
  reference,
  budgets,
  debts,
  asOf,
  settings,
  onRecordBill,
  onOpenBudget,
}: {
  transactions: readonly Transaction[];
  reference: ReferenceLists;
  budgets: Budgets;
  debts: readonly Debt[];
  asOf: string;
  settings: AppSettings;
  /** Opens the Add form with a bill filled in. */
  onRecordBill?: ((bill: MonthBill) => void) | undefined;
  /** The Budget screen, where the two tracks are set. */
  onOpenBudget?: (() => void) | undefined;
}) {
  const [year, setYear] = useState(getYear(asOf));
  const [month, setMonth] = useState(getMonth(asOf));
  const [day, setDay] = useState<number | null>(null);
  const years = useMemo(() => pickableYears(transactions, Object.keys(budgets), asOf), [transactions, budgets, asOf]);

  /**
   * The written summary follows the month picker, not the clock. Looking at
   * March and reading a description of August would be wrong in a way that is
   * very hard to spot, because every figure in it would be real.
   */
  const isThisMonth = year === getYear(asOf) && month === getMonth(asOf);
  const viewing = isThisMonth ? asOf : makeDate(year, month, 1);
  const ai = useAi({ settings, transactions, budgets, reference, feature: "insightSummary", asOf: viewing });

  const brief = useMemo(
    () => monthBrief({ transactions, reference, budgets, debts, year, month, asOf }),
    [transactions, reference, budgets, debts, year, month, asOf],
  );
  const days = useMemo(() => dailySpending(transactions, year, month, daysInMonth(year, month)), [transactions, year, month]);

  const name = monthName(month);
  const previous = monthName(month === 1 ? 12 : month - 1);
  const t = brief.tracks;
  const safe = brief.safe;
  const maxDay = Math.max(1, ...days);
  const kindMax = Math.max(1, ...brief.kinds.map((k) => k.amount));
  const open = brief.bills.bills.filter(isOpenBill);
  const paid = brief.bills.bills.filter((b) => b.state === "paid");
  const missed = brief.bills.bills.filter((b) => b.state === "missed" || b.state === "expected");

  const dayRows = useMemo(() => {
    if (day === null) return [];
    const date = makeDate(year, month, day);
    return transactions.filter((row) => row.date === date && costOf(row) > 0);
  }, [transactions, year, month, day]);

  const phaseWords =
    brief.phase === "current"
      ? `${brief.daysLeft} ${brief.daysLeft === 1 ? "day" : "days"} left`
      : brief.phase === "past"
        ? "The month is over"
        : "Not started yet";

  return (
    <div className="fms-dash">
      <PeriodPicker
        year={year}
        month={month}
        years={years}
        onChange={(y, m) => {
          setYear(y);
          setMonth(m);
          setDay(null);
        }}
        today={{ year: getYear(asOf), month: getMonth(asOf) }}
      />

      {aiSurfaceOn(settings.ai, "insightSummary") && (
        <Card
          title={`${name} in a sentence`}
          subtitle={ai.disabled ? "Written on this device" : "Ask the model to describe the month"}
        >
          {ai.answer ? (
            <AiAnswerView answer={ai.answer} />
          ) : (
            <p className="t-body" style={{ margin: 0, color: "var(--ink-3)" }}>
              Nothing asked yet. The figures below are already correct; this only puts them into words.
            </p>
          )}
          <div className="fms-addrow" style={{ marginTop: "var(--space-3)" }}>
            <Button variant="primary" loading={ai.loading} onClick={() => void ai.run("summary")}>
              {ai.answer ? "Ask again" : "Describe this month"}
            </Button>
            <Button onClick={() => void ai.run("patterns")}>Look for a pattern</Button>
          </div>
        </Card>
      )}

      {/* ── The month in brief ─────────────────────────────────────────── */}
      <Card
        title={`${name} ${year} in brief`}
        subtitle={phaseWords}
        action={
          onOpenBudget ? (
            <Button size="sm" onClick={onOpenBudget}>
              Open Budget
            </Button>
          ) : undefined
        }
      >
        <div className="fms-brief">
          <div className="fms-brief-words">
            {brief.notes.length === 0 ? (
              <p className="t-body" style={{ margin: 0, color: "var(--ink-2)" }}>
                Nothing recorded for {name} yet.
              </p>
            ) : (
              <ul className="fms-month-notes" style={{ marginTop: 0 }}>
                {brief.notes.map((note) => (
                  <li key={note} className="t-body">
                    {note}
                  </li>
                ))}
              </ul>
            )}
            <div className="fms-brief-tracks">
              <Track label="Spending" spent={t.spending.spent} budget={t.spending.budget} pace={isThisMonth ? (brief.daysInMonth - brief.daysLeft + 1) / brief.daysInMonth : undefined} />
              <Track label="Bills and subscriptions" spent={t.billsSubs.spent} budget={t.billsSubs.budget} pace={isThisMonth ? (brief.daysInMonth - brief.daysLeft + 1) / brief.daysInMonth : undefined} />
            </div>
          </div>
          <div className="fms-brief-figs">
            <Fig label="Came in" value={brief.cameIn} tone="var(--flow-revenue-text)" />
            <Fig label="Went out" value={brief.wentOut} tone="var(--flow-spending-text)" />
            <Fig
              label={brief.kept < 0 ? "More out than in" : "Kept"}
              value={brief.kept}
              signed
              hint={brief.cameIn > 0 ? `${Math.round((brief.kept / brief.cameIn) * 100)}% of what came in` : "No income"}
            />
            <Fig label={brief.phase === "past" ? "Wallets at the end" : "Wallets now"} value={brief.wallets} />
            <Fig label={brief.phase === "past" ? "Savings at the end" : "Savings now"} value={brief.savings} />
          </div>
        </div>
      </Card>

      <div className="fms-charts">
        {/* ── Safe to spend, or how it ended ───────────────────────────── */}
        {safe ? (
          <Card title="Safe to spend" subtitle="What the wallets can cover once what is still due is set aside">
            <div className="fms-safe-hero">
              <Money value={safe.perDay} size="xl" tone={safe.perDay === 0 ? "var(--over)" : undefined} />
              <span className="t-caption" style={{ color: "var(--ink-3)" }}>
                a day for the {safe.daysLeft} {safe.daysLeft === 1 ? "day" : "days"} left
              </span>
            </div>
            <div className="fms-month-lines">
              <Row label="In your wallets" value={safe.wallets} />
              {open.map((b) => (
                <Row key={`bill-${b.item}`} label={`${b.item}, ${whenWords(b.daysToDue).toLowerCase()}`} value={-b.amount} quiet />
              ))}
              {brief.debts
                .filter((d) => d.kind === "payable")
                .map((d) => (
                  <Row key={`debt-${d.debtId}`} label={`${d.name}, ${whenWords(d.daysToDue).toLowerCase()}`} value={-d.amount} quiet />
                ))}
              <Row label="Free to spend" value={safe.free} strong />
              {safe.budgetLeft !== null && <Row label="Left of the spending budget" value={safe.budgetLeft} />}
              <Row
                label={`Safe to spend, set by the ${safe.limitedBy === "budget" ? "budget" : "wallets"}`}
                value={safe.safe}
                strong
              />
            </div>
            {safe.habits.length > 0 && (
              <div style={{ marginTop: "var(--space-4)" }}>
                <div className="t-label" style={{ color: "var(--ink-2)", marginBottom: "var(--space-2)" }}>
                  Usually comes round before the month ends
                </div>
                <div className="fms-month-lines">
                  {safe.habits.map((h) => (
                    <Row
                      key={h.name}
                      label={`${h.name}, ${h.nextOn <= asOf ? "about now" : `around ${shortDay(h.nextOn)}`}`}
                      value={h.amount}
                      quiet
                    />
                  ))}
                </div>
                <p className="t-micro" style={{ margin: "var(--space-2) 0 0", color: "var(--ink-3)" }}>
                  Going by how often each has come round before. Part of the daily figure, not set aside from it.
                </p>
              </div>
            )}
          </Card>
        ) : (
          <Card
            title={brief.phase === "past" ? "How it ended" : "Planned"}
            subtitle={brief.phase === "past" ? `${name} against its budget` : `${name} has not started`}
          >
            <div className="fms-month-lines">
              <Row label="Budgeted" value={t.combined.budget} />
              <Row label={brief.phase === "past" ? "Spent" : "Spent so far"} value={t.combined.spent} />
              {t.combined.budget > 0 && (
                <Row
                  label={t.combined.remaining < 0 ? "Over the budget by" : "Left unspent"}
                  value={Math.abs(t.combined.remaining)}
                  strong
                  tone={t.combined.remaining < 0 ? "var(--over)" : undefined}
                />
              )}
              <Row label={brief.kept < 0 ? "More out than in" : "Kept"} value={brief.kept} signed strong />
            </div>
          </Card>
        )}

        {/* ── Bills ───────────────────────────────────────────────────────── */}
        <Card
          title="Bills and subscriptions"
          subtitle={
            brief.bills.bills.length === 0
              ? "None expected this month"
              : `${paid.length} of ${brief.bills.bills.length} paid, ${formatMoney(brief.bills.paid)}${
                  brief.bills.stillExpected > 0 ? `, and ${formatMoney(brief.bills.stillExpected)} still to come` : ""
                }`
          }
        >
          {brief.bills.bills.length === 0 ? (
            <EmptyState message="No bill has been paid in the two months before this one, so there is nothing to expect yet." />
          ) : (
            <div className="fms-billgroups">
              {open.length > 0 && (
                <section>
                  <div className="t-label" style={{ color: "var(--ink-2)", marginBottom: "var(--space-2)" }}>
                    Still to pay
                  </div>
                  <ul className="fms-duelist">
                    {open.map((b) => (
                      <li key={b.item} className="fms-duerow">
                        <div className="fms-duerow-text">
                          <span className="t-body-strong fms-truncate">{b.item}</span>
                          <span className="t-caption" style={{ color: b.state === "late" ? "var(--over)" : "var(--ink-3)" }}>
                            {whenWords(b.daysToDue)}
                            {b.dueOn ? `, ${shortDay(b.dueOn)}` : ""}
                          </span>
                        </div>
                        <div className="fms-duerow-end">
                          <Money value={b.amount} size="s" />
                          {onRecordBill && (
                            <Button size="sm" onClick={() => onRecordBill(b)}>
                              Record
                            </Button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {paid.length > 0 && (
                <section>
                  <div className="t-label" style={{ color: "var(--ink-2)", marginBottom: "var(--space-2)" }}>
                    Paid
                  </div>
                  <div className="fms-month-lines">
                    {paid.map((b) => (
                      <Row key={b.item} label={`${b.item}, ${shortDay(b.paidOn)}`} value={b.amount} />
                    ))}
                  </div>
                </section>
              )}
              {missed.length > 0 && (
                <section>
                  <div className="t-label" style={{ color: "var(--ink-2)", marginBottom: "var(--space-2)" }}>
                    {brief.phase === "past" ? "Not paid in the month" : "Expected"}
                  </div>
                  <div className="fms-month-lines">
                    {missed.map((b) => (
                      <Row key={b.item} label={b.item} value={b.amount} quiet />
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}
          {brief.bills.neverPaid.length > 0 && (
            <p className="t-micro" style={{ margin: "var(--space-3) 0 0", color: "var(--ink-3)" }}>
              Never paid, so not expected: {brief.bills.neverPaid.join(", ")}.
            </p>
          )}
        </Card>
      </div>

      <div className="fms-charts">
        {/* ── The calendar ───────────────────────────────────────────────── */}
        <Card title="Spending calendar" subtitle="Darker is a heavier day. Tap a day to see what went out.">
          <div className="fms-cal">
            {DAY_INITIALS.map((d, i) => (
              <div key={i} className="t-micro fms-calhead">
                {d}
              </div>
            ))}
            {Array.from({ length: dayOfWeek(firstOfMonth(year, month)) }, (_, i) => (
              <div key={`pad${i}`} />
            ))}
            {days.map((amount, i) => {
              const intensity = amount / maxDay;
              return (
                <button
                  key={i}
                  type="button"
                  className="fms-calday"
                  aria-pressed={day === i + 1}
                  aria-label={`${name} ${i + 1}: ${amount > 0 ? formatMoney(amount) : "nothing spent"}`}
                  onClick={() => setDay(day === i + 1 ? null : i + 1)}
                  style={{
                    background:
                      amount > 0
                        ? `color-mix(in srgb, var(--flow-spending) ${Math.round(12 + intensity * 68)}%, var(--surface))`
                        : "var(--surface-sunk)",
                    color: intensity > 0.5 ? "var(--on-brand)" : "var(--ink-2)",
                  }}
                >
                  {i + 1}
                </button>
              );
            })}
          </div>
          {day !== null && (
            <div className="fms-daylist">
              <div className="fms-rankhead">
                <span className="t-body-strong">{formatMedium(makeDate(year, month, day))}</span>
                <Money value={days[day - 1] ?? 0} size="s" />
              </div>
              {dayRows.length === 0 ? (
                <p className="t-caption" style={{ margin: 0, color: "var(--ink-3)" }}>
                  Nothing spent that day.
                </p>
              ) : (
                <div className="fms-month-lines">
                  {dayRows.map((row) => (
                    <Row
                      key={row.id}
                      label={`${row.item || row.description || row.type}${row.fromWallet ? `, from ${row.fromWallet}` : ""}`}
                      value={costOf(row)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </Card>

        {/* ── Where it went ─────────────────────────────────────────────── */}
        <Card title="Where it went" subtitle={`${name}'s spending by kind, against ${previous}`}>
          {brief.kinds.length === 0 ? (
            <EmptyState message={`Nothing spent in ${name}. Pick another month above, or add an entry.`} />
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

      <p className="t-caption" style={{ color: "var(--ink-3)", textAlign: "center", margin: 0 }}>
        Figures as of {formatMedium(asOf)}
      </p>
    </div>
  );
}

function Fig({
  label,
  value,
  tone,
  signed,
  hint,
}: {
  label: string;
  value: Centavos;
  tone?: string;
  signed?: boolean;
  hint?: string;
}) {
  return (
    <div className="fms-budgetstat">
      <span className="t-label" style={{ color: "var(--ink-2)" }}>
        {label}
      </span>
      <Money value={value} size="m" signed={signed} tone={tone} />
      {hint && (
        <span className="t-caption" style={{ color: "var(--ink-3)" }}>
          {hint}
        </span>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  strong,
  quiet,
  signed,
  tone,
}: {
  label: ReactNode;
  value: Centavos;
  strong?: boolean | undefined;
  quiet?: boolean | undefined;
  signed?: boolean | undefined;
  tone?: string | undefined;
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

function Track({ label, spent, budget, pace }: { label: string; spent: Centavos; budget: Centavos; pace?: number | undefined }) {
  const over = budget > 0 && spent > budget;
  return (
    <div className="fms-brief-track">
      <div className="fms-rankhead">
        <span className="t-body-strong fms-rankname">{label}</span>
        <StatusPill status={budget <= 0 ? "none" : over ? "over" : "ok"}>
          {budget <= 0 ? "No budget" : over ? `${formatMoney(spent - budget)} over` : `${formatMoney(budget - spent)} left`}
        </StatusPill>
      </div>
      {budget > 0 && <ProgressBar value={spent} max={budget} {...(pace !== undefined ? { pace } : {})} />}
      <span className="t-caption" style={{ color: "var(--ink-3)" }}>
        {formatMoney(spent)} spent{budget > 0 ? ` of ${formatMoney(budget)}` : ""}
      </span>
    </div>
  );
}
