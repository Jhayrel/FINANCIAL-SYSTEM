/**
 * Finishing a debt movement without leaving the chat.
 *
 * The chat never guesses at debt. Which credit line, and what the movement
 * does to it, are the two things a sentence does not carry, and reading
 * either wrong misfiles borrowing as income: that is the mistake that put
 * borrowed money into this ledger's income line for eight months.
 *
 * So they are picked. These tests pin the part that picking has to get right:
 * once the effect is known, the wallet has to sit on the side that effect
 * implies, because the running balance reads the side and not the effect.
 */

import { describe, expect, it } from "vitest";

import { checkDraft, emptyDraft, runningBalance, withDebtEffect } from "./entry";
import type { Draft } from "./entry";
import type { Debt } from "./debt";
import type { ReferenceLists, Transaction } from "./types";

const reference: ReferenceLists = {
  wallets: ["Cash", "Gcash", "Maya"],
  savings: [],
  bills: [],
  subscriptions: [],
  revenueCategories: ["Allowance"],
  spendingTypes: [{ name: "Food", remark: "" }],
};

const debts: Debt[] = [
  {
    id: "d1",
    name: "Maya Credit",
    kind: "payable",
    counterparty: "Maya",
    form: "credit_line",
    openedOn: "2026-01-01",
    archived: false,
  },
];

const ledger: Transaction[] = [
  {
    id: "t1",
    recordNumber: 1,
    date: "2026-08-01",
    type: "Revenue",
    fromWallet: "",
    toWallet: "Maya",
    category: "Revenue",
    item: "Allowance",
    description: "",
    amount: 1_000_000,
    fee: 0,
    total: 1_000_000,
    notes: "",
    status: "Received",
  },
];

/** What the chat hands the card: amount, wallet and date, nothing else. */
const asRead = (): Draft => ({
  ...emptyDraft("2026-08-29"),
  flow: "Debt",
  fromWallet: "Maya",
  amount: 295_000,
});

describe("the two things nobody may guess", () => {
  it("refuses to save without the credit line", () => {
    const draft = withDebtEffect(asRead(), "repay");
    const check = checkDraft(draft, ledger, reference, debts);
    expect(check.ok).toBe(false);
    expect(check.errors.map((e) => e.message).join(" ")).toContain("which debt");
  });

  it("refuses to save without the effect", () => {
    const draft: Draft = { ...asRead(), debtId: "d1" };
    const check = checkDraft(draft, ledger, reference, debts);
    expect(check.ok).toBe(false);
    expect(check.errors.map((e) => e.message).join(" ").toLowerCase()).toContain("repay");
  });

  it("saves once both are picked, and only then", () => {
    const draft = withDebtEffect({ ...asRead(), debtId: "d1" }, "repay");
    expect(checkDraft(draft, ledger, reference, debts).ok).toBe(true);
  });
});

describe("the effect decides which side the wallet is on", () => {
  /**
   * The bug this exists to stop.
   *
   * A sentence gives up one wallet and no direction, so it is parked on the
   * from side. Borrowing puts money in. Left where it was parked, the row
   * would take the amount out instead: the balance moves by twice the draw,
   * in the wrong direction, and the row looks perfectly ordinary.
   */
  it("borrowing lands in the wallet", () => {
    const draft = withDebtEffect(asRead(), "draw");
    expect(draft.toWallet).toBe("Maya");
    expect(draft.fromWallet).toBe("");
    expect(runningBalance(draft, ledger)?.after).toBe(1_295_000);
  });

  it("repaying comes out of the wallet", () => {
    const draft = withDebtEffect(asRead(), "repay");
    expect(draft.fromWallet).toBe("Maya");
    expect(draft.toWallet).toBe("");
    expect(runningBalance(draft, ledger)?.after).toBe(705_000);
  });

  it("interest comes out of the wallet, like a repayment", () => {
    expect(withDebtEffect(asRead(), "interest").fromWallet).toBe("Maya");
  });

  /** A line being forgiven is not a payment, so no wallet moves. */
  it("a write-off touches no wallet at all", () => {
    const draft = withDebtEffect(asRead(), "writeoff");
    expect(draft.fromWallet).toBe("");
    expect(draft.toWallet).toBe("");
    expect(runningBalance(draft, ledger)).toBeNull();
  });

  it("picking again moves it back, however many times", () => {
    let draft = withDebtEffect(asRead(), "draw");
    draft = withDebtEffect(draft, "repay");
    draft = withDebtEffect(draft, "draw");
    expect(draft.toWallet).toBe("Maya");
    expect(draft.fromWallet).toBe("");
  });

  /** Changing your mind must not lose the wallet the sentence named. */
  it("never drops the wallet on the way through a write-off", () => {
    const gone = withDebtEffect(asRead(), "writeoff");
    expect(withDebtEffect(gone, "repay").fromWallet).toBe("");
  });

  it("keeps everything else the sentence gave up", () => {
    const draft = withDebtEffect({ ...asRead(), debtId: "d1" }, "repay");
    expect(draft.amount).toBe(295_000);
    expect(draft.date).toBe("2026-08-29");
    expect(draft.debtId).toBe("d1");
    expect(draft.flow).toBe("Debt");
  });
});

describe("a draw comes from the credit line, not from a wallet", () => {
  /**
   * ── The refusal this fixes ──────────────────────────────────────────────
   *
   * Borrowing PHP 5,000 on Maya Credit into Gcash was refused with "Pick the
   * wallet the money leaves". There is no such wallet. The money comes from
   * the credit line, which is the whole meaning of a draw, and is why the
   * card asks which line rather than which account.
   */
  const drawn = (): Draft => ({
    ...emptyDraft("2026-09-05"),
    flow: "Debt",
    debtId: "d1",
    debtEffect: "draw",
    toWallet: "Gcash",
    amount: 500_000,
  });

  it("saves a draw with only a destination", () => {
    const check = checkDraft(drawn(), ledger, reference, debts);
    expect(check.ok).toBe(true);
  });

  it("no longer asks where the money left from", () => {
    const messages = checkDraft(drawn(), ledger, reference, debts)
      .errors.map((e) => e.message)
      .join(" ");
    expect(messages).not.toContain("money leaves");
  });

  it("still needs somewhere for a draw to land", () => {
    const nowhere = { ...drawn(), toWallet: "" };
    const check = checkDraft(nowhere, ledger, reference, debts);
    expect(check.ok).toBe(false);
    expect(check.errors.map((e) => e.message).join(" ")).toContain("money lands in");
  });

  /** The other direction is unchanged: a repayment leaves an account. */
  it("a repayment still needs the wallet it was paid from", () => {
    const repaid: Draft = {
      ...emptyDraft("2026-09-05"),
      flow: "Debt",
      debtId: "d1",
      debtEffect: "repay",
      amount: 295_000,
    };
    const check = checkDraft(repaid, ledger, reference, debts);
    expect(check.ok).toBe(false);
    expect(check.errors.map((e) => e.message).join(" ")).toContain("money leaves");
  });

  it("a repayment saves with only a source", () => {
    const repaid: Draft = {
      ...emptyDraft("2026-09-05"),
      flow: "Debt",
      debtId: "d1",
      debtEffect: "repay",
      fromWallet: "Maya",
      amount: 295_000,
    };
    expect(checkDraft(repaid, ledger, reference, debts).ok).toBe(true);
  });

  /** A line being forgiven moves no money, so it needs neither wallet. */
  it("a write-off needs no wallet at all", () => {
    const forgiven: Draft = {
      ...emptyDraft("2026-09-05"),
      flow: "Debt",
      debtId: "d1",
      debtEffect: "writeoff",
      amount: 100_000,
    };
    expect(checkDraft(forgiven, ledger, reference, debts).ok).toBe(true);
  });
});
