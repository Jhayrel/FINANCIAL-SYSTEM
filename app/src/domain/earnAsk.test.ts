import { describe, expect, it } from "vitest";

import { earnAnswer, readEarnAsk } from "./earnAsk";
import type { Transaction } from "./types";

const SOURCES = ["Studio Work", "Allowance", "Random"];
let n = 0;
const rev = (date: string, item: string, total: number, category = "Revenue"): Transaction =>
  ({ id: `r${(n += 1)}`, recordNumber: n, date, type: "Revenue", category, item, amount: total, fee: 0, total, fromWallet: "", toWallet: "Cash", description: "", notes: "", status: "Received" }) as unknown as Transaction;
const rows = [rev("2022-05-01", "Opening", 50000, "Opening"), rev("2022-06-01", "Allowance", 100000), rev("2024-02-01", "Studio Work", 300000), rev("2026-10-01", "Random", 20000), rev("2026-10-02", "Cash on hand", 9900)];

describe("income over the whole ledger, worked out by the app", () => {
  it("reads the questions that came in on 13 October 2026", () => {
    expect(readEarnAsk("How much i earned since the beginning of this database?", SOURCES, "2026-10-13")).toEqual({ from: null, only: null, except: null });
    expect(readEarnAsk("How much I earned since 2022?", SOURCES, "2026-10-13")).toMatchObject({ from: "2022-01-01", only: null });
    // "No, not just that one: all of it", after an answer about one source (the owner asked for the total next).
    expect(readEarnAsk("No studio work like all incoming in the system", SOURCES, "2026-10-13")).toMatchObject({ only: null, except: null });
    expect(readEarnAsk("all income in the system except studio work", SOURCES, "2026-10-13")).toMatchObject({ only: null, except: "Studio Work" });
    expect(readEarnAsk("how much did studio work bring in all time? total income", SOURCES, "2026-10-13")).toMatchObject({ only: "Studio Work" });
  });
  it("leaves the month, the plans and the spending to the other readers", () => {
    expect(readEarnAsk("how much did I earn this month?", SOURCES, "2026-10-13")).toBeNull();
    expect(readEarnAsk("how much can I spend?", SOURCES, "2026-10-13")).toBeNull();
    expect(readEarnAsk("how much is my spending since 2022?", SOURCES, "2026-10-13")).toBeNull();
  });
  it("counts true income: openings and money moved between your own accounts left out", () => {
    const all = earnAnswer({ from: null, only: null, except: null }, rows, [], "2026-10-13");
    expect(all).toContain("You received **PHP 4,200.00** from May 1, 2022 to October 13, 2026, over 3 entries.");
    expect(all).toContain("Studio Work PHP 3,000.00 (71%)");
    expect(all).toContain("Left out as not earned: PHP 599.00");
    const without = earnAnswer({ from: null, only: null, except: "Studio Work" }, rows, [], "2026-10-13");
    expect(without).toContain("**PHP 1,200.00** leaving out Studio Work");
  });
});
