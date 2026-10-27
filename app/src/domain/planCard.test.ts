/**
 * Replies to a Planner card still waiting in the chat (owner, 27 October
 * 2026): "Before adding that what do you think?" and "Its not safe spend".
 */
import { describe, expect, it } from "vitest";
import { asksPlanOpinion, planOpinion, readPlanCardChange, wishOpinion } from "./planCard";
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
    expect(words).toContain("pay part from your savings (₱3,545.35)");
  });

  it("never suggests lowering a need, or a monthly amount for next month", () => {
    const tuition: PlanInput = { ...trip, title: "Tuition", amount: 900_000, due: "2026-11-15", dueKind: "day", item: "School", need: true };
    const words = planOpinion(tuition, { asOf, month: { name: "November 2026", usual: 1_632_200, others: 0, income: 1_932_626 }, freeNow: 70_085, savings: 354_535 });
    expect(words).not.toContain("lower it");
    expect(words).not.toContain("a month from now");
    expect(words).toContain("spend less on wants in November");
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

/*
 * A plan already on the Planner (27 October 2026 sweep): "what do you think
 * of my tuition plan?" fell to the month's summary, and an overdue plan read
 * as "next month".
 */
describe("an opinion on a plan already saved", () => {
  const registration: PlanInput = { title: "Motorcycle registration", amount: 180_000, due: "2026-10-22", item: "", wallet: "Cash", need: true, setAside: true, notes: "" };

  it("works from what is left, and says keep rather than add", () => {
    const words = planOpinion({ ...trip, need: true }, { asOf, month: { name: "December 2026", usual: 1_632_200, others: 0, income: 1_932_626 }, freeNow: 70_085, savings: 354_535 }, { paid: 400_000, left: 600_000 });
    expect(words).toContain("**Trip, ₱10,000.00, sometime in December 2026.** ₱4,000.00 is paid, ₱6,000.00 left. Here is how it looks.");
    expect(words).toContain("With this it comes to ₱22,322.00");
    expect(words).not.toContain("Add to the planner");
    expect(words).toMatch(/My suggestion: A usual December cannot cover it alone\. Keep it, and/);
    expect(words).toMatch(/"move the trip plan to january", "make the trip plan 8000"/);
  });

  it("an overdue one is this month's, held back now, never \"next month\"", () => {
    const words = planOpinion(registration, { asOf, month: null, freeNow: 30_085, savings: 354_535 }, { paid: 0, left: 180_000 });
    expect(words).toContain("- Its day has passed, so it is overdue. Safe to spend until the month ends is ₱300.85, ₱1,499.15 less than this.");
    expect(words).toContain("- As it is, it is counted in safe to spend: ₱1,800.00 is held back now, until it is paid.");
    expect(words).not.toMatch(/next month|from the 1st/);
    expect(words).toMatch(/spend less on wants in October/);
  });
});

/*
 * 27 October 2026, the owner: "I am asking a question, I said the ai knows if
 * I am asking or adding". A plan asked about with no price got "I need the
 * amount first"; it is answered now, and the price is asked only to add it.
 */
describe("an opinion asked before the price is known", () => {
  const phone: PlanInput = { title: "iPhone 18 Pro Max", amount: null, due: "2026-11-30", dueKind: "month", item: "", wallet: "", need: false, setAside: true, notes: "" };
  const facts = (spare: number) => ({ asOf, month: { name: "November 2026", usual: 1_632_200, others: 900_000, income: 2_532_200 + spare }, freeNow: 0, savings: 354_535 });
  it("answers with what the month can take, and asks the price only to add it", () => {
    const words = wishOpinion(phone, facts(-599_574));
    expect(words).toMatch(/^\*\*iPhone 18 Pro Max, sometime in November 2026\.\*\*/);
    expect(words).toContain("already ₱5,995.74 short before this");
    expect(words).toContain("A usual November has no room for it");
    expect(words).toContain("It is a want");
    expect(words).toContain("If you want it on the Planner, tell me the price");
    expect(words).not.toMatch(/I need the amount first/);
  });
  it("names the room a month has, and never PHP 0.00 of it", () => {
    expect(wishOpinion(phone, facts(1_500_000))).toContain("Up to about ₱15,000.00, a usual November can pay for it");
    // PHP 4.26 spare is no room, not "up to about PHP 0.00".
    const tiny = wishOpinion(phone, facts(426));
    expect(tiny).toContain("has no room for it");
    expect(tiny).not.toContain("₱0.00, a usual");
  });
  it("does not say they called it a need when they did not", () => {
    expect(wishOpinion({ ...phone, need: true }, facts(-1))).toContain("It reads as a need");
  });
  it("knows the questions that ask for a view", () => {
    for (const q of ["good idea?", "is it worth it", "should I buy it", "what do you think about it"]) expect(asksPlanOpinion(q), q).toBe(true);
  });
});

describe("the price said as a guess", () => {
  const phone: PlanInput = { title: "iPhone 18 Pro Max", amount: 10_000_000, due: "2026-11-30", dueKind: "month", item: "", wallet: "", need: false, setAside: true, notes: "" };
  it("is the price, and the same price again is said back, never a second card", () => {
    expect(readPlanCardChange("Probably 100k i think", phone, ctx)).toMatchObject({ changed: [], already: ["It is ₱100,000.00 on the card already."] });
    expect(readPlanCardChange("its around 95k", phone, ctx)).toMatchObject({ changed: ["amount ₱95,000.00"] });
    expect(readPlanCardChange("siguro 90k", phone, ctx)).toMatchObject({ changed: ["amount ₱90,000.00"] });
  });
});
