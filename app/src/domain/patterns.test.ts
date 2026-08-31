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
    category: "Spending",
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
        row({ date: "2026-08-10", type: "Revenue", amount: 100000, total: 100000, fromWallet: "Maya", category: "Revenue", item: "Salary" }),
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
        row({ date: "2026-08-10", type: "Revenue", amount: 100000, total: 100000, category: "Revenue", item: "Salary" }),
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
        row({ date: "2026-08-10", type: "Revenue", amount: 2, total: 2, category: "Revenue", item: "Interest" }),
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

  it("counts every deposit in the window, not just one of them", () => {
    // Two deposits land a day apart. Dividing the window's whole outflow by
    // one of them is what produced "200% of the PHP 997.34 that arrived".
    const events = incomeVelocity(
      [
        row({ date: "2026-08-10", type: "Revenue", amount: 100000, total: 100000, category: "Revenue", item: "Salary" }),
        row({ date: "2026-08-11", type: "Revenue", amount: 100000, total: 100000, category: "Revenue", item: "Salary" }),
        row({ date: "2026-08-11", total: 150000, amount: 150000 }),
      ],
      "2026-08-15",
    );

    expect(events[0]?.amount).toBe(200000);
    expect(events[0]?.share).toBeCloseTo(0.75, 5);
  });

  it("reports one finding per window, not one per deposit", () => {
    const events = incomeVelocity(
      [
        row({ date: "2026-08-10", type: "Revenue", amount: 100000, total: 100000, category: "Revenue", item: "Salary" }),
        row({ date: "2026-08-11", type: "Revenue", amount: 100000, total: 100000, category: "Revenue", item: "Salary" }),
        row({ date: "2026-08-11", total: 150000, amount: 150000 }),
      ],
      "2026-08-15",
    );

    expect(events).toHaveLength(1);
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
    row({ date: "2026-07-05", item: "Treat", total: 200000, amount: 200000 }),
    // August: Treat gone, Travel appears at nearly the same size.
    row({ date: "2026-08-05", item: "Travel", total: 190000, amount: 190000 }),
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
        row({ date: "2026-07-05", item: "Treat", total: 200000, amount: 200000 }),
        row({ date: "2026-08-05", item: "Travel", total: 10000, amount: 10000 }),
      ],
      "2026-08-30",
    );

    expect(moved).toBeNull();
  });

  it("stays quiet on small movements", () => {
    const moved = categoryMigration(
      [
        row({ date: "2026-07-05", item: "Treat", total: 5000, amount: 5000 }),
        row({ date: "2026-08-05", item: "Travel", total: 5000, amount: 5000 }),
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
        row({ date: "2025-12-05", item: "Treat", total: 200000, amount: 200000 }),
        row({ date: "2026-01-05", item: "Travel", total: 190000, amount: 190000 }),
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
      row({ date: "2026-08-01", type: "Revenue", fromWallet: "Cash", amount: 50000, total: 50000, category: "Revenue", item: "Salary" }),
      row({ date: "2026-08-02", fromWallet: "Cash", amount: 50000, total: 50000 }),
      row({ date: "2026-08-03", type: "Revenue", fromWallet: "Cash", amount: 50000, total: 50000, category: "Revenue", item: "Salary" }),
      row({ date: "2026-08-04", fromWallet: "Cash", amount: 50000, total: 50000 }),
    ];

    expect(zeroBalanceCount(rows, "Cash", "2026-08-30")).toBe(2);
    // The running total must agree with the canonical balance at the end.
    expect(walletBalance(rows, "Cash")).toBe(0);
  });

  it("does not count a wallet that merely stays low", () => {
    const rows = [
      row({ date: "2026-08-01", type: "Revenue", fromWallet: "Cash", amount: 50000, total: 50000, category: "Revenue", item: "Salary" }),
      row({ date: "2026-08-02", fromWallet: "Cash", amount: 100, total: 100 }),
    ];

    expect(zeroBalanceCount(rows, "Cash", "2026-08-30")).toBe(0);
  });

  it("only counts inside the window", () => {
    const rows = [
      row({ date: "2026-01-01", type: "Revenue", fromWallet: "Cash", amount: 50000, total: 50000, category: "Revenue", item: "Salary" }),
      row({ date: "2026-01-02", fromWallet: "Cash", amount: 50000, total: 50000 }),
    ];

    expect(zeroBalanceCount(rows, "Cash", "2026-08-30")).toBe(0);
  });
});

describe("brokenStreaks", () => {
  it("names a long gap that has just ended", () => {
    const streaks = brokenStreaks(
      [
        row({ date: "2026-06-01", item: "Treat" }),
        row({ date: "2026-08-25", item: "Treat", total: 30000, amount: 30000 }),
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
        row({ date: "2026-01-01", item: "Treat" }),
        row({ date: "2026-03-01", item: "Treat" }),
      ],
      "2026-08-27",
    );

    expect(streaks).toHaveLength(0);
  });

  it("says nothing about an ordinary few days between entries", () => {
    const streaks = brokenStreaks(
      [
        row({ date: "2026-08-20", item: "Treat" }),
        row({ date: "2026-08-25", item: "Treat" }),
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
      row({ date: "2026-08-26", item: "Food" }),
      row({ date: "2026-01-01", category: "" }),
    ];

    expect(uncategorisedCount(rows, "2026-08-30")).toBe(2);
  });
});

describe("patternFindings", () => {
  it("says nothing at all about an ordinary month", () => {
    const quiet = [
      row({ date: "2026-08-01", item: "Food", total: 20000, amount: 20000 }),
      row({ date: "2026-08-10", item: "Food", total: 22000, amount: 22000 }),
    ];

    expect(patternFindings({ transactions: quiet, asOf: "2026-08-30", wallets: ["Maya"] })).toEqual(
      [],
    );
  });

  it("leads with velocity, the strongest signal", () => {
    const findings = patternFindings({
      transactions: [
        row({ date: "2026-08-10", type: "Revenue", amount: 500000, total: 500000, category: "Revenue", item: "Salary" }),
        row({ date: "2026-08-11", total: 400000, amount: 400000, item: "Treat" }),
      ],
      asOf: "2026-08-15",
      wallets: ["Maya"],
    });

    expect(findings[0]?.kind).toBe("velocity");
    expect(findings[0]?.detail).toContain("80%");
    expect(findings[0]?.detail).toContain("PHP 4,000.00");
  });

  it("never claims more than all of a deposit left it", () => {
    // This shipped: "200% of the PHP 997.34 that arrived went back out".
    // Money cannot leave a deposit twice, and a reader who spots one
    // impossible figure has no reason to believe the rest of the panel.
    const findings = patternFindings({
      transactions: [
        row({ date: "2026-08-10", type: "Revenue", amount: 99734, total: 99734, category: "Revenue", item: "Salary" }),
        row({ date: "2026-08-11", total: 199100, amount: 199100, item: "Treat" }),
      ],
      asOf: "2026-08-15",
      wallets: ["Maya"],
    });

    const velocity = findings.find((f) => f.kind === "velocity");
    expect(velocity).toBeDefined();
    expect(velocity!.detail).not.toMatch(/\b(1\d\d|[2-9]\d\d)%/);
    // It says the true and more useful thing instead.
    expect(velocity!.detail).toContain("more than arrived");
    expect(velocity!.detail).toContain("PHP 1,991.00");
  });

  it("never prints a percentage above one hundred, on any ledger", () => {
    const findings = patternFindings({
      transactions: fixture.transactions,
      asOf: fixture.expected.asOf,
      wallets: fixture.reference.wallets,
    });

    for (const f of findings) {
      const percentages = [...f.detail.matchAll(/(\d+)%/g)].map((m) => Number(m[1]));
      for (const p of percentages) expect(p).toBeLessThanOrEqual(100);
    }
  });

  it("quantifies and never judges", () => {
    const findings = patternFindings({
      transactions: [
        row({ date: "2026-08-10", type: "Revenue", amount: 500000, total: 500000, category: "Revenue", item: "Salary" }),
        row({ date: "2026-08-11", total: 400000, amount: 400000, item: "Treat" }),
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

describe("the field the detectors group by", () => {
  /**
   * ── What this file used to describe ─────────────────────────────────────
   *
   * Every detector grouped by `t.category`. In this ledger that field holds
   * the structure, not the subject: it is only ever Spending, Bills,
   * Subscriptions, Transfer, Revenue or Opening, and `isDiscretionary`
   * throws out all but two of those.
   *
   * So on real data the migration detector compared one group against
   * itself and could never fire, and a streak reported "40 days without a
   * Spending entry", which says nothing at all.
   *
   * The tests hid it by putting item names in the category field, so they
   * described a shape the real ledger has never had. These use the real
   * shape: `category` is Spending, `item` is what the owner calls it.
   */
  const real = (over: Partial<Transaction>): Transaction =>
    row({ category: "Spending", ...over });

  it("groups a streak by what the owner calls it, not by Spending", () => {
    const rows = [
      real({ date: "2026-06-01", item: "Treat", amount: 30000, total: 30000 }),
      real({ date: "2026-08-25", item: "Treat", amount: 30000, total: 30000 }),
      real({ date: "2026-06-02", item: "Gas", amount: 30000, total: 30000 }),
      real({ date: "2026-08-26", item: "Gas", amount: 30000, total: 30000 }),
    ];
    const names = brokenStreaks(rows, "2026-08-29").map((s) => s.category);
    expect(names).toContain("Treat");
    expect(names).toContain("Gas");
    expect(names).not.toContain("Spending");
  });

  it("sees a migration between two of the owner's own categories", () => {
    const rows = [
      real({ date: "2026-07-05", item: "Treat", amount: 200000, total: 200000 }),
      real({ date: "2026-08-05", item: "Travel", amount: 190000, total: 190000 }),
    ];
    const moved = categoryMigration(rows, "2026-08-29");
    expect(moved?.fell.category).toBe("Treat");
    expect(moved?.rose.category).toBe("Travel");
  });

  /**
   * `category` still decides eligibility, because that is what it is for:
   * telling Bills and Subscriptions apart from discretionary spending. It
   * just cannot be the label.
   */
  it("still excludes bills and subscriptions from a migration", () => {
    const rows = [
      row({ date: "2026-07-05", category: "Bills", item: "Globe at Home Wifi", amount: 200000, total: 200000 }),
      row({ date: "2026-08-05", category: "Bills", item: "Dito Prepaid", amount: 10000, total: 10000 }),
    ];
    expect(categoryMigration(rows, "2026-08-29")).toBeNull();
  });

  /** A row with no item at all falls back to its category rather than vanishing. */
  it("falls back to the category when there is no item", () => {
    const rows = [
      real({ date: "2026-08-25", item: "", amount: 30000, total: 30000 }),
      real({ date: "2026-06-01", item: "", amount: 30000, total: 30000 }),
    ];
    expect(brokenStreaks(rows, "2026-08-29").map((s) => s.category)).toContain("Spending");
  });
});
