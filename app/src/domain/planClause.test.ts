/** An entry and a plan in one message (planClause.ts, 27 October 2026 sweep). */
import { describe, expect, it } from "vitest";
import { splitPlanClause, withoutPlanClause } from "./planClause";

describe("an entry with a plan after it", () => {
  it("splits the part that happened from the plan", () => {
    expect(splitPlanClause("I bought shoes 2500 and I plan to buy a bag next month 1500")).toEqual({ done: "I bought shoes 2500", plan: "I plan to buy a bag next month 1500" });
    expect(splitPlanClause("paid 300 for gas, then I will buy food tomorrow 200")).toEqual({ done: "paid 300 for gas", plan: "I will buy food tomorrow 200" });
    expect(withoutPlanClause("nagbayad ako 500 sa tuition tapos balak kong bumili ng libro next week")).toBe("nagbayad ako 500 sa tuition");
  });
  it("leaves one thing alone", () => {
    expect(splitPlanClause("I bought shoes 2500 and a bag 1500")).toBeNull();
    expect(splitPlanClause("I plan to buy a bag next month 1500")).toBeNull();
    // Two things that happened are the entry splitter's.
    expect(splitPlanClause("I paid 500 for food and I paid 300 for gas")).toBeNull();
    expect(withoutPlanClause("bought load 100")).toBe("bought load 100");
  });
});
