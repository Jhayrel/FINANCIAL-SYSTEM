/**
 * "How much can I spend today?", in the owner's words from 5 and 6 October
 * 2026, and the answer the device gives when no model does.
 */
import { describe, expect, it } from "vitest";

import { monthBrief } from "./monthPlan";
import { asksSafeToSpend, rateIn, safeWords } from "./safeAsk";
import type { ReferenceLists, Transaction } from "./types";

describe("asking what is safe to spend", () => {
  it("is heard however it is put", () => {
    for (const said of [
      "What is my safe spending? Like the actual safe spending based remove the subscription and bills",
      "Actually 200 per day is the safe to spend like look. You need to remove the subscription and bill to the equation then only whats left is use. Check it this works",
      "Make me a breakdown of how much i can spend today",
      "How much i can spend today since i already spend too much yesterday",
      "I'm in based on that balance how much i can spend safely today",
      "So how much can i use to today",
      "magkano pwede ko gastusin",
      "how much is left if I take out the bills",
      "how much can I spend for today",
    ]) {
      expect([said, asksSafeToSpend(said)]).toEqual([said, true]);
    }
  });

  it("is not a change to a bill, an entry, or a sum of what was spent", () => {
    for (const said of ["remove the netflix subscription", "add a bill", "I spent 300 on gas", "how much did I spend on food", "delete the spotify subscription entry", "how much can I spend on food this month"]) {
      expect([said, asksSafeToSpend(said)]).toEqual([said, false]);
    }
  });

  it("reads a figure a day when one is proposed", () => {
    expect(rateIn("Actually 200 per day is the safe to spend")).toBe(20_000);
    expect(rateIn("is ₱150.50 a day ok")).toBe(15_050);
    expect(rateIn("250 daily")).toBe(25_000);
    expect(rateIn("how much can I spend today")).toBeNull();
  });
});

describe("the device's answer", () => {
  const reference: ReferenceLists = { wallets: ["Cash"], savings: [], bills: ["Internet"], subscriptions: [], revenueCategories: ["Allowance"], spendingTypes: [{ name: "Food", remark: "" }] };
  let n = 0;
  const row = (over: Partial<Transaction>): Transaction => {
    n += 1;
    const amount = over.amount ?? 0;
    return { id: `a${n}`, recordNumber: n, date: "2026-09-01", type: "Spending", fromWallet: "Cash", toWallet: "", category: "Spending", item: "Food", description: "", fee: 0, notes: "", status: "", ...over, amount, total: amount };
  };
  const ledger = [
    row({ date: "2026-08-25", type: "Revenue", fromWallet: "", toWallet: "Cash", category: "Revenue", item: "Allowance", amount: 620_000 }),
    row({ date: "2026-08-24", category: "Bills", item: "Internet", amount: 120_000 }),
    row({ date: "2026-09-21", amount: 10_000 }),
  ];
  const brief = monthBrief({ transactions: ledger, reference, budgets: {}, debts: [], year: 2026, month: 9, asOf: "2026-09-21" });

  it("lays the sum out as the Dashboard does, today first", () => {
    const words = safeWords(brief);
    expect(words.split("\n")[0]).toBe("**Safe to spend today: ₱280.00**");
    expect(words).toContain("- In your wallets: ₱4,900.00");
    expect(words).toContain("- Bills and subscriptions still to pay: −₱1,200.00 (Internet ₱1,200.00)");
    expect(words).toContain("- Safe until September ends: **₱3,700.00**");
    expect(words).toContain("- From tomorrow: ₱380.00 a day for 9 days");
    expect(words).toContain("Today's share is ₱380.00, and ₱100.00 of it is spent.");
  });

  it("checks a figure a day against it", () => {
    expect(safeWords(brief, 30_000)).toContain("₱300.00 a day for the 10 days left, today included, is ₱3,000.00: it fits, with ₱800.00 to spare.");
    expect(safeWords(brief, 50_000)).toContain("₱1,200.00 more than is safe. ₱380.00 a day fits.");
  });
});
