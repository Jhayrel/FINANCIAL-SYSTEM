/**
 * The owner's hard question, 10 November 2026: "If I pay my Globe wifi and
 * keep going to the gym twice a week, can I still afford the 2,000
 * keychains in December without touching my Maya Bank savings? Show me how
 * you worked it out, and what I should cut if it's not enough." It never
 * reached the plan's own answer (46 words; "can I still afford"), and both
 * model answers paid December's plan from today's wallets. Every figure
 * here is invented.
 */
import { describe, expect, it } from "vitest";

import { billNamed } from "./billsAsk";
import { planOpinion, type PlanOpinionFacts } from "./planCard";
import { makePlan, type PlanInput } from "./planner";
import { readPlannerAsk } from "./plannerAsk";

const ASOF = "2026-11-10";
const DASH = String.fromCharCode(0x2014);
const input: PlanInput = { title: "Keychains", amount: 250_000, due: "2026-12-31", dueKind: "month", item: "Online Buy", wallet: "Cash", need: false, setAside: true, notes: "" };
const plan = makePlan(input, ASOF, "owner", "p-keys");
const hard = "If I pay my Globe wifi and keep going to the gym twice a week, can I still afford the 2,500 keychains in December without touching my Maya Bank savings? Show me how you worked it out, and what I should cut if it's not enough.";

describe("the question reaches the plan's own answer", () => {
  const reference = { wallets: ["Cash"], savings: ["Maya Bank"], spendingTypes: [{ name: "Online Buy", remark: "" }], bills: ["Globe at Home Wifi"], subscriptions: [], revenueCategories: [] } as never;
  it("however long, with \"still\"", () => {
    expect(readPlannerAsk(hard, { plans: [plan], reference, transactions: [], asOf: ASOF })).toMatchObject({ kind: "opinion", plan: { id: "p-keys" } });
    expect(readPlannerAsk("can I really afford the keychains plan?", { plans: [plan], reference, transactions: [], asOf: ASOF })?.kind).toBe("opinion");
  });
  it("finds the bill it names by its own word", () => {
    expect(billNamed(hard, ["Globe at Home Wifi", "Spotify"])).toBe("Globe at Home Wifi");
    expect(billNamed("my home stuff", ["Globe at Home Wifi"])).toBeNull();
  });
});

describe("December worked out with what carries over, the conditions, and a want to trim", () => {
  const facts: PlanOpinionFacts = {
    asOf: ASOF,
    month: { name: "December 2026", usual: 1_000_000, others: 0, income: 1_200_000 },
    freeNow: 60_000,
    savings: 400_000,
    carry: 60_000,
    keepSavings: true,
    askedCut: true,
    conditions: ["Globe at Home Wifi, ₱1,099.00, due November 12, 2026, is already held back in safe to spend, so paying it changes nothing here.", "The Gym allocation has ₱400.00 left this month and is already set aside: at ₱80.00 a time that is 5 more, so it does not come out of this."],
    wants: [
      { name: "Treat", usual: 150_000 },
      { name: "Fun", usual: 80_000 },
    ],
  };
  const words = planOpinion(input, facts, { paid: 0, left: 250_000 });

  it("says December alone is short, and what carries over covers it", () => {
    expect(words).toContain("- December 2026: a usual month costs ₱10,000.00. With this it comes to ₱12,500.00, against about ₱12,000.00 that usually comes in: ₱500.00 short.");
    expect(words).toContain("- If nothing more is spent before November ends, the ₱600.00 free now carries into December 2026 and covers it, with ₱100.00 to spare.");
  });
  it("starts from what the question set: the bill and the allocation are held already", () => {
    expect(words).toContain("- Globe at Home Wifi, ₱1,099.00, due November 12, 2026, is already held back in safe to spend");
    expect(words).toContain("- The Gym allocation has ₱400.00 left this month and is already set aside");
  });
  it("leaves the savings out everywhere, as asked", () => {
    expect(words).toContain("- Your savings stay out of it, as you asked: none of this counts on them.");
    expect(words).not.toMatch(/Paid from savings|pay it from your savings|pay part from your savings|Your savings hold/);
  });
  it("names a want to trim, never a need, and says yes with care", () => {
    expect(words).toContain("- Not to lean on what carries over, trim Treat (usually ₱1,500.00 a month, a want) by ₱500.00 in December.");
    expect(words).toMatch(/My suggestion: Yes, with care: December is ₱500\.00 short on its own, and what is free now covers that if it carries over\. Keep it, spend only what you must until November ends, or trim Treat by ₱500\.00 in December\./);
    expect(words).not.toContain(DASH);
  });
  it("still short after the carry-over: says how much, and trims by that", () => {
    const tight = planOpinion(input, { ...facts, carry: 20_000, freeNow: 20_000 }, { paid: 0, left: 250_000 });
    expect(tight).toContain("- Even with the ₱200.00 free now carried over, if nothing more is spent before November ends, December 2026 is still ₱300.00 short.");
    expect(tight).toContain("- To close it, trim Treat (usually ₱1,500.00 a month, a want) by ₱300.00 in December.");
  });
});

describe("\"if I pay my wifi\" is not a payday", async () => {
  const { readBridgeAsk } = await import("./bridgeAsk");
  it("reads pay as income only as a noun, and an amount never as a day", () => {
    expect(readBridgeAsk(hard, ASOF)).toBeNull();
    expect(readBridgeAsk("I need to pay the rent before the 15th, is that enough?", ASOF)).toBeNull();
    // Still a payday when it is one.
    expect(readBridgeAsk("my pay comes on the 15th, will my money last until then?", ASOF)).toMatchObject({ arrives: "2026-11-15", what: "pay" });
    expect(readBridgeAsk("salary on the 30th, can I make it until then?", ASOF)?.arrives).toBe("2026-11-30");
    expect(readBridgeAsk("next pay on december 2, is my money enough until then?", ASOF)?.arrives).toBe("2026-12-02");
  });
});

describe("savings left out means left out everywhere", () => {
  it("no line of the answer counts on them", () => {
    const facts: PlanOpinionFacts = { asOf: ASOF, month: { name: "December 2026", usual: 1_000_000, others: 0, income: 1_200_000 }, freeNow: 60_000, savings: 400_000, carry: 60_000, keepSavings: true };
    const words = planOpinion(input, facts, { paid: 0, left: 250_000 });
    expect(words).toContain("- It is next month, so it comes out of next month's money.");
    expect(words).not.toMatch(/savings or borrowing|pay it from savings|or your savings/i);
  });
});
