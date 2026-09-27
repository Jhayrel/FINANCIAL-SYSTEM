/**
 * A wallet's own history, read against what the device knows.
 *
 * The owner, 27 September 2026, with their Maya history for the day: their
 * own GCash to Maya transfer came back as income to be asked about, paying
 * off Maya Credit came back as a withdrawal, and cash taken out at a store
 * came back as food. "It cant recognized the transfer from gcash earlier, it
 * doenst recognized the debt being paid." Names, places and figures here are
 * invented, in the same shape.
 */

import { describe, expect, it } from "vitest";

import { cardQuestion } from "./cardQuestions";
import type { Debt } from "./debt";
import { duplicatesOf } from "./duplicates";
import { emptyDraft, type Draft } from "./entry";
import { REFERENCE } from "./eval/corpus";
import type { Proposal } from "./proposal";
import { isOwnName, rowsOfReadings, senseStatementRows, wordsFor } from "./statementSense";
import type { ReferenceLists, Transaction } from "./types";

const reference: ReferenceLists = { ...REFERENCE, wallets: ["Cash", "Gcash", "Maya"], credits: ["Maya Credit"] };
const OWNER = ["Dario Lim Santos"];

const line: Debt = {
  id: "maya-credit",
  name: "Maya Credit",
  kind: "payable",
  form: "credit-line",
  counterparty: "Maya",
  counterpartyType: "institution",
  openedDate: "2026-01-01",
  wallet: "Maya",
  interestType: "none",
  interestRate: 0,
  notes: "",
  archived: false,
};

let n = 0;
const row = (over: Partial<Transaction>): Transaction => {
  n += 1;
  return {
    id: `t${n}`,
    recordNumber: n,
    date: "2026-09-20",
    type: "Spending",
    fromWallet: "",
    toWallet: "",
    category: "",
    item: "",
    description: "",
    amount: 0,
    fee: 0,
    total: 0,
    notes: "",
    status: "Done",
    ...over,
  };
};

const ledger: Transaction[] = [
  row({ date: "2026-09-18", type: "Debt", toWallet: "Maya", item: "Maya Credit", amount: 200000, debtId: "maya-credit", debtEffect: "draw" }),
  row({ date: "2026-09-18", type: "Debt", item: "Maya Credit", amount: 15103, debtId: "maya-credit", debtEffect: "charge" }),
  row({ date: "2026-09-20", type: "Debt", toWallet: "Maya", item: "Maya Credit", amount: 200000, debtId: "maya-credit", debtEffect: "draw" }),
  row({ date: "2026-09-20", type: "Debt", item: "Maya Credit", amount: 15103, debtId: "maya-credit", debtEffect: "charge" }),
  row({ date: "2026-09-19", type: "Transfer", fromWallet: "Maya", toWallet: "Cash", amount: 21800, description: "Withdrawal from TOWN STORE", status: "Withdrawn" }),
  // The transfer the owner logged that morning, the day after Maya dated it.
  row({ date: "2026-09-27", type: "Transfer", fromWallet: "Gcash", toWallet: "Maya", amount: 998000, fee: 1000, total: 999000, status: "Transferred" }),
];

const READ = [
  [
    "Today",
    "Withdrawal from PALM CROSSING -₱1,518.00",
    "Purchase at BURGER 12 NORTHGATE -₱399.00",
    "Bills Payment for Maya Bank -₱4,302.06",
    "Received money from OARIO LIM SANTOS ₱9,980.00",
    "Received money from LUZ SANTOS ₱500.00",
  ].join("\n"),
];

const out = (amount: number, description: string, over: Partial<Draft> = {}): Proposal => ({
  draft: { ...emptyDraft("2026-09-26"), flow: "Spending", category: "Spending", item: "Food", fromWallet: "Maya", amount, description, status: "Paid", ...over },
  confidence: "high",
  sourceRef: "maya.jpg",
  adjustments: [],
});
const inMaya = (amount: number, description: string): Proposal => ({
  draft: { ...emptyDraft("2026-09-26"), flow: "Revenue", category: "Revenue", toWallet: "Maya", amount, description, status: "Received" },
  confidence: "high",
  sourceRef: "maya.jpg",
  adjustments: [],
});

const context = { account: "Maya", readings: READ, ownNames: OWNER, debts: [line], transactions: ledger, reference };

describe("the rows on the picture", () => {
  it("reads each row's words and figure", () => {
    const rows = rowsOfReadings(READ);
    expect(rows.map((r) => r.amount)).toEqual([151800, 39900, 430206, 998000, 50000]);
    expect(wordsFor(151800, rows)).toBe("Withdrawal from PALM CROSSING");
    expect(wordsFor(12345, rows)).toBe("");
  });
});

describe("the owner's own name", () => {
  it("is known with a letter or two misread, and never by the surname alone", () => {
    expect(isOwnName("OARIO LIM SANTOS", OWNER)).toBe(true);
    expect(isOwnName("DARIO SANTOS", OWNER)).toBe(true);
    expect(isOwnName("LUZ SANTOS", OWNER)).toBe(false);
    expect(isOwnName("DARIO", OWNER)).toBe(false);
    expect(isOwnName("OARIO LIM SANTOS", [])).toBe(false);
  });

  it("makes money from it a transfer from the account it left, and finds it already in the ledger", () => {
    const [sensed] = senseStatementRows([inMaya(998000, "Received from OARIO LIM SANTOS")], context);
    expect(sensed?.draft).toMatchObject({ flow: "Transfer", fromWallet: "Gcash", toWallet: "Maya", item: "" });
    expect(sensed?.adjustments.join(" ")).toContain("your own name");
    expect(duplicatesOf(sensed!.draft, ledger)[0]?.row.fromWallet).toBe("Gcash");
  });

  it("asks which account when the ledger has not got the other side yet", () => {
    const [sensed] = senseStatementRows([inMaya(998000, "Received from OARIO LIM SANTOS")], { ...context, transactions: ledger.slice(0, 5) });
    expect(sensed?.draft).toMatchObject({ flow: "Transfer", fromWallet: "", toWallet: "Maya" });
    expect(cardQuestion(sensed!.draft, reference, 1, 1)?.blank).toBe("fromWallet");
  });

  it("leaves money from family as income", () => {
    const [sensed] = senseStatementRows([inMaya(50000, "Received money from LUZ SANTOS")], context);
    expect(sensed?.draft.flow).toBe("Revenue");
  });
});

describe("even income read the model's way is found in the ledger", () => {
  it("matches a transfer into the same account for the same money", () => {
    const found = duplicatesOf(inMaya(998000, "Received money").draft, ledger);
    expect(found[0]?.evidence.join(" ")).toContain("into Maya");
  });
});

describe("paying a credit line off", () => {
  it("reads a bills payment to the lender as a payment on the line", () => {
    const [sensed] = senseStatementRows([out(430206, "Withdrawal from Maya Bank", { flow: "Transfer", category: "Transfer", item: "", toWallet: "Cash" })], context);
    expect(sensed?.draft).toMatchObject({ flow: "Debt", debtEffect: "repay", debtId: "maya-credit", fromWallet: "Maya", toWallet: "", description: "Bills Payment for Maya Bank" });
    expect(sensed?.adjustments.join(" ")).toContain("exactly what Maya Credit was owed");
  });

  it("does not when nothing was owed", () => {
    const [sensed] = senseStatementRows([out(430206, "Bills payment for Maya Bank")], { ...context, readings: [], transactions: [] });
    expect(sensed?.draft.flow).toBe("Spending");
  });

  it("does not take a payment larger than what is owed", () => {
    const [sensed] = senseStatementRows([out(900000, "Bills Payment for Maya Bank")], { ...context, readings: [] });
    expect(sensed?.draft.flow).toBe("Spending");
  });
});

describe("cash taken out at a store", () => {
  it("is a transfer to Cash, the way the owner files them", () => {
    const [sensed] = senseStatementRows([out(151800, "Purchase at PALM CROSSING")], context);
    expect(sensed?.draft).toMatchObject({ flow: "Transfer", fromWallet: "Maya", toWallet: "Cash", status: "Withdrawn", item: "", description: "Withdrawal from PALM CROSSING" });
  });

  it("stays spending where the owner files withdrawals as spending", () => {
    const asSpending = ledger.map((t) => (t.description.startsWith("Withdrawal") ? { ...t, type: "Spending" as const, toWallet: "" } : t));
    const [sensed] = senseStatementRows([out(151800, "Purchase at PALM CROSSING")], { ...context, transactions: asSpending });
    expect(sensed?.draft.flow).toBe("Spending");
  });

  it("leaves a purchase a purchase", () => {
    const [sensed] = senseStatementRows([out(39900, "Purchase at BURGER 12 NORTHGATE")], context);
    expect(sensed).toEqual(out(39900, "Purchase at BURGER 12 NORTHGATE"));
  });
});
