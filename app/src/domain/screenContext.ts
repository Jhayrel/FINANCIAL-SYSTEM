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
  /**
   * The days the screen is showing, when it picks days (Insights). "chart
   * what I picked" is drawn over these rather than over this month.
   */
  readonly range?: { readonly from: string; readonly to: string };
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
    `The owner is on the ${report.screen} screen and is asking about what is described below. Answer about it, with these figures and the rest of this context.`,
    ...lines.map((line) => `- ${line}`),
  ].join("\n");
}

/**
 * Whether the question is about what is on screen at all.
 *
 * ── Why this gate exists ───────────────────────────────────────────────────
 *
 * The screen block was sent with every question, and it ends by telling the
 * model to answer about the screen. So it did. Live, 20 September 2026, "how
 * much did I spend today" came back as "You are adding a new spending entry
 * for 2026-09-20, but the amount field is currently empty", and the figure
 * that was asked for came third.
 *
 * A question about a figure is about the ledger. Only a question that points
 * at something, or asks for an opinion on it, needs to know what is on
 * screen, and for those it is most of the answer. So the block goes with
 * those and with nothing else.
 */
export function aboutTheScreen(question: string): boolean {
  const text = question.trim();
  if (!text) return false;

  // An opinion on something, and the something is whatever they are looking at.
  if (
    /\b(what do you think|thoughts on|how does (this|it) look|is (this|it) (ok|okay|right|correct|fine|good|bad)|anything wrong|ano sa tingin mo|tama ba)\b/i.test(
      text,
    )
  ) {
    return true;
  }

  /*
   * Being told to look, which is pointing without a pointing word.
   *
   * The owner, 21 and 23 September 2026: "but look at my budget 2026"
   * and "read the output" both came back as charts, and underneath the
   * first they wrote "// you give me a chart instead of seing my screen".
   * Neither sentence contains this, these or that, so neither counted as
   * being about the screen, though both are plainly an instruction to
   * look at it.
   *
   * "look at" and "see" only count with my, the, or a screen word after
   * them: "look at May" is about the ledger and stays there.
   */
  if (
    /\b(?:look at|see|read|check|tignan|tingnan)\s+(?:mo|niyo|nyo|po)?\s*(?:my|the|this|ang|yung|itong)\s+(?:screen|page|output|panel|card|chart|list|table|form|dashboard|numbers?|figures?|budget|insights?|result)\b/i.test(
      text,
    ) ||
    /\b(?:see|read|check|look at)\s+(?:my|the)\s+(?:screen|output)\b/i.test(text)
  ) {
    return true;
  }

  // Pointing words, which mean nothing without the screen.
  /*
   * "This month" is not this screen.
   *
   * The owner, 20 September 2026: "I have 11 days left this month, what
   * should I cut?" was answered with "The screen shows a new entry form for
   * a Debt from Maya", because "this" was read as pointing at the screen. A
   * word for a span of time after it makes it a span of time, and a
   * question about one is a question about the ledger.
   */
  const pointing = text.replace(
    /\b(?:this|these|that)\s+(?:month|week|year|day|days|morning|afternoon|evening|night|time|period|quarter|payday|payslip)\b/gi,
    " ",
  );

  return /\b(this|these|that one|here|on screen|ito|dito|ganito)\b/i.test(pointing);
}
