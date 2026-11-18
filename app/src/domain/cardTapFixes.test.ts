/**
 * The fixes from the owner's 18 November 2026 backup, with invented figures.
 *
 * A tapped answer on a card's question changed nothing for ten seconds and
 * then saved the withdrawal without its fee; a model card ignored the kind
 * the sentence named; and "at an ATM" split one withdrawal into two cards.
 */

import { describe, expect, it } from "vitest";

import { answerCard, keepTheMoney } from "./cardQuestions";
import { emptyDraft, type Draft } from "./entry";
import { inferFromHistory } from "./infer";
import { splitEntries } from "./readEntry";
import type { ReferenceLists, Transaction } from "./types";
import { followNamedKind, verifyReading } from "./verify";

const ASOF = "2026-11-18";

const reference: ReferenceLists = {
  wallets: ["Cash", "Gcash", "Maya"],
  savings: ["Maya Bank (Personal savings)"],
  bills: ["Electricity"],
  subscriptions: ["Spotify"],
  revenueCategories: ["Allowance"],
  spendingTypes: [
    { name: "Food", remark: "" },
    { name: "Online Buy", remark: "" },
    { name: "Gas", remark: "" },
  ],
};

/** A withdrawal into Cash with its fee, source not known yet. */
const withdrawal: Draft = {
  ...emptyDraft(ASOF),
  flow: "Transfer",
  category: "Transfer",
  status: "Transferred",
  toWallet: "Cash",
  description: "ATM cash withdrawal",
  amount: 120000,
  fee: 1500,
};

describe("a tapped answer keeps the fee", () => {
  it("names the source and keeps ₱15.00", () => {
    const after = answerCard(withdrawal, "fromWallet", "Maya", reference);
    expect(after?.fromWallet).toBe("Maya");
    const kept = keepTheMoney(withdrawal, after ?? withdrawal, "Maya");
    expect(kept.fromWallet).toBe("Maya");
    expect(kept.toWallet).toBe("Cash");
    expect(kept.amount).toBe(120000);
    expect(kept.fee).toBe(1500);
  });

  it("takes the new fee when the answer is about the fee", () => {
    const after = { ...withdrawal, fromWallet: "Maya", fee: 2000 };
    expect(keepTheMoney(withdrawal, after, "Maya, the fee was 20").fee).toBe(2000);
  });

  it("keeps the fee even if a re-read dropped it", () => {
    const dropped = { ...withdrawal, fromWallet: "Gcash", fee: 0 };
    expect(keepTheMoney(withdrawal, dropped, "Gcash").fee).toBe(1500);
  });

  it("turns money in to income when Income is tapped", () => {
    const after = answerCard(withdrawal, "fromWallet", "Income", reference);
    expect(after?.flow).toBe("Revenue");
    expect(after?.toWallet).toBe("Cash");
  });
});

describe("a withdrawal's usual source", () => {
  let n = 0;
  const row = (over: Partial<Transaction> = {}): Transaction => {
    n += 1;
    return {
      id: `t-${n}`,
      recordNumber: n,
      date: "2026-10-01",
      type: "Transfer",
      fromWallet: "Maya",
      toWallet: "Cash",
      category: "Transfer",
      item: "",
      description: "",
      amount: 50000,
      fee: 1500,
      total: 51500,
      notes: "",
      status: "Transferred",
      ...over,
    };
  };

  it("fills in the wallet every recent withdrawal with a fee came from", () => {
    const ledger = [row(), row(), row(), row()];
    const { draft, because, unsure } = inferFromHistory(withdrawal, ledger, reference, "withdrew 1200 at an atm, 15 fee");
    expect(draft.fromWallet).toBe("Maya");
    expect(unsure).toContain("fromWallet");
    expect(because.join(" ")).toContain("Change it if this one was not");
  });

  it("leaves it blank when the history is mixed", () => {
    const ledger = [row(), row({ fromWallet: "Gcash" }), row(), row({ fromWallet: "Gcash" })];
    expect(inferFromHistory(withdrawal, ledger, reference, "withdrew 1200").draft.fromWallet).toBe("");
  });

  it("leaves it blank with too little history", () => {
    expect(inferFromHistory(withdrawal, [row(), row()], reference, "withdrew 1200").draft.fromWallet).toBe("");
  });

  it("does not guess for a withdrawal with no fee", () => {
    const free = { ...withdrawal, fee: 0 };
    expect(inferFromHistory(free, [row(), row(), row(), row()], reference, "withdrew 1200").draft.fromWallet).toBe("");
  });
});

describe("one withdrawal is one entry", () => {
  it('does not split on "at an ATM"', () => {
    expect(splitEntries("withdrew 1200 at an ATM with 15 fee")).toHaveLength(1);
  });

  it("does not split a lone fee off its payment", () => {
    expect(splitEntries("sent 500 to gcash and 10 fee")).toHaveLength(1);
  });

  it("still splits two purchases joined by and", () => {
    expect(splitEntries("food 100 and gas 200")).toHaveLength(2);
  });
});

describe("the kind you named is the kind it is booked as", () => {
  const read: Draft = {
    ...emptyDraft(ASOF),
    flow: "Spending",
    category: "Spending",
    status: "Paid",
    item: "Online Buy",
    fromWallet: "Cash",
    amount: 9600,
  };

  it('books "96 in food" as Food and drops the warning', () => {
    const said = "96 in food cash";
    const first = verifyReading(read, said, reference, ASOF, "medium");
    expect(first.namedItem).toBe("Food");
    const { draft, named, checked } = followNamedKind(read, said, first, reference, ASOF, "medium");
    expect(named).toBe("Food");
    expect(draft.item).toBe("Food");
    expect(checked.findings.filter((f) => f.check === "item")).toHaveLength(0);
  });

  it("changes nothing when the clause holds two entries", () => {
    const said = "96 in food and 40 gas";
    const first = verifyReading(read, said, reference, ASOF, "medium");
    const { draft, named } = followNamedKind(read, said, first, reference, ASOF, "medium");
    expect(named).toBeUndefined();
    expect(draft.item).toBe("Online Buy");
  });

  it("changes nothing when no kind is named", () => {
    const said = "96 from cash";
    const first = verifyReading(read, said, reference, ASOF, "medium");
    expect(followNamedKind(read, said, first, reference, ASOF, "medium").draft.item).toBe("Online Buy");
  });

  it("changes nothing when the reading already agrees", () => {
    const said = "96 in food cash";
    const right = { ...read, item: "Food" };
    const first = verifyReading(right, said, reference, ASOF, "medium");
    expect(first.namedItem).toBeUndefined();
    expect(followNamedKind(right, said, first, reference, ASOF, "medium").named).toBeUndefined();
  });
});
