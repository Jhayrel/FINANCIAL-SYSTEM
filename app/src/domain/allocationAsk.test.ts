/**
 * The chat's own allocation answers (docs/17 A8), on invented rows.
 */
import { describe, expect, it } from "vitest";

import { allocationWords, asksAllocations, linesNamed, monthAsked, SAFE_RULE } from "./allocationAsk";
import { makeAllocation, monthAllocations } from "./monthAllocation";
import type { Transaction } from "./types";

const asOf = "2026-11-09";
let n = 0;
const spend = (date: string, item: string, amount: number, over: Partial<Transaction> = {}): Transaction =>
  ({ id: `t${(n += 1)}`, recordNumber: n, date, type: "Spending", fromWallet: "Cash", toWallet: "", category: "Spending", item, description: "", amount, fee: 0, total: amount, notes: "", status: "Paid", ...over }) as Transaction;

const gas = makeAllocation({ kind: "Gas", amount: null, each: 30_000, times: 4, per: "week", wallet: "Cash" }, "2026-11", "2026-11-01", "a-gas");
const gym = makeAllocation({ name: "Gym", kind: "Self Care", words: "gym", amount: null, each: 5_000, times: 8, per: "time" }, "2026-11", "2026-11-01", "a-gym");
const rows = [spend("2026-11-03", "Gas", 30_000), spend("2026-11-08", "Gas", 20_000), spend("2026-11-04", "Self Care", 5_000, { description: "gym" })];
const month = monthAllocations([gas, gym], rows, "2026-11", asOf);
const none = monthAllocations([], rows, "2026-11", asOf);

describe("what the chat takes as an allocation question", () => {
  it.each(["my allocations", "allocation status", "how much is allocated for gas", "is my gas envelope ok", "naka-allocate ba yung gas"])("%s", (q) => {
    expect(asksAllocations(q, month)).toBe(true);
  });

  it("how much is left for gas, only when gas has an allocation", () => {
    expect(asksAllocations("how much is left for gas", month)).toBe(true);
    expect(asksAllocations("how much is left for gas", none)).toBe(false);
    // A kind with no allocation is the limit's question.
    expect(asksAllocations("how much is left for food", month)).toBe(false);
  });

  it("leaves other questions alone", () => {
    for (const q of ["how much can I spend today", "gas 300 cash", "what bills are due", "how much did I pay for gas last time"]) {
      expect(asksAllocations(q, month)).toBe(false);
    }
  });
});

describe("the answer", () => {
  it("one line when it names one, with the week and the safe-to-spend rule", () => {
    const w = allocationWords("how much is left for gas", month, { safe: 123_456, perDay: 5_000 });
    expect(w).toContain("Gas: ₱500.00 spent of ₱1,200.00, ₱700.00 left");
    expect(w).toContain("week 2: ₱200.00 of ₱300.00");
    expect(w).not.toContain("Gym");
    expect(w).toContain(SAFE_RULE);
    expect(w).toContain("Safe to spend now, after the allocations: ₱1,234.56; today, ₱50.00.");
  });

  it("by its words: the gym inside Self Care", () => {
    expect(linesNamed("gym left?", [gas, gym]).map((l) => l.id)).toEqual(["a-gym"]);
    expect(allocationWords("how much is left for the gym", month, null)).toContain("Gym: ₱50.00 spent of ₱400.00, ₱350.00 left (1 of 8 times)");
  });

  it("every line when none is named", () => {
    const w = allocationWords("my allocations", month, null);
    expect(w).toContain("Allocations for November 2026:");
    expect(w).toContain("- Gas:");
    expect(w).toContain("- Gym:");
  });

  it("none, naming the action", () => {
    const w = allocationWords("my allocations", none, null);
    expect(w).toContain("You have no allocations for November 2026. Add one on Budget, under Allocations");
  });

  it("a past month with none is not offered an Add", () => {
    const oct = monthAllocations([], rows, "2026-10", asOf);
    expect(allocationWords("allocations last month", oct, null)).toBe("You had no allocations for October 2026.");
  });

  it("never an em dash", () => {
    expect(allocationWords("my allocations", month, { safe: 1, perDay: 1 }).includes(String.fromCharCode(0x2014))).toBe(false);
  });
});

describe("the month asked about", () => {
  it.each([
    ["my allocations", "2026-11"],
    ["allocations last month", "2026-10"],
    ["next month allocation", "2026-12"],
    ["allocations for march", "2026-03"],
  ])("%s", (q, ym) => {
    expect(monthAsked(q, asOf)).toBe(ym);
  });

  it("a past month says what was not used, and holds nothing", () => {
    const oct = monthAllocations([{ ...gas, month: "2026-10", id: "a-oct" }], [spend("2026-10-05", "Gas", 30_000)], "2026-10", asOf);
    const w = allocationWords("allocations last month", oct, null);
    expect(w).toContain("₱900.00 not used");
    expect(w).not.toContain(SAFE_RULE);
  });
});

describe("a kind with no allocation (heavy test, 9 November 2026)", () => {
  it("is found by name, and only when it has no allocation", async () => {
    const { kindAsked } = await import("./allocationAsk");
    const kinds = ["Gas", "Food", "Self Care"];
    expect(kindAsked("how much is left for food", kinds, month)).toBe("Food");
    expect(kindAsked("magkano natira sa food", kinds, month)).toBe("Food");
    // Gas has one: that is the allocation's answer.
    expect(kindAsked("how much is left for gas", kinds, month)).toBeNull();
    expect(kindAsked("what did I buy", kinds, month)).toBeNull();
  });

  it("says what was spent, the limit, and how to set money aside", async () => {
    const { kindLeftWords } = await import("./allocationAsk");
    const w = kindLeftWords("Food", month, 223_600, 300_000, { safe: 179_203, perDay: 8_145 });
    expect(w).toBe(
      "Food has no allocation for November 2026, so nothing is set aside for it: ₱2,236.00 spent on it so far. It has a ₱3,000.00 limit: ₱764.00 left of it. What you can still spend on it comes out of safe to spend: ₱1,792.03 until November ends, ₱81.45 today. To set money aside for Food, add an allocation on Budget, under Allocations.",
    );
    expect(kindLeftWords("Food", month, 400_000, 300_000, null)).toContain("It is ₱1,000.00 over its ₱3,000.00 limit.");
    expect(kindLeftWords("Food", month, 1_000, null, null).includes(String.fromCharCode(0x2014))).toBe(false);
  });
});
