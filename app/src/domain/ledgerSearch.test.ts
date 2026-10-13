import { describe, expect, it } from "vitest";

import { readLedgerSearch, searchLedger } from "./ledgerSearch";
import type { Transaction } from "./types";

const row = (n: number, date: string, type: string, item: string, total: number, description = ""): Transaction =>
  ({ id: `x${n}`, recordNumber: n, date, type, category: type === "Revenue" ? "Revenue" : "Spending", item, amount: total, fee: 0, total, fromWallet: type === "Revenue" ? "" : "Cash", toWallet: type === "Revenue" ? "Cash" : "", description, notes: "", status: "" }) as unknown as Transaction;

describe("searching the ledger from the chat (13 October 2026)", () => {
  it("reads a search, and leaves the other finds alone", () => {
    expect(readLedgerSearch("Can you search studio work")).toBe("studio work");
    expect(readLedgerSearch("search for my gym entries")).toBe("gym entries");
    expect(readLedgerSearch("find the difference")).toBeNull();
    expect(readLedgerSearch("find where the 500 went")).toBeNull();
    expect(readLedgerSearch("find the food I deleted")).toBeNull();
    expect(readLedgerSearch("search studio work online")).toBeNull();
  });
  it("finds every entry with the words, with what came in and went out", () => {
    const rows = [row(1, "2026-01-05", "Revenue", "Studio Work", 500000), row(2, "2026-03-01", "Spending", "Online Buy", 120000, "Studio work camera strap"), row(3, "2026-04-01", "Spending", "Food", 9000)];
    const said = searchLedger("studio work", rows);
    expect(said).toContain('2 entries mention "studio work", from January 5, 2026 to March 1, 2026.');
    expect(said).toContain("Came in: **PHP 5,000.00**.");
    expect(said).toContain("Went out as spending: **PHP 1,200.00**.");
    expect(searchLedger("nothing like this", rows)).toContain("No entry mentions");
  });
});
