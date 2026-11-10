/**
 * "What if I skip the keychains plan?", "what if the tuition plan were
 * 8000?": what it would do, worked out, before anything is changed.
 *
 * ── Why ────────────────────────────────────────────────────────────────────
 *
 * The owner, 10 November 2026: "what if analysis and very deep test". Asked
 * "what if I skip the keychains plan?", the chat put up a Skip card and said
 * nothing of what skipping would do. A what-if is a question: the answer is
 * the month with the change against the month as it is, and the card, if
 * wanted, is the next step, not the answer.
 */
import { formatMoney, type Centavos } from "./money";

export interface PlanWhatIfFacts {
  readonly title: string;
  /** What the plan still needs. */
  readonly left: Centavos;
  /** The plan's month as the forecast reads it, when it is a month to come: the usual month, other plans in it, what usually comes in. */
  readonly month: { readonly name: string; readonly usual: Centavos; readonly others: Centavos; readonly income: Centavos } | null;
  /** No date: nothing is held back for it anywhere. */
  readonly undated: boolean;
  /** Held back in safe to spend this month, and the days left in it. */
  readonly heldNow: { readonly daysLeft: number } | null;
  readonly due: string;
}

const balance = (c: Centavos): string => (c >= 0 ? `${formatMoney(c)} to spare` : `${formatMoney(-c)} short`);

/** Skipping it, or setting it to a new amount (`amount`). */
export function planWhatIfWords(f: PlanWhatIfFacts, change: { readonly kind: "skip" } | { readonly kind: "amount"; readonly amount: Centavos }): string {
  const newLeft = change.kind === "skip" ? 0 : change.amount;
  const doing = change.kind === "skip" ? `skip "${f.title}"` : `make "${f.title}" ${formatMoney(change.amount)}`;
  const head = `**If you ${doing}** (now ${formatMoney(f.left)} to pay${f.undated ? ", with no date" : `, ${f.due}`}):`;
  const lines: string[] = [head];
  if (f.month) {
    const withNow = f.month.usual + f.month.others + f.left;
    const withNew = f.month.usual + f.month.others + newLeft;
    lines.push(
      `- ${f.month.name} would cost about ${formatMoney(withNew)} instead of ${formatMoney(withNow)}, against about ${formatMoney(f.month.income)} that usually comes in: ${balance(f.month.income - withNow)} as it is, ${balance(f.month.income - withNew)} after.`,
    );
    if (change.kind === "skip") lines.push(`- It would no longer be held back in safe to spend from the 1st of ${f.month.name.split(" ")[0]}.`);
  } else if (f.heldNow) {
    const freed = f.left - newLeft;
    lines.push(
      freed >= 0
        ? `- It is held back in safe to spend this month, so ${formatMoney(freed)} would be free again: about ${formatMoney(Math.floor(freed / Math.max(1, f.heldNow.daysLeft)))} a day more for the ${f.heldNow.daysLeft} days left.`
        : `- It is held back in safe to spend this month, so ${formatMoney(-freed)} more would be held: about ${formatMoney(Math.ceil(-freed / Math.max(1, f.heldNow.daysLeft)))} a day less for the ${f.heldNow.daysLeft} days left.`,
    );
  } else if (f.undated) {
    lines.push(`- It has no date, so nothing is held back for it now: no month's figures change. ${change.kind === "skip" ? `It takes ${formatMoney(f.left)} off what is still to come.` : `What is still to come changes by ${formatMoney(Math.abs(f.left - newLeft))}.`}`);
  } else {
    lines.push("- It is not held back in safe to spend, so today's figures do not change.");
  }
  lines.push(
    change.kind === "skip"
      ? `Nothing is skipped yet. To do it, say "skip the ${f.title.toLowerCase()} plan"; it can be put back after.`
      : `Nothing is changed yet. To do it, say "make the ${f.title.toLowerCase()} plan ${change.amount / 100}".`,
  );
  return lines.join("\n");
}
