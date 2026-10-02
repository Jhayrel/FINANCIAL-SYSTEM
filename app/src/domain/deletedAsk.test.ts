/**
 * What is in the bin, by date. The owner's own sentences of 29 September
 * 2026, on invented rows: "I think i deleted a wrong entry", then "last
 * month?", then "it should know all the deleted by date".
 */
import { describe, expect, it } from "vitest";

import { asksAboutDeleted, binForModel, deletedRows, deletedWindowIn, deletedWords, onlyAWindow } from "./deletedAsk";
import type { DeletedTransaction } from "./types";

const TODAY = "2026-09-29";

let n = 100;
const binned = (date: string, deletedAt: string, item: string, total: number): DeletedTransaction => {
  n += 1;
  return {
    id: `d${n}`,
    recordNumber: n,
    date,
    type: "Spending",
    fromWallet: "Cash",
    toWallet: "",
    category: "Spending",
    item,
    description: "",
    amount: total,
    fee: 0,
    total,
    notes: "",
    status: "Paid",
    deletedAt,
  };
};

const bin = [
  binned("2026-09-29", "2026-09-29T06:20:00Z", "Food", 9500),
  binned("2026-09-20", "2026-09-28T03:00:00Z", "Gas", 25000),
  binned("2026-08-14", "2026-08-15T09:00:00Z", "School", 30000),
  binned("2026-08-02", "2026-09-27T01:00:00Z", "Treat", 12000),
];

describe("a sentence about having deleted something", () => {
  it("is about the bin", () => {
    for (const s of [
      "I think i deleted a wrong entry",
      "what did I delete last week?",
      "show me what I deleted",
      "I deleted something by accident",
      "ano yung nadelete ko kahapon?",
      "what's in the bin",
    ]) {
      expect(asksAboutDeleted(s), s).toBe(true);
    }
  });

  it("is not an order to delete, or a restore of one named row", () => {
    for (const s of ["delete the gas yesterday", "remove that", "restore the gas I deleted", "that last entry is wrong", "I spent 150 on food"]) {
      expect(asksAboutDeleted(s), s).toBe(false);
    }
  });
});

describe("the bin by date", () => {
  it("lists every deleted row newest deletion first, with when", () => {
    const rows = deletedRows(bin, null);
    expect(rows.map((r) => r.row.item)).toEqual(["Food", "Gas", "Treat", "School"]);
    expect(rows[1]?.why).toEqual(["Deleted September 28, 2026, for September 20, 2026."]);
    expect(rows[0]?.why).toEqual(["Deleted September 29, 2026."]);
  });

  it("narrows to a period by the day deleted or the day it was for", () => {
    const lastMonth = deletedWindowIn("last month?", TODAY);
    expect(lastMonth).toEqual({ from: "2026-08-01", to: "2026-08-31", name: "last month" });
    // School was deleted in August; Treat was for August and deleted in September.
    expect(deletedRows(bin, lastMonth).map((r) => r.row.item)).toEqual(["Treat", "School"]);
    expect(deletedRows(bin, deletedWindowIn("yesterday", TODAY)).map((r) => r.row.item)).toEqual(["Gas"]);
  });

  it("reads a period said on its own as a follow-up, and nothing else", () => {
    expect(onlyAWindow("last month?", TODAY)?.name).toBe("last month");
    expect(onlyAWindow("september", TODAY)?.from).toBe("2026-09-01");
    expect(onlyAWindow("food 150 cash", TODAY)).toBeNull();
    expect(onlyAWindow("how much did I spend on food last month", TODAY)).toBeNull();
  });

  it("says what it found, and what is there when nothing matches", () => {
    expect(deletedWords(deletedRows(bin, null), bin.length, null)).toMatch(/These 4 are in the bin, deleted most recently/);
    expect(deletedWords([], bin.length, deletedWindowIn("this week", "2026-10-20"))).toMatch(/Nothing in the bin was deleted this week.*4 entries/);
    expect(deletedWords([], 0, null)).toMatch(/The bin is empty/);
  });

  it("tells the model what is in the bin, by the day each was deleted", () => {
    const lines = binForModel(bin);
    expect(lines[0]).toMatch(/## The bin/);
    expect(lines[2]).toMatch(/^deleted 2026-09-29: #0101 2026-09-29 Spending Food PHP 95\.00|^deleted 2026-09-29: #0101 2026-09-29 Spending Food ₱95\.00/);
    expect(binForModel([])[1]).toMatch(/Empty/);
  });
});

describe("the model is told the bin", () => {
  it("as its own section of the chat's figures, when there is one", async () => {
    const { buildContext } = await import("./aiContext");
    const { buildChatContext } = await import("./aiChatContext");
    const reference = { wallets: ["Cash"], savings: [], bills: [], subscriptions: [], revenueCategories: [], spendingTypes: [{ name: "Food", remark: "" }] };
    const snapshot = buildContext({
      transactions: [],
      accounts: [{ id: "cash", name: "Cash", kind: "spending", archived: false }],
      budgets: {} as never,
      credits: [],
      reference,
      lowBalanceThreshold: 0,
      asOf: TODAY,
    });
    const withBin = buildChatContext({ snapshot, transactions: [], asOf: TODAY, question: "what did I delete last week?", deleted: bin }).text;
    expect(withBin).toMatch(/## The bin \(deleted entries, restorable, not counted in any total\)/);
    expect(withBin).toMatch(/deleted 2026-09-28: #0102 2026-09-20 Spending Gas/);
    const without = buildChatContext({ snapshot, transactions: [], asOf: TODAY, question: "hello" }).text;
    expect(without).not.toMatch(/## The bin/);
  });
});
