/**
 * Replies to a Planner card still waiting in the chat (owner, 27 October
 * 2026): "Before adding that what do you think?" and "Its not safe spend".
 */
import { describe, expect, it } from "vitest";
import { asksPlanOpinion, planOpinion, readPlanCardChange } from "./planCard";
import type { PlanInput } from "./planner";

const reference = {
  wallets: ["Cash", "Gcash", "Maya"],
  savings: ["Maya Bank (Personal savings)"],
  bills: [],
  subscriptions: [],
  spendingTypes: [{ name: "Travel", remark: "" }, { name: "Food", remark: "" }],
} as never;
const asOf = "2026-10-27";
const trip: PlanInput = { title: "Trip", amount: 1_000_000, due: "2026-12-31", dueKind: "month", item: "Travel", wallet: "", need: false, setAside: true, notes: "" };
const ctx = { reference, asOf };

describe("an opinion is asked about the card", () => {
  it("knows the question", () => {
    for (const q of ["Before adding that what do you think?", "what do you think", "is it okay?", "any advice?", "should I add it", "can I afford it?", "kaya ba?"]) expect(asksPlanOpinion(q), q).toBe(true);
    for (const q of ["how much did I spend on food?", "Its not safe spend", "make it 8k"]) expect(asksPlanOpinion(q), q).toBe(false);
  });

  it("answers from the month's figures, with a suggestion", () => {
    const words = planOpinion(trip, { asOf, month: { name: "December 2026", usual: 1_632_200, others: 0, income: 1_932_626 }, freeNow: 70_085, savings: 354_535 });
    expect(words).toContain("**Trip, ₱10,000.00, sometime in December 2026.**");
    expect(words).toContain("With this it comes to ₱26,322.00, against about ₱19,326.26 that usually comes in: ₱6,995.74 short.");
    expect(words).toContain("set aside about ₱5,000.00 a month for the next 2 months");
    expect(words).toContain("It is a want");
    expect(words).toContain(`say "don't count it"`);
    expect(words).toContain("lower it to about ₱3,000.00, which a usual December can spare");
    expect(words).toContain("Nothing is saved until you press Add to the planner.");
  });

  it("says it fits when it does", () => {
    const words = planOpinion({ ...trip, amount: 200_000 }, { asOf, month: { name: "December 2026", usual: 1_632_200, others: 0, income: 1_932_626 }, freeNow: 70_085, savings: 0 });
    expect(words).toContain("₱1,004.26 to spare");
    expect(words).toContain("It fits a usual December.");
  });
});

describe("a change is said to the card", () => {
  it("takes it out of safe to spend", () => {
    for (const s of ["Its not safe spend", "don't count it", "not counted in safe to spend", "leave it out of safe to spend"]) {
      const c = readPlanCardChange(s, trip, ctx);
      expect(c?.input.setAside, s).toBe(false);
      expect(c?.changed).toEqual(["not counted in safe to spend"]);
    }
    expect(readPlanCardChange("count it", { ...trip, setAside: false }, ctx)?.input.setAside).toBe(true);
  });

  it("changes the amount, the date, the name and the kind", () => {
    expect(readPlanCardChange("make it 8k", trip, ctx)?.input.amount).toBe(800_000);
    expect(readPlanCardChange("8000 instead", trip, ctx)?.input.amount).toBe(800_000);
    const day = readPlanCardChange("make it 8k on dec 20", trip, ctx);
    expect(day?.input.amount).toBe(800_000);
    expect(day?.input.due).toBe("2026-12-20");
    expect(day?.input.dueKind).toBe("day");
    expect(readPlanCardChange("no date yet", trip, ctx)?.input.due).toBe("9999-12-31");
    expect(readPlanCardChange("call it Baguio trip", trip, ctx)?.input.title).toBe("Baguio trip");
    expect(readPlanCardChange("it's a need", trip, ctx)?.input.need).toBe(true);
    expect(readPlanCardChange("pay it from gcash", trip, ctx)?.input.wallet).toBe("Gcash");
  });

  it("leaves other messages alone", () => {
    for (const s of ["how much did I spend on food this month?", "what do you think?", "thanks", "spent 150 on lunch from gcash yesterday at the mall with friends after class"]) expect(readPlanCardChange(s, trip, ctx), s).toBeNull();
  });
});
