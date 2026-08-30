/**
 * These detectors exist to say things a total would not. So the tests are
 * mostly about restraint: each one must stay quiet on ordinary data, because
 * a panel that fires on everything is the panel that turned into wallpaper
 * nobody read in the old system.
 */

import { describe, expect, it } from "vitest";

import { loadFixture } from "../fixtures/load";
import { walletBalance } from "./balances";
import {
  brokenStreaks,
  categoryMigration,
  incomeVelocity,
  isDiscretionary,
  patternFindings,
  uncategorisedCount,
  zeroBalanceCount,
} from "./patterns";
import type { Transaction } from "./types";

const fixture = loadFixture();

let seq = 0;
const row = (over: Partial<Transaction>): Transaction => {
  seq += 1;
  return {
    id: `p${seq}`,
    recordNumber: seq,
    date: "2026-08-01",
    type: "Spending",
    category: "Food",
    item: "Lunch",
    description: "",
    amount: 10000,
    fee: 0,
    total: 10000,
    fromWallet: "Maya",
    toWallet: "",
    status: "Paid",
    ...over,
  };
};

describe("isDiscretionary", () => {
  it("treats what is owed as not discretionary", () => {
    expect(isDiscretionary("Bills")).toBe(false);
    expect(isDiscretionary("Subscriptions")).toBe(false);
    expect(isDiscretionary("Debt")).toBe(false);
    expect(isDiscretionary("Opening")).toBe(false);
  });

  it("treats anything chosen as discretionary, including names it has never seen", () => {
    expect(isDiscretionary("Treat")).toBe(true);
    expect(isDiscretionary("Travel")).toBe(true);
    // The point of the migration check is that the names move around.
    expect(isDiscretionary("Some Category Invented Tomorrow")).toBe(true);
  });

  it("ignores a blank category rather than counting it", () => {
    expect(isDiscretionary("")).toBe(false);
    expect(isDiscretionary("   ")).toBe(false);
  });
});

describe("incomeVelocity", () => {
  it("measures how much of a deposit went straight back out", () => {
    const events = incomeVelocity(
      [
        row({ date: "2026-08-10", type: "Revenue", amount: 100000, total: 100000, fromWallet: "Maya", category: "Salary" }),
        row({ date: "2026-08-11", total: 60000, amount: 60000 }),
      ],
      "2026-08-15",
    );

    expect(events).toHaveLength(1);
    expect(events[0]?.amount).toBe(100000);
    expect(events[0]?.spentWithin).toBe(60000);
    expect(events[0]?.share).toBeCloseTo(0.6, 5);
  });

  it("ignores spending outside the window, which is the whole point", () => {
    const events = incomeVelocity(
      [
        row({ date: "2026-08-10", type: "Revenue", amount: 100000, total: 100000, category: "Salary" }),
        row({ date: "2026-08-20", total: 60000, amount: 60000 }),
      ],
      "2026-08-25",
    );

    expect(events).toHaveLength(0);
  });

  it("ignores tiny deposits, so an interest posting is not a spike", () => {
    // PHP 0.02 in, PHP 500 out is not a 2,500,000% event. It is two rows.
    const events = incomeVelocity(
      [
        row({ date: "2026-08-10", type: "Revenue", amount: 2, total: 2, category: "Interest" }),
        row({ date: "2026-08-10", total: 50000, amount: 50000 }),
      ],
      "2026-08-12",
    );

    expect(events).toHaveLength(0);
  });

  it("never treats an opening balance as income arriving", () => {
    const events = incomeVelocity(
      [
        row({ date: "2026-08-10", type: "Revenue", category: "Opening", amount: 500000, total: 500000 }),
        row({ date: "2026-08-10", total: 400000, amount: 400000 }),
      ],
      "2026-08-12",
    );

    expect(events).toHaveLength(0);
  });

  it("runs over the real ledger and produces sane shares", () => {
    const events = incomeVelocity(fixture.transactions, fixture.expected.asOf, {
      lookbackDays: 400,
    });

    for (const e of events) {
      expect(e.amount).toBeGreaterThan(0);
      expect(e.spentWithin).toBeGreaterThan(0);
      expect(Number.isFinite(e.share)).toBe(true);
      expect(Number.isInteger(e.amount)).toBe(true);
      expect(Number.isInteger(e.spentWithin)).toBe(true);
    }
  });
});

describe("categoryMigration", () => {
  const twoMonths = [
    // July: heavy on Treat.
    row({ date: "2026-07-05", category: "Treat", total: 200000, amount: 200000 }),
    // August: Treat gone, Travel appears at nearly the same size.
    row({ date: "2026-08-05", category: "Travel", total: 190000, amount: 190000 }),
  ];

  it("catches a category that moved rather than shrank", () => {
    const moved = categoryMigration(twoMonths, "2026-08-30");

    expect(moved?.fell.category).toBe("Treat");
    expect(moved?.fell.by).toBe(200000);
    expect(moved?.rose.category).toBe("Travel");
    expect(moved?.rose.by).toBe(190000);
  });

  it("stays quiet when a fall was not replaced, because that is good news", () => {
    const moved = categoryMigration(
      [
        row({ date: "2026-07-05", category: "Treat", total: 200000, amount: 200000 }),
        row({ date: "2026-08-05", category: "Travel", total: 10000, amount: 10000 }),
      ],
      "2026-08-30",
    );

    expect(moved).toBeNull();
  });

  it("stays quiet on small movements", () => {
    const moved = categoryMigration(
      [
        row({ date: "2026-07-05", category: "Treat", total: 5000, amount: 5000 }),
        row({ date: "2026-08-05", category: "Travel", total: 5000, amount: 5000 }),
      ],
      "2026-08-30",
    );

    expect(moved).toBeNull();
  });

  it("reports the combined direction, not just the pair", () => {
    // The pair cancels out, so the honest headline is that nothing improved.
    const moved = categoryMigration(twoMonths, "2026-08-30");
    expect(moved?.netChange).toBe(-10000);
  });

  it("crosses a year boundary correctly", () => {
    const moved = categoryMigration(
      [
        row({ date: "2025-12-05", category: "Treat", total: 200000, amount: 200000 }),
        row({ date: "2026-01-05", category: "Travel", total: 190000, amount: 190000 }),
      ],
      "2026-01-30",
    );

    expect(moved?.fell.category).toBe("Treat");
  });

  it("ignores bills, which are not a choice", () => {
    const moved = categoryMigration(
      [
        row({ date: "2026-07-05", category: "Bills", total: 200000, amount: 200000 }),
        row({ date: "2026-08-05", category: "Bills", total: 10000, amount: 10000 }),
      ],
      "2026-08-30",
    );

    expect(moved).toBeNull();
  });
});

describe("zeroBalanceCount", () => {
  it("counts a wallet emptying, using the same balance rule as the app", () => {
    const rows = [
      row({ date: "2026-08-01", type: "Revenue", fromWallet: "Cash", amount: 50000, total: 50000, category: "Salary" }),
      row({ date: "2026-08-02", fromWallet: "Cash", amount: 50000, total: 50000 }),
      row({ date: "2026-08-03", type: "Revenue", fromWallet: "Cash", amount: 50000, total: 50000, category: "Salary" }),
      row({ date: "2026-08-04", fromWallet: "Cash", amount: 50000, total: 50000 }),
    ];

    expect(zeroBalanceCount(rows, "Cash", "2026-08-30")).toBe(2);
    // The running total must agree with the canonical balance at the end.
    expect(walletBalance(rows, "Cash")).toBe(0);
  });

  it("does not count a wallet that merely stays low", () => {
    const rows = [
      row({ date: "2026-08-01", type: "Revenue", fromWallet: "Cash", amount: 50000, total: 50000, category: "Salary" }),
      row({ date: "2026-08-02", fromWallet: "Cash", amount: 100, total: 100 }),
    ];

    expect(zeroBalanceCount(rows, "Cash", "2026-08-30")).toBe(0);
  });

  it("only counts inside the window", () => {
    const rows = [
      row({ date: "2026-01-01", type: "Revenue", fromWallet: "Cash", amount: 50000, total: 50000, category: "Salary" }),
      row({ date: "2026-01-02", fromWallet: "Cash", amount: 50000, total: 50000 }),
    ];

    expect(zeroBalanceCount(rows, "Cash", "2026-08-30")).toBe(0);
  });
});

describe("brokenStreaks", () => {
  it("names a long gap that has just ended", () => {
    const streaks = brokenStreaks(
      [
        row({ date: "2026-06-01", category: "Treat" }),
        row({ date: "2026-08-25", category: "Treat", total: 30000, amount: 30000 }),
      ],
      "2026-08-27",
    );

    expect(streaks[0]?.category).toBe("Treat");
    expect(streaks[0]?.days).toBe(85);
    expect(streaks[0]?.amount).toBe(30000);
  });

  it("says nothing about a streak that broke long ago", () => {
    const streaks = brokenStreaks(
      [
        row({ date: "2026-01-01", category: "Treat" }),
        row({ date: "2026-03-01", category: "Treat" }),
      ],
      "2026-08-27",
    );

    expect(streaks).toHaveLength(0);
  });

  it("says nothing about an ordinary few days between entries", () => {
    const streaks = brokenStreaks(
      [
        row({ date: "2026-08-20", category: "Treat" }),
        row({ date: "2026-08-25", category: "Treat" }),
      ],
      "2026-08-27",
    );

    expect(streaks).toHaveLength(0);
  });
});

describe("uncategorisedCount", () => {
  it("counts blank and unknown categories in the window", () => {
    const rows = [
      row({ date: "2026-08-28", category: "" }),
      row({ date: "2026-08-27", category: "Unknown" }),
      row({ date: "2026-08-26", category: "Food" }),
      row({ date: "2026-01-01", category: "" }),
    ];

    expect(uncategorisedCount(rows, "2026-08-30")).toBe(2);
  });
});

describe("patternFindings", () => {
  it("says nothing at all about an ordinary month", () => {
    const quiet = [
      row({ date: "2026-08-01", category: "Food", total: 20000, amount: 20000 }),
      row({ date: "2026-08-10", category: "Food", total: 22000, amount: 22000 }),
    ];

    expect(patternFindings({ transactions: quiet, asOf: "2026-08-30", wallets: ["Maya"] })).toEqual(
      [],
    );
  });

  it("leads with velocity, the strongest signal", () => {
    const findings = patternFindings({
      transactions: [
        row({ date: "2026-08-10", type: "Revenue", amount: 500000, total: 500000, category: "Salary" }),
        row({ date: "2026-08-11", total: 400000, amount: 400000, category: "Treat" }),
      ],
      asOf: "2026-08-15",
      wallets: ["Maya"],
    });

    expect(findings[0]?.kind).toBe("velocity");
    expect(findings[0]?.detail).toContain("80%");
    expect(findings[0]?.detail).toContain("PHP 4,000.00");
  });

  it("quantifies and never judges", () => {
    const findings = patternFindings({
      transactions: [
        row({ date: "2026-08-10", type: "Revenue", amount: 500000, total: 500000, category: "Salary" }),
        row({ date: "2026-08-11", total: 400000, amount: 400000, category: "Treat" }),
      ],
      asOf: "2026-08-15",
      wallets: ["Maya"],
    });

    const scolding = /should|careful|too much|bad habit|try to|avoid|discipline|well done|great job/i;
    for (const f of findings) {
      expect(f.detail).not.toMatch(scolding);
      // Every finding carries a figure. That is the whole intervention.
      expect(f.detail).toMatch(/PHP |\d/);
    }
  });

  it("stays quiet on the real ledger unless something genuinely stands out", () => {
    const findings = patternFindings({
      transactions: fixture.transactions,
      asOf: fixture.expected.asOf,
      wallets: fixture.reference.wallets,
    });

    // Restraint is the requirement: a wall of findings is the failure mode.
    expect(findings.length).toBeLessThanOrEqual(6);

    for (const f of findings) {
      expect(f.detail.length).toBeGreaterThan(20);
      expect(f.detail).not.toContain("NaN");
      expect(f.detail).not.toContain("undefined");
      expect(f.detail).not.toContain("Infinity");
    }
  });

  it("is deterministic, so the same ledger says the same thing twice", () => {
    const input = {
      transactions: fixture.transactions,
      asOf: fixture.expected.asOf,
      wallets: fixture.reference.wallets,
    };

    expect(patternFindings(input)).toEqual(patternFindings(input));
  });
});
