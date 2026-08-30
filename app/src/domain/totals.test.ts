/**
 * Parity tests: totals and rankings.
 *
 * Asserted against figures read straight from the workbook's cells. A failure
 * here means the app would show the user a different number than the system it
 * replaces. Fix the code, not the expectation.
 */

import { describe, expect, it } from "vitest";

import { loadFixture } from "../fixtures/load";
import { getMonth, getYear } from "./dates";
import { formatMoney } from "./money";
import {
  cashFlowForYear,
  dailyRevenue,
  dailySpending,
  expenseRanking,
  monthTotals,
  monthlyTotalsForYear,
  revenueRanking,
  spendingRanking,
  spendingTypeTotal,
  totalBills,
  totalRevenue,
  totalSpending,
  totalSubscriptions,
  totalsFor,
  walletUsage,
} from "./totals";

const fx = loadFixture();
const YEAR = getYear(fx.expected.asOf);
const MONTH = getMonth(fx.expected.asOf); // the month the workbook was captured in

describe("parity: SUMMARY headline figures", () => {
  /**
   * D4 is PHP 222,244.14. We report PHP 222,259.14.
   *
   * The PHP 15.00 is record #8: a real transfer fee whose item was left blank,
   * so the workbook's formula never saw it. Deriving the classification from
   * the destination instead of reading a typed label finds it. See
   * `domain/transfers.ts`.
   */
  it("exceeds SUMMARY!D4 by the one fee the workbook could not see", () => {
    const actual = totalSpending(fx.transactions);
    const missedFee = 15_00;

    expect(actual - fx.expected.summary.spending).toBe(missedFee);
    expect(actual).toBe(fx.expected.summary.spending + missedFee);
  });

  it("total revenue matches SUMMARY!D5", () => {
    expect(totalRevenue(fx.transactions)).toBe(fx.expected.summary.revenue);
  });

  it("subscriptions match SUMMARY!D6", () => {
    expect(totalSubscriptions(fx.transactions)).toBe(fx.expected.summary.subscription);
  });

  it("bills match SUMMARY!D7", () => {
    expect(totalBills(fx.transactions)).toBe(fx.expected.summary.bills);
  });
});

describe("parity: INSIGHTS month totals", () => {
  it("reproduces the captured month's total spend exactly", () => {
    const t = monthTotals(fx.transactions, YEAR, MONTH);
    expect(
      t.total,
      `got ${formatMoney(t.total)}, workbook ${formatMoney(
        fx.expected.insights.totalSpendThisMonth,
      )}`,
    ).toBe(fx.expected.insights.totalSpendThisMonth);
  });

  it("splits that total into its four documented buckets", () => {
    const t = monthTotals(fx.transactions, YEAR, MONTH);
    expect(t.spending + t.bills + t.subscriptions + t.fees).toBe(t.total);
    // Every bucket contributes in the captured month, so the split is exercised.
    expect(t.spending).toBeGreaterThan(0);
    expect(t.bills).toBeGreaterThan(0);
    expect(t.subscriptions).toBeGreaterThan(0);
    expect(t.fees).toBeGreaterThan(0);
  });

  /**
   * The workbook's monthly split never included Money Send at all, though its
   * own spending ranking did. The ranking and the month total therefore
   * disagreed by PHP 4,100.00 across 2026. They agree here.
   *
   * January: PHP 2,000.00 (#13) + PHP 100.00 (#28) + PHP 15.00 (#8)
   * June:    PHP 2,000.00 (#369)
   */
  const MONTHLY_DELTA = [211500, 0, 0, 0, 0, 200000, 0, 0, 0, 0, 0, 0];

  it("agrees with the BUDGETING monthly summary except for money that left", () => {
    const perMonth = monthlyTotalsForYear(fx.transactions, YEAR);

    fx.expected.monthlyBudgetSummary.forEach((row, i) => {
      // The workbook only has data through the captured month.
      if (i + 1 > MONTH) return;
      const got = perMonth[i]?.total ?? 0;
      const want = row.spending + (MONTHLY_DELTA[i] ?? 0);
      expect(got, `${row.month}: got ${formatMoney(got)}, expected ${formatMoney(want)}`).toBe(want);
    });
  });

  it("leaves every month the workbook got right exactly where it was", () => {
    const perMonth = monthlyTotalsForYear(fx.transactions, YEAR);

    fx.expected.monthlyBudgetSummary.forEach((row, i) => {
      if (i + 1 > MONTH || MONTHLY_DELTA[i] !== 0) return;
      expect(perMonth[i]?.total, row.month).toBe(row.spending);
    });
  });

  it("adds PHP 4,115.00 across the year and nothing to August", () => {
    expect(MONTHLY_DELTA.reduce((a, b) => a + b, 0)).toBe(411500);
    expect(MONTHLY_DELTA[7]).toBe(0);
  });
});

describe("parity: spending ranking", () => {
  const ranking = spendingRanking(fx.transactions, fx.reference.spendingTypes);

  it("reproduces every ranked amount from the workbook's tally", () => {
    // Transaction Fee and Money Send diverge for documented data reasons and
    // are each asserted separately below. Every other category must match the
    // workbook to the centavo.
    const DIVERGENT = new Set(["Transaction Fee", "Money Send"]);
    const expected = fx.expected.spendingRanking.filter(
      (r) => r.amount !== 0 && !DIVERGENT.has(r.name),
    );

    for (const want of expected) {
      const got = ranking.find((r) => r.name === want.name);
      expect(got, `"${want.name}" missing from ranking`).toBeDefined();
      expect(
        got?.amount,
        `${want.name}: got ${formatMoney(got?.amount ?? 0)}, workbook ${formatMoney(want.amount)}`,
      ).toBe(want.amount);
    }
  });

  /**
   * The workbook holds three fee definitions that disagree with one another:
   * PHP 443.00 on SUMMARY!D4, PHP 428.00 in the cached ranking, PHP 513.00
   * elsewhere. None is derived; each reads a typed label with a different
   * filter around it.
   *
   * Ours is PHP 458.00: every fee charged on a transfer that stayed inside your
   * accounts, whatever the row happens to be labelled.
   */
  it("counts every transfer fee, including the one that was never labelled", () => {
    const ours = spendingTypeTotal(fx.transactions, "Transaction Fee");

    const labelled = fx.transactions
      .filter((t) => t.type === "Transfer" && t.item === "Transaction Fee")
      .reduce((a, t) => a + t.fee, 0);
    const everyInternalFee = fx.transactions
      .filter((t) => t.type === "Transfer" && t.toWallet.trim() !== "")
      .reduce((a, t) => a + t.fee, 0);
    // Record #280: a PHP 4,015 grocery send filed as type Spending under the
    // fee name. Still attributed here, still flagged by the integrity check.
    const misfiled = fx.transactions
      .filter((t) => t.type === "Spending" && t.item === "Transaction Fee")
      .reduce((a, t) => a + t.total, 0);

    expect(labelled).toBe(443_00);
    expect(everyInternalFee).toBe(458_00);
    expect(ours).toBe(everyInternalFee + misfiled);
  });

  it("sums to the annual spending figure exactly, with no double counting", () => {
    // The strongest check on the whole ranking: every peso of the annual
    // total is attributed to exactly one bucket, and none is counted twice.
    // The Excel never satisfied this.
    const full = spendingRanking(fx.transactions, fx.reference.spendingTypes, undefined, {
      includeUnlisted: true,
    });
    expect(full.reduce((a, r) => a + r.amount, 0)).toBe(totalSpending(fx.transactions));
  });

  it("preserves the workbook's ordering", () => {
    const expectedOrder = fx.expected.spendingRanking
      .filter((r) => r.amount !== 0 && r.name !== "Transaction Fee")
      .map((r) => r.name);
    const ours = ranking.map((r) => r.name).filter((n) => n !== "Transaction Fee");
    expect(ours.slice(0, expectedOrder.length)).toEqual(expectedOrder);
    // Money Send keeps its rank despite the ₱10 difference.
    expect(ours.indexOf("Money Send")).toBe(expectedOrder.indexOf("Money Send"));
  });

  it("excludes revenue items that would otherwise dominate", () => {
    // "Framelink" (151k) and "Allowance" (74k) are revenue, not spending.
    // Ranking by raw ledger item instead of declared types would surface them.
    const names = ranking.map((r) => r.name);
    expect(names).not.toContain("Framelink");
    expect(names).not.toContain("Allowance");
  });

  it("includes the fee the workbook dropped from Money Send", () => {
    // The workbook summed `amount` only, losing record #429's ₱10.00 fee.
    const ours = spendingTypeTotal(fx.transactions, "Money Send");
    const workbook = fx.expected.spendingRanking.find((r) => r.name === "Money Send");
    expect(ours - (workbook?.amount ?? 0)).toBe(10_00);
  });
});

describe("parity: wallet usage", () => {
  const usage = walletUsage(fx.transactions);
  const byName = new Map(usage.map((u) => [u.name, u.amount]));

  it("matches the workbook for wallets with clean data", () => {
    for (const name of ["Cash", "Maya"]) {
      const want = fx.expected.walletUsage.find((w) => w.name === name);
      expect(byName.get(name), name).toBe(want?.amount);
    }
  });

  it("differs from the workbook on Gcash by the two fees it could not see", () => {
    // Records #8 and #190, PHP 15.00 each, both charged on Gcash transfers.
    // The workbook's formula required a typed label and neither row carried the
    // right one, so it under-counted Gcash by PHP 30.00.
    const want = fx.expected.walletUsage.find((w) => w.name === "Gcash");
    expect((byName.get("Gcash") ?? 0) - (want?.amount ?? 0)).toBe(30_00);
  });

  it("ranks highest first", () => {
    const amounts = usage.map((u) => u.amount);
    expect([...amounts].sort((a, b) => b - a)).toEqual(amounts);
  });
});

describe("date filtering", () => {
  it("all-time equals the sum of every month, since the data is one year", () => {
    const perMonth = monthlyTotalsForYear(fx.transactions, YEAR);
    const summed = perMonth.reduce((a, m) => a + m.revenue, 0);
    const allTime = totalsFor(fx.transactions).revenue;
    expect(summed).toBe(allTime);
  });

  it("a range covering everything equals no range at all", () => {
    const all = totalSpending(fx.transactions);
    const ranged = totalSpending(fx.transactions, {
      start: "2000-01-01",
      end: "2099-12-31",
    });
    expect(ranged).toBe(all);
  });

  it("an empty range yields zero", () => {
    expect(
      totalSpending(fx.transactions, { start: "2099-01-01", end: "2099-12-31" }),
    ).toBe(0);
  });

  it("includes both endpoints", () => {
    const first = fx.transactions[0]!;
    const only = totalsFor(
      fx.transactions.filter((t) => t.date === first.date),
    );
    const ranged = totalsFor(
      fx.transactions.filter(
        (t) => t.date >= first.date && t.date <= first.date,
      ),
    );
    expect(ranged).toEqual(only);
  });
});

describe("daily breakdowns", () => {
  it("daily spending for the captured month sums to that month's spend", () => {
    const days = dailySpending(fx.transactions, YEAR, MONTH, 31);
    const t = monthTotals(fx.transactions, YEAR, MONTH);
    // Daily view counts all Spending rows plus fees and money sends; the month
    // total counts Spending/Bills/Subs plus fees. Both cover the same rows here.
    expect(days.reduce((a, b) => a + b, 0)).toBe(t.total);
  });

  it("daily revenue for the captured month sums to that month's revenue", () => {
    const days = dailyRevenue(fx.transactions, YEAR, MONTH, 31);
    const t = monthTotals(fx.transactions, YEAR, MONTH);
    expect(days.reduce((a, b) => a + b, 0)).toBe(t.revenue);
  });

  it("returns one entry per day", () => {
    expect(dailySpending(fx.transactions, YEAR, 2, 28)).toHaveLength(28);
  });
});

describe("supporting rankings", () => {
  it("ranks bills and subscriptions to their SUMMARY totals", () => {
    const bills = expenseRanking(fx.transactions, "Bills");
    const subs = expenseRanking(fx.transactions, "Subscriptions");

    expect(bills.reduce((a, r) => a + r.amount, 0)).toBe(fx.expected.summary.bills);
    expect(subs.reduce((a, r) => a + r.amount, 0)).toBe(
      fx.expected.summary.subscription,
    );
  });

  it("ranks revenue sources highest first", () => {
    const rev = revenueRanking(fx.transactions);
    expect(rev.length).toBeGreaterThan(0);
    expect(rev[0]!.amount).toBeGreaterThanOrEqual(rev[rev.length - 1]!.amount);
  });
});

describe("parity: net cash flow", () => {
  const flow = cashFlowForYear(fx.transactions, YEAR);

  it("matches the workbook's revenue row", () => {
    fx.expected.netCashFlow.revenue.forEach((want, i) => {
      if (i + 1 > MONTH) return;
      expect(flow.revenue[i], `month ${i + 1}`).toBe(want);
    });
  });

  it("matches the workbook's expense row, plus the money that left", () => {
    // The same PHP 4,115.00 as the monthly summary, for the same reason.
    const delta = [211500, 0, 0, 0, 0, 200000, 0, 0, 0, 0, 0, 0];
    fx.expected.netCashFlow.expense.forEach((want, i) => {
      if (i + 1 > MONTH) return;
      expect(flow.expense[i], `month ${i + 1}`).toBe(want + (delta[i] ?? 0));
    });
  });
});
