/**
 * What if: the owner's own situations, played through the app's own functions
 * from the entry to every figure that ought to move.
 *
 * Each save goes the way the Add form and the assistant both save: checked by
 * `checkDraft`, turned into rows by `draftToTransactions`, put in date order
 * by `insertChronologically`. Nothing here builds a row by hand to make a
 * figure come out right. The scenarios are the ones that broke, or nearly
 * did, on 2026-09-15: three identical draws on one day, borrowing saved as
 * income, a bill paid twice, wallets below zero, a rename that stranded a
 * limit and a debt, and an overpayment.
 */

import { describe, expect, it } from "vitest";

import { loadFixture } from "../fixtures/load";
import type { Account } from "./accounts";
import { financeAlerts } from "./alerts";
import { totalSavingsBalance, totalWalletBalance, walletBalance } from "./balances";
import { billStatuses } from "./bills";
import { assessMonthFor, budgetForYear } from "./budget";
import { categoryLimits, renameLimitKind, setCategoryLimit } from "./budgetView";
import { netWorth, outstandingOf, positionOf, positionsOf, renameDebtAccount, type Debt } from "./debt";
import { checkDraft, draftToTransactions, emptyDraft, insertChronologically, type Draft } from "./entry";
import { monthBrief } from "./monthPlan";
import { monthTotals } from "./totals";
import type { Budgets, ReferenceLists, Transaction } from "./types";

const fx = loadFixture();
const AS_OF = "2026-09-15";

const reference: ReferenceLists = {
  ...fx.reference,
  wallets: ["Cash", "Gcash"],
  savings: ["Savings"],
  bills: ["Wifi"],
  subscriptions: ["Spotify"],
};

const accounts: Account[] = [
  { id: "cash", name: "Cash", kind: "spending", archived: false },
  { id: "gcash", name: "Gcash", kind: "spending", archived: false },
  { id: "savings", name: "Savings", kind: "savings", archived: false },
];

const credit: Debt = {
  id: "maya-credit",
  name: "Maya Credit",
  kind: "payable",
  counterparty: "Maya",
  openedDate: "2026-07-01",
  wallet: "Gcash",
  interestType: "none",
  interestRate: 0,
  notes: "",
  archived: false,
};

const friend: Debt = { ...credit, id: "ben", name: "Ben", kind: "receivable", form: "informal", wallet: "Cash" };
const DEBTS = [credit, friend];

const d = (over: Partial<Draft>): Draft => ({ ...emptyDraft("2026-09-05"), ...over });

/** Saved the way the form saves: checked, turned into rows, put in date order. */
function save(ledger: readonly Transaction[], draft: Draft): Transaction[] {
  const check = checkDraft(draft, ledger, reference, DEBTS, AS_OF);
  if (!check.ok) throw new Error(check.errors.map((e) => e.message).join(" "));
  const number = ledger.length + 1;
  return insertChronologically(ledger, draftToTransactions(draft, number, `w${number}`, check.repaymentSplit));
}

const alertsFor = (ledger: readonly Transaction[], budgets: Budgets = {}) =>
  financeAlerts({
    transactions: ledger,
    accounts,
    budgets,
    debts: DEBTS,
    bills: billStatuses(ledger, reference, AS_OF),
    lowBalanceThreshold: 0,
    asOf: AS_OF,
  });

const withSeptember = (spending: number): Budgets => {
  const base = budgetForYear({}, 2026);
  const s = [...base.spending];
  s[8] = spending;
  return { "2026": { ...base, spending: s } };
};

const income = (amount: number, date = "2026-09-01", into = "Cash"): Draft =>
  d({ date, flow: "Revenue", toWallet: into, category: "Revenue", item: "Allowance", amount });

describe("spending against a budget", () => {
  it("lowers what is left by exactly the entry, and binning it gives it back", () => {
    const budgets = withSeptember(300000);
    const funded = save([], income(500000));
    const spent = save(funded, d({ flow: "Spending", fromWallet: "Cash", category: "Spending", item: "Food", amount: 120000 }));

    expect(assessMonthFor(spent, budgets, 2026, 9).spending.remaining).toBe(180000);
    expect(walletBalance(spent, "Cash")).toBe(380000);

    const binned = spent.filter((t) => t.item !== "Food");
    expect(assessMonthFor(binned, budgets, 2026, 9).spending.remaining).toBe(300000);
    expect(walletBalance(binned, "Cash")).toBe(500000);
  });

  it("is within the budget at exactly the budget, and over at one centavo more", () => {
    const budgets = withSeptember(300000);
    const exact = save(save([], income(500000)), d({ flow: "Spending", fromWallet: "Cash", category: "Spending", item: "Food", amount: 300000 }));
    expect(assessMonthFor(exact, budgets, 2026, 9).spending.status).toBe("WITHIN THE BUDGET");

    const over = save(exact, d({ flow: "Spending", fromWallet: "Cash", category: "Spending", item: "Food", amount: 1 }));
    expect(assessMonthFor(over, budgets, 2026, 9).spending.status).toBe("OVER THE BUDGET");
  });

  it("counts only the fee when money moves between your own accounts, and all of it when sent away", () => {
    const funded = save([], income(500000));
    const moved = save(funded, d({ flow: "Transfer", fromWallet: "Cash", toWallet: "Gcash", amount: 100000, fee: 1500 }));
    expect(monthTotals(moved, 2026, 9).total).toBe(1500);
    expect(walletBalance(moved, "Gcash")).toBe(100000);

    const sent = save(moved, d({ flow: "Transfer", fromWallet: "Cash", sentOut: true, amount: 50000 }));
    expect(monthTotals(sent, 2026, 9).total).toBe(51500);
  });
});

describe("paying bills", () => {
  it("asks about a bill paid twice for the same amount in a month, and not about a different amount", () => {
    let ledger = save([], income(500000));
    ledger = save(ledger, d({ date: "2026-08-10", flow: "Spending", fromWallet: "Cash", category: "Bills", item: "Wifi", amount: 99900 }));
    ledger = save(ledger, d({ date: "2026-09-02", flow: "Spending", fromWallet: "Cash", category: "Bills", item: "Wifi", amount: 99900 }));

    const again = save(ledger, d({ date: "2026-09-09", flow: "Spending", fromWallet: "Cash", category: "Bills", item: "Wifi", amount: 99900 }));
    expect(alertsFor(again).some((a) => a.id.startsWith("twice-"))).toBe(true);

    const topUp = save(ledger, d({ date: "2026-09-09", flow: "Spending", fromWallet: "Cash", category: "Bills", item: "Wifi", amount: 50000 }));
    expect(alertsFor(topUp).some((a) => a.id.startsWith("twice-"))).toBe(false);
  });

  it("shows a paid bill as paid on the day it was paid, and sets aside only the unpaid one", () => {
    let ledger = save([], income(500000));
    ledger = save(ledger, d({ date: "2026-08-10", flow: "Spending", fromWallet: "Cash", category: "Bills", item: "Wifi", amount: 99900 }));
    ledger = save(ledger, d({ date: "2026-08-20", flow: "Spending", fromWallet: "Cash", category: "Subscriptions", item: "Spotify", amount: 8500 }));
    ledger = save(ledger, d({ date: "2026-09-08", flow: "Spending", fromWallet: "Cash", category: "Bills", item: "Wifi", amount: 99900 }));

    const brief = monthBrief({ transactions: ledger, reference, budgets: {}, debts: [], year: 2026, month: 9, asOf: AS_OF });
    const wifi = brief.bills.bills.find((b) => b.item === "Wifi");
    expect(wifi?.state).toBe("paid");
    expect(wifi?.paidOn).toBe("2026-09-08");
    expect(brief.safe?.reservedBills).toBe(8500);
  });
});

describe("debts", () => {
  it("asks about three identical draws on one day, and not about two meals", () => {
    let ledger = save([], income(500000));
    const draw = d({ flow: "Debt", debtId: credit.id, debtEffect: "draw", toWallet: "Gcash", amount: 200000 });
    ledger = save(save(save(ledger, draw), draw), draw);
    const meal = d({ flow: "Spending", fromWallet: "Cash", category: "Spending", item: "Food", amount: 15000 });
    ledger = save(save(ledger, meal), meal);

    const repeats = alertsFor(ledger).filter((a) => a.id.startsWith("repeat-"));
    expect(repeats).toHaveLength(1);
    expect(repeats[0]?.title).toContain("Maya Credit");
    expect(repeats[0]?.title).toContain("3 times");
  });

  it("splits an overpayment into principal and interest, clears the debt, and counts the interest as spending", () => {
    let ledger = save([], income(500000, "2026-08-01", "Gcash"));
    ledger = save(ledger, d({ date: "2026-08-20", flow: "Debt", debtId: credit.id, debtEffect: "draw", toWallet: "Gcash", amount: 100000 }));
    ledger = save(ledger, d({ flow: "Debt", debtId: credit.id, debtEffect: "repay", fromWallet: "Gcash", amount: 110000 }));

    expect(outstandingOf(ledger, credit.id)).toBe(0);
    expect(positionOf(credit, ledger, AS_OF).status).toBe("settled");
    expect(monthTotals(ledger, 2026, 9).interest).toBe(10000);
    expect(walletBalance(ledger, "Gcash")).toBe(500000 + 100000 - 110000);
  });

  it("leaves net worth where it was when money is lent and when it comes back", () => {
    const worth = (ledger: readonly Transaction[]): number =>
      netWorth(
        totalWalletBalance(ledger, reference.wallets),
        totalSavingsBalance(ledger, reference.savings),
        positionsOf(DEBTS, ledger, AS_OF),
      ).total;

    const funded = save([], income(100000));
    const lent = save(funded, d({ flow: "Debt", debtId: friend.id, debtEffect: "lend", fromWallet: "Cash", amount: 50000 }));
    const back = save(lent, d({ date: "2026-09-10", flow: "Debt", debtId: friend.id, debtEffect: "collect", toWallet: "Cash", amount: 50000 }));

    expect(worth(lent)).toBe(worth(funded));
    expect(worth(back)).toBe(worth(funded));
    expect(outstandingOf(back, friend.id)).toBe(0);
  });

  it("asks about borrowing saved as income, and not about a small reward under the same name", () => {
    let ledger = save([], d({ date: "2026-09-01", flow: "Revenue", toWallet: "Gcash", category: "Revenue", item: "Maya Credit", amount: 250000 }));
    ledger = save(ledger, d({ date: "2026-09-02", flow: "Revenue", toWallet: "Gcash", category: "Revenue", item: "Maya Credit", amount: 85 }));

    const found = alertsFor(ledger).filter((a) => a.id.startsWith("borrowed-income-"));
    expect(found).toHaveLength(1);
    expect(found[0]?.title).toBe("1 Maya Credit row saved as income");
  });

  it("follows the account a debt moves through when that account is renamed", () => {
    const [renamed] = renameDebtAccount([credit], "Gcash", "GCash Wallet");
    expect(renamed?.wallet).toBe("GCash Wallet");
    const [untouched] = renameDebtAccount([friend], "Gcash", "GCash Wallet");
    expect(untouched).toBe(friend);
  });
});

describe("renaming a kind of spending", () => {
  it("carries its limit to the new name, and keeps a limit already on that name", () => {
    const food = setCategoryLimit(budgetForYear({}, 2026), "Food", 9, 300000, "month");
    const both = setCategoryLimit(food, "Meals", 10, 200000, "month");

    const moved = renameLimitKind({ "2026": both }, "Food", "Meals");
    expect(moved.years).toEqual(["2026"]);
    const plan = moved.budgets["2026"];
    expect(categoryLimits(plan, 9).get("Meals")).toBe(300000);
    expect(categoryLimits(plan, 10).get("Meals")).toBe(200000);
    expect(categoryLimits(plan, 9).has("Food")).toBe(false);

    expect(renameLimitKind({ "2026": both }, "Travel", "Trips").years).toEqual([]);
  });
});

describe("safe to spend when things go wrong", () => {
  it("says plainly when the wallets are below zero, and offers nothing a day", () => {
    const ledger = save([], d({ flow: "Spending", fromWallet: "Cash", category: "Spending", item: "Food", amount: 50000 }));
    const brief = monthBrief({ transactions: ledger, reference, budgets: {}, debts: [], year: 2026, month: 9, asOf: AS_OF });
    expect(brief.safe?.perDay).toBe(0);
    expect(brief.notes.some((n) => n.includes("below zero"))).toBe(true);
    expect(brief.notes.some((n) => n.includes("more than your wallets hold"))).toBe(false);
  });

  it("counts an entry dated later this month in the wallets, as net worth does", () => {
    const ledger = save(
      save([], income(100000)),
      d({ date: "2026-09-25", flow: "Spending", fromWallet: "Cash", category: "Spending", item: "Food", amount: 20000 }),
    );
    const brief = monthBrief({ transactions: ledger, reference, budgets: {}, debts: [], year: 2026, month: 9, asOf: AS_OF });
    expect(brief.safe?.wallets).toBe(totalWalletBalance(ledger, reference.wallets));
    expect(brief.safe?.wallets).toBe(80000);
  });
});

describe("accounts that do not add up", () => {
  const alertsWith = (ledger: readonly Transaction[], list: readonly Account[]) =>
    financeAlerts({
      transactions: ledger,
      accounts: list,
      budgets: {},
      debts: [],
      bills: [],
      lowBalanceThreshold: 0,
      asOf: AS_OF,
    });

  it("asks about two accounts under one name, and two that differ only in capitals", () => {
    const twice = alertsWith([], [...accounts, { id: "cash-2", name: "Cash", kind: "spending", archived: false }]);
    expect(twice.some((a) => a.id.startsWith("same-name-") && a.title === "2 accounts are called Cash")).toBe(true);

    const spelt = alertsWith([], [...accounts, { id: "gcash-2", name: "GCash", kind: "spending", archived: false }]);
    expect(spelt.some((a) => a.id.startsWith("same-name-") && a.title.includes("look like one account"))).toBe(true);
  });

  it("asks about money under a wallet name no account has, and about a deactivated account still holding money", () => {
    const typo = save([], income(100000, "2026-09-01", "Gcsh"));
    expect(alertsWith(typo, accounts).some((a) => a.id === "stray-Gcsh")).toBe(true);

    const held = save([], income(100000, "2026-09-01", "Savings"));
    const off = accounts.map((a) => (a.id === "savings" ? { ...a, archived: true } : a));
    expect(alertsWith(held, off).find((a) => a.id === "stray-Savings")?.title).toContain("deactivated");
  });

  it("asks about an entry dated a year ahead", () => {
    const typo = save([], d({ date: "2027-09-10", flow: "Spending", fromWallet: "Cash", category: "Spending", item: "Food", amount: 10000 }));
    expect(alertsWith(typo, accounts).some((a) => a.id === "far-ahead")).toBe(true);
    const soon = save([], d({ date: "2026-09-20", flow: "Spending", fromWallet: "Cash", category: "Spending", item: "Food", amount: 10000 }));
    expect(alertsWith(soon, accounts).some((a) => a.id === "far-ahead")).toBe(false);
  });
});

describe("the assistant saves through the same checks", () => {
  it("flags extra zeros on a card exactly as the form does", () => {
    let ledger: Transaction[] = [];
    for (const day of ["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04", "2026-08-05"]) {
      ledger = save(ledger, income(500000, day));
    }
    const card = income(100_000_000, "2026-09-10");
    const check = checkDraft(card, ledger, reference, DEBTS, AS_OF);
    expect(check.ok).toBe(true);
    expect(check.unusual?.times).toBe(200);
  });

  it("refuses a card that draws against money owed to you", () => {
    const check = checkDraft(
      d({ flow: "Debt", debtId: friend.id, debtEffect: "draw", toWallet: "Cash", amount: 50000 }),
      [],
      reference,
      DEBTS,
      AS_OF,
    );
    expect(check.ok).toBe(false);
  });
});
