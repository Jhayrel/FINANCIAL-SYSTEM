/**
 * Plans said in passing: today's money or the Planner (planIntent.ts). Rows
 * are invented; 26 October 2026, a Monday, is the day.
 */
import { describe, expect, it } from "vitest";

import { addDays } from "./dates";
import { asksToPlan, costHint, dayFor, planLineIn, readPlanIntent, readPlanLine, thingToPlan, whenFor } from "./planIntent";
import { NO_DATE, planKinds, planWallets } from "./planner";
import type { ReferenceLists, Transaction } from "./types";

const asOf = "2026-10-26";
const reference: ReferenceLists = {
  wallets: ["Cash", "Gcash", "Maya"],
  savings: ["Maya Bank"],
  bills: ["Globe at Home Wifi", "Globe Postpaid"],
  subscriptions: ["Spotify", "Netflix"],
  revenueCategories: ["Allowance"],
  spendingTypes: ["Food", "Subscriptions", "Online Buy", "Unknown", "School", "Travel", "Repairs", "Treat"].map((name) => ({ name, remark: "" })),
  stopped: [{ name: "Netflix", since: "2026-09-27" }, { name: "Globe Postpaid", since: "2026-10-05" }],
};

let n = 0;
const spend = (date: string, item: string, description: string, amount: number): Transaction => {
  n += 1;
  return { id: `t${n}`, recordNumber: n, date, type: "Spending", fromWallet: "Cash", toWallet: "", category: "Spending", item, description, amount, fee: 0, total: amount, notes: "", status: "Paid" };
};
const ledger: Transaction[] = [
  // Food nearly every other day: everyday spending.
  ...Array.from({ length: 20 }, (_, i) => spend(addDays(asOf, -2 * i - 1), "Food", i % 3 === 0 ? "Turon in SM" : "Lunch", 10_000 + i * 500)),
  spend("2026-06-08", "School", "Paid tuition fee", 900_000),
  spend("2026-05-05", "School", "School tuition fee", 336_000),
  spend("2026-06-20", "Travel", "Contributed for roadtrip with cousins", 130_000),
  spend("2026-04-03", "Online Buy", "Laptop battery lazada", 309_936),
  spend("2026-05-23", "Repairs", "Phone repair", 393_100),
  spend("2026-01-29", "Online Buy", "phone load", 5_100),
  spend("2026-01-01", "Unknown", "The 2025 records closed Maya Goal (Buy Iphone) at", 150_238),
  // Online Buy is everyday too, which must not make a laptop everyday.
  ...Array.from({ length: 9 }, (_, i) => spend(addDays(asOf, -3 * i - 2), "Online Buy", "Shopee order", 20_000)),
];
const ctx = { reference, transactions: ledger, asOf, debtNames: ["Maya Credit", "Father"] };
const read = (text: string) => readPlanIntent(text, ctx);

describe("a plan for today is today's money (the owner's warning, 27 October 2026)", () => {
  it.each([
    ["I plan to buy goods today at the mall", "words"],
    ["I plan to buy food today at the mall", "words"],
    ["my plan today is to buy food at the mall", "words"],
    ["I plan to spend 1000 cash on dinner tonight", "words"],
    ["planning to buy groceries later", "words"],
    ["I'm going to buy food", "often"],
    ["I want to eat at jollibee", "words"],
  ])("%s", (text, why) => {
    expect(read(text)).toMatchObject({ kind: "today", why });
  });
});

describe("a plan for a later day goes on the Planner", () => {
  it("reads what, how much and by when", () => {
    expect(read("I'm planning a trip to Baguio on Dec 20, around 5000")).toMatchObject({
      kind: "later",
      title: "Trip to Baguio",
      amountSaid: true,
      dueSaid: true,
      plans: [{ title: "Trip to Baguio", amount: 500_000, due: "2026-12-20", item: "Travel", need: false }],
    });
    expect(read("we're planning a birthday party for mama on nov 20, 2500")).toMatchObject({ kind: "later", plans: [{ title: "Birthday party for mama", amount: 250_000, due: "2026-11-20" }] });
    expect(read("I plan to pay my motor registration on the 30th, 1800")).toMatchObject({ kind: "later", plans: [{ title: "Motor registration", amount: 180_000, due: "2026-10-30" }] });
    expect(read("I'm planning to pay my tuition next month, 9k")).toMatchObject({ kind: "later", plans: [{ title: "Tuition", amount: 900_000, due: "2026-11-30", item: "School", need: true }] });
    expect(read("I plan to buy shoes tomorrow 1500")).toMatchObject({ kind: "later", plans: [{ amount: 150_000, due: "2026-10-27" }] });
  });

  it("asks the amount when none is said, with what it cost before", () => {
    const trip = read("I am planning a trip next month");
    expect(trip).toMatchObject({ kind: "later", amountSaid: false, plans: [{ title: "Trip", amount: null, due: "2026-11-30" }] });
    if (trip?.kind === "later") expect(trip.hint).toMatch(/roadtrip/);
    // A laptop filed under Online Buy is not everyday because Online Buy is.
    expect(read("I'm planning to buy a laptop")).toMatchObject({ kind: "later", amountSaid: false, dueSaid: false });
    expect(read("I am planning to buy a new phone in 2027")).toMatchObject({ kind: "later", plans: [{ due: "2027-12-31" }] });
  });

  it("takes the thing from the first clause; a month with no day is that month, and no idea when is no date (owner, 27 October 2026)", () => {
    expect(read("I plan to pay my tuition next month but the date is unknown")).toMatchObject({
      kind: "later",
      title: "Tuition",
      amountSaid: false,
      plans: [{ title: "Tuition", amount: null, due: "2026-11-30", dueKind: "month", item: "School" }],
    });
    expect(read("I plan to pay my tuition next month, 9k, not sure when exactly")).toMatchObject({ kind: "later", plans: [{ amount: 900_000, due: "2026-11-30", dueKind: "month" }] });
    // Nothing said, or "no idea when": no date at all, never a day picked for them.
    expect(read("I'm planning to buy a laptop, no idea when")).toMatchObject({ kind: "later", dueSaid: false, plans: [{ due: NO_DATE, dueKind: "none" }] });
    expect(read("I'm planning a trip to Baguio, 5000")).toMatchObject({ kind: "later", dueSaid: false, plans: [{ amount: 500_000, due: NO_DATE, dueKind: "none" }] });
    expect(read("I'm planning a trip to Baguio in December, 5000")).toMatchObject({ kind: "later", plans: [{ due: "2026-12-31", dueKind: "month" }] });
    expect(read("I'm planning a trip to Baguio on Dec 20, 5000")).toMatchObject({ kind: "later", plans: [{ due: "2026-12-20", dueKind: "day" }] });
    expect(read("I am planning to buy a new phone next year, 25k")).toMatchObject({ kind: "later", plans: [{ due: "2027-12-31", dueKind: "year" }] });
  });

  it("reads how much of the date is known", () => {
    expect(whenFor("by nov 15", asOf)).toEqual({ due: "2026-11-15", kind: "day" });
    expect(whenFor("tomorrow", asOf)).toEqual({ due: "2026-10-27", kind: "day" });
    expect(whenFor("on friday", asOf)).toEqual({ due: "2026-10-30", kind: "day" });
    expect(whenFor("next month", asOf)).toEqual({ due: "2026-11-30", kind: "month" });
    expect(whenFor("in december", asOf)).toEqual({ due: "2026-12-31", kind: "month" });
    expect(whenFor("in 2 months", asOf)).toEqual({ due: "2026-12-31", kind: "month" });
    expect(whenFor("in 2027", asOf)).toEqual({ due: "2027-12-31", kind: "year" });
    expect(whenFor("no idea when", asOf)).toBeNull();
    expect(whenFor("nothing said", asOf)).toBeNull();
  });

  it("says it was asked too, so the question is answered first", () => {
    expect(read("I plan to spend 3000 on a trip next month, what budget should I set?")).toMatchObject({ kind: "later", asked: true, plans: [{ amount: 300_000 }] });
  });
});

describe("what is not this reader's", () => {
  it.each([
    "I paid 500 for food at the mall",
    "I bought a laptop yesterday 35000",
    "I'm going to receive my allowance tomorrow",
    "I'm saving for a new phone",
    "I'm going to pay my Maya Credit on the 5th",
    "I'm going to pay Globe at Home Wifi tomorrow",
    "I plan to set my budget to 12000",
    "food 150 cash",
    "what is planned?",
    "I'm going to sleep",
  ])("%s", (text) => {
    expect(read(text)).toBeNull();
  });
});

describe("add it as a plan", () => {
  it.each(["Can you add it as a plan for now", "can you add it to my planner", "add the tuition as a plan", "put that on the planner", "plan it", "make it a plan"])("%s", (text) => {
    expect(asksToPlan(text)).toBe(true);
  });
  it.each(["can you set a plan?", "make a budget plan for november", "what is planned?", "I plan to buy food today"])("not: %s", (text) => {
    expect(asksToPlan(text)).toBe(false);
  });
  it("names the thing when it is said", () => {
    expect(thingToPlan("add the tuition as a plan")).toBe("tuition");
    expect(thingToPlan("add it as a plan")).toBe("");
  });
});

describe("the days", () => {
  it("reads weekdays, the weekend, a year and Christmas", () => {
    expect(dayFor("on friday", asOf)).toBe("2026-10-30");
    expect(dayFor("this weekend", asOf)).toBe("2026-10-31");
    expect(dayFor("next year", asOf)).toBe("2027-12-31");
    expect(dayFor("for christmas", asOf)).toBe("2026-12-25");
    expect(dayFor("nothing said", asOf)).toBeNull();
  });
});

describe("the hint", () => {
  it("leaves out small change and the app's own rows", () => {
    const hint = costHint("new phone", "", ctx);
    expect(hint).toMatch(/Phone repair/);
    expect(hint).not.toMatch(/phone load|records closed/);
  });
});

describe("a Plan line from the model", () => {
  it("is read into a plan", () => {
    const line = planLineIn("November needs PHP 25,322.00.\nPlan: Tuition, PHP 9,000.00, by 2026-11-15");
    expect(line).toBe("Tuition, PHP 9,000.00, by 2026-11-15");
    expect(readPlanLine(line, ctx)).toMatchObject({ title: "Tuition", amount: 900_000, due: "2026-11-15", item: "School" });
    expect(readPlanLine("Trip, by 2026-12-20", ctx)).toBeNull();
    expect(readPlanLine("Tuition, PHP 9,000.00, in November 2026", ctx)).toMatchObject({ due: "2026-11-30", dueKind: "month" });
    expect(readPlanLine("New phone, PHP 25,000.00, in 2027", ctx)).toMatchObject({ amount: 2_500_000, due: "2027-12-31", dueKind: "year" });
    expect(readPlanLine("Trip, PHP 5,000.00, no date yet", ctx)).toMatchObject({ amount: 500_000, due: NO_DATE, dueKind: "none" });
    expect(readPlanLine("Tuition, PHP 9,000.00, by 2026-01-15", ctx)).toBeNull();
  });
});

describe("the Kind and Pay from lists (owner, 27 October 2026: 'why its a mixed')", () => {
  it("groups the kinds as the Add form files spending, without Unknown or stopped ones", () => {
    const k = planKinds(reference);
    expect(k.options).toEqual(["Food", "Subscriptions", "Online Buy", "School", "Travel", "Repairs", "Treat", "Globe at Home Wifi", "Spotify"]);
    expect(k.groups).toMatchObject({ Food: "Spending", "Globe at Home Wifi": "Bills", Spotify: "Subscriptions" });
    // A kind the plan already has is kept, so editing never loses it.
    expect(planKinds(reference, "Netflix").groups.Netflix).toBe("This plan's");
  });
  it("groups where it is paid from", () => {
    expect(planWallets(reference, "Phone fund")).toEqual({
      options: ["Cash", "Gcash", "Maya", "Maya Bank", "Phone fund"],
      groups: { Cash: "Spending wallets", Gcash: "Spending wallets", Maya: "Spending wallets", "Maya Bank": "Savings", "Phone fund": "Goal" },
    });
  });
});
