/**
 * The notes under a card, as the card reads now.
 *
 * A card keeps every note made while it was read and changed. One that names
 * what the card no longer says is out of date: "Thats online buy load" made
 * a Random necessities card Online Buy, and "Booked as Random necessities,
 * which you have used 767 times" stayed under it (owner, 27 October 2026:
 * "Its struggling in editing"). The same happens when the form changes the
 * kind with Edit first. Shown notes follow what the card says; the record of
 * what was read keeps them all.
 */
import type { Draft } from "./entry";

const BOOKED = /^Booked as ([^,:.]+?)(?:,| which| as |:|\.)/;

/** What a "Still needs" note names, and whether the card still lacks it. */
const STILL: readonly [RegExp, (d: Partial<Draft>) => boolean][] = [
  [/the amount/, (d) => d.amount === undefined || d.amount === null || d.amount <= 0],
  [/the wallet it came from/, (d) => d.fromWallet === undefined || d.fromWallet.trim() === ""],
  [/the wallet it went to/, (d) => d.sentOut !== true && (d.toWallet === undefined || d.toWallet.trim() === "")],
  [/the date/, (d) => d.date === undefined || d.date === ""],
];

/*
 * A card answered "Sent to someone" became money sent out of the accounts
 * and still said "Still needs one thing: the wallet it went to" and "Say
 * what it was for, or sent to someone" under it, so it read as unanswered
 * and was thrown away (owner, 15 November 2026). Those notes go once the
 * card says what they asked for.
 */
function stillTrue(note: string, draft: Partial<Draft>): boolean {
  if (/^Still needs\b/.test(note)) {
    const named = STILL.filter(([re]) => re.test(note));
    return named.length === 0 || named.some(([, lacks]) => lacks(draft));
  }
  if (/\bSay what it was for, or "sent to someone"/.test(note)) return draft.sentOut !== true && draft.flow !== "Transfer" && !(draft.item ?? "").trim();
  return true;
}

export function currentNotes(notes: readonly string[], draft: Pick<Draft, "item"> & Partial<Draft>): string[] {
  const item = draft.item.trim().toLowerCase();
  return notes.filter((note) => {
    if (!stillTrue(note, draft)) return false;
    const booked = BOOKED.exec(note)?.[1]?.trim().toLowerCase();
    // Borrowing, money sent and transfers say what kind of row it is, not a kind of spending.
    if (!booked || /^(?:borrowing|money sent|a transfer)\b/.test(booked)) return true;
    // A kind of spending under a card that is now a transfer or a debt says what it no longer is.
    if (draft.flow === "Transfer" || draft.flow === "Debt") return false;
    return !item || booked === item;
  });
}
