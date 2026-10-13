import { describe, expect, it } from "vitest";

import { readAffordAsk } from "./affordAsk";
import { asksSettingsChange } from "./assistantScope";
import { asksShortBudget } from "./budgetAdvice";
import { namesBudgetCommand, spanIn } from "./budgetAsk";
import { asksSafeToSpend } from "./safeAsk";
import { daysIn } from "./readEntry";
import { asksBudgetHistory } from "./settingsContext";

const reference = { wallets: ["Cash", "Maya"], savings: [], bills: [], subscriptions: [], revenueCategories: [], spendingTypes: [] } as never;

describe("the owner's own wordings, read the way they meant them (12 October 2026 audit)", () => {
  it("a sum without the bills is safe to spend, never Settings", () => {
    for (const q of [
      "remove the subscription and bills",
      "What is my safe spending? Like the actual safe spending based remove the subscription and bills",
      "how much is left after paying the bills",
      "what do i have after bills and subscriptions",
      "i mean minus the bills",
      "how much can i spend for the next 5 days",
    ]) {
      expect([q, asksSafeToSpend(q), asksSettingsChange(q)]).toEqual([q, true, false]);
    }
    expect(asksSafeToSpend("remove the Spotify subscription")).toBe(false);
  });

  it("budget history is history, never a change", () => {
    for (const q of ["did I change my budget?", "what did I change in my budget", "what was my budget before", "how many times did i change my budget"]) {
      expect([q, asksBudgetHistory(q), namesBudgetCommand(q)]).toEqual([q, true, false]);
    }
    expect(namesBudgetCommand("change my budget to 5000")).toBe(true);
  });

  it("a limit from a month runs from it on, even with the amount's 'to' before it", () => {
    expect(spanIn("limit food to 3000 from november", "2026-10-13")).toMatchObject({ month: 11, scope: "rest" });
    expect(spanIn("budget 8000 from november to december", "2026-10-13")).toMatchObject({ month: 11, toMonth: 12, scope: "month" });
  });

  it("a date's day is never money", () => {
    expect(readAffordAsk("how much can i spend on oct 20", [], reference, "2026-10-13").amount).toBeNull();
    expect(readAffordAsk("can i spend 500 on oct 20", [], reference, "2026-10-13").amount).toBe(50000);
  });

  it("a budget for a run of days is what is safe over it", () => {
    for (const q of ["what budget should i have for the next 3 days", "recommend a budget for this weekend"]) expect([q, asksShortBudget(q, "2026-10-13")]).toEqual([q, true]);
  });
});

describe("weekends (13 October 2026)", () => { it("are Saturday and Sunday: this one, the last, and the one running", () => {
  // 2026-10-13 is a Tuesday.
  expect(daysIn("how much did i spend this weekend", "2026-10-13")).toMatchObject({ from: "2026-10-17", to: "2026-10-18" });
  expect(daysIn("how much did i spend last weekend", "2026-10-13")).toMatchObject({ from: "2026-10-10", to: "2026-10-11" });
  expect(daysIn("spent 2000 on travel this weekend", "2026-10-18")).toMatchObject({ from: "2026-10-17", to: "2026-10-18" });
}); });

describe("spending worked out from what is left (owner, 12 October 2026)", () => {
  it("is the ledger less what is left, with the kind named", async () => {
    const { spentFromLeft } = await import("./leftOver");
    const ref = { wallets: ["Cash", "Maya"], savings: [], spendingTypes: [{ name: "Travel", remark: "" }, { name: "Food", remark: "" }] } as never;
    const bal = (a: string) => (a === "Cash" ? 985500 : 10000);
    expect(spentFromLeft("518 is whats left of my cash all use in travel expenses to my grandmother funeral. check how much i spend and add it", ref, bal)).toEqual({ account: "Cash", left: 51800, ledger: 985500, spent: 933700, item: "Travel" });
    expect(spentFromLeft("I only have 200 left in maya, spent the rest on food", ref, bal)).toMatchObject({ account: "Maya", spent: -10000, item: "Food" });
    expect(spentFromLeft("518 left in cash", ref, bal)).toBeNull();
    expect(spentFromLeft("how much did i spend on travel", ref, bal)).toBeNull();
  });
});

describe("carry-over questions (12 October 2026)", () => {
  it("are safe to spend questions", () => {
    for (const q of ["what if I didn't spend yesterday?", "if i don't spend today what happens tomorrow", "what if I hadn't spent yesterday"]) expect([q, asksSafeToSpend(q)]).toEqual([q, true]);
  });
});
