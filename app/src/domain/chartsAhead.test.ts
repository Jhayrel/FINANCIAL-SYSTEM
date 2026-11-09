/**
 * "Can you show that in chart?" after a forecast, the months ahead drawn,
 * allocations and safe to spend drawn, and "how many sessions are left"
 * answered on the device. The owner, 9 November 2026: a gym question, then
 * "can you show me a prediction next month?", then "can you show that in
 * chart?", which drew the gym's spending over the whole ledger; and the gym
 * question itself, answered "6 sessions left, but ... 6 sessions remaining".
 * Every figure here is invented.
 */
import { describe, expect, it } from "vitest";

import { asksTimesLeft, allocationWords, rateSaid, timesWords } from "./allocationAsk";
import {
  asksForecast,
  buildAllocationChart,
  buildForecastChart,
  buildMeasureChart,
  buildSafeChart,
  chartHelps,
  chartReading,
  forecastEmptyWords,
  forecastMonths,
  localHint,
  measureOf,
} from "./chartAsk";
import { chartAsText, chartInWords } from "./charts";
import { asksNothing, questionMeant } from "./drawBack";
import { makeAllocation, monthAllocations } from "./monthAllocation";
import { outlookAhead } from "./outlook";
import type { Transaction } from "./types";

const DASH = String.fromCharCode(0x2014);

let n = 0;
const row = (date: string, amount: number, over: Partial<Transaction> = {}): Transaction =>
  ({
    id: `t${(n += 1)}`,
    recordNumber: n,
    date,
    type: "Spending",
    fromWallet: "Cash",
    toWallet: "",
    category: "Spending",
    item: "Food",
    description: "",
    amount,
    fee: 0,
    total: amount,
    notes: "",
    status: "Paid",
    ...over,
  }) as Transaction;

/** Six months, May to October 2026: food, a treat, a bill, and an allowance coming in. */
const ledger: Transaction[] = [];
for (const m of ["05", "06", "07", "08", "09", "10"]) {
  ledger.push(row(`2026-${m}-03`, 300_000, { item: "Food" }));
  ledger.push(row(`2026-${m}-10`, 100_000, { item: "Treat" }));
  ledger.push(row(`2026-${m}-12`, 99_900, { item: "Wifi", category: "Bills" }));
  ledger.push(row(`2026-${m}-01`, 800_000, { type: "Revenue", category: "Revenue", item: "Allowance", fromWallet: "", toWallet: "Cash" }));
}
const ASOF = "2026-11-09";

describe("which question \"that\" means", () => {
  const said = ["I go gym twice a week, how many sessions left?", "can you show me a prediction next month?"];

  it("is the question just asked, not one before it (owner, 9 November 2026)", () => {
    expect(questionMeant([...said].reverse(), "can you show that in chart?")).toBe("can you show me a prediction next month?");
  });

  it("skips a shape said alone, a thanks and an ok, and nothing else", () => {
    expect(questionMeant(["pie", "thanks", "ok", "where did my money go this month?", "gym left"], "show it as bars")).toBe("where did my money go this month?");
    expect(questionMeant(["how much can I spend today", "where did my money go?"], "chart it")).toBe("how much can I spend today");
    expect(questionMeant([], "chart that")).toBeNull();
    expect(asksNothing("Thank you po")).toBe(true);
    expect(asksNothing("nice")).toBe(true);
    expect(asksNothing("nice, what about food?")).toBe(false);
  });
});

describe("a forecast asked for", () => {
  it("reads the words for the months ahead", () => {
    for (const q of ["can you show me a prediction next month?", "forecast for December", "what will I spend next month", "projected spending for the next 3 months", "predict my expenses"]) {
      expect(asksForecast(q), q).toBe(true);
      expect(measureOf(localHint(q)), q).toBe("forecast");
    }
    // Setting a budget from it is a budget card, and a habit asked about is not a month to come.
    for (const q of ["use the forecast", "set my budget to the forecast", "what is my usual month like", "how much did I spend on food"]) {
      expect(asksForecast(q), q).toBe(false);
    }
  });

  it("knows which months: next by default, named ones at their next coming, runs, and ones gone", () => {
    const at = (i: number): string => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
    const months = (q: string): string[] | "past" => {
      const r = forecastMonths(q, ASOF);
      return r === "past" ? r : r.map(at);
    };
    expect(months("a prediction next month")).toEqual(["2026-12"]);
    expect(months("forecast for december")).toEqual(["2026-12"]);
    expect(months("forecast for march")).toEqual(["2027-03"]);
    expect(months("forecast for the next 3 months")).toEqual(["2026-12", "2027-01", "2027-02"]);
    expect(months("forecast for the coming months")).toEqual(["2026-12", "2027-01", "2027-02"]);
    expect(months("forecast december to february")).toEqual(["2026-12", "2027-01", "2027-02"]);
    expect(months("forecast for the rest of the year")).toEqual(["2026-12"]);
    expect(months("forecast for next year")).toHaveLength(12);
    expect(months("forecast for november")).toEqual(["2026-11"]);
    // October said in November is the October just gone, which has no forecast.
    expect(months("forecast for october")).toBe("past");
    expect(forecastEmptyWords("forecast for october", ASOF)).toMatch(/has ended/);
  });

  it("draws next month by item, the Budget screen's own figures, adding up to its total", () => {
    const chart = buildForecastChart("can you show me a prediction next month?", ledger, {}, ASOF)!;
    const budgetScreen = outlookAhead(ledger, {}, ASOF, 1)[0]!;
    expect(chart.title).toBe("December 2026 forecast by item");
    expect(chart.measure).toBe("forecast");
    expect(chart.total).toBe(budgetScreen.total);
    expect(chart.rows.reduce((s, r) => s + r.value, 0)).toBe(chart.total);
    expect(chart.plan).toMatchObject({ income: budgetScreen.income, left: budgetScreen.left, name: "December 2026" });
    expect(chart.rows.map((r) => r.label)).toEqual(expect.arrayContaining(["Food", "Treat", "Wifi"]));
    // No entries behind a forecast, so none are claimed.
    expect(chart.rows.every((r) => r.count === 0)).toBe(true);
    const reading = chartReading(chart);
    expect(reading).toMatch(/^December 2026 should cost about PHP [\d,.]+, going by your usual month; Food is the largest/);
    expect(reading).toMatch(/A usual month brings in PHP 8,000\.00, which leaves about PHP/);
    expect(reading).not.toContain(DASH);
    expect(chartInWords(chart)).toMatch(/From your usual month over /);
  });

  it("draws several months beside the income a usual month brings in", () => {
    const chart = buildForecastChart("forecast for the next 3 months", ledger, {}, ASOF)!;
    expect(chart.by).toBe("month");
    expect(chart.rows.map((r) => r.label)).toEqual(["December 2026", "January 2027", "February 2027"]);
    expect(chart.rows.every((r) => r.previous === 800_000)).toBe(true);
    expect(chart.against?.name).toBe("Usual income");
    expect(chartReading(chart)).toMatch(/across 3 months/);
  });

  it("draws nothing for a month gone or a ledger with no history", () => {
    expect(buildForecastChart("forecast for october", ledger, {}, ASOF)).toBeNull();
    expect(buildForecastChart("forecast next month", [], {}, ASOF)).toBeNull();
  });

  it("is built through the measure the words name", () => {
    const q = "show me a prediction for next month as a pie";
    const chart = buildMeasureChart(q, localHint(q), { transactions: ledger, budgets: {}, reference: { wallets: ["Cash"], savings: [] }, debts: [], asOf: ASOF })!;
    expect(chart.measure).toBe("forecast");
    expect(chart.kind).toBe("pie");
  });
});

describe("allocations and safe to spend, drawn", () => {
  const gymLine = makeAllocation({ name: "Gym", kind: "Self Care", words: "gym", amount: null, each: 6_000, times: 8, per: "time" }, "2026-11", "2026-11-01", "g1");
  const gasLine = makeAllocation({ kind: "Gas", amount: null, each: 25_000, times: 4, per: "week" }, "2026-11", "2026-11-01", "a1");
  const rows = [
    row("2026-11-05", 7_500, { item: "Self Care", description: "gym" }),
    row("2026-11-04", 25_000, { item: "Gas" }),
    row("2026-11-06", 25_000, { item: "Gas" }),
  ];
  const month = monthAllocations([gymLine, gasLine], rows, "2026-11", ASOF);

  it("puts each allocation's spending beside what it holds", () => {
    const chart = buildAllocationChart(month)!;
    expect(chart.measure).toBe("allocation");
    expect(chart.rows.map((r) => [r.label, r.value, r.previous])).toEqual([
      ["Gym", 7_500, 48_000],
      ["Gas", 50_000, 100_000],
    ]);
    expect(chart.against?.total).toBe(148_000);
    expect(chartReading(chart)).toBe("PHP 575.00 spent of PHP 1,480.00 allocated, with the month still running. PHP 905.00 is left, most of it in Gas, PHP 500.00.");
    expect(chartInWords(chart)).toBe("Gym PHP 75.00 spent of PHP 480.00, PHP 405.00 left; Gas PHP 500.00 spent of PHP 1,000.00, PHP 500.00 left. Spent PHP 575.00 of PHP 1,480.00 allocated.");
  });

  it("only the line named, when one is", () => {
    const chart = buildAllocationChart(month, ["g1"])!;
    expect(chart.title).toBe("Gym allocation, November 2026");
    expect(chart.rows).toHaveLength(1);
  });

  it("reads \"show my allocations\" as the allocation chart", () => {
    expect(measureOf(localHint("chart my allocations"))).toBe("allocation");
    expect(measureOf(localHint("allocation status"))).toBe("allocation");
    expect(measureOf(localHint("allocate 300 a week for gas"))).toBeNull();
  });

  it("draws safe to spend as what the wallets hold, by what it is still for", () => {
    const safe = { wallets: 300_000, reservedBills: 100_000, reservedDebt: 0, reservedPlans: 0, reservedAllocations: 80_000, free: 120_000, safe: 120_000, daysLeft: 22, perDay: 5_454 };
    const chart = buildSafeChart(safe, "2026-11")!;
    expect(chart.rows.map((r) => [r.label, r.value])).toEqual([
      ["Bills still to pay", 100_000],
      ["Allocations", 80_000],
      ["Safe to spend", 120_000],
    ]);
    expect(chart.rows.reduce((s, r) => s + r.value, 0)).toBe(chart.total);
    expect(chartReading(chart)).toBe("The spending wallets hold PHP 3,000.00. PHP 1,800.00 of it is still due this month, which leaves PHP 1,200.00 safe to spend (22 days left, PHP 54.54 today).");
    expect(measureOf(localHint("chart my safe to spend"))).toBe("safe");
    expect(measureOf(localHint("how much can I spend today"))).toBeNull();
  });

  it("when the wallets cannot cover what is due, says the shortfall and still adds up", () => {
    const short = { wallets: 100_000, reservedBills: 120_000, reservedDebt: 0, reservedPlans: 0, reservedAllocations: 30_000, free: -50_000, safe: 0, daysLeft: 22, perDay: 0 };
    const chart = buildSafeChart(short, "2026-11")!;
    expect(chart.rows.reduce((s, r) => s + r.value, 0)).toBe(100_000);
    expect(chartReading(chart)).toMatch(/PHP 500\.00 short of what is still due, so nothing is safe to spend/);
    expect(buildSafeChart({ ...short, wallets: 0 }, "2026-11")).toBeNull();
  });

  it("every new chart, written out, has no em dash", () => {
    const charts = [buildAllocationChart(month)!, buildSafeChart({ wallets: 1, reservedBills: 0, reservedDebt: 0, reservedPlans: 0, free: 1, safe: 1, daysLeft: 1, perDay: 1 }, "2026-11")!, buildForecastChart("forecast next 3 months", ledger, {}, ASOF)!];
    for (const c of charts) for (const text of [chartReading(c), chartInWords(c), chartAsText(c), c.title]) expect(text).not.toContain(DASH);
  });
});

describe("how many sessions are left (owner, 9 November 2026)", () => {
  const gymLine = makeAllocation({ name: "Gym", kind: "Self Care", words: "gym", amount: null, each: 6_000, times: 8, per: "time" }, "2026-11", "2026-11-01", "g1");
  const owner = "I go gym twice a week and my budget per session is 60 pesos how many session I have left before the month end also base on the budget also?";

  it("counts it three ways, each said once, and names the dearer session", () => {
    const month = monthAllocations([gymLine], [row("2026-11-05", 7_500, { item: "Self Care", description: "gym" })], "2026-11", ASOF);
    const words = timesWords(month.lines[0]!, owner, ASOF, month.phase)!;
    expect(words).toContain("Gym: ₱480.00 for 8 sessions at ₱60.00 each.");
    expect(words).toContain("The one on November 5, 2026 cost ₱75.00, ₱15.00 more than its ₱60.00.");
    expect(words).toContain("Left: ₱405.00 and 7 sessions of the 8. At ₱60.00 a session, ₱405.00 pays for 6 (₱360.00), with ₱45.00 to spare; the allocation counts 7, so the last one would need ₱15.00 more.");
    expect(words).toContain("Twice a week from today to November 30, 2026 (22 days: 3 weeks and 1 day) is 6 sessions, or 7 if one falls on the last day: it covers 6, with ₱45.00 to spare; a 7th would need ₱15.00 more.");
    expect(words).toContain("At ₱75.00 a session, what the last one cost, ₱405.00 pays for 5: 6 would need ₱45.00 more.");
    expect(words).toContain("This money is already set aside");
    expect(words).not.toContain(DASH);
    // Through the chat's own answer: the long rule is said once, not twice.
    const all = allocationWords(owner, month, { safe: 61_000, perDay: 2_800 }, ASOF);
    expect(all.startsWith("Gym: ₱480.00 for 8 sessions")).toBe(true);
    expect(all).toContain("Safe to spend now, after the allocations: ₱610.00; today, ₱28.00. That is for everything else: the allocations are already taken out of it.");
    expect(all).not.toContain("Spending within an allocation does not change safe to spend");
  });

  it("asks how often when the message does not say, and keeps the plain status for \"gym left\"", () => {
    const month = monthAllocations([gymLine], [], "2026-11", ASOF);
    expect(timesWords(month.lines[0]!, "how many gym sessions left", ASOF, month.phase)).toContain('Say how often you go ("twice a week")');
    expect(asksTimesLeft("gym left")).toBe(false);
    expect(allocationWords("gym left", month, null, ASOF)).toContain("Gym: ₱0.00 spent of ₱480.00, ₱480.00 left (0 of 8 times).");
  });

  it("short of money for the schedule: says how much and that the rest comes out of safe to spend", () => {
    const used = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"].map((d) => row(d, 6_000, { item: "Self Care", description: "gym" }));
    const month = monthAllocations([gymLine], used, "2026-11", ASOF);
    const words = timesWords(month.lines[0]!, "I go 3 times a week, how many sessions left", ASOF, month.phase)!;
    expect(words).toContain("Left: ₱180.00 and 3 sessions of the 8.");
    expect(words).toContain("3 times a week from today to November 30, 2026 (22 days: 3 weeks and 1 day) is 9 sessions, or 10 if one falls on the last day: ₱540.00 for 9: ₱360.00 short, so 6 would come out of safe to spend.");
  });

  it("past its amount: every further one comes out of safe to spend", () => {
    const used = [row("2026-11-02", 30_000, { item: "Self Care", description: "gym" }), row("2026-11-03", 30_000, { item: "Self Care", description: "gym" })];
    const month = monthAllocations([gymLine], used, "2026-11", ASOF);
    const words = timesWords(month.lines[0]!, "how many sessions left", ASOF, month.phase)!;
    expect(words).toContain("It is ₱120.00 past its ₱480.00: nothing is left of it, so every further session comes out of safe to spend.");
  });

  it("used today: the schedule counts from tomorrow", () => {
    const month = monthAllocations([gymLine], [row(ASOF, 6_000, { item: "Self Care", description: "gym" })], "2026-11", ASOF);
    expect(timesWords(month.lines[0]!, "twice a week, how many times left", ASOF, month.phase)).toContain("Twice a week from tomorrow to November 30, 2026 (21 days: 3 weeks)");
  });

  it("set days: the line's own days, counted exactly", () => {
    const tueThu = makeAllocation({ name: "Gym", kind: "Self Care", words: "gym", amount: null, each: 5_000, per: "day", days: [2, 4] }, "2026-11", "2026-11-01", "d1");
    const month = monthAllocations([tueThu], [row("2026-11-03", 5_000, { item: "Self Care", description: "gym" })], "2026-11", ASOF);
    const words = timesWords(month.lines[0]!, "how many days left", ASOF, month.phase)!;
    expect(words).toContain("Tuesday and Thursday from today to November 30, 2026 is 6 days");
  });

  it("reads how often from the words", () => {
    expect(rateSaid("I go twice a week")).toEqual({ perWeek: 2 });
    expect(rateSaid("3 times a week")).toEqual({ perWeek: 3 });
    expect(rateSaid("once weekly")).toEqual({ perWeek: 1 });
    expect(rateSaid("I go every day")).toEqual({ perWeek: 7 });
    expect(rateSaid("every monday and thursday")).toEqual({ days: [1, 4] });
    expect(rateSaid("how many left")).toBeNull();
  });
});

describe("a chart beside the words, without waiting to be asked (owner, 9 November 2026)", () => {
  it("draws a split, a forecast, allocations and safe to spend; not one figure or words asked for", () => {
    expect(chartHelps("where did my money go this month?", localHint("where did my money go this month?"), false)).toBe(true);
    expect(chartHelps("what will I spend next month?", localHint("what will I spend next month?"), false)).toBe(true);
    expect(chartHelps("show my allocations", localHint("show my allocations"), false)).toBe(true);
    expect(chartHelps("how much did I spend today?", { by: "item" }, false)).toBe(false);
    expect(chartHelps("where did my money go? in words only", localHint("where did my money go?"), false)).toBe(false);
    expect(chartHelps("my budget compared to my friend's", { money: "budget" }, false)).toBe(false);
    expect(chartHelps("my spending compared to last month", { by: "item" }, false)).toBe(true);
  });
});

describe("a question with \"budget\" and \"before\" in it is not the budget's history", () => {
  it("the owner's gym question reaches the allocation, and history is still history", async () => {
    const { asksBudgetHistory } = await import("./settingsContext");
    expect(asksBudgetHistory("I go gym twice a week and my budget per session is 60 pesos how many session I have left before the month end also base on the budget also?")).toBe(false);
    expect(asksBudgetHistory("how many times can I eat out before my budget runs out")).toBe(false);
    for (const q of ["did I change my budget?", "what did I change in my budget", "what was my budget before", "how many times did i change my budget", "budget history", "my old budget", "when did I set my food limit"]) {
      expect(asksBudgetHistory(q), q).toBe(true);
    }
  });
});
