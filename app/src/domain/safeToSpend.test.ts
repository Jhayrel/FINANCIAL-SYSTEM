/**
 * Safe to spend, as the owner put it on 6 October 2026: "5000 money then
 * 1700 alloted for subscription and bills then I have 3,300 safe to spend
 * and the safe to spend today is ...". Rows and budgets are invented.
 */
import { describe, expect, it } from "vitest";

import { buildContext, contextToText } from "./aiContext";
import { monthBrief } from "./monthPlan";
import type { Budgets, ReferenceLists, Transaction } from "./types";

const reference: ReferenceLists = {
  wallets: ["Cash", "Wallet B"],
  savings: ["Savings"],
  bills: ["Internet"],
  subscriptions: ["Music"],
  revenueCategories: ["Allowance"],
  spendingTypes: [{ name: "Food", remark: "" }],
};

let n = 0;
const row = (over: Partial<Transaction>): Transaction => {
  n += 1;
  const amount = over.amount ?? 0;
  return {
    id: `t${n}`,
    recordNumber: n,
    date: "2026-09-01",
    type: "Spending",
    fromWallet: "Cash",
    toWallet: "",
    category: "Spending",
    item: "Food",
    description: "",
    fee: 0,
    notes: "",
    status: "",
    ...over,
    amount,
    total: amount + (over.fee ?? 0),
  };
};

// ₱5,000.00 held, ₱1,200.00 of internet and ₱500.00 of music due again this month: ₱1,700.00 in all.
const base: Transaction[] = [
  row({ date: "2026-08-25", type: "Revenue", fromWallet: "", toWallet: "Cash", category: "Revenue", item: "Allowance", amount: 670000 }),
  row({ date: "2026-08-24", category: "Bills", item: "Internet", amount: 120000 }),
  row({ date: "2026-08-23", category: "Subscriptions", item: "Music", amount: 50000 }),
];
const ASOF = "2026-09-21";
const twelve = (v: number) => Array.from({ length: 12 }, () => v) as unknown as Budgets[string]["spending"];

const safeAt = (extra: Transaction[], budgets: Budgets = {}) =>
  monthBrief({ transactions: [...base, ...extra], reference, budgets, debts: [], year: 2026, month: 9, asOf: ASOF });

describe("safe to spend is the money there, less what is still to pay", () => {
  it("is the owner's own sum: 5000 held, 1700 of bills and subscriptions, 3300 safe", () => {
    const safe = safeAt([]).safe;
    expect(safe?.wallets).toBe(500000);
    expect(safe?.reservedBills).toBe(170000);
    expect(safe?.safe).toBe(330000);
    expect(safe?.daysLeft).toBe(10);
    expect(safe?.perDay).toBe(33000);
    expect(safe?.perDayAfter).toBe(33000);
  });

  it("leaves savings out", () => {
    const safe = safeAt([row({ type: "Transfer", fromWallet: "Cash", toWallet: "Savings", category: "", item: "", amount: 100000, date: "2026-09-02" })]).safe;
    expect(safe?.wallets).toBe(400000);
    expect(safe?.safe).toBe(230000);
  });

  it("takes today's spending out of today's share and keeps tomorrow's", () => {
    const safe = safeAt([row({ date: ASOF, amount: 10000 })]).safe;
    expect(safe?.todayShare).toBe(33000);
    expect(safe?.spentToday).toBe(10000);
    expect(safe?.perDay).toBe(23000);
    expect(safe?.overToday).toBe(0);
    expect(safe?.perDayAfter).toBe(33000);
  });

  it("says how far today went past its share, and spreads the rest over the days after", () => {
    const brief = safeAt([row({ date: ASOF, amount: 120000 })]);
    const safe = brief.safe;
    expect(safe?.safe).toBe(210000);
    expect(safe?.perDay).toBe(0);
    expect(safe?.overToday).toBe(120000 - 33000);
    expect(safe?.perDayAfter).toBe(Math.floor(210000 / 9));
    expect(brief.notes.some((note) => note.includes("past it"))).toBe(true);
  });

  it("counts a transfer's fee as today's spending, and the money moved between wallets not at all", () => {
    const safe = safeAt([row({ date: ASOF, type: "Transfer", fromWallet: "Cash", toWallet: "Wallet B", category: "", item: "", amount: 100000, fee: 1500 })]).safe;
    expect(safe?.spentToday).toBe(1500);
    expect(safe?.wallets).toBe(500000 - 1500);
  });

  it("does not count a bill paid today as spending: it was set aside already", () => {
    const before = safeAt([]).safe;
    const paid = safeAt([row({ date: ASOF, category: "Bills", item: "Internet", amount: 120000 })]).safe;
    expect(paid?.reservedBills).toBe(50000);
    expect(paid?.spentToday).toBe(0);
    expect(paid?.safe).toBe(before?.safe);
    expect(paid?.perDay).toBe(before?.perDay);
  });

  it("is never lowered by the budget, which is said beside it when it is tighter", () => {
    const budgets: Budgets = { "2026": { spending: twelve(100000), billsSubs: twelve(170000) } };
    const brief = safeAt([row({ date: "2026-09-05", amount: 40000 })], budgets);
    expect(brief.safe?.safe).toBe(290000);
    expect(brief.safe?.budgetLeft).toBe(60000);
    expect(brief.safe?.budgetPerDay).toBe(6000);
    expect(brief.safe?.limitedBy).toBe("budget");
    expect(brief.notes.some((note) => note.includes("₱60.00 a day keeps to it"))).toBe(true);
  });

  it("offers nothing when what is due is more than the wallets hold", () => {
    const brief = safeAt([row({ date: "2026-09-03", amount: 400000 })]);
    expect(brief.safe?.free).toBe(100000 - 170000);
    expect(brief.safe?.safe).toBe(0);
    expect(brief.safe?.perDay).toBe(0);
    expect(brief.safe?.perDayAfter).toBe(0);
  });

  it("is what the assistant is told, as the app's own figure", () => {
    const transactions = [...base, row({ date: ASOF, amount: 10000 })];
    const text = contextToText(
      buildContext({ transactions, accounts: [], budgets: {}, credits: [], reference, lowBalanceThreshold: 0, asOf: ASOF }),
    );
    expect(text).toContain("## Safe to spend");
    expect(text).toContain("PHP 3,200.00 is safe to spend until September ends");
    expect(text).toContain("Safe to spend today: PHP 230.00");
    expect(text).toContain("From tomorrow, Tuesday, September 22: PHP 330.00 a day");
    // The day in words, and the days either side (6 October 2026).
    expect(text).toContain("Today is Monday, September 21, 2026 (2026-09-21). Yesterday was Sunday, September 20; tomorrow is Tuesday, September 22.");
    expect(text).toContain("(Music PHP 500.00, Internet PHP 1,200.00)");
    expect(text).not.toContain("the day's figure the app shows");
  });
});

describe("the newest budget change, for \"the new budget\"", () => {
  it("is told to the assistant with what it was before", () => {
    const budgets: Budgets = {
      "2026": {
        spending: twelve(1_500_000),
        billsSubs: twelve(170_000),
        revisions: {
          "9": [
            { at: "2026-09-01T10:00:00.000Z", what: "tracks", spending: 600_000, billsSubs: 170_000, wasSpending: 0, wasBillsSubs: 0, when: "open" },
            { at: "2026-09-20T23:51:06.000Z", what: "tracks", spending: 1_500_000, billsSubs: 170_000, wasSpending: 600_000, wasBillsSubs: 170_000, when: "open" },
            { at: "2026-09-20T23:54:00.000Z", what: "limit", name: "Food", limit: 300_000, wasLimit: 0, when: "open" },
          ],
        },
      },
    };
    const snap = buildContext({ transactions: base, accounts: [], budgets, credits: [], reference, lowBalanceThreshold: 0, asOf: ASOF });
    expect(snap.lastBudgetChange).toEqual({ on: "2026-09-20", month: "September 2026", spending: 15_000, billsSubs: 1_700, wasSpending: 6_000, wasBillsSubs: 1_700 });
    expect(contextToText(snap)).toContain('Newest budget change, 2026-09-20: September 2026 spending PHP 15,000.00 (was PHP 6,000.00)');
  });

  it("is left out when the newest is more than a month old", () => {
    const budgets: Budgets = {
      "2026": {
        spending: twelve(0),
        billsSubs: twelve(0),
        revisions: { "6": [{ at: "2026-06-01T10:00:00.000Z", what: "tracks", spending: 1, billsSubs: 1, wasSpending: 0, wasBillsSubs: 0, when: "open" }] },
      },
    };
    expect(buildContext({ transactions: base, accounts: [], budgets, credits: [], reference, lowBalanceThreshold: 0, asOf: ASOF }).lastBudgetChange).toBeNull();
  });
});

describe("today, yesterday and tomorrow, for the assistant", () => {
  it("names each day and what happened in it, and what falls due", async () => {
    const { buildChatContext } = await import("./aiChatContext");
    const transactions = [
      ...base,
      row({ date: "2026-09-20", amount: 54_500, fromWallet: "Wallet B", description: "lunch" }),
      row({ date: ASOF, amount: 10_000 }),
      row({ date: ASOF, type: "Transfer", fromWallet: "Wallet B", toWallet: "Cash", category: "", item: "", amount: 200_000, fee: 1_800 }),
    ];
    const snapshot = buildContext({ transactions, accounts: [], budgets: {}, credits: [], reference, lowBalanceThreshold: 0, asOf: ASOF });
    const text = buildChatContext({ snapshot, transactions, asOf: ASOF, question: "how much did I spend yesterday" }).text;
    expect(text).toContain("## Today, yesterday and tomorrow");
    expect(text).toContain("Today so far, Monday, September 21: Food PHP 100.00 from Cash; moved PHP 2,000.00 from Wallet B to Cash, fee PHP 18.00.");
    expect(text).toContain("Yesterday, Sunday, September 20: Food PHP 545.00 from Wallet B.");
    // Music and Internet were last paid 23 and 24 August, so they fall due two and three days off, said by weekday.
    expect(text).toContain(
      "Tomorrow, Tuesday, September 22: due soon, Music PHP 500.00 on Wednesday, September 23, Internet PHP 1,200.00 on Thursday, September 24.",
    );
  });
});
