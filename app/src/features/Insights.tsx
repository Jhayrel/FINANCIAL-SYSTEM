/**
 * Insights: spec 7.6, a month in brief, and any day or run of days in it.
 *
 * ── The calendar, first ───────────────────────────────────────────────────
 *
 * The owner asked for the calendar at the top, for what a picked day shows to
 * sit apart from the calendar rather than under it, and for more than one day:
 * a range, a day still ahead, a day long past. The calendar picks; the panel
 * beside it reads the pick out (`domain/dayRange.ts`): what went out and came
 * in, where it went, every entry with a way to correct it, and for the days
 * still ahead the bills, debt payments and regular spending expected on them.
 *
 * One day is a tap. A range is "A range" and two taps, or shift and a tap. A
 * range can cross months: pick its first day, move the month above, pick its
 * last. The quick picks cover the ranges people mean by words: today, this
 * week, the last seven days, the next seven, the month.
 *
 * ── Under it ───────────────────────────────────────────────────────────────
 *
 * The month in brief (`domain/monthPlan.ts`, the brief the Dashboard reads),
 * what is safe to spend and why, the bills with their dates, and where the
 * money went and came from. The AI sits on top of these figures, never instead
 * of them.
 */

import { useMemo, useState, type ReactNode } from "react";

import {
  Button,
  Card,
  EmptyState,
  Money,
  ProgressBar,
  SegmentedControl,
  StatusPill,
} from "../components/primitives";
import { PeriodPicker } from "../components/PeriodPicker";
import { AiAnswerView } from "../components/AiAnswer";
import { RankBars } from "../components/charts";
import { useAi } from "./useAi";
import { useReportScreen } from "./screenReport";
import type { AppSettings } from "../domain/settings";
import { aiSurfaceOn } from "../domain/aiSurface";
import type { MonthBill } from "../domain/budgetView";
import type { Debt } from "../domain/debt";
import { positionsOf } from "../domain/debt";
import { healthWords, moneyHealth } from "../domain/health";
import type { Necessity } from "../domain/types";
import {
  addDays,
  dayOfWeek,
  daysBetween,
  daysInMonth,
  firstOfMonth,
  formatMedium,
  getMonth,
  getYear,
  lastOfMonth,
  makeDate,
  monthName,
} from "../domain/dates";
import { describeRange, rangeOf, rangeReport, type DayRange } from "../domain/dayRange";
import { formatMoney, type Centavos } from "../domain/money";
import { isOpenBill, monthBrief } from "../domain/monthPlan";
import { costOf } from "../domain/totals";
import type { Budgets, IsoDate, ReferenceLists, Transaction } from "../domain/types";
import { pickableYears } from "../domain/year";
import { whenWords } from "./Dashboard";
import { Investigate } from "./Investigate";
import type { Draft } from "../domain/entry";

const DAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"];

type Mode = "day" | "range";

const shortDay = (iso: IsoDate | undefined): string => {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-PH", { month: "short", day: "numeric" });
};

/** "₱850", "₱1.2k": a figure that fits inside a calendar day. Display only. */
function compactPeso(c: Centavos): string {
  const pesos = Math.round(c / 100);
  if (pesos >= 1_000_000) return `₱${(pesos / 1_000_000).toFixed(1)}M`;
  if (pesos >= 1_000) return `₱${(pesos / 1_000).toFixed(1)}k`;
  return `₱${pesos}`;
}

/** Direction of money in its own colour, rule D3: a transfer stays grey. */
const TONE: Record<Transaction["type"], string> = {
  Revenue: "var(--flow-revenue-text)",
  Spending: "var(--flow-spending-text)",
  Transfer: "var(--ink-3)",
  Debt: "var(--flow-debt-text)",
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
  onEditRow,
  onAdd,
  onBin,
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
  /** A saved row into the Add form, to correct it. */
  onEditRow?: ((row: Transaction) => void) | undefined;
  /** The Add form with an entry filled in, to check and save. */
  onAdd?: ((draft: Draft) => void) | undefined;
  /** A row to the bin. */
  onBin?: ((id: string) => void) | undefined;
}) {
  const [year, setYear] = useState(getYear(asOf));
  const [month, setMonth] = useState(getMonth(asOf));
  const [mode, setMode] = useState<Mode>("day");
  const [picked, setPicked] = useState<DayRange | null>(null);
  const [anchor, setAnchor] = useState<IsoDate | null>(null);

  const years = useMemo(() => pickableYears(transactions, Object.keys(budgets), asOf), [transactions, budgets, asOf]);
  const nowYear = getYear(asOf);
  const nowMonth = getMonth(asOf);
  const isThisMonth = year === nowYear && month === nowMonth;

  /**
   * The written summary follows the month picker, not the clock. Looking at
   * March and reading a description of August would be wrong in a way that is
   * very hard to spot, because every figure in it would be real.
   */
  const viewing = isThisMonth ? asOf : makeDate(year, month, 1);
  const ai = useAi({ settings, transactions, budgets, reference, feature: "insightSummary", asOf: viewing });

  const brief = useMemo(
    () => monthBrief({ transactions, reference, budgets, debts, year, month, asOf }),
    [transactions, reference, budgets, debts, year, month, asOf],
  );
  const now = useMemo(
    () => (isThisMonth ? brief : monthBrief({ transactions, reference, budgets, debts, year: nowYear, month: nowMonth, asOf })),
    [isThisMonth, brief, transactions, reference, budgets, debts, nowYear, nowMonth, asOf],
  );

  const monthStart = firstOfMonth(year, month);
  const monthEnd = lastOfMonth(year, month);
  const fallback: DayRange = isThisMonth ? { start: monthStart, end: asOf } : { start: monthStart, end: monthEnd };
  const sel = picked ?? fallback;

  const report = useMemo(
    () => rangeReport({ transactions, reference, debts, range: sel, asOf }),
    // The range is its two ends; a new object with the same ends is the same range.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [transactions, reference, debts, sel.start, sel.end, asOf],
  );

  /** Each day's spending and income, by the app's own definitions. */
  const days = useMemo(() => {
    const prefix = monthStart.slice(0, 7);
    const spent = new Map<IsoDate, Centavos>();
    const came = new Map<IsoDate, Centavos>();
    for (const t of transactions) {
      if (!t.date.startsWith(prefix)) continue;
      const cost = costOf(t);
      if (cost > 0) spent.set(t.date, (spent.get(t.date) ?? 0) + cost);
      if (t.type === "Revenue" && t.category !== "Opening") came.set(t.date, (came.get(t.date) ?? 0) + t.total);
    }
    return { spent, came };
  }, [transactions, monthStart]);

  /**
   * How the money is doing, rather than what it did (domain/health.ts).
   *
   * Read over the last three months and a year, so it does not swing with the
   * month being looked at: these answer how things are going, and the month
   * above answers what happened.
   */
  const healthLines = useMemo(() => {
    const necessity: Record<string, Necessity> = {};
    for (const type of settings.spendingTypes) if (type.necessity) necessity[type.name] = type.necessity;
    return healthWords(
      moneyHealth({
        transactions,
        accounts: settings.accounts,
        debts,
        positions: positionsOf(debts.filter((d) => !d.archived), transactions, asOf),
        necessity,
        asOf,
      }),
    );
  }, [transactions, settings.accounts, settings.spendingTypes, debts, asOf]);

  const income = useMemo(() => {
    const bySource = new Map<string, Centavos>();
    for (const t of transactions) {
      if (t.type !== "Revenue" || t.category === "Opening" || t.date < monthStart || t.date > monthEnd) continue;
      const key = t.item.trim() || "Unnamed";
      bySource.set(key, (bySource.get(key) ?? 0) + t.total);
    }
    return [...bySource].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, amount]) => ({ name, amount }));
  }, [transactions, monthStart, monthEnd]);

  const name = monthName(month);
  const previous = monthName(month === 1 ? 12 : month - 1);
  const t = brief.tracks;
  const safe = brief.safe;
  const nowSafe = now.safe;
  const maxDay = Math.max(1, ...days.spent.values());
  const kindMax = Math.max(1, ...brief.kinds.map((k) => k.amount));
  const open = brief.bills.bills.filter(isOpenBill);
  const paid = brief.bills.bills.filter((b) => b.state === "paid");
  const missed = brief.bills.bills.filter((b) => b.state === "missed" || b.state === "expected");
  const multi = sel.start !== sel.end;
  /**
   * For one past day: what the month had spent by the end of it.
   *
   * The third figure was "Heaviest day", which for one day is that day again
   * and read "₱0.00, No spending" beside a first figure that said the same.
   */
  const monthToDay =
    !multi && sel.start.startsWith(monthStart.slice(0, 7))
      ? [...days.spent].reduce((sum, [date, amount]) => (date <= sel.start ? sum + amount : sum), 0)
      : null;
  const pace = isThisMonth ? (brief.daysInMonth - brief.daysLeft + 1) / brief.daysInMonth : undefined;

  /** Always six weeks, so the calendar is one height whichever month it shows. */
  const cells = useMemo(() => {
    const lead = dayOfWeek(monthStart);
    const count = daysInMonth(year, month);
    return Array.from({ length: 42 }, (_, i) => {
      const day = i - lead + 1;
      return day >= 1 && day <= count ? makeDate(year, month, day) : null;
    });
  }, [monthStart, year, month]);

  /** Arrow keys move between days, a week at a time up and down. */
  const moveFocus = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    const step = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 } as Record<string, number>)[e.key];
    const from = (e.target as HTMLElement).dataset.date;
    if (!step || !from) return;
    const next = e.currentTarget.querySelector<HTMLButtonElement>(`[data-date="${addDays(from, step)}"]`);
    if (!next) return;
    e.preventDefault();
    next.focus();
  };

  /** The panel's three tabs, and the one shown: the chosen one if it has anything, else the first that does. */
  const [tab, setTab] = useState<"where" | "entries" | "ahead">("where");
  const panelTabs = [
    { id: "where" as const, label: "Where it went", count: 0, enabled: report.kinds.length > 0 },
    { id: "entries" as const, label: "Entries", count: report.rows.length, enabled: report.rows.length > 0 },
    { id: "ahead" as const, label: "Still ahead", count: report.expected.length, enabled: report.futureDays > 0 },
  ];
  const shownTab = panelTabs.find((x) => x.id === tab && x.enabled)?.id ?? panelTabs.find((x) => x.enabled)?.id ?? null;

  /**
   * Every kind of spending, the smallest folded into one line past eight.
   *
   * It showed the six largest and dropped the rest without a word, so the bars
   * for September 1 to 15 added up to ₱13,255.00 under a "Went out" of
   * ₱13,968.36. Every peso is on a line now, and the total under them is the
   * same figure as the one above.
   */
  const kindRows =
    report.kinds.length > 8
      ? [
          ...report.kinds.slice(0, 7),
          {
            name: `${report.kinds.length - 7} smaller kinds`,
            amount: report.kinds.slice(7).reduce((sum, k) => sum + k.amount, 0),
          },
        ]
      : report.kinds;
  const kindsTotal = report.kinds.reduce((sum, k) => sum + k.amount, 0);
  const kindTop = Math.max(1, ...kindRows.map((k) => k.amount));

  /** The pick's entries a day at a time, with what each day spent. */
  const dayGroups = useMemo(() => {
    const out: { date: IsoDate; rows: Transaction[]; spent: Centavos }[] = [];
    for (const row of report.rows) {
      let group = out[out.length - 1];
      if (!group || group.date !== row.date) {
        group = { date: row.date, rows: [], spent: 0 };
        out.push(group);
      }
      group.rows.push(row);
      group.spent += costOf(row);
    }
    return out;
  }, [report.rows]);

  // ── Picking ──────────────────────────────────────────────────────────────

  const pickDay = (date: IsoDate, extend: boolean): void => {
    const from = anchor ?? (extend && picked ? picked.start : null);
    if ((mode === "range" || extend) && from) {
      setPicked(rangeOf(from, date));
      setAnchor(null);
    } else {
      setPicked({ start: date, end: date });
      setAnchor(mode === "range" ? date : null);
    }
  };

  const choose = (range: DayRange): void => {
    setPicked(range);
    setAnchor(null);
    const y = getYear(range.start);
    const m = getMonth(range.start);
    if (y !== year || m !== month) {
      setYear(y);
      setMonth(m);
    }
  };

  const monday = addDays(asOf, -((dayOfWeek(asOf) + 6) % 7));
  const quick: { label: string; range: DayRange }[] = [
    { label: "Today", range: { start: asOf, end: asOf } },
    { label: "This week", range: { start: monday, end: asOf } },
    { label: "Last 7 days", range: { start: addDays(asOf, -6), end: asOf } },
    { label: "Next 7 days", range: { start: addDays(asOf, 1), end: addDays(asOf, 7) } },
    { label: isThisMonth ? "Month so far" : "Whole month", range: fallback },
  ];
  const isQuick = (r: DayRange): boolean => picked !== null && picked.start === r.start && picked.end === r.end;

  // What the pick is, in time.
  const when = (() => {
    if (!multi) {
      const d = daysBetween(asOf, sel.start);
      if (d === 0) return "Today";
      if (d === -1) return "Yesterday";
      if (d === 1) return "Tomorrow";
      return d < 0 ? `${-d} days ago` : `In ${d} days`;
    }
    if (report.futureDays === 0) return `${report.days} days, all past`;
    if (report.pastDays === 0) return `${report.days} days, all still ahead`;
    return `${report.days} days: ${report.pastDays} so far, ${report.futureDays} still ahead`;
  })();

  // The days of the pick still ahead in this month, which the daily figure covers.
  const nowEnd = lastOfMonth(nowYear, nowMonth);
  const aheadFrom = sel.start > asOf ? sel.start : addDays(asOf, 1);
  const aheadTo = sel.end < nowEnd ? sel.end : nowEnd;
  const aheadThisMonth = aheadTo >= aheadFrom ? daysBetween(aheadFrom, aheadTo) + 1 : 0;

  const phaseWords =
    brief.phase === "current"
      ? `${brief.daysLeft} ${brief.daysLeft === 1 ? "day" : "days"} left`
      : brief.phase === "past"
        ? "The month is over"
        : "Not started yet";

  useReportScreen(
    () => ({
      screen: "Insights",
      lines: [
        `Looking at ${name} ${year} (${phaseWords.toLowerCase()}).`,
        ...brief.notes,
        `Picked on the calendar: ${describeRange(sel)} (${when.toLowerCase()}). Spent ${formatMoney(report.spent)}, came in ${formatMoney(report.cameIn)}, ${report.rows.length} entries.`,
        report.kinds.length > 0
          ? `Where it went in that pick: ${report.kinds.map((k) => `${k.name} ${formatMoney(k.amount)}`).join(", ")}.`
          : "",
        report.futureDays > 0
          ? `Expected on the ${report.futureDays} days still ahead in the pick: ${
              report.expected.length > 0
                ? report.expected.map((e) => `${e.name} ${formatMoney(e.amount)} from ${e.on}`).join(", ")
                : "nothing"
            }.`
          : "",
        safe ? `Safe to spend ${formatMoney(safe.perDay)} a day (${formatMoney(safe.safe)}), set by the ${safe.limitedBy}.` : "",
        ...healthLines,
      ],
      range: { from: sel.start, to: sel.end },
    }),
    [name, year, phaseWords, brief, sel.start, sel.end, when, report, safe, healthLines],
  );

  return (
    <div className="fms-dash">
      <PeriodPicker
        year={year}
        month={month}
        years={years}
        onChange={(y, m) => {
          setYear(y);
          setMonth(m);
          // A range waiting for its last day keeps its first across the move.
          if (!anchor) setPicked(null);
        }}
        today={{ year: nowYear, month: nowMonth }}
      />

      {/* ── The calendar, and what the pick shows ─────────────────────── */}
      {/*
        One frame that holds still.

        The first version grew and shrank with the pick: an empty day made a
        short card, a fortnight of fifty entries a long one, and the calendar
        beside it stretched to match, so the page moved under the pointer on
        every tap. The owner found it confusing and asked for a container that
        does not adjust. The frame is one height now, a month is always six
        rows, and what a pick holds scrolls inside the panel, in three tabs
        rather than one long stack.

        It was also loud: every day of "month so far" carried a green underline
        although nothing had been picked, days ahead had dashed borders, today
        was underlined, and the heat ran to a solid red. Only a real pick is
        marked now, today is a filled circle, and the heat is five quiet steps.
      */}
      <section className="fms-ical" aria-label={`${name} ${year} calendar`}>
        <div className="fms-ical-cal">
          <div className="fms-ical-head">
            <div className="fms-ical-title">
              <h2 className="t-display-m">
                {name} {year}
              </h2>
              <span className="t-caption fms-ical-sub">
                {mode === "day"
                  ? "Tap a day to read it"
                  : anchor
                    ? "Now tap the last day, in this month or another"
                    : "Tap the first day of the range"}
              </span>
            </div>
            <SegmentedControl
              options={[
                { id: "day", label: "One day" },
                { id: "range", label: "A range" },
              ]}
              value={mode}
              onChange={(m) => {
                setMode(m);
                setAnchor(null);
              }}
              label="How days are picked"
            />
          </div>

          <div className="fms-ical-quick" role="group" aria-label="Quick picks">
            {quick.map((q) => (
              <button
                key={q.label}
                type="button"
                className="t-caption fms-ical-pick"
                aria-pressed={isQuick(q.range)}
                onClick={() => choose(q.range)}
              >
                {q.label}
              </button>
            ))}
          </div>

          <div className="fms-ical-grid" onKeyDown={moveFocus}>
            {DAY_INITIALS.map((d, i) => (
              <div key={`dow${i}`} aria-hidden className="t-micro fms-ical-dow">
                {d}
              </div>
            ))}
            {cells.map((date, i) => {
              if (!date) return <span key={`blank${i}`} aria-hidden className="fms-ical-blank" />;
              const spent = days.spent.get(date) ?? 0;
              const came = days.came.get(date) ?? 0;
              const ahead = date > asOf;
              const heat = ahead || spent === 0 ? 0 : Math.min(4, Math.ceil((spent / maxDay) * 4));
              const inPick = picked !== null && date >= sel.start && date <= sel.end;
              const edge = inPick && (date === sel.start || date === sel.end);
              const className = [
                "fms-ical-day",
                inPick && "is-in",
                edge && "is-edge",
                ahead && "is-ahead",
                date === asOf && "is-today",
                anchor === date && "is-anchor",
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <button
                  key={date}
                  type="button"
                  data-date={date}
                  data-heat={heat}
                  className={className}
                  aria-pressed={inPick}
                  aria-label={`${formatMedium(date)}: ${spent > 0 ? `spent ${formatMoney(spent)}` : "nothing spent"}${
                    came > 0 ? `, ${formatMoney(came)} came in` : ""
                  }${ahead ? ", still ahead" : ""}`}
                  onClick={(e) => pickDay(date, e.shiftKey)}
                >
                  <span className="fms-ical-num">{Number(date.slice(8))}</span>
                  {came > 0 && <span aria-hidden className="fms-ical-in" />}
                  {spent > 0 && <span className="fms-ical-amt">{compactPeso(spent)}</span>}
                </button>
              );
            })}
          </div>

          <div aria-hidden className="t-micro fms-ical-legend">
            <span>
              Less
              <span className="fms-ical-scale">
                <i data-heat="0" />
                <i data-heat="1" />
                <i data-heat="2" />
                <i data-heat="3" />
                <i data-heat="4" />
              </span>
              More spent
            </span>
            <span>
              <span className="fms-ical-dot" /> Money came in
            </span>
            <span>
              <span className="fms-ical-ring" /> Today
            </span>
          </div>
        </div>

        <div className="fms-ical-panel">
          <div className="fms-ical-panelhead">
            <div className="fms-ical-title">
              <h2 className="t-display-m fms-truncate">{describeRange(sel)}</h2>
              <span className="t-caption fms-ical-sub">{picked ? when : `${when}. Pick a day or a range to narrow it.`}</span>
            </div>
            {picked && (
              <button
                type="button"
                className="t-caption fms-linkbtn"
                onClick={() => {
                  setPicked(null);
                  setAnchor(null);
                }}
              >
                {isThisMonth ? "Month so far" : "Whole month"}
              </button>
            )}
          </div>

          <div className="fms-ical-figs">
            <IFig
              label="Went out"
              value={report.spent}
              tone="var(--flow-spending-text)"
              hint={
                report.pastDays > 1
                  ? `${formatMoney(report.perDay)} a day`
                  : report.pastDays === 1
                    ? multi
                      ? "Over one day so far"
                      : "That day"
                    : "Nothing yet"
              }
            />
            <IFig
              label="Came in"
              value={report.cameIn}
              tone="var(--flow-revenue-text)"
              hint={`${report.rows.length} ${report.rows.length === 1 ? "entry" : "entries"}`}
            />
            {report.futureDays > 0 ? (
              <IFig
                label="Expected ahead"
                value={report.expectedTotal}
                hint={`${report.futureDays} ${report.futureDays === 1 ? "day" : "days"} to come`}
              />
            ) : monthToDay !== null ? (
              <IFig label="Month to that day" value={monthToDay} hint={`Since ${name} 1`} />
            ) : (
              <IFig
                label="Heaviest day"
                value={report.biggest?.amount ?? 0}
                hint={report.biggest ? shortDay(report.biggest.date) : "No spending"}
              />
            )}
          </div>

          <div className="fms-ical-tabs" role="tablist" aria-label="What the pick holds">
            {panelTabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={shownTab === t.id}
                disabled={!t.enabled}
                className="t-caption fms-ical-tab"
                onClick={() => setTab(t.id)}
              >
                {t.label}
                {t.count > 0 && <span className="fms-ical-count">{t.count}</span>}
              </button>
            ))}
          </div>

          {/* Keyed by the pick and the tab, so every list opens at its top. */}
          <div
            key={`${sel.start}-${sel.end}-${shownTab ?? "none"}`}
            className="fms-ical-body"
            role="tabpanel"
            aria-live="polite"
          >
            {shownTab === null && (
              <p className="t-body fms-ical-empty">
                Nothing was recorded {multi ? "on these days" : "that day"}, and nothing is expected on {multi ? "them" : "it"}.
              </p>
            )}

            {shownTab === "where" && (
              <>
                <ol className="fms-ical-kinds">
                  {kindRows.map((k, i) => (
                    <li key={k.name} className="fms-ical-kind">
                      <span className="t-body fms-truncate">{k.name}</span>
                      <span className="t-num-s">
                        {formatMoney(k.amount)}
                        <span className="t-micro fms-ical-share">{shareOf(k.amount, report.spent)}</span>
                      </span>
                      <span aria-hidden className="fms-ical-kindbar">
                        <span
                          style={{
                            width: `${Math.max(2, Math.round((k.amount / kindTop) * 100))}%`,
                            background: `var(--cat-${Math.min(17, i + 1)})`,
                          }}
                        />
                      </span>
                    </li>
                  ))}
                </ol>
                <div className="fms-ical-total">
                  <span className="t-caption">All of it</span>
                  <Money value={kindsTotal} size="s" />
                </div>
              </>
            )}

            {shownTab === "entries" && (
              <ul className="fms-ical-rows">
                {dayGroups.map((g) => (
                  <li key={g.date}>
                    {multi && (
                      <div className="t-micro fms-ical-daygroup">
                        <span>{formatMedium(g.date)}</span>
                        {g.spent > 0 && <span>{formatMoney(g.spent)} out</span>}
                      </div>
                    )}
                    <ul className="fms-ical-rows">
                      {g.rows.map((row) => (
                        <li key={row.id} className="fms-ical-row">
                          <div className="fms-ical-row-text">
                            <span className="t-body fms-truncate">{row.item || row.description || row.type}</span>
                            <span className="t-micro fms-truncate" style={{ color: "var(--ink-3)" }}>
                              #{String(row.recordNumber).padStart(4, "0")} · {row.type}
                              {row.fromWallet ? ` · from ${row.fromWallet}` : ""}
                              {row.toWallet ? ` · to ${row.toWallet}` : ""}
                            </span>
                          </div>
                          <div className="fms-ical-row-end">
                            <Money value={row.total} size="s" tone={TONE[row.type]} />
                            {onEditRow && (
                              <button type="button" className="t-caption fms-linkbtn" onClick={() => onEditRow(row)}>
                                Correct
                              </button>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}

            {shownTab === "ahead" && (
              <>
                {report.expected.length === 0 ? (
                  <p className="t-caption" style={{ margin: 0, color: "var(--ink-3)" }}>
                    No bill, debt payment or usual spending falls on {multi ? "these days" : "that day"}.
                  </p>
                ) : (
                  <ul className="fms-ical-rows">
                    {report.expected.map((e) => (
                      <li key={`${e.kind}-${e.name}`} className="fms-ical-row">
                        <div className="fms-ical-row-text">
                          <span className="t-body fms-truncate">{e.name}</span>
                          <span className="t-micro" style={{ color: "var(--ink-3)" }}>
                            {e.kind === "bill"
                              ? e.category === "Subscriptions"
                                ? "Subscription"
                                : "Bill"
                              : e.kind === "debt"
                                ? "Debt payment"
                                : "Usual spending, about"}
                            {" · "}
                            {e.times > 1 ? `${e.times} times from ${shortDay(e.on)}` : shortDay(e.on)}
                          </span>
                        </div>
                        <div className="fms-ical-row-end">
                          <Money value={e.amount} size="s" tone="var(--ink-2)" />
                          {e.kind === "bill" && onRecordBill && (
                            <button
                              type="button"
                              className="t-caption fms-linkbtn"
                              onClick={() =>
                                onRecordBill({
                                  item: e.name,
                                  category: e.category ?? "Bills",
                                  state: "due",
                                  amount: Math.round(e.amount / e.times),
                                })
                              }
                            >
                              Pay now
                            </button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {aheadThisMonth > 0 && nowSafe && (
                  <p className="t-caption fms-ical-note">
                    {nowSafe.perDay > 0
                      ? `At today's safe ${formatMoney(nowSafe.perDay)} a day, ${
                          aheadThisMonth === 1 ? "that day allows" : `those ${aheadThisMonth} days this month allow`
                        } ${formatMoney(nowSafe.perDay * aheadThisMonth)}.`
                      : `Nothing is safe to spend on ${aheadThisMonth === 1 ? "that day" : "those days"}: ${
                          nowSafe.limitedBy === "budget"
                            ? "the month's spending is already past its budget."
                            : "the wallets are needed for what is still due."
                        }`}
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </section>

      {/*
        Where a difference went (owner, 2026-09-17): an account holds a
        different amount than the ledger says, and this finds the entries
        that explain it. Here, with typed figures and pasted history; in the
        chat, with screenshots.
      */}
      {onAdd && onEditRow && onBin && (
        <Investigate
          transactions={transactions}
          reference={reference}
          asOf={asOf}
          onAdd={onAdd}
          onEditRow={onEditRow}
          onBin={onBin}
          {...(ai.disabled
            ? {}
            : {
                onAsk: async (finding: string) => {
                  /*
                   * The finding goes in the question, not in the context: it
                   * is already worked out, and the model is being asked to
                   * read it rather than to recompute it from the ledger.
                   */
                  const answer = await ai.ask("chat", {
                    question: [
                      "An account does not match my ledger. The app has already worked this out and every figure in it is correct:",
                      finding,
                      "",
                      "In three sentences at most: which of these is most likely, given what I usually do, and what should I check first? Do not add anything up, and do not repeat the figures back to me.",
                    ].join(String.fromCharCode(10)),
                  });
                  return answer.text;
                },
              })}
        />
      )}

      {aiSurfaceOn(settings.ai, "insightSummary") && (
        <Card title={`${name} in a sentence`} subtitle={ai.disabled ? "Written on this device" : "Ask the model to describe the month"}>
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

      {/* ── How the money is doing ──────────────────────────────────────── */}
      <Card
        title="How the money is doing"
        subtitle="The last three months, and what is owed against a year of income"
      >
        {healthLines.length === 0 ? (
          <EmptyState message="Not enough recorded yet to say." />
        ) : (
          <ul className="fms-month-notes">
            {healthLines.map((line) => (
              <li key={line} className="t-body">
                {line}
              </li>
            ))}
          </ul>
        )}
      </Card>

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
              <ul className="fms-month-notes">
                {brief.notes.map((note) => (
                  <li key={note} className="t-body">
                    {note}
                  </li>
                ))}
              </ul>
            )}
            <div className="fms-brief-tracks">
              <Track label="Spending" spent={t.spending.spent} budget={t.spending.budget} pace={pace} />
              <Track label="Bills and subscriptions" spent={t.billsSubs.spent} budget={t.billsSubs.budget} pace={pace} />
            </div>
          </div>
          {/*
            Six figures, each with a line under it, in three columns or two:
            always whole rows.
          */}
          <div className="fms-brief-figs">
            <Fig label="Came in" value={brief.cameIn} tone="var(--flow-revenue-text)" hint="Income, not starting balances" />
            <Fig label="Went out" value={brief.wentOut} tone="var(--flow-spending-text)" hint="Everything the budget counts" />
            <Fig
              label={brief.kept < 0 ? "More out than in" : "Kept"}
              value={brief.kept}
              signed
              hint={brief.cameIn > 0 ? `${Math.round((brief.kept / brief.cameIn) * 100)}% of what came in` : "No income"}
            />
            <Fig
              label="Budgeted"
              value={t.combined.budget}
              hint={
                t.combined.budget <= 0
                  ? "No budget set"
                  : t.combined.remaining < 0
                    ? `${formatMoney(-t.combined.remaining)} over`
                    : `${formatMoney(t.combined.remaining)} left`
              }
            />
            <Fig label="Wallets" value={brief.wallets} hint={brief.phase === "past" ? "At the end of the month" : "Today"} />
            <Fig label="Savings" value={brief.savings} hint={brief.phase === "past" ? "At the end of the month" : "Today"} />
          </div>
        </div>
      </Card>

      <div className="fms-charts">
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
              <Row label={`Safe to spend, set by the ${safe.limitedBy === "budget" ? "budget" : "wallets"}`} value={safe.safe} strong />
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

        <Card title="Where it came from" subtitle={`${name}'s income by source, starting balances left out`}>
          {income.length === 0 ? <EmptyState message={`Nothing came in during ${name}.`} /> : <RankBars rows={income} flow="revenue" />}
        </Card>
      </div>

      <p className="t-caption" style={{ color: "var(--ink-3)", textAlign: "center", margin: 0 }}>
        Figures as of {formatMedium(asOf)}
      </p>
    </div>
  );
}

/** "12%": a kind's share of what went out. Display only; the amounts stay whole centavos. */
function shareOf(part: Centavos, whole: Centavos): string {
  if (whole <= 0) return "";
  const pct = Math.round((part * 100) / whole);
  return pct < 1 ? "<1%" : `${pct}%`;
}

/** A figure at the top of the calendar's panel. */
function IFig({ label, value, tone, hint }: { label: string; value: Centavos; tone?: string | undefined; hint?: string | undefined }) {
  return (
    <div className="fms-ical-fig">
      <span className="t-label">{label}</span>
      <Money value={value} size="l" tone={tone} />
      {hint && <span className="t-caption fms-truncate">{hint}</span>}
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
  tone?: string | undefined;
  signed?: boolean | undefined;
  hint?: string | undefined;
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
