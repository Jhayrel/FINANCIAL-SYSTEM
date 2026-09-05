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

/**
 * "discard the food I paid yesterday" offered five rows to be binned.
 *
 * Four of the five were wrong. Two were from yesterday but were not food,
 * and two were months old, matched on the word "paid" appearing inside a
 * description and on "the" appearing inside another. Every one of them had a
 * button on it that moves a real money record out of the ledger.
 *
 * The cause was that the signals were added up rather than required. A row
 * that matched nothing but the date still scored, and so was still offered.
 * A person naming a day and a thing means both.
 */
describe("everything the phrase names has to agree", () => {
  const day = "2026-09-04";
  const ledger = [
    row({ recordNumber: 493, date: day, item: "Online Buy", description: "ANTHROPIC subscription", amount: 116000 }),
    row({ recordNumber: 492, date: day, item: "Online Buy", description: "Shopee purchase", amount: 144790 }),
    row({ recordNumber: 480, date: day, item: "Food", description: "McDo", amount: 25000 }),
    row({ recordNumber: 413, date: "2026-08-06", item: "Online Buy", description: "Lazada, paid by the card", amount: 59800 }),
    row({ recordNumber: 305, date: "2026-05-12", item: "Food", description: "Jollibee", amount: 10000 }),
    row({ recordNumber: 208, date: "2026-04-07", item: "Online Buy", description: "the usual", amount: 59600 }),
  ];
  const ASOF_NOW = "2026-09-05";

  it("offers only the row that is both the day and the thing", () => {
    const recall = detectRecall("discard the food I paid yesterday");
    const found = findRows(recall!.phrase, ledger, ASOF_NOW);
    expect(found).toHaveLength(1);
    expect(found[0]?.row.recordNumber).toBe(480);
  });

  it("does not offer a row that only shares the day", () => {
    const recall = detectRecall("discard the food I paid yesterday");
    const numbers = findRows(recall!.phrase, ledger, ASOF_NOW).map((c) => c.row.recordNumber);
    expect(numbers).not.toContain(493);
    expect(numbers).not.toContain(492);
  });

  it("does not offer a row from months earlier", () => {
    const recall = detectRecall("discard the food I paid yesterday");
    const numbers = findRows(recall!.phrase, ledger, ASOF_NOW).map((c) => c.row.recordNumber);
    expect(numbers).not.toContain(413);
    expect(numbers).not.toContain(305);
  });

  /** "paid" is the verb of the sentence, not a description of a row. */
  it("treats the verb as an instruction word", () => {
    expect(detectRecall("discard the food I paid yesterday")?.phrase).toBe("food yesterday");
  });

  it("matches a word, not a run of letters inside another word", () => {
    const found = findRows("usual", ledger, ASOF_NOW);
    expect(found.map((c) => c.row.recordNumber)).toEqual([208]);
    // "sual" is inside "usual" and is not a word this row holds.
    expect(findRows("sual", ledger, ASOF_NOW)).toEqual([]);
  });

  it("says nothing rather than something wrong when the day has no such thing", () => {
    const recall = detectRecall("discard the gas I paid yesterday");
    expect(findRows(recall!.phrase, ledger, ASOF_NOW)).toEqual([]);
  });

  /**
   * A date is a date. Its digits were being read as a peso figure as well,
   * which then filtered away the row the date was naming.
   */
  it("does not read the year in a date as an amount", () => {
    const found = findRows("2026-09-04 food", ledger, ASOF_NOW);
    expect(found).toHaveLength(1);
    expect(found[0]?.row.recordNumber).toBe(480);
  });

  it("keeps an amount as a filter when one is genuinely named", () => {
    const found = findRows("1160", ledger, ASOF_NOW);
    expect(found.map((c) => c.row.recordNumber)).toEqual([493]);
  });
});
