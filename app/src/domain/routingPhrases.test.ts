import { describe, expect, it } from "vitest";

import { readAffordAsk } from "./affordAsk";
import { asksSettingsChange } from "./assistantScope";
import { asksShortBudget } from "./budgetAdvice";
import { namesBudgetCommand, spanIn } from "./budgetAsk";
import { asksSafeToSpend } from "./safeAsk";
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
