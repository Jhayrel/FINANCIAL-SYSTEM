/**
 * The owner's sentences of 2 and 3 October 2026, and a picture's dates.
 *
 *   "all that entry is load. also check it its added allready mean dont
 *   add. this is all maya": five cards of Unknown.
 *   "if I recieved my salary woth 10k today how can I budget it? maya":
 *   ₱10,000.00 of income, twice, and "//I am asking" twice.
 *   A Maya history whose "Today" the reader lost: its newest row dated the
 *   day before.
 *
 * Ledger rows are invented.
 */
import { describe, expect, it } from "vitest";

import { financeAlerts } from "./alerts";
import { asksRatherThanTells } from "./budgetAsk";
import { emptyDraft } from "./entry";
import { isQuestion } from "./intent";
import { rowDatesIn } from "./ocrText";
import { datesFromHeadings, type Proposal } from "./proposal";
import { kindSaidForAll } from "./saidForAll";
import type { Budgets, Transaction } from "./types";

let n = 0;
const spend = (date: string, item: string, description: string, amount = 5_000): Transaction => {
  n += 1;
  return { id: `t${n}`, recordNumber: n, date, type: "Spending", fromWallet: "Wallet A", toWallet: "", category: "Spending", item, description, amount, fee: 0, total: amount, notes: "", status: "Paid" };
};
const reference = {
  wallets: ["Wallet A", "Cash"],
  savings: [],
  spendingTypes: [{ name: "Food", remark: "" }, { name: "Online Buy", remark: "" }, { name: "Emergency", remark: "" }, { name: "Unknown", remark: "" }],
};

describe("a kind said once for every row", () => {
  const history = [
    spend("2026-08-04", "Online Buy", "Buy load"),
    spend("2026-08-31", "Online Buy", "Buy load"),
    spend("2026-09-05", "Online Buy", "load purchase online"),
    spend("2026-09-20", "Emergency", "load"),
    spend("2024-05-07", "Load", "Buy Load"),
  ];

  it("is filed where the ledger has filed that word this past year", () => {
    const said = kindSaidForAll("all that entry is load. also check it its added allready mean dont add. this is all maya", history, reference, "2026-10-03");
    expect(said).toMatchObject({ item: "Online Buy", word: "load" });
    expect(said?.because).toContain("3 times this past year");
  });

  it("is a spending type by name, and never a wallet", () => {
    expect(kindSaidForAll("these are all food", [], reference, "2026-10-03")?.item).toBe("Food");
    expect(kindSaidForAll("this is all cash", history, reference, "2026-10-03")).toBeNull();
    expect(kindSaidForAll("all of them are mystery things", history, reference, "2026-10-03")).toBeNull();
  });
});

describe("asking what if, or how", () => {
  it("is a question, whatever comes after the question mark", () => {
    for (const s of [
      "if I recieved my salary woth 10k today how can I budget it? maya",
      "if I recieved my salary woth today how can I budget it? maya like my expected is 10k",
      "how should I split my allowance",
    ]) {
      expect(isQuestion(s), s).toBe(true);
    }
    for (const s of ["I spent 375 on treat today", "lunch 150 cash", "spent 100 on food? no 120"]) {
      expect(isQuestion(s), s).toBe(false);
    }
  });

  it("never sets a budget", () => {
    expect(asksRatherThanTells("if I recieved my salary woth today how can I budget it? maya like my expected is 10k and Allocate it. Question?")).toBe(true);
    expect(asksRatherThanTells("set my october budget to 9000")).toBe(false);
  });
});

describe("a history's dates, when the reader loses a heading", () => {
  // The way the device read a wallet history: the "Today" label gone, a comma with no space, a stray letter.
  const raised = [
    "Transactions",
    "Purchased on 36 mins ago",
    "SHOP - ₱100.00",
    "I October 02,2026",
    "Purchased on 05:09 PM",
    "SHOP - ₱100.00",
    "Purchased on 08:42 AM",
    "SHOP - ₱204.00",
    "[october 01,2026",
    "Sent money via 11:14 AM",
    "QR PAYMENT - ₱571.00",
  ].join("\n");
  const plain = ["Transactions", "SHOP - ₱100.00", "w October 02, 2026 P", "SHOP - ₱100.00", "SHOP - 204.00", "October 01, 2026", "QR PAYMENT - ₱571.00"].join("\n");

  it("dates a row said to be minutes ago as the day the picture was taken", () => {
    expect(rowDatesIn(raised, "2026-10-03").map((r) => r.date)).toEqual(["2026-10-03", "2026-10-02", "2026-10-02", "2026-10-01"]);
    expect(rowDatesIn("Bought 10 hours ago\nSHOP - ₱50.00", "2026-10-03")[0]?.date).toBe("");
  });

  it("puts each card on its own day, the two readings agreeing where they can", () => {
    const card = (amount: number): Proposal => ({
      draft: { ...emptyDraft("2026-10-02"), flow: "Spending", fromWallet: "Wallet A", amount },
      confidence: "high",
      sourceRef: "",
      adjustments: [],
    });
    const out = datesFromHeadings([card(10_000), card(10_000), card(20_400)], [plain, raised], ["2026-10-03", "2026-10-03"], "2026-10-03");
    expect(out.map((p) => p.draft.date)).toEqual(["2026-10-03", "2026-10-02", "2026-10-02"]);
  });
});

describe("the pace warning", () => {
  it("counts what is left of the spending budget, as the Dashboard does", () => {
    const transactions = [spend("2026-10-01", "Food", "groceries", 150_000), spend("2026-10-02", "Food", "groceries", 123_505)];
    const budgets = { "2026": { spending: [0, 0, 0, 0, 0, 0, 0, 0, 0, 600_000, 0, 0], billsSubs: [0, 0, 0, 0, 0, 0, 0, 0, 0, 170_000, 0, 0] } } as unknown as Budgets;
    const pace = financeAlerts({ transactions, budgets, accounts: [], debts: [], bills: [], lowBalanceThreshold: 0, asOf: "2026-10-03" } as never).find((a) => a.id === "budget-pace");
    // ₱6,000.00 less ₱2,735.05 spent is ₱3,264.95, over 29 days ₱112.58: not the ₱1,700.00 for bills as well.
    expect(pace?.detail).toBe("₱911.68 a day so far. ₱3,264.95 of the spending budget left over 29 days is ₱112.58 a day.");
  });
});
