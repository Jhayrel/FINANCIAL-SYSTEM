/**
 * Transaction entry: spec 5.11 (write path) and style guide §3.3.
 *
 * Pure. Given a draft and the ledger, it says which fields the chosen flow
 * needs, what is invalid, and what the user should be warned about. The screen
 * renders the result; it decides nothing itself.
 *
 * Warnings are proceed-able by design. The Excel let you record whatever
 * actually happened, including going negative, and taking that away would make
 * the app lie about reality rather than reflect it.
 */

import { walletBalance } from "./balances";
import type { Debt, DebtEffect } from "./debt";
import { outstandingOf, splitRepayment } from "./debt";
import { today } from "./dates";
import { formatMoney as money, type Centavos } from "./money";
import type {
  IsoDate,
  ReferenceLists,
  Transaction,
  TransactionCategory,
  TransactionStatus,
} from "./types";

/**
 * `Opening` is a starting balance: money you already had on the day you began
 * counting. It is not income, and it is the thing the Excel had no name for.
 * See `domain/opening.ts`.
 */
export type Flow = "Revenue" | "Spending" | "Transfer" | "Debt" | "Opening";

export interface Draft {
  id?: string | undefined;
  flow: Flow | "";
  date: IsoDate;
  fromWallet: string;
  toWallet: string;
  category: TransactionCategory;
  item: string;
  description: string;
  amount: Centavos | null;
  fee: Centavos;
  notes: string;
  status: TransactionStatus;
  debtId?: string | undefined;
  debtEffect?: DebtEffect | undefined;
}

export function emptyDraft(date: IsoDate = today()): Draft {
  return {
    flow: "",
    date,
    fromWallet: "",
    toWallet: "",
    category: "",
    item: "",
    description: "",
    amount: null,
    fee: 0,
    notes: "",
    status: "",
  };
}

/**
 * Load a saved row back into the form.
 *
 * The Excel's input page did this with the up and down arrows: the form was
 * both the entry screen and the record browser, and `AddOrUpdateRecord` wrote
 * an insert or an update depending on whether the number already existed.
 * That is why correcting a mistake there took a moment and here took deleting
 * the row and typing it again.
 *
 * The flow is read back from the stored `type`, with one exception. An
 * `Opening` row is stored as Revenue so the balance rules credit its
 * destination, so the category is what identifies it, not the type.
 */
export function transactionToDraft(t: Transaction): Draft {
  const flow: Flow =
    t.category === "Opening" ? "Opening" : (t.type as Flow);

  return {
    id: t.id,
    flow,
    date: t.date,
    fromWallet: t.fromWallet,
    toWallet: t.toWallet,
    category: t.category,
    item: t.item,
    description: t.description,
    amount: t.amount,
    fee: t.fee,
    notes: t.notes,
    status: t.status,
    ...(t.debtId ? { debtId: t.debtId } : {}),
    ...(t.debtEffect ? { debtEffect: t.debtEffect } : {}),
  };
}

// ── Which fields the flow needs, style guide §3.3 ─────────────────────────

export type FieldName =
  | "date"
  | "fromWallet"
  | "toWallet"
  | "category"
  | "item"
  | "description"
  | "amount"
  | "fee"
  | "notes"
  | "status"
  | "debt"
  | "debtEffect";

/**
 * Only the fields that flow actually needs.
 *
 * Deliberately not one form with everything disabled, a Revenue row has no
 * source wallet, and showing a greyed-out box for it just adds noise.
 */
export function fieldsFor(flow: Flow | ""): FieldName[] {
  switch (flow) {
    case "Revenue":
      return ["date", "toWallet", "category", "item", "description", "amount", "status"];
    case "Spending":
      return ["date", "fromWallet", "category", "item", "description", "amount", "fee", "status"];
    case "Transfer":
      return ["date", "fromWallet", "toWallet", "description", "amount", "fee", "notes", "status"];
    case "Debt":
      return ["date", "debt", "debtEffect", "fromWallet", "toWallet", "amount", "notes"];
    case "Opening":
      // No source: the money was already there. Nothing came from anywhere.
      return ["date", "toWallet", "amount", "notes"];
    default:
      return [];
  }
}

export const needs = (flow: Flow | "", field: FieldName): boolean =>
  fieldsFor(flow).includes(field);

/** Categories offered for a flow. Spending is the only one with a choice. */
export function categoriesFor(flow: Flow | ""): TransactionCategory[] {
  if (flow === "Spending") return ["Spending", "Bills", "Subscriptions"];
  if (flow === "Revenue") return ["Revenue"];
  if (flow === "Opening") return ["Opening"];
  return [];
}

/** Items offered, given the flow and category. */
export function itemsFor(
  flow: Flow | "",
  category: TransactionCategory,
  reference: ReferenceLists,
): string[] {
  if (flow === "Revenue") return [...reference.revenueCategories];
  if (flow === "Spending") {
    if (category === "Bills") return [...reference.bills];
    if (category === "Subscriptions") return [...reference.subscriptions];
    return reference.spendingTypes.map((s) => s.name);
  }
  return [];
}

/** Which wallet a debt effect moves money through. */
export function debtWalletDirection(effect: DebtEffect | undefined): "in" | "out" | "none" {
  switch (effect) {
    case "draw":
    case "collect":
      return "in";
    case "repay":
    case "interest":
    case "fee":
    case "lend":
      return "out";
    default:
      return "none";
  }
}

// ── Running balance, style guide §3.3 ─────────────────────────────────────

export interface RunningBalance {
  readonly wallet: string;
  readonly before: Centavos;
  readonly after: Centavos;
  readonly goesNegative: boolean;
}

/**
 * What the source wallet looks like before and after this draft.
 *
 * `excludeId` drops the transaction being edited, so editing an entry
 * compares against the balance without it rather than double-counting.
 */
export function runningBalance(
  draft: Draft,
  transactions: readonly Transaction[],
  excludeId?: string,
): RunningBalance | null {
  const outgoing = draft.flow === "Debt"
    ? debtWalletDirection(draft.debtEffect) === "out"
    : draft.flow === "Spending" || draft.flow === "Transfer";

  const wallet = outgoing ? draft.fromWallet : draft.toWallet;
  if (!wallet) return null;

  const base = excludeId
    ? transactions.filter((t) => t.id !== excludeId)
    : transactions;

  const before = walletBalance(base, wallet);
  const total = (draft.amount ?? 0) + (draft.fee || 0);
  const after = outgoing ? before - total : before + (draft.amount ?? 0);

  return { wallet, before, after, goesNegative: after < 0 };
}

// ── Validation, spec 5.11, rules D1 to D3 ────────────────────────────────────

export interface EntryIssue {
  readonly field: FieldName | "flow";
  readonly message: string;
}

export interface EntryCheck {
  readonly ok: boolean;
  /** Block the save. */
  readonly errors: readonly EntryIssue[];
  /** Proceed-able: shown inline, never blocking. */
  readonly warnings: readonly EntryIssue[];
  /** Principal/interest breakdown, shown before saving a repayment. */
  readonly repaymentSplit?: { principal: Centavos; interest: Centavos } | undefined;
}

export function checkDraft(
  draft: Draft,
  transactions: readonly Transaction[],
  reference: ReferenceLists,
  debts: readonly Debt[] = [],
): EntryCheck {
  const errors: EntryIssue[] = [];
  const warnings: EntryIssue[] = [];
  let repaymentSplit: { principal: Centavos; interest: Centavos } | undefined;

  if (!draft.flow) {
    return { ok: false, errors: [{ field: "flow", message: "Pick what kind of transaction this is." }], warnings: [] };
  }

  // ── Required fields ──────────────────────────────────────────────────────
  if (draft.amount === null || draft.amount <= 0) {
    errors.push({ field: "amount", message: "Amount must be more than ₱0.00." });
  }
  if (!draft.date) {
    errors.push({ field: "date", message: "Pick a date." });
  }

  if (needs(draft.flow, "fromWallet") && !draft.fromWallet) {
    errors.push({ field: "fromWallet", message: "Pick the wallet the money leaves." });
  }
  if (needs(draft.flow, "toWallet") && !draft.toWallet && draft.flow !== "Debt") {
    errors.push({ field: "toWallet", message: "Pick the wallet the money lands in." });
  }

  if (draft.flow === "Transfer" && draft.fromWallet && draft.fromWallet === draft.toWallet) {
    errors.push({ field: "toWallet", message: "A transfer needs two different wallets." });
  }

  // Rule D1: a Debt row is meaningless without both.
  if (draft.flow === "Debt") {
    if (!draft.debtId) errors.push({ field: "debt", message: "Pick which debt this belongs to." });
    if (!draft.debtEffect) {
      errors.push({ field: "debtEffect", message: "Pick what this does: draw, repay, interest or write-off." });
    }
  }

  // ── Warnings ─────────────────────────────────────────────────────────────
  const balance = runningBalance(draft, transactions, draft.id);

  if (balance?.goesNegative) {
    warnings.push({
      field: "fromWallet",
      message: `This puts ${balance.wallet} at ${money(balance.after)}. Save anyway?`,
    });
  }

  // Spec 5.11: withdrawing from savings.
  const savings = new Set(reference.savings.map((s) => s.toLowerCase()));
  const source = draft.fromWallet.toLowerCase();
  if (
    draft.fromWallet &&
    (savings.has(source) || source.includes("saving")) &&
    (draft.amount ?? 0) > 0
  ) {
    warnings.push({
      field: "fromWallet",
      message: `${draft.fromWallet} is savings. Taking ${money((draft.amount ?? 0) + draft.fee)} out of it?`,
    });
  }

  /**
   * The borrowing catch: spec 5.11.
   *
   * This is the mistake that put ₱5,450 of borrowed money into the income
   * line for eight months. Catch it at the keystroke, not at year end.
   */
  if (draft.flow === "Revenue" && draft.item) {
    const match = debts.find(
      (d) => !d.archived && d.name.trim().toLowerCase() === draft.item.trim().toLowerCase(),
    );
    if (match) {
      warnings.push({
        field: "item",
        message: `"${match.name}" is a debt you owe. Money in from it is borrowing, not income. Book it as a debt draw instead?`,
      });
    }
  }

  // Rules D2 and D3.
  if (draft.flow === "Debt" && draft.debtId) {
    const debt = debts.find((d) => d.id === draft.debtId);
    const outstanding = outstandingOf(transactions, draft.debtId);
    const amount = draft.amount ?? 0;

    if (draft.debtEffect === "repay" && amount > 0) {
      const split = splitRepayment(amount, outstanding);
      repaymentSplit = split;
      if (split.interest > 0) {
        warnings.push({
          field: "amount",
          message: `Only ${money(split.principal)} of this is principal. The other ${money(split.interest)} will be recorded as interest.`,
        });
      }
    }

    if (draft.debtEffect === "draw" && debt?.creditLimit) {
      const available = debt.creditLimit - outstanding;
      if (amount > available) {
        warnings.push({
          field: "amount",
          message: `This goes ${money(amount - available)} over the ${money(debt.creditLimit)} limit on ${debt.name}.`,
        });
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings, repaymentSplit };
}

// ── Commit ─────────────────────────────────────────────────────────────────

/**
 * Turn an approved draft into ledger rows.
 *
 * A repayment that covers interest becomes two rows, so the split is visible
 * in the ledger rather than hidden inside one row's metadata, the same shape
 * the migration produces.
 */
export function draftToTransactions(
  draft: Draft,
  recordNumber: number,
  id: string,
  split?: { principal: Centavos; interest: Centavos },
): Transaction[] {
  const amount = draft.amount ?? 0;
  /**
   * A starting balance is stored as Revenue so rule 3.1 credits its
   * destination wallet, and carries `category: "Opening"` so every income
   * figure leaves it out. One row, two jobs, no new balance rule.
   */
  const type: Transaction["type"] =
    draft.flow === "" ? "Spending" : draft.flow === "Opening" ? "Revenue" : draft.flow;

  /**
   * A transfer classifies itself.
   *
   * Money Send and Transaction Fee used to be spending types the owner picked,
   * and forgetting to pick one silently lost the money from every total. They
   * are consequences of where the money went, so they are set here from the
   * destination rather than asked for. See `domain/transfers.ts`.
   */
  const opening = draft.flow === "Opening";

  const derived =
    type === "Transfer"
      ? draft.toWallet.trim() === ""
        ? { category: "Spending" as const, item: "Money Send" }
        : draft.fee > 0
          ? { category: "Spending" as const, item: "Transaction Fee" }
          : { category: "" as const, item: "" }
      : null;

  const base: Transaction = {
    id,
    recordNumber,
    date: draft.date,
    type,
    fromWallet: draft.fromWallet,
    toWallet: draft.toWallet,
    category: opening
      ? ("Opening" as const)
      : derived
        ? derived.category
        : draft.category,
    item: opening ? "Opening balance" : derived ? derived.item : draft.item,
    description: draft.description,
    amount,
    fee: draft.fee,
    total: amount + draft.fee,
    notes: draft.notes,
    status: draft.status,
    debtId: draft.debtId,
    debtEffect: draft.debtEffect,
  };

  if (draft.flow === "Debt" && draft.debtEffect === "repay" && split && split.interest > 0) {
    return [
      { ...base, amount: split.principal, fee: 0, total: split.principal, debtEffect: "repay" },
      {
        ...base,
        id: `${id}-interest`,
        amount: split.interest,
        fee: 0,
        total: split.interest,
        description: `Interest on ${draft.item || "debt"}`,
        debtEffect: "interest",
      },
    ];
  }

  return [base];
}

/**
 * Insert chronologically and renumber: spec 5.11.
 *
 * The Excel kept the ledger sorted by date and reassigned every record number
 * on each write. Preserved because the record number is a display ordinal, not
 * an identity; `id` is what anything else refers to.
 */
export function insertChronologically(
  transactions: readonly Transaction[],
  additions: readonly Transaction[],
): Transaction[] {
  const merged = [...transactions, ...additions].sort((a, b) =>
    a.date === b.date ? a.recordNumber - b.recordNumber : a.date.localeCompare(b.date),
  );
  return merged.map((t, i) => ({ ...t, recordNumber: i + 1 }));
}
