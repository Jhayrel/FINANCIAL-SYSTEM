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

export function currentNotes(notes: readonly string[], draft: Pick<Draft, "item">): string[] {
  const item = draft.item.trim().toLowerCase();
  return notes.filter((note) => {
    const booked = BOOKED.exec(note)?.[1]?.trim().toLowerCase();
    // Borrowing, money sent and transfers say what kind of row it is, not a kind of spending.
    if (!booked || /^(?:borrowing|money sent|a transfer)\b/.test(booked)) return true;
    return !item || booked === item;
  });
}
