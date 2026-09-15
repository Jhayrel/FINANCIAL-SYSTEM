/**
 * The write path, end to end, against the real ledger.
 *
 * Add, edit, bin, restore and rename, done the way App.tsx does them, with the
 * figures CLAUDE.md pins checked along the way. Each case below was a real
 * fault found by walking those flows on 2026-09-15:
 *
 *   - an edited repayment or draw counted itself against its own debt
 *   - bin, add and restore could leave two rows carrying one record number
 *   - a rename left the bin on the old name, so a restore split the account
 */

import { describe, expect, it } from "vitest";

import { loadFixture } from "../fixtures/load";
import { renameAccount } from "./accounts";
import { walletBalance } from "./balances";
import { applyDebtMigration, planDebtMigration } from "./debtMigration";
import {
  checkDraft,
  draftToTransactions,
  emptyDraft,
  insertChronologically,
  nextRecordNumber,
  transactionToDraft,
  type Draft,
} from "./entry";
import { totalsFor } from "./totals";
import type { DeletedTransaction, Transaction } from "./types";

const fx = loadFixture();
const plan = planDebtMigration(fx.transactions, "Maya Credit", {
  debtId: "maya-credit",
  counterparty: "Maya",
  wallet: "Maya",
});
const ledger = applyDebtMigration(fx.transactions, plan);
const debts = [plan.debt];

const draft = (over: Partial<Draft>): Draft => ({ ...emptyDraft("2026-08-29"), ...over });

// ── What App.tsx does, as plain functions ──────────────────────────────────

const AT = "2026-09-15T08:00:00.000Z";

function bin(live: readonly Transaction[], ids: readonly string[]) {
  const gone = new Set(ids);
  return {
    live: live.filter((t) => !gone.has(t.id)),
    binned: live
      .filter((t) => gone.has(t.id))
      .map((t): DeletedTransaction => ({ ...t, deletedAt: AT })),
  };
}

function restore(
  live: readonly Transaction[],
  binned: readonly DeletedTransaction[],
  renumber: boolean,
): Transaction[] {
  const back = binned.map(({ deletedAt: _dropped, ...t }) => t);
  return insertChronologically(live, back, { renumber });
}

function update(live: readonly Transaction[], rows: readonly Transaction[]): Transaction[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const replaced = live.map((t) => byId.get(t.id) ?? t);
  const added = rows.filter((r) => !live.some((t) => t.id === r.id));
  return added.length ? insertChronologically(replaced, added) : replaced;
}

const distinctNumbers = (rows: readonly Transaction[]): number =>
  new Set(rows.map((t) => t.recordNumber)).size;

const mentions = (c: { warnings: readonly { message: string }[] }, word: string): boolean =>
  c.warnings.some((w) => w.message.includes(word));

// ── Add, edit, bin, restore ────────────────────────────────────────────────

describe("add, edit, bin and restore move the balance by the entry and nothing else", () => {
  const MAYA = 579574;
  const CASH = 16100;
  const GCASH = 15571;

  it("starts from the figures CLAUDE.md pins", () => {
    expect(walletBalance(ledger, "Maya")).toBe(MAYA);
    expect(walletBalance(ledger, "Cash")).toBe(CASH);
    expect(walletBalance(ledger, "Gcash")).toBe(GCASH);
  });

  it("follows one entry through every step and ends where it should", () => {
    const d = draft({
      flow: "Spending",
      fromWallet: "Maya",
      category: "Spending",
      item: "Food",
      amount: 10000,
      fee: 500,
    });
    expect(checkDraft(d, ledger, fx.reference, debts).ok).toBe(true);

    const [row] = draftToTransactions(d, nextRecordNumber(ledger), "t-flow");
    if (!row) throw new Error("the draft made no row");

    const added = insertChronologically(ledger, [row]);
    expect(added).toHaveLength(ledger.length + 1);
    expect(walletBalance(added, "Maya")).toBe(MAYA - 10500);

    const saved = added.find((t) => t.id === "t-flow");
    if (!saved) throw new Error("the row did not save");
    const edited = update(
      added,
      draftToTransactions({ ...transactionToDraft(saved), amount: 25000 }, saved.recordNumber, saved.id),
    );
    expect(edited).toHaveLength(ledger.length + 1);
    expect(walletBalance(edited, "Maya")).toBe(MAYA - 25500);

    const binned = bin(edited, ["t-flow"]);
    expect(walletBalance(binned.live, "Maya")).toBe(MAYA);
    expect(totalsFor(binned.live).total).toBe(totalsFor(ledger).total);

    const back = restore(binned.live, binned.binned, true);
    expect(walletBalance(back, "Maya")).toBe(MAYA - 25500);
    expect(walletBalance(back, "Cash")).toBe(CASH);
    expect(walletBalance(back, "Gcash")).toBe(GCASH);
  });
});

// ── Debt edits ─────────────────────────────────────────────────────────────

describe("editing a debt row does not count the row itself", () => {
  const repay = ledger.find((t) => t.debtId === "maya-credit" && t.debtEffect === "repay");
  const draw = ledger.find((t) => t.debtId === "maya-credit" && t.debtEffect === "draw");

  it("found the ₱2,500.00 repayment and a draw to work with", () => {
    expect(repay?.amount).toBe(250000);
    expect(draw).toBeDefined();
  });

  it("keeps a repayment raised to ₱3,500.00 all principal, since ₱5,450.00 is owed without it", () => {
    if (!repay) throw new Error("no repayment");
    const c = checkDraft({ ...transactionToDraft(repay), amount: 350000 }, ledger, fx.reference, debts);
    // It used to read ₱2,950.00 principal and ₱550.00 interest.
    expect(c.repaymentSplit).toEqual({ principal: 350000, interest: 0 });
    expect(mentions(c, "interest")).toBe(false);
  });

  it("splits an edited repayment at what is owed without it", () => {
    if (!repay) throw new Error("no repayment");
    const c = checkDraft({ ...transactionToDraft(repay), amount: 600000 }, ledger, fx.reference, debts);
    expect(c.repaymentSplit).toEqual({ principal: 545000, interest: 55000 });
  });

  it("still counts every row for a new repayment", () => {
    const c = checkDraft(
      draft({ flow: "Debt", fromWallet: "Maya", debtId: "maya-credit", debtEffect: "repay", amount: 350000 }),
      ledger,
      fx.reference,
      debts,
    );
    expect(c.repaymentSplit).toEqual({ principal: 295000, interest: 55000 });
  });

  it("measures an edited draw against the limit without itself", () => {
    if (!draw) throw new Error("no draw");
    // A limit the line already sits at: no room for anything new.
    const full = [{ ...plan.debt, creditLimit: 295000 }];

    const edit = checkDraft(transactionToDraft(draw), ledger, fx.reference, full);
    expect(mentions(edit, "limit")).toBe(false);

    const fresh = checkDraft(
      draft({ flow: "Debt", toWallet: "Maya", debtId: "maya-credit", debtEffect: "draw", amount: 100 }),
      ledger,
      fx.reference,
      full,
    );
    expect(mentions(fresh, "limit")).toBe(true);
  });
});

// ── Record numbers ─────────────────────────────────────────────────────────

describe("record numbers never repeat", () => {
  const newest = ledger.reduce((a, t) => (t.recordNumber > a.recordNumber ? t : a));

  it("counts the bin when picking the next number", () => {
    const { live, binned } = bin(ledger, [newest.id]);
    // The fault: the binned row's number, handed straight back out.
    expect(nextRecordNumber(live)).toBe(newest.recordNumber);
    expect(nextRecordNumber(live, binned)).toBe(newest.recordNumber + 1);
  });

  it("leaves one number per row after bin, add and restore where numbers are kept", () => {
    const { live, binned } = bin(ledger, [newest.id]);
    const [row] = draftToTransactions(
      draft({ flow: "Spending", fromWallet: "Cash", amount: 5000 }),
      nextRecordNumber(live, binned),
      "t-after",
    );
    if (!row) throw new Error("the draft made no row");

    const back = restore(insertChronologically(live, [row], { renumber: false }), binned, false);
    expect(back).toHaveLength(ledger.length + 1);
    expect(distinctNumbers(back)).toBe(back.length);
  });

  it("never rewrites a kept number, and still sorts by date", () => {
    const [row] = draftToTransactions(
      draft({ flow: "Spending", date: "2026-03-15", fromWallet: "Cash", amount: 5000 }),
      nextRecordNumber(ledger),
      "t-backdated",
    );
    if (!row) throw new Error("the draft made no row");

    const kept = insertChronologically(ledger, [row], { renumber: false });
    const before = new Map(ledger.map((t) => [t.id, t.recordNumber]));
    expect(kept.every((t) => t.id === "t-backdated" || before.get(t.id) === t.recordNumber)).toBe(true);
    expect(kept.every((t, i) => i === 0 || (kept[i - 1]?.date ?? "") <= t.date)).toBe(true);
  });

  it("renumbers from one where the ledger follows the Excel", () => {
    const { live, binned } = bin(ledger, [newest.id]);
    const back = restore(live, binned, true);
    expect(back.map((t) => t.recordNumber)).toEqual(back.map((_, i) => i + 1));
  });
});

// ── Renames ────────────────────────────────────────────────────────────────

describe("a rename reaches the bin", () => {
  const gcashRow = ledger.find((t) => t.fromWallet === "Gcash" && t.type === "Spending");

  it("brings a binned row back into the renamed account", () => {
    if (!gcashRow) throw new Error("no Gcash spending row");
    const { live, binned } = bin(ledger, [gcashRow.id]);

    const renamedBin = renameAccount(binned, "Gcash", "GCash Wallet");
    expect(renamedBin[0]?.deletedAt).toBe(AT);

    const back = restore(renameAccount(live, "Gcash", "GCash Wallet"), renamedBin, true);
    expect(walletBalance(back, "GCash Wallet")).toBe(15571);
    expect(walletBalance(back, "Gcash")).toBe(0);
  });

  it("would have split the account had the bin kept the old name", () => {
    if (!gcashRow) throw new Error("no Gcash spending row");
    const { live, binned } = bin(ledger, [gcashRow.id]);

    const back = restore(renameAccount(live, "Gcash", "GCash Wallet"), binned, true);
    expect(walletBalance(back, "Gcash")).not.toBe(0);
    expect(walletBalance(back, "GCash Wallet") + walletBalance(back, "Gcash")).toBe(15571);
  });
});
