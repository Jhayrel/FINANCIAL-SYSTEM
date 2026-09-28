/**
 * Two readings of one sentence, and which to believe on each field.
 *
 * ── The structural problem this fixes ─────────────────────────────────────
 *
 * Every sentence is read twice: once here on the device by `readEntry`, and
 * once by a model. The device reading was only ever used when the model could
 * not be reached, which meant that in ordinary use it was never used at all.
 *
 * That is why fix after fix appeared to work and then did not. The reader
 * learned Tagalog, learned that the first verb decides what a sentence is
 * about, learned that an account keeps its name without its brackets, learned
 * that a credit line is not a wallet. Every one of those was verified, and
 * every one of them was dead the moment a provider answered.
 *
 * The record shows exactly what it cost:
 *
 *   nag bayad ako ng tricycle 500 kanina cash gamit ko
 *     model:  Transfer, from Maya
 *     device: Spending, Travel, from Cash
 *
 *   bumuli ako ng pagkain 200 gcash
 *     model:  Transfer, from Maya to Gcash
 *     device: Spending, Food, from Gcash
 *
 * Both were corrected by hand, and the owner wrote "wrong it recognize it as
 * transfer" and then "same again".
 *
 * ── Which reading wins, and why ───────────────────────────────────────────
 *
 * Not "the device is better". It is better at some things and worse at
 * others, and the split is not a matter of taste:
 *
 *   THE DEVICE WINS on the flow and the wallets. It has the owner's actual
 *   account list and matches against it exactly. It knows their credit lines
 *   are not accounts. It knows the verbs in both languages they type in. A
 *   model is guessing at all four from the shape of the words.
 *
 *   THE MODEL WINS on the item and the description. Those are judgement about
 *   free text: what a receipt line means, what to call a purchase in six
 *   months. The device can only match strings.
 *
 *   NEITHER TOUCHES the amount. Both read it, they almost always agree, and
 *   the one field where being wrong costs money directly is not the place to
 *   introduce a tie-break nobody asked for. A disagreement is reported.
 *
 * Every override is recorded in words on the card, because a silent
 * correction is how a wrong rule survives unnoticed.
 */

import { formatMoney } from "./money";
import type { Draft } from "./entry";
import type { ReadEntry } from "./readEntry";
import type { ReferenceLists, TransactionCategory } from "./types";

export interface Reconciled {
  readonly draft: Draft;
  /** What was changed and why, for the card. Empty when nothing was. */
  readonly notes: readonly string[];
}

const clean = (v: string): string => v.trim().toLowerCase();

/**
 * The model's row, corrected where the device knows better.
 *
 * `local` must be a reading of the same sentence. Reconciling a card that
 * came off a photo with a reading of the message beside it would be comparing
 * two different things, so the caller only does this for typed sentences.
 */
export function reconcile(model: Draft, local: ReadEntry, reference?: ReferenceLists): Reconciled {
  if (!local.worthOffering) return { draft: model, notes: [] };

  const notes: string[] = [];
  let draft = model;
  /*
   * What the sentence said in words, as against what the device filled in
   * from habit. A reading without the record (an older caller) is trusted
   * as before.
   */
  const named = local.named ?? { flow: true, fromWallet: true, toWallet: true };

  /**
   * The flow, which decides what every other field means.
   *
   * A purchase read as a transfer asks which wallet the money landed in,
   * which is a question with no answer, and books nothing against the item.
   *
   * Only when the sentence said it with a verb. "revenue 14 pesos change of
   * the electric bill payment" (28 September 2026) was read as Spending
   * because "electric bill" is an item in the history, and that guess
   * overruled the model's Revenue: the row saved as Spending, filed under the
   * category Revenue, offering to make "Random" a spending type.
   */
  if (named.flow && local.draft.flow && model.flow !== local.draft.flow) {
    notes.push(
      `Read as ${local.draft.flow} rather than ${model.flow || "nothing"}, from the words you used.`,
    );
    const flow = local.draft.flow;
    // The item belongs to the kind it was chosen for; under another kind it is asked for again.
    const keeps = reference ? itemFits(flow, draft.item, reference) : draft.item;
    draft = {
      ...draft,
      flow,
      category: categoryFor(flow, keeps, draft.category, reference),
      item: keeps,
    };
  }

  /**
   * The wallets, which are the fields a wrong guess costs money on.
   *
   * A wallet the sentence named overrules the model. One the device only
   * inferred from habit fills a blank, and says that is what it is.
   */
  for (const side of ["fromWallet", "toWallet"] as const) {
    const found = local.draft[side];
    if (!found) continue;
    if (clean(draft[side]) === clean(found)) continue;
    if (!named[side]) {
      if (draft[side]) continue;
      notes.push(`${found}: the wallet you usually use for this. Check it.`);
      draft = { ...draft, [side]: found };
      continue;
    }

    notes.push(
      draft[side]
        ? `${found} rather than ${draft[side]}: that is the account your message named.`
        : `${found}, which your message named.`,
    );
    draft = { ...draft, [side]: found };
  }

  /**
   * Money that left the accounts, which the device reads from possessives
   * and from who was named. "my mom's gcash" and "my gcash" are one letter
   * apart and are opposite entries.
   */
  if (local.draft.sentOut === true && draft.sentOut !== true) {
    notes.push("It went to someone else, so the whole amount counts as spending.");
    draft = { ...draft, sentOut: true, toWallet: "" };
  }

  /** An item the device recognised and the model left empty. */
  if (!draft.item.trim() && local.draft.item.trim()) {
    draft = { ...draft, item: local.draft.item };
  }

  /**
   * A disagreement about the figure is reported and never resolved.
   *
   * CLAUDE.md is explicit that being wrong about an amount is the mistake
   * that costs money directly. Picking a winner here would be inventing
   * confidence; saying they disagree is the honest thing and takes one line.
   */
  if (
    local.draft.amount !== null &&
    draft.amount !== null &&
    local.draft.amount !== draft.amount
  ) {
    notes.push(
      `Two readings of the amount: ${formatMoney(draft.amount)} and ${formatMoney(local.draft.amount)}. Check it before adding.`,
    );
  }

  return { draft, notes };
}

/** The item, if it is one of that kind's own; otherwise empty, so the card asks. */
function itemFits(flow: Draft["flow"], item: string, reference: ReferenceLists): string {
  const name = item.trim().toLowerCase();
  if (!name) return "";
  const pool =
    flow === "Revenue"
      ? reference.revenueCategories
      : flow === "Spending"
        ? [...reference.spendingTypes.map((t) => t.name), ...reference.bills, ...reference.subscriptions]
        : [];
  return pool.find((p) => p.trim().toLowerCase() === name) ?? "";
}

/** The category a flow files under, from the item when the item says (a bill is Bills). */
export function categoryFor(
  flow: Draft["flow"],
  item: string,
  current: TransactionCategory,
  reference?: ReferenceLists,
): TransactionCategory {
  if (flow === "Revenue") return "Revenue";
  if (flow === "Transfer") return "Transfer";
  if (flow === "Opening") return "Opening";
  if (flow !== "Spending") return current;
  const name = item.trim().toLowerCase();
  if (reference && name) {
    if (reference.bills.some((b) => b.trim().toLowerCase() === name)) return "Bills";
    if (reference.subscriptions.some((b) => b.trim().toLowerCase() === name)) return "Subscriptions";
  }
  return current === "Bills" || current === "Subscriptions" ? current : "Spending";
}
