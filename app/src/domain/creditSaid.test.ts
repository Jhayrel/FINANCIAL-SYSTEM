/**
 * Borrowing on a credit line, said the way the owner says it (17 November
 * 2026: "i credit 1000 today then paid then credited again then paid agin"),
 * and "I acquire a debt at maya credit 5000 to be paid soon, I received that
 * in maya", which was read as paying 5,000 out of Maya. Figures invented.
 */
import { describe, expect, it } from "vitest";

import type { Debt } from "./debt";
import { fillDebt } from "./debtFill";
import { readEntry } from "./readEntry";
import type { ReferenceLists } from "./types";

const reference = {
  spendingTypes: ["Food", "Gas", "Money Send"].map((name) => ({ name, remark: "" })),
  revenueCategories: ["Allowance", "Salary", "Cashback"],
  bills: [],
  subscriptions: [],
  wallets: ["Cash", "Gcash", "Maya"],
  savings: [],
  credits: ["Maya Credit"],
} as unknown as ReferenceLists;
const line = {
  id: "maya-credit", name: "Maya Credit", kind: "payable", counterparty: "Maya", openedDate: "2026-07-01", wallet: "Maya",
  interestType: "none", interestRate: 0, notes: "", archived: false, form: "credit-line", billingDay: 6, dueAfterDays: 15,
} as Debt;

const card = (said: string) => {
  const read = readEntry(said, [], reference, "2026-11-16");
  if (read.draft.flow !== "Debt") return { flow: read.draft.flow, item: read.draft.item, amount: read.draft.amount };
  const filled = fillDebt(read.draft, said, [line], [], ["Cash", "Gcash", "Maya"], "2026-11-16").draft;
  return { flow: filled.flow, effect: filled.debtEffect, debtId: filled.debtId, amount: filled.amount, to: filled.toWallet, from: filled.fromWallet };
};

describe("borrowing, as it is said", () => {
  it.each([
    ["i credit 1500 in maya credit today", 150_000],
    ["I credit 1500 today", 150_000],
    ["I credited 2500 from maya credit to maya", 250_000],
    ["credited 2500 on maya credit", 250_000],
    ["I credit again 1500 on maya credit", 150_000],
    ["I acquire a debt at maya credit 6000 to be paid soon, I received that in maya", 600_000],
    ["I borrowed 1500 on maya credit and will pay it back next month", 150_000],
  ])("%s is borrowing", (said, amount) => {
    const c = card(said);
    expect(c.flow).toBe("Debt");
    expect(c.effect).toBe("draw");
    expect(c.debtId).toBe("maya-credit");
    expect(c.amount).toBe(amount);
    expect(c.from || "").toBe("");
  });

  it("received in a wallet: it lands there", () => {
    expect(card("I acquire a debt at maya credit 6000 to be paid soon, I received that in maya").to).toBe("Maya");
  });
});

describe("still what they were", () => {
  it("paying the line is a payment", () => {
    const c = card("paid 1500 to maya credit from maya");
    expect(c.effect).toBe("repay");
    expect(c.from).toBe("Maya");
  });
  it("a payment said ahead is still a payment, not a borrowing", () => {
    expect(card("I will pay maya credit 500 tomorrow").effect).toBe("repay");
  });
  it.each(["maya credited 20 cashback to my maya", "my salary 5000 was credited to maya"])("%s is income", (said) => {
    expect(card(said).flow).toBe("Revenue");
  });
});

describe("a line renamed keeps its own id", () => {
  it("the card points at the line the name means, not at an id made from the name", () => {
    const renamed = { ...line, id: "line-made-long-ago" } as Debt;
    const read = readEntry("i credit 1500 in maya credit today", [], reference, "2026-11-16");
    const filled = fillDebt(read.draft, "i credit 1500 in maya credit today", [renamed], [], ["Cash", "Gcash", "Maya"], "2026-11-16").draft;
    expect(filled.debtId).toBe("line-made-long-ago");
    expect(filled.debtEffect).toBe("draw");
  });
});

describe("received from a credit line", () => {
  it.each([
    ["I recieved 2500 from maya credit", 250_000],
    ["I recived 1500 in maya and the credit is from maya credit", 150_000],
  ])("%s is borrowing", (said, amount) => {
    const c = card(said);
    expect(c.effect).toBe("draw");
    expect(c.amount).toBe(amount);
  });
});
