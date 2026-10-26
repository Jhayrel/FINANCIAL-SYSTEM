/**
 * Spending said to be coming, and the month it lands in (26 October 2026:
 * "If I have 9k in tuition pending how much do i need including my budget to
 * survive next month?" was answered as if the 9k were income). Rows invented.
 */
import { describe, expect, it } from "vitest";

import { budgetAdvice, expectedIncomeIn, keepWords, needWords } from "./budgetAdvice";
import { readGoalAsk } from "./goalAsk";
import { asksLastTime } from "./lastTimeAsk";
import { aheadMonthIn, asksWhatItNeeds, plannedSpendIn } from "./plannedSpend";
import type { Transaction } from "./types";

const asOf = "2026-10-26";

describe("spending said to be coming", () => {
  it("reads a cost and what it is for, never as income", () => {
    const said = "If I have 9k in tuition pending how much do i need including my budget to survive next month? Do some calculations";
    expect(plannedSpendIn(said)).toEqual([{ name: "Tuition", amount: 900_000 }]);
    expect(expectedIncomeIn(said)).toBeNull();
  });

  it("reads several, and a plan to spend", () => {
    expect(plannedSpendIn("next month I need to pay 4500 rent and 9k tuition, how much do I need?")).toEqual([
      { name: "Rent", amount: 450_000 },
      { name: "Tuition", amount: 900_000 },
    ]);
    expect(plannedSpendIn("I plan to spend 3000 on a trip next month")).toEqual([{ name: "Trip", amount: 300_000 }]);
    // Two thousand pesos, not the year 2000.
    expect(plannedSpendIn("I will spend 2000 for my birthday on november 5, can I still keep my budget?")).toEqual([{ name: "Birthday", amount: 200_000 }]);
  });

  it("keeps income, savings and a budget's own parts apart", () => {
    const both = "If I expect 15000 allowance and have 9k tuition pending, is it enough for november?";
    expect(plannedSpendIn(both)).toEqual([{ name: "Tuition", amount: 900_000 }]);
    expect(expectedIncomeIn(both)).toBe(1_500_000);
    expect(plannedSpendIn("set November spending to 12000 and bills to 2000")).toEqual([]);
    expect(plannedSpendIn("base my budget on my 10k income, save 20%")).toEqual([]);
    expect(plannedSpendIn("keep 2000 for emergency")).toEqual([]);
    expect(expectedIncomeIn("what budget do you recommend for november if I only expect 8000")).toBe(800_000);
  });

  it("finds the month ahead a sentence names", () => {
    expect(aheadMonthIn("my birthday on november 5", asOf)).toEqual({ year: 2026, month: 11 });
    expect(aheadMonthIn("tuition next month", asOf)).toEqual({ year: 2026, month: 11 });
    expect(aheadMonthIn("a trip in march", asOf)).toEqual({ year: 2027, month: 3 });
    expect(aheadMonthIn("what I spent in october", asOf)).toBeNull();
    expect(aheadMonthIn("it may rain", asOf)).toBeNull();
  });

  it("knows a question about what a month needs", () => {
    expect(asksWhatItNeeds("how much do I need to survive next month?")).toBe(true);
    expect(asksWhatItNeeds("is it enough for november?")).toBe(true);
    expect(asksWhatItNeeds("how much do I need to save 10k by december?")).toBe(false);
    expect(asksWhatItNeeds("how much do I owe?")).toBe(false);
  });

  it("reads a year only where it is one, so a sum is not lost", () => {
    expect(readGoalAsk("save 2000 by december", asOf)?.target).toBe(200_000);
    expect(readGoalAsk("I want to save 5000 by December 2026", asOf)).toMatchObject({ target: 500_000, by: "2026-12-31" });
  });

  it("knows 'last time' with nothing named, so the conversation names it", () => {
    expect(asksLastTime("how much i spent last time?")).toBe(true);
    expect(asksLastTime("same as last time 200")).toBe(false);
  });
});

/*
 * Six months of the same: income 20,000; Food 6,000 and Treat 2,000 a month;
 * School 1,000; Globe 1,000. The usual month is 10,000.
 */
let n = 0;
const row = (over: Partial<Transaction>): Transaction => {
  n += 1;
  const amount = over.amount ?? 0;
  return { id: `p${n}`, recordNumber: n, date: "2026-05-10", type: "Spending", fromWallet: "Cash", toWallet: "", category: "Spending", item: "Food", description: "", fee: 0, notes: "", status: "Paid", ...over, amount, total: amount + (over.fee ?? 0) };
};
const ledger: Transaction[] = ["05", "06", "07", "08", "09", "10"].flatMap((m) => [
  row({ date: `2026-${m}-01`, type: "Revenue", fromWallet: "", toWallet: "Cash", category: "Revenue", item: "Allowance", amount: 2_000_000, status: "Received" }),
  row({ date: `2026-${m}-05`, item: "Food", amount: 600_000 }),
  row({ date: `2026-${m}-06`, item: "Treat", amount: 200_000 }),
  row({ date: `2026-${m}-07`, item: "School", amount: 100_000 }),
  row({ date: `2026-${m}-08`, category: "Bills", item: "Globe", amount: 100_000 }),
]);
const base = { transactions: ledger, year: 2026, month: 11, asOf };

describe("what a month needs, with what is coming", () => {
  it("adds what is coming on top of the usual month, and never cuts it", () => {
    const a = budgetAdvice({ ...base, planned: [{ name: "Tuition", amount: 900_000 }] });
    expect(a.total).toBe(1_000_000 + 900_000);
    const held = budgetAdvice({ ...base, income: 1_500_000, planned: [{ name: "Tuition", amount: 900_000 }] });
    // 15,000 less Globe 1,000 less the tuition 9,000 leaves 5,000 for the usual 9,000 of spending: the want gives way first.
    expect(held.fit?.cuts.map((c) => c.name)).toEqual(["Treat"]);
    expect((held.fit?.spending ?? 0) - 900_000).toBeLessThanOrEqual(500_000 + held.fit!.short);
  });

  it("works the need out step by step, against the income, what carries over and the savings", () => {
    const a = budgetAdvice({ ...base, planned: [{ name: "Tuition", amount: 900_000 }] });
    const words = needWords(a, { incomeSaid: 1_500_000, carry: 70_000, savings: [{ name: "Savings", amount: 300_000 }], verdict: true });
    const lines = words.split("\n");
    expect(lines[0]).toBe("**Not as things usually go. You need PHP 19,000.00 for November 2026.** Worked out:");
    expect(words).toContain("- Together: PHP 10,000.00 + PHP 9,000.00 = **PHP 19,000.00**.");
    // Tuition and the usual School line: said, with what it does to the total.
    expect(words).toContain("Your usual month already has School at PHP 1,000.00: if the tuition is that spending rather than on top of it, the total is PHP 18,000.00.");
    expect(words).toContain("PHP 19,000.00 − PHP 15,000.00: **PHP 4,000.00 short**.");
    expect(words).toContain("PHP 700.00 carries over from your wallets: still **PHP 3,300.00 short**.");
    expect(words).toContain("PHP 300.00 less than the gap even if all of it were used");
  });

  it("says when the money covers it, going by the usual income", () => {
    const a = budgetAdvice(base);
    const words = needWords(a, { incomeSaid: null, carry: null, savings: [], verdict: true });
    expect(words.split("\n")[0]).toBe("**Yes, going by what comes in. You need PHP 10,000.00 for November 2026.** Worked out:");
    expect(words).not.toContain("Together");
    expect(words).toContain("**PHP 10,000.00 to spare**");
  });

  it("checks the budget set for the month, and says what keeping it takes", () => {
    const a = budgetAdvice({ ...base, planned: [{ name: "Birthday", amount: 200_000 }] });
    const set = { spending: 800_000, billsSubs: 100_000 };
    const held = budgetAdvice({ ...base, planned: [{ name: "Birthday", amount: 200_000 }], income: 900_000 });
    const words = keepWords(a, held, set);
    expect(words.split("\n")[0]).toBe("**Not as things usually go: November 2026's budget is PHP 9,000.00, and your usual month with the birthday comes to PHP 12,000.00, PHP 3,000.00 over it.**");
    expect(words).toContain("Your usual month alone is already PHP 1,000.00 over it");
    expect(words).toContain("Treat from PHP 2,000.00 to");
    expect(words).toContain('say "set November to 12000"');
  });
});
