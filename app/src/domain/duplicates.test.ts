/**
 * The same receipt, twice.
 *
 * Every case here is taken from the owner's recorded history, where one
 * message carried three copies of the same `image.png` and the next carried
 * three more, each reading as PHP 1,447.90, and nothing anywhere said so.
 */

import { describe, it, expect } from "vitest";
import { duplicatesOf, duplicateHeadline, repeatsWithin } from "./duplicates";
import { emptyDraft, type Draft } from "./entry";
import type { Transaction } from "./types";

const row = (over: Partial<Transaction>): Transaction => ({
  id: "t-1",
  recordNumber: 493,
  date: "2026-09-04",
  type: "Spending",
  fromWallet: "Maya",
  toWallet: "",
  category: "Spending",
  item: "Online Buy",
  description: "ANTHROPIC* CLAUDE.AI SUBSCRIPTION",
  amount: 116000,
  fee: 0,
  total: 116000,
  notes: "",
  status: "Paid",
  ...over,
});

const draft = (over: Partial<Draft>): Draft => ({
  ...emptyDraft("2026-09-04"),
  flow: "Spending",
  fromWallet: "Maya",
  category: "Spending",
  item: "Online Buy",
  description: "ANTHROPIC* CLAUDE.AI SUBSCRIPTION",
  amount: 116000,
  status: "Paid",
  ...over,
});

describe("the receipt already added", () => {
  it("finds the row the second upload repeats", () => {
    const found = duplicatesOf(draft({}), [row({})]);
    expect(found).toHaveLength(1);
    expect(found[0]?.row.recordNumber).toBe(493);
  });

  it("calls it the same when the day, the item and the wallet all agree", () => {
    const [match] = duplicatesOf(draft({}), [row({})]);
    expect(match?.certainty).toBe("same");
    expect(duplicateHeadline(match!)).toContain("#0493");
  });

  it("gives the evidence in words, amount first", () => {
    const [match] = duplicatesOf(draft({}), [row({})]);
    expect(match?.evidence[0]).toBe("Both ₱1,160.00.");
    expect(match?.evidence.join(" ")).toContain("Both dated");
    expect(match?.evidence.join(" ")).toContain("Both Online Buy.");
    expect(match?.evidence.join(" ")).toContain("Both through Maya.");
  });

  it("prints the wallet as the ledger spells it, not lower-cased", () => {
    const [match] = duplicatesOf(draft({ fromWallet: "maya" }), [row({})]);
    expect(match?.evidence.join(" ")).toContain("Both through Maya.");
  });
});

describe("what is not a duplicate", () => {
  it("ignores a different amount", () => {
    expect(duplicatesOf(draft({ amount: 116001 }), [row({})])).toEqual([]);
  });

  it("ignores money going the other way", () => {
    const income = row({ type: "Revenue", fromWallet: "", toWallet: "Maya" });
    expect(duplicatesOf(draft({}), [income])).toEqual([]);
  });

  it("ignores a matching figure with nothing else in common", () => {
    const unrelated = row({
      item: "Food",
      description: "Jollibee",
      fromWallet: "Cash",
      recordNumber: 12,
    });
    expect(duplicatesOf(draft({}), [unrelated])).toEqual([]);
  });

  it("ignores the same figure two weeks apart", () => {
    const old = row({ date: "2026-08-20", description: "" });
    expect(duplicatesOf(draft({ description: "" }), [old])).toEqual([]);
  });

  /**
   * The subscription case. Every monthly bill has an identical description
   * and an identical amount by design, so a description match that reached
   * across a billing cycle would put a duplicate warning on every one of
   * them, and a warning that fires on everything is read as nothing.
   */
  it("leaves next month's identical subscription alone", () => {
    const lastMonth = row({ date: "2026-08-04", recordNumber: 460 });
    expect(duplicatesOf(draft({}), [lastMonth])).toEqual([]);
  });

  it("ignores a row already in the bin", () => {
    const binned = { ...row({}), deletedAt: "2026-09-04T10:00:00.000Z" } as Transaction;
    expect(duplicatesOf(draft({}), [binned])).toEqual([]);
  });

  it("says nothing about a card with no amount yet", () => {
    expect(duplicatesOf(draft({ amount: null }), [row({})])).toEqual([]);
  });

  it("never reports a saved row against itself", () => {
    const found = duplicatesOf(draft({ id: "t-1" }), [row({})], { ignoreId: "t-1" });
    expect(found).toEqual([]);
  });
});

describe("close, but not certain", () => {
  it("reports a day apart as close rather than the same", () => {
    const [match] = duplicatesOf(draft({}), [row({ date: "2026-09-03" })]);
    expect(match?.certainty).toBe("close");
    expect(match?.evidence.join(" ")).toContain("1 day apart");
    expect(duplicateHeadline(match!)).toContain("looks like");
  });

  it("still reports the same description a week later, when nothing else agrees", () => {
    const week = row({ date: "2026-08-28", recordNumber: 470, item: "", fromWallet: "Gcash" });
    const [match] = duplicatesOf(draft({}), [week]);
    expect(match?.certainty).toBe("close");
    expect(match?.evidence.join(" ")).toContain("Word for word");
  });

  it("puts the strongest match first", () => {
    const near = row({ id: "t-2", recordNumber: 400, date: "2026-09-02", description: "" });
    const exact = row({ id: "t-3", recordNumber: 493 });
    const found = duplicatesOf(draft({}), [near, exact]);
    expect(found[0]?.row.recordNumber).toBe(493);
    expect(found[0]?.certainty).toBe("same");
  });

  it("shows at most three, so a card does not become a list", () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      row({ id: `t-${i}`, recordNumber: 100 + i }),
    );
    expect(duplicatesOf(draft({}), many)).toHaveLength(3);
  });
});

describe("the same photo attached three times", () => {
  it("marks the second and third card as repeats of the first", () => {
    const three = [draft({}), draft({}), draft({})];
    const repeats = repeatsWithin(three);
    expect(repeats.get(0)).toBeUndefined();
    expect(repeats.get(1)).toBe(0);
    expect(repeats.get(2)).toBe(0);
  });

  it("leaves a genuinely different card alone", () => {
    const batch = [draft({}), draft({ amount: 34000, item: "Food", description: "Jollibee" })];
    expect(repeatsWithin(batch).size).toBe(0);
  });

  it("does not pair two blank cards with each other", () => {
    const blanks = [emptyDraft("2026-09-04"), emptyDraft("2026-09-04")];
    expect(repeatsWithin(blanks).size).toBe(0);
  });
});
