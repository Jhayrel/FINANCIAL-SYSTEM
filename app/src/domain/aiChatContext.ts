/**
 * What the assistant gets to look at when you ask it something.
 *
 * ── The problem this solves ───────────────────────────────────────────────
 *
 * `aiContext.ts` sends figures and nothing else: totals, balances, rankings.
 * That is right for the summary panels, which describe a month. It is hopeless
 * for a conversation, and the transcripts say so in the model's own words:
 *
 *   "The data does not include the number of times you spent, so I cannot
 *    give a count."
 *   "The data does not provide a category breakdown for May."
 *   "a month-by-month spending detail would be needed"
 *
 * Every one of those is true. The model was not being stupid, it was being
 * starved, and no amount of prompting fixes a fact that was never sent.
 *
 * ── What changes ──────────────────────────────────────────────────────────
 *
 * The chat gets the ledger. Not as an afterthought: a compact line per row,
 * plus every total worked out here so the model never has to add anything.
 *
 * That split is the important part. Arithmetic on 440 rows is exactly what a
 * small free model gets wrong, and a wrong total in a financial answer is
 * worse than no answer. So the counting, the grouping and the ranking all
 * happen in this file, in TypeScript, on integer centavos, and the rows are
 * there for the questions totals cannot answer: which ones, when, what was it
 * for, list them.
 *
 * ── How big this gets ─────────────────────────────────────────────────────
 *
 * About 70 bytes a row, so this ledger is roughly 30 KB whole. That is small
 * enough to send in full, and the budget below is a ceiling for the day it is
 * not: rows are chosen by relevance to the question, most relevant first, and
 * the reader is told how many were left out.
 *
 * ── What is deliberately left out ─────────────────────────────────────────
 *
 * `notes`. It is the most private field in the ledger, the one that holds
 * "paid Tita back for the hospital bill", and almost no question needs it.
 * `description` goes, because "what did I buy at the pharmacy" is unanswerable
 * without it. Everything is redacted on the way out regardless.
 */

import { contextToText, phpFigure, type AiContext } from "./aiContext";
import { addDays, dayOfWeek, formatMedium } from "./dates";
import { redact } from "./aiRedact";
import { toCentavos, toPesos } from "./money";
import { costOf, incomeOf } from "./totals";
import { debtDue, positionsOf, rowsFor, type Debt } from "./debt";
import { creditRoom, limitSteps } from "./creditLimit";
import { assessMonthFor, budgetForMonth } from "./budget";
import { outlookAhead, outlookFacts } from "./outlook";
import { moneyFlow, flowWords } from "./moneyFlow";
import { whyOver } from "./budgetAdvice";
import { namesWindow, windowOf } from "./charts";
import { figuresIn } from "./money";
import type { Budgets, IsoDate, Transaction } from "./types";

/**
 * The ceiling on the ledger half, in bytes.
 *
 * Sized so this dataset fits whole with room to grow, and so a ledger ten
 * times this size still produces a bounded request rather than a rejected one.
 */
export const MAX_ROW_BYTES = 60_000;

/** How many rows of a group to name before summarising the rest. */
const TOP_N = 12;

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const monthOf = (date: IsoDate): string => date.slice(0, 7);

/**
 * Centavos in, a written figure out.
 *
 * Everything above is integer centavos, as it must be. `phpFigure` formats
 * pesos, which is the same convention `aiContext.ts` uses, so the conversion
 * happens here at the last moment and nowhere else. Getting this wrong prints
 * PHP 550,000.00 for five and a half thousand, which is exactly the class of
 * mistake the centavos rule exists to prevent.
 */
const php = (centavos: number): string => phpFigure(Number(toPesos(centavos).toFixed(2)));

const monthName = (ym: string): string => {
  const index = Number(ym.slice(5, 7)) - 1;
  return `${MONTH_NAMES[index] ?? ym} ${ym.slice(0, 4)}`;
};

/**
 * A binned row is not part of the ledger.
 *
 * `Transaction` has no `deletedAt`: a binned row is a `DeletedTransaction`
 * and lives in a separate list, so the caller never passes one in. This is
 * the belt to that braces, for the day one is passed anyway.
 */
const live = (t: Transaction): boolean =>
  !(t as Transaction & { deletedAt?: string }).deletedAt;

/**
 * What counts as spending: the app's own definition, not a third one.
 *
 * ── The copy this replaces, and why it was wrong twice ────────────────────
 *
 * This file kept its own version, and it disagreed with `costOf` in both
 * directions at once. It counted a Spending row whose category is blank,
 * which the app ignores, and it ignored debt interest and fees, which the
 * app counts. On three rows the app totals PHP 288.79 and the copy totalled
 * PHP 1,099.00.
 *
 * It looked correct because the Excel fixture exercises neither case: it has
 * no blank-category Spending rows, and its Debt rows are created by a
 * migration that runs in the app rather than in the fixture. So every test
 * passed while the figures the model was given disagreed with every screen
 * the owner could see.
 *
 * This is the same mistake `charts.ts` made, and the same PHP 13,128.00
 * over-count, in a third file. One definition, imported, is the only way it
 * stops happening.
 */
const spendingOf = costOf;

/**
 * Money in, matching `totalsFor` rather than `totalRevenue`.
 *
 * The two differ: `totalRevenue` reproduces the workbook's SUMMARY!D5 and
 * sums `amount`, while `totalsFor` sums `total` and is what the Dashboard
 * and Insights show. The model should quote what the owner can see on
 * screen, so it follows `totalsFor`.
 */
const revenueOf = incomeOf;

interface Group {
  amount: number;
  count: number;
}

function tally(rows: readonly Transaction[], key: (t: Transaction) => string): [string, Group][] {
  const groups = new Map<string, Group>();
  for (const row of rows) {
    const name = key(row) || "(blank)";
    const spent = spendingOf(row);
    if (spent === 0) continue;
    const found = groups.get(name) ?? { amount: 0, count: 0 };
    found.amount += spent;
    found.count += 1;
    groups.set(name, found);
  }
  return [...groups.entries()].sort((a, b) => b[1].amount - a[1].amount);
}

/**
 * The months a question is about.
 *
 * "why did spending go up from april to may" names two, and both of their
 * breakdowns are worth sending. Nothing named means the question is about now.
 */
export function monthsNamedIn(question: string, year: string): string[] {
  const found: string[] = [];
  const lower = question.toLowerCase();

  MONTH_NAMES.forEach((name, index) => {
    if (new RegExp(`\\b${name.toLowerCase()}\\b`).test(lower)) {
      const yearMatch = /\b(20\d{2})\b/.exec(question);
      found.push(`${yearMatch?.[1] ?? year}-${String(index + 1).padStart(2, "0")}`);
    }
  });

  return [...new Set(found)];
}

/** One row, as short as it can be while still answering questions about it. */
function line(t: Transaction): string {
  const parts = [
    `#${t.recordNumber}`,
    t.date,
    t.type,
    t.fromWallet || "-",
    t.toWallet || "-",
    t.category || "-",
    t.item || "-",
    php(t.amount),
  ];
  if (t.fee > 0) parts.push(`fee ${php(t.fee)}`);
  if (t.description.trim()) parts.push(`"${t.description.trim()}"`);
  return parts.join(" | ");
}

export interface ChatContextInput {
  readonly snapshot: AiContext;
  readonly transactions: readonly Transaction[];
  readonly asOf: IsoDate;
  /** Used only to decide which months and rows are worth sending first. */
  readonly question: string;
  readonly maxRowBytes?: number;
  /**
   * The credit lines, so debt can be answered rather than quoted.
   *
   * Optional, because the fixture path and several tests build a context
   * without them and a missing list is a missing section, not an error.
   */
  readonly credits?: readonly Debt[];
  /**
   * Every month's budget, so "did I budget well since I started" is answered
   * from each month against its own budget, not from this month alone.
   */
  readonly budgets?: Budgets | undefined;
  /** Bills and subscriptions stopped in Settings, which the months ahead leave out. */
  readonly stopped?: readonly { readonly name: string; readonly since: IsoDate }[] | undefined;
  /**
   * What the owner has open while asking (`domain/screenContext.ts`), put
   * first so "what do you think" is about the screen they are looking at.
   */
  readonly screen?: string | undefined;
}

export interface ChatContext {
  readonly text: string;
  /** So the panel can say what was sent, if it ever needs to. */
  readonly rowsIncluded: number;
  readonly rowsTotal: number;
}

/**
 * Build the whole thing: the snapshot, the worked-out totals, then the rows.
 *
 * Pure. Given the same ledger and question it returns the same string, which
 * is what makes it reviewable: print it and you know exactly what a provider
 * would receive.
 */
export function buildChatContext(input: ChatContextInput): ChatContext {
  const { snapshot, transactions, asOf, question } = input;
  const budget = input.maxRowBytes ?? MAX_ROW_BYTES;

  const rows = transactions.filter(live);
  const year = asOf.slice(0, 4);
  const thisYear = rows.filter((t) => t.date.startsWith(year));

  const out: string[] = [...(input.screen ? [input.screen, ""] : []), contextToText(snapshot), ""];

  // ── The ledger, described ────────────────────────────────────────────────
  const dates = rows.map((t) => t.date).sort();
  out.push("## The ledger");
  out.push(
    `${rows.length} entries, ${dates[0] ?? "none"} to ${dates[dates.length - 1] ?? "none"}. Every total below is worked out from them and is correct.`,
  );

  // ── Every month, with counts ─────────────────────────────────────────────
  const byMonth = new Map<string, { spent: number; revenue: number; count: number }>();
  for (const t of rows) {
    const key = monthOf(t.date);
    const found = byMonth.get(key) ?? { spent: 0, revenue: 0, count: 0 };
    found.spent += spendingOf(t);
    found.revenue += revenueOf(t);
    found.count += 1;
    byMonth.set(key, found);
  }

  /*
   * Each month against its own budget, where one was set: "so since starting
   * I didnt have good budgeting?", 28 September 2026, was answered from
   * September alone. The figure set against the budget is the Budget
   * screen's (`assessMonthFor`), which counts fees and interest with spending.
   */
  const budgetKept = new Map<string, { within: number; over: number }>();
  const budgetWords = (key: string): string => {
    if (!input.budgets) return "";
    const [y, mo] = [Number(key.slice(0, 4)), Number(key.slice(5, 7))];
    const a = assessMonthFor(rows, input.budgets, y, mo).combined;
    if (a.budget <= 0) return "";
    const tally = budgetKept.get(key.slice(0, 4)) ?? { within: 0, over: 0 };
    if (a.spent > a.budget) tally.over += 1;
    else tally.within += 1;
    budgetKept.set(key.slice(0, 4), tally);
    return a.spent > a.budget
      ? `, budget ${php(a.budget)}, over by ${php(a.spent - a.budget)}`
      : `, budget ${php(a.budget)}, within it by ${php(a.budget - a.spent)}`;
  };

  if (byMonth.size > 0) {
    out.push("");
    out.push("## Every month in the ledger");
    for (const [key, m] of [...byMonth.entries()].sort()) {
      out.push(
        `${monthName(key)}: spent ${php(m.spent)}, received ${php(m.revenue)}, ${m.count} entries${budgetWords(key)}`,
      );
    }
  }

  /*
   * ── Every year, added up ─────────────────────────────────────────────────
   *
   * "summary per year", 27 September 2026, was answered "I do not have a
   * yearly total; the ledger only provides monthly figures", followed by a
   * list of months. The sums are the app's, from the months above, so a
   * year's figure is never the model's own addition. A year the ledger only
   * partly covers says so, and its monthly average is over the months it has.
   */
  const byYear = new Map<string, { spent: number; revenue: number; count: number; months: string[] }>();
  for (const [key, m] of byMonth) {
    const y = key.slice(0, 4);
    const found = byYear.get(y) ?? { spent: 0, revenue: 0, count: 0, months: [] };
    found.spent += m.spent;
    found.revenue += m.revenue;
    found.count += m.count;
    found.months.push(key);
    byYear.set(y, found);
  }
  const budgetYear = (y: string): string => {
    const k = budgetKept.get(y);
    if (!k) return input.budgets ? ", no budget set in any month" : "";
    return `, ${k.within} of ${k.within + k.over} budgeted ${k.within + k.over === 1 ? "month" : "months"} within budget`;
  };
  if (byYear.size > 1) {
    out.push("");
    out.push("## Every year in the ledger");
    for (const [y, t] of [...byYear.entries()].sort()) {
      const months = [...t.months].sort();
      const first = months[0] ?? "";
      const last = months[months.length - 1] ?? "";
      const part =
        y === year ? ` (to date, ${monthName(first)} to ${monthName(last)})` : months.length < 12 ? ` (${monthName(first)} to ${monthName(last)} only)` : "";
      const net = t.revenue - t.spent;
      out.push(
        `${y}${part}: spent ${php(t.spent)}, received ${php(t.revenue)}, ${net >= 0 ? "kept" : "spent more than received by"} ${php(Math.abs(net))}, ${t.count} entries, spent ${php(Math.round(t.spent / Math.max(1, months.length)))} a month on average over ${months.length} ${months.length === 1 ? "month" : "months"}${budgetYear(y)}`,
      );
    }
  }

  /**
   * ── The months ahead, as the Budget screen plans them ────────────────────
   *
   * Asked for a recommended budget for next month on 26 September 2026, the
   * model said "I do not have a recommended budget figure for next month
   * because no budget amount for the upcoming period is present in the data",
   * and a minute later, to the same question, invented one from September's
   * total. Both were the model working without the figure.
   *
   * On 28 September the forecast it was then given was replaced: a weighted
   * three months with a trend on top turned one big order into every month
   * after it. What is sent now is the Budget screen's own forecast
   * (`domain/outlook.ts`): the owner's usual month for each of the next
   * three, what usually comes in, the debt due, the budget already set, and
   * what last year's same month held. The chat, the Budget screen and "use
   * the forecast" read the same figures, so none of them can disagree.
   */
  const [asOfYear, asOfMonth] = [Number(asOf.slice(0, 4)), Number(asOf.slice(5, 7))];
  const ahead = outlookAhead(rows, input.budgets ?? {}, asOf, 3, { stopped: input.stopped ?? [], debts: input.credits ?? [] });
  out.push("");
  out.push("## The months ahead, as the app plans them");
  if (ahead[0] && ahead[0].read.length > 0 && ahead[0].total > 0) {
    for (const fact of outlookFacts(ahead, php)) out.push(fact);
    out.push(
      `When asked what budget to set for one of these months, recommend its usual month (spending and bills and subscriptions, as above), say it is the app's plan from the usual month, and mention the figure for a month where a one-off comes up. Debt payments due are money needed on top, not part of the budget.`,
    );
  } else {
    out.push("No plan: the ledger has no months of spending to base one on yet. Say so if asked for a budget.");
  }

  /**
   * ── Each item this month, against its own last three months ─────────────
   *
   * A figure means nothing without something to measure it against, and
   * "high" said without one is a word, not a finding. The totals by month
   * were here; what each kind of spending usually costs was not, so "Treat is
   * up" could only be said by adding months up, which the model must never
   * do. Worked out here, per item, with the months it had none.
   */
  const monthKey = (back: number): string => {
    const index = asOfYear * 12 + (asOfMonth - 1) - back;
    return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
  };
  const previous = [monthKey(1), monthKey(2), monthKey(3)];
  const nowRows = rows.filter((t) => monthOf(t.date) === monthKey(0));
  const nowByItem = tally(nowRows, (t) => t.item).slice(0, TOP_N);
  if (nowByItem.length > 0) {
    out.push("");
    out.push(`## ${monthName(monthKey(0))} so far, each item against its last three months`);
    out.push(
      "Use these for any claim that a figure is high, low or unusual, and say what it was compared with. An item with fewer than two of those months behind it has too little history to call anything.",
    );
    for (const [name, g] of nowByItem) {
      const before = previous.map((key) =>
        rows.filter((t) => monthOf(t.date) === key && (t.item || "(blank)") === name).reduce((sum, t) => sum + spendingOf(t), 0),
      );
      const seen = before.filter((v) => v > 0).length;
      const average = Math.round(before.reduce((a, b) => a + b, 0) / previous.length);
      out.push(
        `${name}: ${php(g.amount)} now. ${previous
          .map((key, i) => `${monthName(key)} ${php(before[i] ?? 0)}`)
          .join(", ")}, an average of ${php(average)} a month${seen === 0 ? ". New this month" : seen === 1 ? ". Only one of those months had any" : ""}.`,
      );
    }

    // What produced the month: its largest single entries, so a total can be explained by its rows.
    const largest = [...nowRows].filter((t) => spendingOf(t) > 0).sort((a, b) => spendingOf(b) - spendingOf(a)).slice(0, 5);
    if (largest.length > 0) {
      out.push("");
      out.push(`## ${monthName(monthKey(0))}, the largest single entries`);
      for (const t of largest) {
        out.push(`#${String(t.recordNumber).padStart(4, "0")} ${t.date} ${t.item || t.category || t.type}: ${php(spendingOf(t))}${t.description.trim() ? `, "${t.description.trim()}"` : ""}`);
      }
    }
  }

  /**
   * ── Days and weeks, because months were the smallest thing it had ──────
   *
   * Asked how the week was going, it answered: "This week is not separated
   * out in the entries, so I do not have a clean cut for it." That reads as
   * the ledger being incomplete, and it is not: every row has a date. What
   * was missing was this section.
   *
   * It could not work the window out for itself either, and should not try.
   * The prompt tells it to use the totals given and never to add anything up,
   * because arithmetic over five hundred rows is exactly what a small model
   * gets wrong, and a wrong figure in a financial answer is worse than no
   * answer. So the windows are counted here, in integer centavos, like every
   * other total in this file.
   *
   * The week runs Monday to Sunday, which is what "this week" means to
   * someone looking at a calendar, and the rolling windows are there for
   * "the last few days", which means something different again.
   */
  const since = (from: IsoDate, to: IsoDate = asOf) =>
    rows.filter((t) => t.date >= from && t.date <= to);

  const windowLine = (label: string, from: IsoDate, to: IsoDate = asOf): string => {
    const inWindow = since(from, to);
    const spent = inWindow.reduce((sum, t) => sum + spendingOf(t), 0);
    const got = inWindow.reduce((sum, t) => sum + revenueOf(t), 0);
    const when = from === to ? formatMedium(from) : `${from} to ${to}`;
    return `${label} (${when}): spent ${php(spent)}, received ${php(got)}, ${inWindow.length} entries`;
  };

  // Monday as the first day. `dayOfWeek` returns 0 for Sunday.
  const weekday = dayOfWeek(asOf);
  const monday = addDays(asOf, -((weekday + 6) % 7));
  const lastMonday = addDays(monday, -7);

  out.push("");
  out.push("## Recent windows, already worked out");
  out.push("Use these exactly. They are the answer to anything about a day or a week.");
  out.push(windowLine("Today", asOf));
  out.push(windowLine("Yesterday", addDays(asOf, -1), addDays(asOf, -1)));
  out.push(windowLine("This week, Monday to now", monday));
  out.push(windowLine("Last week, Monday to Sunday", lastMonday, addDays(monday, -1)));
  out.push(windowLine("The last 7 days", addDays(asOf, -6)));
  out.push(windowLine("The last 30 days", addDays(asOf, -29)));

  /**
   * The fortnight, day by day.
   *
   * "Which day did I spend the most" and "what happened on Tuesday" are
   * ordinary questions that a month total cannot answer and that the rows
   * can, but only if the model counts, which it must not. Fourteen lines is
   * a fortnight, which covers every way somebody says "recently".
   */
  const daily: string[] = [];
  for (let back = 0; back < 14; back += 1) {
    const day = addDays(asOf, -back);
    const onDay = rows.filter((t) => t.date === day);
    if (onDay.length === 0) continue;
    const spent = onDay.reduce((sum, t) => sum + spendingOf(t), 0);
    const got = onDay.reduce((sum, t) => sum + revenueOf(t), 0);
    daily.push(`${day}: spent ${php(spent)}, received ${php(got)}, ${onDay.length} entries`);
  }
  if (daily.length > 0) {
    out.push("");
    out.push("## The last fortnight, day by day");
    out.push(...daily);
  }

  /**
   * ── The window the question names, whatever it is ──────────────────────
   *
   * "what if I ask today only, or this week, or a range" (26 September
   * 2026). Today, the week and the months were worked out; "Sep 1 to 15",
   * "the last 10 days" and "since August" were not, and the model would have
   * had to add rows up to answer, which it must never do. The same reading
   * the charts use, so a chart and an answer about one window always agree.
   */
  if (question && namesWindow(question)) {
    const w = windowOf(question, asOf);
    const inWindow = rows.filter((t) => t.date >= w.from && t.date <= w.to);
    if (inWindow.length > 0) {
      const spent = inWindow.reduce((sum, t) => sum + spendingOf(t), 0);
      const got = inWindow.reduce((sum, t) => sum + revenueOf(t), 0);
      out.push("");
      out.push(`## The window asked about: ${w.name}${w.from > "1000" && w.to < "9000" ? ` (${w.from} to ${w.to})` : ""}`);
      out.push(`Spent ${php(spent)}, received ${php(got)}, ${inWindow.length} entries. Use these for anything about this window.`);
      for (const [name, g] of tally(inWindow, (t) => t.item).slice(0, 8)) {
        out.push(`${name}: ${php(g.amount)} over ${g.count} entries`);
      }
    }
  }

  /*
   * ── Where the money came from and went ──────────────────────────────────
   *
   * "where do the funds even coming from?" was answered with three income
   * rows that did not add up to the total it quoted, and "no credit entries
   * this month" beside two Maya Credit draws (28 September 2026). Every
   * movement into and out of the spending wallets, grouped by what it was,
   * worked out here so the parts add up (`moneyFlow.ts`). For the window the
   * question names, or this month.
   */
  {
    const pool = input.snapshot.balances.filter((b) => (b.kind ?? "spending") === "spending").map((b) => b.account);
    const w = question && namesWindow(question) ? windowOf(question, asOf) : null;
    const month = monthOf(asOf);
    const from = w && w.from > "1000" ? w.from : `${month}-01`;
    const to = w && w.to < "9000" ? (w.to > asOf ? asOf : w.to) : asOf;
    if (pool.length > 0) {
      const flow = moneyFlow(rows, pool, from, to, input.credits ?? []);
      if (flow.totalIn + flow.totalOut > 0) {
        out.push("");
        out.push(`## Where the money came from and went: ${w && w.from > "1000" ? w.name : monthName(month)} (${from} to ${to})`);
        out.push(...flowWords(flow, php));
      }
    }

    /*
     * ── Why a month is over its budget ────────────────────────────────────
     * Each item against its usual month, the same median the budget advice
     * uses (`budgetAdvice.ts`, `whyOver`). For this month, or the one named.
     */
    const named = monthsNamedIn(question, year);
    const target = named.length === 1 && named[0] ? named[0] : month;
    const [ty, tm] = [Number(target.slice(0, 4)), Number(target.slice(5, 7))];
    if (input.budgets && ty && tm) {
      const budget = budgetForMonth(input.budgets, ty, tm);
      const why = whyOver(rows, budget, ty, tm, asOf);
      if (why.length > 0) {
        out.push("");
        out.push(`## ${monthName(target)} against its budget, and why`);
        out.push(...why);
      }
    }
  }

  /*
   * ── Bills and subscriptions, month by month ─────────────────────────────
   * "billing history": what was paid for each, when, for the last twelve
   * months. Trimmed early unless the question is about bills.
   */
  {
    const since = `${Number(year) - 1}-${asOf.slice(5, 7)}-01`;
    const paid = rows
      .filter((t) => t.type === "Spending" && (t.category === "Bills" || t.category === "Subscriptions") && t.date >= since && t.date <= asOf)
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    if (paid.length > 0) {
      const aboutBills = /\b(bills?|billing|subscriptions?|subs|wifi|internet|postpaid|prepaid|netflix|spotify|office|drive|utilit\w*|electric\w*|water|due)\b/i.test(question);
      const byItem = new Map<string, Transaction[]>();
      for (const t of paid) byItem.set(t.item.trim() || t.category, [...(byItem.get(t.item.trim() || t.category) ?? []), t]);
      out.push("");
      out.push(aboutBills ? "## Bills and subscriptions, paid month by month (asked about)" : "## Bills and subscriptions, paid month by month");
      for (const [item, list] of byItem) {
        out.push(`${item} (${list[0]?.category ?? ""}): ${list.slice(0, 12).map((t) => `${formatMedium(t.date)} ${php(t.total)} from ${t.fromWallet || "?"}`).join("; ")}.`);
      }
      const stopped = input.snapshot.bills.stopped ?? [];
      if (stopped.length > 0) out.push(`Marked stopped in Settings, no longer expected: ${stopped.join(", ")}.`);
    }
  }

  /**
   * ── What if: the figures after a purchase that has not happened ─────────
   *
   * "can I buy a 25k phone", "what if I spend 10000 tonight". Answering
   * needs what would be left, and that is subtraction, which the model must
   * not do. So the app does it: the month's budget, what is left of it a day,
   * and net worth, each after the amount named.
   */
  /*
   * Money coming in is not a purchase. "if I only expect 8000 allowance"
   * says "if i" and holds a figure, and was worked out as PHP 8,000.00 spent.
   */
  const incomeTalk =
    /\b(expect\w*|allowance|salary|sahod|income|earn\w*|receiv\w*|get paid|coming in)\b/i.test(question) &&
    !/\b(buy|spend|afford|pay for|purchase)\b/i.test(question);
  const hypothetical = !incomeTalk && /\b(what if|if i|can i (?:afford|buy|spend|pay|get)|should i (?:buy|spend|get|pay)|afford)\b/i.test(question);
  const amounts = hypothetical
    ? figuresIn(question.replace(/\b20\d{2}\b/g, " ").replace(/(\d+(?:\.\d+)?)\s*k\b/gi, (_m, n: string) => String(Math.round(Number(n) * 1000))))
    : [];
  const what = amounts.length > 0 ? Math.max(...amounts) : 0;
  if (what > 0) {
    const snap = input.snapshot;
    /*
     * The snapshot is in pesos and `what` is centavos.
     *
     * 28 September 2026: "what budget do you recommend for October if I only
     * expect 8000 allowance?" reads as a what if ("if i"), and the budget
     * left, PHP -6,580.71 in pesos, less 800,000 centavos went to `php` as
     * a fraction of a centavo. It threw, the question was never sent, and
     * nothing was said, five times. Every figure is brought back to
     * centavos first, and the arithmetic stays in centavos.
     */
    const cents = (p: number): number => toCentavos(p);
    out.push("");
    out.push(`## What if ${php(what)} is spent now`);
    out.push("Worked out by the app. Quote these rather than subtracting anything yourself.");
    if (snap.month.budget !== null && snap.month.remaining !== null) {
      const left = cents(snap.month.remaining);
      const after = left - what;
      out.push(
        `${snap.month.name}'s budget: ${left < 0 ? `${php(-left)} over` : `${php(left)} left`} before, ${after < 0 ? `${php(-after)} over` : `${php(after)} left`} after.${
          snap.month.daysLeft > 0 && after > 0 ? ` That is ${php(Math.floor(after / snap.month.daysLeft))} a day for the ${snap.month.daysLeft} days left.` : ""
        }`,
      );
    }
    const worth = cents(snap.netWorth);
    out.push(`Net worth after debt: ${php(worth)} before, ${php(worth - what)} after.`);
    for (const b of snap.balances) {
      if (new RegExp(`\\b${b.account.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(question.toLowerCase())) {
        const had = cents(b.balance);
        out.push(`${b.account}: ${php(had)} before, ${php(had - what)} after.`);
      }
    }
  }

  // ── Breakdowns for the months that matter ────────────────────────────────
  const named = monthsNamedIn(question, year);
  const wanted = [...new Set([...named, monthOf(asOf)])];
  for (const key of wanted) {
    const inMonth = rows.filter((t) => monthOf(t.date) === key);
    if (inMonth.length === 0) continue;

    out.push("");
    out.push(`## ${monthName(key)}, spending by item`);
    for (const [name, g] of tally(inMonth, (t) => t.item).slice(0, TOP_N)) {
      out.push(`${name}: ${php(g.amount)} over ${g.count} entries`);
    }

    out.push(`## ${monthName(key)}, spending by category`);
    for (const [name, g] of tally(inMonth, (t) => t.category)) {
      out.push(`${name}: ${php(g.amount)} over ${g.count} entries`);
    }
  }

  // ── The year, ranked ─────────────────────────────────────────────────────
  if (thisYear.length > 0) {
    out.push("");
    out.push(`## ${year}, spending by item`);
    for (const [name, g] of tally(thisYear, (t) => t.item).slice(0, TOP_N)) {
      out.push(`${name}: ${php(g.amount)} over ${g.count} entries`);
    }

    out.push("");
    out.push(`## ${year}, spending by wallet`);
    for (const [name, g] of tally(thisYear, (t) => t.fromWallet)) {
      out.push(`${name}: ${php(g.amount)} over ${g.count} entries`);
    }
  }

  /**
   * ── The debt, as its movements and not just its total ──────────────────
   *
   * The owner asked their Maya Credit to be checked draw by draw and got
   * nowhere, and said plainly that debt in the assistant does not work. It
   * did not. The whole of what it knew was one line:
   *
   *   Maya Credit (I owe): PHP 2,950.00
   *
   * That figure cannot answer why it is that figure. "Check every draw and
   * repayment", "how much have I actually borrowed", "does this balance" all
   * need the movements, and the movements were never sent. Nothing was broken
   * in the reading: there was nothing to read.
   *
   * The arithmetic is printed alongside, because it is the part people get
   * wrong about credit and the part this ledger is opinionated about:
   * interest is an expense and never reduces the principal, so a PHP 2,688.79
   * payment against a PHP 2,500.00 draw clears PHP 2,500.00 and books
   * PHP 188.79 as interest. Spelling that out stops the model reconstructing
   * a different rule from the totals.
   */
  const credits = input.credits ?? [];
  if (credits.length > 0) {
    const positions = positionsOf(credits, rows, asOf);
    out.push("");
    /*
     * The credit history is the first thing trimmed when a request must
     * shrink, unless the question is about credit: then it is kept whole
     * (`functions/api/ai.ts`, EXPENDABLE matches only this heading).
     */
    const aboutCredit = /\b(credits?|debts?|loans?|utang|borrow\w*|owe|owed|owing|lend\w*|lent|interest|pay ?back|repay\w*|on behalf|held for|charges?)\b/i.test(question);
    out.push(aboutCredit ? "## Credit history, every movement (asked about)" : "## Debt, every movement");
    out.push(
      "outstanding = drawn + charged - repaid - written off. A charge is a fee, tax or interest the lender added to what is owed: it is spending on the day it was added, and the payment that clears it is not spending again. Interest paid from a wallet is spending and never reduces what is owed. A debt marked on behalf is money advanced for someone or held for someone: it is not a loan, and none of it is income or spending until it is written off (then spending) or retained (then income).",
    );

    for (const p of positions) {
      out.push("");
      out.push(
        `### ${p.debt.name} (${
          p.debt.form === "pass-through"
            ? p.debt.kind === "payable"
              ? "on behalf: money I hold for someone"
              : "on behalf: money I advanced for someone, to be reimbursed"
            : p.debt.kind === "payable"
              ? "I owe this"
              : "owed to me"
        })`,
      );
      out.push(
        `Drawn ${php(p.drawn)}, charged ${php(p.charged)}, repaid ${php(p.repaid)}, interest paid ${php(
          p.interestPaid,
        )}, written off ${php(p.writtenOff)}.`,
      );
      out.push(
        `Outstanding ${php(p.outstanding)} = ${php(p.drawn)} + ${php(p.charged)} - ${php(p.repaid)} - ${php(
          p.writtenOff,
        )}. ${p.transactionCount} movements, ${p.repaymentCount} of them repayments.`,
      );
      // The next payment as the Debt screen works it out, not only a fixed date nothing sets.
      const due = debtDue(p, rows, asOf);
      if (p.outstanding > 0 && due.nextDue && due.daysToDue !== undefined) {
        out.push(
          `Next payment ${php(due.amountDue || p.outstanding)} due ${due.nextDue}: ${
            due.daysToDue < 0 ? `${Math.abs(due.daysToDue)} days late` : due.daysToDue === 0 ? "today" : `in ${due.daysToDue} days`
          }.`,
        );
      }
      // Its limit, for a credit line whose lender sets one (domain/creditLimit.ts).
      const room = creditRoom(p.debt, rows, asOf);
      if (room) {
        const steps = limitSteps(p.debt);
        out.push(
          `Credit limit ${php(room.limit)}, counting ${room.counts === "borrowed" ? "only what was borrowed" : "everything owed, fees too"}: ${php(
            room.used,
          )} used, ${php(room.available)} left to borrow${room.over > 0 ? `, ${php(room.over)} past the limit` : room.state === "reached" ? ", limit reached" : room.state === "near" ? ", close to the limit" : ""}.${
            steps.length > 1 ? ` The limit over time: ${steps.map((st) => `${php(st.amount)} from ${st.from}`).join(", ")}.` : ""
          }`,
        );
      }

      const movements = rowsFor(rows, p.debt.id);
      if (movements.length > 0) {
        out.push("Every movement, oldest first: date | what it does | amount | wallet");
        for (const m of movements) {
          out.push(
            `${m.date} | ${m.debtEffect ?? "unspecified"} | ${php(m.amount)} | ${
              m.fromWallet || m.toWallet || "no wallet"
            }${m.description ? ` | ${m.description}` : ""}`,
          );
        }
      } else {
        out.push("No movements are filed against it, so the figure above comes from nothing.");
      }
    }
  }

  // ── The rows themselves ──────────────────────────────────────────────────
  //
  // Ordered by what the question is about, then by recency, so a budget that
  // does run out drops the least relevant rather than the oldest.
  // The months the question actually named, not the current one, which is
  // always in `wanted` and would otherwise outrank the month being asked about.
  const relevant = new Set(named.length > 0 ? named : wanted);
  const ordered = [...rows].sort((a, b) => {
    const aWanted = relevant.has(monthOf(a.date)) ? 1 : 0;
    const bWanted = relevant.has(monthOf(b.date)) ? 1 : 0;
    if (aWanted !== bWanted) return bWanted - aWanted;
    return a.date < b.date ? 1 : a.date > b.date ? -1 : b.recordNumber - a.recordNumber;
  });

  const encoder = new TextEncoder();
  const kept: string[] = [];
  let spent = 0;

  for (const row of ordered) {
    const text = line(row);
    const size = encoder.encode(text).length + 1;
    if (spent + size > budget) break;
    kept.push(text);
    spent += size;
  }

  out.push("");
  out.push("## Entries");
  out.push(
    kept.length === rows.length
      ? "All of them, newest first. You can count these and list them."
      : `${kept.length} of ${rows.length}, the ones nearest the question first. Say so if a count would need the rest.`,
  );
  out.push("Format: number | date | type | from | to | category | item | amount | fee | description");
  out.push(...kept);

  return {
    // One redaction pass over everything, including the snapshot, in case a
    // key ever reached a description or an item name.
    text: redact(out.join("\n")),
    rowsIncluded: kept.length,
    rowsTotal: rows.length,
  };
}
