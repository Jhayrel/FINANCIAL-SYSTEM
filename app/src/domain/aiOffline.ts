/**
 * The answer when there is no model.
 *
 * ── Why this is not a stub ────────────────────────────────────────────────
 *
 * Free models are rate limited, retired without notice, and unreachable on a
 * phone with no signal. A feature that only works when a remote model answers
 * is a feature that does not work. So this writes the same three answers from
 * the same context, with no network and no key, and the app falls back to it
 * whenever the endpoint cannot help.
 *
 * The VBA had the same idea in `EnhanceAlertOffline`, but it worked by scraping
 * numbers back out of a sentence it had already rendered into a cell. This
 * reads the context object instead, so a figure cannot be mangled on the way
 * through.
 *
 * ── The rule it obeys ─────────────────────────────────────────────────────
 *
 * Every number here is copied, never computed. `aiContext` did the arithmetic
 * and its figures are parity-tested; recomputing anything here would create a
 * second source of truth that could drift from the screen the owner is looking
 * at. If a figure is missing, the sentence about it is dropped rather than
 * guessed.
 *
 * Pure, so what it says can be asserted exactly.
 */

import { phpFigure, type AiContext } from "./aiContext";

export type AiTask = "summary" | "alerts" | "patterns" | "chat";

/**
 * The figures in `AiContext` are pesos, not centavos, so this borrows that
 * module's own renderer rather than reaching for `formatMoney`, which takes
 * centavos and would reject them.
 */
const php = phpFigure;

export function offlineAnswer(c: AiContext, task: AiTask): string {
  if (task === "alerts") return offlineAlerts(c);
  if (task === "patterns") return offlinePatterns(c);
  /**
   * A chat question with no model gets the summary, prefixed with the
   * reason. Answering an arbitrary question from a fixed snapshot is not
   * something this can do honestly, so it says what it can tell you rather
   * than guessing at what was asked.
   */
  if (task === "chat") {
    return `I cannot read your question without the model, so here is where the month stands. ${offlineSummary(c)}`;
  }
  return offlineSummary(c);
}

function offlineSummary(c: AiContext): string {
  const parts: string[] = [];
  const { month } = c;

  parts.push(
    `You have spent ${php(month.spent)} in ${month.name} and taken in ${php(month.revenue)}.`,
  );

  /**
   * Budget wording turns on the sign, because "PHP -400.00 remaining" is a
   * sentence no one should have to parse.
   */
  if (month.budget !== null && month.remaining !== null) {
    if (month.remaining < 0) {
      parts.push(
        `That is ${php(Math.abs(month.remaining))} over the ${php(month.budget)} budget.`,
      );
    } else if (month.allowancePerDay !== null && month.daysLeft > 0) {
      parts.push(
        `${php(month.remaining)} of the ${php(month.budget)} budget is left, which is ${php(month.allowancePerDay)} a day for the ${month.daysLeft} days remaining.`,
      );
    } else {
      parts.push(`${php(month.remaining)} of the ${php(month.budget)} budget is left.`);
    }
  }

  const overdue = c.bills.overdue.length;
  if (overdue > 0) {
    parts.push(`${overdue} bill${overdue === 1 ? " is" : "s are"} overdue: ${c.bills.overdue.join(", ")}.`);
  }

  const owed = c.debts.reduce((total, d) => total + d.outstanding, 0);
  if (owed > 0) {
    parts.push(`Net worth is ${php(c.netWorth)}, after ${php(owed)} still owed.`);
  } else {
    parts.push(`Net worth is ${php(c.netWorth)}.`);
  }

  return parts.join(" ");
}

function offlineAlerts(c: AiContext): string {
  if (c.alerts.length === 0) {
    return "Nothing is flagged. Bills are current, no account is unusually low, and spending is inside budget.";
  }

  // Worst first, because the first sentence is the one that gets read.
  const rank: Record<string, number> = { over: 0, warn: 1, info: 2 };
  const ordered = [...c.alerts].sort(
    (a, b) => (rank[a.level] ?? 3) - (rank[b.level] ?? 3),
  );

  const lead = ordered
    .slice(0, 3)
    .map((a) => `${a.title}: ${a.detail}`)
    .join(" ");

  const rest = ordered.length - 3;
  return rest > 0 ? `${lead} ${rest} other item${rest === 1 ? "" : "s"} flagged.` : lead;
}

function offlinePatterns(c: AiContext): string {
  const parts: string[] = [];
  const top = c.topSpending[0];

  if (top && c.month.spent > 0) {
    const share = Math.round((top.amount / c.month.spent) * 100);
    parts.push(`${top.category} is the largest category at ${php(top.amount)}, ${share}% of the month.`);
  }

  /**
   * Comparison is the only claim here that is genuinely about a pattern, so it
   * is only made when there is something to compare against and the gap is
   * big enough to mean anything. A 3% swing is noise.
   */
  const previous = c.comparison[0];
  if (previous && previous.spent > 0) {
    const change = Math.round(((c.month.spent - previous.spent) / previous.spent) * 100);
    if (Math.abs(change) >= 10) {
      parts.push(
        `Spending is ${Math.abs(change)}% ${change > 0 ? "higher" : "lower"} than ${previous.month}, which was ${php(previous.spent)}.`,
      );
    } else {
      parts.push(`Spending is close to ${previous.month}, which was ${php(previous.spent)}.`);
    }
  }

  if (parts.length === 0) {
    return "There is not enough history yet to say whether this month is typical.";
  }

  return parts.join(" ");
}
