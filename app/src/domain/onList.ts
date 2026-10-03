/**
 * Every item a chat card carries is one of the owner's own.
 *
 * ── The bug this fixes ────────────────────────────────────────────────────
 *
 * 3 October 2026, the owner: "I said I travel to this place but the entry
 * says vacation instead of travel ... make it always align in the
 * database". A model named a kind the owner does not have, the card kept
 * it, said "Saving this adds it as a new one", and saved a row whose item
 * is on no list. Nothing adds it to a list, so no total, filter or ranking
 * that goes by the owner's kinds ever finds that row again.
 *
 * The Add form only offers the owner's lists. A card is held to the same:
 * an item off the list is put back on it where the words say which one, and
 * left for the owner to pick where they do not. A genuinely new kind is made
 * in Settings, where every list lives, and is then on the list like the rest.
 */

import { matchItem } from "./capture";
import { itemsFor, type Draft } from "./entry";
import { nearestName } from "./nearly";
import { matchExact } from "./proposal";
import type { ReferenceLists } from "./types";
import { flatten, namesAPurchase } from "./verify";

/** What the owner's list for this row is called, as Settings calls it. */
export function kindsWord(flow: Draft["flow"], category: Draft["category"]): string {
  if (flow === "Revenue") return "kinds of income";
  if (category === "Bills") return "bills";
  if (category === "Subscriptions") return "subscriptions";
  return "kinds of spending";
}

/** True when the row has no item list to be on, or its item is on it. */
export function itemOnList(draft: Pick<Draft, "flow" | "category" | "item">, reference: ReferenceLists): boolean {
  if (draft.flow !== "Spending" && draft.flow !== "Revenue") return true;
  const item = draft.item.trim();
  if (!item) return true;
  const known = itemsFor(draft.flow, draft.category, reference);
  // No list at all is nothing to hold it to: Settings has not been filled in yet.
  return known.length === 0 || matchExact(item, known) !== "";
}

/** Why a card cannot be added as it is, or empty when it can. */
export function offListProblem(draft: Pick<Draft, "flow" | "category" | "item">, reference: ReferenceLists): string {
  if (itemOnList(draft, reference)) return "";
  return `"${draft.item.trim()}" is not one of your ${kindsWord(draft.flow, draft.category)}. Pick one of yours, or add it in Settings first.`;
}

/** A word with its ending taken off, so "traveled" and "travelling" are "travel". */
const stem = (word: string): string => word.replace(/(?:ing|ed|es|s)$/, "").replace(/([a-z])\1$/, "$1");

/** A one-word item named in the sentence in another form: "I traveled", for Travel. */
function namedInAnotherForm(sentence: string, name: string): boolean {
  const flat = flatten(name).trim();
  if (flat.includes(" ")) return false;
  const root = stem(flat);
  if (root.length < 4) return false;
  return sentence
    .trim()
    .split(" ")
    .some((w) => w !== flat && stem(w) === root);
}

/**
 * The item on the owner's list this row means, in this order:
 *
 *   1. Already on it, however it was capitalised.
 *   2. The one the owner named in their own words: "I travel", when the
 *      model wrote Vacation. Only when they named exactly one, so a message
 *      about lunch and a fare does not put the fare's kind on the lunch.
 *   3. One letter or two from a name on the list: "Foood".
 *   4. The item's own words read against the list, the notes beside each
 *      kind, and the everyday words for things (`matchItem`): Vacation is
 *      Travel, Groceries is whatever the owner's note says groceries are.
 *   5. The description read the same way: "Trip to the beach".
 *
 * Nothing fits: the item is left empty, the model's word kept in the
 * description if there was none, and the card says why. The owner picks one
 * of theirs, or is asked what it was for.
 */
export function fitItem(
  draft: Draft,
  said: string,
  reference: ReferenceLists,
  learned: ReadonlyMap<string, string> = new Map(),
): { readonly draft: Draft; readonly note: string } {
  if (itemOnList(draft, reference)) {
    // On the list in another case: the list's own spelling, so every total groups it.
    const known = itemsFor(draft.flow, draft.category, reference);
    const exact = draft.item.trim() ? matchExact(draft.item, known) : "";
    return { draft: exact && exact !== draft.item ? { ...draft, item: exact } : draft, note: "" };
  }

  const flow = draft.flow as "Spending" | "Revenue";
  const item = draft.item.trim();
  const known = itemsFor(flow, draft.category, reference);
  const kinds = kindsWord(flow, draft.category);

  const sentence = flatten(said);
  const spoken = said.trim() ? known.filter((name) => namesAPurchase(sentence, name) || namedInAnotherForm(sentence, name)) : [];
  if (spoken.length === 1) {
    const name = spoken[0] ?? "";
    return { draft: { ...draft, item: name }, note: `Booked as ${name}, as you said: "${item}" is not one of your ${kinds}.` };
  }

  const near = nearestName(item, known)?.meant ?? "";
  const byWord = matchItem(item, flow, draft.category, reference, learned);
  const byDescription = draft.description.trim() ? matchItem(draft.description, flow, draft.category, reference, learned) : null;
  const found = near || (byWord.matched ? byWord.item : "") || (byDescription?.matched ? byDescription.item : "");
  if (found && matchExact(found, known)) {
    return { draft: { ...draft, item: matchExact(found, known) }, note: `Booked as ${matchExact(found, known)}: "${item}" is not one of your ${kinds}.` };
  }

  return {
    draft: { ...draft, item: "", description: draft.description.trim() ? draft.description : item },
    note: `"${item}" is not one of your ${kinds}, so pick one of yours. To keep it as a kind of its own, add it in Settings first.`,
  };
}
