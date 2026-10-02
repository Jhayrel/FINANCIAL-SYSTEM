/**
 * A model's new kind, filed where the owner files that word. Invented rows in
 * the shape of 30 September 2026: water filed three times under Food, then a
 * card that called it "Water".
 */
import { describe, expect, it } from "vitest";

import { emptyDraft } from "./entry";
import { fileAsBefore } from "./fileAsBefore";
import type { Proposal } from "./proposal";
import type { Transaction } from "./types";

let n = 0;
const row = (item: string, description: string): Transaction => {
  n += 1;
  return {
    id: `r${n}`,
    recordNumber: n,
    date: "2026-09-28",
    type: "Spending",
    fromWallet: "Cash",
    toWallet: "",
    category: "Spending",
    item,
    description,
    amount: 2500,
    fee: 0,
    total: 2500,
    notes: "",
    status: "Paid",
  };
};

const card = (item: string, description = ""): Proposal => ({
  draft: { ...emptyDraft("2026-09-30"), flow: "Spending", category: "Spending", item, description, amount: 2500, fromWallet: "Cash" },
  confidence: "high",
  sourceRef: "user text",
  adjustments: [`"${item}" is not on your list yet.`],
});

const reference = { spendingTypes: [{ name: "Food", remark: "" }, { name: "Treat", remark: "" }, { name: "School", remark: "" }] };
const ledger = [row("Food", "purchase water"), row("Food", "water purchase"), row("Food", "water"), row("Treat", "milk tea")];

describe("a new kind the ledger already has a home for", () => {
  it("files water under Food, and says so", () => {
    const [p] = fileAsBefore([card("Water", "water purchase")], ledger, reference);
    expect(p?.draft.item).toBe("Food");
    expect(p?.adjustments.some((a) => /not on your list/.test(a))).toBe(false);
    expect(p?.adjustments.some((a) => /Filed as Food, where "water" has gone 3 times before/.test(a))).toBe(true);
  });

  it("leaves a word the ledger has never seen as the model read it", () => {
    const [p] = fileAsBefore([card("Tokens", "arcade tokens")], ledger, reference);
    expect(p?.draft.item).toBe("Tokens");
    expect(p?.adjustments).toEqual(['"Tokens" is not on your list yet.']);
  });

  it("leaves it when the ledger is split, or has only one row", () => {
    const split = [row("Food", "snack"), row("Treat", "snack"), row("School", "snack")];
    expect(fileAsBefore([card("Snack")], split, reference)[0]?.draft.item).toBe("Snack");
    expect(fileAsBefore([card("Milk Tea")], ledger, reference)[0]?.draft.item).toBe("Milk Tea");
  });

  it("never touches a kind already on the list, or a bill", () => {
    expect(fileAsBefore([card("Treat")], ledger, reference)[0]?.draft.item).toBe("Treat");
    const bill: Proposal = { ...card("Water"), draft: { ...card("Water").draft, category: "Bills" } };
    expect(fileAsBefore([bill], ledger, reference)[0]?.draft.item).toBe("Water");
  });
});
