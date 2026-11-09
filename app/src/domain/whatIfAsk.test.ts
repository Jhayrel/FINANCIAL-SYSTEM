/**
 * The device's what-if answers (owner, 9 November 2026), on invented figures:
 * a month with 22 days left.
 */
import { describe, expect, it } from "vitest";

import { makeAllocation, monthAllocations } from "./monthAllocation";
import type { Transaction } from "./types";
import { billPayWords, incomeIfWords, noSpendWords, readBillPayIf, readIncomeIf, readNoSpendDays, readSkipIf, skipWords, type SafeNow } from "./whatIfAsk";

const s: SafeNow = { safe: 73_203, perDay: 3_327, perDayAfter: 3_327, spentToday: 0, daysLeft: 22, wallets: 328_003 };
const asOf = "2026-11-09";

describe("money coming in is not spending", () => {
  it.each([
    ["what if I get 5000 allowance", 500_000],
    ["if my salary of 8k comes in", 800_000],
    ["kung dumating ang 2,500 na allowance", 250_000],
  ])("%s", (q, amount) => expect(readIncomeIf(q)).toBe(amount));

  it("a purchase is still a purchase", () => {
    expect(readIncomeIf("what if I buy a 5000 phone with my allowance")).toBeNull();
    expect(readIncomeIf("what if I spend 500")).toBeNull();
  });

  it("says what is safe with it, and that the budget is not changed by it", () => {
    const w = incomeIfWords(500_000, s, "November 2026");
    expect(w).toContain("If ₱5,000.00 comes in today, safe to spend goes from ₱732.03 to ₱5,732.03 until November ends: ₱260.54 today instead of ₱33.27, and ₱260.54 a day from tomorrow.");
    expect(w).toContain("It does not raise the budget by itself.");
  });
});

describe("no spending for some days", () => {
  it.each([
    ["what if I don't spend anything for 3 days", 3],
    ["if I won't spend for two days", 2],
    ["5 days without spending", 5],
  ])("%s", (q, n) => expect(readNoSpendDays(q)).toBe(n));

  it("the same money over the days after them", () => {
    expect(noSpendWords(3, s, asOf, "November 2026")).toBe(
      "Spend nothing for 3 days, today to November 11, 2026, and the ₱732.03 safe to spend is still there on November 12, 2026: ₱38.52 a day for the 19 days left, instead of ₱33.27 today. Unspent money is never lost; it is spread over the days after.",
    );
    expect(noSpendWords(30, s, asOf, "November 2026")).toContain("carried over into next month");
  });
});

describe("paying a bill that is set aside", () => {
  const open = [{ item: "Globe at Home Wifi" }, { item: "Microsoft Office 365" }];
  it("finds it by a word of its own", () => {
    expect(readBillPayIf("if I pay globe today what happens to safe to spend", open)).toBe("Globe at Home Wifi");
    expect(readBillPayIf("what if I pay microsoft now", open)).toBe("Microsoft Office 365");
    expect(readBillPayIf("what if I pay the home wifi", open)).toBe("Globe at Home Wifi");
    expect(readBillPayIf("I paid globe", open)).toBeNull();
  });
  it("safe to spend stays; the wallets move", () => {
    expect(billPayWords({ item: "Globe at Home Wifi", amount: 99_900 }, s)).toBe(
      "Globe at Home Wifi, ₱999.00, is already set aside as a bill still to pay, so paying it today leaves safe to spend at ₱732.03 and today's figure at ₱33.27. Your spending wallets go from ₱3,280.03 to ₱2,281.03. Paid for more than ₱999.00, the extra comes out of safe to spend.",
    );
  });
});

describe("skipping what an allocation is for", () => {
  const gym = makeAllocation({ name: "Gym", kind: "Self Care", words: "gym", amount: null, each: 5_000, times: 8, per: "time" }, "2026-11", "2026-11-01", "gym");
  const rows = [{ id: "t1", recordNumber: 1, date: "2026-11-04", type: "Spending", fromWallet: "Cash", toWallet: "", category: "Spending", item: "Self Care", description: "gym", amount: 9_000, fee: 0, total: 9_000, notes: "", status: "Paid" } as Transaction];
  const month = monthAllocations([gym], rows, "2026-11", asOf);
  it("finds the allocation by its name or words", () => {
    expect(readSkipIf("what if I skip the gym this month", month)?.name).toBe("Gym");
    expect(readSkipIf("what if I go to the gym", month)).toBeNull();
  });
  it("what stays held, and what removing it would free", () => {
    expect(skipWords(month.lines[0]!, s, "November 2026")).toBe(
      "Skip it and the ₱310.00 left in the Gym allocation stays set aside until November ends; then it is free money in the new month. To free it now, remove the allocation on Budget, under Allocations: safe to spend would go from ₱732.03 to ₱1,042.03, ₱47.36 today instead of ₱33.27. It can be put back.",
    );
  });
});
