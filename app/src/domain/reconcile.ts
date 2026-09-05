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
export function reconcile(model: Draft, local: ReadEntry): Reconciled {
  if (!local.worthOffering) return { draft: model, notes: [] };

  const notes: string[] = [];
  let draft = model;

  /**
   * The flow, which decides what every other field means.
   *
   * A purchase read as a transfer asks which wallet the money landed in,
   * which is a question with no answer, and books nothing against the item.
   */
  if (local.draft.flow && model.flow !== local.draft.flow) {
    notes.push(
      `Read as ${local.draft.flow} rather than ${model.flow || "nothing"}, from the words you used.`,
    );
    draft = {
      ...draft,
      flow: local.draft.flow,
      category:
        local.draft.flow === "Revenue"
          ? "Revenue"
          : local.draft.flow === "Transfer"
            ? "Transfer"
            : draft.category || "Spending",
    };
  }

  /**
   * The wallets, which are the fields a wrong guess costs money on.
   *
   * Only when the device actually found one. A blank here means the sentence
   * did not name it, and the model may have had it from context.
   */
  for (const side of ["fromWallet", "toWallet"] as const) {
    const found = local.draft[side];
    if (!found) continue;
    if (clean(draft[side]) === clean(found)) continue;

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
