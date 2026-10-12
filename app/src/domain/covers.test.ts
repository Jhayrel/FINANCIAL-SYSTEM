import { describe, expect, it } from "vitest";

import { covers, coversOn, daysCovered, savedWithin, spreadCovered } from "./covers";
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
