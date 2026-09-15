/**
 * What the owner is looking at, said to the assistant.
 *
 * ── Why ────────────────────────────────────────────────────────────────────
 *
 * The owner asked for the assistant to know where they are: open the
 * Dashboard, ask "what do you think", and have it answer about the Dashboard.
 * It already had the whole ledger, but no idea which screen was open, so
 * "this" and "here" meant nothing to it.
 *
 * Each screen says what it shows in a few plain lines: the month it is on,
 * the figures at the top, what is selected. Those lines go at the top of what
 * the assistant reads, under a heading that says what "this" means.
 *
 * Nothing new leaves the device: every figure in the lines is one the rest of
 * the context already carries. Notes and descriptions are never put in them,
 * and the lines are bounded, so a screen with a long list cannot crowd out the
 * ledger.
 */

export interface ScreenReport {
  /** The screen's name as the navigation shows it. */
  readonly screen: string;
  /** What is on it, one fact a line. */
  readonly lines: readonly string[];
}

const MOST_LINES = 40;
const LONGEST_LINE = 280;

export function screenText(report: ScreenReport | null): string {
  if (!report) return "";
  const lines = report.lines
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line !== "")
    .slice(0, MOST_LINES)
    .map((line) => (line.length > LONGEST_LINE ? `${line.slice(0, LONGEST_LINE - 3)}...` : line));

  return [
    "## What is on screen now",
    `The owner is on the ${report.screen} screen while asking. When they say "this", "here" or "these", or ask what you think, they mean what is described below: answer about it first, with these figures and the rest of this context.`,
    ...lines.map((line) => `- ${line}`),
  ].join("\n");
}
