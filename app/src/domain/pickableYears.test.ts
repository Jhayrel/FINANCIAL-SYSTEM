import { describe, expect, it } from "vitest";

import { loadFixture } from "../fixtures/load";
import type { Transaction } from "./types";
import { pickableYears } from "./year";

const row = (date: string): Transaction => ({
  id: date,
  recordNumber: 1,
  date,
  type: "Spending",
  fromWallet: "Cash",
  toWallet: "",
  category: "Spending",
  item: "Food",
  description: "",
  amount: 100,
  fee: 0,
  total: 100,
  notes: "",
  status: "Paid",
});

describe("the years a screen can show", () => {
  it("offers every year with a row or a budget, this year and next, oldest first", () => {
    expect(pickableYears([row("2024-03-01"), row("2026-01-02")], ["2025"], "2026-09-15")).toEqual([
      2024, 2025, 2026, 2027,
    ]);
  });

  it("offers this year and next on an empty ledger, so a first budget can be set", () => {
    expect(pickableYears([], [], "2026-09-15")).toEqual([2026, 2027]);
  });

  it("brings imported history in with nothing to switch on", () => {
    const merged = [...loadFixture().transactions, row("2025-12-31"), row("2025-01-01")];
    expect(pickableYears(merged, [], "2026-09-15")).toEqual([2025, 2026, 2027]);
  });

  it("ignores a budget key that is not a year, and counts each year once", () => {
    expect(pickableYears([row("2026-02-02"), row("2026-03-03")], ["2026", "draft"], "2026-09-15")).toEqual([
      2026, 2027,
    ]);
  });

  it("leaves out the empty years between two it knows", () => {
    expect(pickableYears([row("2019-05-05")], [], "2026-09-15")).toEqual([2019, 2026, 2027]);
  });
});
