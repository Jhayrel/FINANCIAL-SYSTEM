import { describe, expect, it } from "vitest";
import { asksWhatTheDayBuys, challengeWorked, challengesAnswer, everydayPrices, fitNote, fitSlips, pricesAgainstDay } from "./dayFit";
import { formatMoney } from "./money";
import { safeAfter } from "./monthPlan";
import type { Transaction } from "./types";

const row = (date: string, item: string, total: number, category: Transaction["category"] = "Spending"): Transaction =>
  ({ id: `${date}-${item}-${total}`, date, type: "Spending", category, item, amount: total, fee: 0, total, fromWallet: "Cash", toWallet: "" }) as unknown as Transaction;

const php = (c: number): string => formatMoney(c).replace("₱", "PHP ");
const DAY = { today: 8064, after: 8064 };

describe("the owner's own conversation, 7 October 2026", () => {
  const first =
    "Yes, PHP 80.64 is useful because food items like a PHP 25.00 bottle of water or a PHP 95.00 meal are within that daily limit, though larger items like a PHP 2,475.00 restaurant bill require saving up over several days.";

  it("catches a PHP 95.00 meal said to fit within PHP 80.64", () => {
    expect(fitSlips(first, DAY)).toEqual([{ amount: 9500, limit: 8064 }]);
    expect(fitNote(first, DAY, php)).toBe("Check this: PHP 95.00 is PHP 14.36 more than PHP 80.64, so it does not fit that day's figure.");
  });

  it("leaves the right answers alone", () => {
    const second =
      "You cannot buy a PHP 95.00 meal today because your PHP 80.64 safe-to-spend amount leaves a shortfall of PHP 14.36. You could still afford it by drawing from the overall safe-until-month-end pool of PHP 2,016.01, which would reduce tomorrow's daily allowance.";
    expect(fitSlips(second, DAY)).toEqual([]);
    expect(fitSlips("Your PHP 80.64 a day covers the usual PHP 25.00 water, but not the PHP 95.00 meal.", DAY)).toEqual([]);
    expect(fitSlips("Your PHP 2,016.01 safe until October ends covers a PHP 95.00 meal.", DAY)).toEqual([]);
    expect(fitSlips("PHP 95.00 is above today's PHP 80.64.", DAY)).toEqual([]);
  });

  it("reads which day's figure a clause means", () => {
    expect(fitSlips("A PHP 70.00 lunch fits today's figure.", { today: 5000, after: 9000 })).toEqual([{ amount: 7000, limit: 5000 }]);
    expect(fitSlips("A PHP 70.00 lunch fits from tomorrow.", { today: 5000, after: 9000 })).toEqual([]);
    expect(fitSlips("A PHP 70.00 lunch fits within your daily figure.", { today: 5000, after: 9000 })).toEqual([]);
  });

  it("knows the follow-ups question the answer before", () => {
    expect(challengesAnswer("How do you even buy a meal of 95 but your safe spend is 80?")).toBe(true);
    expect(challengesAnswer("But why you suggested it?")).toBe(true);
    expect(challengesAnswer("Thats wrong check my balance again")).toBe(true);
    expect(challengesAnswer("How much did I spend on food?")).toBe(false);
    expect(challengesAnswer("why is my spending so high")).toBe(false);
  });

  it("hands the slip to the reply, so it starts by owning the mistake", () => {
    const worked = challengeWorked(first, DAY, php);
    expect(worked.text).toContain("it said PHP 95.00 fits within PHP 80.64, and it does not: PHP 95.00 is PHP 14.36 more than PHP 80.64");
    expect(worked.text).toContain("Begin by saying plainly that the earlier answer was wrong");
    expect(worked.fallback).toContain("The earlier answer was wrong");
    expect(challengeWorked("Groceries came to PHP 500.00.", DAY, php).fallback).toBeUndefined();
  });

  it("sees the price question for what it is", () => {
    expect(asksWhatTheDayBuys("Like the food prices, etc does 80 pesos still useful?")).toBe(true);
    expect(asksWhatTheDayBuys("How do you even buy a meal of 95 but your safe spend is 80?")).toBe(true);
    expect(asksWhatTheDayBuys("is that enough for food?")).toBe(true);
    expect(asksWhatTheDayBuys("what can 80 pesos buy")).toBe(true);
    expect(asksWhatTheDayBuys("how much did I spend in September")).toBe(false);
    expect(asksWhatTheDayBuys("add 95 food from cash")).toBe(false);
  });
});

describe("everyday prices against the day's figure", () => {
  const rows = [
    row("2026-10-01", "Food", 9500), row("2026-10-02", "Food", 9000), row("2026-10-03", "Food", 12000), row("2026-10-05", "food", 9500),
    row("2026-10-01", "Water", 2500), row("2026-10-03", "Water", 2500), row("2026-10-04", "Water", 2500),
    row("2026-10-02", "Restaurant", 247500),
    row("2026-10-01", "Internet", 99900, "Bills"), row("2026-09-01", "Internet", 99900, "Bills"), row("2026-08-01", "Internet", 99900, "Bills"),
    row("2026-07-01", "Food", 1000),
  ];

  it("takes the middle purchase of what is bought often, bills apart", () => {
    const prices = everydayPrices(rows, "2026-10-07");
    expect(prices.map((p) => [p.name, p.usual, p.count])).toEqual([
      ["food", 9500, 4],
      ["Water", 2500, 3],
    ]);
  });

  it("says each one fits or by how much it does not, from the Dashboard's figures", () => {
    const lines = pricesAgainstDay(everydayPrices(rows, "2026-10-07"), { today: 8064, after: 8064, daysLeft: 25 }, php);
    expect(lines[0]).toBe("- food: usually PHP 95.00 a time (4 times in 60 days, PHP 90.00 to PHP 120.00). Does not fit today's PHP 80.64: it is PHP 14.36 more.");
    expect(lines[1]).toBe("- Water: usually PHP 25.00 a time (3 times in 60 days). Fits today's PHP 80.64, with PHP 55.64 to spare.");
    expect(lines[2]).toBe("1 of these 2 fit today's figure.");
  });
});

describe("what a purchase today leaves", () => {
  const safe = { safe: 201601, spentToday: 0, daysLeft: 25, perDay: 8064 };

  it("leaves tomorrow's rate alone when it fits today's figure", () => {
    const after = safeAfter(safe, 2500);
    expect(after.fitsToday).toBe(true);
    expect(after.safe).toBe(199101);
    expect(after.perDay).toBe(5564);
    expect(after.perDayAfter).toBe(8064);
  });

  it("spreads what is left over the days after when it goes past today's figure", () => {
    const after = safeAfter(safe, 9500);
    expect(after.fitsToday).toBe(false);
    expect(after.overToday).toBe(1436);
    expect(after.perDayAfter).toBe(Math.floor(192101 / 24));
  });

  it("says how much more than is safe a purchase is", () => {
    const after = safeAfter(safe, 300000);
    expect(after.safe).toBe(0);
    expect(after.short).toBe(98399);
    expect(after.perDayAfter).toBe(0);
  });
});
