/**
 * Two screens may not disagree about the same month.
 *
 * Every screen works its figures out from the ledger rather than from each
 * other, which is the right way round: one stored total that drifts is worse
 * than four derived ones. The risk it carries is that they drift apart
 * instead, and the owner has hit that before, when the bars under "Where it
 * went" added to PHP 1,641.00 less than the headline above them.
 *
 * So this file computes the same month the way the Dashboard does, the way
 * Insights does, the way Budget does, and straight from `totals.ts`, and
 * holds them to each other. Nothing here is a figure anyone typed: each
 * assertion is two paths to one answer. A failure means a screen is lying,
 * and which one is named by the test that broke.
 */

import { describe, expect, it } from "vitest";

import { loadFixture } from "../fixtures/load";
import { migrateAccounts } from "./accounts";
import { allWalletBalances, totalSavingsBalance, totalWalletBalance, walletBalances } from "./balances";
import { restoreImpact } from "./binView";
import { createBackup, restore, validateBackup, type BackupData } from "./backup";
import { assessMonthFor } from "./budget";
import { monthPlanView } from "./budgetView";
import { rangeOf, rangeReport } from "./dayRange";
import { firstOfMonth, getMonth, getYear, lastOfMonth } from "./dates";
import { monthBrief } from "./monthPlan";
import { defaultSettings } from "./settings";
import { buildStatement } from "./statements";
import { monthTotals, spendingAttribution, totalsFor } from "./totals";

const fx = loadFixture();
const REAL = fx.transactions;
const YEAR = getYear(fx.expected.asOf);
const ASOF = fx.expected.asOf;
const DEBTS = [] as const;

const brief = (month: number) =>
  monthBrief({
    transactions: REAL,
    reference: fx.reference,
    budgets: fx.budgets,
    debts: DEBTS,
    year: YEAR,
    month,
    asOf: ASOF,
  });

const report = (month: number) =>
  rangeReport({
    transactions: REAL,
    reference: fx.reference,
    debts: DEBTS,
    range: rangeOf(firstOfMonth(YEAR, month), lastOfMonth(YEAR, month)),
    asOf: ASOF,
  });

/** Every month of the fixture's year, so no month gets to be the lucky one. */
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

describe("the Dashboard and Insights read the same month", () => {
  for (const month of MONTHS) {
    it(`${YEAR}-${String(month).padStart(2, "0")}: what went out, and what came in`, () => {
      const b = brief(month);
      const r = report(month);
      expect(r.spent, "spent").toBe(b.wentOut);
      expect(r.cameIn, "came in").toBe(b.cameIn);
    });
  }
});

describe("the bars add up to the figure above them", () => {
  for (const month of MONTHS) {
    it(`${YEAR}-${String(month).padStart(2, "0")}: every kind is on a line`, () => {
      const r = report(month);
      const shown = r.kinds.reduce((sum, k) => sum + k.amount, 0);
      expect(shown, `${r.kinds.length} kinds`).toBe(r.spent);
    });

    it(`${YEAR}-${String(month).padStart(2, "0")}: the Dashboard names the same kinds as Insights`, () => {
      const r = report(month);
      const b = brief(month);
      // The Dashboard shows the six largest; they must be the six largest.
      expect(b.kinds.map((k) => ({ name: k.name, amount: k.amount }))).toEqual(
        r.kinds.slice(0, b.kinds.length).map((k) => ({ name: k.name, amount: k.amount })),
      );
    });

    it(`${YEAR}-${String(month).padStart(2, "0")}: the spending track is a part of it, never more`, () => {
      // `spendingAttribution` is the workbook's split: the spending track
      // alone, silent on bills, subscriptions and what a lender charged. It
      // is a subset of what left, so it can never exceed it.
      const attributed = [...spendingAttribution(REAL, {
        start: firstOfMonth(YEAR, month),
        end: lastOfMonth(YEAR, month),
      }).values()].reduce((sum, v) => sum + v, 0);
      expect(attributed).toBeLessThanOrEqual(report(month).spent);
    });
  }
});

describe("Budget judges the month the Dashboard describes", () => {
  for (const month of MONTHS) {
    it(`${YEAR}-${String(month).padStart(2, "0")}: one assessment, two screens`, () => {
      const b = brief(month);
      const view = monthPlanView(REAL, fx.budgets, YEAR, month, ASOF);
      const assessed = assessMonthFor(REAL, fx.budgets, YEAR, month);

      expect(view.assessment).toEqual(assessed);
      expect(b.tracks).toEqual(assessed);
      expect(view.revenue).toBe(b.cameIn);
      expect(b.wentOut).toBe(assessed.combined.spent);

      // What is kept is what came in less both tracks, on either screen.
      expect(view.kept).toBe(view.revenue - assessed.combined.spent);
    });
  }
});

describe("a statement for a month says what the month says", () => {
  for (const month of MONTHS) {
    it(`${YEAR}-${String(month).padStart(2, "0")}: every row is in the range, and the net is its own sum`, () => {
      const s = buildStatement(REAL, "account", YEAR, month, month, fx.reference);
      for (const { transaction } of s.rows) {
        expect(getYear(transaction.date)).toBe(YEAR);
        expect(getMonth(transaction.date)).toBe(month);
      }
      expect(s.net).toBe(s.totalIn - s.totalOut);
      expect(Number.isInteger(s.totalIn) && Number.isInteger(s.totalOut)).toBe(true);
      expect(s.from).toBe(firstOfMonth(YEAR, month));
      expect(s.to).toBe(lastOfMonth(YEAR, month));
    });
  }

  it("a year of statements holds every row the year holds", () => {
    const whole = buildStatement(REAL, "account", YEAR, 1, 12, fx.reference);
    const inYear = REAL.filter((t) => getYear(t.date) === YEAR);
    expect(whole.rows).toHaveLength(inYear.length);
  });
});

describe("the twelve months are the year", () => {
  it("what came in, month by month, is what came in", () => {
    const summed = MONTHS.reduce((sum, m) => sum + monthTotals(REAL, YEAR, m).revenue, 0);
    const wholeYear = totalsFor(REAL.filter((t) => getYear(t.date) === YEAR)).revenue;
    expect(summed).toBe(wholeYear);
  });

  it("and so is what went out", () => {
    const summed = MONTHS.reduce((sum, m) => sum + assessMonthFor(REAL, fx.budgets, YEAR, m).combined.spent, 0);
    const wholeYear = MONTHS.reduce((sum, m) => sum + brief(m).wentOut, 0);
    expect(summed).toBe(wholeYear);
  });
});

describe("the wallets on one screen are the wallets on another", () => {
  it("the parts add to the total", () => {
    const listed = walletBalances(REAL, fx.reference.wallets, fx.reference.savings);
    const summed = listed.filter((w) => !w.isSavings).reduce((sum, w) => sum + w.balance, 0);
    expect(summed).toBe(totalWalletBalance(REAL, fx.reference.wallets));
  });

  it("savings are counted once, and not as wallets", () => {
    const savings = totalSavingsBalance(REAL, fx.reference.savings);
    const wallets = totalWalletBalance(REAL, fx.reference.wallets);
    const both = new Set(fx.reference.wallets.filter((w) => fx.reference.savings.includes(w)));
    expect([...both], "an account cannot be both").toEqual([]);
    expect(Number.isInteger(savings) && Number.isInteger(wallets)).toBe(true);
  });

  it("every account the ledger names is one the accounts list knows, or a retired one", () => {
    const known = new Set([...fx.reference.wallets, ...fx.reference.savings]);
    const accounts = migrateAccounts(fx.reference.wallets, fx.reference.savings, REAL);
    for (const a of accounts) known.add(a.name);
    for (const name of allWalletBalances(REAL).keys()) {
      expect(known.has(name), `${name} appears in the ledger`).toBe(true);
    }
  });
});

describe("the bin says what restoring would do", () => {
  it("each wallet moves by exactly what it says", () => {
    const binned = fx.deleted.slice(0, 40);
    if (binned.length === 0) return;

    const before = allWalletBalances(REAL);
    const after = allWalletBalances([...REAL, ...binned]);

    for (const move of restoreImpact(binned)) {
      const delta = (after.get(move.wallet) ?? 0) - (before.get(move.wallet) ?? 0);
      expect(delta, move.wallet).toBe(move.change);
    }
  });

  it("names every wallet that would move, and no others", () => {
    const binned = fx.deleted.slice(0, 40);
    const before = allWalletBalances(REAL);
    const after = allWalletBalances([...REAL, ...binned]);
    const moved = [...after.keys()].filter((w) => (after.get(w) ?? 0) !== (before.get(w) ?? 0));
    expect(new Set(restoreImpact(binned).map((m) => m.wallet))).toEqual(new Set(moved));
  });
});

describe("a backup is the system, and restoring it gives the system back", () => {
  const input: BackupData = {
    transactions: REAL,
    deleted: fx.deleted,
    budgets: fx.budgets,
    settings: defaultSettings(),
    preferences: { theme: "dark" },
    migrations: { debt: true, opening: true },
  };
  const file = createBackup(input, "2026-09-20T00:00:00.000Z");

  it("survives the round trip through JSON, with its checksum intact", () => {
    const parsed: unknown = JSON.parse(JSON.stringify(file));
    const checked = validateBackup(parsed);
    expect(checked.ok, checked.ok ? "" : checked.problems.join(" ")).toBe(true);
  });

  /** The system as it is now, which a restore is applied against. */
  const current = { ...input, transactions: [] as typeof REAL, deleted: [] as typeof fx.deleted };

  it("puts back a ledger that balances to the same figures", () => {
    const checked = validateBackup(JSON.parse(JSON.stringify(file)));
    if (!checked.ok) throw new Error(checked.problems.join(" "));

    const out = restore(checked.backup!, current, "replace");
    expect(out.transactions).toHaveLength(REAL.length);
    expect(allWalletBalances(out.transactions)).toEqual(allWalletBalances(REAL));
    expect(totalsFor(out.transactions)).toEqual(totalsFor(REAL));
  });

  it("merging a backup into the ledger it came from adds nothing", () => {
    const checked = validateBackup(JSON.parse(JSON.stringify(file)));
    if (!checked.ok) throw new Error(checked.problems.join(" "));

    const out = restore(checked.backup!, input, "merge");
    expect(out.added, "a row already there is not added twice").toBe(0);
    expect(allWalletBalances(out.transactions)).toEqual(allWalletBalances(REAL));
  });
});
