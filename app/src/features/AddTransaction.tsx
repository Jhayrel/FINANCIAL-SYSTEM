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
  runningBalance,
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
import type { Budgets, ReferenceLists, Transaction, TransactionCategory, WalletBalance } from "../domain/types";

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
  editing,
  onCancelEdit,
  ai,
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
  /** A saved row being corrected, rather than a new entry. */
  editing: Transaction | null;
  onCancelEdit: () => void;
  ai: AiSettings;
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
  const [draft, setDraft] = useState<Draft>(() => ({ ...emptyDraft(), flow: "Spending" }));
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

    if (editing) {
      /**
       * Same id, same record number. An edit is the entry corrected, not a
       * new one, and reissuing either would break every reference to it.
       */
      onUpdate(
        draftToTransactions(draft, editing.recordNumber, editing.id, check.repaymentSplit),
      );
    } else {
      onSave(
        draftToTransactions(draft, nextRecordNumber, `t-${Date.now()}`, check.repaymentSplit),
      );
    }

    // The card that supplied this row can now say it was saved.
    setLastSaved({ draft, at: Date.now() });
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
        setSuggested(new Set());
        setSubmitted(false);
      },
      add: (d, by) => {
        const c = checkDraft(d, transactions, reference, debts);
        // Belt and braces: the button is already disabled when this fails.
        if (!c.ok) return;
        proposed += 1;
        onSave(
          draftToTransactions(d, nextRecordNumber, `t-${Date.now()}-${proposed}`, c.repaymentSplit),
          // Recorded as the assistant's, because it was: the owner approved
          // it, but they did not type it, and six months from now that is the
          // difference worth being able to look up.
          by ?? { actor: "ai", via: "ai_chat" },
        );
      },
    }),
    [transactions, reference, debts, nextRecordNumber, onSave],
  );

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
                  <Row label="Debt" required error={errorFor("debt")}>
                    <Select
                      value={draft.debtId ?? ""}
                      onChange={(v) => set("debtId", v || undefined)}
                      options={debts.map((d) => d.name)}
                      placeholder="Pick a debt"
                      invalid={Boolean(errorFor("debt"))}
                    />
                  </Row>
                  <Row label="Effect" required error={errorFor("debtEffect")}>
                    <Select
                      value={draft.debtEffect ?? ""}
                      onChange={(v) => set("debtEffect", (v || undefined) as DebtEffect | undefined)}
                      options={EFFECTS.map((e) => EFFECT_LABEL[e] ?? e)}
                      placeholder="What does this do?"
                      invalid={Boolean(errorFor("debtEffect"))}
                    />
                  </Row>
                </>
              )}

              {needs(draft.flow, "fromWallet") && (
                <Row
                  label="From wallet"
                  required={draft.flow !== "Debt"}
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

              {needs(draft.flow, "toWallet") && (
                <Row
                  label={draft.flow === "Transfer" ? "Where to" : "To wallet"}
                  required={draft.flow !== "Debt"}
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

              {needs(draft.flow, "fee") && (
                <Row label="Fee" hint={ghost.fee ? `Usually ${formatMoney(ghost.fee)}` : undefined}>
                  <AmountInput value={draft.fee} onChange={(v) => set("fee", v ?? 0)} />
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
        lastSaved={lastSaved}
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
