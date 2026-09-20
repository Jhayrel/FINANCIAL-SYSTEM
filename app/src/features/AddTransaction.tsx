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
import { choicesFor, debtDue, effectsFor, makeDebtId, movementsOf, outstandingOf, owedChange, parentOf, partOf, positionsOf } from "../domain/debt";
import { BEHALF_EFFECTS, BEHALF_SIDE_LABEL, ON_BEHALF, effectInline, effectLabel, effectMeaning, partWords, type BehalfSide } from "../domain/debtWords";
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
import { addDays, formatMedium, getMonth, getYear, MONTH_NAMES } from "../domain/dates";
import { duplicateHeadline, duplicatesOf } from "../domain/duplicates";
import { draftChanges } from "../domain/draftChanges";
import { connectionWords } from "../domain/syncState";
import { entryImpact } from "../domain/entryImpact";
import { whenWords } from "./Dashboard";
import { useReportScreen } from "./screenReport";
import type { BudgetYear, Budgets, DeletedTransaction, ReferenceLists, Transaction, TransactionCategory, WalletBalance } from "../domain/types";

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
/*
 * Five types. On behalf was a choice inside Debt ("Money passing through"),
 * and the owner found it in the wrong place: paying for a friend who pays
 * back later is not a loan from a bank. It is stored as a debt movement on a
 * person whose form is `pass-through`, so every balance and total rule is the
 * one already tested, and it is its own button here.
 */
const FLOWS: { id: Flow | typeof ON_BEHALF; tone: FlowTone; glyph: string; hint: string }[] = [
  { id: "Spending", tone: "spending", glyph: "↑", hint: "Money out" },
  { id: "Revenue", tone: "revenue", glyph: "↓", hint: "Money in" },
  { id: "Transfer", tone: "transfer", glyph: "⇄", hint: "Move or send" },
  { id: "Debt", tone: "debt", glyph: "◑", hint: "Bank, credit, loans" },
  { id: ON_BEHALF, tone: "debt", glyph: "↔", hint: "For another person" },
];

/** A debt movement on someone's behalf opens as On behalf, on the side its person is on. */
function withBehalf(d: Draft, debts: readonly Debt[]): Draft {
  if (d.flow !== "Debt" || d.behalf) return d;
  const debt = debts.find((x) => x.id === d.debtId);
  if (debt?.form !== "pass-through") return d;
  return { ...d, behalf: debt.kind === "receivable" ? "owed" : "held" };
}

/** Due now chips shown before "Show all": enough to act on, not a wall. */
const DUE_SHOWN = 3;

const STATUSES = ["Paid", "Done", "Received", "Transferred", "Withdrawn"];

/** The status a kind of entry gets when the ledger has none to learn from. */
const FALLBACK_STATUS: Record<string, string> = { Spending: "Paid", Revenue: "Received", Transfer: "Transferred" };

export function AddTransaction({
  transactions,
  reference,
  debts,
  balances,
  onSave,
  onUpdate,
  onBudget,
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
  onAddDebt,
  onOpenBudget,
  onShowRows,
  sync,
}: {
  transactions: readonly Transaction[];
  reference: ReferenceLists;
  debts: readonly Debt[];
  balances: readonly WalletBalance[];
  onSave: (rows: Transaction[], by?: Provenance) => void;
  onUpdate: (rows: Transaction[], by?: Provenance) => void;
  /** A year's budget replaced, when the assistant sets one. */
  onBudget?: ((year: number, plan: BudgetYear, changes: readonly string[]) => void) | undefined;
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
  /**
   * A new record for money passing through, added from the form: the person
   * money is held for, or sent for. Only that kind: credit lines and loans
   * are set up in Settings.
   */
  onAddDebt?: ((debt: Debt) => void) | undefined;
  /** The Budget screen, for a month that has no budget yet. */
  onOpenBudget?: (() => void) | undefined;
  /** The Database searched for these words, such as a record number. */
  onShowRows?: ((query: string) => void) | undefined;
  /** Signed in, online, and saves not yet confirmed: for the note beside the form. */
  sync?: { signedIn: boolean; online: boolean; pending: number } | undefined;
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
   * The entry either side of the last type change, for the tap that was meant
   * for the button beside it. Null once there is nothing to offer.
   */
  const [undoSwitch, setUndoSwitch] = useState<{ was: Draft; now: Draft } | null>(null);

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
    setDraft(withBehalf(draftForEditing(editing, transactions), debts));
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
    if (!draft.flow || !draft.item.trim()) {
      // An idea for one item is not an idea for the next, or for no item at all.
      setDescriptionIdea("");
      return;
    }

    const run = ++latest.current;
    const timer = setTimeout(() => {
      void (async () => {
        const allowModel = ai.enabled && ai.features.descriptions;

        if (!draft.category) {
          const result = await suggestCategory(draft, transactions, { allowModel });
          // A slower earlier request must never land on a newer draft.
          if (latest.current !== run) return;

          /*
           * Only a category this flow can actually carry.
           *
           * This was a cast, and the list the answer came from was the
           * owner's spending types, so a confident "Food" went straight into
           * the field and the database refused the row on save. The list is
           * the track now (`domain/categorise.ts`), and this checks rather
           * than asserts, because a cast is a promise the compiler cannot
           * keep about a value that came off the network.
           */
          const offered = categoriesFor(draft.flow).find((c) => c === result.category);
          setCategoryHint(offered ? result : null);
          if (offered && (result.source === "history" || result.confidence === "high")) {
            setDraft((d) => (d.category ? d : { ...d, category: offered }));
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
  const debtsRef = useRef(debts);
  debtsRef.current = debts;
  const applyDraft = useCallback((d: Draft): void => {
    setDraft(withBehalf(d, debtsRef.current));
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
    onUpdate,
    onBudget,
    onAddDebt,
  });
  const nextRecordNumber = sink.nextRecordNumber;

  /**
   * A card sent here from outside this screen: "Edit first" in the floating
   * chat or on the phone's AI tab. Keyed on when it was sent, so sending the
   * same card twice fills the form twice.
   */
  useEffect(() => {
    /*
     * Once each. The app keeps the last card it sent, so coming back to Add
     * after saving it refilled the form with the same entry and warned it
     * was already in the ledger: one more tap on Save would have doubled it.
     */
    if (!incoming || incoming.at === appliedAt) return;
    appliedAt = incoming.at;
    applyDraft(incoming.draft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming?.at]);

  /** The name typed for someone not on the list yet. Null while picking from the list. */
  const [newPerson, setNewPerson] = useState<string | null>(null);
  /** For a new person on an ordinary debt: borrowed from them, or lent to them. */
  const [personKind, setPersonKind] = useState<Debt["kind"] | null>(null);

  /**
   * Someone new, saved in the same tap as the entry.
   *
   * There was an "Add Stephen" button to press first, and until it was
   * pressed Save said "Pick which debt this belongs to". A typed name is the
   * answer. A name already on the list, on the same side, is that person and
   * never a second one.
   */
  const typedName = draft.flow === "Debt" && newPerson !== null ? newPerson.trim() : "";
  const newKind: Debt["kind"] = draft.behalf
    ? draft.behalf === "owed"
      ? "receivable"
      : "payable"
    : (personKind ?? (draft.debtEffect === "lend" || draft.debtEffect === "collect" ? "receivable" : "payable"));
  const namedAlready = typedName
    ? debts.find(
        (d) =>
          !d.archived &&
          d.name.trim().toLowerCase() === typedName.toLowerCase() &&
          d.kind === newKind &&
          (d.form === "pass-through") === Boolean(draft.behalf),
      )
    : undefined;
  const provisional = useMemo<Debt | null>(() => {
    if (!typedName || namedAlready) return null;
    let id = makeDebtId(typedName);
    for (let n = 2; debts.some((d) => d.id === id); n += 1) id = `${makeDebtId(typedName)}-${n}`;
    return {
      id,
      name: typedName,
      kind: newKind,
      form: draft.behalf ? "pass-through" : "informal",
      counterparty: typedName,
      counterpartyType: "person",
      openedDate: draft.date,
      wallet: draft.fromWallet || draft.toWallet || reference.wallets[0] || "",
      interestType: "none",
      interestRate: 0,
      notes: "",
      archived: false,
    };
  }, [typedName, namedAlready, newKind, draft.behalf, draft.date, draft.fromWallet, draft.toWallet, debts, reference.wallets]);
  const effective = useMemo<Draft>(
    () => (provisional ? { ...draft, debtId: provisional.id } : namedAlready ? { ...draft, debtId: namedAlready.id } : draft),
    [draft, provisional, namedAlready],
  );
  const debtsNow = useMemo(() => (provisional ? [...debts, provisional] : debts), [debts, provisional]);

  const check = useMemo(
    () => checkDraft(effective, transactions, reference, debtsNow, asOf),
    [effective, transactions, reference, debtsNow, asOf],
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

  /** Every wallet a row can use, once each, with what it holds today. */
  const walletChoices = useMemo(() => {
    const seen = new Set<string>();
    const out: { name: string; balance: Centavos | null; group: string }[] = [];
    const add = (raw: string, group: string): void => {
      const name = raw.trim();
      if (!name || seen.has(name)) return;
      seen.add(name);
      out.push({ name, balance: balances.find((b) => b.name === name)?.balance ?? null, group });
    };
    for (const w of reference.wallets) add(w, "Wallets");
    for (const w of reference.savings) add(w, "Savings");
    // A row being corrected keeps a wallet deactivated since it was saved.
    add(draft.fromWallet, "Not active");
    add(draft.toWallet, "Not active");
    return out;
  }, [reference, balances, draft.fromWallet, draft.toWallet]);

  /**
   * One wallet field and the list it opens.
   *
   * Every wallet was a box of its own with its balance under the name. The
   * owner, looking at five of them twice over on a debt: with ten or more
   * banks that area is a wall, and it made the form hard to look at. A wallet
   * is one field again. Its list carries what the boxes did: each balance on
   * the right, below zero in red, the usual one tagged, spending and savings
   * under their own headings, and a search box once there are more than eight.
   */
  const walletSelect = (usual: string | undefined, exclude?: string) => {
    const list = walletChoices.filter((w) => w.name !== exclude);
    const kinds = new Set(list.map((w) => w.group));
    return {
      options: list.map((w) => w.name),
      details: Object.fromEntries(list.filter((w) => w.balance !== null).map((w) => [w.name, formatMoney(w.balance ?? 0)])),
      detailTones: Object.fromEntries(list.filter((w) => (w.balance ?? 0) < 0).map((w) => [w.name, "var(--over)"])),
      tags: usual ? { [usual]: "Usual" } : {},
      groups: kinds.size > 1 ? Object.fromEntries(list.map((w) => [w.name, w.group])) : undefined,
    };
  };

  /** "Use Cash": the wallet this is usually paid from or into, one tap away while nothing is chosen. */
  const usualLink = (
    usual: string | undefined,
    current: string,
    pick: (v: string) => void,
    exclude?: string,
  ): React.ReactNode =>
    usual && !current && usual !== exclude && walletChoices.some((w) => w.name === usual) ? (
      <button type="button" className="t-micro fms-linkbtn fms-truncate" onClick={() => pick(usual)}>
        Use {usual}
      </button>
    ) : undefined;

  /**
   * The status a row is saved with when none was picked.
   *
   * The box showed "Paid" in grey and saved an empty status, so the ledger
   * filled with rows whose status was blank while the form had said otherwise.
   * What the box shows is what is saved now: the one picked, else the item's
   * usual one, else the one this kind of entry is usually saved with.
   */
  const usualStatus = useMemo(() => {
    const counts = new Map<string, Map<string, number>>();
    for (const t of transactions) {
      if (!t.status) continue;
      const byStatus = counts.get(t.type) ?? new Map<string, number>();
      byStatus.set(t.status, (byStatus.get(t.status) ?? 0) + 1);
      counts.set(t.type, byStatus);
    }
    const out: Record<string, string> = {};
    for (const [type, byStatus] of counts) out[type] = [...byStatus].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
    return out;
  }, [transactions]);
  const effectiveStatus = needs(draft.flow, "status")
    ? draft.status || ghost.status || usualStatus[draft.flow] || FALLBACK_STATUS[draft.flow] || ""
    : "";

  /** Status, a spending fee and notes: asked for rarely, so folded away until wanted. */
  const [moreOpen, setMoreOpen] = useState(false);
  /** The row as it was saved, so a correction can say what it changes. */
  const original = useMemo(() => (editing ? draftForEditing(editing, transactions) : null), [editing, transactions]);
  const changes = original ? draftChanges(original, draft) : [];

  /** A change in words: a debt by its name, an effect by its label, a date as a date. */
  const changeWords = (field: string, value: string): string => {
    if (value === "none") return "none";
    if (field === "debtId") return debts.find((d) => d.id === value)?.name ?? value;
    if (field === "debtEffect") return effectLabel(value as DebtEffect, debts.find((d) => d.id === draft.debtId));
    if (field === "date") return formatMedium(value);
    return value;
  };


  const items = itemsFor(draft.flow, draft.category, reference);
  const categories = categoriesFor(draft.flow);

  const errorFor = (field: string): string | undefined =>
    submitted ? check.errors.find((e) => e.field === field)?.message : undefined;

  /** A debt payment, which is the one movement that can carry interest inside it. */
  const paying = draft.flow === "Debt" && draft.debtEffect === "repay" && debts.find((d) => d.id === draft.debtId)?.form !== "pass-through";
  /** A borrowing, which can carry fees the lender added on top of it. */
  const borrowing = draft.flow === "Debt" && draft.debtEffect === "draw" && debts.find((d) => d.id === draft.debtId)?.form !== "pass-through";
  const chargesError = borrowing
    ? (submitted || (draft.charges ?? null) !== null
        ? check.errors.find((e) => e.field === "charges")?.message
        : undefined)
    : undefined;
  /**
   * Interest larger than the payment it is part of, said as soon as it is
   * typed: it is a contradiction between two fields side by side, not a
   * forgotten field that should wait for Save.
   */
  const interestError = paying
    ? (submitted || (draft.interest ?? null) !== null
        ? check.errors.find((e) => e.field === "interest")?.message
        : undefined)
    : undefined;

  /**
   * Warnings wait for an amount.
   *
   * The form opened saying "No item, so this will not appear in any breakdown
   * by item. Save it without one?" before anything had been typed at all. A
   * form with nothing in it has nothing to warn about yet.
   */
  const showWarnings = submitted || draft.amount !== null;

  /**
   * Who can be picked. Debt lists banks, credit lines and personal loans; On
   * behalf lists the people on the side chosen. Maya Credit was offered for a
   * friend's meal, which is the confusion the owner pointed at.
   */
  const debtOptions = debts.filter(
    (d) =>
      d.id === draft.debtId ||
      (!d.archived &&
        (draft.behalf
          ? d.form === "pass-through" && d.kind === (draft.behalf === "owed" ? "receivable" : "payable")
          : d.form !== "pass-through")),
  );
  const selectedDebt = debts.find((d) => d.id === draft.debtId);
  /** The debt the choices are worded for: the one picked, or the person being added. */
  const debtShape = selectedDebt ?? (draft.behalf || personKind ? { kind: newKind, form: draft.behalf ? ("pass-through" as const) : ("informal" as const) } : undefined);
  const effects = choicesFor(debtShape?.kind ?? "payable", draft.debtEffect, debtShape?.form);

  /** A debt into the draft: its effect kept only if that debt takes it, and its account as the wallet when none is chosen. */
  const pickDebt = (d: Draft, debt: Debt): Draft => {
    // Another direction cannot keep an effect it does not take.
    const effect = d.debtEffect && effectsFor(debt.kind).includes(d.debtEffect) ? d.debtEffect : undefined;
    const next: Draft = { ...d, debtId: debt.id, debtEffect: effect };
    // The account the debt moves through, when no wallet is picked yet.
    if (next.fromWallet || next.toWallet || !debt.wallet) return next;
    return effect ? withDebtEffect({ ...next, fromWallet: debt.wallet }, effect) : { ...next, fromWallet: debt.wallet };
  };

  /**
   * On someone's behalf, chosen from Revenue or Transfer.
   *
   * Money a client sends to a personal account, or money sent for a mother
   * who pays it back: the bank records it and none of it is income or
   * spending. One tap turns the entry into On behalf, on the right side, with
   * the wallet and amount kept.
   */
  const passThrough = (effect: "draw" | "lend"): void => {
    setDraft((d) => {
      const wallet = effect === "draw" ? d.toWallet : d.fromWallet;
      const base: Draft = {
        ...d,
        flow: "Debt",
        behalf: effect === "draw" ? "held" : "owed",
        category: "",
        item: "",
        sentOut: undefined,
        debtId: undefined,
        fromWallet: effect === "lend" ? wallet : "",
        toWallet: effect === "draw" ? wallet : "",
      };
      return withDebtEffect(base, effect);
    });
    setNewPerson(null);
  };

  /** What happened, on either side. Changing side clears the person, who belongs to the other list. */
  const chooseBehalf = (side: BehalfSide, effect: DebtEffect): void => {
    if (draft.behalf !== side) setNewPerson(null);
    setDraft((d) => {
      const moved = d.behalf !== side;
      const next: Draft = {
        ...d,
        behalf: side,
        debtId: moved ? undefined : d.debtId,
        item: effect === "writeoff" ? d.item : "",
        category: "",
      };
      return withDebtEffect(next, effect);
    });
  };

  /** The person or debt, with someone new typed in place. */
  const renderPerson = () => {
    const typing = newPerson !== null || (debtOptions.length === 0 && Boolean(onAddDebt));
    return (
      <Field
        label={draft.behalf ? (draft.behalf === "owed" ? "On whose behalf" : "Whose money") : "Which debt"}
        required
        error={errorFor("debt")}
        aside={
          onAddDebt && newPerson === null && debtOptions.length > 0 ? (
            <button
              type="button"
              className="t-micro fms-linkbtn"
              onClick={() => {
                setNewPerson("");
                setDraft((d) => ({ ...d, debtId: undefined }));
              }}
            >
              {draft.behalf ? "Someone new" : "New personal loan"}
            </button>
          ) : newPerson !== null && debtOptions.length > 0 ? (
            <button
              type="button"
              className="t-micro fms-linkbtn"
              onClick={() => {
                setNewPerson(null);
                setPersonKind(null);
              }}
            >
              Pick from the list
            </button>
          ) : undefined
        }
      >
        {typing ? (
          <div className="fms-newperson">
            <TextInput
              value={newPerson ?? ""}
              onChange={setNewPerson}
              placeholder={draft.behalf ? "Their name" : "Who you borrowed from or lent to"}
              ariaLabel="Their name"
              maxLength={60}
              invalid={Boolean(errorFor("debt"))}
            />
            {!draft.behalf && (
              <div className="fms-choicerow" role="radiogroup" aria-label="Which way the loan goes">
                {[
                  { kind: "payable" as const, label: "I borrowed from them" },
                  { kind: "receivable" as const, label: "I lent to them" },
                ].map((o) => (
                  <button
                    key={o.kind}
                    type="button"
                    role="radio"
                    aria-checked={newKind === o.kind}
                    className={newKind === o.kind ? "fms-choice t-body-strong" : "fms-choice t-body"}
                    onClick={() => {
                      setPersonKind(o.kind);
                      setDraft((d) =>
                        d.debtEffect && effectsFor(o.kind).includes(d.debtEffect) ? d : withDebtEffect(d, o.kind === "payable" ? "draw" : "lend"),
                      );
                    }}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            )}
            <p className="t-micro" style={{ margin: 0, color: "var(--ink-3)" }}>
              {namedAlready
                ? `Already on your list, so it is filed there.`
                : typedName
                  ? "Saved with this entry, and kept under Credit and loans in Settings."
                  : draft.behalf
                    ? "The person you paid, sent or hold money for."
                    : "A person. Banks, credit lines and bank loans are added in Settings, under Credit and loans."}
            </p>
          </div>
        ) : debtOptions.length === 0 ? (
          <p className="t-caption" style={{ margin: 0, color: "var(--ink-3)" }}>
            Nothing to file this against yet. Add a bank loan or credit line in Settings, under Credit and loans.
          </p>
        ) : (
          <Select
            value={selectedDebt?.name ?? ""}
            onChange={(name) =>
              setDraft((d) => {
                const debt = debtOptions.find((x) => x.name === name);
                return debt ? pickDebt(d, debt) : { ...d, debtId: undefined };
              })
            }
            options={debtOptions.map((d) => d.name)}
            details={Object.fromEntries(
              debtOptions.map((d) => [
                d.name,
                `${formatMoney(outstandingOf(transactions, d.id))} ${
                  d.form === "pass-through" ? (d.kind === "payable" ? "held" : "owed to you") : d.kind === "payable" ? "owed" : "owed to you"
                }`,
              ]),
            )}
            placeholder={draft.behalf ? "Pick a person" : "Pick a debt"}
            ariaLabel={draft.behalf ? "Which person" : "Which debt"}
            invalid={Boolean(errorFor("debt"))}
          />
        )}
      </Field>
    );
  };

  /** One debt open: choosing Debt picks it, since there is nothing to choose between. */
  const onlyDebt = debtOptions.length === 1 ? debtOptions[0] : undefined;
  useEffect(() => {
    /*
     * Not while a person is being added, and not when the movement already
     * chosen does not fit that debt: "For someone who pays me back" set
     * "sent for them", and picking Maya Credit for it threw that away.
     */
    if (draft.flow !== "Debt" || draft.behalf || draft.debtId || !onlyDebt || newPerson !== null) return;
    if (draft.debtEffect && !effectsFor(onlyDebt.kind).includes(draft.debtEffect)) return;
    if (personKind !== null) return;
    setDraft((d) => (d.flow === "Debt" && !d.debtId ? pickDebt(d, onlyDebt) : d));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.flow, draft.behalf, draft.debtId, draft.debtEffect, onlyDebt?.id, newPerson, personKind]);
  const namedDebt = check.debtPayment ? debts.find((d) => d.id === check.debtPayment?.debtId) : undefined;

  /** The number shown while correcting: the payment's own, when a split pair was opened by its interest row. */
  const editingNumber = editing
    ? (transactions.find((t) => t.id === draft.id)?.recordNumber ?? editing.recordNumber)
    : 0;

  /** What this entry does to the debt it is filed against. */
  const debtAfter = (() => {
    if (draft.flow !== "Debt" || !selectedDebt || !draft.debtEffect || draft.amount === null) return null;
    const editedRow = draft.id ? transactions.find((t) => t.id === draft.id) : undefined;
    const editedPart = editedRow ? partOf(editedRow, transactions) : undefined;
    const base = draft.id
      ? transactions.filter((t) => t.id !== draft.id && t.id !== editedPart?.id)
      : transactions;
    const before = outstandingOf(base, selectedDebt.id);
    const amount = draft.amount;
    // The rows this entry would save, read by the same rule the balance is.
    const change =
      draft.debtEffect === "repay"
        ? -(check.repaymentSplit?.principal ?? amount)
        : owedChange({ debtEffect: draft.debtEffect, amount }) +
          (draft.debtEffect === "draw" ? Math.max(0, draft.charges ?? 0) : 0);
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
  if (borrowing && (draft.charges ?? 0) > 0 && draft.amount !== null) {
    checks.push({
      key: "charges",
      text: `Saved as one borrowing in two linked rows: ${formatMoney(draft.amount)} received, and ${formatMoney(draft.charges ?? 0)} of fees added to what you owe, which counts as spending today.`,
    });
  }
  if (check.repaymentSplit && check.repaymentSplit.interest > 0 && check.repaymentSplit.principal > 0) {
    checks.push({
      key: "split",
      text: `Saved as one payment in two linked rows: ${formatMoney(check.repaymentSplit.principal)} off what you owe, and ${formatMoney(check.repaymentSplit.interest)} interest, which counts as spending.`,
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
    /** What the Status box showed is what is saved (see `effectiveStatus`). */
    const final: Draft = effectiveStatus && !effective.status ? { ...effective, status: effectiveStatus as Draft["status"] } : effective;
    // Someone new is saved in the same tap, before the row that names them.
    if (provisional && onAddDebt) onAddDebt(provisional);

    const target = (draft.id ? transactions.find((t) => t.id === draft.id) : undefined) ?? editing;

    if (target) {
      /**
       * Same id, same record number. An edit is the entry corrected, not a
       * new one, and reissuing either would break every reference to it.
       */
      const rows = draftToTransactions(final, target.recordNumber, target.id, check.repaymentSplit);
      onUpdate(rows);
      /**
       * A split repayment corrected so it no longer covers interest: its old
       * interest row would stay behind, booking interest that the payment no
       * longer includes. It goes to the bin, where it can still be restored.
       */
      const part = partOf(target, transactions);
      if (part && !rows.some((r) => r.id === part.id)) onBin(part.id);
    } else {
      onSave(
        draftToTransactions(final, nextRecordNumber, `t-${Date.now()}`, check.repaymentSplit),
      );
    }

    // The card that supplied this row can now say it was saved.
    onSaved({ draft: final, at: Date.now() });
    forgetDraft();
    setNewPerson(null);
    setPersonKind(null);
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
  const switchFlow = (flow: Flow, side?: BehalfSide): void => {
    if (flow === draft.flow && Boolean(side) === Boolean(draft.behalf)) return;
    setNewPerson(null);
    setPersonKind(null);

    /**
     * What the entry was, before the type changed under it.
     *
     * ── Why this is kept ────────────────────────────────────────────────
     *
     * Changing the type empties the form: the fields a Transfer needs are not
     * the fields Spending needs, so both wallets, the category, the item, the
     * fee and the status all go. That is right, and it is also unrecoverable,
     * and these four buttons sit in a row where the one you want is next to
     * the one you do not. The owner filled in a transfer, tapped Spending by
     * accident, and lost the lot with nothing on screen offering it back.
     *
     * Both halves are remembered: what it was, and what it became. The offer
     * appears only while the form still matches what the switch produced, so
     * undoing can never throw away something typed afterwards. Start typing
     * and the offer goes, because by then it would cost more than it returns.
     */
    const was = draft;
    const now: Draft = {
      ...emptyDraft(draft.date),
      flow,
      ...(side ? { behalf: side } : {}),
      amount: draft.amount,
      description:
        needs(flow, "description") && !suggested.has("description") ? draft.description : "",
      notes: needs(flow, "notes") ? draft.notes : "",
    };

    // Offered only when the switch threw something away: an empty form has nothing to give back.
    const lost =
      [was.fromWallet, was.toWallet, was.category, was.item, was.status, was.debtId ?? ""].some((v) => v.trim() !== "") ||
      was.fee > 0 ||
      was.debtEffect !== undefined ||
      (was.interest ?? null) !== null ||
      (was.charges ?? null) !== null;
    setUndoSwitch(lost ? { was, now } : null);
    setDraft(now);
    setSuggested((s) => (s.has("amount") ? new Set(["amount"]) : new Set()));
    setCategoryHint(null);
    setSubmitted(false);
  };

  /** Put the entry back as it was before the type changed. */
  const undoFlow = (): void => {
    if (!undoSwitch) return;
    setDraft(undoSwitch.was);
    setUndoSwitch(null);
    setSubmitted(false);
  };

  const tone = FLOWS.find((f) => f.id === draft.flow)?.tone;
  const connection = sync ? connectionWords(sync) : null;

  // Which fields are on the form, so two that belong together can share a line on a wide one.
  /*
   * A debt shows the one wallet its effect moves money through, and none until
   * an effect is picked: both lists at once, before anything was chosen, was
   * the most crowded the form ever got.
   */
  const showFrom = draft.flow === "Debt" ? debtSide === "out" : needs(draft.flow, "fromWallet");
  const showTo = draft.flow === "Debt" ? debtSide === "in" : needs(draft.flow, "toWallet");
  const showCategory = needs(draft.flow, "category") && categories.length > 1;
  const showItem = needs(draft.flow, "item");
  const showFee = needs(draft.flow, "fee");
  // The total only says something when there is a fee in it.
  const showTotal = showFee && draft.fee > 0;
  const showStatus = needs(draft.flow, "status");
  // A transfer's fee sits beside its amount; a spending fee is rare, so it waits in the fold.
  const feeInDetails = showFee && draft.flow !== "Transfer";
  const hasMore = showStatus || needs(draft.flow, "notes") || feeInDetails;
  // A problem inside the fold opens it: an error nobody can see cannot be fixed.
  const detailsOpen = moreOpen || (feeInDetails && Boolean(errorFor("fee")));
  const moreSummary = [
    showStatus ? effectiveStatus || "no status" : "",
    feeInDetails ? (draft.fee > 0 ? `fee ${formatMoney(draft.fee)}` : "no fee") : "",
    needs(draft.flow, "notes") ? (draft.notes.trim() ? "has notes" : "no notes") : "",
  ]
    .filter(Boolean)
    .join(" · ");
  /** The button says what it will do: the amount for a new entry, the count of changes for a correction. */
  const saveLabel = editing
    ? changes.length === 0
      ? "Save"
      : `Save ${changes.length} ${changes.length === 1 ? "change" : "changes"}`
    : draft.amount !== null && draft.amount > 0
      ? `Save ${formatMoney(draft.amount + draft.fee)}`
      : "Save";

  return (
    <div className={showChat ? "fms-entry" : "fms-entry fms-entry--nochat"}>
      {dialog}
      {/* ── Left: the form ─────────────────────────────────────────────── */}
      <section className="fms-panel fms-entryform">
        {/*
          Which entry this is, before anything else.

          Correcting a row from the Database opened the same form with "Correcting
          a saved entry" in small type under a record number, so a correction
          looked like a new entry until Save. It says so at the top now, with the
          row as it was saved, and the list above Save says what will change.
        */}
        <div className={editing ? "fms-entryhead is-editing" : "fms-entryhead"}>
          <div className="fms-entryhead-text">
            <span className="t-body-strong">
              {editing ? `Correcting #${String(editingNumber).padStart(4, "0")}` : "New entry"}
            </span>
            <span className="t-caption fms-truncate" style={{ color: editing ? "var(--ink-2)" : "var(--ink-3)" }}>
              {editing
                ? `As saved: ${editing.type === "Debt" ? recentTitle(editing, debts) : `${editing.type}, ${editing.item || editing.description || "no item"}`}, ${formatMoney(original ? (original.amount ?? 0) + original.fee : editing.total)}, ${formatMedium(editing.date)}`
                : `Saves as #${String(nextRecordNumber).padStart(4, "0")}`}
            </span>
          </div>
          <div className="fms-entryhead-end">
            {/* Where a save goes, said beside the form (domain/syncState.ts). */}
            {connection && (
              <span className={`t-micro fms-conn fms-conn--${connection.tone}`} role="status">
                {connection.text}
              </span>
            )}
            {editing && (
              <Button size="sm" onClick={cancelEdit}>
                Stop correcting
              </Button>
            )}
          </div>
        </div>

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
            const active =
              f.id === ON_BEHALF
                ? draft.flow === "Debt" && Boolean(draft.behalf)
                : f.id === "Debt"
                  ? draft.flow === "Debt" && !draft.behalf
                  : draft.flow === f.id;
            return (
              <button
                key={f.id}
                onClick={() => (f.id === ON_BEHALF ? switchFlow("Debt", "owed") : switchFlow(f.id))}
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

        {/*
          Only while the form still holds exactly what the switch produced.
          Once anything has been typed, putting the old entry back would take
          that typing with it, so the offer withdraws instead.
        */}
        {undoSwitch && JSON.stringify(draft) === JSON.stringify(undoSwitch.now) && (
          <p className="t-micro fms-flowundo">
            <span>
              Changed to {draft.behalf ? ON_BEHALF : draft.flow}, which empties the fields {undoSwitch.was.behalf ? ON_BEHALF : undoSwitch.was.flow} was using.
            </span>
            <button type="button" onClick={undoFlow}>
              Undo, back to {undoSwitch.was.behalf ? ON_BEHALF : undoSwitch.was.flow}
            </button>
          </p>
        )}

        {!draft.flow ? (
          <p className="t-caption" style={{ color: "var(--ink-3)", margin: "var(--space-6) 0", textAlign: "center" }}>
            Pick a type above and only the fields it needs will appear.
          </p>
        ) : (
          <>
            {/*
              One path down the form, in the order a person answers it.

              The owner found the form hard to move through, and it was: labels
              in a column of their own a hand's width from their fields, two
              fields on a line with their labels at different heights, "Usually
              Maya" in a wallet box that looked chosen and was not, and Status,
              Fee and Notes given the same weight as the amount. It reads top to
              bottom now: how much, what for, which wallet, when, and the rest
              folded under "More details". A label sits on its field. A wallet
              is one tap on a button that shows what it holds, the usual one says
              so, and nothing looks chosen that is not.
            */}
            <div className="fms-fields">
              {needs(draft.flow, "debt") && draft.behalf && (
                <>
                  {/*
                    What happened first: it decides which people are listed and
                    which wallet appears. Both sides are in view, because the
                    wrong side moves a balance the wrong way.
                  */}
                  <Field
                    label="What happened"
                    required
                    error={errorFor("debtEffect")}
                    hint={
                      draft.debtEffect
                        ? effectMeaning(draft.debtEffect, debtShape)
                        : "Pick one. The wallet it moves through appears below."
                    }
                  >
                    <div className="fms-behalf">
                      {(["owed", "held"] as const).map((side) => {
                        const shape = { kind: side === "owed" ? ("receivable" as const) : ("payable" as const), form: "pass-through" as const };
                        return (
                          <div key={side} className="fms-behalf-side">
                            <span className="t-micro fms-behalf-label">{BEHALF_SIDE_LABEL[side]}</span>
                            <div className="fms-segpills" role="radiogroup" aria-label={BEHALF_SIDE_LABEL[side]}>
                              {BEHALF_EFFECTS[side].map((effect) => (
                                <button
                                  key={effect}
                                  type="button"
                                  role="radio"
                                  aria-checked={draft.behalf === side && draft.debtEffect === effect}
                                  title={effectMeaning(effect, shape)}
                                  className="t-body fms-segpill"
                                  onClick={() => chooseBehalf(side, effect)}
                                >
                                  {effectLabel(effect, shape)}
                                </button>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </Field>
                  {renderPerson()}
                  {draft.debtEffect === "writeoff" && (
                    <Field
                      label={draft.behalf === "owed" ? "Counts as spending on" : "Counts as income from"}
                      required
                      error={errorFor("item")}
                    >
                      <Select
                        value={draft.item}
                        onChange={(v) => set("item", v)}
                        options={draft.behalf === "owed" ? reference.spendingTypes.map((s) => s.name) : reference.revenueCategories}
                        placeholder="Pick an item"
                        ariaLabel="What it counts as"
                      />
                    </Field>
                  )}
                </>
              )}

              {needs(draft.flow, "debt") && !draft.behalf && (
                <>
                  {renderPerson()}
                  {/*
                    Every effect in view rather than behind a dropdown: there are
                    three or four, and the wrong one moves a balance by twice the
                    amount. Picking one moves the wallet to the side it implies
                    (`withDebtEffect`), as the chat card does.
                  */}
                  <Field
                    label="What it does"
                    required
                    error={errorFor("debtEffect")}
                    hint={
                      draft.debtEffect
                        ? effectMeaning(draft.debtEffect, debtShape)
                        : "Pick one, and the wallet it moves money through appears."
                    }
                  >
                    <div className="fms-segpills" role="radiogroup" aria-label="What this does to the debt">
                      {effects.map((effect) => (
                        <button
                          key={effect}
                          type="button"
                          role="radio"
                          aria-checked={draft.debtEffect === effect}
                          title={effectMeaning(effect, debtShape)}
                          className="t-body fms-segpill"
                          onClick={() => setDraft((d) => withDebtEffect(d, effect))}
                        >
                          {effectLabel(effect, debtShape)}
                        </button>
                      ))}
                    </div>
                  </Field>
                </>
              )}

              <Field
                label={paying ? "Amount paid" : "Amount"}
                required
                half={draft.flow === "Transfer" || paying}
                error={errorFor("amount")}
              >
                <div className="fms-amounthero">
                  <AmountInput
                    value={draft.amount}
                    onChange={(v) => set("amount", v)}
                    invalid={Boolean(errorFor("amount"))}
                    ariaLabel="Amount"
                  />
                </div>
                {/*
                  Offered, never filled. An amount that is silently almost right
                  is the one mistake here that quietly corrupts a balance, so it
                  takes a deliberate tap.
                */}
                {guess && draft.amount === null && (
                  <button type="button" className="fms-guesschip t-caption" onClick={() => set("amount", guess.amount)}>
                    Usually <span className="t-num-s">{formatMoney(guess.amount)}</span>, tap to use it
                  </button>
                )}
              </Field>

              {/*
                The interest inside a payment, as the bill says it.

                "I paid my credit 1,000" says nothing about how much of it was
                interest, and no rate can be assumed, because every lender
                counts it differently. So it is asked, beside the amount, and
                read off the bill or the lender's app. Blank is fine: then only
                a payment larger than what is owed has interest in it (rule
                D2). The two rows it saves are linked (see `Transaction.partOf`).
              */}
              {/*
                Fees added on top of a borrowing, as the lender's app lists them.

                Maya Credit adds a service fee and documentary stamp tax each
                time money is taken, and other lenders add a processing fee or
                a first month's interest. They are owed, so they go into what is
                owed; they are a cost, so they count as spending today. Blank
                is fine for a lender that adds nothing.
              */}
              {borrowing && (
                <Field
                  label="Fees added"
                  half
                  error={chargesError}
                  hint={chargesError ? undefined : "Service fee, tax or interest added. Blank if none."}
                >
                  <div className="fms-amounthero fms-amounthero--quiet">
                    <AmountInput
                      value={draft.charges ?? null}
                      onChange={(v) => set("charges", v)}
                      invalid={Boolean(chargesError)}
                      ariaLabel="Fees added to what you owe"
                    />
                  </div>
                </Field>
              )}

              {paying && (
                <Field
                  label="Interest included"
                  half
                  error={interestError}
                  hint={interestError ? undefined : "From the bill or app. Blank if none."}
                >
                  <div className="fms-amounthero fms-amounthero--quiet">
                    <AmountInput
                      value={draft.interest ?? null}
                      onChange={(v) => set("interest", v)}
                      invalid={Boolean(interestError)}
                      ariaLabel="Interest included in the payment"
                    />
                  </div>
                </Field>
              )}

              {draft.flow === "Transfer" && (
                <Field label="Fee" half error={errorFor("fee")}>
                  <div className="fms-amounthero fms-amounthero--quiet">
                    <AmountInput
                      value={draft.fee}
                      onChange={(v) => set("fee", v ?? 0)}
                      invalid={Boolean(errorFor("fee"))}
                      ariaLabel="Fee"
                    />
                  </div>
                </Field>
              )}

              {showCategory && (
                <Field
                  label="Category"
                  required
                  half={showItem}
                  aside={
                    !draft.category && (ghost.category || categoryHint?.category) ? (
                      <button
                        type="button"
                        className="t-micro fms-linkbtn fms-truncate"
                        onClick={() => {
                          const pick = (ghost.category || categoryHint?.category || "") as TransactionCategory;
                          setCategoryHint(null);
                          unmark("category");
                          setDraft((d) => ({ ...d, category: pick, item: "" }));
                        }}
                      >
                        Use {ghost.category || categoryHint?.category}
                      </button>
                    ) : undefined
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
                      placeholder="Pick a category"
                      ariaLabel="Category"
                    />
                  </div>
                </Field>
              )}

              {showItem && (
                <Field
                  label="Item"
                  half={showCategory}
                  aside={
                    ghost.item && !draft.item ? (
                      <button type="button" className="t-micro fms-linkbtn fms-truncate" onClick={() => set("item", ghost.item ?? "")}>
                        Use {ghost.item}
                      </button>
                    ) : undefined
                  }
                >
                  <Select value={draft.item} onChange={(v) => set("item", v)} options={items} placeholder="Pick an item" ariaLabel="Item" />
                </Field>
              )}

              {(needs(draft.flow, "description") || Boolean(draft.behalf)) && (
                <Field
                  label="Description"
                  aside={
                    descriptionIdea && !draft.description ? (
                      <button
                        type="button"
                        className="t-micro fms-linkbtn fms-truncate"
                        onClick={() => set("description", descriptionIdea)}
                      >
                        Use "{descriptionIdea}"
                      </button>
                    ) : undefined
                  }
                >
                  <div className={suggested.has("description") ? "fms-suggested" : undefined}>
                    <TextInput
                      value={draft.description}
                      onChange={(v) => {
                        unmark("description");
                        set("description", v);
                      }}
                      placeholder={descriptionIdea || "What was it for?"}
                      ariaLabel="Description"
                      maxLength={160}
                      onKeyDown={(e) => {
                        // Tab takes the idea in the empty field; a second Tab moves on as usual.
                        if (e.key === "Tab" && !e.shiftKey && !draft.description && descriptionIdea) {
                          e.preventDefault();
                          set("description", descriptionIdea);
                        }
                      }}
                    />
                  </div>
                </Field>
              )}

              {showFrom && (
                <Field
                  label={draft.flow === "Transfer" ? "From" : "Paid from"}
                  required={draft.flow !== "Debt" || debtSide === "out"}
                  error={errorFor("fromWallet")}
                  aside={usualLink(ghost.fromWallet, draft.fromWallet, (v) => set("fromWallet", v))}
                >
                  <Select
                    value={draft.fromWallet}
                    onChange={(v) => set("fromWallet", v)}
                    placeholder="Pick a wallet"
                    ariaLabel="The wallet the money leaves"
                    invalid={Boolean(errorFor("fromWallet"))}
                    {...walletSelect(ghost.fromWallet)}
                  />
                </Field>
              )}

              {showTo && (
                <Field
                  label={draft.flow === "Transfer" ? "To" : draft.flow === "Debt" ? "Lands in" : "Received into"}
                  required={draft.flow !== "Debt" || debtSide === "in"}
                  error={errorFor("toWallet")}
                  aside={
                    draft.flow === "Transfer" && sentOut
                      ? undefined
                      : usualLink(ghost.toWallet, draft.toWallet, (v) => set("toWallet", v), draft.flow === "Transfer" ? draft.fromWallet : undefined)
                  }
                >
                  {draft.flow === "Transfer" ? (
                    <div className="fms-stack">
                      {/*
                        "Am I moving this or sending it away" first, because it is
                        the answer that changes what the entry means.
                      */}
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
                            onClick={() => setDraft((d) => ({ ...d, sentOut: option.out, toWallet: "" }))}
                          >
                            {option.label}
                          </button>
                        ))}
                        {onAddDebt && (
                          <button type="button" role="radio" aria-checked={false} className="fms-choice t-body" onClick={() => passThrough("lend")}>
                            On someone's behalf
                          </button>
                        )}
                      </div>
                      {!sentOut && (
                        <Select
                          value={draft.toWallet}
                          onChange={(v) => set("toWallet", v)}
                          placeholder="Pick a wallet"
                          ariaLabel="The wallet the money lands in"
                          invalid={Boolean(errorFor("toWallet"))}
                          {...walletSelect(ghost.toWallet, draft.fromWallet)}
                        />
                      )}
                      {/* What the row counts as, worked out from the answer above. */}
                      <div className="fms-derived">
                        <StatusPill status={sentOut ? "over" : "none"}>
                          {sentOut ? "Money Send" : draft.fee > 0 ? "Transaction Fee" : "Not spending"}
                        </StatusPill>
                        <span className="t-caption" style={{ color: "var(--ink-2)" }}>
                          {sentOut
                            ? "It leaves your accounts, so the whole amount is spending."
                            : draft.fee > 0
                              ? "Still your money, in another pocket. Only the fee is spending."
                              : "Still your money, in another pocket. Nothing here is spending."}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="fms-stack">
                      <Select
                        value={draft.toWallet}
                        onChange={(v) => set("toWallet", v)}
                        placeholder="Pick a wallet"
                        ariaLabel="The wallet the money lands in"
                        invalid={Boolean(errorFor("toWallet"))}
                        {...walletSelect(ghost.toWallet)}
                      />
                      {draft.flow === "Revenue" && onAddDebt && (
                        <div className="fms-choicerow" role="radiogroup" aria-label="Whose money it is">
                          <button type="button" role="radio" aria-checked={true} className="fms-choice t-body-strong">
                            It is mine
                          </button>
                          <button type="button" role="radio" aria-checked={false} className="fms-choice t-body" onClick={() => passThrough("draw")}>
                            On someone's behalf
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </Field>
              )}

              {draft.flow === "Opening" && (
                <Field label="Counts as">
                  <div className="fms-derived">
                    <StatusPill status="none">Starting balance</StatusPill>
                    <span className="t-caption" style={{ color: "var(--ink-2)" }}>
                      Money you already had. It sets the account's balance without counting as income, so your revenue
                      figures stay true.
                    </span>
                  </div>
                </Field>
              )}

              <Field label="Date" required error={errorFor("date")}>
                <div className="fms-datechips">
                  {[
                    { label: "Today", date: asOf },
                    { label: "Yesterday", date: addDays(asOf, -1) },
                  ].map((c) => (
                    <button
                      key={c.label}
                      type="button"
                      className="fms-datechip t-body"
                      aria-pressed={draft.date === c.date}
                      onClick={() => set("date", c.date)}
                    >
                      {c.label}
                    </button>
                  ))}
                  <input
                    type="date"
                    aria-label="Date"
                    value={draft.date}
                    onChange={(e) => set("date", e.target.value)}
                    className="t-body fms-control fms-datechips-input"
                  />
                </div>
              </Field>

              {hasMore && (
                <button
                  type="button"
                  className="fms-more"
                  aria-expanded={detailsOpen}
                  onClick={() => setMoreOpen((open) => !open)}
                >
                  <span className="t-body-strong">More details</span>
                  <span className="t-caption fms-more-sum fms-truncate">{moreSummary}</span>
                </button>
              )}

              {hasMore && detailsOpen && (
                <>
                  {feeInDetails && (
                    <Field label="Fee" half={showStatus} error={errorFor("fee")}>
                      <div className="fms-amounthero fms-amounthero--quiet">
                        <AmountInput
                          value={draft.fee}
                          onChange={(v) => set("fee", v ?? 0)}
                          invalid={Boolean(errorFor("fee"))}
                          ariaLabel="Fee"
                        />
                      </div>
                    </Field>
                  )}
                  {showStatus && (
                    <Field label="Status" half={feeInDetails}>
                      <Select
                        value={effectiveStatus}
                        onChange={(v) => set("status", v as Draft["status"])}
                        options={STATUSES}
                        placeholder="Pick a status"
                        ariaLabel="Status"
                      />
                    </Field>
                  )}
                  {needs(draft.flow, "notes") && (
                    <Field label="Notes">
                      <TextInput
                        value={draft.notes}
                        onChange={(v) => set("notes", v)}
                        placeholder="Anything worth remembering"
                        ariaLabel="Notes"
                        maxLength={500}
                      />
                    </Field>
                  )}
                </>
              )}

              {showTotal && (
                <div className="fms-totalline">
                  <span className="t-caption" style={{ color: "var(--ink-2)" }}>
                    Total, with the fee
                  </span>
                  <Money value={(draft.amount ?? 0) + draft.fee} />
                </div>
              )}
            </div>

            {/* A correction says what it changes before it is saved. */}
            {editing && (
              <div className={changes.length > 0 ? "fms-changes has-changes" : "fms-changes"} role="status" aria-live="polite">
                <span className="t-label" style={{ color: "var(--ink-2)" }}>
                  {changes.length === 0
                    ? `Nothing changed yet. Change what is wrong in #${String(editingNumber).padStart(4, "0")}, then save.`
                    : `${changes.length} ${changes.length === 1 ? "change" : "changes"} to #${String(editingNumber).padStart(4, "0")}`}
                </span>
                {changes.length > 0 && (
                  <ul>
                    {changes.map((c) => (
                      <li key={c.field} className="t-caption">
                        <span className="fms-changes-label">{c.label}</span>
                        <span className="fms-changes-before">{changeWords(c.field, c.before)}</span>
                        <span aria-hidden className="fms-changes-arrow">→</span>
                        <span className="fms-changes-after">{changeWords(c.field, c.after)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

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
              {tone && <FlowBadge flow={tone} label={draft.behalf ? ON_BEHALF : undefined} />}
              <span className="fms-actions-spacer" />
              {editing ? (
                <Button onClick={cancelEdit}>Cancel</Button>
              ) : (
                <Button onClick={() => void clearForm()}>
                  Clear
                </Button>
              )}
              <Button variant="primary" onClick={() => void save()}>
                {saveLabel}
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

        {debts.some((d) => !d.archived && d.form !== "pass-through") && (
          <>
            <div className="t-label" style={{ color: "var(--ink-2)", margin: "var(--space-4) 0 var(--space-2)" }}>
              Debts
            </div>
            {debts
              .filter((d) => !d.archived && d.form !== "pass-through")
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

        {/* On behalf, apart from Debts: only the people with something still open. */}
        {(() => {
          const open = debts
            .filter((d) => !d.archived && d.form === "pass-through")
            .map((d) => ({ d, owed: outstandingOf(transactions, d.id) }))
            .filter((x) => x.owed !== 0);
          return open.length === 0 ? null : (
            <>
              <div className="t-label" style={{ color: "var(--ink-2)", margin: "var(--space-4) 0 var(--space-2)" }}>
                {ON_BEHALF}
              </div>
              {open.map(({ d, owed }) => (
                <div key={d.id} className="fms-balrow">
                  <span className="t-caption">
                    {d.name}
                    <span style={{ color: "var(--ink-3)" }}>{d.kind === "receivable" ? " · owes you" : " · you hold"}</span>
                  </span>
                  <Money value={owed} size="s" tone={d.kind === "payable" ? "var(--flow-debt-text)" : undefined} />
                </div>
              ))}
            </>
          );
        })()}
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
              {latestOf(transactions).map(({ row: t, part, total }) => (
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
                    <span className="t-body fms-truncate">{recentTitle(t, debts)}</span>
                    <span className="t-micro fms-truncate" style={{ color: "var(--ink-3)" }}>
                      #{String(t.recordNumber).padStart(4, "0")} · {shortDay(t.date)} · {walletsOf(t)}
                      {part ? ` · ${formatMoney(part.total)} ${partWords(t.debtEffect)}` : ""}
                    </span>
                  </div>
                  <Money value={total} size="s" tone={AMOUNT_TONE[t.type]} />
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
          /*
            What the form holds right now, so a card sent to the form stops
            being a photograph of it and starts being a view of it.
          */
          formDraft={draft}
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

/**
 * Newest by date, then by number within a day.
 *
 * More than a card holds on purpose: the card shows as many whole rows as fit
 * beside the form (see "As many whole entries as the card has room for" in
 * layout.css), which is two on the short Debt form and twelve on a tall
 * screen.
 */
function latestOf(transactions: readonly Transaction[], count = 24) {
  /*
   * A debt payment with interest in it is one line, as it was one payment:
   * "Maya Credit, paid ₱2,688.79", not a ₱2,500.00 line and a ₱188.79 line
   * that read as two separate things. A borrowing with fees added is one
   * line the same way.
   */
  return movementsOf(
    [...transactions].sort((a, b) => b.date.localeCompare(a.date) || b.recordNumber - a.recordNumber),
  ).slice(0, count);
}

/**
 * A line's name. A debt row had no item and showed the word "Debt", so three
 * borrowings and a payment on Maya Credit read as four lines saying "Debt".
 */
function recentTitle(t: Transaction, debts: readonly Debt[]): string {
  if (t.type === "Debt") {
    const debt = debts.find((d) => d.id === t.debtId);
    const name = debt?.name || t.item;
    const did = t.debtEffect ? effectInline(t.debtEffect, debt) : "";
    return [name || "Debt", did].filter(Boolean).join(", ");
  }
  return t.item || t.description || t.type;
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
 * One field, its label on top.
 *
 * Labels sat in a right-aligned column beside the controls, so on every line
 * the eye went left for the label and right for the field, and two fields
 * sharing a line had their labels at different heights. On top, a label and
 * its field read as one thing and a pair lines up. A one-tap suggestion sits
 * at the end of the label line, where it is seen without being in the way.
 */
function Field({
  label,
  children,
  required,
  error,
  hint,
  aside,
  half,
}: {
  label: string;
  children: React.ReactNode;
  required?: boolean | undefined;
  error?: string | undefined;
  hint?: string | undefined;
  /** A suggestion beside the label, such as "Use Food". */
  aside?: React.ReactNode;
  /** Shares a line with the field beside it, on a form wide enough for both. */
  half?: boolean | undefined;
}) {
  return (
    <div className={half ? "fms-field fms-field--half" : "fms-field"}>
      <div className="fms-field-head">
        <span className="t-label fms-field-label">
          {label}
          {required && (
            <span aria-hidden className="fms-req">
              {" "}
              *
            </span>
          )}
        </span>
        {aside}
      </div>
      {children}
      {(error || hint) && (
        <p className={error ? "t-caption fms-field-error" : "t-micro fms-field-hint"} role={error ? "alert" : undefined}>
          {error || hint}
        </p>
      )}
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
 *
 * The interest goes back in as stated interest. Worked out again from what is
 * owed, PHP 120.00 of interest inside a PHP 1,000.00 payment on a PHP 1,000.00
 * balance came back as no interest at all, and saving the correction would
 * have binned the interest row the owner had typed.
 */
function draftForEditing(row: Transaction, transactions: readonly Transaction[]): Draft {
  const parent = parentOf(row, transactions) ?? row;
  const part = partOf(parent, transactions);
  if (part && parent.debtEffect === "repay") {
    return { ...transactionToDraft(parent), amount: parent.amount + part.amount, interest: part.amount };
  }
  // A borrowing's fees were added on top of it, so the amount stays what was received.
  if (part && parent.debtEffect === "draw") {
    return { ...transactionToDraft(parent), charges: part.amount };
  }
  return transactionToDraft(row);
}

const DRAFT_KEY = "fms.add.draft";

/** When the last card sent to the form was put in it, so remounting the form does not put it in again. */
let appliedAt = 0;

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
