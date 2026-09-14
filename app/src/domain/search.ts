/**
 * Searching the ledger the way the workbook's Smart Search did.
 *
 * Module1 `SearchDatabase` read one box and decided what the typing meant.
 * Several words all had to match. ">1000" and "<100" meant an amount over or
 * under. "P500" meant exactly that amount. A number on its own was a record.
 * And today, yesterday, the last 7 days and this month were one tap each.
 *
 * The web search did none of that. It looked for the whole box as one piece
 * of text, so "food gcash" found nothing even though dozens of rows are food
 * paid from Gcash.
 *
 * ── Where this differs from the VBA, on purpose ───────────────────────────
 *
 * - A number on its own still matches amounts as well as records, because
 *   "5000" is how people look for a PHP 5,000.00 row and the search already
 *   did that. "#442" asks for record 442 and nothing else.
 * - "This month" is the whole calendar month, not the 1st to today: an entry
 *   dated ahead, for a bill due later this month, is still this month's.
 * - Amounts are compared in centavos. The VBA compared doubles.
 */

import { parseAmount, type Centavos } from "./money";
import { addDays, getMonth, getYear } from "./dates";
import type { IsoDate, Transaction } from "./types";

export type Period = "all" | "today" | "yesterday" | "week" | "month";

export const PERIODS: readonly { readonly id: Period; readonly label: string }[] = [
  { id: "all", label: "Any date" },
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "week", label: "Last 7 days" },
  { id: "month", label: "This month" },
];

/** Whether a date falls in a period, counted back from `asOf`. */
export function inPeriod(date: IsoDate, period: Period, asOf: IsoDate): boolean {
  switch (period) {
    case "all":
      return true;
    case "today":
      return date === asOf;
    case "yesterday":
      return date === addDays(asOf, -1);
    case "week":
      // Today and the six days before it, as the VBA's Date - 6 to Date.
      return date >= addDays(asOf, -6) && date <= asOf;
    case "month":
      return getYear(date) === getYear(asOf) && getMonth(date) === getMonth(asOf);
  }
}

export type SearchTerm =
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "record"; readonly value: number }
  | { readonly kind: "amount"; readonly op: "eq" | "over" | "under"; readonly value: Centavos };

/** Read what was typed into terms, every one of which must match. */
export function parseSearch(input: string): SearchTerm[] {
  return input
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map(readTerm);
}

const FIGURE = String.raw`(\d[\d,]*(?:\.\d{1,2})?)`;
const RECORD = /^#(\d{1,6})$/;
const RANGE = new RegExp(`^([<>])${FIGURE}$`);
const EXACT = new RegExp(`^(?:php|p|₱)${FIGURE}$`);

function readTerm(word: string): SearchTerm {
  const record = RECORD.exec(word);
  if (record) return { kind: "record", value: Number(record[1]) };

  const range = RANGE.exec(word);
  if (range) {
    const value = parseAmount(range[2]);
    if (value !== null) return { kind: "amount", op: range[1] === ">" ? "over" : "under", value };
  }

  const exact = EXACT.exec(word);
  if (exact) {
    const value = parseAmount(exact[1]);
    if (value !== null) return { kind: "amount", op: "eq", value };
  }

  return { kind: "text", value: word };
}

/** True when the row matches every term. No terms matches every row. */
export function matchesSearch(t: Transaction, terms: readonly SearchTerm[]): boolean {
  return terms.every((term) => matchesTerm(t, term));
}

function matchesTerm(t: Transaction, term: SearchTerm): boolean {
  switch (term.kind) {
    case "record":
      return t.recordNumber === term.value;
    case "amount":
      // Over and under compare what left or arrived in total, fee included,
      // which is the figure the ledger shows in its Total column.
      if (term.op === "over") return t.total > term.value;
      if (term.op === "under") return t.total < term.value;
      return t.amount === term.value || t.fee === term.value || t.total === term.value;
    case "text":
      return matchesText(t, term.value);
  }
}

function matchesText(t: Transaction, word: string): boolean {
  const fields = [
    t.item,
    t.description,
    t.fromWallet,
    t.toWallet,
    t.category,
    t.notes,
    t.status,
    t.type,
    t.date,
  ];
  if (fields.some((field) => field.toLowerCase().includes(word))) return true;
  if (String(t.recordNumber).padStart(4, "0").includes(word)) return true;
  return matchesFigure(t, word);
}

/**
 * A word that looks like money, matched the way it is shown and typed.
 *
 * "5000", "5,000" and "5000.00" all find PHP 5,000.00. The pesos and centavos
 * are split with integer arithmetic, so no figure is ever rounded on the way.
 */
function matchesFigure(t: Transaction, word: string): boolean {
  if (!/\d/.test(word)) return false;
  const wanted = word.replace(/[^\d.]/g, "");
  if (!wanted) return false;

  return [t.amount, t.fee, t.total].some((cents) => {
    const whole = Math.abs(cents);
    const pesos = String(Math.floor(whole / 100));
    const shown = `${pesos}.${String(whole % 100).padStart(2, "0")}`;
    return shown.includes(wanted) || pesos === wanted;
  });
}
