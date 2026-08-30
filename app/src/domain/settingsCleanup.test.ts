/**
 * Cleaning up the category lists.
 *
 * The rule that matters: this only ever touches lists. No transaction and no
 * balance may change, which is what makes it safe to run on every load.
 */

import { describe, expect, it } from "vitest";

import { cleanSettings, cleanedSettings } from "./settingsCleanup";
import { defaultSettings } from "./settings";
import type { AppSettings } from "./settings";
import type { Debt } from "./debt";

const mayaCredit: Debt = {
  id: "maya-credit",
  name: "Maya Credit",
  kind: "payable",
  counterparty: "Maya",
  openedDate: "2026-01-01",
  wallet: "Maya",
  interestType: "none",
  interestRate: 0,
  notes: "",
  archived: false,
};

const messy: AppSettings = {
  ...defaultSettings(),
  credits: [mayaCredit],
  revenueCategories: [
    "Allowance",
    "Transfer of balance",
    "Maya Credit",
    "allowance",
    "  ",
    "Bank interest",
  ],
  bills: ["Globe at Home Wifi", "Maya Credit", "Globe at Home Wifi "],
  subscriptions: ["Spotify", ""],
  spendingTypes: [
    { name: "Food", remark: "Meals" },
    { name: "Money Send", remark: "IMPORTANT" },
    { name: "Transaction Fee", remark: "IMPORTANT" },
    { name: "food", remark: "duplicate" },
  ],
};

describe("what it removes", () => {
  const report = cleanSettings(messy);

  it("removes the Excel's year-start workaround", () => {
    expect(report.settings.revenueCategories).not.toContain("Transfer of balance");
  });

  it("removes a credit line from revenue, where it would become income", () => {
    expect(report.settings.revenueCategories).not.toContain("Maya Credit");
  });

  it("removes the same credit line from bills, where a repayment would become spending", () => {
    expect(report.settings.bills).not.toContain("Maya Credit");
  });

  it("removes the two spending types the app derives", () => {
    const names = report.settings.spendingTypes.map((t) => t.name);
    expect(names).not.toContain("Money Send");
    expect(names).not.toContain("Transaction Fee");
  });

  it("removes blanks", () => {
    expect(report.settings.subscriptions).toEqual(["Spotify"]);
  });

  it("removes duplicates that differ only by case or spacing", () => {
    expect(report.settings.revenueCategories).toEqual(["Allowance", "Bank interest"]);
    expect(report.settings.bills).toEqual(["Globe at Home Wifi"]);
    expect(report.settings.spendingTypes.map((t) => t.name)).toEqual(["Food"]);
  });
});

describe("what it keeps", () => {
  it("keeps everything genuine", () => {
    const kept = cleanedSettings(messy);
    expect(kept.revenueCategories).toContain("Bank interest");
    expect(kept.bills).toContain("Globe at Home Wifi");
    expect(kept.spendingTypes.map((t) => t.name)).toContain("Food");
  });

  it("changes nothing that is already clean", () => {
    const clean = cleanedSettings(messy);
    expect(cleanedSettings(clean)).toEqual(clean);
    expect(cleanSettings(clean).changed).toBe(false);
  });

  it("leaves accounts, goals and credits alone", () => {
    const kept = cleanedSettings(messy);
    expect(kept.credits).toEqual(messy.credits);
    expect(kept.accounts).toEqual(messy.accounts);
  });

  it("touches nothing on a default install", () => {
    expect(cleanSettings(defaultSettings()).changed).toBe(false);
  });
});

describe("it says why", () => {
  const report = cleanSettings(messy);

  it("gives a reason for every removal", () => {
    expect(report.removals.every((r) => r.why.length > 0)).toBe(true);
  });

  it("names which list each one came from", () => {
    const lists = new Set(report.removals.map((r) => r.list));
    expect(lists).toContain("Revenue categories");
    expect(lists).toContain("Bills");
    expect(lists).toContain("Spending types");
  });

  it("explains the credit line rather than just deleting it", () => {
    const why = report.removals.find((r) => r.value === "Maya Credit")?.why;
    expect(why).toContain("credit line");
  });
});
