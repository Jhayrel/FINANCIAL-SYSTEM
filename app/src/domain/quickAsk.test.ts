/** Everyday questions answered from the screens' figures (27 October 2026 sweeps). */
import { describe, expect, it } from "vitest";

import { readQuickAsk } from "./quickAsk";

const wallets = ["Cash", "Gcash", "Maya", "Maya Bank (Personal savings)"];

describe("readQuickAsk", () => {
  it("reads the questions that fell to the month's summary", () => {
    expect(readQuickAsk("how much is in my gcash", [], wallets)).toEqual({ kind: "balance", wallet: "Gcash" });
    expect(readQuickAsk("magkano pera ko", [], wallets)).toEqual({ kind: "balance", wallet: null });
    expect(readQuickAsk("what's my net worth", [], wallets)).toEqual({ kind: "worth" });
    expect(readQuickAsk("show my budget", [], wallets)).toEqual({ kind: "budget" });
    expect(readQuickAsk("why is my budget over", [], wallets)).toEqual({ kind: "budget" });
    expect(readQuickAsk("how much did i receive this month", [], wallets)).toEqual({ kind: "received", month: "this" });
    expect(readQuickAsk("list my subscriptions", [], wallets)).toEqual({ kind: "recurring", which: "subscriptions" });
    expect(readQuickAsk("what's my biggest expense this week", [], wallets)).toEqual({ kind: "biggest", month: "this", span: "week" });
  });

  it("leaves a debt, an entry and a spending question alone", () => {
    expect(readQuickAsk("what's my balance on maya credit", [], wallets)).toBeNull();
    expect(readQuickAsk("gcash 500 load", [], wallets)).toBeNull();
    expect(readQuickAsk("how much did i spend from gcash", [], wallets)).toBeNull();
    expect(readQuickAsk("what bills are due", [], wallets)).toBeNull();
  });
});
