/**
 * The owner, 10 November 2026: "I buy food 100" took 25 seconds to become a
 * card; "last week with the week before" was read as this week against last;
 * a long question drew "Bills by month" for one week, one bar; "Earning"
 * after a yearly chart drew this month by item; the yearly reading called a
 * partial first year the lowest and missed that the running year was already
 * the highest; and "will December be short" left out December's plan.
 * Every name and figure here is invented.
 */
import { describe, expect, it } from "vitest";

import { buildMeasureChart, chartReading } from "./chartAsk";
import { asksChartIn, bareMeasure, forecastMeant, oneBar, sentencesOf } from "./chartParts";
import { buildChart, comparedPeriods } from "./charts";
import { certainEntry } from "./entryCertain";
import { plainlyDone } from "./intent";
import type { Budgets, ReferenceLists, Transaction } from "./types";

const ASOF = "2026-11-10";
const DASH = String.fromCharCode(0x2014);
let n = 0;
const row = (o: Partial<Transaction>): Transaction =>
  ({ id: `c${(n += 1)}`, recordNumber: 7000 + n, date: "2026-08-01", type: "Spending", category: "Spending", item: "", fromWallet: "Cash", toWallet: "", description: "", amount: 0, fee: 0, total: 0, notes: "", status: "Done", ...o }) as Transaction;
const spent = (date: string, item: string, amount: number, o: Partial<Transaction> = {}): Transaction => row({ date, item, amount, total: amount, ...o });
const earned = (date: string, item: string, amount: number): Transaction => row({ date, type: "Revenue", category: "Revenue", item, fromWallet: "", toWallet: "Cash", amount, total: amount });

describe("an entry read whole is a card at once", () => {
  const history = [
    ...["2026-10-01", "2026-10-03", "2026-10-05"].map((d) => spent(d, "Snacks", 5000, { description: "merienda" })),
    spent("2026-10-02", "Snacks", 7000, { description: "merienda" }),
    spent("2026-10-04", "Fare", 2000, { fromWallet: "Wallet B" }),
    earned("2026-10-01", "Pay", 500000),
  ];
  const reference = { wallets: ["Cash", "Wallet B"], savings: [], spendingTypes: [{ name: "Snacks", remark: "" }, { name: "Fare", remark: "" }], bills: [], subscriptions: [], revenueCategories: ["Pay"], credits: ["Card Line"], onBehalf: [] } as unknown as ReferenceLists;
  const certain = (t: string): boolean => certainEntry(t, history, reference, ASOF);

  it("when every word is accounted for", () => {
    expect(certain("I buy snacks 100")).toBe(true);
    expect(certain("bought snacks 150 wallet b")).toBe(true);
    expect(certain("snacks 80")).toBe(true);
    expect(certain("merienda 60")).toBe(true);
    expect(certain("bought snacks 100 yesterday")).toBe(true);
    expect(certain("received pay 3000")).toBe(true);
  });
  it("never when something is left to read, supposed, several, a transfer, a debt or a question", () => {
    for (const t of ["I buy snacks 100 for my cousin", "I will buy snacks 100", "snacks 100 and fare 20", "snacks 100 50", "transfer 500 from wallet b to cash", "paid card line 1000", "how much snacks 100?", "I buy shoes 2000"]) {
      expect(certain(t), t).toBe(false);
    }
  });
  it("the present tense is plainly done, the future never", () => {
    expect(plainlyDone("I buy snacks 100")).toBe(true);
    expect(plainlyDone("pay fare 20 wallet b")).toBe(true);
    expect(plainlyDone("I will buy snacks 100 tomorrow")).toBe(false);
    expect(plainlyDone("should I buy snacks 100")).toBe(false);
  });
});

describe("two whole periods gone, one after the other", () => {
  it("last week with the week before", () => {
    const p = comparedPeriods("Compare my spending last week with the week before, item by item", ASOF)!;
    expect(p.now).toMatchObject({ from: "2026-11-02", to: "2026-11-08", name: "last week, Nov 2 to Nov 8" });
    expect(p.before).toMatchObject({ from: "2026-10-26", to: "2026-11-01", name: "the week before, Oct 26 to Nov 1" });
  });
  it("last month against the month before, and yesterday against the day before", () => {
    expect(comparedPeriods("how did last month compare to the month before?", ASOF)).toMatchObject({ now: { from: "2026-10-01", to: "2026-10-31" }, before: { from: "2026-09-01", to: "2026-09-30" } });
    expect(comparedPeriods("yesterday vs the day before", ASOF)).toMatchObject({ now: { from: "2026-11-09" }, before: { from: "2026-11-08" } });
  });
  it("this week against last stays as it was", () => {
    expect(comparedPeriods("this week vs last week", ASOF)?.now.from).toBe("2026-11-09");
  });
});

describe("which chart, and what it says", () => {
  const rows = [
    ...["2026-08-05", "2026-09-05", "2026-10-05", "2026-11-05"].map((d) => spent(d, "Snacks", 100000)),
    spent("2026-11-06", "Fare", 30000),
    spent("2026-11-07", "Gifts", 20000),
    spent("2024-06-10", "Snacks", 50000),
    spent("2025-03-10", "Snacks", 300000),
    spent("2026-01-10", "Snacks", 900000),
  ];
  it("a share of the whole is a pie; three months are bars; a trend asked for is a line", () => {
    expect(buildChart("where did my money go this month", rows, ASOF)!.kind).toBe("pie");
    expect(buildChart("spending by month september to november", rows, ASOF)!.kind).toBe("bars");
    expect(buildChart("spending trend september to november", rows, ASOF)!.kind).toBe("line");
  });
  it("a first year the records start partway through, and a running year already past every whole one", () => {
    const c = buildChart("yearly spending", rows, ASOF)!;
    expect(c.partialFirst).toEqual({ label: "2024", from: "2024-06-10" });
    const words = chartReading(c);
    expect(words).toContain("2026 so far, PHP 13,500.00, is already more than any whole year before it, and it is not over.");
    expect(words).toContain("2024 starts on June 10, 2024, when your records begin, so it is not a whole year and is left out of the highest, the lowest and the average.");
    expect(words).not.toContain(DASH);
  });
});

describe("a forecast counts the plans due in its month", () => {
  const months = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
  const rows = months.flatMap((m) => [spent(`${m}-05`, "Snacks", 400000), spent(`${m}-15`, "Fare", 200000), earned(`${m}-01`, "Pay", 700000)]);
  const reference = { wallets: ["Cash"], savings: [] } as unknown as ReferenceLists;
  const base = { transactions: rows, budgets: {} as Budgets, reference, debts: [], asOf: ASOF };
  it("and says it is short when the plan makes it so", () => {
    const without = buildMeasureChart("forecast for December 2026", { money: "forecast" }, base)!;
    const withPlan = buildMeasureChart("forecast for December 2026", { money: "forecast" }, { ...base, plansIn: (y, m) => (y === 2026 && m === 12 ? [{ name: "Trip", amount: 150000 }] : []) })!;
    expect(withPlan.total - without.total).toBe(150000);
    expect(withPlan.rows.map((r) => r.label)).toContain("Trip (plan)");
    expect(chartReading(withPlan)).toMatch(/which is PHP [\d,.]+ short/);
    expect(chartReading(without)).toMatch(/which leaves about PHP/);
  });
});

describe("a long message, sentence by sentence", () => {
  const q = "Compare my spending last week with the week before, item by item, and show it as a chart. What caused the jump? List every bill still coming. Based on my usual month, will December be short? Show December as a chart too.";
  it("finds the sentences that ask for a picture, and the month to come as its forecast", () => {
    const s = sentencesOf(q);
    expect(s).toHaveLength(5);
    expect(s.filter(asksChartIn)).toEqual([s[0], s[4]]);
    expect(forecastMeant(s[4] as string, s, ASOF)).toBe("forecast for December 2026");
    expect(forecastMeant("Show October as a chart", ["Show October as a chart"], ASOF)).toBeNull();
  });
  it("never draws one bar, and keeps the chart before for a bare word", () => {
    const one = buildChart("fare by month last week", [spent("2026-11-03", "Fare", 1000)], ASOF)!;
    expect(oneBar(one)).toBe(true);
    expect(bareMeasure("Earning")).toBe(true);
    expect(bareMeasure("income this year")).toBe(false);
    expect(bareMeasure("spending by month")).toBe(false);
  });
});
