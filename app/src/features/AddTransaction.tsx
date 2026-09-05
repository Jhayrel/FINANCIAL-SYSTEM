/**
 * Add / edit a transaction: style guide §3.3.
 *
 * Everything on one page, like the Excel INPUT PAGE it replaces: flow tiles
 * across the top, a two-column field grid, and a live balances panel beside
 * it. No scrolling on a desktop viewport.
 *
 * Flow first: the one choice at the top decides which fields exist. All the
 * rules live in `domain/entry.ts`; this file renders and decides nothing.
 */

import { useEffect, useMemo, useRef, useState } from "react";

import {
  Alert,
  Button,
  FlowBadge,
  Money,
  StatusPill,
  type Flow as FlowTone,
} from "../components/primitives";
import { AmountInput, Select, TextInput } from "../components/forms";
import { suggest } from "../domain/autofill";
import type { Debt, DebtEffect } from "../domain/debt";
import { outstandingOf } from "../domain/debt";
import { formatMoney } from "../domain/money";
import {
  categoriesFor,
  checkDraft,
  draftToTransactions,
  emptyDraft,
  itemsFor,
  needs,
  debtWalletDirection,
  runningBalance,
  withDebtEffect,
  transactionToDraft,
  type Draft,
  type Flow,
} from "../domain/entry";
import type { AiSettings, AppSettings } from "../domain/settings";
import { describeDraft, suggestCategory } from "../data/aiClient";
import { AskPanel, type ProposalSink } from "./AskPanel";
import type { Provenance } from "../domain/activity";
import type { CategoryResult } from "../data/aiClient";
import { billsToLog, predictAmount, reasons, type DueBill } from "../domain/predict";
import type { Budgets, DeletedTransaction, ReferenceLists, Transaction, TransactionCategory, WalletBalance } from "../domain/types";

/**
 * The four things that can happen to money.
 *
 * ── Why "Opening" is not here any more ────────────────────────────────────
 *
 * A starting balance is not something that happens on a Tuesday. It is what an
 * account already held on the day you began recording, which makes it a
 * property of the account rather than an entry you add. Offering it beside
 * Spending invited it to be used later, and adding one halfway through a month
 * silently invents money.
 *
 * It lives on the account now, in Settings, where it is set once. See
 * `AccountsSection`.
 *
 * ── Why Transfer no longer says "between wallets" ─────────────────────────
 *
 * Because it does more than that, and saying so hid the feature completely.
 * Sending money to a person has always worked here: pick a destination that is
 * not one of your accounts and the whole amount counts as spending. But it was
 * the last entry in a list of wallets, under a heading that told you it was
 * only for moving money between your own, so it was never found.
 */
const FLOWS: { id: Flow; tone: FlowTone; glyph: string; hint: string }[] = [
  { id: "Spending", tone: "spending", glyph: "↑", hint: "Money out" },
  { id: "Revenue", tone: "revenue", glyph: "↓", hint: "Money in" },
  { id: "Transfer", tone: "transfer", glyph: "⇄", hint: "Move or send" },
  { id: "Debt", tone: "debt", glyph: "◑", hint: "Borrow or repay" },
];

const EFFECTS: DebtEffect[] = ["draw", "repay", "interest", "writeoff"];
const EFFECT_LABEL: Record<string, string> = {
  draw: "Draw: borrow more",
  repay: "Repay: pay it down",
  interest: "Interest or fee",
  writeoff: "Write-off: forgiven",
};

const STATUSES = ["Paid", "Done", "Received", "Transferred", "Withdrawn"];

let proposed = 0;

export function AddTransaction({
  transactions,
  reference,
  debts,
  balances,
  onSave,
  onUpdate,
  onBin,
  onBinMany,
  onRestoreRow,
  deleted,
  editing,
  onCancelEdit,
  ai,
  uid,
  settings,
  budgets,
  asOf,
}: {
  transactions: readonly Transaction[];
  reference: ReferenceLists;
  debts: readonly Debt[];
  balances: readonly WalletBalance[];
  onSave: (rows: Transaction[], by?: Provenance) => void;
  onUpdate: (rows: Transaction[], by?: Provenance) => void;
  /** Soft delete and its undo, so the assistant can find a row to bin. */
  onBin: (id: string) => void;
  /** Several at once, for a whole set named in the chat. */
  onBinMany: (ids: readonly string[]) => void;
  onRestoreRow: (id: string) => void;
  deleted: readonly DeletedTransaction[];
  /** A saved row being corrected, rather than a new entry. */
  editing: Transaction | null;
  onCancelEdit: () => void;
  ai: AiSettings;
  /** Signed in, so the conversation has somewhere to live. */
  uid: string | null;
  /** For the assistant beside the form, which reads figures and nothing else. */
  settings: AppSettings;
  budgets: Budgets;
  asOf: string;
}) {
  /**
   * Opens on Spending, rather than on nothing.
   *
   * The screen used to render an empty panel and a line telling you to pick a
   * type first. That is a click and a blank page before you can type anything,
   * every single time, for the one screen used most. Spending is the large
   * majority of entries, so it is the right thing to be ready for.
   */
  const [draft, setDraft] = useState<Draft>(() => restoreDraft() ?? { ...emptyDraft(), flow: "Spending" });

  /**
   * A half-typed entry survives leaving the screen.
   *
   * Clicking Database and coming back, or reloading, threw away whatever was
   * in the form: the component unmounts and its state goes with it. Half an
   * entry is work, and losing it silently is the kind of thing that makes
   * someone stop trusting a form.
   *
   * `sessionStorage`, not local: it should survive a reload and a walk
   * through the app, and it should not still be sitting there tomorrow
   * pretending to be today's entry. Cleared the moment a row is saved.
   */
  useEffect(() => {
    keepDraft(draft);
  }, [draft]);
  const [submitted, setSubmitted] = useState(false);

  /**
   * Chosen "Someone else" as the destination, rather than left it empty.
   *
   * Read off the draft rather than held beside it. As component state
   * `checkDraft` could not see it, so every Money Send failed validation with
   * "Pick the wallet the money lands in" and the Save button quietly did
   * nothing. See `Draft.sentOut`.
   */
  const sentOut = draft.flow === "Transfer" && draft.sentOut === true;

  /**
   * Which wallet a debt movement actually touches.
   *
   * Borrowing 5,000 into Gcash was refused with "Pick the wallet the money
   * leaves". There is no such wallet: the money comes from the credit line,
   * which is why the field above asks which line rather than which account.
   *
   * So the form shows the one side the effect implies and hides the other.
   * A draw lands somewhere; a repayment is paid from somewhere; a write-off
   * moves nothing and needs neither.
   */
  const debtSide = draft.flow === "Debt" ? debtWalletDirection(draft.debtEffect) : null;

  /**
   * The last row this form saved, so the card that supplied it can say so.
   *
   * Pressing "Edit first" puts a proposal in the form, and pressing Save
   * there saved it while the card still read "In the form" for the rest of
   * the session. Both are the same entry and should agree about what happened
   * to it.
   */
  const [lastSaved, setLastSaved] = useState<{ draft: Draft; at: number } | null>(null);

  const [categoryHint, setCategoryHint] = useState<CategoryResult | null>(null);

  /**
   * Suggestions arrive on their own, the way the VBA did it.
   *
   * Module8 ran `DoAutofill` from the sheet's change event, wrote each
   * proposal into the field in grey, never overwrote anything typed in
   * black, and accepted the grey after fifteen seconds. There was no button
   * anywhere, and that is the part that made it feel quick.
   *
   * The two rules that matter are carried over exactly:
   *
   *   1. It only ever fills a field that is still empty. Anything typed is
   *      yours and is never touched, which is what made the Excel safe to
   *      leave running on every keystroke.
   *   2. Changing something upstream clears what was proposed downstream,
   *      so a suggestion never survives the answer it was based on.
   *
   * The delay is a debounce rather than an accept timer. Excel needed the
   * timer because grey text was not yet a real value; here the proposal is
   * the field's value from the moment it appears, so there is nothing to
   * accept. What the pause is for is not asking a model about an item that
   * is still being typed.
   */
  const AUTOFILL_DELAY_MS = 700;

  /** Fields filled by a suggestion, so they can be styled and cleared. */
  const [suggested, setSuggested] = useState<Set<string>>(new Set());

  const markSuggested = (field: string): void =>
    setSuggested((current) => new Set(current).add(field));

  const unmark = (field: string): void =>
    setSuggested((current) => {
      if (!current.has(field)) return current;
      const next = new Set(current);
      next.delete(field);
      return next;
    });

  /**
   * The form is both the entry screen and the editor, as the Excel's was.
   *
   * Keyed on the row's id so switching from one row to another reloads,
   * while typing into the loaded row does not throw the edits away.
   */
  useEffect(() => {
    if (!editing) return;
    // `transactionToDraft` reads a blank destination back as Money Send, so
    // there is nothing to set separately any more.
    setDraft(transactionToDraft(editing));
    setSuggested(new Set());
    setSubmitted(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.id]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]): void =>
    setDraft((d) => ({ ...d, [key]: value }));

  /**
   * The autofill pass. Runs itself, fills only what is empty.
   *
   * A category is filled only when the answer is confident, because a wrong
   * one does not look like an error once saved: it looks like a fact, and it
   * moves a figure in every report that groups by category. Anything less
   * confident is offered under the field and left alone.
   */
  const latest = useRef(0);

  useEffect(() => {
    if (!draft.flow || !draft.item.trim()) return;

    const run = ++latest.current;
    const timer = setTimeout(() => {
      void (async () => {
        const allowModel = ai.enabled && ai.features.descriptions;

        if (!draft.category) {
          const result = await suggestCategory(draft, transactions, reference, { allowModel });
          // A slower earlier request must never land on a newer draft.
          if (latest.current !== run) return;

          setCategoryHint(result.category ? result : null);
          if (result.category && (result.source === "history" || result.confidence === "high")) {
            setDraft((d) => (d.category ? d : { ...d, category: result.category as TransactionCategory }));
            markSuggested("category");
          }
        }

        if (!draft.description) {
          const result = await describeDraft(draft, transactions, { allowModel, tone: ai.tone });
          if (latest.current !== run || !result.text) return;

          setDraft((d) => (d.description ? d : { ...d, description: result.text }));
          markSuggested("description");
        }
      })();
    }, AUTOFILL_DELAY_MS);

    return () => clearTimeout(timer);
    // Deliberately keyed on the answers a suggestion depends on, not on the
    // whole draft: including `description` here would retrigger the pass
    // with every character typed into it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.flow, draft.item, draft.category, draft.fromWallet, draft.toWallet, draft.description, transactions, reference, ai]);

  const nextRecordNumber = useMemo(
    () => Math.max(0, ...transactions.map((t) => t.recordNumber)) + 1,
    [transactions],
  );

  /**
   * How many numbers have been handed out since `transactions` last moved.
   *
   * A ref rather than state: it is read and written inside one event handler
   * and must not cause a render of its own, or a batch of saves would render
   * between each one and the offset would be pointless.
   */
  const taken = useRef(0);

  const check = useMemo(
    () => checkDraft(draft, transactions, reference, debts),
    [draft, transactions, reference, debts],
  );
  const ghost = useMemo(() => suggest(draft, transactions), [draft, transactions]);
  const balance = runningBalance(draft, transactions, draft.id);

  /**
   * VBA rule 5a, which was written and never wired up.
   *
   * A bill due today outranks whatever you buy most often. If Globe was paid
   * on the 30th for a year then on the 30th the item is almost certainly
   * Globe, and proposing "Food" because food is more frequent overall is
   * confidently wrong. One tap fills the whole row from last month's.
   */
  const due = useMemo(() => billsToLog(transactions, draft.date), [transactions, draft.date]);

  const guess = useMemo(() => predictAmount(transactions, draft), [transactions, draft]);
  const why = useMemo(() => reasons(draft, transactions), [draft, transactions]);
  const reasonFor = (field: string): string | undefined =>
    why.find((r) => r.field === field)?.why;

  const logBill = (bill: DueBill): void => {
    setDraft((d) => ({
      ...d,
      flow: "Spending",
      category: bill.category,
      item: bill.item,
      // The amount is filled here because the whole point is one tap, and it
      // is visible in the field for checking before anything is saved.
      amount: bill.expected,
      fromWallet: bill.wallet || d.fromWallet,
      status: "Paid",
    }));
  };

  const allWallets = [...reference.wallets, ...reference.savings];
  const items = itemsFor(draft.flow, draft.category, reference);
  const categories = categoriesFor(draft.flow);

  const errorFor = (field: string): string | undefined =>
    submitted ? check.errors.find((e) => e.field === field)?.message : undefined;

  const save = (): void => {
    setSubmitted(true);
    if (!check.ok) return;

    /**
     * An edit is an edit however the row got here.
     *
     * This used to key on the `editing` prop alone, which is only set by the
     * Database screen. A row loaded from the chat carries its id in the draft
     * and would have been saved as a brand new entry with a new record
     * number, quietly duplicating it. The id is the fact; the prop is one way
     * of arriving at it.
     */
    const target = editing ?? (draft.id ? transactions.find((t) => t.id === draft.id) : undefined);

    if (target) {
      /**
       * Same id, same record number. An edit is the entry corrected, not a
       * new one, and reissuing either would break every reference to it.
       */
      onUpdate(
        draftToTransactions(draft, target.recordNumber, target.id, check.repaymentSplit),
      );
    } else {
      onSave(
        draftToTransactions(draft, nextRecordNumber, `t-${Date.now()}`, check.repaymentSplit),
      );
    }

    // The card that supplied this row can now say it was saved.
    setLastSaved({ draft, at: Date.now() });
    forgetDraft();
    setDraft({ ...emptyDraft(draft.date), flow: "Spending" });
    setSuggested(new Set());
    setSubmitted(false);
  };

  /**
   * What the assistant is allowed to do with a row it read off a receipt.
   *
   * Every one of these three is the form's own machinery. `check` is the same
   * `checkDraft` the Save button obeys, `use` fills the fields exactly as a
   * tap on a due bill does, and `add` goes through `draftToTransactions` and
   * `onSave`, which is the single writer in this app. There is no second path
   * and nothing here that skips validation, so an AI row is a typed row that
   * someone else did the typing for.
   */
  const sink: ProposalSink = useMemo(
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
      use: (d) => {
        setDraft(d);
        /**
         * Mark what arrived, so you can see what landed.
         *
         * The fields did update the moment a card was sent over, but they
         * updated silently, and on a wide screen the panel sits beside the
         * form: half a dozen fields change at once, several rows apart, and
         * nothing says which of them moved.
         *
         * `fms-suggested` is the marker the form already uses for a field
         * the app filled in rather than you, and it clears itself the moment
         * you edit the field. That is exactly this: it came from the card,
         * it is yours to change, and once you change it the mark goes.
         *
         * Only the fields the card actually carried. Marking a blank one
         * would claim something was filled in when nothing was.
         */
        const carried: [string, string][] = [
          ["fromWallet", d.fromWallet],
          ["toWallet", d.toWallet],
          ["category", d.category],
          ["item", d.item],
          ["description", d.description],
          ["notes", d.notes],
          ["status", d.status],
        ];
        const filled = carried.filter(([, value]) => value.trim() !== "").map(([field]) => field);
        if (d.amount !== null) filled.push("amount");
        setSuggested(new Set(filled));
        setSubmitted(false);
      },
      bin: onBin,
      binMany: onBinMany,
      restore: onRestoreRow,
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
        onSave(
          draftToTransactions(d, number, `t-${Date.now()}-${proposed}`, c.repaymentSplit),
          // Recorded as the assistant's, because it was: the owner approved
          // it, but they did not type it, and six months from now that is the
          // difference worth being able to look up.
          by ?? { actor: "ai", via: "ai_chat" },
        );
        return number;
      },
    }),
    [transactions, reference, debts, nextRecordNumber, onSave],
  );

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

  const cancelEdit = (): void => {
    onCancelEdit();
    setDraft({ ...emptyDraft(draft.date), flow: "Spending" });
    setSuggested(new Set());
    setSubmitted(false);
  };

  const tone = FLOWS.find((f) => f.id === draft.flow)?.tone;

  return (
    <div className="fms-entry">
      {/* ── Left: the form ─────────────────────────────────────────────── */}
      <section className="fms-panel fms-entryform">
        {due.length > 0 && (
          <div className="fms-duestrip">
            <div className="t-caption" style={{ color: "var(--ink-3)" }}>
              Due around now, going by last month. One tap fills the row.
            </div>
            <div className="fms-duechips">
              {due.map((bill) => (
                <button
                  key={bill.item}
                  type="button"
                  className="fms-duechip"
                  onClick={() => logBill(bill)}
                  style={{
                    borderColor:
                      bill.daysAway < 0 ? "var(--over)" : "var(--hairline-strong)",
                  }}
                >
                  <span className="t-body-strong">{bill.item}</span>
                  <span className="t-num-s">{formatMoney(bill.expected)}</span>
                  <span
                    className="t-micro"
                    style={{ color: bill.daysAway < 0 ? "var(--over)" : "var(--ink-3)" }}
                  >
                    {bill.why}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/*
          Four choices on one row, not five tiles on two.

          The tiles took a quarter of the form's height to ask a question with
          four answers, and the form below them was empty until one was picked,
          so the screen opened saying nothing and offering nothing to type. The
          flow now starts on Spending, which is most entries, and the fields
          are there from the first frame.
        */}
        <div className="fms-flowrow">
          {FLOWS.map((f) => {
            const active = draft.flow === f.id;
            return (
              <button
                key={f.id}
                onClick={() => setDraft({ ...emptyDraft(draft.date), flow: f.id })}
                aria-pressed={active}
                className="fms-flowtile"
                style={{
                  background: active ? `var(--flow-${f.tone}-bg)` : "var(--surface)",
                  borderColor: active ? `var(--flow-${f.tone})` : "var(--hairline-strong)",
                  borderWidth: active ? 2 : 1,
                  color: active ? `var(--flow-${f.tone}-text)` : "var(--ink)",
                }}
              >
                <span className="t-body-strong">
                  <span aria-hidden style={{ marginRight: 5 }}>{f.glyph}</span>
                  {f.id}
                </span>
                <span
                  className="t-micro"
                  style={{ color: active ? `var(--flow-${f.tone}-text)` : "var(--ink-3)" }}
                >
                  {f.hint}
                </span>
              </button>
            );
          })}
        </div>

        {!draft.flow ? (
          <p className="t-caption" style={{ color: "var(--ink-3)", margin: "var(--space-6) 0", textAlign: "center" }}>
            Pick a type above and only the fields it needs will appear.
          </p>
        ) : (
          <>
            <div className="fms-fields">
              {/*
                The number this entry will get, shown before it is saved.

                The Excel put it at the top of the input page and it was worth
                having: it is how a row is referred to when checking something
                against the database, and seeing it in advance tells you the
                form is on a new entry rather than an edit.
              */}
              <Row label="Record number" hint={editing ? "Editing a saved entry" : undefined}>
                <span className="t-num-s fms-readonly">
                  {String(editing ? editing.recordNumber : nextRecordNumber).padStart(4, "0")}
                </span>
              </Row>

              <Row label="Date" required error={errorFor("date")}>
                <input
                  type="date"
                  value={draft.date}
                  onChange={(e) => set("date", e.target.value)}
                  className="t-body fms-control"
                />
              </Row>

              {needs(draft.flow, "debt") && (
                <>
                  {/*
                    Names on screen, ids in the row.

                    `Select` is plain strings in and out, so listing names and
                    storing what came back put the credit line's *name* in
                    `debtId`. Every lookup keys on the id, so the debt could
                    not be found again, and the box showed the raw id back
                    because it was matching a name list against one.
                  */}
                  <Row label="Debt" required error={errorFor("debt")}>
                    <Select
                      value={debts.find((d) => d.id === draft.debtId)?.name ?? ""}
                      onChange={(name) =>
                        set("debtId", debts.find((d) => d.name === name)?.id)
                      }
                      options={debts.map((d) => d.name)}
                      placeholder="Pick a debt"
                      invalid={Boolean(errorFor("debt"))}
                    />
                  </Row>
                  {/*
                    The same confusion, and this one made the row unsaveable.

                    The options are labels like "Draw: borrow more", and what
                    came back was written straight into `debtEffect`. So the
                    stored effect was the label, `debtWalletDirection` read it
                    as nothing, the debt arithmetic could not classify it, and
                    `firestore.rules` refused the write outright because it
                    checks the effect against the four real values.

                    Picking one also moves the wallet to the side that effect
                    implies, exactly as the chat card does: borrowing puts
                    money in, repaying takes it out, and leaving it on the
                    wrong side moves the balance by twice the amount.
                  */}
                  <Row label="Effect" required error={errorFor("debtEffect")}>
                    <Select
                      value={draft.debtEffect ? (EFFECT_LABEL[draft.debtEffect] ?? draft.debtEffect) : ""}
                      onChange={(label) => {
                        const picked = EFFECTS.find((e) => (EFFECT_LABEL[e] ?? e) === label);
                        setDraft((d) => (picked ? withDebtEffect(d, picked) : { ...d, debtEffect: undefined }));
                      }}
                      options={EFFECTS.map((e) => EFFECT_LABEL[e] ?? e)}
                      placeholder="What does this do?"
                      invalid={Boolean(errorFor("debtEffect"))}
                    />
                  </Row>
                </>
              )}

              {needs(draft.flow, "fromWallet") && debtSide !== "in" && (
                <Row
                  label={draft.flow === "Debt" ? "Paid from" : "From wallet"}
                  required={draft.flow !== "Debt" || debtSide === "out"}
                  error={errorFor("fromWallet")}
                  hint={reasonFor("fromWallet")}
                >
                  <Select
                    value={draft.fromWallet}
                    onChange={(v) => set("fromWallet", v)}
                    options={allWallets}
                    placeholder={ghost.fromWallet ? `${ghost.fromWallet} (suggested)` : "Pick a wallet"}
                    invalid={Boolean(errorFor("fromWallet"))}
                  />
                </Row>
              )}

              {needs(draft.flow, "toWallet") && debtSide !== "out" && (
                <Row
                  label={
                    draft.flow === "Transfer"
                      ? "Where to"
                      : draft.flow === "Debt"
                        ? "Lands in"
                        : "To wallet"
                  }
                  required={draft.flow !== "Debt" || debtSide === "in"}
                  error={errorFor("toWallet")}
                >
                  {/*
                    Two questions, asked in the order a person thinks them.

                    "Am I moving this or sending it away" comes first, because
                    it is the one that changes what the entry means. It used to
                    be the last item in a list of wallet names, which is how
                    sending money to someone ended up looking impossible: you
                    had to already know it was there to find it.
                  */}
                  {draft.flow === "Transfer" ? (
                    <div style={{ display: "grid", gap: "var(--space-2)" }}>
                      <div className="fms-choicerow" role="radiogroup" aria-label="Where the money goes">
                        {[
                          { out: false, label: "To my own account" },
                          { out: true, label: "To someone else" },
                        ].map((option) => (
                          <button
                            key={option.label}
                            type="button"
                            role="radio"
                            aria-checked={sentOut === option.out}
                            className={sentOut === option.out ? "fms-choice t-body-strong" : "fms-choice t-body"}
                            onClick={() =>
                              setDraft((d) => ({ ...d, sentOut: option.out, toWallet: "" }))
                            }
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>

                      {sentOut ? (
                        <p className="t-caption" style={{ margin: 0, color: "var(--ink-3)" }}>
                          It leaves your accounts, so the whole amount counts as spending.
                        </p>
                      ) : (
                        <Select
                          value={draft.toWallet}
                          onChange={(v) => set("toWallet", v)}
                          options={allWallets}
                          placeholder={ghost.toWallet ? `${ghost.toWallet} (suggested)` : "Pick a wallet"}
                          invalid={Boolean(errorFor("toWallet"))}
                        />
                      )}
                    </div>
                  ) : (
                    <Select
                      value={draft.toWallet}
                      onChange={(v) => set("toWallet", v)}
                      options={allWallets}
                      placeholder={ghost.toWallet ? `${ghost.toWallet} (suggested)` : "Pick a wallet"}
                      invalid={Boolean(errorFor("toWallet"))}
                    />
                  )}
                </Row>
              )}

              {/* What this row will count as, worked out from the answer above.
                  The Excel asked you to pick "Money Send" or "Transaction Fee"
                  by hand and lost the money whenever you did not. */}
              {draft.flow === "Opening" && (
                <Row label="Counts as">
                  <div className="fms-derived">
                    <StatusPill status="none">Starting balance</StatusPill>
                    <span className="t-caption" style={{ color: "var(--ink-2)" }}>
                      Money you already had. It sets the account's balance without counting as
                      income, so your revenue figures stay true.
                    </span>
                  </div>
                </Row>
              )}

              {draft.flow === "Transfer" && (
                <Row label="Counts as">
                  <div className="fms-derived">
                    <StatusPill status={sentOut ? "over" : "none"}>
                      {sentOut ? "Money Send" : draft.fee > 0 ? "Transaction Fee" : "Not spending"}
                    </StatusPill>
                    <span className="t-caption" style={{ color: "var(--ink-2)" }}>
                      {sentOut
                        ? "The money leaves your accounts, so the whole amount is spending."
                        : draft.fee > 0
                          ? "Still your money, in another pocket. Only the fee is spending."
                          : "Still your money, in another pocket. Nothing here is spending."}
                    </span>
                  </div>
                </Row>
              )}

              {needs(draft.flow, "category") && categories.length > 1 && (
                <Row
                  label="Category"
                  required
                  hint={
                    categoryHint
                      ? categoryHint.source === "history"
                        ? `Filed this way ${categoryHint.seen ?? 0} times before`
                        : `Suggested: ${categoryHint.category} (${categoryHint.confidence} confidence)`
                      : undefined
                  }
                >
                  <div className={suggested.has("category") ? "fms-suggested" : undefined}>
                  <Select
                    value={draft.category}
                    onChange={(v) => {
                      setCategoryHint(null);
                      // Choosing it makes it yours, so autofill leaves it alone.
                      unmark("category");
                      setDraft((d) => ({ ...d, category: v as TransactionCategory, item: "" }));
                    }}
                    options={categories}
                    placeholder={ghost.category ? `${ghost.category} (suggested)` : "Pick a category"}
                  />
                  </div>
                </Row>
              )}

              {needs(draft.flow, "item") && (
                <Row
                  label="Item"
                  hint={
                    ghost.item && !draft.item
                      ? `Suggested: ${ghost.item}`
                      : reasonFor("item")
                  }
                >
                  <Select
                    value={draft.item}
                    onChange={(v) => set("item", v)}
                    options={items}
                    placeholder="Pick an item"
                  />
                </Row>
              )}

              <Row
                label="Amount"
                required
                error={errorFor("amount")}
                hint={guess && draft.amount === null ? guess.why : undefined}
              >
                <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "stretch" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <AmountInput
                      value={draft.amount}
                      onChange={(v) => set("amount", v)}
                      invalid={Boolean(errorFor("amount"))}
                    />
                  </div>
                  {/*
                    Offered, never filled. An amount that is silently almost
                    right is the one mistake here that quietly corrupts a
                    balance, so this takes a deliberate tap.
                  */}
                  {guess && draft.amount === null && (
                    <Button onClick={() => set("amount", guess.amount)}>
                      {formatMoney(guess.amount)}
                    </Button>
                  )}
                </div>
              </Row>

              {/*
                The fee shows its own errors, and this is not cosmetic.

                It was the one money field with no `error` prop, so a fee
                `checkDraft` refuses left Save disabled with nothing on screen
                saying why: a dead button and no explanation, which is a worse
                failure than the bad value it was refusing.
              */}
              {needs(draft.flow, "fee") && (
                <Row
                  label="Fee"
                  error={errorFor("fee")}
                  hint={ghost.fee ? `Usually ${formatMoney(ghost.fee)}` : undefined}
                >
                  <AmountInput
                    value={draft.fee}
                    onChange={(v) => set("fee", v ?? 0)}
                    invalid={Boolean(errorFor("fee"))}
                  />
                </Row>
              )}

              {needs(draft.flow, "description") && (
                <Row label="Description" span hint={ghost.description && !draft.description ? `Last time: ${ghost.description}` : undefined}>
                  <div className={suggested.has("description") ? "fms-suggested" : undefined}>
                  <TextInput
                    value={draft.description}
                    onChange={(v) => {
                      unmark("description");
                      set("description", v);
                    }}
                    placeholder="What was it for?"
                  />
                  </div>
                </Row>
              )}

              {needs(draft.flow, "notes") && (
                <Row label="Notes" span>
                  <TextInput value={draft.notes} onChange={(v) => set("notes", v)} placeholder="Anything worth remembering" />
                </Row>
              )}

              {needs(draft.flow, "status") && (
                <Row label="Status">
                  <Select
                    value={draft.status}
                    onChange={(v) => set("status", v as Draft["status"])}
                    options={STATUSES}
                    placeholder={ghost.status ? `${ghost.status} (suggested)` : "Pick a status"}
                  />
                </Row>
              )}
            </div>

            {/* Warnings sit between the fields and the action, where they
                interrupt without blocking. */}
            <div style={{ display: "grid", gap: "var(--space-2)", marginTop: "var(--space-3)" }}>
              {check.warnings.map((w) => (
                <Alert key={w.message} status="warn">{w.message}</Alert>
              ))}
              {check.repaymentSplit && check.repaymentSplit.interest > 0 && (
                <Alert status="info" title="This payment splits in two">
                  Principal <Money value={check.repaymentSplit.principal} size="s" /> · Interest{" "}
                  <Money value={check.repaymentSplit.interest} size="s" tone="var(--flow-debt-text)" />
                </Alert>
              )}
              {submitted && check.errors.length > 0 && (
                <Alert status="over" title={`${check.errors.length} thing${check.errors.length === 1 ? "" : "s"} to fix`}>
                  {check.errors.map((e) => e.message).join(" ")}
                </Alert>
              )}
            </div>

            <div className="fms-actions">
              {tone && <FlowBadge flow={tone} />}
              <span style={{ flex: 1 }} />
              {editing ? (
                <Button onClick={cancelEdit}>Cancel</Button>
              ) : (
                <Button onClick={() => setDraft({ ...emptyDraft(draft.date), flow: "Spending" })}>
                  Clear
                </Button>
              )}
              <Button variant="primary" onClick={save}>
                {editing ? "Save changes" : "Save transaction"}
              </Button>
            </div>
          </>
        )}
      </section>

      {/* ── Right: balances, exactly like the Excel INPUT PAGE ──────────── */}
      <aside className="fms-panel fms-side">
        {balance && (
          <div
            style={{
              padding: "var(--space-3)",
              borderRadius: "var(--radius-md)",
              background: balance.goesNegative ? "var(--over-bg)" : "var(--brand-50)",
              marginBottom: "var(--space-4)",
            }}
          >
            <div className="t-label" style={{ color: "var(--ink-2)" }}>{balance.wallet} after this</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-2)", marginTop: 2 }}>
              <Money value={balance.before} size="s" tone="var(--ink-3)" />
              <span aria-hidden style={{ color: "var(--ink-3)" }}>→</span>
              <Money value={balance.after} size="l" tone={balance.goesNegative ? "var(--over)" : "var(--ink)"} />
            </div>
          </div>
        )}

        <div className="t-label" style={{ color: "var(--ink-2)", marginBottom: "var(--space-2)" }}>
          Wallets
        </div>
        {balances.filter((w) => !w.isSavings).map((w) => (
          <BalanceRow key={w.name} wallet={w} />
        ))}

        {balances.some((w) => w.isSavings) && (
          <>
            <div className="t-label" style={{ color: "var(--ink-2)", margin: "var(--space-4) 0 var(--space-2)" }}>
              Savings
            </div>
            {balances.filter((w) => w.isSavings).map((w) => (
              <BalanceRow key={w.name} wallet={w} />
            ))}
          </>
        )}

        {debts.length > 0 && (
          <>
            <div className="t-label" style={{ color: "var(--ink-2)", margin: "var(--space-4) 0 var(--space-2)" }}>
              Owed
            </div>
            {debts.map((d) => (
              <div key={d.id} className="fms-balrow">
                <span className="t-caption">{d.name}</span>
                <Money value={outstandingOf(transactions, d.id)} size="s" tone="var(--flow-debt-text)" />
              </div>
            ))}
          </>
        )}
      </aside>

      <AskPanel
        sink={sink}
        deleted={deleted}
        debts={debts}
        lastSaved={lastSaved}
        uid={uid}
        settings={settings}
        transactions={transactions}
        budgets={budgets}
        reference={reference}
        asOf={asOf}
      />
    </div>
  );
}

function BalanceRow({ wallet }: { wallet: WalletBalance }) {
  const empty = wallet.balance === 0;
  return (
    <div className="fms-balrow">
      <span className="t-caption" style={{ color: empty ? "var(--ink-3)" : "var(--ink)" }}>
        {wallet.name}
      </span>
      <Money value={wallet.balance} size="s" tone={empty ? "var(--ink-3)" : undefined} />
    </div>
  );
}

/**
 * One field. Label sits above on a phone and beside the control on desktop,
 * the horizontal form is what lets the whole page fit without scrolling.
 */
function Row({
  label,
  children,
  required,
  error,
  hint,
  span,
}: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
  error?: string | undefined;
  hint?: string | undefined;
  span?: boolean;
}) {
  return (
    <div className={span ? "fms-row fms-row-span" : "fms-row"}>
      <label className="t-label fms-rowlabel">
        {label}
        {required && <span style={{ color: "var(--over)" }}> *</span>}
      </label>
      <div style={{ minWidth: 0 }}>
        {children}
        {(error || hint) && (
          <p
            className="t-micro"
            style={{ margin: "3px 0 0", color: error ? "var(--over)" : "var(--ink-3)" }}
          >
            {error || hint}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Keeping a half-typed entry across a navigation or a reload.
 *
 * `sessionStorage` is the right scope: it survives moving around the app and
 * refreshing the page, and it is gone when the tab closes, so yesterday's
 * abandoned draft is not waiting to be mistaken for today's entry.
 *
 * Every read and write is guarded. Storage throws in a private window and in
 * a few embedded browsers, and a form that refuses to render because it could
 * not save a draft is a worse outcome than a draft that was not saved.
 */
const DRAFT_KEY = "fms.add.draft";

function keepDraft(draft: Draft): void {
  try {
    // Nothing worth keeping, and nothing worth restoring into an empty form.
    const empty =
      draft.amount === null &&
      !draft.item.trim() &&
      !draft.description.trim() &&
      !draft.notes.trim() &&
      !draft.fromWallet &&
      !draft.toWallet;
    if (empty) {
      window.sessionStorage.removeItem(DRAFT_KEY);
      return;
    }
    window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // A convenience is not worth a broken screen.
  }
}

function restoreDraft(): Draft | null {
  try {
    const raw = window.sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Draft>;
    // Shaped, not trusted: a stored draft is still input.
    if (!parsed || typeof parsed !== "object" || typeof parsed.date !== "string") return null;
    return { ...emptyDraft(), ...parsed } as Draft;
  } catch {
    return null;
  }
}

function forgetDraft(): void {
  try {
    window.sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    // Nothing to do, and nothing worth telling anyone about.
  }
}
