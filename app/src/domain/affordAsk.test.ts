/**
 * "Can I afford it?", from the owner's own sentences of 27 September 2026,
 * on invented figures. Each was sent to the entry reader and answered "How
 * much was it?", or answered from the budget, a yes and a no a minute apart.
 */

import { describe, expect, it } from "vitest";

import { affordAnswer, goesByBalance, isAffordQuestion, readAffordAsk, usualCost } from "./affordAsk";
import { detectIntent, isQuestion } from "./intent";
import type { Budgets, ReferenceLists, Transaction } from "./types";

const TODAY = "2026-09-27";
let n = 0;
const row = (over: Partial<Transaction>): Transaction => {
  n += 1;
  return {
    id: `r${n}`,
    recordNumber: n,
    date: "2026-09-10",
    type: "Spending",
    fromWallet: "",
    toWallet: "",
    category: "Spending",
    item: "",
    description: "",
    amount: 0,
    fee: 0,
    total: 0,
    notes: "",
    status: "",
    ...over,
  };
};

const reference: ReferenceLists = {
  wallets: ["Cash", "Maya", "Gcash"],
  savings: ["Savings"],
  bills: [],
  subscriptions: [],
  revenueCategories: [],
  spendingTypes: [{ name: "Gas", remark: "" }, { name: "Food", remark: "" }, { name: "School", remark: "" }],
};

const rows: Transaction[] = [
  row({ date: "2026-09-01", type: "Revenue", category: "Revenue", item: "Allowance", toWallet: "Maya", amount: 400000, total: 400000 }),
  row({ date: "2026-09-01", type: "Revenue", category: "Revenue", item: "Allowance", toWallet: "Cash", amount: 107500, total: 107500 }),
  row({ date: "2026-09-05", item: "Gas", fromWallet: "Cash", amount: 20000, total: 20000 }),
  row({ date: "2026-09-12", item: "Gas", fromWallet: "Cash", amount: 20000, total: 20000 }),
  row({ date: "2026-09-19", item: "Gas", fromWallet: "Cash", amount: 30000, total: 30000 }),
  row({ date: "2026-09-20", item: "Food", fromWallet: "Maya", amount: 15000, total: 15000 }),
  row({ date: "2026-09-21", item: "Food", fromWallet: "Maya", amount: 10000, total: 10000 }),
];
// Cash 1,075.00 - 700.00 = 375.00. Maya 4,000.00 - 250.00 = 3,750.00.

// A spending budget of 500.00 for September, already ₱450.00 over.
const budgets: Budgets = {
  "2026": { spending: [0, 0, 0, 0, 0, 0, 0, 0, 50000, 0, 0, 0], billsSubs: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
} as unknown as Budgets;

const input = { transactions: rows, reference, budgets, debts: [], asOf: TODAY };

describe("the owner's sentences are questions, never entries", () => {
  const said = [
    "how much I can spare tommorrow for my school? can I afford gas and food?",
    "so with my current balance, what can I afford",
    "so with my current balance, what can I afford. like what can i buy or need tommorrow i need amout",
    "I am asking not adding ledger",
    "I need gas for tommorrow can I affored it? with my current balance not with the budget. I cannot travel if I dont have gas",
    "i spend 100 cash can i?",
    "based on balance not budget",
  ];

  it.each(said)("%s", (s) => {
    expect(isQuestion(s)).toBe(true);
    expect(detectIntent(s)).toBe("ask");
  });

  it("while an entry is still an entry", () => {
    expect(isQuestion("I paid 200 for gas using cash")).toBe(false);
    expect(detectIntent("I paid 200 for gas using cash")).toBe("log");
  });
});

describe("recognising it", () => {
  it("asks about affording, wherever the words are", () => {
    expect(isAffordQuestion("so with my current balance, what can I afford")).toBe(true);
    expect(isAffordQuestion("I need gas for tommorrow can I affored it?")).toBe(true);
    expect(isAffordQuestion("i spend 100 cash can i?")).toBe(true);
    expect(isAffordQuestion("how much did I spend on gas")).toBe(false);
  });

  it("knows a follow-up that says which figure to go by", () => {
    expect(goesByBalance("based on balance not budget")).toBe(true);
    expect(goesByBalance("I am asking not adding ledger")).toBe(true);
    expect(goesByBalance("gas only")).toBe(false);
  });

  it("reads the things, the figure, the wallet and the day", () => {
    const ask = readAffordAsk("i spend 100 cash can i?", rows, reference, TODAY);
    expect(ask).toMatchObject({ amount: 10000, wallet: "Cash", items: [] });
    const gas = readAffordAsk("I need gas for tommorrow can I affored it?", rows, reference, TODAY);
    expect(gas).toMatchObject({ items: ["Gas"], amount: null, when: "tomorrow" });
  });

  it("goes by what a thing usually costs, the middle of the last ninety days", () => {
    expect(usualCost(rows, "Gas", TODAY)).toBe(20000);
    expect(usualCost(rows, "Food", TODAY)).toBe(12500);
  });
});

describe("the answer goes by what is held, and says the budget apart", () => {
  it("says yes to gas when the wallets cover it, however far over the budget is", () => {
    const text = affordAnswer(readAffordAsk("can I afford gas tomorrow", rows, reference, TODAY), input);
    expect(text.startsWith("Yes, going by what you hold for tomorrow.")).toBe(true);
    expect(text).toContain("Your spending wallets hold ₱4,125.00 (Cash ₱375.00, Maya ₱3,750.00)");
    expect(text).toContain("Gas usually costs you ₱200.00");
    expect(text).toContain("which leaves ₱3,925.00 free");
    // The budget, as the budget, in the same answer.
    expect(text).toContain("On the budget it is a different answer: September's spending is already ₱450.00 over its budget, so this adds to that.");
    expect(text).toContain("The balance says whether you can pay; the budget says whether you planned to.");
  });

  it("answers from the one wallet named", () => {
    const text = affordAnswer(readAffordAsk("i spend 100 cash can i?", rows, reference, TODAY), input);
    expect(text).toContain("Cash holds ₱375.00.");
    expect(text).toContain("After ₱100.00 you would have ₱275.00 left in Cash.");
  });

  it("says no when the wallet cannot cover it", () => {
    const text = affordAnswer(readAffordAsk("can I afford 500 from cash", rows, reference, TODAY), input);
    expect(text.startsWith("No. Cash holds ₱375.00.")).toBe(true);
    expect(text).toContain("₱125.00 more than that");
  });

  it("says how much is free, and per day, when nothing is named", () => {
    const text = affordAnswer(readAffordAsk("so with my current balance, what can I afford", rows, reference, TODAY), input);
    expect(text).toContain("So you can spend up to ₱4,125.00 and still cover what is due");
    expect(text).toContain("a day for the 4 days left in September");
  });

  it("adds up two things named together", () => {
    const text = affordAnswer(readAffordAsk("can I afford gas and food?", rows, reference, TODAY), input);
    expect(text).toContain("Gas usually costs you ₱200.00, and Food usually costs you ₱125.00, so together about ₱325.00");
  });
});
