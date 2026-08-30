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
import type { Transaction } from "./types";

export type IssueSeverity = "error" | "warning" | "info";

export type IssueCode =
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
  | "duplicate-record-number";

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
export function checkIntegrity(transactions: readonly Transaction[]): Issue[] {
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
      if (t.category !== "Spending" || !isFeeItem(t.item)) {
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

    if (!t.category) {
      one(t, "missing-category", "info", `No category, so excluded from category totals.`);
    }

    if (!t.item) {
      one(t, "missing-item", "info", `No item, so excluded from every ranking.`);
    }

    if (!t.fromWallet && !t.toWallet) {
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
  }

  // Record numbers should be unique; the Excel renumbers on every write.
  const byNumber = new Map<number, Transaction[]>();
  for (const t of transactions) {
    const list = byNumber.get(t.recordNumber);
    if (list) list.push(t);
    else byNumber.set(t.recordNumber, [t]);
  }
  for (const [num, list] of byNumber) {
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
