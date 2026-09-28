/**
 * "Export my data", said to the assistant.
 *
 * The owner, 20 September 2026: the assistant should do every part, export
 * included. It could add, correct, bin, restore and investigate, and it could
 * not hand over a file: for that the owner had to know that a backup lives on
 * Settings, a CSV of everything lives beside it, and a statement for one month
 * lives on a third screen.
 *
 * Asking for it in words is the point of the assistant, so this reads the
 * sentence into which file is wanted, and `AskPanel` offers the button that
 * writes it. Nothing here downloads anything: the reading and the doing stay
 * apart, as everywhere else.
 *
 * ── What it deliberately does not do ──────────────────────────────────────
 *
 * It never sends a file anywhere. An export lands on the owner's own device
 * through the browser's own download, the same way the buttons on Settings
 * and Statements do it, because this file is the whole financial history and
 * the only safe destination for it is the machine it was asked for on.
 */

import { getMonth, getYear, monthName } from "./dates";
import { describeRange } from "./dayRange";
import { spanIn } from "./periodIn";
import type { StatementType } from "./statements";
import type { IsoDate } from "./types";

export type ExportKind =
  /** Everything, as the JSON file a restore reads back. */
  | "backup"
  /** Everything, as a spreadsheet. */
  | "csv"
  /** One period, as a statement. */
  | "statement";

export interface ExportAsk {
  readonly kind: ExportKind;
  /** Statements only: which sheet. */
  readonly type?: StatementType;
  readonly year: number;
  /** Statements only, 1 to 12. */
  readonly fromMonth?: number;
  readonly toMonth?: number;
  /**
   * Statements only: the year the last month is in, when it is not `year`.
   * "january 2025 to june 2026" runs across two.
   */
  readonly toYear?: number;
  /**
   * Statements only. A PDF laid out as the owner's Excel printed one, unless
   * a spreadsheet was asked for by name.
   */
  readonly format?: "pdf" | "csv";
  /**
   * Statements only: the first and last day, when the period is not whole
   * months. "september 1 to 19" was made as September so far (28 September
   * 2026).
   */
  readonly fromDate?: IsoDate;
  readonly toDate?: IsoDate;
  /** What was asked for, in words, for the reply. */
  readonly said: string;
}

/** Asking for a file at all. Without one of these, nothing here applies. */
// A statement is always a file here, so asking for one is asking for a file.
const EXPORTING = /\b(export|exports|exported|download|save|backup|back\s?up|csv|spreadsheet|excel|copy|file|pdf|print|document|statement|statements)\b/i;

/** Words that mean the whole thing rather than a period. */
const EVERYTHING = /\b(everything|all|whole|entire|full|complete|lahat)\b/i;

const BACKUP = /\b(backup|back\s?up|restore|json)\b/i;
const CSV = /\b(csv|spreadsheet|excel|sheet)\b/i;
/** A statement comes out as a PDF unless one of these asks for a spreadsheet. "Sheet" alone does not: "expense sheet" is a statement's name. */
const AS_SPREADSHEET = /\b(csv|spreadsheet|excel)\b/i;

const STATEMENTS: Readonly<Record<string, StatementType>> = {
  account: "account",
  statement: "account",
  revenue: "revenue",
  income: "revenue",
  expense: "expense",
  spending: "expense",
  bills: "bills",
  subscriptions: "bills",
  transfers: "transfers",
  transfer: "transfers",
  savings: "savings",
  borrowed: "borrowed",
  utang: "borrowed",
  lent: "lent",
  credit: "credit",
  debt: "debt",
  loan: "debt",
};

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

/** A month named in the sentence, as 1 to 12. */
function monthIn(text: string): number | null {
  const lower = text.toLowerCase();
  for (const [i, name] of MONTHS.entries()) {
    if (new RegExp(`\\b${name.slice(0, 3)}[a-z]*\\b`, "i").test(lower)) return i + 1;
  }
  return null;
}

/**
 * Read a sentence into the file it is asking for.
 *
 * The order matters: "export my september spending as csv" names a month and
 * a sheet, so it is a statement rather than the whole system, and the CSV is
 * how a statement comes out anyway. Only a request with no period in it, or
 * one that says everything, asks for the whole ledger.
 */
/** Words that ask for a file whatever else is said. */
const FILE_WORDS = /\b(export|exports|exported|download|backup|back\s?up|csv|spreadsheet|excel|pdf|statement|statements)\b/i;
/**
 * "save", "copy", "print", "file" and "document" ask for a file only with
 * something to put in it.
 *
 * 28 September 2026: "which 2 items should I cut first and how much would I
 * save?" was offered the whole system as a spreadsheet, and never answered.
 * Saving money is not saving a file.
 */
const FILE_OBJECT =
  /\b(save|copy|print|file|document)\b[^.?!]{0,30}\b(data|ledger|entries|transactions|records|history|file|files|csv|pdf|spreadsheet|excel|sheet|statement|backup|everything|all of it|chat|conversation)\b|\b(save|copy|print)\s+(?:it|this|that|them)\s+as\b/i;

export function readExportAsk(said: string, asOf: IsoDate): ExportAsk | null {
  const text = said.trim();
  if (!text || !EXPORTING.test(text)) return null;
  if (!FILE_WORDS.test(text) && !FILE_OBJECT.test(text)) return null;

  // "Save 500 on food" is an entry, not an export: a figure with a verb of
  // spending beside it is never a request for a file.
  if (/\b(paid|spent|bought|bayad|gastos|received|natanggap)\b/i.test(text)) return null;

  const year = yearIn(text) ?? getYear(asOf);
  const month = monthIn(text);
  const type = typeIn(text);

  if (BACKUP.test(text) && !CSV.test(text)) {
    return { kind: "backup", year, said: text };
  }

  /*
   * A range of months, across years if it says so. "january 2026 to june
   * 2026" made a statement for January alone: the first month named was
   * taken as the whole period (28 September 2026).
   */
  const span = spanIn(text, asOf);
  if (span && (month !== null || type !== null || /\b20\d{2}\b/.test(text))) {
    const lastOf = (iso: string): string => new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), 0)).toISOString().slice(0, 10);
    // Up to today counts as whole months, said "so far": the statement runs to the end of this one.
    const wholeMonths = span.from.endsWith("-01") && (span.to === lastOf(span.to) || span.to === asOf);
    return {
      kind: "statement",
      type: type ?? "account",
      year: Number(span.from.slice(0, 4)),
      fromMonth: Number(span.from.slice(5, 7)),
      toMonth: Number(span.to.slice(5, 7)),
      toYear: Number(span.to.slice(0, 4)),
      ...(wholeMonths ? {} : { fromDate: span.from, toDate: span.to > asOf ? asOf : span.to }),
      format: AS_SPREADSHEET.test(text) ? "csv" : "pdf",
      said: text,
    };
  }

  // A named month or a named sheet makes it a statement for that period.
  if (month !== null || type !== null) {
    const from = month ?? 1;
    const to = month ?? 12;
    return {
      kind: "statement",
      type: type ?? "account",
      year,
      fromMonth: from,
      toMonth: to,
      format: AS_SPREADSHEET.test(text) ? "csv" : "pdf",
      said: text,
    };
  }

  if (CSV.test(text) || EVERYTHING.test(text)) return { kind: "csv", year, said: text };

  // "Export my data", with nothing else said: the spreadsheet, because it is
  // the one a person can open and read.
  return { kind: "csv", year, said: text };
}

function yearIn(text: string): number | null {
  const match = /\b(20\d{2})\b/.exec(text);
  return match ? Number(match[1]) : null;
}

function typeIn(text: string): StatementType | null {
  const lower = text.toLowerCase();
  for (const [word, type] of Object.entries(STATEMENTS)) {
    // "statement" on its own means the account sheet; a named kind wins.
    if (word !== "statement" && new RegExp(`\\b${word}\\b`, "i").test(lower)) return type;
  }
  return /\bstatement\b/i.test(lower) ? "account" : null;
}

/** What the file will be, in one sentence, for the reply. */
export function exportWords(ask: ExportAsk, asOf: IsoDate): string {
  if (ask.kind === "backup") {
    return "A backup of everything: every entry, the bin, the budgets, the settings and the record of what happened. It restores this system exactly as it is now.";
  }
  if (ask.kind === "csv") {
    return "The whole system as a spreadsheet: every entry, the bin, the budgets and the lists, each on its own sheet.";
  }

  const SHEET: Partial<Record<StatementType, string>> = {
    revenue: "what came in",
    expense: "what went out",
    bills: "every bill and subscription paid",
    transfers: "every transfer, with what each cost",
    savings: "everything touching a savings account",
    debt: "every debt movement, with a running balance",
    borrowed: "every loan and credit line you owe, with the total owed",
    credit: "the credit lines, with the total owed",
    lent: "money you lent, with what is still owed to you",
  };
  const sheet = SHEET[ask.type ?? "account"] ?? "every entry in the period, with the balance after each";

  if (ask.fromDate && ask.toDate) {
    return `A statement for ${describeRange({ start: ask.fromDate, end: ask.toDate })}: ${sheet}, as ${ask.format === "csv" ? "a spreadsheet" : "a PDF"}.`;
  }

  const toYear = ask.toYear ?? ask.year;
  const whole = ask.fromMonth === 1 && ask.toMonth === 12 && toYear === ask.year;
  const period =
    ask.fromMonth === ask.toMonth && ask.fromMonth !== undefined && toYear === ask.year
      ? `${monthName(ask.fromMonth)} ${ask.year}`
      : whole || ask.fromMonth === undefined || ask.toMonth === undefined
        ? `${ask.year}`
        : `${monthName(ask.fromMonth)} ${ask.year} to ${monthName(ask.toMonth)} ${toYear}`;

  const now = getYear(asOf) === toYear && (ask.toMonth ?? 12) === getMonth(asOf) ? ", so far" : "";

  return `A statement for ${period}${now}: ${sheet}, as ${ask.format === "csv" ? "a spreadsheet" : "a PDF"}.`;
}
