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
  ledgerStart,
  suspectOpenings,
  misdatedOpenings,
  OPENING_ITEM,
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

describe("misdatedOpenings", () => {
  const row = (over: Partial<Transaction>): Transaction => ({
    id: "m1",
    recordNumber: 1,
    date: "2026-01-01",
    type: "Revenue",
    category: "Revenue",
    item: "Salary",
    description: "",
    amount: 10000,
    fee: 0,
    total: 10000,
    fromWallet: "Maya",
    toWallet: "",
    status: "Done",
    ...over,
  });

  const opening = (over: Partial<Transaction> = {}): Transaction =>
    row({
      id: "open-1",
      category: OPENING_CATEGORY as Transaction["category"],
      item: OPENING_ITEM,
      fromWallet: "",
      toWallet: "Reserved Fund",
      amount: 500000,
      total: 500000,
      ...over,
    });

  it("pulls a starting balance filed before the ledger onto its first day", () => {
    // The exact shape of the bug: PHP 5,000.00 dated 31 December 2025 on a
    // ledger that begins 1 January 2026.
    const fixed = misdatedOpenings([
      row({ date: "2026-01-01" }),
      opening({ date: "2025-12-31" }),
    ]);

    expect(fixed).toHaveLength(1);
    expect(fixed[0]?.date).toBe("2026-01-01");
    // Nothing else moves.
    expect(fixed[0]?.amount).toBe(500000);
    expect(fixed[0]?.toWallet).toBe("Reserved Fund");
    expect(fixed[0]?.id).toBe("open-1");
  });

  it("leaves a starting balance already inside the ledger alone", () => {
    expect(
      misdatedOpenings([row({ date: "2026-01-01" }), opening({ date: "2026-01-01" })]),
    ).toEqual([]);
  });

  it("leaves one dated later alone, since that is a deliberate choice", () => {
    expect(
      misdatedOpenings([row({ date: "2026-01-01" }), opening({ date: "2026-03-01" })]),
    ).toEqual([]);
  });

  it("does nothing on a ledger of nothing but starting balances", () => {
    // A first run. Whatever date they carry is the one that was chosen.
    expect(misdatedOpenings([opening({ date: "2020-01-01" })])).toEqual([]);
  });

  it("never touches an ordinary row, however old", () => {
    const fixed = misdatedOpenings([
      row({ id: "old", date: "2020-01-01" }),
      row({ date: "2026-01-01" }),
    ]);
    expect(fixed).toEqual([]);
  });

  it("is idempotent: running it on its own output finds nothing", () => {
    const before = [row({ date: "2026-01-01" }), opening({ date: "2025-12-31" })];
    const fixed = misdatedOpenings(before);
    const after = before.map((t) => fixed.find((f) => f.id === t.id) ?? t);

    expect(misdatedOpenings(after)).toEqual([]);
  });

  it("changes no balance, which is the invariant that matters", () => {
    const before = [row({ date: "2026-01-01" }), opening({ date: "2025-12-31" })];
    const fixed = misdatedOpenings(before);
    const after = before.map((t) => fixed.find((f) => f.id === t.id) ?? t);

    expect(walletBalance(after, "Reserved Fund")).toBe(
      walletBalance(before, "Reserved Fund"),
    );
  });
});

describe("ledgerStart and misdatedOpenings agree", () => {
  const row = (over: Partial<Transaction>): Transaction => ({
    id: "a1",
    recordNumber: 1,
    date: "2026-01-04",
    type: "Revenue",
    category: "Revenue",
    item: "Salary",
    description: "",
    amount: 10000,
    fee: 0,
    total: 10000,
    fromWallet: "Maya",
    toWallet: "",
    status: "Done",
    ...over,
  });

  const open = (over: Partial<Transaction>): Transaction =>
    row({
      category: OPENING_CATEGORY as Transaction["category"],
      item: OPENING_ITEM,
      fromWallet: "",
      toWallet: "Reserved Fund",
      ...over,
    });

  /**
   * The bug this pins. One caller asked where the ledger starts counting
   * opening rows and got 1 January; the other asked ignoring them and got the
   * 4th. A balance written on the 1st was then immediately moved to the 4th.
   */
  it("places a new balance where the repair will leave it", () => {
    const ledger = [
      open({ id: "carry-1", date: "2026-01-01", toWallet: "Maya" }),
      row({ id: "first", date: "2026-01-04" }),
    ];

    const placedOn = ledgerStart(ledger) ?? "";
    expect(placedOn).toBe("2026-01-01");

    const added = [...ledger, open({ id: "new", date: placedOn })];
    // The repair must have nothing to say about a row it just agreed with.
    expect(misdatedOpenings(added)).toEqual([]);
  });

  it("still pulls back one filed before everything else", () => {
    const fixed = misdatedOpenings([
      open({ id: "carry-1", date: "2026-01-01", toWallet: "Maya" }),
      row({ id: "first", date: "2026-01-04" }),
      open({ id: "stray", date: "2025-12-31" }),
    ]);

    expect(fixed).toHaveLength(1);
    expect(fixed[0]?.id).toBe("stray");
    expect(fixed[0]?.date).toBe("2026-01-01");
  });

  it("leaves the oldest opening row alone, since it is where the record begins", () => {
    const ledger = [
      open({ id: "oldest", date: "2026-01-01" }),
      row({ id: "first", date: "2026-01-04" }),
    ];
    expect(misdatedOpenings(ledger)).toEqual([]);
  });

  it("ignores the row being placed when asked to", () => {
    const ledger = [open({ id: "stray", date: "2020-01-01" }), row({ id: "first" })];
    expect(ledgerStart(ledger, "stray")).toBe("2026-01-04");
  });
});

describe("a starting balance is only for setting up", () => {
  const row = (over: Partial<Transaction>): Transaction => ({
    id: "s1",
    recordNumber: 1,
    date: "2026-01-01",
    type: "Revenue",
    category: "Revenue",
    item: "Salary",
    description: "",
    amount: 10000,
    fee: 0,
    total: 10000,
    fromWallet: "Maya",
    toWallet: "",
    status: "Done",
    ...over,
  });

  const open = (over: Partial<Transaction>): Transaction =>
    row({
      category: OPENING_CATEGORY as Transaction["category"],
      item: OPENING_ITEM,
      fromWallet: "",
      toWallet: "Reserved Fund",
      ...over,
    });

  it("is offered on an empty ledger, which is the only honest moment", () => {
    expect(canSetOpening("Reserved Fund", []).ok).toBe(true);
  });

  it("is refused once anything at all has been recorded", () => {
    /**
     * The exact failure. Reserved Fund sat at zero in August, so the old rule
     * offered a starting balance, and the row was dated back to January. The
     * ledger then claimed the money had been there all year. It arrived in
     * August.
     */
    const check = canSetOpening("Reserved Fund", [row({ date: "2026-08-30" })]);

    expect(check.ok).toBe(false);
    expect(check.reason).toContain("Transfer");
    expect(check.reason).toContain("Revenue");
  });

  it("is still refused when the account itself has no history", () => {
    // The account is empty; the ledger is not. That is the case that lied.
    const ledger = [row({ toWallet: "Maya", date: "2026-08-30" })];
    expect(canSetOpening("Reserved Fund", ledger).ok).toBe(false);
  });

  it("is refused on an account that already has money, as before", () => {
    const ledger = [open({ id: "o", amount: 50000, total: 50000 })];
    expect(canSetOpening("Reserved Fund", ledger).ok).toBe(false);
  });

  it("does not count other starting balances as history", () => {
    // Setting up several accounts in one sitting has to keep working.
    const ledger = [open({ id: "o1", toWallet: "Maya", amount: 100, total: 100 })];
    expect(canSetOpening("Reserved Fund", ledger).ok).toBe(true);
  });
});

describe("suspectOpenings", () => {
  const row = (over: Partial<Transaction>): Transaction => ({
    id: "x1",
    recordNumber: 1,
    date: "2026-01-01",
    type: "Revenue",
    category: "Revenue",
    item: "Salary",
    description: "",
    amount: 10000,
    fee: 0,
    total: 10000,
    fromWallet: "Maya",
    toWallet: "",
    status: "Done",
    ...over,
  });

  const open = (over: Partial<Transaction>): Transaction =>
    row({
      category: OPENING_CATEGORY as Transaction["category"],
      item: OPENING_ITEM,
      fromWallet: "",
      toWallet: "Reserved Fund",
      ...over,
    });

  it("flags one written after the ledger was already running", () => {
    // Record 442, dated 1 January, on a ledger whose record 1 is also
    // 1 January. The money cannot have been there before the record began.
    const found = suspectOpenings([
      row({ id: "first", recordNumber: 1, date: "2026-01-01" }),
      open({ id: "late", recordNumber: 442, date: "2026-01-01", amount: 500000, total: 500000 }),
    ]);

    expect(found).toHaveLength(1);
    expect(found[0]?.id).toBe("late");
  });

  it("leaves a genuine setup row alone", () => {
    const found = suspectOpenings([
      open({ id: "setup", recordNumber: 1, date: "2026-01-01" }),
      row({ id: "later", recordNumber: 2, date: "2026-01-04" }),
    ]);

    expect(found).toEqual([]);
  });

  it("says nothing about a ledger with no starting balances", () => {
    expect(suspectOpenings([row({ id: "a" }), row({ id: "b", recordNumber: 2 })])).toEqual([]);
  });

  it("never rewrites anything, only reports", () => {
    const ledger = [
      row({ id: "first", recordNumber: 1 }),
      open({ id: "late", recordNumber: 9, amount: 500000, total: 500000 }),
    ];
    const before = JSON.stringify(ledger);
    suspectOpenings(ledger);
    expect(JSON.stringify(ledger)).toBe(before);
  });
});
