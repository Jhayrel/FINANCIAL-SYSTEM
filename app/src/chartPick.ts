/**
 * The part of a chart the owner last tapped, kept where the assistant can
 * read it.
 *
 * One value, like the screen report beside it (`screenReport.ts`): nothing
 * re-renders because of it, and the assistant reads it when a question is
 * sent. The handoff's open item, "whats that selected?" about a slice the
 * owner had tapped: the chat was not told which part was picked.
 */

import type { ChartPick } from "./domain/chartPick";

let current: (ChartPick & { readonly at: number }) | null = null;

/** How long a tap stays the thing "that" means: a question long after it is about something else. */
const FRESH_MS = 15 * 60_000;

export function notePick(pick: ChartPick): void {
  current = { ...pick, at: Date.now() };
}

/** Let go of a chart's pick, when that chart is the one picked. */
export function clearPick(chart: string): void {
  if (current?.chart === chart) current = null;
}

export function currentPick(now = Date.now()): ChartPick | null {
  return current && now - current.at < FRESH_MS ? current : null;
}
