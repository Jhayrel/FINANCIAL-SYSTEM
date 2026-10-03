/**
 * Renaming any kind on the owner's lists, and every row following it.
 * 3 October 2026: "in categories make them editable too then it will sync
 * to the whole system and fix every data". Lists and rows are invented.
 */
import { describe, expect, it } from "vitest";

import { renameItem } from "./accounts";
import { correctionsFrom, type AiEvent } from "./aiLog";
import { checkRename, renameInLists, rowsNamed, unlistedKinds } from "./kindRename";
import { totalSpending } from "./totals";
import type { Transaction } from "./types";

const lists = {
  bills: ["Internet", "Water bill"],
  subscriptions: ["Music app"],
  revenueCategories: ["Allowance", "Random"],
  spendingTypes: [
    { name: "Food", remark: "Meals", necessity: "essential" as const },
    { name: "Travel", remark: "" },
    { name: "Trips", remark: "Out of town" },
  ],
  stopped: [{ name: "Music app", since: "2026-09-27" }],
};
const others = { accounts: ["Cash", "Wallet A"], credits: ["Credit line"] };

let n = 0;
const row = (item: string, type: "Spending" | "Revenue" = "Spending", category = type === "Revenue" ? "Revenue" : "Spending", date = "2026-09-20"): Transaction => {
  n += 1;
  return {
    id: `r${n}`, recordNumber: n, date, type, fromWallet: type === "Spending" ? "Cash" : "", toWallet: type === "Revenue" ? "Cash" : "",
    category: category as Transaction["category"], item, description: "", amount: 10_000, fee: 0, total: 10_000, notes: "", status: type === "Spending" ? "Paid" : "Received",
  };
};

describe("what a rename may be", () => {
  it("is a new name on the same list, or a merge into one already there", () => {
    expect(checkRename(lists, "bills", "Water bill", "Water", others)).toEqual({ ok: true, merge: false, to: "Water" });
    expect(checkRename(lists, "spendingTypes", "Trips", "travel", others)).toEqual({ ok: true, merge: true, to: "Travel" });
    // A change of case alone is a rename.
    expect(checkRename(lists, "spendingTypes", "Food", "FOOD", others)).toEqual({ ok: true, merge: false, to: "FOOD" });
  });

  it("is never a name on another list, an account, a worked-out kind or a kind of entry", () => {
    expect(checkRename(lists, "bills", "Internet", "food", others)).toMatchObject({ ok: false, reason: expect.stringContaining("Food is already one of your kinds of spending") });
    expect(checkRename(lists, "revenueCategories", "Random", "Cash", others)).toMatchObject({ ok: false });
    expect(checkRename(lists, "spendingTypes", "Food", "Money Send", others)).toMatchObject({ ok: false });
    expect(checkRename(lists, "revenueCategories", "Random", "Revenue", others)).toMatchObject({ ok: false });
    expect(checkRename(lists, "bills", "Internet", "  ", others)).toMatchObject({ ok: false });
  });
});

describe("the lists after a rename", () => {
  it("renames in place, and a stop follows its name", () => {
    expect(renameInLists(lists, "subscriptions", "Music app", "Music")).toEqual({ subscriptions: ["Music"], stopped: [{ name: "Music", since: "2026-09-27" }] });
    expect(renameInLists(lists, "revenueCategories", "Random", "Small income").revenueCategories).toEqual(["Allowance", "Small income"]);
  });

  it("merges a kind of spending, keeping the target's note and taking the old one's where it has none", () => {
    const merged = renameInLists(lists, "spendingTypes", "Trips", "Travel").spendingTypes;
    expect(merged).toEqual([{ name: "Food", remark: "Meals", necessity: "essential" }, { name: "Travel", remark: "Out of town" }]);
  });
});

describe("every row follows", () => {
  it("whatever the case it was saved in, and no amount moves", () => {
    const rows = [row("Trips"), row("trips "), row("Food"), row("Travel")];
    const renamed = renameItem(rows, "Trips", "Travel");
    expect(renamed.map((t) => t.item)).toEqual(["Travel", "Travel", "Food", "Travel"]);
    expect(totalSpending(renamed)).toBe(totalSpending(rows));
    expect(rowsNamed(rows, "trips")).toBe(2);
  });
});

describe("what the assistant learned", () => {
  it("follows the kind it was taught to its new name", () => {
    const at = (s: number): string => `2026-10-03T0${s}:00:00.000Z`;
    const events: AiEvent[] = [
      { id: "1", at: at(1), action: "edited", where: "add", field: "item", proposed: "beach", corrected: "Trips" },
      { id: "2", at: at(2), action: "edited", where: "add", field: "item", proposed: "Trips", corrected: "Travel", text: "Renamed in Settings" },
    ];
    const learned = correctionsFrom(events, "item", ["Food", "Travel"]);
    expect(learned.get("beach")).toBe("Travel");
    expect(learned.get("trips")).toBe("Travel");
  });
});

describe("kinds on no list", () => {
  it("are found by the list their rows belong on, newest first, never a worked-out kind", () => {
    const rows = [
      row("Vacation", "Spending", "Spending", "2026-10-02"),
      row("Vacation", "Spending", "Spending", "2026-09-01"),
      row("Salary", "Revenue", "Revenue", "2026-09-15"),
      row("Old plan", "Spending", "Subscriptions", "2024-01-05"),
      row("Money Send"),
      row("Food"),
      row("Allowance", "Revenue"),
    ];
    expect(unlistedKinds(rows, lists)).toEqual([
      { name: "Vacation", flow: "Spending", list: "spendingTypes", rows: 2, last: "2026-10-02" },
      { name: "Salary", flow: "Revenue", list: "revenueCategories", rows: 1, last: "2026-09-15" },
      { name: "Old plan", flow: "Spending", list: "subscriptions", rows: 1, last: "2024-01-05" },
    ]);
  });
});
