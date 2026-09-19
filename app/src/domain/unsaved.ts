/**
 * Entries the database refused, kept on this device until they are saved.
 *
 * ── What happened ─────────────────────────────────────────────────────────
 *
 * On 2026-09-18 and 19 the chat said "Added" for a ₱2,000.00 borrowing on
 * Maya Credit, twice, with its fees, and the owner saved a ₱1,000.00
 * withdrawal with its ₱18.00 fee. None of the five rows is in the database.
 * The published rules were older than the app and refused the fee rows, a
 * refused row fails the whole batch it was written in, and the live ledger
 * then replaced the screen with what the database held, so the rows simply
 * vanished. The only trace was a red notice saying to add them again, with
 * nothing left on screen to add again from.
 *
 * ── What happens now ──────────────────────────────────────────────────────
 *
 * A refused batch is retried one row at a time, so only the refused rows are
 * lost to the database (`firestoreLedger.ts`, `saveMany`). Those rows are kept
 * here, in this browser, listed on every screen with a way to try again once
 * the cause is put right. Nothing is dropped until the database has it or the
 * owner dismisses it.
 */

import { formatMedium } from "./dates";
import { formatMoney } from "./money";
import type { Transaction } from "./types";

const key = (uid: string): string => `fms.unsaved.${uid}`;

/** The refused rows kept for this account, oldest first. */
export function readUnsaved(uid: string): Transaction[] {
  try {
    const raw = window.localStorage.getItem(key(uid));
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed)
      ? parsed.filter((t): t is Transaction => Boolean(t) && typeof t === "object" && typeof (t as Transaction).id === "string")
      : [];
  } catch {
    return [];
  }
}

export function writeUnsaved(uid: string, rows: readonly Transaction[]): void {
  try {
    if (rows.length === 0) window.localStorage.removeItem(key(uid));
    else window.localStorage.setItem(key(uid), JSON.stringify(rows));
  } catch {
    // A full or blocked store still shows the rows for this session.
  }
}

/** New refusals added to the list, one entry per row id, the latest copy winning. */
export function mergeUnsaved(kept: readonly Transaction[], refused: readonly Transaction[]): Transaction[] {
  const byId = new Map(kept.map((t) => [t.id, t]));
  for (const t of refused) byId.set(t.id, t);
  return [...byId.values()];
}

/** Rows the database now holds are no longer unsaved. */
export function withoutSaved(kept: readonly Transaction[], saved: readonly Transaction[]): Transaction[] {
  const ids = new Set(saved.map((t) => t.id));
  return kept.filter((t) => !ids.has(t.id));
}

/** One line for each, the way the Database shows it. */
export function unsavedLine(t: Transaction): string {
  const what = t.item.trim() || t.description.trim() || t.type;
  return `${formatMedium(t.date)}, ${t.type}, ${what}, ${formatMoney(t.total)}`;
}
