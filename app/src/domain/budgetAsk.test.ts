import { describe, expect, it } from "vitest";

import { planBudget, readBudgetAsk } from "./budgetAsk";
import type { Budgets, ReferenceLists } from "./types";

const reference: ReferenceLists = {
  wallets: ["Cash"],
  savings: [],
  bills: [],
  subscriptions: [],
  revenueCategories: [],
  spendingTypes: [{ name: "Food", remark: "" }, { name: "Travel", remark: "" }],
};
const ASOF = "2026-09-10";
const AT = "2026-09-10T08:00:00.000Z";
const twelve = (v: number) => [v, v, v, v, v, v, v, v, v, v, v, v] as unknown as Budgets[string]["spending"];
const budgets: Budgets = { "2026": { spending: twelve(700_000), billsSubs: twelve(200_000) } };

describe("reading a budget request", () => {
  it("reads the spending budget for this month", () => {
    expect(readBudgetAsk("set my budget to 8000", reference, ASOF)).toEqual({ kind: "tracks", year: 2026, month: 9, spending: 800_000, scope: "month" });
  });

  it("reads bills for a named month", () => {
    expect(readBudgetAsk("set bills budget for october to 2500", reference, ASOF)).toMatchObject({ month: 10, billsSubs: 250_000 });
  });

  it("reads a limit on a kind of spending, for the rest of the year", () => {
    expect(readBudgetAsk("limit food to 3000 for the rest of the year", reference, ASOF)).toEqual({
      kind: "limit",
      year: 2026,
      month: 9,
      name: "Food",
      value: 300_000,
      scope: "rest",
    });
  });

  it("reads copying last month", () => {
    expect(readBudgetAsk("same budget as last month", reference, ASOF)).toEqual({ kind: "copy", year: 2026, month: 9, scope: "month" });
  });

  it("leaves other sentences alone", () => {
    expect(readBudgetAsk("how is my budget", reference, ASOF)).toBeNull();
    expect(readBudgetAsk("I paid 500 for food", reference, ASOF)).toBeNull();
  });
});

describe("planning it with the Budget screen's rules", () => {
  it("changes the month and keeps the other track", () => {
    const ask = readBudgetAsk("set my budget to 8000", reference, ASOF)!;
    const plan = planBudget(ask, budgets, ASOF, AT);
    expect(plan.outcome.refused).toBeUndefined();
    expect(plan.outcome.plan.spending[8]).toBe(800_000);
    expect(plan.outcome.plan.billsSubs[8]).toBe(200_000);
    expect(plan.outcome.plan.spending[7]).toBe(700_000);
    expect(plan.changes).toHaveLength(1);
  });

  it("refuses a closed month, as the Budget screen does without a reason", () => {
    const ask = readBudgetAsk("set my budget for march to 9000", reference, ASOF)!;
    expect(planBudget(ask, budgets, ASOF, AT).outcome.refused).toContain("closed");
  });

  it("sets a limit", () => {
    const ask = readBudgetAsk("limit food to 3000", reference, ASOF)!;
    const plan = planBudget(ask, budgets, ASOF, AT);
    expect(plan.outcome.plan.categories?.["Food"]?.[8]).toBe(300_000);
  });
});
