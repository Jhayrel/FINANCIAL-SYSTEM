/**
 * Which notes after spending were already said, on this device.
 *
 * A note is said once (`domain/spendNote.ts`); this is how "once" is kept.
 * It is a preference of this screen, like "Clear this view": nothing goes to
 * the database, and a private window simply says a note again.
 */

const KEY = "fms.notes.shown";
/** Enough for a year of monthly notes; older ids are for months long closed. */
const KEEP = 120;

export function readShownNotes(): Set<string> {
  try {
    const raw = window.localStorage.getItem(KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

export function rememberNote(id: string): void {
  try {
    const list = [...readShownNotes(), id].slice(-KEEP);
    window.localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Blocked storage: the note may be said again, which is the safe way to fail.
  }
}
