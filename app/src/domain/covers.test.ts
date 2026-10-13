import { describe, expect, it } from "vitest";

import { covers, coversOn, daysCovered, savedWithin, shortDays, spreadCovered, wholeRows } from "./covers";
import { financeAlerts } from "./alerts";
import { monthBrief } from "./monthPlan";
import { entryImpact } from "./entryImpact";
import { checkDraft, draftToTransactions, emptyDraft, transactionToDraft } from "./entry";
import { monthTotals } from "./totals";
import { walletBalance } from "./balances";
import type { Transaction } from "./types";

let n = 0;
const row = (o: Partial<Transaction>): Transaction => {
  n += 1;
  return { id: `c${n}`, recordNumber: n, date: "2026-10-09", type: "Spending", fromWallet: "Cash", toWallet: "", category: "Spending", item: "Trip", description: "", amount: 0, fee: 0, total: 0, notes: "", status: "Paid", ...o } as Transaction;
};
const reference = { wallets: ["Cash", "Maya"], savings: [], bills: [], subscriptions: [], revenueCategories: ["Allowance"], spendingTypes: [{ name: "Trip", remark: "" }, { name: "Food", remark: "" }, { name: "Travel", remark: "" }, { name: "Groceries", remark: "" }] };

describe("spending over several days (12 October 2026)", () => {
  const trip = row({ amount: 933700, total: 933700, coversTo: "2026-10-11" });

  it("spreads evenly over its days, the parts adding up exactly", () => {
    const parts = spreadCovered([trip]);
    expect(daysCovered(trip)).toBe(3);
    expect(parts.map((p) => [p.date, p.amount])).toEqual([["2026-10-09", 311233], ["2026-10-10", 311233], ["2026-10-11", 311234]]);
    expect(parts.reduce((a, p) => a + p.total, 0)).toBe(933700);
    expect(parts.every((p) => p.coveredBy === trip.id && p.recordNumber === trip.recordNumber)).toBe(true);
  });

  it("splits a month total across the months it crosses, and moves no balance", () => {
    const crossing = row({ date: "2026-10-30", coversTo: "2026-11-02", amount: 400000, total: 400000 });
    const income = row({ type: "Revenue", category: "Revenue", item: "Allowance", fromWallet: "", toWallet: "Cash", amount: 1000000, total: 1000000, date: "2026-10-01" });
    const spread = spreadCovered([income, crossing]);
    expect(monthTotals(spread, 2026, 10).total).toBe(200000);
    expect(monthTotals(spread, 2026, 11).total).toBe(200000);
    expect(walletBalance(spread, "Cash")).toBe(walletBalance([income, crossing], "Cash"));
  });

  it("leaves a one-day entry exactly as it is", () => {
    const one = row({ amount: 5000, total: 5000 });
    expect(spreadCovered([one])[0]).toBe(one);
    expect(covers(one)).toBe(false);
  });

  it("is saved and read back with its last day, and only for spending", () => {
    const draft = { ...emptyDraft("2026-10-09"), flow: "Spending" as const, category: "Spending" as const, item: "Trip", fromWallet: "Cash", amount: 933700, coversTo: "2026-10-11" };
    const saved = draftToTransactions(draft, 1, "x")[0]!;
    expect(saved.coversTo).toBe("2026-10-11");
    expect(transactionToDraft(saved).coversTo).toBe("2026-10-11");
    expect(draftToTransactions({ ...draft, flow: "Revenue", category: "Revenue", toWallet: "Cash" }, 1, "y")[0]?.coversTo).toBeUndefined();
    expect(checkDraft({ ...draft, coversTo: "2026-10-08" }, [], reference as never, [], "2026-10-12").errors.map((e) => e.message).join(" ")).toContain("has to be after the first");
  });

  it("warns about an entry dated inside it, and names entries already saved in its days", () => {
    const food = { ...emptyDraft("2026-10-10"), flow: "Spending" as const, category: "Spending" as const, item: "Food", fromWallet: "Cash", amount: 30000 };
    expect(coversOn("2026-10-10", [trip]).map((t) => t.id)).toEqual([trip.id]);
    expect(checkDraft(food, [trip], reference as never, [], "2026-10-12").warnings.map((w) => w.message).join(" ")).toContain("it is already counted there");
    const meal = row({ date: "2026-10-10", item: "Food", amount: 30000, total: 30000 });
    expect(savedWithin([trip, meal], "2026-10-09", "2026-10-11", "Cash").map((t) => t.id)).toEqual([meal.id]);
  });

});

describe("a stretch of days in a typed entry", () => {
  it.each([
    ["spent 9500 on travel oct 9 to 11", "2026-10-09", "2026-10-11", 950000],
    ["oct 9-11 travel 9500 cash", "2026-10-09", "2026-10-11", 950000],
    ["food from October 9 to October 11 1200", "2026-10-09", "2026-10-11", 120000],
    ["9 to 11 oct groceries 800", "2026-10-09", "2026-10-11", 80000],
  ])("%s", async (said, from, to, amount) => {
    const { readEntry } = await import("./readEntry");
    const read = readEntry(said, [], reference as never, "2026-10-12");
    expect([read.draft.date, read.draft.coversTo, read.draft.amount]).toEqual([from, to, amount]);
  });

  it("leaves a single day alone", async () => {
    const { readEntry } = await import("./readEntry");
    expect(readEntry("spent 500 on food oct 9", [], reference as never, "2026-10-12").draft.coversTo).toBeUndefined();
  });
});

describe("entries already in a range (owner, 12 October 2026)", () => {
  it("never offers to take off more than the range's amount", async () => {
    const { savedInsideWords } = await import("./covers");
    const big = row({ recordNumber: 3933, date: "2026-10-12", item: "Travel", amount: 933700, total: 933700 });
    const words = savedInsideWords([big], 50000, "Cash");
    expect(words).toContain("#3933 Travel ₱9,337.00 on October 12, 2026");
    expect(words).not.toContain("take");
    expect(savedInsideWords([row({ amount: 30000, total: 30000 })], 950000, "Cash")).toContain("take ₱300.00 off");
  });
});

describe("every way a range is said, entry or question (12 October 2026)", () => {
  const items = ["Food", "Travel", "Treat", "Gas"];
  it.each([
    ["I spent 500 in travel in span of October 10 to 12", "2026-10-10", "2026-10-12", 50000],
    ["spent 500 travel between oct 10 and oct 12", "2026-10-10", "2026-10-12", 50000],
    ["I spent 900 on food for the last 3 days", "2026-10-10", "2026-10-12", 90000],
    ["spent 2000 on travel from monday to wednesday", "2026-10-05", "2026-10-07", 200000],
    ["mula oct 10 hanggang 12 gastos 500 travel", "2026-10-10", "2026-10-12", 50000],
    ["travel 3000 cash 10/10 to 10/12", "2026-10-10", "2026-10-12", 300000],
    ["spent 300 food yesterday and today", "2026-10-11", "2026-10-12", 30000],
  ])("entry: %s", async (said, from, to, amount) => {
    const { readEntry } = await import("./readEntry");
    const d = readEntry(said, [], reference as never, "2026-10-12").draft;
    expect([d.date, d.coversTo, d.amount]).toEqual([from, to, amount]);
  });

  it.each([
    ["How much i spend in span of oct 10 to 12", "2026-10-10", "2026-10-12"],
    ["how much did I spend from oct 1 to oct 10?", "2026-10-01", "2026-10-10"],
    ["how much did i spend on food between oct 5 and oct 10", "2026-10-05", "2026-10-10"],
    ["magkano nagastos ko mula oct 1 hanggang oct 10", "2026-10-01", "2026-10-10"],
    ["what did i spend the last 3 days", "2026-10-10", "2026-10-12"],
    ["how much did i spend since oct 5", "2026-10-05", "2026-10-12"],
  ])("question: %s", async (said, from, to) => {
    const { isQuestion } = await import("./intent");
    const { readSpendAsk } = await import("./spendAsk");
    expect(isQuestion(said)).toBe(true);
    expect(readSpendAsk(said, items, "2026-10-12")).toMatchObject({ from, to });
  });

  it("counts a range entry's share inside the days asked about", async () => {
    const { spendAnswer } = await import("./spendAsk");
    const trip = row({ date: "2026-10-09", coversTo: "2026-10-11", item: "Travel", amount: 900000, total: 900000 });
    const text = spendAnswer({ item: null, from: "2026-10-10", to: "2026-10-12", name: "October 10 to October 12" }, spreadCovered([trip]), "2026-10-12");
    expect(text).toContain("PHP 6,000.00");
  });
});

describe("a date range read whole where an entry is what counts (13 October 2026 audit)", () => {
  const trip = row({ amount: 933700, total: 933700, coversTo: "2026-10-11", description: "Funeral" });
  const income = row({ type: "Revenue", category: "Revenue", item: "Allowance", fromWallet: "", toWallet: "Cash", amount: 2000000, total: 2000000, date: "2026-10-01" });

  it("puts the day shares back into the entry the ledger holds", () => {
    const whole = wholeRows(spreadCovered([income, trip]));
    expect(whole).toHaveLength(2);
    const back = whole.find((t) => t.id === trip.id)!;
    expect([back.date, back.coversTo, back.amount, back.total, back.description]).toEqual(["2026-10-09", "2026-10-11", 933700, 933700, "Funeral"]);
    expect(back.coveredBy).toBeUndefined();
    expect(shortDays(back)).toBe("10/09/2026 to 10/11/2026");
  });

  it("raises no duplicate-number alert for the days of one trip", () => {
    const alerts = financeAlerts({
      transactions: spreadCovered([income, trip]),
      accounts: [{ id: "a", name: "Cash", kind: "spending", archived: false, channel: "cash" }] as never,
      budgets: {},
      debts: [],
      bills: [],
      lowBalanceThreshold: 0,
      asOf: "2026-10-12",
    });
    expect(alerts.map((a) => a.id).filter((id) => id.startsWith("shared-number") || id === "far-ahead")).toEqual([]);
  });

  it("counts a range still running as money out on its first day only", () => {
    const running = row({ date: "2026-10-12", coversTo: "2026-10-14", amount: 300000, total: 300000 });
    const rows = spreadCovered([income, running]);
    const brief = (asOf: string) =>
      monthBrief({ transactions: rows, reference: reference as never, budgets: {}, debts: [], year: 2026, month: 10, asOf }).safe!;
    expect(brief("2026-10-12").spentToday).toBe(300000);
    // The wallet did not move on the 13th: nothing went out that day.
    expect(brief("2026-10-13").spentToday).toBe(0);
    expect(brief("2026-10-13").overToday).toBe(0);
  });

  it("measures a range crossing the month end against each month", () => {
    const draft = { ...transactionToDraft(row({ date: "2026-10-30", coversTo: "2026-11-02", amount: 400000, total: 400000 })), id: undefined };
    const impact = entryImpact(draft as never, [income], { "2026": { spending: [0, 0, 0, 0, 0, 0, 0, 0, 0, 500000, 500000, 0], billsSubs: Array(12).fill(0) } } as never, "2026-10-30");
    expect(impact?.cost).toBe(200000);
    expect(impact?.later).toBe(200000);
    expect(impact?.leftAfter).toBe(300000);
  });
});
