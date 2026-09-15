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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
import { debtDue, effectsFor, outstandingOf, positionsOf } from "../domain/debt";
import { formatMoney, type Centavos } from "../domain/money";
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
import { AskPanel } from "./AskPanel";
import { useProposalSink } from "./useProposalSink";
import { useConfirm } from "../components/Confirm";
import type { Provenance } from "../domain/activity";
import type { CategoryResult } from "../data/aiClient";
import { predictAmount, steadyValue, type DueBill } from "../domain/predict";
import { monthBills } from "../domain/budgetView";
import { formatMedium, getMonth, getYear, MONTH_NAMES } from "../domain/dates";
import { duplicateHeadline, duplicatesOf } from "../domain/duplicates";
import { entryImpact } from "../domain/entryImpact";
import { whenWords } from "./Dashboard";
import { useReportScreen } from "./screenReport";
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

/**
 * Every effect's words. Which ones a debt offers depends on which way it is
 * owed (`effectsFor`): a draw against money lent to a friend counted the same
 * pesos twice.
 */
const EFFECT_LABEL: Record<DebtEffect, string> = {
  draw: "Draw: borrow more",
  repay: "Repay: pay it down",
  interest: "Interest or fee",
  fee: "Fee",
  writeoff: "Write-off: forgiven",
  lend: "Lend: money out to them",
  collect: "Collect: they paid you back",
};

/** Due now chips shown before "Show all": enough to act on, not a wall. */
const DUE_SHOWN = 3;

const STATUSES = ["Paid", "Done", "Received", "Transferred", "Withdrawn"];

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
  reserved,
  editing,
  onCancelEdit,
  ai,
  uid,
  settings,
  budgets,
  asOf,
  showChat,
  incoming,
  lastSaved,
  onSaved,
  onEditRow,
  onOpenBudget,
  onShowRows,
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
  /** Numbers still taken by rows outside the ledger. See `useProposalSink`. */
  reserved?: readonly Transaction[] | undefined;
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
  /**
   * Whether the assistant sits beside the form.
   *
   * Only on a computer, and only while AI and its chat are on. A phone has the
   * assistant on a tab of its own, so the form there is just the form.
   */
  showChat: boolean;
  /** A card the assistant sent to the form from elsewhere ("Edit first"). */
  incoming: { draft: Draft; at: number } | null;
  /** The last row this form saved, shared so a card anywhere can say so. */
  lastSaved: { draft: Draft; at: number } | null;
  onSaved: (saved: { draft: Draft; at: number }) => void;
  /** Loads a saved row back into this form, from the latest entries beside it. */
  onEditRow?: ((row: Transaction) => void) | undefined;
  /** The Budget screen, for a month that has no budget yet. */
  onOpenBudget?: (() => void) | undefined;
  /** The Database searched for these words, such as a record number. */
  onShowRows?: ((query: string) => void) | undefined;
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
  const { confirm, dialog } = useConfirm();

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
  // Held by the app now (`lastSaved` in the props), because the card that
  // supplied a row may be in the floating chat or on the phone's AI tab.

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
  /** A description the history or the model offers, shown in the empty field and never typed in for you. */
  const [descriptionIdea, setDescriptionIdea] = useState("");

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
    setDraft(draftForEditing(editing, transactions));
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
          if (latest.current !== run) return;

          /**
           * An idea, not an entry.
           *
           * It was written into the field, so Item "Food" saved with the
           * description "food", and a green bar beside it said the app had
           * done it. A description is what this one was, which only you
           * know. The idea waits in the empty field, and Tab takes it.
           */
          const idea = (result.text ?? "").trim();
          setDescriptionIdea(idea && idea.toLowerCase() !== draft.item.trim().toLowerCase() ? idea : "");
        }
      })();
    }, AUTOFILL_DELAY_MS);

    return () => clearTimeout(timer);
    // Deliberately keyed on the answers a suggestion depends on, not on the
    // whole draft: including `description` here would retrigger the pass
    // with every character typed into it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.flow, draft.item, draft.category, draft.fromWallet, draft.toWallet, draft.description, transactions, reference, ai]);

  /**
   * Fill the form from a draft the assistant read, and mark what arrived.
   *
   * The fields did update the moment a card was sent over, but they updated
   * silently, and on a wide screen the panel sits beside the form: half a
   * dozen fields change at once, several rows apart, and nothing says which of
   * them moved.
   *
   * `fms-suggested` is the marker the form already uses for a field the app
   * filled in rather than you, and it clears itself the moment you edit the
   * field. That is exactly this: it came from the card, it is yours to change,
   * and once you change it the mark goes.
   *
   * Only the fields the card actually carried. Marking a blank one would claim
   * something was filled in when nothing was.
   */
  const applyDraft = useCallback((d: Draft): void => {
    setDraft(d);
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
  }, []);

  /**
   * What the assistant beside this form may do: the same actions, through
   * the same checks, as the floating chat and the phone's AI tab
   * (features/useProposalSink.ts). "Edit first" fills this form.
   */
  const sink = useProposalSink({
    transactions,
    reference,
    debts,
    reserved,
    onSave,
    onBin,
    onBinMany,
    onRestore: onRestoreRow,
    onUse: applyDraft,
  });
  const nextRecordNumber = sink.nextRecordNumber;

  /**
   * A card sent here from outside this screen: "Edit first" in the floating
   * chat or on the phone's AI tab. Keyed on when it was sent, so sending the
   * same card twice fills the form twice.
   */
  useEffect(() => {
    if (incoming) applyDraft(incoming.draft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming?.at]);

  const check = useMemo(
    () => checkDraft(draft, transactions, reference, debts, asOf),
    [draft, transactions, reference, debts, asOf],
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
  /**
   * Bills to log now: the Budget screen's own list for this month.
   *
   * This strip used its own prediction with a four-day window, so the Add form
   * showed two bills due while the Budget screen showed three, and Microsoft
   * Office 365 was due on one screen and nowhere on the other. It reads
   * `monthBills` now, the one definition, and shows the unpaid ones due within
   * a week, late first. The wallet is still the one each bill is usually paid from.
   */
  const due = useMemo<DueBill[]>(() => {
    const month = monthBills(transactions, reference, getYear(asOf), getMonth(asOf), asOf);
    return month.bills
      .filter((b) => (b.state === "late" || b.state === "soon" || b.state === "due") && (b.daysToDue ?? 0) <= 7)
      .map((b) => {
        const days = b.daysToDue ?? 0;
        return {
          item: b.item,
          category: b.category,
          expected: b.amount,
          dueDate: asOf,
          daysAway: days,
          wallet: steadyValue(
            transactions.filter((t) => t.type === "Spending" && t.item === b.item).map((t) => t.fromWallet),
          ),
          why:
            days < 0
              ? `${-days} ${days === -1 ? "day" : "days"} late, going by last month`
              : days === 0
                ? "Due today, going by last month"
                : `Due in ${days} ${days === 1 ? "day" : "days"}, going by last month`,
        };
      });
  }, [transactions, reference, asOf]);

  /**
   * Debt payments late or due within a week, beside the bills.
   *
   * A credit line's payment is as much a thing due now as the Wi-Fi bill, and
   * it was the one thing the strip never offered: Maya Credit went twelve days
   * past its date on 2026-09-15 with nothing on this screen saying so.
   */
  const debtDues = useMemo(
    () =>
      positionsOf(
        debts.filter((d) => !d.archived),
        transactions,
        asOf,
      )
        .map((p) => debtDue(p, transactions, asOf))
        .filter((d) => d.daysToDue !== undefined && d.daysToDue <= 7),
    [debts, transactions, asOf],
  );

  /**
   * Everything due now, late first, as one list.
   *
   * It showed at most four bills and dropped the rest without a word, so the
   * fifth bill due never appeared anywhere on the form. All of them are here;
   * three show until "Show all" is pressed, so ten due bills do not push the
   * form off the screen.
   */
  const [allDue, setAllDue] = useState(false);

  /**
   * As many as fit on one line, then "Show all".
   *
   * It showed three, always: "Show all 4" beside three chips and room for two
   * more. The line is measured, so a wide form shows what fits and a phone
   * shows one or two.
   */
  const [chipEl, setChipEl] = useState<HTMLDivElement | null>(null);
  const [perRow, setPerRow] = useState(DUE_SHOWN);
  useEffect(() => {
    if (!chipEl || typeof ResizeObserver === "undefined") return;
    const measure = (): void => setPerRow(Math.max(1, Math.floor((chipEl.clientWidth + 8) / (180 + 8))));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(chipEl);
    return () => observer.disconnect();
  }, [chipEl]);
  const chips = useMemo<DueChip[]>(() => {
    const fromDebts: DueChip[] = debtDues.map((d) => {
      const { debt } = d.position;
      const owed = debt.kind === "payable";
      const effect: DebtEffect = owed ? "repay" : "collect";
      return {
        key: `debt-${debt.id}`,
        name: debt.name,
        amount: d.amountDue,
        late: (d.daysToDue ?? 0) < 0,
        why: `${whenWords(d.daysToDue)}${
          d.basis === "last-payment" || d.basis === "borrowed" ? ", going by the last payment" : ""
        }`,
        inForm: (x) => x.flow === "Debt" && x.debtId === debt.id && x.debtEffect === effect,
        fill: () => ({
          ...emptyDraft(asOf),
          flow: "Debt",
          debtId: debt.id,
          debtEffect: effect,
          fromWallet: owed ? debt.wallet : "",
          toWallet: owed ? "" : debt.wallet,
          amount: d.amountDue > 0 ? d.amountDue : null,
        }),
      };
    });
    const fromBills: DueChip[] = due.map((b) => ({
      key: `bill-${b.item}`,
      name: b.item,
      amount: b.expected,
      late: b.daysAway < 0,
      why: b.why,
      inForm: (x) => x.flow === "Spending" && x.item === b.item && x.category === b.category,
      fill: () => ({
        ...emptyDraft(asOf),
        flow: "Spending",
        category: b.category,
        item: b.item,
        // Filled because the point is one tap; it is in the field for checking before saving.
        amount: b.expected,
        fromWallet: b.wallet,
        status: "Paid",
      }),
    }));
    return [...fromDebts, ...fromBills].sort((a, b) => Number(b.late) - Number(a.late));
  }, [debtDues, due, asOf]);

  /** The same entry already in the ledger, as the assistant's cards have always checked. */
  const dupe = useMemo(
    () =>
      draft.flow
        ? duplicatesOf(draft, transactions, { ignoreId: draft.id ?? editing?.id, most: 1 })[0]
        : undefined,
    [draft, transactions, editing],
  );

  /** What this entry does to its month's budget, while the amount is still in the field. */
  const impact = useMemo(() => entryImpact(draft, transactions, budgets, asOf), [draft, transactions, budgets, asOf]);

  const guess = useMemo(() => predictAmount(transactions, draft), [transactions, draft]);


  const allWallets = [...reference.wallets, ...reference.savings];
  const items = itemsFor(draft.flow, draft.category, reference);
  const categories = categoriesFor(draft.flow);

  const errorFor = (field: string): string | undefined =>
    submitted ? check.errors.find((e) => e.field === field)?.message : undefined;

  /**
   * Warnings wait for an amount.
   *
   * The form opened saying "No item, so this will not appear in any breakdown
   * by item. Save it without one?" before anything had been typed at all. A
   * form with nothing in it has nothing to warn about yet.
   */
  const showWarnings = submitted || draft.amount !== null;

  /** Debts open to new rows, and the one a row being corrected is filed against. */
  const debtOptions = debts.filter((d) => !d.archived || d.id === draft.debtId);
  const selectedDebt = debts.find((d) => d.id === draft.debtId);
  const effects = effectsFor(selectedDebt?.kind ?? "payable");
  const namedDebt = check.debtPayment ? debts.find((d) => d.id === check.debtPayment?.debtId) : undefined;

  /** The number shown while correcting: the payment's own, when a split pair was opened by its interest row. */
  const editingNumber = editing
    ? (transactions.find((t) => t.id === draft.id)?.recordNumber ?? editing.recordNumber)
    : 0;

  /** What this entry does to the debt it is filed against. */
  const debtAfter = (() => {
    if (draft.flow !== "Debt" || !selectedDebt || !draft.debtEffect || draft.amount === null) return null;
    const base = draft.id
      ? transactions.filter((t) => t.id !== draft.id && t.id !== `${draft.id}-interest`)
      : transactions;
    const before = outstandingOf(base, selectedDebt.id);
    const amount = draft.amount;
    const change =
      draft.debtEffect === "draw" || draft.debtEffect === "lend"
        ? amount
        : draft.debtEffect === "repay"
          ? -(check.repaymentSplit?.principal ?? amount)
          : draft.debtEffect === "collect" || draft.debtEffect === "writeoff"
            ? -amount
            : 0;
    return { name: selectedDebt.name, owed: selectedDebt.kind === "payable", before, after: before + change };
  })();

  /**
   * A spending row that names a debt, turned into the debt movement it is.
   *
   * The amount carries the fee with it, since a debt row has no fee field and
   * all of it left the wallet. What was written in the description moves to
   * the notes. A row being corrected keeps its id, so saving changes that row
   * rather than adding one: this is how the Maya Credit bills filed as
   * spending are put right, one at a time, from the Database.
   */
  const bookAsDebt = (): void => {
    if (!namedDebt) return;
    const owed = namedDebt.kind === "payable";
    setDraft((d) => ({
      ...emptyDraft(d.date),
      id: d.id,
      flow: "Debt",
      debtId: namedDebt.id,
      debtEffect: owed ? "repay" : "lend",
      fromWallet: d.fromWallet || namedDebt.wallet,
      amount: d.amount === null ? null : d.amount + d.fee,
      notes: [d.description, d.notes].filter((x) => x.trim()).join(". "),
    }));
    setSuggested(new Set());
    setSubmitted(false);
  };

  /** One tap on something due: into the form, asking first when that would replace typing. */
  const fillFrom = async (chip: DueChip): Promise<void> => {
    if (chip.inForm(draft)) return;
    if (!isBlankDraft(draft)) {
      const ok = await confirm({
        title: `Put ${chip.name} in the form?`,
        body: "What is in the form now is replaced. Nothing has been saved yet, so nothing else changes.",
        confirmLabel: "Replace it",
        tone: "normal",
      });
      if (!ok) return;
    }
    applyDraft(chip.fill());
  };

  /** When the last save went through, so a second press of the same button is not a second entry. */
  const lastPress = useRef(0);

  useReportScreen(
    () => ({
      screen: "Add",
      lines: [
        editing ? `Correcting saved record #${String(editingNumber).padStart(4, "0")}.` : "Adding a new entry.",
        draft.flow
          ? `The form holds: ${draft.flow}${draft.item ? `, ${draft.item}` : ""}${
              draft.amount !== null ? `, ${formatMoney(draft.amount + draft.fee)}` : ", no amount yet"
            }${draft.fromWallet ? `, from ${draft.fromWallet}` : ""}${draft.toWallet ? `, into ${draft.toWallet}` : ""}, dated ${draft.date}.`
          : "",
        ...(showWarnings ? check.warnings.map((w) => `The form warns: ${w.message}`) : []),
        impact
          ? `Effect on the budget: ${MONTH_NAMES[impact.month - 1]} ${impact.track === "billsSubs" ? "bills and subscriptions" : "spending"} goes from ${formatMoney(
              impact.budget - impact.spentBefore,
            )} left to ${formatMoney(impact.leftAfter)}${impact.budget === 0 ? ", with no budget set" : ""}.`
          : "",
        chips.length > 0 ? `Due now: ${chips.map((c) => `${c.name} ${formatMoney(c.amount)} (${c.why})`).join(", ")}.` : "",
      ],
    }),
    [draft, check, impact, chips, editing, showWarnings, editingNumber],
  );

  /** Every check on the form, once, each with the one thing to do about it. */
  const checks: { key: string; text: string; action?: React.ReactNode }[] = [];
  if (showWarnings) {
    for (const w of check.warnings) {
      if (check.debtPayment && w.field === "item") continue;
      checks.push({ key: w.message, text: w.message });
    }
  }
  if (check.debtPayment) {
    checks.push({
      key: "debt-named",
      text: check.warnings.find((w) => w.field === "item")?.message ?? `${check.debtPayment.name} is a debt, not spending.`,
      action: (
        <>
          {" "}
          <button type="button" className="t-caption fms-linkbtn" onClick={bookAsDebt}>
            {namedDebt?.kind === "receivable" ? "Book it as lending" : "Book it as a repayment"}
          </button>
        </>
      ),
    });
  }
  if (dupe) {
    const number = `#${String(dupe.row.recordNumber).padStart(4, "0")}`;
    checks.push({
      key: "dupe",
      text: `${duplicateHeadline(dupe)} ${dupe.evidence.map((e) => e.replace(/\.+$/, "")).join("; ")}. Save anyway if it is a second, separate one.`,
      ...(onShowRows
        ? {
            action: (
              <>
                {" "}
                <button type="button" className="t-caption fms-linkbtn" onClick={() => onShowRows(number)}>
                  Open {number}
                </button>
              </>
            ),
          }
        : {}),
    });
  }
  if (check.repaymentSplit && check.repaymentSplit.interest > 0 && check.repaymentSplit.principal > 0) {
    checks.push({
      key: "split",
      text: `This payment splits in two: ${formatMoney(check.repaymentSplit.principal)} principal and ${formatMoney(check.repaymentSplit.interest)} interest.`,
    });
  }

  const save = async (): Promise<void> => {
    setSubmitted(true);
    if (!check.ok) return;

    // One entry per press: a double tap on a slow phone saved the row twice.
    const pressed = Date.now();
    if (pressed - lastPress.current < 1500) return;
    lastPress.current = pressed;

    /**
     * Extra zeros are asked about once, before they move every total.
     * See `domain/unusual.ts`: a real windfall saves with one more tap.
     */
    if (check.unusual) {
      const total = (draft.amount ?? 0) + draft.fee;
      const ok = await confirm({
        title: `Save ${formatMoney(total)}?`,
        body: `That is ${check.unusual.times} times the largest entry of its kind so far (${formatMoney(check.unusual.largest)}). If a zero slipped in, go back and correct the amount first.`,
        confirmLabel: `Save ${formatMoney(total)}`,
        tone: "normal",
      });
      if (!ok) {
        lastPress.current = 0;
        return;
      }
    }

    /**
     * An edit is an edit however the row got here.
     *
     * This used to key on the `editing` prop alone, which is only set by the
     * Database screen. A row loaded from the chat carries its id in the draft
     * and would have been saved as a brand new entry with a new record
     * number, quietly duplicating it. The id is the fact; the prop is one way
     * of arriving at it.
     */
    const target = (draft.id ? transactions.find((t) => t.id === draft.id) : undefined) ?? editing;

    if (target) {
      /**
       * Same id, same record number. An edit is the entry corrected, not a
       * new one, and reissuing either would break every reference to it.
       */
      const rows = draftToTransactions(draft, target.recordNumber, target.id, check.repaymentSplit);
      onUpdate(rows);
      /**
       * A split repayment corrected so it no longer covers interest: its old
       * interest row would stay behind, booking interest that the payment no
       * longer includes. It goes to the bin, where it can still be restored.
       */
      const interest = transactions.find((t) => t.id === `${target.id}-interest`);
      if (interest && !rows.some((r) => r.id === interest.id)) onBin(interest.id);
    } else {
      onSave(
        draftToTransactions(draft, nextRecordNumber, `t-${Date.now()}`, check.repaymentSplit),
      );
    }

    // The card that supplied this row can now say it was saved.
    onSaved({ draft, at: Date.now() });
    forgetDraft();
    setDraft({ ...emptyDraft(draft.date), flow: "Spending" });
    setSuggested(new Set());
    setSubmitted(false);
  };

  const cancelEdit = (): void => {
    onCancelEdit();
    setDraft({ ...emptyDraft(draft.date), flow: "Spending" });
    setSuggested(new Set());
    setSubmitted(false);
  };

  /**
   * Clearing asks first when there is something to lose.
   *
   * The workbook's ClearForm asked "Do you want to clear the form?" every
   * time. Clear here threw a half-typed entry away on one tap, beside the
   * Save button, which is exactly where a thumb slips. An empty form clears
   * without a question, because there is nothing to protect.
   */
  const clearForm = async (): Promise<void> => {
    if (!isBlankDraft(draft)) {
      const ok = await confirm({
        title: "Clear the form?",
        body: "What you have typed is removed. Nothing has been saved yet, so nothing else changes.",
        confirmLabel: "Clear the form",
        tone: "danger",
      });
      if (!ok) return;
    }
    setDraft({ ...emptyDraft(draft.date), flow: "Spending" });
    setSuggested(new Set());
    setSubmitted(false);
  };

  /**
   * Changing the type keeps what you typed that still means the same thing.
   *
   * It emptied the whole form, so typing an amount and then noticing it was a
   * Transfer, not Spending, threw the amount away. The date, the amount, and a
   * description or notes you wrote yourself carry over when the new type has
   * those fields. Wallets, items and categories do not: they belong to the
   * type being left, and carrying them would file money under the wrong one.
   */
  const switchFlow = (flow: Flow): void => {
    if (flow === draft.flow) return;
    setDraft((d) => ({
      ...emptyDraft(d.date),
      flow,
      amount: d.amount,
      description:
        needs(flow, "description") && !suggested.has("description") ? d.description : "",
      notes: needs(flow, "notes") ? d.notes : "",
    }));
    setSuggested((s) => (s.has("amount") ? new Set(["amount"]) : new Set()));
    setCategoryHint(null);
    setSubmitted(false);
  };

  const tone = FLOWS.find((f) => f.id === draft.flow)?.tone;

  // Which fields are on the form, so two that belong together can share a line on a wide one.
  const showFrom = needs(draft.flow, "fromWallet") && debtSide !== "in";
  const showTo = needs(draft.flow, "toWallet") && debtSide !== "out";
  const showCategory = needs(draft.flow, "category") && categories.length > 1;
  const showItem = needs(draft.flow, "item");
  const showFee = needs(draft.flow, "fee");
  // The total only says something when there is a fee in it.
  const showTotal = showFee && draft.fee > 0;
  const showStatus = needs(draft.flow, "status");

  return (
    <div className={showChat ? "fms-entry" : "fms-entry fms-entry--nochat"}>
      {dialog}
      {/* ── Left: the form ─────────────────────────────────────────────── */}
      <section className="fms-panel fms-entryform">
        {/* Not while correcting a saved row: a tap here would turn that row into the bill. */}
        {!editing && chips.length > 0 && (
          <div className="fms-duestrip">
            <div className="fms-duestrip-head">
              <span className="t-caption" style={{ color: "var(--ink-2)" }}>
                {chips.length} due now. One tap fills the form, for checking before saving.
              </span>
              {chips.length > perRow && (
                <button
                  type="button"
                  className="t-caption fms-linkbtn"
                  aria-expanded={allDue}
                  onClick={() => setAllDue((x) => !x)}
                >
                  {allDue ? "Show fewer" : `Show all ${chips.length}`}
                </button>
              )}
            </div>
            <div className="fms-duechips" ref={setChipEl}>
              {(allDue ? chips : chips.slice(0, perRow)).map((chip) => {
                const here = chip.inForm(draft);
                return (
                  <button
                    key={chip.key}
                    type="button"
                    className={here ? "fms-duechip is-in-form" : "fms-duechip"}
                    aria-pressed={here}
                    onClick={() => void fillFrom(chip)}
                    style={here ? undefined : { borderColor: chip.late ? "var(--over)" : "var(--hairline-strong)" }}
                  >
                    <span className="t-body-strong fms-truncate" style={{ maxWidth: "100%" }}>
                      {chip.name}
                    </span>
                    <span className="t-num-s">{formatMoney(chip.amount)}</span>
                    <span className="t-micro" style={{ color: chip.late && !here ? "var(--over)" : "var(--ink-3)" }}>
                      {here ? "In the form" : chip.why}
                    </span>
                  </button>
                );
              })}
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
                onClick={() => switchFlow(f.id)}
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
              <Row label="Record number" inline half hint={editing ? "Correcting a saved entry" : undefined}>
                <span className="t-num-s fms-readonly">
                  {String(editing ? editingNumber : nextRecordNumber).padStart(4, "0")}
                </span>
              </Row>

              <Row label="Date" required half error={errorFor("date")}>
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
                  <Row label="Debt" required half error={errorFor("debt")}>
                    <Select
                      value={selectedDebt?.name ?? ""}
                      onChange={(name) =>
                        setDraft((d) => {
                          const debt = debtOptions.find((x) => x.name === name);
                          if (!debt) return { ...d, debtId: undefined };
                          // Another direction cannot keep an effect it does not take.
                          const effect =
                            d.debtEffect && effectsFor(debt.kind).includes(d.debtEffect) ? d.debtEffect : undefined;
                          const next: Draft = { ...d, debtId: debt.id, debtEffect: effect };
                          // The account the debt moves through, when no wallet is picked yet.
                          if (next.fromWallet || next.toWallet || !debt.wallet) return next;
                          return effect
                            ? withDebtEffect({ ...next, fromWallet: debt.wallet }, effect)
                            : { ...next, fromWallet: debt.wallet };
                        })
                      }
                      options={debtOptions.map((d) => d.name)}
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
                  <Row label="Effect" required half error={errorFor("debtEffect")}>
                    <Select
                      value={draft.debtEffect ? (EFFECT_LABEL[draft.debtEffect] ?? draft.debtEffect) : ""}
                      onChange={(label) => {
                        const picked = effects.find((e) => EFFECT_LABEL[e] === label);
                        setDraft((d) => (picked ? withDebtEffect(d, picked) : { ...d, debtEffect: undefined }));
                      }}
                      options={effects.map((e) => EFFECT_LABEL[e])}
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
                  half={showFrom && showTo}
                >
                  <Select
                    value={draft.fromWallet}
                    onChange={(v) => set("fromWallet", v)}
                    options={allWallets}
                    placeholder={ghost.fromWallet ? `Usually ${ghost.fromWallet}` : "Pick a wallet"}
                    invalid={Boolean(errorFor("fromWallet"))}
                  />
                </Row>
              )}

              {needs(draft.flow, "toWallet") && debtSide !== "out" && (
                <Row
                  half={showFrom && showTo}
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
                          placeholder={ghost.toWallet ? `Usually ${ghost.toWallet}` : "Pick a wallet"}
                          invalid={Boolean(errorFor("toWallet"))}
                        />
                      )}
                    </div>
                  ) : (
                    <Select
                      value={draft.toWallet}
                      onChange={(v) => set("toWallet", v)}
                      options={allWallets}
                      placeholder={ghost.toWallet ? `Usually ${ghost.toWallet}` : "Pick a wallet"}
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
                  half={showCategory && showItem}
                  hint={
                    categoryHint && categoryHint.source !== "history" && !draft.category
                      ? `Maybe ${categoryHint.category}`
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
                    placeholder={ghost.category ? `Usually ${ghost.category}` : "Pick a category"}
                  />
                  </div>
                </Row>
              )}

              {needs(draft.flow, "item") && (
                <Row
                  label="Item"
                  half={showCategory && showItem}
                  hint={ghost.item && !draft.item ? `Maybe ${ghost.item}` : undefined}
                >
                  <Select
                    value={draft.item}
                    onChange={(v) => set("item", v)}
                    options={items}
                    placeholder="Pick an item"
                  />
                </Row>
              )}

              <Row label="Amount" required half={showFee} error={errorFor("amount")}>
                <div className="fms-amountrow">
                  <div>
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
                <Row label="Fee" half error={errorFor("fee")}>
                  <AmountInput
                    value={draft.fee}
                    onChange={(v) => set("fee", v ?? 0)}
                    invalid={Boolean(errorFor("fee"))}
                  />
                </Row>
              )}

              {/*
                The total, as the workbook showed it under the fee (E17, the
                amount plus the fee), and read only, as E17 was protected. It
                is what the row will carry as its total, so a fee typed into
                the wrong box shows here before saving rather than in a
                balance afterwards.
              */}
              {showTotal && (
                <Row label="Total" inline half={showStatus}>
                  <span className="fms-readonly">
                    <Money value={(draft.amount ?? 0) + draft.fee} />
                  </span>
                </Row>
              )}

              {showStatus && (
                <Row label="Status" half={showTotal}>
                  <Select
                    value={draft.status}
                    onChange={(v) => set("status", v as Draft["status"])}
                    options={STATUSES}
                    placeholder={ghost.status || "Pick a status"}
                  />
                </Row>
              )}

              {needs(draft.flow, "description") && (
                <Row label="Description" span>
                  <div className={suggested.has("description") ? "fms-suggested" : undefined}>
                  <TextInput
                    value={draft.description}
                    onChange={(v) => {
                      unmark("description");
                      set("description", v);
                    }}
                    placeholder={descriptionIdea || "What was it for?"}
                    onKeyDown={(e) => {
                      // Tab takes the idea in the empty field; a second Tab moves on as usual.
                      if (e.key === "Tab" && !e.shiftKey && !draft.description && descriptionIdea) {
                        e.preventDefault();
                        set("description", descriptionIdea);
                      }
                    }}
                  />
                  </div>
                </Row>
              )}

              {needs(draft.flow, "notes") && (
                <Row label="Notes" span>
                  <TextInput value={draft.notes} onChange={(v) => set("notes", v)} placeholder="Anything worth remembering" />
                </Row>
              )}

            </div>

            {/*
              What to look at before saving, as one quiet list.

              Each check was a box of its own, and a repayment against a line
              already paid off showed three, one of them "Principal ₱0.00 ·
              Interest ₱8,950.00", which only restated the first. The owner
              called the screen messy, and it was: the fields shrank to make
              room for boxes. The list keeps every check, says each once, and
              puts its action beside it.
            */}
            <div className="fms-checks">
              {submitted && check.errors.length > 0 && (
                <Alert status="over" title={`${check.errors.length} thing${check.errors.length === 1 ? "" : "s"} to fix`}>
                  {check.errors.map((e) => e.message).join(" ")}
                </Alert>
              )}
              {checks.length > 0 && (
                <div className="fms-checklist" role="status">
                  <span className="t-label" style={{ color: "var(--warn)" }}>
                    Before you save
                  </span>
                  <ul>
                    {checks.map((c) => (
                      <li key={c.key} className="t-caption">
                        {c.text}
                        {c.action}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="fms-actions">
              {tone && <FlowBadge flow={tone} />}
              <span className="fms-actions-spacer" />
              {editing ? (
                <Button onClick={cancelEdit}>Cancel</Button>
              ) : (
                <Button onClick={() => void clearForm()}>
                  Clear
                </Button>
              )}
              <Button variant="primary" onClick={() => void save()}>
                {editing ? "Save changes" : "Save transaction"}
              </Button>
            </div>
          </>
        )}
      </section>

      {/* ── Right: balances, exactly like the Excel INPUT PAGE ──────────── */}
      <aside className="fms-panel fms-side">
        {/*
          What this entry does to its month's budget, beside the balance it
          moves. The same figures the Budget screen shows, before saving
          rather than after.
        */}
        {impact && (
          <div
            className={
              impact.budget > 0 && impact.leftAfter < 0 ? "fms-impact is-over" : "fms-impact"
            }
          >
            <div className="t-label" style={{ color: "var(--ink-2)" }}>
              {MONTH_NAMES[impact.month - 1]} {impact.track === "billsSubs" ? "bills and subscriptions" : "spending"}
            </div>
            {impact.budget > 0 ? (
              <>
                <div className="fms-afterbal">
                  <Money value={impact.budget - impact.spentBefore} size="s" tone="var(--ink-3)" />
                  <span aria-hidden style={{ color: "var(--ink-3)" }}>→</span>
                  <Money
                    value={impact.leftAfter}
                    size="l"
                    tone={impact.leftAfter < 0 ? "var(--over)" : "var(--ink)"}
                  />
                </div>
                <p className="t-caption" style={{ color: "var(--ink-2)" }}>
                  {impact.leftAfter < 0
                    ? `${formatMoney(-impact.leftAfter)} over the ${formatMoney(impact.budget)} budget after this`
                    : `left of the ${formatMoney(impact.budget)} budget after this`}
                </p>
              </>
            ) : (
              <p className="t-caption" style={{ color: "var(--ink-2)" }}>
                No budget for {MONTH_NAMES[impact.month - 1]} yet, so there is nothing to measure this against.{" "}
                {onOpenBudget && impact.lock.state !== "closed" && (
                  <button type="button" className="t-caption fms-linkbtn" onClick={onOpenBudget}>
                    Set one
                  </button>
                )}
              </p>
            )}
            {impact.kind && impact.limit !== null && (
              <p
                className="t-caption"
                style={{ color: impact.limit - impact.kindBefore - impact.cost < 0 ? "var(--over)" : "var(--ink-2)" }}
              >
                {impact.kind} limit: {formatMoney(impact.limit - impact.kindBefore)} left, then{" "}
                {formatMoney(impact.limit - impact.kindBefore - impact.cost)}
              </p>
            )}
            {impact.kind && impact.limit === null && impact.kindBefore > 0 && (
              <p className="t-caption" style={{ color: "var(--ink-3)" }}>
                {impact.kind} so far in {MONTH_NAMES[impact.month - 1]}: {formatMoney(impact.kindBefore)}
              </p>
            )}
            {impact.paidAlready && (
              <p className="t-caption" style={{ color: "var(--warn)" }}>
                {draft.item.trim()} was already paid on {formatMedium(impact.paidAlready.date)},{" "}
                {formatMoney(impact.paidAlready.cost)}. Save only if this is a second payment for{" "}
                {MONTH_NAMES[impact.month - 1]}.
              </p>
            )}
            {impact.lock.state === "closed" && (
              <p className="t-caption" style={{ color: "var(--ink-3)" }}>
                {MONTH_NAMES[impact.month - 1]} {impact.year} is closed. This still counts against its budget as it stood.
              </p>
            )}
          </div>
        )}

        {debtAfter && (
          <div className="fms-impact">
            <div className="t-label" style={{ color: "var(--ink-2)" }}>
              {debtAfter.name}, {debtAfter.owed ? "owed" : "owed to you"}
            </div>
            <div className="fms-afterbal">
              <Money value={debtAfter.before} size="s" tone="var(--ink-3)" />
              <span aria-hidden style={{ color: "var(--ink-3)" }}>→</span>
              <Money
                value={debtAfter.after}
                size="l"
                tone={debtAfter.after < 0 ? "var(--over)" : debtAfter.owed ? "var(--flow-debt-text)" : "var(--ink)"}
              />
            </div>
            {debtAfter.after < 0 && (
              <p className="t-caption" style={{ color: "var(--over)" }}>
                Below zero after this: more {debtAfter.owed ? "paid back than was borrowed" : "collected than was lent"}.
              </p>
            )}
          </div>
        )}

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
            <div className="fms-afterbal">
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

        {debts.some((d) => !d.archived) && (
          <>
            <div className="t-label" style={{ color: "var(--ink-2)", margin: "var(--space-4) 0 var(--space-2)" }}>
              Debts
            </div>
            {debts
              .filter((d) => !d.archived)
              .map((d) => (
                <div key={d.id} className="fms-balrow">
                  <span className="t-caption">
                    {d.name}
                    {d.kind === "receivable" && <span style={{ color: "var(--ink-3)" }}> · owed to you</span>}
                  </span>
                  <Money
                    value={outstandingOf(transactions, d.id)}
                    size="s"
                    tone={d.kind === "payable" ? "var(--flow-debt-text)" : undefined}
                  />
                </div>
              ))}
          </>
        )}
      </aside>

      {/*
        The latest entries, where the assistant would otherwise sit.

        With the chat switched off, a wide screen had a column of nothing to
        the right of the balances. The last few rows are what a new entry gets
        checked against: the same bill twice, a fee typed as a row of its own,
        yesterday's lunch entered again today.
      */}
      {!showChat && (
        <aside className="fms-panel fms-recent" aria-label="Latest entries">
          <div className="fms-recent-head">
            <span className="t-label" style={{ color: "var(--ink-2)" }}>
              Latest entries
            </span>
            <span className="t-micro fms-badge fms-badge--count">{transactions.length} in all</span>
          </div>
          {transactions.length === 0 ? (
            <p className="t-caption" style={{ margin: 0, color: "var(--ink-3)" }}>
              Nothing saved yet. What you save shows here.
            </p>
          ) : (
            <ol className="fms-recent-list">
              {latestOf(transactions).map((t) => (
                <li key={t.id}>
                  {/* Opens the row in this form, to correct it, the way the Database's edit does. */}
                  <button
                    type="button"
                    className="fms-recent-row"
                    disabled={!onEditRow}
                    onClick={() => onEditRow?.(t)}
                    title={onEditRow ? `Open #${String(t.recordNumber).padStart(4, "0")} to correct it` : undefined}
                  >
                  <div className="fms-recent-text">
                    <span className="t-body fms-truncate">{t.item || t.description || t.type}</span>
                    <span className="t-micro fms-truncate" style={{ color: "var(--ink-3)" }}>
                      #{String(t.recordNumber).padStart(4, "0")} · {shortDay(t.date)} · {walletsOf(t)}
                    </span>
                  </div>
                  <Money value={t.total} size="s" tone={AMOUNT_TONE[t.type]} />
                  </button>
                </li>
              ))}
            </ol>
          )}
          {onShowRows && transactions.length > 0 && (
            <button type="button" className="t-caption fms-linkbtn fms-recent-more" onClick={() => onShowRows("")}>
              See every entry in the Database
            </button>
          )}
        </aside>
      )}

      {showChat && (
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
      )}
    </div>
  );
}

/** Direction of money in its own colour, rule D3: a transfer stays grey. */
const AMOUNT_TONE: Record<Transaction["type"], string> = {
  Revenue: "var(--flow-revenue-text)",
  Spending: "var(--flow-spending-text)",
  Transfer: "var(--ink-3)",
  Debt: "var(--flow-debt-text)",
};

/** Newest by date, then by number within a day. */
function latestOf(transactions: readonly Transaction[], count = 8): Transaction[] {
  return [...transactions]
    .sort((a, b) => b.date.localeCompare(a.date) || b.recordNumber - a.recordNumber)
    .slice(0, count);
}

function shortDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-PH", { month: "short", day: "numeric" });
}

function walletsOf(t: Transaction): string {
  if (t.fromWallet && t.toWallet) return `${t.fromWallet} to ${t.toWallet}`;
  return t.fromWallet || t.toWallet || "No wallet";
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
  inline,
  half,
}: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
  error?: string | undefined;
  hint?: string | undefined;
  span?: boolean;
  /** A value nothing types into: it keeps its label beside it at any width. */
  inline?: boolean;
  /** Shares a line with the field beside it, on a form wide enough for both. */
  half?: boolean;
}) {
  const className = ["fms-row", span && "fms-row-span", inline && "fms-row--inline", half && "fms-row--half"]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={className}>
      <label className="t-label fms-rowlabel">
        {label}
        {required && <span style={{ color: "var(--over)" }}> *</span>}
      </label>
      <div className="fms-rowcontrol">
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
/** One thing due now, above the flow tiles: a bill or a debt payment. */
interface DueChip {
  readonly key: string;
  readonly name: string;
  readonly amount: Centavos;
  readonly why: string;
  readonly late: boolean;
  /** Whether the form already holds it, so a second tap does nothing. */
  readonly inForm: (draft: Draft) => boolean;
  /**
   * The form with it filled in, dated today. Something due now is paid now,
   * and the date field keeps the last entry's date, which could be a month
   * already closed.
   */
  readonly fill: () => Draft;
}

/**
 * A saved row into the form, with a split repayment put back together.
 *
 * A repayment larger than what was owed is saved as two rows: the principal,
 * and an interest row beside it. Opening either one showed only its own part,
 * so correcting the ₱2,500.00 principal re-split ₱2,500.00 with no interest,
 * and opening the interest row saved it as a repayment of its own. The form
 * holds the whole payment now, the principal's row is the one saved, and the
 * split is worked out again from what is owed.
 */
function draftForEditing(row: Transaction, transactions: readonly Transaction[]): Draft {
  const principalId = row.id.endsWith("-interest") ? row.id.slice(0, -"-interest".length) : row.id;
  const principal = transactions.find((t) => t.id === principalId);
  const interest = transactions.find((t) => t.id === `${principalId}-interest`);
  if (principal && interest && principal.debtEffect === "repay" && interest.debtEffect === "interest") {
    return { ...transactionToDraft(principal), amount: principal.amount + interest.amount };
  }
  return transactionToDraft(row);
}

const DRAFT_KEY = "fms.add.draft";

/** Nothing typed that clearing the form or leaving it would lose. */
function isBlankDraft(draft: Draft): boolean {
  return (
    draft.amount === null &&
    !draft.item.trim() &&
    !draft.description.trim() &&
    !draft.notes.trim() &&
    !draft.fromWallet &&
    !draft.toWallet
  );
}

function keepDraft(draft: Draft): void {
  try {
    // Nothing worth keeping, and nothing worth restoring into an empty form.
    if (isBlankDraft(draft)) {
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
    /**
     * A correction left half done is not brought back as a new entry. It
     * carries the saved row's id, so it would have saved over that row under
     * a "Save transaction" button, with the next record number showing.
     */
    if (parsed.id) return null;
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
