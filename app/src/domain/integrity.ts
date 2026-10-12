/**
 * Data integrity checks.
 *
 * The Excel silently tolerated mis-categorised rows: a transfer fee with a
 * blank category still left the wallet, but never registered as an expense,
 * so the TOTAL FUNDS tile drifted ₱30.00 above the wallet balances beside it
 * (rows #8 and #190). Nothing surfaced that: the numbers just quietly
 * disagreed.
 *
 * These checks make that class of problem visible. They are advisory: they
 * never alter or drop data, they only report. The user decides what to fix.
 */

import type { Centavos } from "./money";
import type { IsoDate, Transaction } from "./types";
import { walletDelta } from "./balances";
import { formatMedium } from "./dates";
import { formatMoney } from "./money";
import { cashWallet, feeInside } from "./withdrawal";

export type IssueSeverity = "error" | "warning" | "info";

export type IssueCode =
  | "debt-same-wallet"
  | "total-mismatch"
  | "uncategorised-fee"
  | "fee-row-with-amount"
  | "missing-category"
  | "missing-item"
  | "no-wallet"
  | "negative-amount"
  | "spending-without-source"
  | "revenue-without-destination"
  | "transfer-same-wallet"
  | "duplicate-record-number"
  | "fee-inside-withdrawal"
  | "below-zero-day";

export interface Issue {
  readonly code: IssueCode;
  readonly severity: IssueSeverity;
  /** Transaction ids this issue concerns. */
  readonly ids: readonly string[];
  readonly recordNumbers: readonly number[];
  readonly message: string;
  /** Money misreported because of this issue, where that is meaningful. */
  readonly impact?: Centavos;
}

const isFeeItem = (item: string): boolean =>
  item.trim().toLowerCase() === "transaction fee";

/**
 * Run every check over the ledger.
 *
 * Ordered most to least severe so the UI can show the top few and collapse
 * the rest.
 */
export function checkIntegrity(
  transactions: readonly Transaction[],
  /** The open accounts and the day, for the checks that need them: a fee saved inside a withdrawal, a day closing below zero. */
  context: { readonly wallets?: readonly string[]; readonly asOf?: IsoDate } = {},
): Issue[] {
  const issues: Issue[] = [];

  const one = (
    t: Transaction,
    code: IssueCode,
    severity: IssueSeverity,
    message: string,
    impact?: Centavos,
  ): void => {
    issues.push({
      code,
      severity,
      ids: [t.id],
      recordNumbers: [t.recordNumber],
      message,
      ...(impact === undefined ? {} : { impact }),
    });
  };

  for (const t of transactions) {
    // The load-bearing invariant. Every historical row satisfies it.
    if (t.total !== t.amount + t.fee) {
      one(
        t,
        "total-mismatch",
        "error",
        `Total does not equal amount + fee.`,
        t.total - (t.amount + t.fee),
      );
    }

    if (t.amount < 0 || t.fee < 0) {
      one(t, "negative-amount", "error", `Negative amount or fee.`);
    }

    /**
     * The ₱30 bug. A transfer carrying a fee must be categorised as
     * Spending / Transaction Fee, or the fee leaves the wallet without ever
     * being counted as an expense.
     */
    if (t.type === "Transfer" && t.fee > 0) {
      /*
       * Money that left the accounts is filed as Money Send, fee and all:
       * that is what `draftToTransactions` writes, and the whole row counts
       * as spending (CLAUDE.md, "Transfers are derived"). Only a move between
       * the owner's own accounts needs Transaction Fee to show its cost.
       */
      const sentOut = !t.toWallet.trim() && t.item.trim().toLowerCase() === "money send";
      if (t.category !== "Spending" || !(isFeeItem(t.item) || sentOut)) {
        one(
          t,
          "uncategorised-fee",
          "warning",
          `Transfer fee is not categorised as Spending / Transaction Fee, ` +
            `so it leaves the wallet without counting as an expense.`,
          t.fee,
        );
      }
    }

    /**
     * A SPENDING row filed under "Transaction Fee" should carry its money in
     * the fee column: the whole row means "I paid a fee". When the amount
     * column is non-zero the label is wrong and the entire amount lands in
     * the fee bucket.
     *
     * Record #280: "Send to PNB used in grocery", ₱4,000 + ₱15, is really a
     * Money Send, and single-handedly inflates the fee ranking by ₱4,000.
     *
     * Transfer rows are excluded: there, `item` labels what the fee was for
     * and a non-zero amount is simply the sum transferred. Only the `fee`
     * column is attributed to fees for those rows, so nothing is misreported.
     */
    if (t.type === "Spending" && isFeeItem(t.item) && t.amount > 0) {
      one(
        t,
        "fee-row-with-amount",
        "warning",
        `Filed as Transaction Fee but the amount column holds ` +
          `money: the fee belongs in the fee column. Probably a Money Send.`,
        t.amount,
      );
    }

    /*
     * A category and an item are expected on a spending or a revenue row and
     * on nothing else.
     *
     * Both of these fired on every transfer and every debt row, where both
     * fields are blank by design: a transfer has no category (the form offers
     * none) and a debt row is named by its debt. On the owner's own ledger
     * that was 64 notices that a transfer has no category and 63 that it has
     * no item, against three real findings. A checker that reports 127 things
     * that are not wrong is not a checker, and the sentence was false as well:
     * a transfer is not in the category totals to be excluded from.
     */
    const named = t.type === "Spending" || t.type === "Revenue";

    // Income with no category is still counted by every income total, so the note says so (backup of 7 October 2026).
    if (named && !t.category) {
      one(t, "missing-category", "info", t.type === "Revenue" ? "No category. Every income total still counts it." : `No category, so excluded from category totals.`);
    }

    if (named && !t.item) {
      one(t, "missing-item", "info", `No item, so excluded from every ranking.`);
    }

    /*
     * A charge the lender adds and a write-off move no wallet by design: the
     * balance owed changes and no money moves. Flagging them as broken put a
     * warning on every written-off advance and every fee on a credit line.
     */
    /*
     * So does what a debt stood at when the records begin: borrowed before the
     * first row, so no wallet received it inside the ledger. Filed Opening, as a
     * wallet's starting balance is (docs/08, rule Y1).
     */
    const movesNoWallet =
      t.type === "Debt" &&
      (t.debtEffect === "charge" || t.debtEffect === "writeoff" || (t.debtEffect === "draw" && t.category === "Opening"));
    if (!t.fromWallet && !t.toWallet && !movesNoWallet) {
      one(t, "no-wallet", "error", `No wallet on either side, so it affects no balance.`);
    }

    if (t.type === "Spending" && !t.fromWallet) {
      one(t, "spending-without-source", "warning", `Spending with no source wallet.`);
    }

    if (t.type === "Revenue" && !t.fromWallet && !t.toWallet) {
      one(
        t,
        "revenue-without-destination",
        "warning",
        `Revenue with no destination wallet.`,
      );
    }

    if (t.type === "Transfer" && t.fromWallet && t.fromWallet === t.toWallet) {
      one(t, "transfer-same-wallet", "warning", `Transfer to the same wallet.`);
    }

    /*
     * A debt movement out of and into the same wallet moves no money, so the
     * borrowing never reached the wallet and only the debt went up. Two Maya
     * Credit borrowings were saved this way on 27 September 2026 ("Maya ->
     * Maya"), and net worth fell by the whole ₱4,000.00 borrowed. Reported,
     * never corrected: which side is right is the owner's to say.
     */
    if (t.type === "Debt" && t.debtEffect && t.fromWallet && t.fromWallet === t.toWallet) {
      one(t, "debt-same-wallet", "warning", `A debt movement out of and into ${t.fromWallet}: it moves no money, so the wallet is wrong.`);
    }
  }

  // Record numbers should be unique; the Excel renumbers on every write.
  const byNumber = new Map<number, Transaction[]>();
  for (const t of transactions) {
    const list = byNumber.get(t.recordNumber);
    if (list) list.push(t);
    else byNumber.set(t.recordNumber, [t]);
  }
  for (const [num, all] of byNumber) {
    /*
     * A row saved as part of another shares its number on purpose: a
     * borrowing and the fees added with it, a payment and its interest
     * (`partOf`). They are one entry, not two using one number.
     */
    const ids = new Set(all.map((t) => t.id));
    const list = all.filter((t) => !(t.partOf && ids.has(t.partOf)));
    if (list.length > 1) {
      issues.push({
        code: "duplicate-record-number",
        severity: "warning",
        ids: list.map((t) => t.id),
        recordNumbers: [num],
        message: `Record number ${num} is used by ${list.length} transactions.`,
      });
    }
  }

  const rank: Record<IssueSeverity, number> = { error: 0, warning: 1, info: 2 };
  /*
   * ── A machine fee saved inside a withdrawal ──────────────────────────────
   * A machine gives whole hundreds, so PHP 1,018.00 into Cash with no fee is
   * PHP 1,000.00 of cash and an PHP 18.00 fee: Cash is credited money the
   * machine never gave (backup of 7 October 2026, three rows). Reported,
   * never split: the form's Split button does that when the owner says so.
   */
  const cash = cashWallet(context.wallets ?? []);
  if (cash) {
    for (const t of transactions) {
      const split = feeInside(t, cash);
      if (split) {
        one(t, "fee-inside-withdrawal", "warning", `${formatMoney(t.amount)} into ${cash} with no fee looks like ${formatMoney(split.cash)} of cash and a ${formatMoney(split.fee)} machine fee saved as one amount. Edit it and split the fee out, so ${cash} holds what the machine gave.`, split.fee);
      }
    }
  }

  /*
   * ── An account that closed a day below zero ──────────────────────────────
   * Today's balance was the only one looked at, so Maya closing 26 September
   * at -PHP 207.99 was never said (backup of 7 October 2026). Each time an
   * account goes from zero or above to below it at the end of a day, once,
   * with the rows of that day. A missing or misdated entry, never corrected here.
   */
  if (context.wallets && context.wallets.length > 0) {
    const upTo = context.asOf ?? "9999-12-31";
    const byDay = [...transactions].filter((t) => t.date <= upTo).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    for (const wallet of context.wallets) {
      let balance = 0;
      let below = false;
      for (let i = 0; i < byDay.length; ) {
        const day = byDay[i]!.date;
        const rows: Transaction[] = [];
        while (i < byDay.length && byDay[i]!.date === day) {
          const t = byDay[i]!;
          const d = walletDelta(t, (w) => w === wallet);
          if (d !== 0) rows.push(t);
          balance += d;
          i += 1;
        }
        if (balance < 0 && !below && rows.length > 0) {
          issues.push({
            code: "below-zero-day",
            severity: "warning",
            ids: rows.map((t) => t.id),
            recordNumbers: rows.map((t) => t.recordNumber),
            message: `${wallet} closed ${formatMedium(day)} at ${formatMoney(balance)}. An entry for money that came in before then may be missing or dated later.`,
            impact: -balance,
          });
        }
        below = balance < 0;
      }
    }
  }

  return issues.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

export interface IntegritySummary {
  readonly errors: number;
  readonly warnings: number;
  readonly infos: number;
  readonly total: number;
  /** Total money misreported by warning- and error-level issues. */
  readonly misreported: Centavos;
  readonly byCode: Readonly<Partial<Record<IssueCode, number>>>;
}

export function summarise(issues: readonly Issue[]): IntegritySummary {
  const byCode: Partial<Record<IssueCode, number>> = {};
  let errors = 0;
  let warnings = 0;
  let infos = 0;
  let misreported = 0;

  for (const i of issues) {
    byCode[i.code] = (byCode[i.code] ?? 0) + 1;
    if (i.severity === "error") errors++;
    else if (i.severity === "warning") warnings++;
    else infos++;
    if (i.impact && i.severity !== "info") misreported += Math.abs(i.impact);
  }

  return { errors, warnings, infos, total: issues.length, misreported, byCode };
}

/** Just the issues worth interrupting the user for. */
export function actionableIssues(issues: readonly Issue[]): Issue[] {
  return issues.filter((i) => i.severity !== "info");
}

/**
 * "Show me and delete those wrong transactions."
 *
 * The owner, 21 September 2026: asked the chat to find the bad entries, got
 * a list that matched on the word "transactions", binned it, and said "it
 * just show me random things. I like the ai to find the bad transactions".
 * The app already knows which rows are wrong in a way it can say: the checks
 * above, the same ones that fill "Needs review" in the Database. So that is
 * the list, each row with the check that caught it, worst first.
 */
export function flaggedRows(
  transactions: readonly Transaction[],
): { readonly row: Transaction; readonly why: readonly string[] }[] {
  const byId = new Map(transactions.map((t) => [t.id, t] as const));
  const found = new Map<string, string[]>();
  for (const issue of actionableIssues(checkIntegrity(transactions))) {
    for (const id of issue.ids) {
      if (!byId.has(id)) continue;
      found.set(id, [...(found.get(id) ?? []), issue.message]);
    }
  }
  return [...found.entries()].map(([id, why]) => ({ row: byId.get(id) as Transaction, why }));
}

/** Asking for the wrong rows as a set, rather than for one row by its description. */
export function asksForWrongRows(said: string): boolean {
  return (
    /\b(wrong|bad|incorrect|mistaken|faulty|suspicious|weird|odd|flagged|problem|problematic|erroneous|broken|messy|mali|maling)\s+(?:\w+\s+)?(transactions|entries|rows|records|data|ones|inputs)\b/i.test(said) ||
    /\b(needs?|need to)\s+review\b|\bwhat(?:'s| is) wrong with my (?:data|entries|transactions|ledger)\b/i.test(said) ||
    /\b(find|show|check|list|look for)\b[^.?!]*\b(mistakes|errors|problems)\b/i.test(said)
  );
}
