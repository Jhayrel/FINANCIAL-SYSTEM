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
import { debtNamedBy, effectsFor, outstandingOf, splitRepayment } from "./debt";
import { daysBetween, formatMedium, getMonth, getYear, monthName, today } from "./dates";
import { formatMoney as money, type Centavos } from "./money";
import { kindKey, unusualAgainst, type Unusual } from "./unusual";
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
  /**
   * Transfer only: the money left your accounts.
   *
   * A transfer with no destination is Money Send, which is a documented,
   * saveable row (CLAUDE.md, "Transfers are derived"): a blank destination
   * books the whole amount as spending, a named one books only the fee.
   *
   * It lives on the draft because `checkDraft` has to be able to tell it
   * apart from a destination you have not chosen yet, and those look
   * identical in every other field. It used to be component state in
   * `AddTransaction`, invisible from here, so every Money Send failed
   * validation with "Pick the wallet the money lands in" and the Save button
   * silently did nothing.
   */
  sentOut?: boolean | undefined;
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
/**
 * A saved row, back into the form.
 *
 * A Transfer with no destination is read back as Money Send, so editing one
 * does not silently turn into "you forgot to pick a wallet".
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
    ...(flow === "Transfer" && !t.toWallet.trim() ? { sentOut: true } : {}),
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

/**
 * Set a debt effect, and put the wallet on the side that effect implies.
 *
 * A sentence names one wallet and says nothing about direction: "I paid my
 * debt 2950 using maya" and "borrowed 2950 into maya" both give up Maya and
 * nothing else, so the reader parks it in `fromWallet` and waits for the
 * effect to say which way the money went.
 *
 * Once it is known, the wallet has to move. Borrowing puts money **into** an
 * account; left on the from side, the same row would take the amount out
 * instead, and the wallet would be wrong by twice the draw in the wrong
 * direction. `runningBalance` reads the side, not the effect, so this is the
 * function that keeps the two agreeing.
 *
 * A write-off moves no money at all: it is a line being forgiven, not a
 * payment, so it clears both sides rather than guessing at one.
 */
export function withDebtEffect(draft: Draft, effect: DebtEffect): Draft {
  const named = draft.fromWallet || draft.toWallet;
  const side = debtWalletDirection(effect);
  return {
    ...draft,
    debtEffect: effect,
    fromWallet: side === "out" ? named : "",
    toWallet: side === "in" ? named : "",
  };
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

/**
 * The largest figure this ledger stores, in centavos.
 *
 * Kept in step with `firestore.rules`, which bounds money at the same value.
 * The rule is the one that actually holds; this exists so the refusal can be
 * a sentence next to the field rather than a permissions error at the write.
 */
export const MOST_MONEY = 100_000_000_000;

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
  /**
   * A spending row whose item names a debt: most likely a payment to it, or
   * money lent, filed as spending. The form offers to book it properly.
   */
  readonly debtPayment?: { readonly debtId: string; readonly name: string } | undefined;
  /** Far larger than any row of its kind before. The form asks before saving it. */
  readonly unusual?: Unusual | undefined;
}

export function checkDraft(
  draft: Draft,
  transactions: readonly Transaction[],
  reference: ReferenceLists,
  debts: readonly Debt[] = [],
  /** Today, for a date far ahead of it or far behind. */
  asOf: IsoDate = today(),
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

  /**
   * A negative fee, which nothing checked.
   *
   * The amount is guarded and the fee was not, and `total = amount + fee`, so
   * a fee of minus fifty turned a hundred peso row into a fifty peso one. The
   * database agrees with the arithmetic and stores it, because the rule
   * checks that the parts add up rather than which way they point. Every
   * total in the app then quietly understates by the difference.
   */
  if (draft.fee < 0) {
    errors.push({ field: "fee", message: "A fee cannot be negative." });
  }

  /**
   * Bigger than the database will take.
   *
   * `firestore.rules` bounds money at ±₱1,000,000,000, so a larger figure is
   * refused at the write with "Missing or insufficient permissions": true,
   * unhelpful, and indistinguishable from the rules not being deployed. The
   * limit belongs where it can be explained, next to the field it applies to.
   */
  const total = (draft.amount ?? 0) + draft.fee;
  if (total >= MOST_MONEY) {
    errors.push({
      field: "amount",
      message: `That is over ${money(MOST_MONEY)}, which is more than this ledger stores. Check the figure.`,
    });
  }
  if (!draft.date) {
    errors.push({ field: "date", message: "Pick a date." });
  }

  /**
   * A debt movement has one wallet, and which one depends on the effect.
   *
   * ── The refusal this fixes ────────────────────────────────────────────
   *
   * Borrowing 5,000 on Maya Credit into Gcash was refused with "Pick the
   * wallet the money leaves". There is no such wallet. The money comes from
   * the credit line, which is the whole meaning of a draw: that is why the
   * card asks which credit line rather than which account.
   *
   * So the required side follows the direction, exactly as
   * `debtWalletDirection` and `runningBalance` already read it:
   *
   *   draw, collect      money arrives, so it needs somewhere to land
   *   repay, interest,
   *   fee, lend          money leaves, so it needs somewhere to leave from
   *   write-off          nothing moves, so neither is required
   *
   * The other side stays optional rather than forbidden. A repayment made
   * straight from a wallet into the line has no destination account, and a
   * draw has no source account, and saying so with a blank is correct.
   */
  const debtSide = draft.flow === "Debt" ? debtWalletDirection(draft.debtEffect) : null;

  if (debtSide) {
    if (debtSide === "out" && !draft.fromWallet) {
      errors.push({ field: "fromWallet", message: "Pick the wallet the money leaves." });
    }
    if (debtSide === "in" && !draft.toWallet) {
      errors.push({ field: "toWallet", message: "Pick the wallet the money lands in." });
    }
  } else if (needs(draft.flow, "fromWallet") && !draft.fromWallet) {
    errors.push({ field: "fromWallet", message: "Pick the wallet the money leaves." });
  }
  /**
   * A transfer that left your accounts has no destination, and that is the
   * answer rather than a gap. Anything else with a `toWallet` field needs one.
   */
  const moneySend = draft.flow === "Transfer" && draft.sentOut === true;
  if (needs(draft.flow, "toWallet") && !draft.toWallet && draft.flow !== "Debt" && !moneySend) {
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

    const debt = draft.debtId ? debts.find((d) => d.id === draft.debtId) : undefined;

    /**
     * The effect has to suit the direction.
     *
     * A "draw" against money lent to a friend put the money into a wallet
     * and raised what they owed at the same time, so the same PHP 500 was
     * counted twice. Money you owe is drawn and repaid; money owed to you is
     * lent and collected.
     */
    if (debt && draft.debtEffect && !effectsFor(debt.kind).includes(draft.debtEffect)) {
      errors.push({
        field: "debtEffect",
        message:
          debt.kind === "payable"
            ? `${debt.name} is money you owe. Pick draw, repay, interest or write-off.`
            : `${debt.name} is money owed to you. Pick lend, collect or write-off.`,
      });
    }

    /**
     * An archived debt takes no new rows. Settings says archiving removes it
     * from the entry form; the form still listed it, so a movement could be
     * filed against a line that no longer shows anywhere. Editing a row that
     * is already filed against it is still allowed.
     */
    if (debt?.archived && !draft.id) {
      errors.push({
        field: "debt",
        message: `${debt.name} is archived. Reopen it in Settings, under Credit and loans, to record something new against it.`,
      });
    }
  }

  // ── Warnings ─────────────────────────────────────────────────────────────

  /**
   * A Spending or Revenue row with no item.
   *
   * Record #442 is in the ledger as Spending, PHP 371.00, with the item field
   * empty. It is real money and it is invisible to every report that groups
   * by item: the monthly split, the rankings, the year by category. It is not
   * wrong, it is unfindable, which is worse, because nothing flags it.
   *
   * A warning and not an error, deliberately. `fieldsFor` has always allowed a
   * blank item and there are rows in the imported history without one, so
   * refusing to save would make part of the owner's own past unwritable. This
   * says it out loud at the moment it would happen and lets them decide.
   *
   * Transfer and Debt are excluded: neither names a thing bought, and their
   * items are derived rather than typed.
   */
  if ((draft.flow === "Spending" || draft.flow === "Revenue") && !draft.item.trim()) {
    warnings.push({
      field: "item",
      message:
        "No item, so this will not appear in any breakdown by item. Save it without one?",
    });
  }

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

  /**
   * A spending row named after a debt.
   *
   * The Excel filed the Maya Credit bill under Bills, and the habit carries
   * over: the money leaves the wallet, counts as spending, and what is owed
   * never comes down, so the Debt screen reports a balance already paid.
   */
  let debtPayment: EntryCheck["debtPayment"];
  if (draft.flow === "Spending") {
    const named = debtNamedBy(
      debts.filter((d) => !d.archived),
      draft.item,
    );
    if (named) {
      debtPayment = { debtId: named.id, name: named.name };
      warnings.push({
        field: "item",
        message:
          named.kind === "payable"
            ? `"${named.name}" is a debt. Paying it lowers what you owe and is not spending, so as spending it would count twice. Book it as a repayment instead?`
            : `"${named.name}" is money owed to you. Handing them more is lending, not spending. Book it as lending instead?`,
      });
    }
  }

  /**
   * Far more than anything of its kind before: extra zeros, most likely.
   * See `domain/unusual.ts`. The screen asks before saving it.
   */
  let unusual: Unusual | undefined;
  if (draft.flow && draft.flow !== "Opening" && total < MOST_MONEY) {
    const type: Transaction["type"] = draft.flow;
    const key = kindKey({ type, category: draft.category, debtEffect: draft.debtEffect });
    if (key !== null) {
      const peers = transactions.filter(
        (t) => t.id !== draft.id && t.id !== `${draft.id}-interest` && kindKey(t) === key,
      );
      const found = unusualAgainst(total, peers);
      if (found) {
        unusual = found;
        const kind =
          type === "Revenue" ? "income" : type === "Debt" ? `${draft.debtEffect ?? "debt"} row` : type.toLowerCase();
        warnings.push({
          field: "amount",
          message: `${money(total)} is ${found.times} times the largest ${kind} ever recorded (${money(found.largest)}). Check the zeros before saving.`,
        });
      }
    }
  }

  /**
   * A date far from today, on a new entry.
   *
   * The date field keeps whatever it was last set to, and typing 2025 for
   * 2026 files a row a year away from its month. Neither is refused: a
   * receipt from last year is real. Editing a saved row says nothing, since
   * old rows are old on purpose.
   */
  if (draft.date && !draft.id) {
    const ahead = daysBetween(asOf, draft.date);
    if (ahead > 3) {
      warnings.push({
        field: "date",
        message: `This is dated ${ahead} days from today, so it counts in ${monthName(getMonth(draft.date))} ${getYear(draft.date)}, not now. Is the date right?`,
      });
    } else if (ahead < -365) {
      warnings.push({
        field: "date",
        message: `This is dated ${formatMedium(draft.date)}, more than a year ago. Is the year right?`,
      });
    }
  }

  // A fee bigger than what it was charged on: the two boxes swapped, usually.
  if (
    (draft.flow === "Transfer" || draft.flow === "Spending") &&
    draft.amount !== null &&
    draft.amount > 0 &&
    draft.fee > draft.amount
  ) {
    warnings.push({
      field: "fee",
      message: `The fee (${money(draft.fee)}) is more than the amount (${money(draft.amount)}). Are the two the wrong way round?`,
    });
  }

  // Rules D2 and D3.
  if (draft.flow === "Debt" && draft.debtId) {
    const debt = debts.find((d) => d.id === draft.debtId);
    /**
     * What is owed without the row being edited.
     *
     * Editing the ₱2,500.00 repayment up to ₱3,500.00 split it into
     * ₱2,950.00 principal and ₱550.00 interest, because the ₱2,950.00 still
     * owed had already been reduced by the very payment being corrected.
     * Without it ₱5,450.00 is owed and the whole ₱3,500.00 is principal.
     * Saving the edit would have booked a ₱550.00 interest row that never
     * happened. A draw being edited had the same fault against the credit
     * limit. `runningBalance` already leaves the edited row out; this does
     * the same.
     */
    const others = draft.id ? transactions.filter((t) => t.id !== draft.id) : transactions;
    const outstanding = outstandingOf(others, draft.debtId);
    const amount = draft.amount ?? 0;

    if (draft.debtEffect === "repay" && amount > 0) {
      const split = splitRepayment(amount, outstanding);
      repaymentSplit = split;
      if (split.interest > 0) {
        warnings.push({
          field: "amount",
          message:
            outstanding <= 0
              ? `Nothing is owed on ${debt?.name ?? "this debt"}, so all ${money(amount)} would be recorded as interest. If you borrowed first, record that draw before this payment.`
              : `Only ${money(split.principal)} of this is principal. The other ${money(split.interest)} will be recorded as interest.`,
        });
      }
    }

    // Collecting or forgiving more than is outstanding takes it below zero.
    if ((draft.debtEffect === "collect" || draft.debtEffect === "writeoff") && amount > Math.max(0, outstanding)) {
      warnings.push({
        field: "amount",
        message: `Only ${money(Math.max(0, outstanding))} is outstanding on ${debt?.name ?? "this debt"}. ${
          draft.debtEffect === "collect" ? "Collecting" : "Writing off"
        } ${money(amount)} takes it below zero.`,
      });
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

  return { ok: errors.length === 0, errors, warnings, repaymentSplit, debtPayment, unusual };
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
  /**
   * `false` sorts without renumbering, for a ledger whose numbers are stored
   * rather than rewritten (Firebase). Renumbering there lasted only until the
   * database answered with the stored numbers, so every earlier row's number
   * flickered on each back-dated save.
   */
  options: { readonly renumber?: boolean } = {},
): Transaction[] {
  const merged = [...transactions, ...additions].sort((a, b) =>
    a.date === b.date ? a.recordNumber - b.recordNumber : a.date.localeCompare(b.date),
  );
  if (options.renumber === false) return merged;
  return merged.map((t, i) => ({ ...t, recordNumber: i + 1 }));
}

/**
 * The number a new row gets: one past every number in use.
 *
 * `binned` is for a ledger that keeps its numbers. A binned row keeps its
 * number and restoring it brings that number back, so counting only the live
 * rows handed the newest row's number straight back out the moment it was
 * binned: bin it, add another, restore it, and two rows carried one number.
 * Where the ledger is renumbered on every write the restore renumbers anyway,
 * and the bin is left out so the form shows the number the row will get.
 */
export function nextRecordNumber(
  live: readonly Transaction[],
  binned: readonly Transaction[] = [],
): number {
  let highest = 0;
  for (const t of live) if (t.recordNumber > highest) highest = t.recordNumber;
  for (const t of binned) if (t.recordNumber > highest) highest = t.recordNumber;
  return highest + 1;
}
