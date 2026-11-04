/**
 * A PDF this app made, sent back to it.
 *
 * Every statement and the Activity record end in the system's name in the
 * small print and "**Nothing Follows**" (`statementPdf.ts`, `activityPdf.ts`).
 * Sent to the chat, its words went to the model as a new paper to read, and
 * every row in it, already in the ledger, could come back as an entry to add
 * (4 November 2026, trying the PDFs). It is said for what it is instead, on
 * this device, and nothing is added.
 */

export interface OwnFile {
  /** "Expense sheet", "Account statement", "Activity trail". */
  readonly title: string;
  /** "October 2026", as printed. */
  readonly period: string;
  /** How many rows it says it holds, when it prints the count. */
  readonly rows: number | null;
}

const SYSTEM_NAME = "Financial Management System";

const TITLES = [
  "ACCOUNT STATEMENT",
  "WALLET STATEMENT",
  "REVENUE SHEET",
  "EXPENSE SHEET",
  "BILLS AND SUBSCRIPTIONS",
  "TRANSFERS",
  "SAVINGS SHEET",
  "DEBT STATEMENT",
  "EVERYTHING BORROWED",
  "CREDIT CARDS AND LINES",
  "EVERYTHING LENT",
  "ON BEHALF",
  "PLANS",
  "ACTIVITY TRAIL",
] as const;

export function ownFile(text: string): OwnFile | null {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat.includes(SYSTEM_NAME) || !/\*\*Nothing Follows\*\*/.test(flat)) return null;
  const title = TITLES.find((t) => flat.startsWith(t));
  if (!title) return null;
  const period = /\bPeriod\s+(.+?)\s+Date issued\b/.exec(flat)?.[1]?.trim() ?? /\bDate issued\s+(?:.+?\d{1,2}:\d{2}\s*[AP]M)?\s*Period\s+(.+?)\s/.exec(flat)?.[1]?.trim() ?? "";
  const rows = /\b(?:Entries|Changes|Plans)\s+([\d,]+)\b/.exec(flat)?.[1];
  return {
    title: title.charAt(0) + title.slice(1).toLowerCase(),
    period,
    rows: rows ? Number(rows.replace(/,/g, "")) : null,
  };
}

/** What is said back: what the file is, and why nothing was added. */
export function ownFileWords(name: string, file: OwnFile): string {
  const what = `${file.title}${file.period ? `, ${file.period}` : ""}`;
  const rows = file.rows !== null ? ` It lists ${file.rows.toLocaleString("en-US")} ${file.title === "Activity trail" ? (file.rows === 1 ? "change" : "changes") : file.rows === 1 ? "row" : "rows"}.` : "";
  return file.title === "Activity trail"
    ? `${name} is the record of what happened that this app saved (${what}).${rows} It is a copy of Activity, so nothing in it is added. Activity on the menu shows the same, newest first.`
    : `${name} is a statement this app made (${what}).${rows} Everything in it is already in your ledger, so nothing in it is added. To see it again, ask for the same statement or open Statements.`;
}
