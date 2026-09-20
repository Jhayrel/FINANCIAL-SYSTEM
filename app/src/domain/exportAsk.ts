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
  /** What was asked for, in words, for the reply. */
  readonly said: string;
}

/** Asking for a file at all. Without one of these, nothing here applies. */
const EXPORTING = /\b(export|exports|exported|download|save|backup|back\s?up|csv|spreadsheet|excel|copy|file)\b/i;

/** Words that mean the whole thing rather than a period. */
const EVERYTHING = /\b(everything|all|whole|entire|full|complete|lahat)\b/i;

const BACKUP = /\b(backup|back\s?up|restore|json)\b/i;
const CSV = /\b(csv|spreadsheet|excel|sheet)\b/i;

const STATEMENTS: Readonly<Record<string, StatementType>> = {
  account: "account",
  statement: "account",
  revenue: "revenue",
  income: "revenue",
  expense: "expense",
  spending: "expense",
  savings: "savings",
  debt: "debt",
  loan: "debt",
  credit: "debt",
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
export function readExportAsk(said: string, asOf: IsoDate): ExportAsk | null {
  const text = said.trim();
  if (!text || !EXPORTING.test(text)) return null;

  // "Save 500 on food" is an entry, not an export: a figure with a verb of
  // spending beside it is never a request for a file.
  if (/\b(paid|spent|bought|bayad|gastos|received|natanggap)\b/i.test(text)) return null;

  const year = yearIn(text) ?? getYear(asOf);
  const month = monthIn(text);
  const type = typeIn(text);

  if (BACKUP.test(text) && !CSV.test(text)) {
    return { kind: "backup", year, said: text };
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

  const sheet =
    ask.type === "revenue"
      ? "what came in"
      : ask.type === "expense"
        ? "what went out"
        : ask.type === "savings"
          ? "everything touching a savings account"
          : ask.type === "debt"
            ? "every debt movement, with a running balance"
            : "every entry in the period";

  const period =
    ask.fromMonth === ask.toMonth && ask.fromMonth !== undefined
      ? `${monthName(ask.fromMonth)} ${ask.year}`
      : `${ask.year}`;

  const now = getYear(asOf) === ask.year && ask.fromMonth === getMonth(asOf) ? ", so far" : "";

  return `A statement for ${period}${now}: ${sheet}, as a spreadsheet.`;
}
