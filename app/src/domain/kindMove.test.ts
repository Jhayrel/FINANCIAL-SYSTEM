/**
 * A subscription moved to the bills, or back, and every row following it.
 * 6 October 2026: "add option like moving dito from subscription to bills.
 * make sure it works all entry will be connected and the database is still
 * good". Lists and rows are invented.
 */
import { describe, expect, it } from "vitest";

import { assessMonthFor } from "./budget";
import { monthBills } from "./budgetView";
import { checkMove, moveInLists, moveRows, rowsToMove } from "./kindRename";
import { monthTotals } from "./totals";
import type { Budgets, ReferenceLists, Transaction } from "./types";

const lists = {
  bills: ["Internet"],
  subscriptions: ["Phone plan", "Music app"],
  revenueCategories: ["Allowance"],
  spendingTypes: [{ name: "Food", remark: "" }],
  stopped: [{ name: "Music app", since: "2026-09-27" }],
};

let n = 0;
const row = (over: Partial<Transaction>): Transaction => {
  n += 1;
  const amount = over.amount ?? 19_900;
  return {
    id: `m${n}`,
    recordNumber: n,
    date: "2026-09-08",
    type: "Spending",
    fromWallet: "Cash",
    toWallet: "",
    category: "Subscriptions",
    item: "Phone plan",
    description: "",
    fee: 0,
    notes: "",
    status: "Paid",
    ...over,
    amount,
    total: amount + (over.fee ?? 0),
  };
};

const ledger: Transaction[] = [
  row({ date: "2026-08-08" }),
  row({ date: "2026-09-08" }),
  // Spelled another way by hand: still the same kind.
  row({ date: "2026-07-08", item: "phone plan " }),
  row({ date: "2026-09-12", category: "Bills", item: "Internet", amount: 99_900 }),
  row({ date: "2026-09-10", category: "Spending", item: "Food", amount: 15_000 }),
  // Paid for someone, written off: spending under the bill, so it moves too.
  row({ date: "2026-09-09", type: "Debt", debtId: "dad", debtEffect: "writeoff", fromWallet: "", item: "Phone plan", amount: 59_900 }),
  // Revenue under the same name is not a payment: it never moves.
  row({ date: "2026-09-15", type: "Revenue", fromWallet: "", toWallet: "Cash", category: "Revenue", item: "Phone plan", amount: 1_000 }),
];
// The bin holds rows apart from the ledger (App's `deleted`), and a move reaches them too.
const binned: Transaction[] = [row({ date: "2026-06-08" })];

describe("moving a subscription to the bills", () => {
  it("is allowed for a name on the list, and says when the other list has it already", () => {
    expect(checkMove(lists, "subscriptions", "Phone plan")).toEqual({ ok: true, to: "bills", already: false });
    expect(checkMove(lists, "subscriptions", "phone PLAN")).toEqual({ ok: true, to: "bills", already: false });
    expect(checkMove({ ...lists, bills: ["Internet", "Phone plan"] }, "subscriptions", "Phone plan")).toEqual({ ok: true, to: "bills", already: true });
    expect(checkMove(lists, "bills", "Phone plan").ok).toBe(false);
  });

  it("takes the name off one list and puts it on the other once, spelled as it was, the stop kept", () => {
    expect(moveInLists(lists, "subscriptions", "phone plan")).toEqual({ subscriptions: ["Music app"], bills: ["Internet", "Phone plan"] });
    expect(moveInLists({ ...lists, bills: ["Internet", "Phone plan"] }, "subscriptions", "Phone plan")).toEqual({
      subscriptions: ["Music app"],
      bills: ["Internet", "Phone plan"],
    });
    // The stop is keyed by the name, which does not change, so it is not part of the move.
    expect(moveInLists(lists, "subscriptions", "Music app")).not.toHaveProperty("stopped");
  });

  it("moves every payment of it, any case, live and in the bin, and nothing else", () => {
    expect(rowsToMove([...ledger, ...binned], "Phone plan", "Bills")).toBe(5);
    const moved = moveRows(ledger, "Phone plan", "Bills");
    const changed = moved.filter((t, i) => t !== ledger[i]);
    expect(changed.map((t) => t.category)).toEqual(["Bills", "Bills", "Bills", "Bills"]);
    for (const t of changed) {
      const was = ledger.find((x) => x.id === t.id)!;
      // Only the category: the item, amounts, dates and wallets are as they were.
      expect({ ...t, category: was.category }).toEqual(was);
    }
    expect(moved.find((t) => t.type === "Revenue")?.category).toBe("Revenue");
    expect(moveRows(binned, "Phone plan", "Bills")[0]?.category).toBe("Bills");
  });

  it("changes no total, no budget and no balance: only which of the two it counts under", () => {
    const moved = moveRows(ledger, "Phone plan", "Bills");
    const before = monthTotals(ledger, 2026, 9);
    const after = monthTotals(moved, 2026, 9);
    expect(after.total).toBe(before.total);
    expect(after.bills + after.subscriptions).toBe(before.bills + before.subscriptions);
    expect(after.subscriptions).toBe(before.subscriptions - 19_900 - 59_900);
    const twelve = (v: number) => Array.from({ length: 12 }, () => v) as unknown as Budgets[string]["spending"];
    const budgets: Budgets = { "2026": { spending: twelve(500_000), billsSubs: twelve(170_000) } };
    expect(assessMonthFor(moved, budgets, 2026, 9)).toEqual(assessMonthFor(ledger, budgets, 2026, 9));
  });

  it("is a bill on the Budget screen afterwards, paid on its own day", () => {
    const moved = moveRows(ledger, "Phone plan", "Bills");
    const reference: ReferenceLists = {
      wallets: ["Cash"],
      savings: [],
      revenueCategories: lists.revenueCategories,
      spendingTypes: lists.spendingTypes,
      ...moveInLists(lists, "subscriptions", "Phone plan"),
    } as ReferenceLists;
    const bill = monthBills(moved, reference, 2026, 9, "2026-09-20").bills.find((b) => b.item === "Phone plan");
    expect(bill?.category).toBe("Bills");
    expect(bill?.state).toBe("paid");
    expect(bill?.paidOn).toBe("2026-09-08");
  });

  it("moves back the same way", () => {
    const there = moveRows(ledger, "Phone plan", "Bills");
    const back = moveRows(there, "Phone plan", "Subscriptions");
    // The bill that was always a bill stays one: only its own rows move.
    expect(back.find((t) => t.item === "Internet")?.category).toBe("Bills");
    expect(back.filter((t) => t.item.trim().toLowerCase() === "phone plan" && t.type !== "Revenue").every((t) => t.category === "Subscriptions")).toBe(true);
  });
});
