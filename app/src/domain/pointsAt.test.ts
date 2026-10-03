/**
 * "earlier", "that", "the treat": the owner's two questions of 3 October
 * 2026, on invented rows.
 */
import { describe, expect, it } from "vitest";

import { pointsAt } from "./pointsAt";
import type { Transaction } from "./types";

const row = (n: number, date: string, item: string, description: string, total: number, from = "Cash"): Transaction => ({
  id: `t${n}`,
  recordNumber: n,
  date,
  type: "Spending",
  fromWallet: from,
  toWallet: "",
  category: "Spending",
  item,
  description,
  amount: total,
  fee: 0,
  total,
  notes: "",
  status: "Paid",
});
const ledger = [
  row(10, "2026-09-20", "Treat", "treat a friend", 45_000),
  row(11, "2026-10-02", "Travel", "bus fare and food", 58_800),
  row(12, "2026-10-03", "Treat", "noodles with friends", 37_500),
  row(13, "2026-10-03", "Food", "water", 2_000),
];

describe("what the question points at", () => {
  it("is the entry it names, the newest one", () => {
    const lines = pointsAt("Does my treat earlier unconstitutional?", ledger, "2026-10-03");
    expect(lines[1]).toContain("#0012, the newest entry it names: Spending Treat PHP 375.00 on 2026-10-03 out of Cash");
  });

  it("is the newest entry today when it names none, and says no amount was given", () => {
    const lines = pointsAt("Like I was invited urgently earlier, what can you advice?", ledger, "2026-10-03");
    expect(lines[1]).toContain("#0013, the newest entry today");
    expect(lines[2]).toContain("never assume one");
  });

  it("is nothing for a question that points at nothing", () => {
    expect(pointsAt("how much did I spend on food in August", ledger, "2026-10-03")).toEqual([]);
    expect(pointsAt("is that ok?", [], "2026-10-03")).toEqual([]);
  });
});
