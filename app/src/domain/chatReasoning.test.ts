/**
 * The owner's screenshots of 9 and 10 November 2026, each a reasoning fault:
 * "a trend of my bad spending" drew every peso; "Vs june" set nine days of
 * November against all of June; "pie of my unnecessary expenses this month"
 * redrew the chart before it; a plan saved as "Motorcylce" was never found
 * by "motorcycle". Every figure here is invented.
 */
import { describe, expect, it } from "vitest";

import { buildChart, comparedPeriods, drawsBack, fairPair, periodsSaid, versusPair } from "./charts";
import { oneOff, planNamed } from "./plannerAsk";
import { makePlan, NO_DATE } from "./planner";
import { asKinds, kindsNote, necessityAsked } from "./wantsAsk";
import type { Transaction } from "./types";

const ASOF = "2026-11-09";
let n = 0;
const spend = (date: string, amount: number, item: string, description = ""): Transaction =>
  ({ id: `t${(n += 1)}`, recordNumber: n, date, type: "Spending", fromWallet: "Cash", toWallet: "", category: "Spending", item, description, amount, fee: 0, total: amount, notes: "", status: "Paid" }) as Transaction;

const types = [
  { name: "Food", necessity: "essential" as const },
  { name: "Treat", necessity: "discretionary" as const },
  { name: "Self Care", necessity: "discretionary" as const },
  { name: "Gas", necessity: "essential" as const },
  { name: "Gift" },
];

describe("bad spending is the owner's wants", () => {
  it("reads the words, and names the kinds the owner marked", () => {
    for (const q of ["a trend of my bad spending", "pie of my unnecessary expenses this month", "my impulse purchases", "spending on wants", "luho ko this month"]) {
      expect(necessityAsked(q)?.label, q).toBe("Wants");
    }
    expect(necessityAsked("my essential spending")?.label).toBe("Needs");
    expect(necessityAsked("how much did I spend on food")).toBeNull();
    // "I want" is not wants.
    expect(necessityAsked("I want a pie of my spending")).toBeNull();
    const k = asKinds("a trend of my bad spending this year", types)!;
    expect(k.kinds).toEqual(["Treat", "Self Care"]);
    expect(k.text).toBe("a trend of my Treat and Self Care spending this year");
    expect(kindsNote(k.label, k.kinds, k.unmarked)).toBe("Wants: the kinds marked Discretionary in Settings, Categories (Treat, Self Care). 1 kind is not marked either way and left out.");
  });

  it("draws only those kinds; a two-word kind is not read as a word to search for", () => {
    const rows = [spend("2026-11-02", 30_000, "Food"), spend("2026-11-03", 12_000, "Treat"), spend("2026-11-04", 8_000, "Self Care", "haircut"), spend("2026-10-04", 1_500, "Food", "self service")];
    const chart = buildChart(asKinds("pie of my bad spending this month", types)!.text, rows, ASOF)!;
    expect(chart.total).toBe(20_000);
    expect(chart.rows.map((r) => r.label).sort()).toEqual(["Self Care", "Treat"]);
  });

  it("nothing marked: no kinds, so nothing is drawn as wants", () => {
    expect(asKinds("my bad spending", [{ name: "Food" }])?.kinds).toEqual([]);
  });
});

describe("a month still running against a whole month (Vs june)", () => {
  it("is set against the same days of it", () => {
    const pair = versusPair("Vs june", "Spending by item, November 2026", ASOF)!;
    expect(pair.now).toEqual({ from: "2026-11-01", to: "2026-11-09", name: "November 2026 so far, the 1st to the 9th" });
    expect(pair.before).toEqual({ from: "2026-06-01", to: "2026-06-09", name: "the same days of June 2026" });
    expect(comparedPeriods("compare november and june", ASOF)?.before.to).toBe("2026-06-09");
    expect(periodsSaid("November 2026", "June 2026", ASOF)?.before.name).toBe("the same days of June 2026");
  });

  it("two months that have ended are compared whole", () => {
    expect(comparedPeriods("compare september and august", ASOF)).toEqual({
      now: { from: "2026-09-01", to: "2026-09-30", name: "September 2026" },
      before: { from: "2026-08-01", to: "2026-08-31", name: "August 2026" },
    });
    const ended = { now: { from: "2026-10-01", to: "2026-10-31", name: "October 2026" }, before: { from: "2026-06-01", to: "2026-06-30", name: "June 2026" } };
    expect(fairPair(ended, ASOF)).toEqual(ended);
  });

  it("\"vs\" needs a window and a chart window; a named comparison is left to its own reader", () => {
    expect(versusPair("show june", "Spending by item, November 2026", ASOF)).toBeNull();
    expect(versusPair("vs last month", "Spending by item, November 2026", ASOF)).toBeNull();
    expect(versusPair("vs june", "Spending", ASOF)).toBeNull();
  });

  it("the fair figures, side by side", () => {
    const rows = [spend("2026-06-03", 50_000, "Food"), spend("2026-06-20", 900_000, "School"), spend("2026-11-03", 40_000, "Food")];
    const chart = buildChart("Vs june by item", rows, ASOF, undefined, versusPair("Vs june", "Spending by item, November 2026", ASOF))!;
    expect(chart.total).toBe(40_000);
    expect(chart.against?.total).toBe(50_000);
  });
});

describe("pointing back, and not", () => {
  it("\"this month\" is a time, and \"of my ...\" names its own subject", () => {
    expect(drawsBack("pie of my unnecessary expenses this month")).toBeNull();
    expect(drawsBack("show this month as a pie")).toBeNull();
    expect(drawsBack("show that as a pie")).toBe("pie");
    expect(drawsBack("can you show that in chart?")).toBe("chart");
    expect(drawsBack("let see it in trend")).toBe("trend");
  });
});

describe("a plan named with a letter off", () => {
  const plans = [
    makePlan({ title: "Motorcylce setup and repair", amount: 2_500_000, due: NO_DATE, item: "Repairs", wallet: "Cash", need: false, setAside: false, notes: "" }, ASOF, "owner", "p1"),
    makePlan({ title: "Keychains", amount: 150_000, due: "2026-12-31", item: "Online Buy", wallet: "Cash", need: false, setAside: true, notes: "" }, ASOF, "owner", "p2"),
  ];
  it("is found by the word as the owner spells it today", () => {
    expect(planNamed("Can I afford now the plan for motorcycle upgrade?", plans, ["open"])?.id).toBe("p1");
    expect(planNamed("is the keychain plan affordable", plans, ["open"])?.id).toBe("p2");
    expect(planNamed("how much is the bicycle", plans, ["open"])).toBeNull();
  });
  it("one letter off, long words only", () => {
    expect(oneOff("motorcycle", "motorcylce")).toBe(true);
    expect(oneOff("tuition", "tution")).toBe(true);
    expect(oneOff("food", "good")).toBe(false);
    expect(oneOff("repair", "repeal")).toBe(false);
  });
});

describe("how long the money lasts (9 November 2026 sweep)", async () => {
  const { asksRunway, recentPace, runwayWords } = await import("./runwayAsk");
  it("reads the question", () => {
    for (const q of ["how long will my money last", "how long can I survive with my money", "when will I run out of money", "hanggang kailan pera ko", "how many days will my cash last"]) expect(asksRunway(q), q).toBe(true);
    for (const q of ["how long did I go without spending", "how much money do I have"]) expect(asksRunway(q), q).toBe(false);
  });
  it("works it out from what is not already due, at the last 30 days' pace", () => {
    const rows = [spend("2026-10-20", 60_000, "Food"), spend("2026-11-01", 30_000, "Food"), row("2026-11-02", 99_900)];
    function row(date: string, amount: number): Transaction {
      return { ...spend(date, amount, "Wifi"), category: "Bills" } as Transaction;
    }
    expect(recentPace(rows, ASOF)).toBe(3_000);
    const words = runwayWords({ wallets: 200_000, reservedBills: 50_000, reservedDebt: 0, reservedPlans: 0, reservedAllocations: 40_000, safe: 110_000, perDay: 5_000, daysLeft: 22 }, 3_000, ASOF);
    expect(words).toContain("Your spending wallets hold ₱2,000.00; ₱500.00 of it is still due for bills, which leaves ₱1,500.00 for day-to-day spending, your allocations included.");
    expect(words).toContain("At your pace of the last 30 days, ₱30.00 a day, that lasts about 50 days, to December 28, 2026. That is past the month's end on November 30, 2026, 22 days from today.");
    const short = runwayWords({ wallets: 60_000, reservedBills: 20_000, reservedDebt: 0, reservedPlans: 0, reservedAllocations: 0, safe: 40_000, perDay: 1_818, daysLeft: 22 }, 5_000, ASOF);
    expect(short).toContain("lasts about 8 days, to November 16, 2026. That is 14 days short of the month's end on November 30, 2026, unless money comes in or the pace slows.");
    expect(short).toContain("To reach November 30, 2026, day-to-day spending would have to be ₱18.18 a day.");
  });
});

describe("a bill named by any word of its own (did I pay my wifi)", async () => {
  const { readBillsAsk } = await import("./billsAsk");
  it("finds Globe at Home Wifi by \"wifi\", never by \"home\"", () => {
    expect(readBillsAsk("did I pay my wifi this month", ["Globe at Home Wifi", "Spotify"])).toEqual({ name: "Globe at Home Wifi", week: false });
    expect(readBillsAsk("did I pay my globe", ["Globe at Home Wifi", "Spotify"])).toEqual({ name: "Globe at Home Wifi", week: false });
    expect(readBillsAsk("did I pay home stuff", ["Globe at Home Wifi"])?.name ?? null).toBeNull();
  });
});

describe("wants against needs, by the owner's marks", async () => {
  const { asksBoth, buildNecessityChart, necessitySplit, necessityWords, necessityAsked } = await import("./wantsAsk");
  const rows = [spend("2026-11-02", 30_000, "Food"), spend("2026-11-03", 12_000, "Treat"), spend("2026-11-04", 8_000, "Self Care"), spend("2026-11-05", 5_000, "Gift"), { ...spend("2026-11-06", 99_900, "Wifi"), category: "Bills" } as Transaction];
  it("splits day-to-day spending, bills apart, unmarked said", () => {
    const split = necessitySplit(rows, "2026-11-01", "2026-11-30", types);
    expect([split.needs, split.wants, split.emergency, split.unmarked]).toEqual([30_000, 20_000, 0, 5_000]);
    const chart = buildNecessityChart(split, "November 2026")!;
    expect(chart.rows.map((r) => [r.label, r.value])).toEqual([["Needs", 30_000], ["Wants", 20_000], ["Not marked", 5_000]]);
    const words = necessityWords(split, "November 2026");
    expect(words).toContain("**Day-to-day spending in November 2026: ₱550.00.**");
    expect(words).toContain("- Wants: ₱200.00, 36% (Treat ₱120.00, Self Care ₱80.00)");
    expect(words).toContain("- Not marked either way: ₱50.00 (Gift ₱50.00).");
  });
  it("reads both, and \"bad stuff\" as wants", () => {
    expect(asksBoth("how much did I spend on wants vs needs this month")).toBe(true);
    expect(asksBoth("chart my needs vs wants")).toBe(true);
    expect(asksBoth("I want to know what I need")).toBe(false);
    expect(necessityAsked("how much did I spend on bad stuff")?.label).toBe("Wants");
  });
});

describe("which day of the week", async () => {
  const { asksWeekday, buildWeekdayChart, weekdaySplit, weekdayWords } = await import("./weekdayAsk");
  it("reads the question, and adds up each day of the week", () => {
    for (const q of ["which day do I spend the most", "what day of the week do I spend most", "spending by weekday"]) expect(asksWeekday(q), q).toBe(true);
    expect(asksWeekday("biggest spending day this month")).toBe(false);
    // Saturdays 7 and 14 November, a Monday the 9th.
    const rows = [spend("2026-11-07", 50_000, "Treat"), spend("2026-11-14", 30_000, "Treat"), spend("2026-11-09", 10_000, "Food")];
    const split = weekdaySplit(rows, "2026-11-01", "2026-11-14");
    expect(split.total).toBe(90_000);
    const chart = buildWeekdayChart(split, "the first two weeks")!;
    // Largest first, the rest in the week's order.
    expect(chart.rows.map((r) => r.label)).toEqual(["Saturday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Sunday"]);
    expect(weekdayWords(split, "the first two weeks")).toMatch(/^\*\*Saturday is the day you spend the most: ₱800\.00 over the first two weeks, 89% of day-to-day spending, ₱400\.00 a Saturday on average\.\*\*/);
  });
});

describe("safe to spend asked in Filipino", async () => {
  const { asksSafeToSpend } = await import("./safeAsk");
  it("may pera pa ba ako", () => {
    for (const q of ["may pera pa ba ako", "may natitira pa ba", "magkano pa pwede kong gastusin", "kaya ko pa ba gumastos"]) expect(asksSafeToSpend(q), q).toBe(true);
    expect(asksSafeToSpend("may pera ako sa gcash 500")).toBe(false);
  });
});

describe("picking one thing out", async () => {
  const { asksBiggestDay, asksDearest, dearestWords, eitherAsked, eitherWords } = await import("./pickAsk");
  const rows = [spend("2026-11-02", 30_000, "Food", "groceries"), spend("2026-11-03", 12_000, "Treat", "milk tea"), spend("2026-11-03", 4_000, "Treat"), spend("2026-11-05", 45_000, "Food", "party")];
  const month = { from: "2026-11-01", to: "2026-11-30", name: "November 2026" };
  it("reads each question, and leaves the others alone", () => {
    expect(asksBiggestDay("biggest spending day this month")).toBe(true);
    expect(asksBiggestDay("which date did I spend the most in october")).toBe(true);
    expect(asksBiggestDay("which day do I spend the most")).toBe(false);
    expect(asksDearest("what's my most expensive purchase this month")).toBe(true);
    expect(asksDearest("what's my biggest expense this month")).toBe(false);
    expect(eitherAsked("did I spend more on food or treats this month", ["Food", "Treat", "Gas"])).toEqual(["Food", "Treat"]);
    expect(eitherAsked("is gas more than food this year", ["Food", "Treat", "Gas"])).toEqual(["Gas", "Food"]);
    expect(eitherAsked("should I buy food or save", ["Food", "Treat"])).toBeNull();
  });
  it("answers with the app's own sums", () => {
    expect(eitherWords(["Food", "Treat"], rows, month)).toBe("**More on Food in November 2026: ₱590.00 more.** Food ₱750.00 over 2 entries; Treat ₱160.00 over 2 entries.");
    expect(dearestWords(rows, month)).toMatch(/^\*\*The most expensive in November 2026: #\d{4} Food, party: ₱450\.00 on November 5, 2026\.\*\* Then #\d{4} Food, groceries: ₱300\.00 on November 2, 2026; #\d{4} Treat, milk tea: ₱120\.00 on November 3, 2026\.$/);
  });
});
