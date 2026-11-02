/**
 * A plan said again that is on the Planner already (2 November 2026,
 * replaying the owner's 1 November chat on that day's backup).
 *
 * Invented plans shaped like the owner's: Tuition with no date, a blazer on
 * a day this month, keychains sometime next month, a trip with friends.
 */
import { describe, expect, it } from "vitest";

import { planOpinion } from "./planCard";
import { namesIt } from "./planIntent";
import { NO_DATE, type Plan } from "./planner";
import { alreadyPlannedWords, moveSaid, moveWords, planAskedAbout, planNamed, readPlannerAsk, titleWords } from "./plannerAsk";
import type { ReferenceLists } from "./types";

const asOf = "2026-11-01";
const P = (over: Partial<Plan> & Pick<Plan, "id" | "title" | "amount" | "due">): Plan => ({
  item: "",
  wallet: "",
  need: true,
  setAside: true,
  notes: "",
  status: "open",
  entryIds: [],
  moves: [],
  createdOn: "2026-10-20",
  createdBy: "owner",
  ...over,
});
const tuition = P({ id: "t", title: "Tuition", amount: 900_000, due: NO_DATE, dueKind: "none" });
const blazer = P({ id: "b", title: "Buy blazer", amount: 150_000, due: "2026-11-14" });
const gift = P({ id: "g", title: "Gift for the baby christening", amount: 100_000, due: "2026-11-07", setAside: false });
const keychains = P({ id: "k", title: "Keychains", amount: 250_000, due: "2026-12-31", dueKind: "month", need: false });
const trip = P({ id: "r", title: "Trip with friends to the mountains", amount: 200_000, due: "2026-11-08", need: false, setAside: false });
const plans = [tuition, blazer, gift, keychains, trip];
const reference: ReferenceLists = {
  wallets: ["Cash", "Gcash", "Maya"],
  savings: ["Maya Bank"],
  spendingTypes: [{ name: "School", remark: "" }, { name: "Gifts", remark: "" }],
  bills: [],
  subscriptions: [],
  revenueCategories: ["Allowance"],
  stopped: [],
} as unknown as ReferenceLists;
const ask = (t: string) => readPlannerAsk(t, { plans, reference, transactions: [], asOf });

describe("which plan a sentence names", () => {
  it("does not count small words: the blazer, not the gift for the baby", () => {
    // "for" and "the" made two hits against the blazer's one.
    expect(planNamed("plan the blazer 1500 for december, what do you think?", plans, ["open"])?.id).toBe("b");
    expect(titleWords("Gift for the baby christening")).toEqual(["gift", "baby", "christening"]);
    expect(titleWords("Buy blazer")).toEqual(["blazer"]);
  });

  it("keeps a title of small words only", () => {
    expect(titleWords("For the new")).toEqual(["for", "the", "new"]);
  });

  it("a verb or 'new' alone names nothing", () => {
    expect(namesIt("buy shoes", "Buy blazer")).toBe(false);
    expect(namesIt("I want a new laptop", "New phone")).toBe(false);
    expect(namesIt("a blazer next month", "Buy blazer")).toBe(true);
    expect(namesIt("my new phone", "New phone")).toBe(true);
  });
});

describe("moveSaid: another time said for a plan already there", () => {
  it("offers a month for a plan with no date", () => {
    expect(moveSaid(tuition, { due: "2026-12-31", kind: "month" }, asOf)).toEqual({ due: "2026-12-31", kind: "month" });
  });

  it("offers the day said when it is not the plan's day", () => {
    expect(moveSaid(tuition, { due: "2026-12-10", kind: "day" }, asOf)).toEqual({ due: "2026-12-10", kind: "day" });
    expect(moveSaid(blazer, { due: "2026-11-20", kind: "day" }, asOf)).toEqual({ due: "2026-11-20", kind: "day" });
  });

  it("a month said matches a plan on a day in that month", () => {
    expect(moveSaid(blazer, { due: "2026-11-30", kind: "month" }, asOf)).toBeNull();
    expect(moveSaid(blazer, { due: "2026-12-31", kind: "month" }, asOf)).toEqual({ due: "2026-12-31", kind: "month" });
  });

  it("nothing for its own time, no time, or a time gone", () => {
    expect(moveSaid(blazer, { due: "2026-11-14", kind: "day" }, asOf)).toBeNull();
    expect(moveSaid(keychains, { due: "2026-12-31", kind: "month" }, asOf)).toBeNull();
    expect(moveSaid(tuition, null, asOf)).toBeNull();
    expect(moveSaid(tuition, { due: NO_DATE, kind: "none" }, asOf)).toBeNull();
    expect(moveSaid(tuition, { due: "2026-10-20", kind: "day" }, asOf)).toBeNull();
  });

  it("a year said for a plan in another year", () => {
    expect(moveSaid(keychains, { due: "2027-12-31", kind: "year" }, asOf)).toEqual({ due: "2027-12-31", kind: "year" });
    expect(moveSaid(keychains, { due: "2026-12-31", kind: "year" }, asOf)).toBeNull();
  });
});

describe("what is said back", () => {
  it("says it is there, and how to change it, with no other time", () => {
    const words = alreadyPlannedWords(blazer, null);
    expect(words).toMatch(/^"Buy blazer" is on the Planner already: ₱1,500\.00 by November 14, 2026, so it is not added again\./);
    expect(words).toMatch(/move the buy blazer plan to/);
  });

  it("with another time, what pressing Move does", () => {
    const words = alreadyPlannedWords(tuition, { due: "2026-12-31", kind: "month" });
    expect(words).toMatch(/with no date yet, so it is not added again\. You said December 2026\. With no date it is counted nowhere now\. Press Move it to have it sometime in December 2026, and it is counted in December's safe to spend, or leave it as it is\./);
    expect(moveWords(tuition, { due: "2026-12-10", kind: "day" })).toMatch(/You said December 10, 2026\..*by December 10, 2026, and it is counted in safe to spend in December/);
  });

  it("a plan not counted is not said to be counted after a move", () => {
    expect(moveWords(trip, { due: "2026-12-31", kind: "month" })).not.toMatch(/counted in December/);
  });
});

describe("a question about a plan that does not say plan", () => {
  it("names it by its whole name, with no other price", () => {
    expect(planAskedAbout("Can I afford my tuition next month?", plans)?.id).toBe("t");
    expect(planAskedAbout("can I afford the keychains 2500 in december?", plans)?.id).toBe("k");
  });

  it("or by part of its name with its own price", () => {
    expect(planAskedAbout("I'm going to the mountains next week 2000, can I afford it?", plans)?.id).toBe("r");
  });

  it("not by part of its name alone, nor with another price", () => {
    expect(planAskedAbout("can I afford a trip?", plans)).toBeNull();
    expect(planAskedAbout("can I afford tuition 5000?", plans)).toBeNull();
    expect(planAskedAbout("can I afford a haircut?", plans)).toBeNull();
  });

  it("is read as asking for a view of that plan", () => {
    expect(ask("Can I afford my tuition next month?")).toMatchObject({ kind: "opinion", plan: { id: "t" } });
    expect(ask("can I afford the keychains 2500 in december?")).toMatchObject({ kind: "opinion", plan: { id: "k" } });
    expect(ask("plan the blazer 1500 for december, what do you think?")).toMatchObject({ kind: "opinion", plan: { id: "b" } });
  });

  it("leaves a question about anything else alone", () => {
    expect(ask("can I afford a haircut today?")).toBeNull();
    expect(ask("can I afford tuition 5000?")).toBeNull();
  });
});

describe("a view worked for the time asked about", () => {
  const facts = { asOf, month: { name: "December 2026", usual: 1_334_752, others: 250_000, income: 1_385_397 }, freeNow: 0, savings: 354_685 };
  const asked = { title: "Tuition", amount: 900_000, due: "2026-12-31", dueKind: "month" as const, item: "School", wallet: "", need: true, setAside: true, notes: "" };

  it("says where it would be and points at the Move card", () => {
    const words = planOpinion(asked, facts, { paid: 0, left: 900_000 }, { readAs: '"Tuition" is on the Planner with no date yet.', moved: true });
    expect(words).toMatch(/Moved there, it is counted in December's safe to spend/);
    expect(words).toMatch(/Press Move it below to move it there; until then it stays as it is on the Planner\./);
    expect(words).not.toMatch(/As it is/);
    // The month's sum: a usual month, its other plans, and this.
    expect(words).toMatch(/With this it comes to ₱24,847\.52, against about ₱13,853\.97 that usually comes in: ₱10,993\.55 short\./);
  });

  it("says the year when ready-by is in another year", () => {
    const words = planOpinion({ ...asked, title: "New laptop", amount: 4_000_000, due: "2027-12-31", dueKind: "year", need: false }, { ...facts, month: null });
    expect(words).toMatch(/To have it ready by December 2027, set aside/);
  });
});
