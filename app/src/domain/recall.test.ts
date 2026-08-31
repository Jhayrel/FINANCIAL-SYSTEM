import { describe, expect, it } from "vitest";

import { detectRecall, findRows } from "./recall";
import type { Transaction } from "./types";

let n = 0;
const row = (over: Partial<Transaction> = {}): Transaction => {
  n += 1;
  return {
    id: `t-${n}`,
    recordNumber: n,
    date: "2026-08-28",
    type: "Spending",
    fromWallet: "Cash",
    toWallet: "",
    category: "Spending",
    item: "Food",
    description: "",
    amount: 10000,
    fee: 0,
    total: 10000,
    notes: "",
    status: "Paid",
    ...over,
  };
};

const ASOF = "2026-08-29";

describe("detectRecall", () => {
  it("reads the instruction the owner actually typed", () => {
    const found = detectRecall("delete the data I created yesterday about the groceries");
    expect(found?.action).toBe("bin");
    expect(found?.phrase).toBe("yesterday groceries");
  });

  it("reads bringing one back, and does not mistake undelete for delete", () => {
    expect(detectRecall("restore the groceries")?.action).toBe("restore");
    expect(detectRecall("undelete record 441")?.action).toBe("restore");
    expect(detectRecall("bring back the food from yesterday")?.action).toBe("restore");
  });

  it("finds no instruction in an ordinary message", () => {
    expect(detectRecall("I spent 100 on food")).toBeNull();
    expect(detectRecall("how much did I spend")).toBeNull();
    expect(detectRecall("")).toBeNull();
  });

  it("strips the words that describe the instruction, not the row", () => {
    // "entry" and "record" would otherwise match every row.
    expect(detectRecall("remove the entry about gas")?.phrase).toBe("gas");
  });
});

describe("findRows", () => {
  const ledger = [
    row({ recordNumber: 41, date: "2026-08-28", item: "Home Needs", description: "groceries" }),
    row({ recordNumber: 42, date: "2026-08-28", item: "Food", amount: 25000, total: 25000 }),
    row({ recordNumber: 43, date: "2026-08-20", item: "Gas", amount: 20000, total: 20000 }),
  ];

  it("finds the row the phrase describes", () => {
    const found = findRows("yesterday groceries", ledger, ASOF);
    expect(found[0]?.row.recordNumber).toBe(41);
    expect(found[0]?.why.join(" ")).toContain("groceries");
  });

  it("a record number outranks everything else", () => {
    expect(findRows("#0043", ledger, ASOF)[0]?.row.recordNumber).toBe(43);
  });

  it("matches on an amount", () => {
    expect(findRows("250 food", ledger, ASOF)[0]?.row.recordNumber).toBe(42);
  });

  it("matches on a written date", () => {
    const found = findRows("2026-08-20", ledger, ASOF);
    expect(found).toHaveLength(1);
    expect(found[0]?.row.recordNumber).toBe(43);
  });

  /**
   * A phrase naming nothing returns nothing. Offering the whole ledger to be
   * deleted, sorted arbitrarily, is how the wrong row gets binned.
   */
  it("finds nothing when the phrase describes nothing", () => {
    expect(findRows("", ledger, ASOF)).toEqual([]);
    expect(findRows("it", ledger, ASOF)).toEqual([]);
  });

  it("finds nothing rather than everything for a word no row holds", () => {
    expect(findRows("scuba", ledger, ASOF)).toEqual([]);
  });

  it("puts the better match first when several answer", () => {
    const found = findRows("yesterday", ledger, ASOF);
    expect(found.map((c) => c.row.recordNumber)).toEqual([42, 41]);
  });

  it("never offers more than a handful to choose between", () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      row({ recordNumber: 100 + i, date: "2026-08-28", item: "Food" }),
    );
    expect(findRows("yesterday food", many, ASOF).length).toBeLessThanOrEqual(5);
  });

  it("searches the bin the same way", () => {
    const binned = [row({ recordNumber: 90, item: "Home Needs", description: "groceries" })];
    expect(findRows("groceries", binned, ASOF)[0]?.row.recordNumber).toBe(90);
  });
});
