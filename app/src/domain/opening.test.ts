/**
 * Starting balances.
 *
 * The one that matters: an opening row credits the wallet and never reaches
 * the income line. That is the whole difference between this and what the
 * Excel did.
 */

import { describe, expect, it } from "vitest";

import { walletBalance } from "./balances";
import { loadFixture } from "../fixtures/load";
import {
  accountsNeedingOpening,
  canSetOpening,
  hasOpeningBalances,
  legacyCarryForwardRows,
  openingRows,
  OPENING_CATEGORY,
} from "./opening";
import { totalsFor } from "./totals";
import { applyOpeningMigration, planOpeningMigration } from "./year";
import type { Account } from "./accounts";
import type { Transaction } from "./types";

const fixture = loadFixture();
const DATE = "2026-01-01";

const accounts: Account[] = [
  { id: "maya", name: "Maya", kind: "spending", archived: false },
  { id: "cash", name: "Cash", kind: "spending", archived: false, channel: "cash" },
  { id: "gcash", name: "Gcash", kind: "spending", archived: false },
];

describe("a beginner entering what they already have", () => {
  const rows = openingRows(
    [
      { account: "Maya", amount: 5_000_00 },
      { account: "Cash", amount: 450_00 },
      { account: "Gcash", amount: 0 },
    ],
    DATE,
    1,
  );

  it("sets each balance to exactly what was entered", () => {
    expect(walletBalance(rows, "Maya")).toBe(5_000_00);
    expect(walletBalance(rows, "Cash")).toBe(450_00);
  });

  it("skips an account that starts empty, because a zero row says nothing", () => {
    expect(rows).toHaveLength(2);
    expect(rows.some((r) => r.toWallet === "Gcash")).toBe(false);
  });

  it("counts none of it as income", () => {
    expect(totalsFor(rows).revenue).toBe(0);
  });

  it("counts none of it as spending either", () => {
    expect(totalsFor(rows).total).toBe(0);
  });

  it("marks every row Opening, which is what keeps it out of income", () => {
    expect(rows.every((r) => r.category === OPENING_CATEGORY)).toBe(true);
  });

  it("numbers the rows from where it is told", () => {
    expect(openingRows([{ account: "Maya", amount: 100 }], DATE, 42)[0]?.recordNumber).toBe(42);
  });
});

describe("it refuses to double a balance", () => {
  const rows = openingRows([{ account: "Maya", amount: 5_000_00 }], DATE, 1);

  it("refuses a second starting balance for the same account", () => {
    const check = canSetOpening("Maya", rows);
    expect(check.ok).toBe(false);
    expect(check.reason).toContain("already has a starting balance");
  });

  it("refuses when the account already has transactions", () => {
    const spend: Transaction = {
      id: "s1",
      recordNumber: 2,
      date: "2026-02-01",
      type: "Revenue",
      fromWallet: "",
      toWallet: "Cash",
      category: "Revenue",
      item: "Allowance",
      description: "",
      amount: 1_000_00,
      fee: 0,
      total: 1_000_00,
      notes: "",
      status: "Received",
    };
    const check = canSetOpening("Cash", [spend]);
    expect(check.ok).toBe(false);
    expect(check.reason).toContain("counted on top of them");
  });

  it("allows it for an account that is genuinely empty", () => {
    expect(canSetOpening("Gcash", rows).ok).toBe(true);
  });

  it("offers only the accounts that still need one", () => {
    const need = accountsNeedingOpening(accounts, rows);
    expect(need.map((a) => a.name)).toEqual(["Cash", "Gcash"]);
  });
});

describe("knowing whether the ledger has been started", () => {
  it("is false on an empty ledger", () => {
    expect(hasOpeningBalances([])).toBe(false);
  });

  it("is true once any account has one", () => {
    expect(hasOpeningBalances(openingRows([{ account: "Maya", amount: 1 }], DATE, 1))).toBe(true);
  });
});

describe("the Excel's revenue workaround", () => {
  it("finds the rows still filed under it", () => {
    const legacy = legacyCarryForwardRows(fixture.transactions);
    // Five carry-forwards on 1 January, plus record #371 which shares the name
    // but is real money from PNB.
    expect(legacy).toHaveLength(6);
  });

  it("stops reporting the carry-forwards once they are reclassified", () => {
    const migrated = applyOpeningMigration(
      fixture.transactions,
      planOpeningMigration(fixture.transactions),
    );
    const left = legacyCarryForwardRows(migrated);
    expect(left).toHaveLength(1);
    expect(left[0]?.recordNumber).toBe(371);
  });

  it("takes PHP 953.89 out of reported income when applied", () => {
    const before = totalsFor(fixture.transactions).revenue;
    const after = totalsFor(
      applyOpeningMigration(fixture.transactions, planOpeningMigration(fixture.transactions)),
    ).revenue;
    expect(before - after).toBe(95389);
  });

  it("leaves every balance exactly where it was", () => {
    const migrated = applyOpeningMigration(
      fixture.transactions,
      planOpeningMigration(fixture.transactions),
    );
    for (const w of ["Maya", "Cash", "Gcash", "Extra Cash", "Maya Bank (Personal savings)"]) {
      expect(walletBalance(migrated, w)).toBe(walletBalance(fixture.transactions, w));
    }
  });
});
