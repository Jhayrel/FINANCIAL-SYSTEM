/**
 * A card's notes kept true after its figure is changed.
 *
 * 7 October 2026: two interest credits were folded into one card of PHP
 * 0.50, the owner changed the figure to PHP 0.69, and the card was saved
 * still saying "2 interest credits added together into one entry of PHP
 * 0.50" above a PHP 0.69 amount. A line that states the old figure is
 * replaced by one saying what changed, so the card never contradicts itself.
 */

import { formatMoney } from "./money";
import type { Proposal } from "./proposal";

export function afterFigureChange(before: Proposal, after: Proposal): Proposal {
  const was = before.draft.amount;
  const now = after.draft.amount;
  if (was === null || now === null || was === now) return after;
  const old = formatMoney(was);
  const kept = after.adjustments.filter((line) => !line.includes(old));
  const said = `Changed on the card from ${old} to ${formatMoney(now)}.`;
  const notes = after.draft.notes.trim();
  return {
    ...after,
    adjustments: [...kept.filter((line) => !/^Changed on the card from /.test(line)), said],
    draft: notes && !notes.includes("changed on the card") ? { ...after.draft, notes: `${notes} (changed on the card to ${formatMoney(now)})` } : after.draft,
  };
}
