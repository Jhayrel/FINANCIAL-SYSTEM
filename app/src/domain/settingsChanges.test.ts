/** Owner, 27 October 2026: "//fix the activity it doesnt recognized edits happening in settings". Figures invented. */
import { describe, expect, it } from "vitest";
import { defaultSettings, type AppSettings } from "./settings";
import { settingsChanges, settingsChangesSummary } from "./settingsChanges";
import type { Debt } from "./debt";

const base: AppSettings = {
  ...defaultSettings(),
  accounts: [
    { id: "a1", name: "Cash", kind: "spending", archived: false, channel: "cash" },
    { id: "a2", name: "Maya Bank", kind: "savings", archived: false },
    { id: "g1", name: "Maya Bank (Phone)", kind: "goal", parentId: "a2", target: 2_500_000, deadline: "2027-03-31", archived: false },
  ],
  bills: ["Electricity"],
  subscriptions: ["Spotify"],
  spendingTypes: [{ name: "Food", remark: "meals", necessity: "essential" }, { name: "Treat", remark: "" }],
  credits: [{ id: "d1", name: "Card Credit", kind: "payable", counterparty: "Bank", openedDate: "2026-01-01", dueDay: 6, wallet: "Maya", interestType: "none", interestRate: 0, creditLimit: 800_000, archived: false } as unknown as Debt],
};

describe("what changed in Settings", () => {
  it("says nothing when nothing changed", () => {
    expect(settingsChanges(base, { ...base })).toEqual([]);
  });

  it("names account and goal edits with before and after", () => {
    const next: AppSettings = {
      ...base,
      accounts: [
        { ...base.accounts[0]!, name: "Wallet cash" },
        base.accounts[1]!,
        { ...base.accounts[2]!, target: 3_000_000, deadline: "2027-06-30", archived: true },
        { id: "a3", name: "GCash", kind: "spending", archived: false },
      ],
    };
    const lines = settingsChanges(base, next).map((c) => c.line);
    expect(lines).toContain('Renamed "Cash" to "Wallet cash"');
    expect(lines).toContain('Closed "Maya Bank (Phone)"');
    expect(lines).toContain('"Maya Bank (Phone)" target ₱25,000.00 to ₱30,000.00');
    expect(lines).toContain('"Maya Bank (Phone)" deadline March 31, 2027 to June 30, 2027');
    expect(lines).toContain('Added "GCash" as a spending wallet');
  });

  it("names lists, kinds, debts, the AI and the alerts", () => {
    const next: AppSettings = {
      ...base,
      bills: ["Electricity", "Water"],
      subscriptions: [],
      spendingTypes: [{ name: "Food", remark: "meals", necessity: "essential" }, { name: "Treat", remark: "", necessity: "discretionary" }],
      credits: [{ ...base.credits[0]!, dueDay: 10, creditLimit: 1_000_000 }],
      ai: { ...base.ai, enabled: !base.ai.enabled },
      lowBalanceThreshold: 100_000,
    };
    const changes = settingsChanges(base, next);
    const lines = changes.map((c) => c.line);
    expect(lines).toContain("Added to bills: Water");
    expect(lines).toContain("Taken off subscriptions: Spotify");
    expect(lines).toContain('"Treat" is now a want, was unmarked');
    expect(lines).toContain('"Card Credit": limit ₱8,000.00 to ₱10,000.00, due day 6 to 10');
    expect(lines).toContain(base.ai.enabled ? "Turned the AI off" : "Turned the AI on");
    expect(lines).toContain("Low balance warning ₱500.00 to ₱1,000.00");
    expect(settingsChangesSummary(changes)).toMatch(/^Changed in Settings, Categories, Debts, AI, Alerts: Added to bills: Water; Taken off subscriptions: Spotify; "Treat" is now a want, was unmarked; and 3 more$/);
  });

  it("leaves a renamed kind to its own event", () => {
    const next: AppSettings = { ...base, spendingTypes: [{ name: "Meals", remark: "meals", necessity: "essential" }, base.spendingTypes[1]!] };
    expect(settingsChanges(base, next, [["Food", "Meals"]])).toEqual([]);
    expect(settingsChanges(base, next).map((c) => c.line)).toEqual(["Added to kinds of spending: Meals", "Taken off kinds of spending: Food"]);
  });
});
