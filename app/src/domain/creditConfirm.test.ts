/**
 * A credit line's confirm screen, read on this device. Invented figures in
 * the shape of a real screen: an amount, a service fee with its rate, a
 * stamp tax, and the total credit amount that is all three together.
 */

import { describe, expect, it } from "vitest";

import { creditConfirmsIn, feesOf, lineForConfirm, readCreditConfirm } from "./creditConfirm";

const SAME_LINE = [
  "Easy Credit",
  "Confirm transfer",
  "Amount ₱1,000.00",
  "Service fee (5.00%) ₱50.00",
  "Documentary stamp tax ₱1.50",
  "Total credit amount ₱1,051.50",
  "Destination My Wallet",
].join("\n");

const NEXT_LINE = [
  "Confirm transfer",
  "₱1,000.00",
  "Service fee (5.00%)",
  "₱50.00",
  "Documentary stamp tax",
  "₱1.50",
  "Total credit amount",
  "₱1,051.50",
  "Destination",
  "My Wallet",
].join("\n");

const COLUMNS = [
  "Confirm transfer",
  "Service fee (5.00%)",
  "Documentary stamp tax",
  "Total credit amount",
  "Destination",
  "₱1,000.00",
  "₱50.00",
  "₱1.50",
  "₱1,051.50",
  "My Wallet",
].join("\n");

describe("reading a credit confirm screen", () => {
  it("reads each figure beside its label", () => {
    const c = readCreditConfirm(SAME_LINE);
    expect(c?.amount).toBe(100000);
    expect(c?.fees).toEqual([
      { label: "service fee", amount: 5000 },
      { label: "documentary stamp tax", amount: 150 },
    ]);
    expect(c?.total).toBe(105150);
    expect(c?.destination).toBe("My Wallet");
    expect(c && feesOf(c)).toBe(5150);
  });

  it("reads figures printed under their labels, the amount with no label", () => {
    const c = readCreditConfirm(NEXT_LINE);
    expect(c?.amount).toBe(100000);
    expect(c && feesOf(c)).toBe(5150);
    expect(c?.destination).toBe("My Wallet");
  });

  it("reads labels and figures in two columns by the sum", () => {
    const c = readCreditConfirm(COLUMNS);
    expect(c?.amount).toBe(100000);
    expect(c?.total).toBe(105150);
    expect(c && feesOf(c)).toBe(5150);
  });

  it("never takes the rate as a fee, even read without its % sign", () => {
    const c = readCreditConfirm(NEXT_LINE.replace("(5.00%)", "(5.00)"));
    expect(c && feesOf(c)).toBe(5150);
  });

  it("reads nothing when the parts do not add up to the total", () => {
    expect(readCreditConfirm(SAME_LINE.replace("₱1,051.50", "₱1,061.50"))).toBeNull();
  });

  it("reads nothing off a shop receipt or an ATM slip", () => {
    expect(readCreditConfirm("Corner Store\nTotal 345.00\nCash 500.00\nChange 155.00")).toBeNull();
    expect(readCreditConfirm("ATM withdrawal\nAmount 1,200.00\nAcquirer fee 15.00\nAvailable balance 500.00")).toBeNull();
  });

  it("finds a screen once when both readings of a picture carry it", () => {
    expect(creditConfirmsIn([SAME_LINE, SAME_LINE, "nothing here"])).toHaveLength(1);
  });
});

describe("which line it belongs to", () => {
  const lines = [
    { id: "a", name: "Maya Credit", wallet: "Maya" },
    { id: "b", name: "Home Credit", wallet: "" },
  ];

  it("takes the line the screen names, with or without Easy", () => {
    const text = `Maya Easy Credit\n${SAME_LINE}`;
    const c = readCreditConfirm(text);
    expect(c).not.toBeNull();
    const got = c && lineForConfirm(c, text, lines, ["Maya", "Gcash", "Cash"]);
    expect(got?.line.id).toBe("a");
    expect(got?.wallet).toBe("Maya");
  });

  it("takes the only line when the screen names none", () => {
    const c = readCreditConfirm(SAME_LINE);
    const got = c && lineForConfirm(c, SAME_LINE, [lines[0]!], ["Maya"]);
    expect(got?.line.id).toBe("a");
  });

  it("makes no guess between two lines the screen does not name", () => {
    const c = readCreditConfirm(SAME_LINE);
    expect(c && lineForConfirm(c, SAME_LINE, lines, ["Maya"])).toBeNull();
  });

  it("uses the wallet the screen names when it is one of theirs", () => {
    const text = SAME_LINE.replace("My Wallet", "Gcash");
    const c = readCreditConfirm(text);
    expect(c && lineForConfirm(c, text, [lines[0]!], ["Maya", "Gcash"])?.wallet).toBe("Gcash");
  });
});

import { applyCreditConfirms } from "./creditConfirm";
import { emptyDraft } from "./entry";
import type { Proposal } from "./proposal";
import type { Transaction } from "./types";

describe("what a confirm screen does to the cards", () => {
  const line = { id: "maya-credit", name: "Maya Credit", wallet: "Maya" };
  const screen = readCreditConfirm(`Maya Easy Credit\n${SAME_LINE}`);
  const context = (transactions: Transaction[] = []) => ({
    text: `Maya Easy Credit\n${SAME_LINE}`,
    lines: [line],
    wallets: ["Maya", "Gcash", "Cash"],
    transactions,
    asOf: "2026-11-18",
  });
  const card = (over: Partial<Proposal["draft"]>): Proposal => ({
    draft: { ...emptyDraft("2026-11-18"), ...over },
    confidence: "medium",
    sourceRef: "IMG_1.jpg",
    adjustments: [],
  });
  const saved = (over: Partial<Transaction> = {}): Transaction => ({
    id: "t-90",
    recordNumber: 90,
    date: "2026-11-17",
    type: "Debt",
    fromWallet: "",
    toWallet: "Maya",
    category: "",
    item: "Maya Credit",
    description: "",
    amount: 100000,
    fee: 0,
    total: 100000,
    notes: "",
    status: "Received",
    debtId: "maya-credit",
    debtEffect: "draw",
    ...over,
  });

  it("puts the fees on a borrowing card that has none", () => {
    const draw = card({ flow: "Debt", debtEffect: "draw", debtId: "maya-credit", item: "Maya Credit", toWallet: "Maya", amount: 100000 });
    const out = applyCreditConfirms([draw], [screen!], context());
    expect(out).toHaveLength(1);
    expect(out[0]?.draft.charges).toBe(5150);
    expect(out[0]?.adjustments.join(" ")).toContain("₱1,051.50");
  });

  it("leaves the fees alone when fee cards came with the borrowing", () => {
    const draw = card({ flow: "Debt", debtEffect: "draw", debtId: "maya-credit", amount: 100000 });
    const fee = card({ flow: "Debt", debtEffect: "charge", debtId: "maya-credit", amount: 5000 });
    const out = applyCreditConfirms([draw, fee], [screen!], context());
    expect(out[0]?.draft.charges ?? 0).toBe(0);
  });

  it("says so when a card's fees differ from the screen's, and changes nothing", () => {
    const draw = card({ flow: "Debt", debtEffect: "draw", debtId: "maya-credit", amount: 100000, charges: 4000 });
    const out = applyCreditConfirms([draw], [screen!], context());
    expect(out[0]?.draft.charges).toBe(4000);
    expect(out[0]?.confidence).toBe("low");
    expect(out[0]?.adjustments.join(" ")).toContain("Check the fees");
  });

  it("offers the fees a saved borrowing is missing, dated with it", () => {
    const out = applyCreditConfirms([], [screen!], context([saved()]));
    expect(out).toHaveLength(1);
    expect(out[0]?.draft.debtEffect).toBe("charge");
    expect(out[0]?.draft.amount).toBe(5150);
    expect(out[0]?.draft.date).toBe("2026-11-17");
    expect(out[0]?.adjustments.join(" ")).toContain("#0090");
  });

  it("offers nothing when the saved borrowing has its fees", () => {
    const fees = saved({ id: "t-90-charge", amount: 5150, total: 5150, toWallet: "", debtEffect: "charge", partOf: "t-90" });
    expect(applyCreditConfirms([], [screen!], context([saved(), fees]))).toHaveLength(0);
  });

  it("does not reach back further than a week", () => {
    const old = saved({ date: "2026-10-01" });
    const out = applyCreditConfirms([], [screen!], context([old]));
    expect(out[0]?.draft.debtEffect).toBe("draw");
  });

  it("turns money in read as income into the borrowing", () => {
    const income = card({ flow: "Revenue", category: "Revenue", toWallet: "Maya", amount: 100000, description: "Received money" });
    const out = applyCreditConfirms([income], [screen!], context());
    expect(out).toHaveLength(1);
    expect(out[0]?.draft.flow).toBe("Debt");
    expect(out[0]?.draft.debtEffect).toBe("draw");
    expect(out[0]?.draft.charges).toBe(5150);
    expect(out[0]?.draft.toWallet).toBe("Maya");
  });

  it("makes the borrowing card when the reading gave nothing", () => {
    const out = applyCreditConfirms([], [screen!], context());
    expect(out).toHaveLength(1);
    expect(out[0]?.draft).toMatchObject({ flow: "Debt", debtEffect: "draw", debtId: "maya-credit", toWallet: "Maya", amount: 100000, charges: 5150, date: "2026-11-18" });
  });

  it("makes no card when the line cannot be told", () => {
    const two = { ...context(), lines: [line, { id: "other", name: "Home Credit", wallet: "" }], text: SAME_LINE };
    expect(applyCreditConfirms([], [screen!], two)).toHaveLength(0);
  });
});
