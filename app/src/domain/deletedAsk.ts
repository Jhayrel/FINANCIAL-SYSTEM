/**
 * "I think I deleted a wrong entry": what is in the bin, by date.
 *
 * ── The conversation this exists for ──────────────────────────────────────
 *
 * The owner, 29 September 2026:
 *
 *   I think i deleted a wrong entry
 *     -> "Here are your newest entries. Edit this ... Move to bin ..."
 *   last month?
 *     -> August's spending
 *   //fix this it should know all the deleted by date etc
 *
 * "A wrong entry" was caught by the rule for "my last entry is wrong", which
 * shows the newest saved rows to correct or bin. The question was about rows
 * already in the bin, and nothing in the chat could list them: the bin was
 * reachable only by naming one row to restore, and the model was never told
 * what was in it.
 *
 * So a sentence about having deleted something lists the bin, newest
 * deletion first, each with Restore; a day or a period narrows it, by the day
 * the row was deleted or the day it was for; and a period said alone right
 * after ("last month?") narrows the same list. The model is told the bin too
 * (`binForModel`), so "how many did I delete this month" is answered.
 */

import { addDays, formatMedium } from "./dates";
import { formatMoney } from "./money";
import { spanIn } from "./periodIn";
import type { DeletedTransaction, IsoDate } from "./types";

/** Having deleted, in the past, or the bin itself. Never an instruction to delete. */
const DELETED =
  /\b(?:deleted|i\s+delete|did\s+i\s+delete|have\s+i\s+deleted|binned|removed|nadelete|na-?delete|nabura|binura|tinanggal|in\s+the\s+bin|from\s+the\s+bin|recycle\s+bin|the\s+bin|trash)\b/i;

/** Looking for something in it. */
const LOOKING =
  /\b(?:wrong|mistake|mistaken|accident|accidentally|show|list|what|which|find|see|check|look|tingnan|alin|ano|did\s+i|have\s+i)\b|\?/i;

/** Bringing a named row back is the restore finder's job, which matches on what the row was. */
const RESTORE_ONE = /\b(?:restore|bring\s+back|undelete|recover|put\s+back|unbin|retrieve|ibalik)\b/i;

/** "delete the gas", "remove that": a request to delete, which is not this. */
const ORDER_TO_DELETE = /^\s*(?:please\s+|pls\s+|can\s+you\s+|could\s+you\s+)?(?:delete|remove|bin|erase|trash)\b/i;

export function asksAboutDeleted(text: string): boolean {
  const t = text.trim();
  if (!t || ORDER_TO_DELETE.test(t)) return false;
  if (RESTORE_ONE.test(t) && !/\b(?:what|which|show|list|everything|all)\b/i.test(t)) return false;
  return DELETED.test(t) && LOOKING.test(t);
}

export interface DeletedWindow {
  readonly from: IsoDate;
  readonly to: IsoDate;
  readonly name: string;
}

const mondayOf = (d: IsoDate): IsoDate => addDays(d, -((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7));

/** The day or period a sentence names, relative ones included: "yesterday", "last week", "last month". */
export function deletedWindowIn(text: string, asOf: IsoDate): DeletedWindow | null {
  const t = text.toLowerCase();
  const year = Number(asOf.slice(0, 4));
  const month = Number(asOf.slice(5, 7));
  const pad = (n: number): string => String(n).padStart(2, "0");
  const lastDay = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();

  if (/\b(?:today|ngayon)\b/.test(t)) return { from: asOf, to: asOf, name: "today" };
  if (/\b(?:yesterday|kahapon)\b/.test(t)) {
    const d = addDays(asOf, -1);
    return { from: d, to: d, name: "yesterday" };
  }
  if (/\bthis\s+week\b/.test(t)) return { from: mondayOf(asOf), to: asOf, name: "this week" };
  if (/\b(?:last|past|previous)\s+week\b|\bnoong\s+isang\s+linggo\b/.test(t)) {
    const start = addDays(mondayOf(asOf), -7);
    return { from: start, to: addDays(start, 6), name: "last week" };
  }
  const days = /\b(?:last|past)\s+(\d{1,3})\s+days?\b/.exec(t);
  if (days?.[1]) return { from: addDays(asOf, -(Number(days[1]) - 1)), to: asOf, name: `the last ${days[1]} days` };
  if (/\bthis\s+month\b/.test(t)) return { from: `${year}-${pad(month)}-01`, to: asOf, name: "this month" };
  if (/\b(?:last|previous)\s+month\b|\bnakaraang\s+buwan\b/.test(t)) {
    const y = month === 1 ? year - 1 : year;
    const m = month === 1 ? 12 : month - 1;
    return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(lastDay(y, m))}`, name: "last month" };
  }
  const span = spanIn(text, asOf);
  if (span) return { from: span.from, to: span.to, name: span.name };

  // One month, with or without its year: "september", "sa august", "march 2024".
  const named = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b(?:\s+((?:19|20)\d{2}))?/.exec(t);
  // "may" alone is Tagalog as often as it is May.
  if (named?.[1] && !(named[1] === "may" && !named[2])) {
    const m = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(named[1].slice(0, 3)) + 1;
    const y = named[2] ? Number(named[2]) : m > month ? year - 1 : year;
    const names = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(lastDay(y, m))}`, name: `in ${names[m - 1]} ${y}` };
  }
  return null;
}

/** A period said on its own, with nothing else asked: "last month?", "yesterday", "sa september". */
export function onlyAWindow(text: string, asOf: IsoDate): DeletedWindow | null {
  const words = text.trim().replace(/[?.!]+$/, "").split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 5) return null;
  if (/\d{3,}/.test(text) && !/\b(?:19|20)\d{2}\b/.test(text)) return null;
  return deletedWindowIn(text, asOf);
}

export interface DeletedRow {
  readonly row: DeletedTransaction;
  readonly why: readonly string[];
}

const dayOf = (iso: string): IsoDate => iso.slice(0, 10);

/**
 * The bin, newest deletion first, narrowed to a window when one is named: a
 * row is in it when it was deleted in it, or when the day it was for is.
 */
export function deletedRows(
  deleted: readonly DeletedTransaction[],
  window: DeletedWindow | null,
  most = 12,
): DeletedRow[] {
  const inWindow = (d: string): boolean => window !== null && d >= window.from && d <= window.to;
  return [...deleted]
    .filter((r) => window === null || inWindow(dayOf(r.deletedAt)) || inWindow(r.date))
    .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt) || b.recordNumber - a.recordNumber)
    .slice(0, most)
    .map((row) => ({
      row,
      // One sentence, which the list shows as it is.
      why: [`Deleted ${formatMedium(dayOf(row.deletedAt))}${row.date !== dayOf(row.deletedAt) ? `, for ${formatMedium(row.date)}` : ""}.`],
    }));
}

/** What the bin holds, said plainly, above the list. */
export function deletedWords(found: readonly DeletedRow[], all: number, window: DeletedWindow | null): string {
  if (all === 0) return "The bin is empty: nothing has been deleted, so nothing is missing from there.";
  if (found.length === 0) {
    return `Nothing in the bin was deleted ${window ? window.name : ""}, or was for ${window ? window.name : "then"}. There ${all === 1 ? "is 1 entry" : `are ${all} entries`} in it altogether: ask for another day, or open the Bin.`;
  }
  const total = found.reduce((s, f) => s + f.row.total, 0);
  const which = window ? `deleted ${window.name}, or for ${window.name}` : "deleted most recently";
  return `${found.length === 1 ? "This is" : `These ${found.length} are`} in the bin, ${which}, newest first: ${formatMoney(total)} in all. **Restore** puts one back in the ledger with its record number. Name a day or a month to look further back.`;
}

/** The bin for the model: how many, and the newest, with when each was deleted. */
export function binForModel(deleted: readonly DeletedTransaction[], most = 25): string[] {
  if (deleted.length === 0) return ["## The bin", "Empty: nothing has been deleted."];
  const rows = [...deleted].sort((a, b) => b.deletedAt.localeCompare(a.deletedAt)).slice(0, most);
  return [
    "## The bin (deleted entries, restorable, not counted in any total)",
    `${deleted.length} ${deleted.length === 1 ? "entry" : "entries"}. The newest ${rows.length}, by the day each was deleted:`,
    ...rows.map(
      (r) =>
        `deleted ${dayOf(r.deletedAt)}: #${String(r.recordNumber).padStart(4, "0")} ${r.date} ${r.type} ${r.item || r.category} ${formatMoney(r.total)}${r.fromWallet ? ` from ${r.fromWallet}` : ""}${r.toWallet ? ` to ${r.toWallet}` : ""}`,
    ),
  ];
}
