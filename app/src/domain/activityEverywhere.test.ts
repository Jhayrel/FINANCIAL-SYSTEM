/**
 * Every part on the Activity trail (owner, 3 November 2026: "make sure
 * everything or every part of the system even setting will be recorded in
 * activity log"). Invented accounts and rows.
 */
import { describe, expect, it } from "vitest";

import { dataTaken, planChanged, purged, settingsChanged, withinLimits, type ActivityEvent } from "./activity";
import { activityAnswer } from "./activityAsk";
import type { Debt } from "./debt";
import type { AppSettings } from "./settings";
import { settingsChanges, settingsChangesSummary } from "./settingsChanges";
import type { Transaction } from "./types";

const debt = (over: Partial<Debt>): Debt => ({ id: "mc", name: "Maya Credit", kind: "payable", form: "revolving", counterparty: "Maya", counterpartyType: "lender", openedDate: "2026-01-01", wallet: "Maya", interestType: "none", interestRate: 0, notes: "", archived: false, ...over }) as Debt;
const base = {
  accounts: [],
  bills: [],
  subscriptions: [],
  revenueCategories: [],
  spendingTypes: [],
  credits: [debt({})],
  stopped: [],
  ai: { enabled: true, provider: "gemini", model: "", tone: "detailed", features: {} },
  theme: "system",
  lowBalanceThreshold: 50_000,
} as unknown as AppSettings;

describe("a change to Settings made somewhere else", () => {
  it("a limit set on the Debt screen says where", () => {
    const after = { ...base, credits: [debt({ creditLimit: 500_000 })] };
    const changes = settingsChanges(base, after);
    expect(settingsChangesSummary(changes, "on the Debt screen")).toBe('Changed on the Debt screen, Debts: "Maya Credit": limit ₱0.00 to ₱5,000.00');
  });

  it("a line added from the Add form or the chat, and one opened again by a new entry", () => {
    const added = { ...base, credits: [...base.credits, debt({ id: "f", name: "Father", kind: "receivable", form: "pass-through" })] };
    expect(settingsChangesSummary(settingsChanges(base, added), "on the Add form")).toBe('Changed on the Add form, Debts: Added the debt line "Father"');
    const closed = { ...base, credits: [debt({ archived: true })] };
    expect(settingsChangesSummary(settingsChanges(closed, base), "by a new entry")).toBe('Changed by a new entry, Debts: "Maya Credit": opened again');
  });

  it("the Settings screen's own saves read as before", () => {
    const after = { ...base, lowBalanceThreshold: 30_000, theme: "dark" } as AppSettings;
    expect(settingsChangesSummary(settingsChanges(base, after))).toBe("Changed in Settings, Alerts, Display: Low balance warning ₱500.00 to ₱300.00; Theme system to dark");
  });
});

describe("what the database accepts", () => {
  it("a long list of changes is cut to fit, never refused whole", () => {
    const e = { ...settingsChanged("x".repeat(400)), after: "y".repeat(900), before: "z".repeat(601) };
    const fit = withinLimits(e);
    expect(fit.summary?.length).toBeLessThanOrEqual(300);
    expect(fit.after?.length).toBe(600);
    expect(fit.after?.endsWith("...")).toBe(true);
    expect(fit.before?.length).toBe(600);
  });

  it("an event that fits is unchanged", () => {
    const e = settingsChanged("Changed in Settings, Display: Theme system to dark");
    expect(withinLimits(e)).toEqual(e);
  });
});

describe("copies taken and rows deleted for good", () => {
  it("are events of their own", () => {
    expect(dataTaken("data.backup", "Backed up 3,962 transactions.")).toMatchObject({ action: "data.backup", actor: "owner", via: "manual" });
    const row = { id: "t1", recordNumber: 3833, date: "2026-09-26", type: "Revenue", fromWallet: "", toWallet: "Maya", category: "Revenue", item: "Random", description: "", amount: 30206, fee: 0, total: 30206, notes: "", status: "Received" } as Transaction;
    expect(purged(row)).toMatchObject({ action: "transaction.purge", recordNumber: 3833, summary: "Deleted #3833, Random, for good from the bin." });
  });
});

describe("what changed, asked in the chat", () => {
  it("counts the Planner, copies and Settings too", () => {
    const today = new Date().toISOString().slice(0, 10);
    const events: ActivityEvent[] = [
      planChanged("plan.create", 'Planned "Laptop".'),
      planChanged("plan.paid", 'Paid "Laptop".'),
      dataTaken("data.backup", "Backed up."),
      settingsChanged("Changed in Settings, Display: Theme system to dark"),
    ];
    const words = activityAnswer({ from: today, to: today, span: "today", by: null, action: null }, events, true);
    expect(words).toMatch(/1 plan added/);
    expect(words).toMatch(/1 plan payment\b/);
    expect(words).toMatch(/1 backup taken/);
    expect(words).toMatch(/1 settings changes/);
  });
});
