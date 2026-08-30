/**
 * Transfer classification, checked against the real 440-row ledger.
 *
 * The point of these tests is that the rule is DERIVED, not configured. If the
 * derivation ever disagrees with what the owner filed by hand, one of the two
 * is wrong and the test says which rows to look at.
 */

import { describe, expect, it } from "vitest";

import { loadFixture } from "../fixtures/load";
import {
  accountLookup,
  classifyTransfer,
  misfiledTransfers,
  transferSpending,
} from "./transfers";
import type { Transaction } from "./types";

const fixture = loadFixture();
const transactions = fixture.transactions;

/** The accounts as the workbook lists them, plus the retired ones. */
const ACCOUNTS = [
  { name: "Gcash", kind: "spending", channel: "bank" as const },
  { name: "Maya", kind: "spending", channel: "bank" as const },
  { name: "Cash", kind: "spending", channel: "cash" as const },
  { name: "Reserved Fund", kind: "reserve" },
  { name: "Allowance (Reserve)", kind: "reserve" },
  { name: "Tuition (Reserve)", kind: "reserve" },
  { name: "Extra Cash", kind: "savings", channel: "cash" as const },
  { name: "Maya Bank (Personal savings)", kind: "savings" },
];

const lookup = accountLookup(ACCOUNTS);

const row = (n: number): Transaction => {
  const found = transactions.find((t) => t.recordNumber === n);
  if (!found) throw new Error(`record #${n} missing from the fixture`);
  return found;
};

describe("the rule the whole module rests on", () => {
  it("treats a blank destination as money that left", () => {
    // #13: PHP 2,000.00 cash given to his father.
    const f = classifyTransfer(row(13), lookup);
    expect(f.kind).toBe("sent-out");
    expect(f.internal).toBe(false);
    expect(f.item).toBe("Money Send");
    expect(f.spending).toBe(200000);
  });

  it("treats a named destination as money still yours", () => {
    // #11: Gcash to Cash, PHP 9,000.00 moved, PHP 15.00 to do it.
    const f = classifyTransfer(row(11), lookup);
    expect(f.internal).toBe(true);
    expect(f.item).toBe("Transaction Fee");
    expect(f.spending).toBe(1500);
  });

  it("counts the fee on a send-out as well as the amount", () => {
    const sent: Transaction = { ...row(13), amount: 10000, fee: 1500, total: 11500 };
    expect(classifyTransfer(sent, lookup).spending).toBe(11500);
  });

  it("costs nothing when an internal move is free", () => {
    // #9: Maya to Maya Bank savings, no fee.
    expect(classifyTransfer(row(9), lookup).spending).toBe(0);
  });
});

describe("the scenarios the owner asked about", () => {
  const at = (from: string, to: string, fee = 1500): Transaction => ({
    ...row(11),
    fromWallet: from,
    toWallet: to,
    fee,
  });

  it("sending to another person is sent-out", () => {
    expect(classifyTransfer(at("Maya", ""), lookup).kind).toBe("sent-out");
  });

  it("sending to your own other bank is a plain move", () => {
    expect(classifyTransfer(at("Gcash", "Maya"), lookup).kind).toBe("moved");
  });

  it("bank to cash is a withdrawal", () => {
    expect(classifyTransfer(at("Maya", "Cash"), lookup).kind).toBe("withdrawal");
  });

  it("cash to bank is a deposit", () => {
    expect(classifyTransfer(at("Cash", "Maya"), lookup).kind).toBe("deposit");
  });

  it("into a reserve is setting money aside", () => {
    expect(classifyTransfer(at("Cash", "Tuition (Reserve)"), lookup).kind).toBe("set-aside");
  });

  it("out of a reserve is drawing it down", () => {
    expect(classifyTransfer(at("Tuition (Reserve)", "Cash"), lookup).kind).toBe("drawn-down");
  });

  it("none of the internal moves is spending beyond its fee", () => {
    for (const t of [
      at("Gcash", "Maya"),
      at("Maya", "Cash"),
      at("Cash", "Maya"),
      at("Cash", "Tuition (Reserve)"),
      at("Tuition (Reserve)", "Cash"),
    ]) {
      expect(classifyTransfer(t, lookup).spending).toBe(t.fee);
      expect(classifyTransfer(t, lookup).internal).toBe(true);
    }
  });
});

describe("a retired account is still yours", () => {
  it("does not book a move into a closed account as money given away", () => {
    // #64: PHP 13,000.00 into "Hidden cash (fieldtrip)", an account that no
    // longer appears in the wallet list.
    const f = classifyTransfer(row(64), lookup);
    expect(f.internal).toBe(true);
    expect(f.spending).toBe(0);
  });
});

describe("agreement with what the owner filed by hand", () => {
  const transfers = transactions.filter((t) => t.type === "Transfer");

  it("finds every Money Send row from the destination alone", () => {
    const derived = transfers.filter((t) => classifyTransfer(t, lookup).kind === "sent-out");
    const filed = transfers.filter((t) => t.item === "Money Send");
    expect(derived.map((t) => t.recordNumber)).toEqual(filed.map((t) => t.recordNumber));
    expect(derived).toHaveLength(3);
  });

  it("disagrees on exactly two rows out of 440", () => {
    const misfiled = misfiledTransfers(transactions, lookup);
    expect(misfiled.map((m) => m.transaction.recordNumber)).toEqual([8, 406]);
  });

  it("catches the fee that was never labelled", () => {
    // #8: Gcash to Maya, PHP 15.00 charged, item left blank. This is the row
    // that cost real money, because the totals only ever saw a labelled fee.
    const [first] = misfiledTransfers(transactions, lookup);
    expect(first?.transaction.recordNumber).toBe(8);
    expect(first?.stored).toBe("");
    expect(first?.expected).toBe("Transaction Fee");
    expect(first?.transaction.fee).toBe(1500);
  });

  it("catches the label that was never a fee", () => {
    // #406: labelled Transaction Fee but the fee is zero, so the label was
    // never true. Worth nothing, still worth correcting.
    const last = misfiledTransfers(transactions, lookup)[1];
    expect(last?.transaction.recordNumber).toBe(406);
    expect(last?.stored).toBe("Transaction Fee");
    expect(last?.expected).toBe("");
    expect(last?.transaction.fee).toBe(0);
  });
});

describe("what the correction is worth", () => {
  const transfers = transactions.filter((t) => t.type === "Transfer");
  const sum = (rows: readonly Transaction[]): number =>
    rows.reduce((a, t) => a + transferSpending(t, lookup), 0);

  it("recovers the PHP 15.00 the Excel lost on record #8", () => {
    const lost = misfiledTransfers(transactions, lookup)
      .filter((m) => m.stored === "")
      .reduce((a, m) => a + m.transaction.fee, 0);
    expect(lost).toBe(1500);
  });

  it("puts the PHP 4,100.00 of Money Send into the total, not just the ranking", () => {
    const sentOut = transfers.filter((t) => classifyTransfer(t, lookup).kind === "sent-out");
    expect(sum(sentOut)).toBe(410000);
  });

  it("adds PHP 4,115.00 to the 2026 annual figure and nothing to August", () => {
    const year = transactions.filter((t) => t.date.startsWith("2026"));
    const august = year.filter((t) => t.date.slice(5, 7) === "08");

    // What the Excel counted: type Transfer with the item spelled out.
    const excel = (rows: readonly Transaction[]): number =>
      rows
        .filter((t) => t.type === "Transfer" && t.item === "Transaction Fee")
        .reduce((a, t) => a + t.fee, 0);

    expect(sum(year.filter((t) => t.type === "Transfer")) - excel(year)).toBe(411500);
    expect(sum(august.filter((t) => t.type === "Transfer")) - excel(august)).toBe(0);
  });
});
