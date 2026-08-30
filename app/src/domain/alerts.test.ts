/**
 * Finance alerts, against the real ledger.
 *
 * Two things these pin. First, that the settings which had no effect now have
 * one: change the threshold and the alerts change. Second, that nothing here
 * fires on a healthy month, because an alert that is always on is noise.
 */

import { describe, expect, it } from "vitest";

import { loadFixture } from "../fixtures/load";
import { billStatuses } from "./bills";
import { burnRate, dailyAllowance, daysLeft, financeAlerts, worstLevel } from "./alerts";
import type { Account } from "./accounts";
import type { AlertInput } from "./alerts";

const fixture = loadFixture();
const AS_OF = "2026-08-29";

const accounts: Account[] = [
  { id: "gcash", name: "Gcash", kind: "spending", archived: false },
  { id: "maya", name: "Maya", kind: "spending", archived: false },
  { id: "cash", name: "Cash", kind: "spending", archived: false, channel: "cash" },
  { id: "extra", name: "Extra Cash", kind: "savings", archived: false },
];

const base: AlertInput = {
  transactions: fixture.transactions,
  accounts,
  budgets: fixture.budgets,
  debts: [],
  bills: billStatuses(fixture.transactions, fixture.reference, AS_OF),
  lowBalanceThreshold: 50000,
  asOf: AS_OF,
};

describe("the numbers behind the alerts", () => {
  it("works the burn rate out from the month so far", () => {
    // August spend is PHP 11,291.37 over 29 days.
    expect(burnRate(fixture.transactions, AS_OF)).toBe(Math.round(1129137 / 29));
  });

  it("counts today as a day still left", () => {
    expect(daysLeft("2026-08-29")).toBe(3);
    expect(daysLeft("2026-08-31")).toBe(1);
    expect(daysLeft("2026-02-01")).toBe(28);
  });

  it("refuses to invent a daily figure with no budget set", () => {
    expect(dailyAllowance(fixture.transactions, {}, AS_OF)).toBeNull();
  });

  it("spreads what is left of the budget over the days that remain", () => {
    const perDay = dailyAllowance(fixture.transactions, fixture.budgets, AS_OF);
    expect(perDay).not.toBeNull();
    // August is already over budget, so the allowance is negative.
    expect(perDay!).toBeLessThan(0);
  });
});

describe("the low balance setting now does something", () => {
  it("says nothing at all when the warning is switched off", () => {
    const alerts = financeAlerts({ ...base, lowBalanceThreshold: 0 });
    expect(alerts.filter((a) => a.area === "wallet")).toHaveLength(0);
  });

  it("flags a wallet under the threshold", () => {
    // Gcash holds PHP 155.71 and Cash PHP 161.00.
    const alerts = financeAlerts({ ...base, lowBalanceThreshold: 50000 });
    const flagged = alerts.filter((a) => a.area === "wallet").map((a) => a.title);
    expect(flagged).toContain("Gcash is running low");
    expect(flagged).toContain("Cash is running low");
  });

  it("stops flagging it once the threshold drops below the balance", () => {
    const alerts = financeAlerts({ ...base, lowBalanceThreshold: 10000 });
    expect(alerts.filter((a) => a.area === "wallet")).toHaveLength(0);
  });

  it("quotes both the balance and the threshold, so it can be checked", () => {
    const alert = financeAlerts(base).find((a) => a.id === "low-gcash");
    expect(alert?.detail).toContain("155.71");
    expect(alert?.detail).toContain("500.00");
  });

  it("ignores savings, which are not meant to be spent from", () => {
    const alerts = financeAlerts({ ...base, lowBalanceThreshold: 1_000_000_00 });
    expect(alerts.some((a) => a.id === "low-extra")).toBe(false);
  });

  it("ignores an archived account", () => {
    const archived = accounts.map((a) => (a.id === "gcash" ? { ...a, archived: true } : a));
    const alerts = financeAlerts({ ...base, accounts: archived });
    expect(alerts.some((a) => a.id === "low-gcash")).toBe(false);
  });
});

describe("budget", () => {
  it("reports the overrun with the figures it is measured against", () => {
    const alert = financeAlerts(base).find((a) => a.id === "budget-over");
    expect(alert?.level).toBe("over");
    expect(alert?.detail).toContain("7,700.00");
    expect(alert?.detail).toContain("3 days left");
  });

  it("says nothing about the budget when none is set", () => {
    const alerts = financeAlerts({ ...base, budgets: {} });
    expect(alerts.some((a) => a.area === "budget")).toBe(false);
  });

  it("does not warn about pace and overrun at the same time", () => {
    const alerts = financeAlerts(base);
    const budget = alerts.filter((a) => a.area === "budget");
    expect(budget).toHaveLength(1);
  });
});

describe("rows needing review", () => {
  it("surfaces the same rows the integrity check finds", () => {
    const alert = financeAlerts(base).find((a) => a.id === "needs-review");
    expect(alert).toBeDefined();
    expect(alert?.level).toBe("warn");
  });

  it("goes quiet on a ledger with nothing wrong in it", () => {
    const alerts = financeAlerts({ ...base, transactions: [] });
    expect(alerts.some((a) => a.id === "needs-review")).toBe(false);
  });
});

describe("ordering and summary", () => {
  it("puts the worst first", () => {
    const weights = financeAlerts(base).map((a) => a.weight);
    expect([...weights].sort((a, b) => b - a)).toEqual(weights);
  });

  it("reports the worst level present", () => {
    expect(worstLevel(financeAlerts(base))).toBe("over");
    expect(worstLevel([])).toBeNull();
  });

  it("says nothing at all about an empty system", () => {
    const alerts = financeAlerts({
      ...base,
      transactions: [],
      budgets: {},
      bills: [],
      accounts: [],
    });
    expect(alerts).toHaveLength(0);
    expect(worstLevel(alerts)).toBeNull();
  });
});

describe("it only reports", () => {
  it("never changes a transaction", () => {
    const before = JSON.stringify(fixture.transactions);
    financeAlerts(base);
    expect(JSON.stringify(fixture.transactions)).toBe(before);
  });
});
