/**
 * The offline answer has one job that matters: never state a wrong figure.
 *
 * A model that hedges is annoying. A summary that says the wrong peso amount
 * is worse than no summary, because it will be believed. So these tests are
 * mostly about figures being copied exactly and sentences being dropped rather
 * than guessed when a figure is missing.
 */

import { describe, expect, it } from "vitest";

import { loadFixture } from "../fixtures/load";
import { migrateAccounts } from "./accounts";
import { buildContext, type AiContext } from "./aiContext";
import { offlineAnswer } from "./aiOffline";

const fixture = loadFixture();

const context = buildContext({
  transactions: fixture.transactions,
  accounts: migrateAccounts(
    fixture.reference.wallets,
    fixture.reference.savings,
    fixture.transactions,
  ),
  budgets: fixture.budgets,
  credits: [],
  reference: fixture.reference,
  lowBalanceThreshold: 50000,
  asOf: fixture.expected.asOf,
});

const withMonth = (over: Partial<AiContext["month"]>): AiContext => ({
  ...context,
  month: { ...context.month, ...over },
});

describe("offlineAnswer, summary", () => {
  it("states the real month spend exactly", () => {
    // PHP 11,291.37 is the pinned August figure. If this drifts, either the
    // formatter or the context did, and both are worth catching here.
    expect(offlineAnswer(context, "summary")).toContain("PHP 11,291.37");
  });

  it("never invents a budget sentence when no budget is set", () => {
    const text = offlineAnswer(withMonth({ budget: null, remaining: null }), "summary");
    expect(text).not.toContain("budget");
  });

  it("says over, not negative remaining, when the budget is blown", () => {
    const text = offlineAnswer(
      withMonth({ budget: 1000, remaining: -250, allowancePerDay: null }),
      "summary",
    );

    expect(text).toContain("PHP 250.00 over");
    expect(text).not.toContain("-250");
    expect(text).not.toContain("PHP -");
  });

  it("gives a daily allowance only when days are actually left", () => {
    const left = offlineAnswer(
      withMonth({ budget: 3000, remaining: 900, allowancePerDay: 100, daysLeft: 9 }),
      "summary",
    );
    expect(left).toContain("PHP 100.00 a day");

    const done = offlineAnswer(
      withMonth({ budget: 3000, remaining: 900, allowancePerDay: 100, daysLeft: 0 }),
      "summary",
    );
    expect(done).not.toContain("a day");
  });

  it("reports net worth, and mentions debt only when something is owed", () => {
    const none = offlineAnswer({ ...context, debts: [] }, "summary");
    expect(none).toContain("Net worth is");
    expect(none).not.toContain("owed");

    const owing = offlineAnswer(
      {
        ...context,
        debts: [{ name: "Maya Credit", kind: "payable", outstanding: 2950, daysToDue: 5 }],
      },
      "summary",
    );
    expect(owing).toContain("PHP 2,950.00 still owed");
  });

  it("uses singular and plural correctly for overdue bills", () => {
    const one = offlineAnswer(
      { ...context, bills: { overdue: ["Rent"], dueSoon: [] } },
      "summary",
    );
    expect(one).toContain("1 bill is overdue");

    const two = offlineAnswer(
      { ...context, bills: { overdue: ["Rent", "Water"], dueSoon: [] } },
      "summary",
    );
    expect(two).toContain("2 bills are overdue");
  });
});

describe("offlineAnswer, alerts", () => {
  it("says so plainly when nothing is flagged", () => {
    const text = offlineAnswer({ ...context, alerts: [] }, "alerts");
    expect(text).toContain("Nothing is flagged");
  });

  it("leads with the most serious item, not the first one", () => {
    const text = offlineAnswer(
      {
        ...context,
        alerts: [
          { level: "info", title: "Info item", detail: "d" },
          { level: "over", title: "Over budget", detail: "d" },
          { level: "warn", title: "Warn item", detail: "d" },
        ],
      },
      "alerts",
    );

    expect(text.indexOf("Over budget")).toBeLessThan(text.indexOf("Warn item"));
    expect(text.indexOf("Warn item")).toBeLessThan(text.indexOf("Info item"));
  });

  it("counts the overflow rather than listing everything", () => {
    const many = Array.from({ length: 6 }, (_, i) => ({
      level: "warn",
      title: `Item ${i}`,
      detail: "d",
    }));
    expect(offlineAnswer({ ...context, alerts: many }, "alerts")).toContain("3 other items flagged");
  });

  it("repeats each detail verbatim, since the figures are already correct", () => {
    const detail = "Gcash is at PHP 155.71, under the PHP 500.00 you asked to be warned at.";
    const text = offlineAnswer(
      { ...context, alerts: [{ level: "warn", title: "Low balance", detail }] },
      "alerts",
    );
    expect(text).toContain(detail);
  });
});

describe("offlineAnswer, patterns", () => {
  it("names the top category with its share of the month", () => {
    const text = offlineAnswer(context, "patterns");
    expect(text).toMatch(/is the largest category at PHP [\d,]+\.\d\d, \d+% of the month/);
  });

  it("calls a real change a change, and a small one close", () => {
    const base = { ...context, month: { ...context.month, spent: 1000 } };

    const up = offlineAnswer(
      { ...base, comparison: [{ month: "July", spent: 500 }] },
      "patterns",
    );
    expect(up).toContain("100% higher than July");

    const same = offlineAnswer(
      { ...base, comparison: [{ month: "July", spent: 1020 }] },
      "patterns",
    );
    expect(same).toContain("close to July");
    expect(same).not.toContain("lower");
  });

  it("admits it cannot tell rather than inventing a trend", () => {
    const text = offlineAnswer(
      { ...context, topSpending: [], comparison: [] },
      "patterns",
    );
    expect(text).toContain("not enough history");
  });

  it("does not divide by zero on a month with no spending", () => {
    const text = offlineAnswer(
      { ...context, month: { ...context.month, spent: 0 }, comparison: [{ month: "July", spent: 0 }] },
      "patterns",
    );
    expect(text).not.toContain("NaN");
    expect(text).not.toContain("Infinity");
  });
});

describe("every answer", () => {
  it("is plain text with no placeholder left in it", () => {
    for (const task of ["summary", "alerts", "patterns"] as const) {
      const text = offlineAnswer(context, task);
      expect(text.length).toBeGreaterThan(20);
      expect(text).not.toContain("undefined");
      expect(text).not.toContain("NaN");
      expect(text).not.toContain("[object");
    }
  });
});
