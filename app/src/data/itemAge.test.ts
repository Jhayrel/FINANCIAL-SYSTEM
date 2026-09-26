/**
 * "I paid 723.45 in online", 26 September 2026, came back as the 2022
 * subscription "Other online payments". The reader is now told which items
 * have not been used for a year.
 */
import { describe, expect, it } from "vitest";

import type { Transaction } from "../domain/types";
import { itemForReader, itemsLastUsed } from "./aiClient";

const row = (item: string, date: string): Transaction => ({
  id: `${item}-${date}`, recordNumber: 1, date, type: "Spending", fromWallet: "Maya", toWallet: "",
  category: "Spending", item, description: "", amount: 100, fee: 0, total: 100, notes: "", status: "Paid",
});

describe("marking an old item for the reader", () => {
  const ledger = [
    row("Other online payments", "2022-09-01"),
    row("Other online payments", "2022-11-01"),
    row("Online Buy", "2026-09-16"),
    row("Online Buy", "2025-01-02"),
    row("Netflix", "2025-10-01"),
  ];
  const last = itemsLastUsed(ledger);

  it("keeps the latest day each item was used", () => {
    expect(last.get("Other online payments")).toBe("2022-11-01");
    expect(last.get("Online Buy")).toBe("2026-09-16");
  });

  it("marks an item unused for over a year, and says since when", () => {
    expect(itemForReader("Other online payments", last, "2026-09-26")).toBe("Other online payments (old, last used 2022)");
  });

  it("leaves an item in use alone, and one used within the year", () => {
    expect(itemForReader("Online Buy", last, "2026-09-26")).toBe("Online Buy");
    expect(itemForReader("Netflix", last, "2026-09-26")).toBe("Netflix");
  });

  it("leaves an item never used alone, because it was only just added", () => {
    expect(itemForReader("Gym", last, "2026-09-26")).toBe("Gym");
    expect(itemForReader("Gym", undefined, "2026-09-26")).toBe("Gym");
  });
});
