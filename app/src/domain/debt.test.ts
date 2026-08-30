/**
 * Debt domain tests: spec 8.2 `debt.test.ts` and `migration.test.ts`.
 *
 * The load-bearing assertion is "wallet balances are identical before and
 * after migration". Everything else can be re-derived; that one cannot be
 * allowed to drift, because it is the difference between reclassifying money
 * and losing it.
 */

import { describe, expect, it } from "vitest";

import { loadFixture } from "../fixtures/load";
import {
  allWalletBalances,
  totalSavingsBalance,
  totalWalletBalance,
} from "./balances";
import {
  debtAlerts,
  incomeQuality,
  netWorth,
  positionOf,
  splitRepayment,
  totalPayables,
  validateDebtTransaction,
  type Debt,
} from "./debt";
import {
  applyDebtMigration,
  detectDebtCandidates,
  planDebtMigration,
  summarisePlan,
} from "./debtMigration";
import { formatMoney } from "./money";
import { monthTotals } from "./totals";

const fx = loadFixture();

const plan = planDebtMigration(fx.transactions, "Maya Credit", {
  debtId: "maya-credit",
  counterparty: "Maya",
  wallet: "Maya",
});
const migrated = applyDebtMigration(fx.transactions, plan);
const position = positionOf(plan.debt, migrated);

describe("detection", () => {
  it("finds Maya Credit from the bill/revenue overlap", () => {
    // The signature of a mislabelled debt: the same name appears as both a
    // revenue category and a bill.
    expect(detectDebtCandidates(fx.reference)).toEqual(["Maya Credit"]);
  });

  it("picks up all six credit rows", () => {
    expect(plan.proposals.map((p) => p.recordNumber).sort((a, b) => a - b)).toEqual([
      403, 408, 411, 425, 427, 432,
    ]);
  });

  it("proposes four draws, one repayment, and keeps the reward as revenue", () => {
    const by = (a: string) => plan.proposals.filter((p) => p.action === a).map((p) => p.recordNumber);

    expect(by("draw").sort((a, b) => a - b)).toEqual([403, 425, 427, 432]);
    expect(by("repay")).toEqual([408]);
    // #411 is ₱0.85 "Received Reload Freebies": a reward, not borrowing.
    expect(by("keep-revenue")).toEqual([411]);
    expect(summarisePlan(plan)).toBe("6 rows: 4 borrowing, 1 repayment, 1 kept as revenue");
  });

  it("splits the repayment against the balance outstanding at that date", () => {
    const repay = plan.proposals.find((p) => p.recordNumber === 408);
    // ₱2,688.79 paid when ₱2,500.00 was outstanding.
    expect(repay?.amount).toBe(268879);
    expect(repay?.principal).toBe(250000);
    expect(repay?.interest).toBe(18879);
  });
});

describe("MIGRATION SAFETY: balances must not move", () => {
  it("leaves every wallet balance byte-identical", () => {
    const before = allWalletBalances(fx.transactions);
    const after = allWalletBalances(migrated);

    expect([...after.keys()].sort()).toEqual([...before.keys()].sort());

    for (const [wallet, balance] of before) {
      expect(
        after.get(wallet),
        `${wallet}: ${formatMoney(before.get(wallet) ?? 0)} → ${formatMoney(after.get(wallet) ?? 0)}`,
      ).toBe(balance);
    }
  });

  it("leaves the workbook's own four balances untouched", () => {
    const after = allWalletBalances(migrated);
    for (const [name, expected] of Object.entries({
      ...fx.expected.walletBalances,
      ...fx.expected.savingsBalances,
    })) {
      expect(after.get(name), name).toBe(expected);
    }
  });

  it("conserves money: the split repayment still sums to the original", () => {
    const originals = fx.transactions.filter((t) => t.item === "Maya Credit");
    const rows = migrated.filter((t) => t.debtId === "maya-credit" || t.item === "Maya Credit");
    expect(rows.reduce((a, t) => a + t.total, 0)).toBe(
      originals.reduce((a, t) => a + t.total, 0),
    );
  });

  it("does not add or lose rows beyond the one deliberate split", () => {
    expect(migrated).toHaveLength(fx.transactions.length + 1);
  });

  it("never mutates the input ledger", () => {
    expect(fx.transactions.some((t) => t.type === "Debt")).toBe(false);
  });
});

describe("position, rule 5.6.2", () => {
  it("computes outstanding as draws minus principal repaid", () => {
    expect(position.drawn).toBe(545000); // ₱5,450.00 across four draws
    expect(position.repaid).toBe(250000); // principal only
    expect(position.interestPaid).toBe(18879);
    expect(position.outstanding).toBe(295000);
  });

  /**
   * The spec's headline says ₱2,762.06, which is `5,450.85 − 2,688.79`. That
   * contradicts the spec's own rule 5.6.2 twice: it counts record #411's
   * ₱0.85 reward as borrowing (while its migration table keeps it as
   * revenue), and it treats the whole payment as principal (while 5.6.2 says
   * ₱188.79 of it is interest).
   *
   * We implement the rule, not the headline. This test pins the gap so the
   * difference is visible rather than argued about.
   */
  it("differs from the spec headline by exactly the reward plus the interest", () => {
    const SPEC_HEADLINE = 276206;
    expect(position.outstanding - SPEC_HEADLINE).toBe(18879 - 85);
  });

  it("excludes interest from the liability", () => {
    // Interest is expense. It must never inflate what is owed.
    expect(position.outstanding).toBe(position.drawn - position.repaid);
  });

  it("stays open while a balance remains", () => {
    expect(position.status).toBe("open");
  });

  it("settles when fully repaid and reopens on a new draw", () => {
    const debt: Debt = { ...plan.debt };
    const rows = [
      row("d1", "2026-01-01", 100000, "draw", debt.id),
      row("r1", "2026-02-01", 100000, "repay", debt.id),
    ];
    expect(positionOf(debt, rows).status).toBe("settled");
    expect(positionOf(debt, rows).outstanding).toBe(0);

    const reopened = [...rows, row("d2", "2026-03-01", 50000, "draw", debt.id)];
    expect(positionOf(debt, reopened).status).toBe("open");
    expect(positionOf(debt, reopened).outstanding).toBe(50000);
  });
});

describe("month totals after migration, rule 5.2", () => {
  const before = monthTotals(fx.transactions, 2026, 8);
  const after = monthTotals(migrated, 2026, 8);

  it("keeps the workbook figure before migration", () => {
    expect(before.total).toBe(1129137);
    expect(before.interest).toBe(0);
  });

  /**
   * Reclassifying record #408 moves ₱2,688.79 out of the Bills bucket, but
   * ₱188.79 of it was interest, which IS spending. Without the interest term
   * the month silently loses that, which is exactly what the dashboard
   * surfaced: ₱8,602.58 instead of ₱8,791.37.
   */
  it("moves the repaid principal out but keeps the interest in", () => {
    expect(after.bills).toBe(before.bills - 268879);
    expect(after.interest).toBe(18879);
    expect(after.total).toBe(before.total - 268879 + 18879);
    expect(after.total).toBe(879137);
  });

  it("counts debt interest as spending, never repaid principal", () => {
    const repaid = migrated
      .filter((t) => t.debtEffect === "repay")
      .reduce((a, t) => a + t.total, 0);
    expect(repaid).toBe(250000);
    // None of that principal shows up anywhere in the month's spend.
    expect(after.spending + after.bills + after.subscriptions).toBeLessThan(
      before.spending + before.bills + before.subscriptions,
    );
  });
});

describe("net worth, rule 5.6.3", () => {
  const wallets = totalWalletBalance(migrated, fx.reference.wallets);
  const savings = totalSavingsBalance(migrated, fx.reference.savings);
  const nw = netWorth(wallets, savings, [position]);

  it("subtracts what is owed from what is held", () => {
    expect(nw.wallets).toBe(611245);
    expect(nw.savings).toBe(152758);
    expect(nw.payables).toBe(295000);
    expect(nw.receivables).toBe(0);
    expect(nw.total).toBe(611245 + 152758 - 295000);
  });

  it("lands well below the workbook's TOTAL FUNDS tile", () => {
    // The Excel showed ₱7,670.03 with no concept of the liability at all.
    expect(fx.expected.summary.totalFunds - nw.total).toBeGreaterThan(290000);
  });

  it("shows payables even at zero, so the concept stays visible (D8)", () => {
    const none = netWorth(611245, 152758, []);
    expect(none.payables).toBe(0);
    expect(none.total).toBe(764003);
  });
});

describe("income quality, rule 5.6.4", () => {
  const q = incomeQuality(migrated, [plan.debt]);

  it("separates borrowing and self-moves from real income", () => {
    expect(q.borrowed).toBe(545000);
    expect(q.openingBalance).toBe(247589);
    expect(q.selfMoves).toBe(50000);
  });

  it("keeps the ₱0.85 reward in income", () => {
    // It was never borrowed, so it is genuinely money earned.
    expect(q.cashIn).toBe(fx.expected.summary.revenue - 545000);
    expect(q.trueIncome).toBe(23729007);
  });

  it("works on the pre-migration ledger too", () => {
    // Before migration the borrowing still sits under Revenue; the split must
    // come out the same either way.
    const before = incomeQuality(fx.transactions, [plan.debt]);
    expect(before.trueIncome).toBe(23728922);
    expect(before.cashIn).toBe(fx.expected.summary.revenue);
  });
});

describe("repayment split, rule D2", () => {
  it("caps principal at the outstanding balance", () => {
    expect(splitRepayment(268879, 250000)).toEqual({ principal: 250000, interest: 18879 });
  });

  it("treats a payment against a settled debt as all interest", () => {
    expect(splitRepayment(50000, 0)).toEqual({ principal: 0, interest: 50000 });
  });

  it("treats an underpayment as all principal", () => {
    expect(splitRepayment(100000, 250000)).toEqual({ principal: 100000, interest: 0 });
  });
});

describe("validation, rules D1, D3", () => {
  it("rejects a debt row with no debt or effect", () => {
    const v = validateDebtTransaction(
      { type: "Debt", amount: 10000, debtId: undefined, debtEffect: undefined },
      undefined,
      0,
    );
    expect(v.ok).toBe(false);
    expect(v.errors).toHaveLength(2);
  });

  it("warns, but allows, an overpayment that becomes interest", () => {
    const v = validateDebtTransaction(
      { type: "Debt", amount: 268879, debtId: "maya-credit", debtEffect: "repay" },
      plan.debt,
      250000,
    );
    expect(v.ok).toBe(true);
    expect(v.warnings[0]).toContain("₱188.79");
  });

  it("warns, but allows, a draw beyond the credit limit", () => {
    const limited: Debt = { ...plan.debt, creditLimit: 300000 };
    const v = validateDebtTransaction(
      { type: "Debt", amount: 100000, debtId: limited.id, debtEffect: "draw" },
      limited,
      295000,
    );
    expect(v.ok).toBe(true);
    expect(v.warnings[0]).toContain("limit");
  });
});

describe("due alerts, rule D6", () => {
  const due = (date: string): Debt => ({ ...plan.debt, dueDate: date });

  it("warns inside seven days", () => {
    const alerts = debtAlerts([positionOf(due("2026-09-03"), migrated, "2026-08-29")], "2026-08-29");
    expect(alerts[0]?.severity).toBe("warn");
    expect(alerts[0]?.message).toContain("due in 5 days");
  });

  it("escalates once overdue", () => {
    const alerts = debtAlerts([positionOf(due("2026-08-20"), migrated, "2026-08-29")], "2026-08-29");
    expect(alerts[0]?.severity).toBe("over");
    expect(alerts[0]?.message).toContain("9 days overdue");
  });

  it("stays quiet when nothing is due soon", () => {
    expect(
      debtAlerts([positionOf(due("2026-12-01"), migrated, "2026-08-29")], "2026-08-29"),
    ).toHaveLength(0);
  });
});

// ── helper ─────────────────────────────────────────────────────────────────

function row(
  id: string,
  date: string,
  amount: number,
  effect: "draw" | "repay" | "interest" | "writeoff",
  debtId: string,
) {
  return {
    id,
    recordNumber: 0,
    date,
    type: "Debt" as const,
    fromWallet: effect === "draw" ? "" : "Maya",
    toWallet: effect === "draw" ? "Maya" : "",
    category: "" as const,
    item: "Maya Credit",
    description: "",
    amount,
    fee: 0,
    total: amount,
    notes: "",
    status: "Paid" as const,
    debtId,
    debtEffect: effect,
  };
}
