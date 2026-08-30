/**
 * Years, against the real ledger.
 *
 * The load-bearing test is `balances must not move`. Everything else in this
 * module is reporting; that one is the guarantee that reclassifying an opening
 * balance cannot cost the owner money.
 */

import { describe, expect, it } from "vitest";

import { loadFixture } from "../fixtures/load";
import { walletBalance } from "./balances";
import { totalsFor } from "./totals";
import {
  applyOpeningMigration,
  findCarryForward,
  openingMigrationDone,
  openingRowsFor,
  planOpeningMigration,
  planYearClose,
  yearPositions,
  yearsCovered,
} from "./year";

const fixture = loadFixture();
const transactions = fixture.transactions;
const ACCOUNTS = [
  "Gcash",
  "Maya",
  "Cash",
  "Extra Cash",
  "Maya Bank (Personal savings)",
  "Reserved Fund",
  "Allowance (Reserve)",
  "Tuition (Reserve)",
];

describe("finding the Excel's carry-forward rows", () => {
  const found = findCarryForward(transactions);

  it("finds the five written on 1 January 2026", () => {
    expect(found.map((f) => f.transaction.recordNumber)).toEqual([1, 2, 3, 4, 5]);
  });

  it("knows which year they came from", () => {
    expect(found.every((f) => f.fromYear === 2025)).toBe(true);
  });

  it("does NOT match record #371, which shares the item name", () => {
    // "Transfer of balance" on 30 June, PHP 1,522.00 arriving from PNB. Real
    // income. Matching on the item name alone would have taken it.
    expect(found.map((f) => f.transaction.recordNumber)).not.toContain(371);
    const r371 = transactions.find((t) => t.recordNumber === 371);
    expect(r371?.item).toBe("Transfer of balance");
    expect(r371?.total).toBe(152200);
  });

  it("values the whole carry-forward at PHP 953.89", () => {
    expect(planOpeningMigration(transactions).overstatedIncome).toBe(95389);
  });
});

describe("MIGRATION SAFETY: balances must not move", () => {
  const plan = planOpeningMigration(transactions);
  const after = applyOpeningMigration(transactions, plan);

  it("leaves every account's balance byte-identical", () => {
    for (const account of ACCOUNTS) {
      expect(walletBalance(after, account)).toBe(walletBalance(transactions, account));
    }
  });

  it("leaves the pinned wallet figures exactly where they were", () => {
    expect(walletBalance(after, "Maya")).toBe(579574);
    expect(walletBalance(after, "Cash")).toBe(16100);
    expect(walletBalance(after, "Gcash")).toBe(15571);
    expect(walletBalance(after, "Maya Bank (Personal savings)")).toBe(152758);
  });

  it("changes nothing but the category", () => {
    for (const [i, t] of after.entries()) {
      const before = transactions[i]!;
      expect({ ...t, category: before.category }).toEqual(before);
    }
  });

  it("touches exactly five rows", () => {
    const changed = after.filter((t, i) => t.category !== transactions[i]!.category);
    expect(changed).toHaveLength(5);
  });
});

describe("what the reclassification is worth", () => {
  const after = applyOpeningMigration(transactions, planOpeningMigration(transactions));

  it("takes PHP 953.89 of opening balance out of reported income", () => {
    const before = totalsFor(transactions).revenue;
    const now = totalsFor(after.filter((t) => t.category !== "Opening")).revenue;
    expect(before - now).toBe(95389);
  });

  it("leaves spending untouched, because none of these were spending", () => {
    expect(totalsFor(after).total).toBe(totalsFor(transactions).total);
  });
});

describe("it is safe to run twice", () => {
  it("reports done once applied", () => {
    expect(openingMigrationDone(transactions)).toBe(false);
    const after = applyOpeningMigration(transactions, planOpeningMigration(transactions));
    expect(openingMigrationDone(after)).toBe(true);
  });

  it("is a no-op the second time", () => {
    const once = applyOpeningMigration(transactions, planOpeningMigration(transactions));
    const twice = applyOpeningMigration(once, planOpeningMigration(once));
    expect(twice).toEqual(once);
  });
});

describe("year positions", () => {
  it("knows which years the ledger covers", () => {
    expect(yearsCovered(transactions)).toEqual([2026]);
  });

  it("opens 2026 at zero, because 2025 is not in the ledger", () => {
    // The carry-forward rows are dated inside 2026, so the ledger genuinely
    // starts empty. This is exactly why the Excel needed those rows.
    const positions = yearPositions(transactions, 2026, ACCOUNTS);
    expect(positions.every((p) => p.opening === 0)).toBe(true);
  });

  it("closes 2026 at the current balances", () => {
    const positions = yearPositions(transactions, 2026, ACCOUNTS);
    const maya = positions.find((p) => p.account === "Maya");
    expect(maya?.closing).toBe(579574);
    expect(maya?.movement).toBe(579574);
  });

  it("carries a closing balance into the next year's opening", () => {
    const closing2026 = yearPositions(transactions, 2026, ACCOUNTS);
    const opening2027 = yearPositions(transactions, 2027, ACCOUNTS);
    for (const account of ACCOUNTS) {
      const closed = closing2026.find((p) => p.account === account)?.closing;
      const opened = opening2027.find((p) => p.account === account)?.opening;
      expect(opened).toBe(closed);
    }
  });
});

describe("closing a year, for archiving", () => {
  const plan = planYearClose(transactions, 2026, ACCOUNTS);

  it("writes one row per account that is not empty", () => {
    expect(plan.rows.every((r) => r.balance !== 0)).toBe(true);
    expect(plan.opensOn).toBe("2027-01-01");
  });

  it("carries the whole position, not part of it", () => {
    const held = ACCOUNTS.reduce((a, w) => a + walletBalance(transactions, w), 0);
    expect(plan.total).toBe(held);
  });

  it("produces opening rows that reproduce the balances exactly", () => {
    const rows = openingRowsFor(plan, 1);
    for (const account of ACCOUNTS) {
      expect(walletBalance(rows, account)).toBe(walletBalance(transactions, account));
    }
  });

  it("marks them Opening so a fresh year does not start with fake income", () => {
    const rows = openingRowsFor(plan, 1);
    expect(rows.every((r) => r.category === "Opening")).toBe(true);
    expect(totalsFor(rows.filter((r) => r.category !== "Opening")).revenue).toBe(0);
  });

  it("numbers them from where it is told, without reusing numbers", () => {
    const rows = openingRowsFor(plan, 500);
    expect(rows.map((r) => r.recordNumber)).toEqual(rows.map((_, i) => 500 + i));
  });
});
