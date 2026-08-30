import { describe, expect, it } from "vitest";

import { loadFixture } from "../fixtures/load";
import { allWalletBalances, walletBalance } from "./balances";
import {
  accountBalances,
  activeAccounts,
  canArchive,
  inactiveAccounts,
  goalProgress,
  goalsInside,
  goalsOf,
  migrateAccounts,
  renameAccount,
  renameImpact,
  renameItem,
  reserveBalance,
  savingsBalance,
  spendableBalance,
  totalHoldings,
  validateAccount,
  type Account,
} from "./accounts";

const fx = loadFixture();
const accounts = migrateAccounts(fx.reference.wallets, fx.reference.savings, fx.transactions);
const byName = (name: string): Account => accounts.find((a) => a.name === name)!;

describe("migration: classification only", () => {
  it("keeps the everyday wallets as spending accounts", () => {
    for (const name of ["Gcash", "Maya", "Cash"]) {
      expect(byName(name).kind, name).toBe("spending");
    }
  });

  /**
   * The reserves sat in the Excel's ACTIVE WALLET list, which is why the daily
   * budget would have offered them back to you the moment they held money.
   */
  it("reclassifies the hidden stashes as reserves", () => {
    for (const name of ["Reserved Fund", "Allowance (Reserve)", "Tuition (Reserve)"]) {
      expect(byName(name).kind, name).toBe("reserve");
    }
  });

  it("keeps the declared savings as savings", () => {
    expect(byName("Extra Cash").kind).toBe("savings");
    expect(byName("Maya Bank (Personal savings)").kind).toBe("savings");
  });

  it("recognises the two savings goals hiding as accounts", () => {
    const drone = byName("Maya Bank (Drone)");
    const phone = byName("Maya Bank (New Phone)");

    expect(drone.kind).toBe("goal");
    expect(phone.kind).toBe("goal");
    expect(drone.parentId).toBe(byName("Maya Bank (Personal savings)").id);
    expect(phone.parentId).toBe(byName("Maya Bank (Personal savings)").id);
  });

  it("picks up history-only accounts and archives them", () => {
    const hidden = byName("Hidden cash (fieldtrip)");
    expect(hidden.kind).toBe("reserve");
    expect(hidden.archived).toBe(true);
  });

  it("covers every account the ledger references", () => {
    const named = new Set(accounts.map((a) => a.name));
    for (const name of allWalletBalances(fx.transactions).keys()) {
      expect(named.has(name), `${name} missing from the account list`).toBe(true);
    }
  });

  /** The same safety property the debt migration has: no money moves. */
  it("leaves every balance untouched", () => {
    for (const { account, balance } of accountBalances(accounts, fx.transactions)) {
      expect(balance, account.name).toBe(walletBalance(fx.transactions, account.name));
    }
  });
});

describe("what counts where", () => {
  it("excludes reserves and savings from spendable money (rule A3)", () => {
    // The workbook's three everyday wallets.
    expect(spendableBalance(accounts, fx.transactions)).toBe(611245);
  });

  it("counts savings and goals together", () => {
    expect(savingsBalance(accounts, fx.transactions)).toBe(152758);
  });

  it("counts every kind toward total holdings (rule A2)", () => {
    const total = totalHoldings(accounts, fx.transactions);
    expect(total).toBe(
      spendableBalance(accounts, fx.transactions) +
        reserveBalance(accounts, fx.transactions) +
        savingsBalance(accounts, fx.transactions),
    );
    // Ties to the workbook's own wallet + savings figures.
    expect(total).toBe(764003);
  });

  /**
   * The reserves hold ₱0.00 today, so the old model excluded them by luck.
   * Put money in one and the distinction has to hold on purpose.
   */
  it("keeps a funded reserve out of spendable money", () => {
    const funded = [
      ...fx.transactions,
      {
        ...fx.transactions[0]!,
        id: "stash",
        type: "Transfer" as const,
        fromWallet: "Cash",
        toWallet: "Tuition (Reserve)",
        amount: 500000,
        fee: 0,
        total: 500000,
      },
    ];

    expect(reserveBalance(accounts, funded)).toBe(500000);
    expect(spendableBalance(accounts, funded)).toBe(611245 - 500000);
    // Still yours, so holdings are unchanged.
    expect(totalHoldings(accounts, funded)).toBe(764003);
  });
});

describe("goals", () => {
  const goal: Account = {
    id: "iphone",
    name: "Maya Bank (iPhone)",
    kind: "goal",
    parentId: "maya-bank-personal-savings",
    target: 6_500_000,
    deadline: "2027-02-28",
    openedDate: "2026-08-01",
    archived: false,
  };

  const fund = (amount: number, date = "2026-08-15") => ({
    ...fx.transactions[0]!,
    id: `f${amount}${date}`,
    date,
    type: "Transfer" as const,
    fromWallet: "Maya Bank (Personal savings)",
    toWallet: goal.name,
    amount,
    fee: 0,
    total: amount,
  });

  it("counts a funding transfer as progress", () => {
    const p = goalProgress(goal, [fund(1_300_000)], "2026-08-29");
    expect(p.saved).toBe(1_300_000);
    expect(p.remaining).toBe(5_200_000);
    expect(p.progress).toBeCloseTo(0.2, 5);
    expect(p.status).toBe("active");
  });

  it("leaves net worth unchanged when funding a goal", () => {
    // Money moved between two of your own accounts: a transfer, rule A4.
    const before = totalHoldings(accounts, fx.transactions);
    const after = totalHoldings(
      [...accounts, goal],
      [...fx.transactions, fund(100000)],
    );
    expect(after).toBe(before);
  });

  it("says what you need to save each month", () => {
    const p = goalProgress(goal, [fund(500_000)], "2026-08-29");
    // ₱60,000 left over roughly 6 months.
    expect(p.requiredPerMonth).toBeGreaterThan(900_000);
    expect(p.requiredPerMonth).toBeLessThan(1_100_000);
  });

  it("reports reached the moment the target is met", () => {
    const p = goalProgress(goal, [fund(6_500_000)], "2026-09-01");
    expect(p.status).toBe("reached");
    expect(p.remaining).toBe(0);
  });

  it("allows overshooting (rule G7)", () => {
    const p = goalProgress(goal, [fund(7_000_000)], "2026-09-01");
    expect(p.status).toBe("reached");
    expect(p.progress).toBeGreaterThan(1);
    expect(p.remaining).toBe(0);
  });

  /**
   * "Auto close" means the status changes: never that money moves (rule G4).
   * The balance after maturing is exactly what it was before.
   */
  it("matures at the deadline without touching the money", () => {
    const rows = [fund(2_000_000)];
    const before = goalProgress(goal, rows, "2027-02-27");
    const after = goalProgress(goal, rows, "2027-03-01");

    expect(before.status).toBe("active");
    expect(after.status).toBe("matured");
    expect(after.saved).toBe(before.saved);
    expect(after.requiredPerMonth).toBeUndefined();
  });

  it("flags falling behind the pace", () => {
    // Roughly half the window gone, only 5% saved.
    const p = goalProgress(goal, [fund(325_000)], "2026-11-15");
    expect(p.onTrack).toBe(false);
  });

  it("sorts things needing a decision first", () => {
    const matured: Account = { ...goal, id: "old", name: "Old goal", deadline: "2026-01-01" };
    const sorted = goalsOf([goal, matured], [], "2026-08-29");
    expect(sorted[0]?.status).toBe("matured");
  });

  it("lists the goals sitting inside a parent", () => {
    const parent = byName("Maya Bank (Personal savings)");
    const inside = goalsInside(accounts, parent.id);
    expect(inside.map((g) => g.name).sort()).toEqual([
      "Maya Bank (Drone)",
      "Maya Bank (New Phone)",
    ]);
  });
});

describe("validation", () => {
  const base: Account = { id: "x", name: "New wallet", kind: "spending", archived: false };

  it("rejects a duplicate name", () => {
    const issues = validateAccount({ ...base, name: "Maya" }, accounts, fx.transactions);
    expect(issues.some((i) => i.field === "name")).toBe(true);
  });

  it("requires a parent, target and deadline on a goal", () => {
    const issues = validateAccount({ ...base, kind: "goal" }, accounts, fx.transactions);
    expect(issues.map((i) => i.field).sort()).toEqual(["deadline", "parentId", "target"]);
  });

  it("refuses to archive an account still holding money (rule G6)", () => {
    const maya = { ...byName("Maya"), archived: true };
    const issues = validateAccount(maya, accounts, fx.transactions);
    expect(issues[0]?.message).toContain("Move it out");
  });

  it("accepts a clean new account", () => {
    expect(validateAccount(base, accounts, fx.transactions)).toEqual([]);
  });
});

describe("marking an account inactive", () => {
  it("allows it once the balance is zero", () => {
    // Extra Cash has been spent down to nothing.
    const check = canArchive(byName("Extra Cash"), fx.transactions);
    expect(check.ok).toBe(true);
    expect(check.balance).toBe(0);
  });

  /**
   * Archiving a funded account would hide money that still counts toward net
   * worth, so the total would stop matching the parts beside it.
   */
  it("refuses while money is still in it, and says how to fix that", () => {
    const check = canArchive(byName("Maya"), fx.transactions);
    expect(check.ok).toBe(false);
    expect(check.balance).toBe(579574);
    expect(check.fix).toContain("Transfer the balance");
  });

  it("tells a finished goal to spend or move the money back", () => {
    const goal: Account = {
      id: "iphone",
      name: "Maya Bank (iPhone)",
      kind: "goal",
      parentId: "maya-bank-personal-savings",
      target: 100000,
      deadline: "2027-01-31",
      archived: false,
    };
    const funded = [
      {
        ...fx.transactions[0]!,
        id: "fund",
        type: "Transfer" as const,
        fromWallet: "Maya Bank (Personal savings)",
        toWallet: goal.name,
        amount: 100000,
        fee: 0,
        total: 100000,
      },
    ];

    const check = canArchive(goal, funded);
    expect(check.ok).toBe(false);
    expect(check.fix).toContain("transfer it back to the parent");
  });

  it("keeps inactive accounts out of pickers but still in the list", () => {
    const active = activeAccounts(accounts).map((a) => a.name);
    const inactive = inactiveAccounts(accounts).map((a) => a.name);

    expect(active).toContain("Maya");
    expect(active).not.toContain("Hidden cash (fieldtrip)");
    expect(inactive).toContain("Hidden cash (fieldtrip)");
  });

  it("still counts an inactive account toward holdings", () => {
    // Its balance is ₱0.00 here, but the rule is what matters: archiving is a
    // visibility change, never an accounting one.
    const archived = accounts.map((a) => ({ ...a, archived: true }));
    expect(totalHoldings(archived, fx.transactions)).toBe(
      totalHoldings(accounts, fx.transactions),
    );
  });
});

describe("renaming rewrites history", () => {
  it("reports how many rows a rename will touch", () => {
    expect(renameImpact(fx.transactions, "Gcash")).toBeGreaterThan(0);
  });

  /**
   * Leaving history on the old name would split the account in two and quietly
   * corrupt the balance. The rename has to be all-or-nothing.
   */
  it("moves the whole balance with the name", () => {
    const before = walletBalance(fx.transactions, "Gcash");
    const renamed = renameAccount(fx.transactions, "Gcash", "GCash Wallet");

    expect(walletBalance(renamed, "GCash Wallet")).toBe(before);
    expect(walletBalance(renamed, "Gcash")).toBe(0);
  });

  it("leaves other accounts alone", () => {
    const renamed = renameAccount(fx.transactions, "Gcash", "GCash Wallet");
    expect(walletBalance(renamed, "Maya")).toBe(579574);
  });

  it("renames a spending type across every row", () => {
    const before = fx.transactions.filter((t) => t.item === "Food").length;
    const renamed = renameItem(fx.transactions, "Food", "Meals");

    expect(renamed.filter((t) => t.item === "Meals")).toHaveLength(before);
    expect(renamed.filter((t) => t.item === "Food")).toHaveLength(0);
  });

  it("is a no-op for an empty or unchanged name", () => {
    expect(renameAccount(fx.transactions, "Gcash", "  ")).toHaveLength(fx.transactions.length);
    expect(renameAccount(fx.transactions, "Gcash", "Gcash")[0]).toEqual(fx.transactions[0]);
  });
});
