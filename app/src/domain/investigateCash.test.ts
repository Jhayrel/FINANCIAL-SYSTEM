/**
 * Find a difference on a cash account. 3 October 2026, the owner: Cash said
 * PHP 760.00 and really held PHP 1,100.00. Breakfast and the next day's lunch
 * were called "entered a second time", water bought on two days likewise,
 * and cash was offered bank interest. Rows are invented, in the same shape.
 */
import { describe, expect, it } from "vitest";

import { walletBalance } from "./balances";
import { choicesForClue, clueWords, investigate } from "./investigate";
import type { Transaction } from "./types";

let n = 0;
const cash = (date: string, item: string, description: string, amount: number, over: Partial<Transaction> = {}): Transaction => {
  n += 1;
  return {
    id: `k${n}`, recordNumber: 3800 + n, date, type: "Spending", fromWallet: "Cash", toWallet: "", category: "Spending",
    item, description, amount, fee: 0, total: amount, notes: "", status: "Paid", ...over,
  };
};
const into = (date: string, amount: number): Transaction => cash(date, "Allowance", "cash from father", amount, { type: "Revenue", fromWallet: "", toWallet: "Cash", category: "Revenue", status: "Received" });

const ASOF = "2026-10-03";
const days = [
  into("2026-09-01", 1_000_000),
  cash("2026-09-27", "Unknown", "Cash spending not written down at the time", 352_300),
  cash("2026-09-28", "Food", "breakfast", 9_500),
  cash("2026-09-28", "Food", "purchase water", 2_500),
  cash("2026-09-29", "Food", "ate lunch", 9_500),
  cash("2026-09-29", "Food", "water purchase", 2_500),
  cash("2026-09-30", "Food", "water purchase", 2_500),
  cash("2026-09-29", "School", "contribution for the defense", 15_000),
];
const recorded = walletBalance(days, "Cash");

describe("entered twice, on cash", () => {
  it("is never two meals because both are Food", () => {
    const result = investigate({ transactions: days, account: "Cash", actual: recorded + 34_000, asOf: ASOF });
    expect(result.found.filter((c) => c.kind === "duplicate")).toEqual([]);
  });

  it("is never a daily habit, even said in the same words", () => {
    // Water three days running is a habit; the third is not the second again.
    const result = investigate({ transactions: days, account: "Cash", actual: recorded + 2_500, asOf: ASOF });
    expect(result.found.filter((c) => c.kind === "duplicate")).toEqual([]);
  });

  it("is still the same entry saved twice on one day", () => {
    const twice = [...days, cash("2026-09-29", "School", "contribution for the defense", 15_000)];
    const result = investigate({ transactions: twice, account: "Cash", actual: recorded, asOf: ASOF });
    expect(result.found.map((c) => c.kind)).toEqual(["duplicate"]);
  });

  it("is the very same words a day apart, when that is not a habit", () => {
    const posted = [...days, cash("2026-09-30", "School", "contribution for the defense", 15_000)];
    const result = investigate({ transactions: posted, account: "Cash", actual: recorded, asOf: ASOF });
    expect(result.found.map((c) => c.kind)).toEqual(["duplicate"]);
  });
});

describe("more cash in hand than recorded", () => {
  const result = investigate({ transactions: days, account: "Cash", actual: recorded + 34_000, asOf: ASOF });

  it("looks first at the owner's own estimate of spending not written down", () => {
    const estimate = result.possible.find((c) => c.kind === "estimate");
    expect(estimate && clueWords(estimate)).toBe(
      "#3802 Unknown on September 27, 2026, ₱3,523.00, was an estimate of spending not written down. If ₱340.00 of it was never spent, lowering it to ₱3,183.00 settles the difference.",
    );
  });

  it("never offers cash bank interest", () => {
    const unrecorded = result.possible.find((c) => c.kind === "unrecorded");
    expect(unrecorded).toBeDefined();
    if (!unrecorded) return;
    expect(clueWords(unrecorded)).not.toMatch(/interest/);
    expect(clueWords(unrecorded)).toContain("more cash than recorded");
    expect(choicesForClue(unrecorded, "Cash", ASOF, "Interest").map((c) => c.label)).toEqual(["Add as income", "Someone paid me back"]);
  });

  it("still offers interest on a bank account", () => {
    const bank = days.map((t) => ({ ...t, fromWallet: t.fromWallet && "Maya", toWallet: t.toWallet && "Maya" }));
    const onBank = investigate({ transactions: bank, account: "Maya", actual: walletBalance(bank, "Maya") + 5_00, asOf: ASOF });
    const unrecorded = onBank.possible.find((c) => c.kind === "unrecorded");
    expect(unrecorded && choicesForClue(unrecorded, "Maya", ASOF, "Interest").map((c) => c.label)[0]).toBe("Add as interest");
  });
});
