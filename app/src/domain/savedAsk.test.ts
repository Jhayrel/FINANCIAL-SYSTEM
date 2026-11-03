/** "What did I save this month?" answered from the ledger (3 November 2026). Invented rows. */
import { describe, expect, it } from "vitest";

import { readSavedAsk, savedAnswer } from "./savedAsk";
import type { Transaction } from "./types";

const t = (n: number, date: string, type: string, from: string, to: string, amount: number): Transaction =>
  ({ id: `t${n}`, recordNumber: n, date, type, fromWallet: from, toWallet: to, category: "", item: type === "Revenue" ? "Bank interest" : "", description: "", amount, fee: 0, total: amount, notes: "", status: "" }) as Transaction;
const rows = [
  t(1, "2026-11-03", "Transfer", "Wallet A", "Bank (Savings)", 150_000),
  t(2, "2026-11-03", "Revenue", "", "Bank (Savings)", 296),
  t(3, "2026-10-10", "Transfer", "Wallet A", "Bank (Savings)", 100_000),
  t(4, "2026-10-20", "Transfer", "Bank (Savings)", "Wallet A", 40_000),
  t(5, "2026-11-02", "Revenue", "", "Wallet A", 1_000_000),
];
const wallets = ["Wallet A"];
const savings = ["Bank (Savings)"];

describe("what was saved", () => {
  it("reads the question and its period, and leaves plans and amounts alone", () => {
    expect(readSavedAsk("what did i save this month", "2026-11-03")).toMatchObject({ from: "2026-11-01", to: "2026-11-03" });
    expect(readSavedAsk("how much did I put into savings last month?", "2026-11-03")).toMatchObject({ from: "2026-10-01", to: "2026-10-31" });
    expect(readSavedAsk("magkano naipon ko this year", "2026-11-03")?.from).toBe("2026-01-01");
    expect(readSavedAsk("I am planning to save 1500 from my salary", "2026-11-03")).toBeNull();
    expect(readSavedAsk("how much should i save to buy a phone", "2026-11-03")).toBeNull();
  });

  it("this month: the deposit by account and record, interest apart", () => {
    expect(savedAnswer(readSavedAsk("what did i save this month", "2026-11-03")!, rows, wallets, savings)).toBe(
      "In November 2026 so far you moved ₱1,500.00 into savings: ₱1,500.00 into Bank (Savings) (#0001). Nothing was taken back out. On top of that, ₱2.96 came straight into savings (interest and the like). Counted from November 1, 2026 to November 3, 2026.",
    );
  });

  it("last month: what came back out is taken off", () => {
    expect(savedAnswer(readSavedAsk("what did i save last month", "2026-11-03")!, rows, wallets, savings)).toMatch(/moved ₱1,000\.00 into savings.*₱400\.00 was taken back out to your wallets, so savings grew by ₱600\.00/);
  });
});
