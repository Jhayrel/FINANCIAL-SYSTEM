/**
 * What the assistant may do with a row it read, wherever it is shown.
 *
 * It used to be built inside the Add screen, which made the Add screen the
 * only place the assistant could live. There are three now: beside the Add
 * form on a computer, floating over the other screens on a computer, and a
 * tab of its own on a phone. All three save through this, so an entry added
 * from the floating chat passes exactly the checks one added beside the form
 * does.
 *
 * Every action is the app's own machinery. `check` is the same `checkDraft`
 * the Save button obeys, `add` goes through `draftToTransactions` and
 * `onSave`, which is the single writer in this app, and `use` hands the draft
 * to the form. There is no second path and nothing here skips validation, so
 * an AI row is a typed row that someone else did the typing for.
 */

import { useEffect, useMemo, useRef } from "react";

import type { Provenance } from "../domain/activity";
import type { Debt } from "../domain/debt";
import {
  checkDraft,
  draftToTransactions,
  nextRecordNumber as numberAfter,
  type Draft,
} from "../domain/entry";
import type { ReferenceLists, Transaction } from "../domain/types";
import type { ProposalSink } from "./AskPanel";

export interface SinkInput {
  readonly transactions: readonly Transaction[];
  readonly reference: ReferenceLists;
  readonly debts: readonly Debt[];
  /**
   * Rows whose numbers stay taken though they are not live: the bin, where
   * the ledger keeps its numbers. Left out where every write renumbers.
   */
  readonly reserved?: readonly Transaction[] | undefined;
  readonly onSave: (rows: Transaction[], by?: Provenance) => void;
  readonly onBin: (id: string) => void;
  readonly onBinMany: (ids: readonly string[]) => void;
  readonly onRestore: (id: string) => void;
  /** Put a draft in the form, for a correction before saving. */
  readonly onUse: (draft: Draft) => void;
}

/** Makes ids unique within one millisecond, when a batch saves together. */
let proposed = 0;

export function useProposalSink(input: SinkInput): ProposalSink {
  const { transactions, reference, debts, reserved } = input;

  /**
   * The handlers, read at the moment they are called.
   *
   * The screen that owns them recreates them on every render. Keying the sink
   * on them would rebuild it on every render too, and keying it on anything
   * less would call a handler still holding the previous render's ledger.
   */
  const handlers = useRef(input);
  handlers.current = input;

  const nextRecordNumber = useMemo(
    () => numberAfter(transactions, reserved),
    [transactions, reserved],
  );

  /**
   * How many numbers have been handed out since `transactions` last moved.
   *
   * A ref rather than state: it is read and written inside one event handler
   * and must not cause a render of its own, or a batch of saves would render
   * between each one and the offset would be pointless.
   */
  const taken = useRef(0);

  /**
   * Reset the within-batch offset once the saved rows are actually here.
   *
   * `nextRecordNumber` has moved past everything handed out by then, so the
   * offset has done its job and starting it again from zero is what keeps the
   * next batch from skipping numbers.
   */
  useEffect(() => {
    taken.current = 0;
  }, [nextRecordNumber]);

  return useMemo<ProposalSink>(
    () => ({
      nextRecordNumber,
      check: (d) => {
        const c = checkDraft(d, transactions, reference, debts);
        return {
          ok: c.ok,
          problems: c.errors.map((e) => e.message),
          warnings: c.warnings.map((w) => w.message),
        };
      },
      use: (d) => handlers.current.onUse(d),
      bin: (id) => handlers.current.onBin(id),
      binMany: (ids) => handlers.current.onBinMany(ids),
      restore: (id) => handlers.current.onRestore(id),
      /**
       * Save it, and say which number it got.
       *
       * ── Two faults, one cause ───────────────────────────────────────────
       *
       * `nextRecordNumber` is worked out from `transactions` and captured in
       * this closure, so it does not move until React has re-rendered with
       * the saved row in it. That is fine for one save and wrong for two in
       * the same tick, which is exactly what "Add the 7 ready" does: seven
       * rows off one statement all took the same record number.
       *
       * The owner saw the display half of it first, every card in a batch
       * showing 0505. The rows underneath were worse.
       *
       * `taken` counts the ones handed out since the last render, so numbers
       * advance within a batch, and the number is returned so the card can
       * show what it actually got rather than what is next.
       */
      add: (d, by) => {
        const c = checkDraft(d, transactions, reference, debts);
        // Belt and braces: the button is already disabled when this fails.
        if (!c.ok) return null;
        proposed += 1;
        const number = nextRecordNumber + taken.current;
        taken.current += 1;
        handlers.current.onSave(
          draftToTransactions(d, number, `t-${Date.now()}-${proposed}`, c.repaymentSplit),
          // Recorded as the assistant's, because it was: the owner approved
          // it, but they did not type it, and six months from now that is the
          // difference worth being able to look up.
          by ?? { actor: "ai", via: "ai_chat" },
        );
        return number;
      },
    }),
    [transactions, reference, debts, nextRecordNumber],
  );
}
