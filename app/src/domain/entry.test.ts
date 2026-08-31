import { describe, expect, it } from "vitest";

import { loadFixture } from "../fixtures/load";
import type { ReferenceLists } from "./types";
import { walletBalance } from "./balances";
import { frequentItems, predictFee, suggest } from "./autofill";
import type { Debt } from "./debt";
import { planDebtMigration } from "./debtMigration";
import {
  categoriesFor,
  checkDraft,
  draftToTransactions,
  emptyDraft,
  fieldsFor,
  insertChronologically,
  itemsFor,
  runningBalance,
  transactionToDraft,
  type Draft,
} from "./entry";

const fx = loadFixture();
const plan = planDebtMigration(fx.transactions, "Maya Credit", { debtId: "maya-credit" });
const debts: Debt[] = [plan.debt];

const draft = (over: Partial<Draft>): Draft => ({ ...emptyDraft("2026-08-29"), ...over });

describe("field visibility: only what the flow needs", () => {
  it("gives Revenue a destination but no source", () => {
    const f = fieldsFor("Revenue");
    expect(f).toContain("toWallet");
    expect(f).not.toContain("fromWallet");
    expect(f).not.toContain("fee");
  });

  it("gives Spending a source and a fee but no destination", () => {
    const f = fieldsFor("Spending");
    expect(f).toContain("fromWallet");
    expect(f).toContain("fee");
    expect(f).not.toContain("toWallet");
  });

  it("gives Transfer both wallets and no category", () => {
    const f = fieldsFor("Transfer");
    expect(f).toEqual(expect.arrayContaining(["fromWallet", "toWallet", "fee"]));
    expect(f).not.toContain("category");
  });

  it("gives Debt its debt and effect", () => {
    expect(fieldsFor("Debt")).toEqual(expect.arrayContaining(["debt", "debtEffect"]));
  });

  it("offers the three spending categories, and only those", () => {
    expect(categoriesFor("Spending")).toEqual(["Spending", "Bills", "Subscriptions"]);
    expect(categoriesFor("Transfer")).toEqual([]);
  });

  it("narrows the item list to the chosen category", () => {
    expect(itemsFor("Spending", "Bills", fx.reference)).toEqual(fx.reference.bills);
    expect(itemsFor("Spending", "Subscriptions", fx.reference)).toEqual(fx.reference.subscriptions);
    expect(itemsFor("Spending", "Spending", fx.reference)).toHaveLength(17);
  });
});

describe("running balance", () => {
  it("shows the source wallet before and after", () => {
    const r = runningBalance(
      draft({ flow: "Spending", fromWallet: "Maya", amount: 110000 }),
      fx.transactions,
    );
    expect(r?.before).toBe(579574);
    expect(r?.after).toBe(579574 - 110000);
    expect(r?.goesNegative).toBe(false);
  });

  it("includes the fee in the deduction", () => {
    const r = runningBalance(
      draft({ flow: "Transfer", fromWallet: "Gcash", toWallet: "Maya", amount: 100000, fee: 1500 }),
      fx.transactions,
    );
    expect(r?.after).toBe(walletBalance(fx.transactions, "Gcash") - 101500);
  });

  it("adds rather than subtracts for revenue", () => {
    const r = runningBalance(
      draft({ flow: "Revenue", toWallet: "Cash", amount: 50000 }),
      fx.transactions,
    );
    expect(r?.after).toBe(16100 + 50000);
  });

  it("flags a wallet going negative", () => {
    const r = runningBalance(
      draft({ flow: "Spending", fromWallet: "Gcash", amount: 20000 }),
      fx.transactions,
    );
    // Gcash holds ₱155.71.
    expect(r?.goesNegative).toBe(true);
  });

  it("excludes the row being edited so an edit does not double-count", () => {
    const target = fx.transactions.find((t) => t.fromWallet === "Cash" && t.type === "Spending")!;
    const r = runningBalance(
      draft({ id: target.id, flow: "Spending", fromWallet: "Cash", amount: 0 }),
      fx.transactions,
      target.id,
    );
    expect(r?.before).toBe(walletBalance(fx.transactions.filter((t) => t.id !== target.id), "Cash"));
  });
});

describe("validation", () => {
  it("requires a flow first", () => {
    const c = checkDraft(emptyDraft(), fx.transactions, fx.reference, debts);
    expect(c.ok).toBe(false);
    expect(c.errors[0]?.field).toBe("flow");
  });

  it("requires an amount above zero", () => {
    const c = checkDraft(
      draft({ flow: "Spending", fromWallet: "Maya", amount: 0 }),
      fx.transactions,
      fx.reference,
      debts,
    );
    expect(c.errors.some((e) => e.field === "amount")).toBe(true);
  });

  it("requires the wallets that flow needs", () => {
    const c = checkDraft(draft({ flow: "Spending", amount: 1000 }), fx.transactions, fx.reference, debts);
    expect(c.errors.some((e) => e.field === "fromWallet")).toBe(true);
  });

  it("rejects a transfer to the same wallet", () => {
    const c = checkDraft(
      draft({ flow: "Transfer", fromWallet: "Maya", toWallet: "Maya", amount: 1000 }),
      fx.transactions,
      fx.reference,
      debts,
    );
    expect(c.errors.some((e) => e.field === "toWallet")).toBe(true);
  });

  it("accepts a complete spending row", () => {
    const c = checkDraft(
      draft({ flow: "Spending", fromWallet: "Maya", category: "Spending", item: "Food", amount: 50000 }),
      fx.transactions,
      fx.reference,
      debts,
    );
    expect(c.ok).toBe(true);
    expect(c.warnings).toHaveLength(0);
  });
});

describe("warnings: all proceed-able", () => {
  it("warns when a wallet goes negative but still allows the save", () => {
    const c = checkDraft(
      draft({ flow: "Spending", fromWallet: "Gcash", amount: 20000 }),
      fx.transactions,
      fx.reference,
      debts,
    );
    expect(c.ok).toBe(true);
    expect(c.warnings.some((w) => w.message.includes("−₱44.29"))).toBe(true);
  });

  it("warns when taking money out of savings", () => {
    const c = checkDraft(
      draft({ flow: "Spending", fromWallet: "Maya Bank (Personal savings)", amount: 10000 }),
      fx.transactions,
      fx.reference,
      debts,
    );
    expect(c.ok).toBe(true);
    expect(c.warnings.some((w) => w.message.includes("savings"))).toBe(true);
  });

  /**
   * The catch that matters. This exact mistake: booking a Maya Credit draw
   * as Revenue: put ₱5,450 of borrowed money into the income line for eight
   * months without anything flagging it.
   */
  it("catches borrowing being entered as revenue", () => {
    const c = checkDraft(
      draft({ flow: "Revenue", toWallet: "Maya", item: "Maya Credit", amount: 250000 }),
      fx.transactions,
      fx.reference,
      debts,
    );
    expect(c.ok).toBe(true);
    const w = c.warnings.find((x) => x.field === "item");
    expect(w?.message).toContain("borrowing, not income");
  });

  it("does not cry wolf on ordinary revenue", () => {
    const c = checkDraft(
      draft({ flow: "Revenue", toWallet: "Maya", item: "Framelink", amount: 250000 }),
      fx.transactions,
      fx.reference,
      debts,
    );
    expect(c.warnings).toHaveLength(0);
  });

  it("previews the principal/interest split before saving a repayment", () => {
    const migrated = planDebtMigration(fx.transactions, "Maya Credit", { debtId: "maya-credit" });
    const ledger = fx.transactions.map((t) =>
      migrated.proposals.find((p) => p.transactionId === t.id && p.action === "draw")
        ? { ...t, type: "Debt" as const, debtId: "maya-credit", debtEffect: "draw" as const }
        : t,
    );

    const c = checkDraft(
      draft({ flow: "Debt", fromWallet: "Maya", debtId: "maya-credit", debtEffect: "repay", amount: 600000 }),
      ledger,
      fx.reference,
      debts,
    );

    // ₱5,450.00 outstanding, so ₱550.00 of a ₱6,000.00 payment is interest.
    expect(c.repaymentSplit).toEqual({ principal: 545000, interest: 55000 });
    expect(c.warnings.some((w) => w.message.includes("interest"))).toBe(true);
  });

  it("rejects a debt row with no debt or effect (D1)", () => {
    const c = checkDraft(draft({ flow: "Debt", amount: 10000 }), fx.transactions, fx.reference, debts);
    expect(c.ok).toBe(false);
    expect(c.errors.some((e) => e.field === "debt")).toBe(true);
    expect(c.errors.some((e) => e.field === "debtEffect")).toBe(true);
  });
});

describe("commit", () => {
  it("derives total from amount plus fee", () => {
    const [t] = draftToTransactions(
      draft({ flow: "Spending", fromWallet: "Maya", amount: 50000, fee: 1500 }),
      441,
      "new-1",
    );
    expect(t?.total).toBe(51500);
  });

  it("splits a repayment into two auditable rows", () => {
    const rows = draftToTransactions(
      draft({ flow: "Debt", fromWallet: "Maya", debtId: "maya-credit", debtEffect: "repay", amount: 268879 }),
      441,
      "new-1",
      { principal: 250000, interest: 18879 },
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.debtEffect)).toEqual(["repay", "interest"]);
    expect(rows.reduce((a, r) => a + r.total, 0)).toBe(268879);
  });

  it("inserts by date and renumbers the whole ledger", () => {
    const [row] = draftToTransactions(
      draft({ flow: "Spending", date: "2026-03-15", fromWallet: "Cash", amount: 10000 }),
      999,
      "backdated",
    );
    const next = insertChronologically(fx.transactions, [row!]);

    expect(next).toHaveLength(fx.transactions.length + 1);
    expect(next.map((t) => t.recordNumber)).toEqual(next.map((_, i) => i + 1));

    const dates = next.map((t) => t.date);
    expect([...dates].sort()).toEqual(dates);
  });

  it("moves the balance by exactly the total", () => {
    const before = walletBalance(fx.transactions, "Cash");
    const [row] = draftToTransactions(
      draft({ flow: "Spending", fromWallet: "Cash", amount: 10000, fee: 500 }),
      441,
      "new-1",
    );
    const after = walletBalance(insertChronologically(fx.transactions, [row!]), "Cash");
    expect(before - after).toBe(10500);
  });
});

describe("autofill", () => {
  it("suggests the wallet most used for spending", () => {
    const s = suggest(draft({ flow: "Spending" }), fx.transactions);
    expect(s.fromWallet).toBeTruthy();
    expect(fx.reference.wallets).toContain(s.fromWallet!);
  });

  it("narrows the item suggestion once a category is chosen", () => {
    const anyItem = suggest(draft({ flow: "Spending" }), fx.transactions).item;
    const billItem = suggest(draft({ flow: "Spending", category: "Bills" }), fx.transactions).item;
    expect(billItem).toBeTruthy();
    expect(billItem).not.toBe(anyItem);
    expect(fx.reference.bills).toContain(billItem!);
  });

  it("predicts the fee this wallet pair actually charges", () => {
    const fee = predictFee(fx.transactions, "Gcash", "Maya");
    // Gcash → Maya has always cost ₱15.00.
    expect(fee).toBe(1500);
  });

  it("returns no fee for a pair that has never charged one", () => {
    expect(predictFee(fx.transactions, "Cash", "Extra Cash")).toBe(0);
  });

  it("suggests nothing before a flow is chosen", () => {
    expect(suggest(emptyDraft(), fx.transactions)).toEqual({});
  });

  it("ranks the items used most", () => {
    const items = frequentItems(fx.transactions, "Spending", "Spending");
    expect(items.length).toBeGreaterThan(0);
    expect(items).toContain("Food");
  });
});

describe("Money Send: a transfer that left your accounts", () => {
  /**
   * This never saved. `sentOut` was component state in `AddTransaction`, so
   * `checkDraft` could not see it, and every Money Send failed with "Pick the
   * wallet the money lands in" while the Save button did nothing at all.
   */
  const sending = (over: Partial<Draft> = {}): Draft => ({
    ...emptyDraft("2026-08-31"),
    flow: "Transfer",
    category: "Transfer",
    fromWallet: "Gcash",
    toWallet: "",
    amount: 100000,
    status: "Transferred",
    ...over,
  });

  const reference: ReferenceLists = {
    wallets: ["Cash", "Gcash", "Maya"],
    savings: [],
    bills: [],
    subscriptions: [],
    revenueCategories: [],
    spendingTypes: [],
  };

  it("saves when the destination is deliberately blank", () => {
    const check = checkDraft(sending({ sentOut: true }), [], reference, []);
    expect(check.ok).toBe(true);
    expect(check.errors).toHaveLength(0);
  });

  it("still asks for a destination when one was simply not chosen", () => {
    const check = checkDraft(sending(), [], reference, []);
    expect(check.ok).toBe(false);
    expect(check.errors.map((e) => e.field)).toContain("toWallet");
  });

  it("books the whole amount as spending, per the transfer rule", () => {
    const rows = draftToTransactions(sending({ sentOut: true }), 442, "t-1");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.toWallet).toBe("");
    expect(rows[0]?.total).toBe(100000);
  });

  it("reads a saved one back as Money Send rather than as a missing field", () => {
    const rows = draftToTransactions(sending({ sentOut: true }), 442, "t-1");
    const back = transactionToDraft(rows[0]!);
    expect(back.sentOut).toBe(true);
    expect(checkDraft(back, [], reference, []).ok).toBe(true);
  });

  it("does not mark an ordinary transfer between your own wallets as sent out", () => {
    const rows = draftToTransactions(sending({ toWallet: "Maya" }), 442, "t-1");
    expect(transactionToDraft(rows[0]!).sentOut).toBeUndefined();
  });
});
