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
import { redact } from "./aiRedact";
import { toPesos } from "./money";
import type { IsoDate, Transaction } from "./types";

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
 * What counts as spending, kept in step with the rest of the app.
 *
 * A Transfer with a named destination is money moving between the owner's own
 * pockets, so only its fee is spending. See CLAUDE.md, "Transfers are derived".
 */
const spendingOf = (t: Transaction): number => {
  if (t.type === "Spending") return t.amount + t.fee;
  if (t.type === "Transfer") return t.toWallet.trim() ? t.fee : t.amount + t.fee;
  return 0;
};

const revenueOf = (t: Transaction): number =>
  t.type === "Revenue" && t.category !== "Opening" ? t.amount : 0;

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

  const out: string[] = [contextToText(snapshot), ""];

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

  if (byMonth.size > 0) {
    out.push("");
    out.push("## Every month in the ledger");
    for (const [key, m] of [...byMonth.entries()].sort()) {
      out.push(
        `${monthName(key)}: spent ${php(m.spent)}, received ${php(m.revenue)}, ${m.count} entries`,
      );
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
