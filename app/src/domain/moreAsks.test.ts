/**
 * Four things the assistant can now answer itself (26 October 2026: "fix
 * more the ai capabilities like I want it to do more"): bills due, a savings
 * goal, the week, and the last time. Rows are invented; 25 October 2026 is a
 * Sunday.
 */
import { describe, expect, it } from "vitest";

import { billsAnswer, readBillsAsk } from "./billsAsk";
import { goalAnswer, readGoalAsk } from "./goalAsk";
import { lastTimeAnswer, readLastTimeAsk } from "./lastTimeAsk";
import { formatMoney } from "./money";
import type { ReferenceLists, Transaction } from "./types";
import { readWeekAsk, weekAnswer } from "./weekAsk";

const reference: ReferenceLists = {
  wallets: ["Cash", "Gcash", "Maya"],
  savings: [],
  bills: ["Globe at Home Wifi"],
  subscriptions: ["Spotify"],
  revenueCategories: ["Allowance"],
  spendingTypes: [{ name: "Food", remark: "" }, { name: "Gas", remark: "" }],
};

let n = 0;
const row = (over: Partial<Transaction>): Transaction => {
  n += 1;
  const amount = over.amount ?? 10000;
  return {
    id: `r${n}`, recordNumber: n, date: "2026-10-01", type: "Spending", fromWallet: "Cash", toWallet: "", category: "Spending",
    item: "Food", description: "", fee: 0, notes: "", status: "Paid", ...over, amount, total: amount + (over.fee ?? 0),
  };
};
const income = (date: string, amount: number) => row({ date, type: "Revenue", fromWallet: "", toWallet: "Gcash", category: "Revenue", item: "Allowance", amount, status: "Received" });

const ledger: Transaction[] = [
  income("2026-07-01", 2000000), income("2026-08-01", 2000000), income("2026-09-01", 2000000), income("2026-10-01", 2000000),
  row({ date: "2026-07-10", amount: 1500000 }), row({ date: "2026-08-10", amount: 1500000 }), row({ date: "2026-09-10", amount: 1500000 }),
  row({ date: "2026-09-12", fromWallet: "Maya", category: "Bills", item: "Globe at Home Wifi", amount: 99900 }),
  row({ date: "2026-09-03", fromWallet: "Maya", category: "Subscriptions", item: "Spotify", amount: 8500 }),
  row({ date: "2026-10-03", fromWallet: "Maya", category: "Subscriptions", item: "Spotify", amount: 8500 }),
  row({ date: "2026-10-13", item: "Gas", amount: 20000, description: "Gas" }),
  row({ date: "2026-10-20", item: "Gas", amount: 15000, description: "Gas" }),
  row({ date: "2026-10-20", fromWallet: "Maya", amount: 39500, description: "Jollibee JB3829" }),
  row({ date: "2026-10-23", amount: 12000, description: "Lunch" }),
  row({ date: "2026-10-16", amount: 50000, description: "Groceries" }),
];
const asOf = "2026-10-25";
const money = formatMoney;

describe("bills due", () => {
  const names = [...reference.bills, ...reference.subscriptions];
  it("reads the question, and leaves budgets alone", () => {
    expect(readBillsAsk("what bills are due?", names)).toEqual({ name: null, week: false });
    expect(readBillsAsk("anything to pay this week?", names)).toEqual({ name: null, week: true });
    expect(readBillsAsk("did I pay globe this month?", names)).toEqual({ name: "Globe at Home Wifi", week: false });
    expect(readBillsAsk("set my bills budget to 2000", names)).toBeNull();
    expect(readBillsAsk("how much did I spend on food?", names)).toBeNull();
  });

  it("says what is still to pay with its date, and what is paid", () => {
    const text = billsAnswer({ name: null, week: false }, { transactions: ledger, reference, asOf }, money);
    expect(text).toContain("**Still to pay this month: ₱999.00**");
    expect(text).toContain("- Globe at Home Wifi: ₱999.00, late since Monday, October 12");
    expect(text).toContain("Paid this month: Spotify ₱85.00 (Saturday, October 3)");
  });

  it("answers one bill by name", () => {
    expect(billsAnswer({ name: "Spotify", week: false }, { transactions: ledger, reference, asOf }, money)).toBe("Yes: Spotify is paid this month, ₱85.00 on Saturday, October 3.");
    expect(billsAnswer({ name: "Globe at Home Wifi", week: false }, { transactions: ledger, reference, asOf }, money)).toContain('Say "paid Globe at Home Wifi 999"');
  });
});

describe("a savings goal", () => {
  it("reads the figure and the date", () => {
    expect(readGoalAsk("I want to save 5000 by december", asOf)).toMatchObject({ target: 500000, by: "2026-12-31" });
    expect(readGoalAsk("how long to save 10k?", asOf)).toMatchObject({ target: 1000000, by: null });
    expect(readGoalAsk("save 3000 in 2 months for a new phone", asOf)).toMatchObject({ target: 300000, by: "2026-12-25", purpose: "a new phone".replace(/^a /, "") });
    expect(readGoalAsk("how much did I save in september?", asOf)).toBeNull();
  });

  it("works out a day, a week and a month, against what the last three months kept", () => {
    const text = goalAnswer({ target: 500000, by: "2026-12-31", purpose: "" }, { transactions: ledger, reference, budgets: {}, debts: [], asOf }, money);
    expect(text).toContain("**To have ₱5,000.00 by December 31, 2026: ₱74.63 a day** for 67 days, about ₱522.41 a week or ₱2,238.81 a month.");
    expect(text).toMatch(/kept ₱[\d,]+\.\d{2} a month on average/);
    expect(text).toContain("At that pace it fits");
  });

  it("says how long without a date", () => {
    const text = goalAnswer({ target: 1000000, by: null, purpose: "" }, { transactions: ledger, reference, budgets: {}, debts: [], asOf }, money);
    expect(text).toMatch(/^\*\*About \d+ months?\*\* to save ₱10,000\.00 at your recent pace/);
  });
});

describe("the week", () => {
  it("reads how was my week, and not a chart of it", () => {
    expect(readWeekAsk("how was my week?")).toEqual({ last: false });
    expect(readWeekAsk("review last week")).toEqual({ last: true });
    expect(readWeekAsk("chart this week")).toBeNull();
  });

  it("says this week so far against the same days last week", () => {
    const text = weekAnswer({ last: false }, ledger, asOf, money);
    expect(text).toContain("**This week so far (7 days): ₱665.00 spent**, ₱95.00 a day.");
    expect(text).toContain("₱35.00 less than the same days last week (₱700.00).");
    expect(text).toContain("Most of it: Food ₱515.00, Gas ₱150.00");
    expect(text).toContain("Busiest day: Tuesday, October 20, ₱545.00. 5 days with nothing spent.");
  });
});

describe("the last time", () => {
  const items = ["Food", "Gas"];
  it("reads the thing, an item or a word, and leaves entries alone", () => {
    expect(readLastTimeAsk("how much did I pay for gas last time?", items)).toEqual({ item: "Gas", word: null, usual: false });
    expect(readLastTimeAsk("when did I last buy jollibee?", items)).toEqual({ item: null, word: "jollibee", usual: false });
    expect(readLastTimeAsk("gas 200 same as last time", items)).toBeNull();
    expect(readLastTimeAsk("last time you said 500", items)).toBeNull();
  });

  it("gives the last one, the usual, and the ones before", () => {
    const text = lastTimeAnswer({ item: "Gas", word: null, usual: false }, ledger, asOf, money);
    expect(text).toMatch(/^\*\*The last time: #\d{4} on Tuesday, October 20, Gas, ₱150\.00 from Cash\.\*\*/);
    expect(text).toContain("Usually ₱150.00, going by the last 2");
    expect(text).toContain("Before that: Tuesday, October 13 ₱200.00.");
    expect(lastTimeAnswer({ item: null, word: "jollibee", usual: false }, ledger, asOf, money)).toContain("(Jollibee JB3829), ₱395.00 from Maya");
  });
});

describe("a bill said by one word, when only one with it is still paid (26 October 2026)", () => {
  it("books 'I paid globe 999 using maya' to the Globe still being paid", async () => {
    const { readEntry, recurringIn } = await import("./readEntry");
    const two = { ...reference, bills: ["Globe at Home Wifi", "Globe Postpaid"] };
    expect(recurringIn("I paid globe 999 using maya", two.bills, ["Globe at Home Wifi"])).toBe("Globe at Home Wifi");
    expect(recurringIn("I paid globe 999 using maya", two.bills, [])).toBe("");
    expect(recurringIn("globe load 50", two.bills, ["Globe at Home Wifi"])).toBe("");
    const history = [
      row({ date: "2026-09-12", fromWallet: "Maya", category: "Bills", item: "Globe at Home Wifi", amount: 99900 }),
      row({ date: "2024-01-05", fromWallet: "Maya", category: "Bills", item: "Globe Postpaid", amount: 59900 }),
    ];
    expect(readEntry("I paid globe 999 using maya", history, two, "2026-10-25").draft).toMatchObject({ item: "Globe at Home Wifi", category: "Bills", amount: 99900, fromWallet: "Maya" });
  });
});
