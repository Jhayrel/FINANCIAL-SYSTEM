/**
 * A difference found, and what the owner says next.
 *
 * The owner, 5 October 2026, after "MY BALANCE NOW IN MAYA IS 6000": "fix
 * this it should know if I am asking or adding entry or investigation etc".
 * Telling the app a balance asks it to look, and the answer came with a
 * card ready to save ₱2,040.56 as unknown spending. That card had been
 * thrown away every time it was offered (₱176.56 on 2 October, ₱220.00 on
 * 3 October): a guess at the remainder is not an entry the owner asked for.
 *
 * So the difference is explained and nothing is offered. The guess is held,
 * and becomes a card only when the next message asks for it: "add it", or
 * what it was, "it was food".
 */

import { matchItem } from "./capture";
import { formatMoney } from "./money";
import type { Draft } from "./entry";
import type { ReferenceLists } from "./types";

/** "add it", "yes add it", "record it", "add the difference", "add it as unknown". */
export function asksToAddTheDifference(text: string): boolean {
  return /^\s*(?:ok(?:ay)?|yes|yeah|yup|sige|go|please|pls)?[\s,.!]*(?:please\s+|pls\s+)?(?:add|record|save|log|put|i-?add)\s+(?:it|that|this|the difference|the rest|them)(?:\s+(?:as\s+(?:unknown|spending|income|unknown spending)|na|po|please|in|now))*\s*[.!]?\s*$/i.test(
    text,
  );
}

/**
 * What it was, said in a few words: "it was food", "for school", "gas".
 * The held guess with that kind, or null when the words name none of the
 * owner's own kinds or carry a figure (a figure is a new entry of its own).
 */
export function namedForTheDifference(text: string, guess: Draft, reference: ReferenceLists): Draft | null {
  const said = text.trim();
  if (!said || /\d/.test(said) || said.split(/\s+/).length > 8 || /\?\s*$/.test(said)) return null;
  const rest = said
    .toLowerCase()
    .replace(/[.!]+$/, "")
    .replace(/^(?:no[,.]?\s+|ah[,.]?\s+|oh[,.]?\s+)/, "")
    .replace(/^(?:it|that|those|the rest)\s+(?:was|is|were|are)\s+|^(?:it'?s|its|that'?s)\s+/, "")
    .replace(/^(?:i\s+)?(?:spent|bought|paid|used)\s+(?:it\s+)?(?:on|for)?\s*/, "")
    .replace(/^(?:for|on|in|sa|para sa)\s+/, "")
    .replace(/^(?:my|the|a|an)\s+/, "")
    .trim();
  if (!rest) return null;
  const flow = guess.flow === "Revenue" ? "Revenue" : "Spending";
  const found = matchItem(rest, flow, flow === "Revenue" ? "Revenue" : "Spending", reference);
  if (!found.matched || !found.item) return null;
  return { ...guess, item: found.item, description: said.replace(/[.!]+$/, "") };
}

/** The line that ends the answer: nothing was added, and how to add it. */
export function differenceNextStep(guess: Draft, account: string): string {
  const amount = formatMoney(guess.amount ?? 0);
  const as = guess.flow === "Revenue" ? "money that came in" : "spending not written down";
  return `Nothing is added. Say what the ${amount} was ("it was food"), send ${account}'s history to find it, or say "add it" to record it as ${as}.`;
}
