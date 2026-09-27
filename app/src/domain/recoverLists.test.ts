/**
 * The category lists, rebuilt from the ledger (27 September 2026: the owner's
 * four lists were empty after a restore from files with none).
 */

import { describe, expect, it } from "vitest";

import { recoverLists } from "./recovery";
import type { Transaction } from "./types";

describe("recoverLists: the categories, read back out of the ledger", () => {
  const t = (date: string, type: Transaction["type"], category: Transaction["category"], item: string): Transaction => ({
    id: `${date}-${item}`, recordNumber: 1, date, type, fromWallet: type === "Revenue" ? "" : "Maya", toWallet: type === "Revenue" ? "Maya" : "",
    category, item, description: item, amount: 1000, fee: 0, total: 1000, notes: "", status: "Paid",
  });
  const ledger = [
    t("2022-03-01", "Spending", "Spending", "Arcade"),
    t("2026-08-01", "Spending", "Spending", "Food"),
    t("2026-09-01", "Spending", "Spending", "Gas"),
    t("2026-09-02", "Spending", "Bills", "Globe at Home Wifi"),
    t("2026-09-03", "Spending", "Subscriptions", "Spotify"),
    t("2026-09-04", "Revenue", "Revenue", "Allowance"),
    t("2026-09-05", "Revenue", "Revenue", "Maya Credit"),
    t("2026-09-06", "Transfer", "Spending", "Transaction Fee"),
    t("2026-09-07", "Spending", "Spending", "Money Send"),
  ];
  const empty = { bills: [], subscriptions: [], revenueCategories: [], spendingTypes: [] };

  it("names each list's items from the last year, newest first", () => {
    const r = recoverLists(ledger, empty, ["Maya Credit"]);
    expect(r.spendingTypes.map((s) => s.name)).toEqual(["Gas", "Food"]);
    expect(r.bills).toEqual(["Globe at Home Wifi"]);
    expect(r.subscriptions).toEqual(["Spotify"]);
    expect(r.revenueCategories).toEqual(["Allowance"]);
    expect(r.recovered).toBe(5);
  });

  it("leaves a list that is already there alone", () => {
    const r = recoverLists(ledger, { ...empty, bills: ["Electricity"] });
    expect(r.bills).toEqual(["Electricity"]);
    // Spending 2, subscriptions 1, income 2: Maya Credit is income here because no line of that name was given.
    expect(r.recovered).toBe(5);
  });
});
