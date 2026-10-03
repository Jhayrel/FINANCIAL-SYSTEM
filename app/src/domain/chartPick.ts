/**
 * What the owner tapped on a chart, for the assistant.
 *
 * "whats that selected?", asked about a pie slice the owner had tapped, had
 * nothing to go on: the chat was not told which part was picked. The figures
 * are the ones the chart was drawn from, so nothing new leaves the device.
 */

export interface ChartPick {
  /** The chart's title, or what it shows. */
  readonly chart: string;
  /** The part tapped: a slice, a bar, a month, a day. */
  readonly part: string;
  /** Its figures, as the chart's own reading shows them, one a line. */
  readonly lines: readonly string[];
}

/** The question points at the part picked: "that", "the selected one", "this slice". */
export function asksAboutPick(question: string): boolean {
  return /\b(?:select(?:ed|ion)?|pick(?:ed)?|tapp?ed|click(?:ed)?|highlight(?:ed)?|that (?:slice|bar|part|one|point|piece|portion|month|day|week)|this (?:slice|bar|part|one|point|piece|portion)|the (?:slice|bar|part|one) (?:i|I) (?:tapped|picked|clicked|selected))\b/i.test(question);
}

/** The section the assistant reads. */
export function pickText(pick: ChartPick): string {
  return [
    "## What the owner picked on a chart",
    `On "${pick.chart}" they tapped ${pick.part}. "That", "this" and "the selected one" mean it. Its figures, as the chart shows them:`,
    ...pick.lines.map((l) => `- ${l}`),
  ].join("\n");
}

/** Said by the device when no model answers. */
export function pickAnswer(pick: ChartPick): string {
  // The first line names the part already ("Food: ₱4,515.00"); otherwise it is said first.
  const named = pick.lines[0]?.startsWith(`${pick.part}:`) ?? false;
  return `The part picked on "${pick.chart}" is ${named ? "" : `${pick.part}: `}${pick.lines.join("; ")}.`;
}
