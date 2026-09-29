/**
 * A whole day in one message, however it is worded.
 *
 * The owner, 29 September 2026, planning to send: "I paid for gas using cash
 * 250. I paid 150 for my school and honorarium 300 both in 450 total in
 * school for our final capstonedefense. Then i ate lunch 95 and buy water 25
 * and also i withdraw from maya 1000 16 fee", and "i will use different
 * grammar later ... dont hard code this". It came out as three cards. These
 * read the same day five ways and pin that each is the same six entries, and
 * that what must stay together does.
 */

import { describe, expect, it } from "vitest";

import { partsTheModelMissed, readTotals, totalWords } from "./entryTotals";
import { formatMoney } from "./money";
import { readEntry, splitEntries } from "./readEntry";
import type { ReferenceLists, Transaction } from "./types";

const reference: ReferenceLists = {
  wallets: ["Cash", "Gcash", "Maya"],
  savings: ["Maya Bank (Personal savings)"],
  bills: [],
  subscriptions: [],
  revenueCategories: ["Allowance"],
  spendingTypes: [
    { name: "Food", remark: "Meals, snacks, drinks" },
    { name: "Gas", remark: "" },
    { name: "School", remark: "" },
  ],
  credits: ["Maya Credit"],
};

let n = 0;
const past = (item: string, description: string, amount: number): Transaction => {
  n += 1;
  return { id: `d${n}`, recordNumber: n, date: "2026-09-10", type: "Spending", fromWallet: "Cash", toWallet: "", category: "Spending", item, description, amount, fee: 0, total: amount, notes: "", status: "Paid" };
};
const history = [past("Food", "lunch", 9000), past("Food", "water", 2500), past("School", "honorarium", 30000), past("Gas", "gas", 25000), past("School", "school project", 15000)];

const read = (message: string) =>
  splitEntries(message).map((part) => {
    const r = readEntry(part, history, reference, "2026-09-29");
    return { flow: r.draft.flow, item: r.draft.item, amount: r.draft.amount, fee: r.draft.fee, from: r.draft.fromWallet, to: r.draft.toWallet, entry: r.worthOffering };
  });

const DAY = [
  { flow: "Spending", item: "Gas", amount: 25_000, fee: 0 },
  { flow: "Spending", item: "School", amount: 15_000, fee: 0 },
  { flow: "Spending", item: "School", amount: 30_000, fee: 0 },
  { flow: "Spending", item: "Food", amount: 9_500, fee: 0 },
  { flow: "Spending", item: "Food", amount: 2_500, fee: 0 },
  { flow: "Transfer", item: "", amount: 100_000, fee: 1_600, from: "Maya", to: "Cash" },
];

describe("the same day, five ways", () => {
  it.each([
    "I paid for gas using cash 250. I paid 150 for my school and honorarium 300 both in 450 total in school for our final capstonedefense. Then i ate lunch 95 and buy water 25 and also i withdraw from maya 1000 16 fee",
    "gas 250 cash, school 150 and honorarium 300 (450 total) for capstone defense, lunch 95, water 25, withdrew 1000 from maya with 16 fee",
    "Paid 250 gas (cash). Then paid school 150 and 300 honorarium, total 450 for the capstone. Lunch 95, water 25. Withdrew 1000 from Maya, fee 16.",
    "I spent 250 on gas with cash, 150 for school, 300 for honorarium (total 450), 95 for lunch, 25 for water, then I withdrew 1000 from maya with a 16 fee",
  ])("%s", (message) => {
    const got = read(message);
    expect(got).toHaveLength(6);
    expect(got.every((g) => g.entry)).toBe(true);
    got.forEach((g, i) => expect(g).toMatchObject(DAY[i]!));
    expect(got[0]?.from).toBe("Cash");
  });

  it("in Tagalog and English together", () => {
    const got = read("nagbayad ako ng gas 250 cash. school 150 at honorarium 300, 450 lahat. kumain ng lunch 95 tapos bumili ng tubig 25. nag-withdraw ako sa maya 1000 may 16 fee");
    expect(got.map((g) => g.amount)).toEqual([25_000, 15_000, 30_000, 9_500, 2_500, 100_000]);
    expect(got[5]).toMatchObject({ flow: "Transfer", fee: 1_600, from: "Maya", to: "Cash" });
  });

  it("says the total is the two school payments, not the whole day", () => {
    const words = totalWords(readTotals(DAYS_FIRST), formatMoney);
    expect(words).toBe("₱450.00 is ₱150.00 and ₱300.00 together, so it is not an entry of its own.");
  });
});

const DAYS_FIRST =
  "I paid for gas using cash 250. I paid 150 for my school and honorarium 300 both in 450 total in school for our final capstonedefense. Then i ate lunch 95 and buy water 25 and also i withdraw from maya 1000 16 fee";

describe("what stays together", () => {
  it.each([
    ["a fee after a comma", "Withdrew 1000 from Maya, fee 16.", 1],
    ["a fee after and", "sent 1000 to gcash and 15 fee", 1],
    ["two things bought for one price", "I paid 250 for gas and food", 1],
    ["a number in words", "I spent a hundred and twenty on lunch", 1],
    ["a date before the figure", "on sept 29, I paid 300 for lunch", 1],
    ["a count before the price", "bought 2 shirts, 300 each", 1],
  ])("%s", (_, message, parts) => {
    expect(splitEntries(message).filter((p) => readEntry(p, history, reference, "2026-09-29").worthOffering)).toHaveLength(parts);
  });

  it("keeps a wallet with a figure in it to its own clause", () => {
    const got = read("i ate lunch 95 and also i withdraw from maya 1000 16 fee");
    expect(got[0]).toMatchObject({ amount: 9_500, fee: 0 });
    expect(got[0]?.from).not.toBe("Maya");
  });

  it("puts cash taken out into Cash, unless it says where it went", () => {
    expect(read("withdrew 500 from gcash")[0]).toMatchObject({ flow: "Transfer", from: "Gcash", to: "Cash" });
    expect(read("withdrew 500 from gcash to maya")[0]).toMatchObject({ from: "Gcash", to: "Maya" });
  });
});

describe("the model's cards and the device's reading", () => {
  const parts = [25_000, 15_000, 30_000, 9_500, 2_500].map((amount) => ({ amount, fee: 0 }));

  it("adds only what the model left out", () => {
    const cards = [{ amount: 25_000, fee: 0 }, { amount: 30_000, fee: 0 }, { amount: 2_500, fee: 0 }];
    expect(partsTheModelMissed(parts, cards)).toEqual([1, 3]);
  });

  it("counts a card with its fee inside the figure as the same money", () => {
    expect(partsTheModelMissed([{ amount: 100_000, fee: 1_600 }], [{ amount: 101_600, fee: 0 }])).toEqual([]);
  });

  it("adds nothing when the model found them all", () => {
    expect(partsTheModelMissed(parts, parts)).toEqual([]);
  });
});
