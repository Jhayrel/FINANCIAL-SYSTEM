/**
 * Insights: spec 7.6. Any month, any year, any run of days, read out.
 *
 * ── One period, and everything follows it ─────────────────────────────────
 *
 * The owner, 27 September 2026: "I can't even use range properly if I want
 * to see data of the year", the other charts and parts should work with the
 * range too, "like if I want to navigate 2024 March".
 *
 * The screen was built around one month. A year meant tapping a first day,
 * stepping twelve months and tapping a last one, and only the panel beside
 * the calendar followed the pick. So the top of the screen chooses a period
 * one of three ways: a month (any year, from the year steps and the month
 * strip), a whole year, or a range of any two dates with the usual ones a
 * tap away. Every part below reads that window (`domain/insightWindow.ts`).
 *
 * Inside the period a pick narrows it further, the way a day on the calendar
 * always has: a day or a run of days on a month's calendar, or a point on
 * the chart that stands in the calendar's place for a year or a range. Every
 * figure, list and chart under it then reads the pick, and a link beside the
 * title goes back to the whole period.
 *
 * ── The frame ───────────────────────────────────────────────────────────────
 *
 * One frame that holds still, as before: the calendar or the chart on the
 * left, and on the right what the pick holds in four tabs (where it went,
 * where it came from, every entry, and what is still ahead). A kind of
 * spending or a source of income opens its own entries when clicked.
 *
 * Under it, for a month: the month in brief, the month's spending against its
 * budget pace, what is safe to spend, and the bills. For a year or a range:
 * budget against spending month by month, and the bills paid. The AI sits on
 * top of these figures, never instead of them.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

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
import { AreaChart, BarChart, RankBars } from "../components/charts";
import { useAi } from "./useAi";
import { useMediaQuery } from "./useMediaQuery";
import { useReportScreen } from "./screenReport";
import type { AiAnswer } from "../data/aiClient";
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
  MONTH_NAMES_SHORT,
  monthName,
} from "../domain/dates";
import { rangeOf, rangeReport, type DayRange } from "../domain/dayRange";
import {
  billsPaidIn,
  budgetByMonth,
  bucketFor,
  incomeBySource,
  kindsAgainst,
  periodWords,
  presetRanges,
  previousWords,
  trendOf,
  windowOf,
  windowWords,
  wholeMonths,
  type Period,
} from "../domain/insightWindow";
import { kindOf } from "../domain/kinds";
import { formatMoney, type Centavos } from "../domain/money";
import { isOpenBill, monthBrief } from "../domain/monthPlan";
import { costOf, incomeOf } from "../domain/totals";
import type { Budgets, IsoDate, ReferenceLists, Transaction } from "../domain/types";
import { pickableYears } from "../domain/year";
import { whenWords } from "./Dashboard";
import { Investigate } from "./Investigate";
import type { Draft } from "../domain/entry";

const DAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"];

type Mode = "day" | "range";
type PanelTab = "where" | "came" | "entries" | "ahead";

/** Where Insights opens: another screen can send it to a month, a year or a pick. */
export interface InsightsAt {
  readonly period: Period;
  readonly picked?: DayRange | undefined;
  /** A kind of spending or a source of income, opened on its entries. */
  readonly focus?: { readonly name: string; readonly flow: "out" | "in" } | undefined;
}

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

const BUCKET_WORD = { day: "day", week: "week", month: "month" } as const;

export function Insights({
  transactions,
  reference,
  budgets,
  debts,
  asOf,
  settings,
  initial,
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
  /** Where to open, when another screen sent the owner here. */
  initial?: InsightsAt | undefined;
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
  const nowYear = getYear(asOf);
  const nowMonth = getMonth(asOf);
  const wide = useMediaQuery("(min-width: 1024px)");

  const [period, setPeriodOnly] = useState<Period>(initial?.period ?? { kind: "month", year: nowYear, month: nowMonth });
  const [picked, setPicked] = useState<DayRange | null>(initial?.picked ?? null);
  const [mode, setMode] = useState<Mode>("day");
  const [anchor, setAnchor] = useState<IsoDate | null>(null);
  /** A kind of spending or a source of income, whose entries the panel is showing. */
  const [focus, setFocus] = useState<{ name: string; flow: "out" | "in" } | null>(initial?.focus ?? null);
  const [tab, setTab] = useState<PanelTab>(initial?.focus ? "entries" : "where");

  /**
   * Sent here for a kind's entries, the panel that lists them is brought into
   * view. On a phone it sits under the chart, a screen or more down.
   */
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (initial?.focus) panelRef.current?.scrollIntoView({ block: "start" });
    // Only on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** A new period starts whole: no pick, no half-made range, no kind picked. */
  const setPeriod = (p: Period): void => {
    setPeriodOnly(p);
    setPicked(null);
    setAnchor(null);
    setFocus(null);
  };

  const years = useMemo(() => pickableYears(transactions, Object.keys(budgets), asOf), [transactions, budgets, asOf]);

  // ── The window ───────────────────────────────────────────────────────────

  /** The whole period: the calendar's month, the chart's axis. */
  const frame = useMemo(() => windowOf(period), [period]);
  /**
   * What the period means before anything is picked: all of it, or up to
   * today when it is still going, so "a day" averages over the days that have
   * happened and August so far goes against the same days of July.
   */
  const soFar: DayRange =
    period.kind !== "range" && frame.start <= asOf && asOf < frame.end ? { start: frame.start, end: asOf } : frame;
  const sel = picked ?? soFar;
  const multi = sel.start !== sel.end;
  const selKey = `${sel.start}|${sel.end}`;

  // The month on the calendar and in the brief: the period's, or the pick's for a year or range.
  const year = period.kind === "month" ? period.year : getYear(sel.start);
  const month = period.kind === "month" ? period.month : getMonth(sel.start);
  const isThisMonth = year === nowYear && month === nowMonth;
  const name = monthName(month);

  /**
   * The written summary follows the period, not the clock. Looking at March
   * and reading a description of August would be wrong in a way that is very
   * hard to spot, because every figure in it would be real.
   */
  const viewing = period.kind === "month" ? (isThisMonth ? asOf : makeDate(year, month, 1)) : sel.end > asOf ? asOf : sel.end;
  const ai = useAi({ settings, transactions, budgets, reference, feature: "insightSummary", asOf: viewing });

  const report = useMemo(
    () => rangeReport({ transactions, reference, debts, range: sel, asOf }),
    // The range is its two ends; a new object with the same ends is the same range.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [transactions, reference, debts, selKey, asOf],
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const kinds = useMemo(() => kindsAgainst(transactions, debts, sel), [transactions, debts, selKey]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const income = useMemo(() => incomeBySource(transactions, sel), [transactions, selKey]);
  const before = previousWords(sel);

  const brief = useMemo(
    () => monthBrief({ transactions, reference, budgets, debts, year, month, asOf }),
    [transactions, reference, budgets, debts, year, month, asOf],
  );
  const now = useMemo(
    () => (isThisMonth ? brief : monthBrief({ transactions, reference, budgets, debts, year: nowYear, month: nowMonth, asOf })),
    [isThisMonth, brief, transactions, reference, budgets, debts, nowYear, nowMonth, asOf],
  );

  const monthStart = firstOfMonth(year, month);

  /** Each day's spending and income on the calendar's month, by the app's own definitions. */
  const days = useMemo(() => {
    const prefix = monthStart.slice(0, 7);
    const spent = new Map<IsoDate, Centavos>();
    const came = new Map<IsoDate, Centavos>();
    for (const t of transactions) {
      if (!t.date.startsWith(prefix)) continue;
      const cost = costOf(t);
      if (cost > 0) spent.set(t.date, (spent.get(t.date) ?? 0) + cost);
      const got = incomeOf(t);
      if (got > 0) came.set(t.date, (came.get(t.date) ?? 0) + got);
    }
    return { spent, came };
  }, [transactions, monthStart]);

  /** Months of the shown year with anything in them, for the month strip. */
  const activeMonths = useMemo(() => {
    const y = period.kind === "month" ? period.year : nowYear;
    const out = new Set<number>();
    for (const t of transactions) if (getYear(t.date) === y) out.add(getMonth(t.date));
    return out;
  }, [transactions, period, nowYear]);

  /** The chart that stands in the calendar's place for a year or a range. */
  const trend = useMemo(() => (period.kind === "month" ? [] : trendOf(transactions, frame)), [transactions, frame, period.kind]);
  const bucket = bucketFor(frame);
  /**
   * The lines stop at today. A month still ahead is not a month of nothing,
   * and drawing it at zero made the income line fall off a cliff in September.
   */
  const started = trend.filter((p) => p.start <= asOf).length;

  /** How the money is doing, over the last three months and a year: not the period's. */
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

  /** Budget against spending, a month at a time, over the window. */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const budgetMonths = useMemo(() => budgetByMonth(transactions, budgets, sel), [transactions, budgets, selKey]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const billsPaid = useMemo(() => billsPaidIn(transactions, sel), [transactions, selKey]);

  /** The month's spending day by day, added up, against a straight line to its budget. */
  const burn = useMemo(() => {
    if (period.kind !== "month") return null;
    const points = trendOf(transactions, frame, "day");
    const last = asOf < frame.start ? -1 : points.findIndex((p) => p.start === asOf);
    const upTo = last === -1 && asOf >= frame.end ? points.length - 1 : last;
    let running = 0;
    const spent: Centavos[] = [];
    for (let i = 0; i <= upTo; i += 1) {
      running += points[i]?.spent ?? 0;
      spent.push(running);
    }
    const budget = brief.tracks.combined.budget;
    const pace = points.map((_, i) => Math.round((budget * (i + 1)) / points.length));
    return { points, spent, pace, budget };
  }, [period.kind, transactions, frame, asOf, brief.tracks.combined.budget]);

  const t = brief.tracks;
  const safe = brief.safe;
  const nowSafe = now.safe;
  const maxDay = Math.max(1, ...days.spent.values());
  const open = brief.bills.bills.filter(isOpenBill);
  const paid = brief.bills.bills.filter((b) => b.state === "paid");
  const missed = brief.bills.bills.filter((b) => b.state === "missed" || b.state === "expected");

  /**
   * For one past day on a month's calendar: what the month had spent by the
   * end of it. "Heaviest day" for one day is that day again.
   */
  const monthToDay =
    !multi && period.kind === "month" && sel.start.startsWith(monthStart.slice(0, 7))
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

  // ── The panel ────────────────────────────────────────────────────────────

  /** A row belongs to the kind or source picked, by the same filing as the lists. */
  const inFocus = (row: Transaction): boolean => {
    if (!focus) return true;
    if (focus.flow === "out") return costOf(row) > 0 && kindOf(row, debts) === focus.name;
    return incomeOf(row) > 0 && (row.item.trim() || "Unnamed") === focus.name;
  };
  const shownRows = focus ? report.rows.filter(inFocus) : report.rows;

  const panelTabs = [
    { id: "where" as const, label: "Where it went", count: 0, enabled: kinds.length > 0 },
    { id: "came" as const, label: "Came from", count: 0, enabled: income.length > 0 },
    { id: "entries" as const, label: "Entries", count: shownRows.length, enabled: report.rows.length > 0 },
    { id: "ahead" as const, label: "Still ahead", count: report.expected.length, enabled: report.futureDays > 0 },
  ];
  const shownTab = panelTabs.find((x) => x.id === tab && x.enabled)?.id ?? panelTabs.find((x) => x.enabled)?.id ?? null;

  const kindsTotal = kinds.reduce((sum, k) => sum + k.amount, 0);
  const incomeTotal = income.reduce((sum, k) => sum + k.amount, 0);

  /** The pick's entries a day at a time, with what each day spent. */
  const dayGroups = useMemo(() => {
    const out: { date: IsoDate; rows: Transaction[]; spent: Centavos }[] = [];
    for (const row of shownRows) {
      let group = out[out.length - 1];
      if (!group || group.date !== row.date) {
        group = { date: row.date, rows: [], spent: 0 };
        out.push(group);
      }
      group.rows.push(row);
      group.spent += costOf(row);
    }
    return out;
  }, [shownRows]);

  const pickFocus = (name: string, flow: "out" | "in"): void => {
    if (focus && focus.name === name && focus.flow === flow) {
      setFocus(null);
      return;
    }
    setFocus({ name, flow });
    setTab("entries");
  };

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

  /** A quick pick on the calendar: the calendar moves to where it starts. */
  const choose = (range: DayRange): void => {
    setPicked(range);
    setAnchor(null);
    const y = getYear(range.start);
    const m = getMonth(range.start);
    if (period.kind !== "month" || y !== period.year || m !== period.month) setPeriodOnly({ kind: "month", year: y, month: m });
  };

  /** Switching how the period is chosen keeps what is being looked at. */
  const switchKind = (kind: Period["kind"]): void => {
    if (kind === period.kind) return;
    if (kind === "month") setPeriod({ kind: "month", year: getYear(sel.start), month: getMonth(sel.start) });
    else if (kind === "year") setPeriod({ kind: "year", year: getYear(sel.start) });
    else setPeriod({ kind: "range", start: sel.start, end: sel.end });
  };

  const monday = addDays(asOf, -((dayOfWeek(asOf) + 6) % 7));
  const monthFallback: DayRange = isThisMonth ? { start: monthStart, end: asOf } : { start: monthStart, end: lastOfMonth(year, month) };
  const quick: { label: string; range: DayRange }[] = [
    { label: "Today", range: { start: asOf, end: asOf } },
    { label: "This week", range: { start: monday, end: asOf } },
    { label: "Last 7 days", range: { start: addDays(asOf, -6), end: asOf } },
    { label: "Next 7 days", range: { start: addDays(asOf, 1), end: addDays(asOf, 7) } },
    { label: isThisMonth ? "Month so far" : "Whole month", range: monthFallback },
  ];
  const isQuick = (r: DayRange): boolean => picked !== null && picked.start === r.start && picked.end === r.end;

  const presets = useMemo(() => presetRanges(asOf), [asOf]);
  const periodIsCurrent = frame.start <= asOf && asOf <= frame.end;
  const wholeWord =
    period.kind === "month"
      ? isThisMonth
        ? "Month so far"
        : "Whole month"
      : period.kind === "year"
        ? periodIsCurrent
          ? "Year so far"
          : "Whole year"
        : "Whole range";

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

  const selWords = windowWords(sel);
  /** A pick that is exactly one month, when the period is a year or a range: it can open on the calendar. */
  const pickedMonth = period.kind !== "month" && picked ? wholeMonths(picked) : null;

  // The chart's busiest and quietest points, among those that have started.
  const trendPast = trend.filter((p) => p.start <= asOf);
  const busiest = trendPast.reduce<(typeof trend)[number] | null>((b, p) => (!b || p.spent > b.spent ? p : b), null);
  const quietest = trendPast.reduce<(typeof trend)[number] | null>((b, p) => (!b || p.spent < b.spent ? p : b), null);
  const trendAverage = trendPast.length > 0 ? Math.floor(trendPast.reduce((s, p) => s + p.spent, 0) / trendPast.length) : 0;

  const budgetTotal = budgetMonths.reduce((s, m) => s + m.budget, 0);
  const budgetSpent = budgetMonths.reduce((s, m) => s + m.spent, 0);
  const monthsOver = budgetMonths.filter((m) => m.budget > 0 && m.spent > m.budget).length;

  // ── The written summary for a year or a range ────────────────────────────

  const [periodAnswer, setPeriodAnswer] = useState<{ key: string; answer: AiAnswer } | null>(null);
  const [asking, setAsking] = useState(false);

  const reportLines = [
    `Looking at ${periodWords(period)}${picked ? `, narrowed to ${selWords}` : ""} (${when.toLowerCase()}).`,
    `Went out ${formatMoney(report.spent)}, came in ${formatMoney(report.cameIn)}, ${report.rows.length} entries.`,
    kinds.length > 0
      ? `Where it went, against ${before}: ${kinds.map((k) => `${k.name} ${formatMoney(k.amount)} (${formatMoney(k.before)} before)`).join(", ")}.`
      : "",
    income.length > 0 ? `Where it came from: ${income.map((k) => `${k.name} ${formatMoney(k.amount)}`).join(", ")}.` : "",
    budgetMonths.length > 1 || period.kind !== "month"
      ? `Budget against spending: ${budgetMonths
          .map((m) => `${MONTH_NAMES_SHORT[m.month - 1]} ${m.year} ${formatMoney(m.spent)} of ${formatMoney(m.budget)}`)
          .join(", ")}.`
      : "",
    report.futureDays > 0
      ? `Expected on the ${report.futureDays} days still ahead: ${
          report.expected.length > 0
            ? report.expected.map((e) => `${e.name} ${formatMoney(e.amount)} from ${e.on}`).join(", ")
            : "nothing"
        }.`
      : "",
  ].filter(Boolean);

  useReportScreen(
    () => ({
      screen: "Insights",
      lines: [
        ...reportLines,
        ...(period.kind === "month" ? [`${name} ${year}: ${phaseWords.toLowerCase()}.`, ...brief.notes] : []),
        safe && period.kind === "month"
          ? `Safe to spend ${formatMoney(safe.perDay)} a day (${formatMoney(safe.safe)}), set by the ${safe.limitedBy}.`
          : "",
        ...healthLines,
      ],
      range: { from: sel.start, to: sel.end },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [period, selKey, when, report, kinds, income, budgetMonths, brief, safe, healthLines, name, year, phaseWords],
  );

  const describePeriod = async (): Promise<void> => {
    setAsking(true);
    try {
      const answer = await ai.ask("chat", {
        question: [
          `Describe my money over ${selWords} (${sel.start} to ${sel.end}) in three or four sentences:`,
          `what came in, what went out, where most of it went, and what changed against ${before}.`,
          "Every figure below is already worked out and correct. Use only these; do not add anything up.",
        ].join(" "),
        screen: reportLines.join(String.fromCharCode(10)),
      });
      setPeriodAnswer({ key: selKey, answer });
    } finally {
      setAsking(false);
    }
  };

  // ── The period bar ───────────────────────────────────────────────────────

  const periodBar = (
    <div className="fms-iperiod">
      <SegmentedControl
        options={[
          { id: "month", label: "Month" },
          { id: "year", label: "Year" },
          { id: "range", label: "Range" },
        ]}
        value={period.kind}
        onChange={switchKind}
        label="Look at a month, a year or a range"
      />
      <div className="fms-iperiod-pick">
        {period.kind === "month" && (
          <PeriodPicker
            year={period.year}
            month={period.month}
            years={years}
            active={activeMonths}
            onChange={(y, m) => {
              setPeriodOnly({ kind: "month", year: y, month: m });
              setFocus(null);
              // A range waiting for its last day keeps its first across the move.
              if (!anchor) setPicked(null);
            }}
            today={{ year: nowYear, month: nowMonth }}
          />
        )}
        {period.kind === "year" && (
          <div className="fms-period">
            <div className="fms-period-months fms-iperiod-years" role="radiogroup" aria-label="Year">
              {years.map((y) => (
                <button
                  key={y}
                  type="button"
                  role="radio"
                  aria-checked={y === period.year}
                  className={["fms-period-month", y === period.year && "is-on"].filter(Boolean).join(" ")}
                  onClick={() => setPeriod({ kind: "year", year: y })}
                >
                  <span className="t-caption">{y}</span>
                  {y === nowYear && <span aria-hidden className="fms-period-dot" />}
                </button>
              ))}
            </div>
          </div>
        )}
        {period.kind === "range" && (
          <div className="fms-irange">
            <div className="fms-irange-dates">
              <label className="fms-irange-field">
                <span className="t-label">From</span>
                <input
                  type="date"
                  className="t-body fms-control"
                  value={period.start}
                  onChange={(e) => e.target.value && setPeriod({ kind: "range", ...rangeOf(e.target.value, period.end) })}
                />
              </label>
              <label className="fms-irange-field">
                <span className="t-label">To</span>
                <input
                  type="date"
                  className="t-body fms-control"
                  value={period.end}
                  onChange={(e) => e.target.value && setPeriod({ kind: "range", ...rangeOf(period.start, e.target.value) })}
                />
              </label>
            </div>
            <div className="fms-ical-quick fms-irange-presets" role="group" aria-label="Ranges">
              {presets.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="t-caption fms-ical-pick"
                  aria-pressed={period.start === p.range.start && period.end === p.range.end}
                  onClick={() => setPeriod({ kind: "range", ...p.range })}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  // ── The left of the frame: the calendar, or the chart ───────────────────

  const calendar = (
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
  );

  const chart = (
    <div className="fms-ical-cal fms-ical-chart">
      <div className="fms-ical-head">
        <div className="fms-ical-title">
          <h2 className="t-display-m">{periodWords(period)}</h2>
          <span className="t-caption fms-ical-sub">
            {wide
              ? `By ${BUCKET_WORD[bucket]}. Point at one to read it, click to narrow everything to it.`
              : `By ${BUCKET_WORD[bucket]}. Tap one to read it and narrow everything to it.`}
          </span>
        </div>
      </div>
      <div className="fms-ical-chartbox">
        {/*
          Keyed by the period, so a new one starts with its own series shown:
          by month both lines are on, by day or week the income line starts
          off, because one allowance day would flatten every day of spending.
        */}
        <AreaChart
          key={`${frame.start}|${frame.end}`}
          labels={trend.map((p) => p.label)}
          titles={trend.map((p) => p.title)}
          series={[
            { name: "Went out", values: trend.slice(0, started).map((p) => p.spent), colour: "var(--flow-spending)" },
            { name: "Came in", values: trend.slice(0, started).map((p) => p.cameIn), colour: "var(--flow-revenue)" },
          ]}
          hidden={bucket === "month" ? [] : ["Came in"]}
          height={wide ? 330 : undefined}
          note={(i) => {
            const p = trend[i];
            if (!p) return null;
            const kept = p.cameIn - p.spent;
            return p.start > asOf ? "Still ahead" : `${kept < 0 ? "More out than in by" : "Kept"} ${formatMoney(Math.abs(kept))}`;
          }}
          onPick={(i) => {
            const p = trend[i];
            if (!p) return;
            setPicked({ start: p.start, end: p.end });
            setAnchor(null);
          }}
          pickLabel={(i) => `Show only ${trend[i]?.title ?? ""}`}
        />
      </div>
      {busiest && trendPast.length > 1 && (
        <div className="fms-ical-stats">
          <div>
            <span className="t-label">Busiest {BUCKET_WORD[bucket]}</span>
            <button type="button" className="t-caption fms-linkbtn" onClick={() => setPicked({ start: busiest.start, end: busiest.end })}>
              {busiest.title}
            </button>
            <Money value={busiest.spent} size="s" tone="var(--flow-spending-text)" />
          </div>
          {quietest && (
            <div>
              <span className="t-label">Quietest</span>
              <button type="button" className="t-caption fms-linkbtn" onClick={() => setPicked({ start: quietest.start, end: quietest.end })}>
                {quietest.title}
              </button>
              <Money value={quietest.spent} size="s" />
            </div>
          )}
          <div>
            <span className="t-label">On average</span>
            <span className="t-caption" style={{ color: "var(--ink-3)" }}>
              a {BUCKET_WORD[bucket]}
            </span>
            <Money value={trendAverage} size="s" />
          </div>
        </div>
      )}
    </div>
  );

  // ── The right of the frame: what the pick holds ─────────────────────────

  const panel = (
    <div className="fms-ical-panel" ref={panelRef}>
      <div className="fms-ical-panelhead">
        <div className="fms-ical-title">
          <h2 className="t-display-m fms-truncate">{selWords}</h2>
          <span className="t-caption fms-ical-sub">
            {picked ? when : `${when}. Pick ${period.kind === "month" ? "a day or a range" : "a point on the chart"} to narrow it.`}
          </span>
        </div>
        <div className="fms-ical-headlinks">
          {pickedMonth && pickedMonth.length === 1 && (
            <button
              type="button"
              className="t-caption fms-linkbtn"
              onClick={() => setPeriod({ kind: "month", year: pickedMonth[0]!.year, month: pickedMonth[0]!.month })}
            >
              Open on the calendar
            </button>
          )}
          {picked && (
            <button
              type="button"
              className="t-caption fms-linkbtn"
              onClick={() => {
                setPicked(null);
                setAnchor(null);
              }}
            >
              {wholeWord}
            </button>
          )}
        </div>
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
        ) : multi ? (
          <IFig
            label={report.cameIn - report.spent < 0 ? "More out than in" : "Kept"}
            value={report.cameIn - report.spent}
            signed
            hint={report.biggest ? `Heaviest day ${shortDay(report.biggest.date)}` : "No spending"}
          />
        ) : (
          <IFig label="Heaviest day" value={report.biggest?.amount ?? 0} hint={report.biggest ? shortDay(report.biggest.date) : "No spending"} />
        )}
      </div>

      <div className="fms-ical-tabs" role="tablist" aria-label="What the pick holds">
        {panelTabs.map((x) => (
          <button
            key={x.id}
            type="button"
            role="tab"
            aria-selected={shownTab === x.id}
            disabled={!x.enabled}
            className="t-caption fms-ical-tab"
            onClick={() => setTab(x.id)}
          >
            {x.label}
            {x.count > 0 && <span className="fms-ical-count">{x.count}</span>}
          </button>
        ))}
      </div>

      {/* Keyed by the pick and the tab, so every list opens at its top. */}
      <div key={`${selKey}-${shownTab ?? "none"}-${focus?.name ?? ""}`} className="fms-ical-body" role="tabpanel" aria-live="polite">
        {shownTab === null && (
          <p className="t-body fms-ical-empty">
            Nothing was recorded {multi ? "on these days" : "that day"}, and nothing is expected on {multi ? "them" : "it"}.
          </p>
        )}

        {shownTab === "where" && (
          <>
            <p className="t-micro fms-ical-lead">Against {before}. Select one for its entries.</p>
            <RankBars
              rows={kinds.map((k) => ({
                name: k.name,
                amount: k.amount,
                hint:
                  k.before === 0
                    ? `None in ${before}`
                    : k.amount === k.before
                      ? `No change from ${before}`
                      : `${formatMoney(Math.abs(k.amount - k.before))} ${k.amount > k.before ? "more" : "less"} than ${before}`,
              }))}
              total={kindsTotal}
              onPick={(n) => pickFocus(n, "out")}
              active={focus?.flow === "out" ? focus.name : null}
            />
            <div className="fms-ical-total">
              <span className="t-caption">All of it</span>
              <Money value={kindsTotal} size="s" />
            </div>
          </>
        )}

        {shownTab === "came" && (
          <>
            <p className="t-micro fms-ical-lead">Starting balances left out. Select one for its entries.</p>
            <RankBars
              rows={income}
              flow="revenue"
              total={incomeTotal}
              onPick={(n) => pickFocus(n, "in")}
              active={focus?.flow === "in" ? focus.name : null}
            />
            <div className="fms-ical-total">
              <span className="t-caption">All of it</span>
              <Money value={incomeTotal} size="s" />
            </div>
          </>
        )}

        {shownTab === "entries" && (
          <>
            {focus && (
              <div className="fms-ical-focus">
                <span className="t-caption">
                  Only <strong>{focus.name}</strong>, {formatMoney(shownRows.reduce((s, r) => s + (focus.flow === "out" ? costOf(r) : incomeOf(r)), 0))}
                </span>
                <button type="button" className="t-caption fms-linkbtn" onClick={() => setFocus(null)}>
                  Show every entry
                </button>
              </div>
            )}
            {shownRows.length === 0 ? (
              <p className="t-caption" style={{ margin: 0, color: "var(--ink-3)" }}>
                No {focus ? focus.name : ""} entries {multi ? "on these days" : "that day"}.
              </p>
            ) : (
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
          </>
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
  );

  // ── The cards under the frame ────────────────────────────────────────────

  const health = (
    <Card title="How the money is doing" subtitle="The last three months, and what is owed against a year of income">
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
  );

  const aiOn = aiSurfaceOn(settings.ai, "insightSummary");
  const shownPeriodAnswer = periodAnswer && periodAnswer.key === selKey ? periodAnswer.answer : null;
  const sentence = !aiOn ? null : period.kind === "month" && !picked ? (
    <Card title={`${name} in a sentence`} subtitle={ai.disabled ? "Written on this device" : "Ask the model to describe the month"}>
      {ai.answer ? (
        <AiAnswerView answer={ai.answer} />
      ) : (
        <p className="t-body" style={{ margin: 0, color: "var(--ink-3)" }}>
          Nothing asked yet. The figures here are already correct; this only puts them into words.
        </p>
      )}
      <div className="fms-addrow" style={{ marginTop: "var(--space-3)" }}>
        <Button variant="primary" loading={ai.loading} onClick={() => void ai.run("summary")}>
          {ai.answer ? "Ask again" : "Describe this month"}
        </Button>
        <Button onClick={() => void ai.run("patterns")}>Look for a pattern</Button>
      </div>
    </Card>
  ) : (
    <Card title={`${selWords} in a sentence`} subtitle={ai.disabled ? "Written on this device" : "Ask the model to describe it"}>
      {shownPeriodAnswer ? (
        <AiAnswerView answer={shownPeriodAnswer} />
      ) : (
        <p className="t-body" style={{ margin: 0, color: "var(--ink-3)" }}>
          Nothing asked yet. The figures here are already correct; this only puts them into words.
        </p>
      )}
      <div className="fms-addrow" style={{ marginTop: "var(--space-3)" }}>
        <Button variant="primary" loading={asking} onClick={() => void describePeriod()}>
          {shownPeriodAnswer ? "Ask again" : "Describe it"}
        </Button>
      </div>
    </Card>
  );

  const monthCards = (
    <>
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
          {/* Six figures, each with a line under it, in three columns or two: always whole rows. */}
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
        {burn && (
          <Card
            title={`Spending through ${name}`}
            subtitle={
              burn.budget > 0
                ? "Added up day by day, against a steady pace to the budget"
                : "Added up day by day. Set a budget to see a pace beside it."
            }
          >
            <AreaChart
              key={monthStart}
              labels={burn.points.map((p) => p.label)}
              titles={burn.points.map((p) => p.title)}
              series={[
                { name: "Spent so far", values: burn.spent, colour: "var(--flow-spending)" },
                ...(burn.budget > 0 ? [{ name: "Budget pace", values: burn.pace, colour: "var(--ink-3)", guide: true }] : []),
              ]}
              note={(i) => {
                const spent = burn.spent[i];
                if (spent === undefined) return "Still ahead";
                const day = burn.points[i]?.spent ?? 0;
                const gap = burn.budget > 0 ? (burn.pace[i] ?? 0) - spent : null;
                return `${formatMoney(day)} that day${
                  gap === null ? "" : gap >= 0 ? `, ${formatMoney(gap)} under the pace` : `, ${formatMoney(-gap)} over the pace`
                }`;
              }}
              onPick={(i) => {
                const p = burn.points[i];
                if (!p) return;
                setPicked({ start: p.start, end: p.end });
                setAnchor(null);
              }}
              pickLabel={(i) => `Read ${burn.points[i]?.title ?? "that day"}`}
            />
          </Card>
        )}

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
                <Row
                  key={`bill-${b.item}`}
                  label={b.daysToDue === undefined ? b.item : `${b.item}, ${whenWords(b.daysToDue).toLowerCase()}`}
                  value={-b.amount}
                  quiet
                />
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
      </div>

      <div className="fms-charts">
        <Card
          title="Bills and subscriptions"
          subtitle={
            brief.bills.bills.length === 0
              ? `None expected in ${name}`
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
                      // A payment with no date on it is named alone, not "Dito Prepaid," with nothing after the comma.
                      <Row key={b.item} label={b.paidOn ? `${b.item}, ${shortDay(b.paidOn)}` : b.item} value={b.amount} />
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
        {health}
      </div>
    </>
  );

  const spanCards = (
    <>
      <div className="fms-charts">
        <Card
          title="Budget against spending"
          subtitle={
            budgetMonths.length === 1
              ? `${monthName(budgetMonths[0]!.month)} ${budgetMonths[0]!.year}, the whole month's budget`
              : `Each month ${selWords} touches, its whole budget`
          }
          action={
            onOpenBudget ? (
              <Button size="sm" onClick={onOpenBudget}>
                Open Budget
              </Button>
            ) : undefined
          }
        >
          <div className="fms-spanfigs">
            <Fig label="Budgeted" value={budgetTotal} hint={budgetTotal > 0 ? `${budgetMonths.length} ${budgetMonths.length === 1 ? "month" : "months"}` : "No budget set"} />
            <Fig label="Spent" value={budgetSpent} tone="var(--flow-spending-text)" hint="What the budget counts" />
            <Fig
              label={budgetSpent > budgetTotal && budgetTotal > 0 ? "Over by" : "Left"}
              value={Math.abs(budgetTotal - budgetSpent)}
              tone={budgetSpent > budgetTotal && budgetTotal > 0 ? "var(--over)" : undefined}
              hint={monthsOver > 0 ? `${monthsOver} ${monthsOver === 1 ? "month" : "months"} over` : budgetTotal > 0 ? "No month over" : ""}
            />
          </div>
          <BarChart
            labels={budgetMonths.map((m) => (getYear(sel.start) === getYear(sel.end) ? MONTH_NAMES_SHORT[m.month - 1]! : `${MONTH_NAMES_SHORT[m.month - 1]} ${String(m.year).slice(2)}`))}
            titles={budgetMonths.map((m) => `${monthName(m.month)} ${m.year}`)}
            budget={budgetMonths.map((m) => m.budget)}
            actual={budgetMonths.map((m) => m.spent)}
            onPick={(i) => {
              const m = budgetMonths[i];
              if (m) setPeriod({ kind: "month", year: m.year, month: m.month });
            }}
            pickLabel={(i) => `Open ${monthName(budgetMonths[i]?.month ?? 1)} ${budgetMonths[i]?.year ?? ""} on the calendar`}
          />
        </Card>

        <Card
          title="Bills and subscriptions paid"
          subtitle={
            billsPaid.length === 0
              ? `None in ${selWords}`
              : `${formatMoney(billsPaid.reduce((s, b) => s + b.total, 0))} in ${billsPaid.reduce((s, b) => s + b.times, 0)} payments`
          }
        >
          {billsPaid.length === 0 ? (
            <EmptyState message="No bill or subscription was paid in this stretch. Pick a longer one above." />
          ) : (
            <div className="fms-month-lines">
              {billsPaid.map((b) => (
                <Row
                  key={`${b.category}-${b.item}`}
                  label={
                    <>
                      {b.item}
                      <span style={{ color: "var(--ink-3)" }}>
                        {" "}
                        · {b.category === "Subscriptions" ? "Subscription" : "Bill"}, {b.times === 1 ? `paid ${shortDay(b.last)}` : `${b.times} times, last ${shortDay(b.last)}`}
                      </span>
                    </>
                  }
                  value={b.total}
                />
              ))}
            </div>
          )}
        </Card>
      </div>
      <div className="fms-charts">
        {health}
        {sentence}
      </div>
    </>
  );

  return (
    <div className="fms-dash">
      {periodBar}

      <section className="fms-ical" aria-label={`${periodWords(period)}, and what the pick holds`}>
        {period.kind === "month" ? calendar : chart}
        {panel}
      </section>

      {period.kind === "month" ? monthCards : spanCards}

      {period.kind === "month" && sentence}

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
          accounts={settings.accounts}
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

      <p className="t-caption" style={{ color: "var(--ink-3)", textAlign: "center", margin: 0 }}>
        Figures as of {formatMedium(asOf)}
      </p>
    </div>
  );
}

/** A figure at the top of the calendar's panel. */
function IFig({
  label,
  value,
  tone,
  hint,
  signed,
}: {
  label: string;
  value: Centavos;
  tone?: string | undefined;
  hint?: string | undefined;
  signed?: boolean | undefined;
}) {
  return (
    <div className="fms-ical-fig">
      <span className="t-label">{label}</span>
      <Money value={value} size="l" tone={tone} signed={signed} />
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
