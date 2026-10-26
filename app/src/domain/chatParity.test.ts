/**
 * Every screen's own moves, from the chat (26 October 2026: "look at all the
 * features of my system and make sure ai can do it all like everything").
 * Rows and lines are invented.
 */
import { describe, expect, it } from "vitest";

import { activityAnswer, asksUndoLast, readActivityAsk } from "./activityAsk";
import type { ActivityEvent } from "./activity";
import { creditRoomAnswer, debtDetailChange, readDebtDetailAsk } from "./debtDetailAsk";
import type { Debt } from "./debt";
import { asksToSignOut, asksToStopBill, readGoAsk, settingsPlaceFor } from "./goAsk";
import { KEPT_NOTE } from "./integrity";
import { readEntry } from "./readEntry";
import { readReviewRowAsk, reviewRowAnswer } from "./reviewAsk";
import type { ReferenceLists, Transaction } from "./types";

const asOf = "2026-10-25";

describe("opening a screen", () => {
  it("opens the screen a short request names", () => {
    expect(readGoAsk("open the budget", asOf)?.screen).toBe("budget");
    expect(readGoAsk("take me to the debt screen", asOf)?.screen).toBe("debt");
    expect(readGoAsk("go to insights", asOf)?.screen).toBe("insights");
    expect(readGoAsk("go home", asOf)?.screen).toBe("dashboard");
    expect(readGoAsk("please open the bin", asOf)?.screen).toBe("bin");
    expect(readGoAsk("open activity", asOf)?.screen).toBe("activity");
  });

  it("opens Needs review as the Database's list of flagged rows", () => {
    expect(readGoAsk("go to needs review", asOf)).toEqual({ screen: "database", review: true, label: "Needs review" });
  });

  it("opens Settings on the tab named, either way round", () => {
    expect(readGoAsk("open settings categories", asOf)).toEqual({ screen: "settings", tab: "categories", label: "Settings, Categories" });
    expect(readGoAsk("open the alerts settings", asOf)?.tab).toBe("alerts");
    expect(readGoAsk("open categories", asOf)?.tab).toBe("categories");
    expect(readGoAsk("open settings", asOf)).toEqual({ screen: "settings", label: "Settings" });
  });

  it("opens Insights on a month named", () => {
    expect(readGoAsk("open insights for september", asOf)).toMatchObject({ screen: "insights", month: "2026-09" });
    // A month still ahead this year is last year's.
    expect(readGoAsk("open insights for december", asOf)).toMatchObject({ month: "2025-12" });
  });

  it("is never read inside an entry, a question or a request for the rows", () => {
    expect(readGoAsk("I opened a new account", asOf)).toBeNull();
    expect(readGoAsk("open a savings account", asOf)).toBeNull();
    expect(readGoAsk("show me the bin", asOf)).toBeNull();
    expect(readGoAsk("open maya", asOf)).toBeNull();
    expect(readGoAsk("open the budget and set it to 20000", asOf)).toBeNull();
    expect(readGoAsk("what is in my budget?", asOf)).toBeNull();
    expect(readGoAsk("show me the dashboard screen", asOf)?.screen).toBe("dashboard");
  });

  it("names the Settings tab a change to a setting belongs on", () => {
    expect(settingsPlaceFor("add a bill called netflix 549").tab).toBe("categories");
    expect(settingsPlaceFor("switch to dark mode").tab).toBe("appearance");
    expect(settingsPlaceFor("add a savings account called emergency fund").tab).toBe("accounts");
    expect(settingsPlaceFor("stop my electric bill").tab).toBe("categories");
  });

  it("reads stopping a bill and signing out, so neither becomes an entry", () => {
    expect(asksToStopBill("stop my electric bill", ["Electric Bill", "Spotify"])).toBe("Electric Bill");
    expect(asksToStopBill("I no longer pay spotify", ["Electric Bill", "Spotify"])).toBe("Spotify");
    expect(asksToStopBill("paid spotify 149", ["Spotify"])).toBeNull();
    expect(asksToSignOut("sign out")).toBe(true);
    expect(asksToSignOut("log me out please")).toBe(true);
    expect(asksToSignOut("I signed out yesterday and lost my entry")).toBe(false);
  });
});

const line: Debt = {
  id: "maya-credit",
  name: "Maya Credit",
  kind: "payable",
  counterparty: "Maya",
  openedDate: "2026-07-29",
  dueDay: 6,
  billingDay: 6,
  wallet: "Maya",
  interestType: "none",
  interestRate: 0,
  notes: "",
  archived: false,
};
const friend: Debt = { ...line, id: "carlo", name: "Carlo", counterparty: "Carlo", form: "informal", counterpartyType: "person", kind: "receivable", dueDay: undefined, billingDay: undefined };

describe("a credit line's details", () => {
  it("reads the limit, the due day and the billing day, each with its value", () => {
    expect(readDebtDetailAsk("set my maya credit limit to 15000", [line])).toEqual({ debtId: "maya-credit", detail: "limit", value: 1_500_000 });
    expect(readDebtDetailAsk("my maya credit limit is now 15k", [line])).toEqual({ debtId: "maya-credit", detail: "limit", value: 1_500_000 });
    expect(readDebtDetailAsk("my maya credit due date is the 5th", [line])).toEqual({ debtId: "maya-credit", detail: "dueDay", value: 5 });
    expect(readDebtDetailAsk("change my maya credit billing day to 8", [line])).toEqual({ debtId: "maya-credit", detail: "billingDay", value: 8 });
    expect(readDebtDetailAsk("interest rate on maya credit is 3.99%", [line])).toEqual({ debtId: "maya-credit", detail: "rate", value: 399 });
  });

  it("leaves money that moved, and questions, to their own readers", () => {
    expect(readDebtDetailAsk("I paid my maya credit 500 from maya", [line])).toBeNull();
    expect(readDebtDetailAsk("when is my maya credit due?", [line])).toBeNull();
    expect(readDebtDetailAsk("set my october budget to 20000", [line])).toBeNull();
  });

  it("changes the line as the Details form saves it, and says what it was", () => {
    const limit = debtDetailChange({ debtId: "maya-credit", detail: "limit", value: 1_500_000 }, [line], asOf);
    expect("refused" in limit).toBe(false);
    if ("refused" in limit) return;
    // A first limit counts from the day the line opened.
    expect(limit.next.limits).toEqual([{ from: "2026-07-29", amount: 1_500_000 }]);
    expect(limit.next.creditLimit).toBe(1_500_000);
    expect(limit.next.limitCounts).toBe("owed");
    expect(limit.now).toBe("not set");

    // A change to a limit already set counts from today, and the old one stays on its days.
    const raised = debtDetailChange({ debtId: "maya-credit", detail: "limit", value: 2_000_000 }, [limit.next], asOf);
    if ("refused" in raised) throw new Error(raised.refused);
    expect(raised.next.limits).toEqual([
      { from: "2026-07-29", amount: 1_500_000 },
      { from: asOf, amount: 2_000_000 },
    ]);

    const due = debtDetailChange({ debtId: "maya-credit", detail: "dueDay", value: 5 }, [line], asOf);
    if ("refused" in due) throw new Error(due.refused);
    expect(due.next.dueDay).toBe(5);
    expect(due.now).toBe("the 6th of each month");
    expect(due.then).toBe("the 5th of each month");
  });

  it("refuses what the line does not have, the same value again, and the rate, which is Settings'", () => {
    expect(debtDetailChange({ debtId: "maya-credit", detail: "billingDay", value: 6 }, [line], asOf)).toEqual({ refused: "Maya Credit's bill already closes on the 6th." });
    expect("refused" in debtDetailChange({ debtId: "carlo", detail: "limit", value: 100_000 }, [friend], asOf)).toBe(true);
    expect("refused" in debtDetailChange({ debtId: "carlo", detail: "billingDay", value: 3 }, [friend], asOf)).toBe(true);
    const rate = debtDetailChange({ debtId: "maya-credit", detail: "rate", value: 399 }, [line], asOf);
    expect("refused" in rate && rate.refused).toMatch(/Settings, under Credit and loans/);
  });

  it("answers how much of the limit is left, and was not taken for a category's limit", () => {
    const limited: Debt = { ...line, creditLimit: 1_000_000, limits: [{ from: "2026-07-29", amount: 1_000_000 }] };
    const draw: Transaction = {
      id: "d1", recordNumber: 1, date: "2026-10-02", type: "Debt", fromWallet: "", toWallet: "Maya", category: "", item: "Maya Credit", description: "", amount: 400_000, fee: 0, total: 400_000, notes: "", status: "Paid", debtId: "maya-credit", debtEffect: "draw",
    };
    expect(creditRoomAnswer("how much is left on my maya credit limit?", [limited], [draw], asOf)).toMatch(/^\*\*Maya Credit: ₱6,000\.00 of ₱10,000\.00 left to borrow\.\*\*/);
    expect(creditRoomAnswer("how much is left on my maya credit limit?", [line], [], asOf)).toMatch(/has no limit set/);
    expect(creditRoomAnswer("how much is left in my food budget?", [limited], [draw], asOf)).toBeNull();
  });
});

const reference: ReferenceLists = {
  wallets: ["Cash", "Maya"],
  savings: [],
  bills: [],
  subscriptions: [],
  revenueCategories: ["Allowance"],
  spendingTypes: [{ name: "Food", remark: "" }],
};
const tx = (over: Partial<Transaction>): Transaction => {
  const amount = over.amount ?? 10_000;
  return { id: "x", recordNumber: 1, date: "2026-10-01", type: "Spending", fromWallet: "Cash", toWallet: "", category: "Spending", item: "Food", description: "", fee: 0, notes: "", status: "Paid", ...over, amount, total: amount + (over.fee ?? 0) };
};

describe("one flagged entry, by its number", () => {
  // A spending with no wallet is flagged: no balance moves for it.
  const ledger = [
    tx({ id: "in", recordNumber: 40, date: "2026-09-30", type: "Revenue", fromWallet: "", toWallet: "Cash", category: "Revenue", item: "Allowance", amount: 100_000, status: "Received" }),
    tx({ id: "a", recordNumber: 41, fromWallet: "" }),
    tx({ id: "b", recordNumber: 42 }),
    tx({ id: "c", recordNumber: 43, fromWallet: "", notes: KEPT_NOTE }),
  ];
  const context = { wallets: reference.wallets, asOf };

  it("reads what is wrong and keep, and leaves edits to the edit finder", () => {
    expect(readReviewRowAsk("what's wrong with #3831?")).toEqual({ recordNumber: 3831, keep: false });
    expect(readReviewRowAsk("why is 3831 flagged")).toEqual({ recordNumber: 3831, keep: false });
    expect(readReviewRowAsk("keep #3831 as it is")).toEqual({ recordNumber: 3831, keep: true });
    expect(readReviewRowAsk("#3831 is correct")).toEqual({ recordNumber: 3831, keep: true });
    expect(readReviewRowAsk("#3831 should be 200")).toBeNull();
    expect(readReviewRowAsk("change #3831 to 200")).toBeNull();
    expect(readReviewRowAsk("food 150 cash")).toBeNull();
  });

  it("says what is wrong and both ways out, from the Database's own checks", () => {
    const why = reviewRowAnswer({ recordNumber: 41, keep: false }, ledger, context);
    expect(why.flagged).toBe(true);
    expect(why.words).toMatch(/^\*\*#0041 is in Needs review\.\*\*/);
    expect(why.words).toMatch(/\*\*To keep it as it is:\*\* Nothing moves/);
  });

  it("keeps it with the note and nothing else, so no balance moves", () => {
    const kept = reviewRowAnswer({ recordNumber: 41, keep: true }, ledger, context);
    expect(kept.keep?.rows).toHaveLength(1);
    const only = kept.keep?.rows[0];
    expect(only?.after.notes).toBe(KEPT_NOTE);
    expect({ ...only?.after, notes: "" }).toEqual({ ...only?.before, notes: "" });
  });

  it("says plainly when an entry is not flagged, or already kept, or not there", () => {
    expect(reviewRowAnswer({ recordNumber: 42, keep: false }, ledger, context)).toMatchObject({ flagged: false, words: expect.stringMatching(/is not flagged/) });
    expect(reviewRowAnswer({ recordNumber: 43, keep: false }, ledger, context).words).toMatch(/was checked and kept as it is/);
    expect(reviewRowAnswer({ recordNumber: 99, keep: false }, ledger, context).words).toMatch(/There is no #0099/);
  });
});

describe("the activity trail", () => {
  it("reads what changed, by whom and over what span", () => {
    // "Change" is any change: added, edited, binned or restored.
    expect(readActivityAsk("what did I change today?", asOf)).toMatchObject({ from: asOf, to: asOf, span: "today", by: "owner", action: null });
    expect(readActivityAsk("which entries did I edit this week?", asOf)).toMatchObject({ by: "owner", action: "edit" });
    expect(readActivityAsk("what did the ai add this week?", asOf)).toMatchObject({ from: "2026-10-19", to: asOf, by: "ai", action: "add" });
    expect(readActivityAsk("show my activity", asOf)).toMatchObject({ span: "in the last seven days", by: null, action: null });
  });

  it("leaves questions about money to the money readers", () => {
    expect(readActivityAsk("what did I spend yesterday", asOf)).toBeNull();
    expect(readActivityAsk("what was the biggest expense I made this month?", asOf)).toBeNull();
    expect(readActivityAsk("what did I buy last friday?", asOf)).toBeNull();
  });

  it("lists the trail over the span, newest first", () => {
    const at = (day: string, hour: number): string => new Date(`${day}T${String(hour).padStart(2, "0")}:00:00`).toISOString();
    const events: ActivityEvent[] = [
      { id: "1", at: at(asOf, 9), actor: "owner", via: "manual", action: "transaction.create", summary: "Added #0044, Food PHP 150.00." },
      { id: "2", at: at(asOf, 8), actor: "ai", via: "ai_chat", action: "transaction.update", summary: "Edited #0041: wallet to Cash." },
      { id: "3", at: at("2026-10-20", 8), actor: "owner", via: "manual", action: "transaction.bin", summary: "Moved #0040 to the bin." },
    ];
    const today = activityAnswer({ from: asOf, to: asOf, span: "today", by: null, action: null }, events, true);
    expect(today.split("\n")).toEqual(["**2 changes today**: 1 added, 1 edited.", "- 09:00: Added #0044, Food PHP 150.00.", "- 08:00: Edited #0041: wallet to Cash. (assistant)"]);
    expect(activityAnswer({ from: asOf, to: asOf, span: "today", by: "owner", action: "bin" }, events, true)).toBe("Nothing was moved to the bin by you today. Activity shows everything further back.");
    expect(activityAnswer({ from: asOf, to: asOf, span: "today", by: null, action: null }, [], false)).toMatch(/could not be read/);
  });

  it("reads undo only as the whole message", () => {
    expect(asksUndoLast("undo")).toBe(true);
    expect(asksUndoLast("undo that")).toBe(true);
    expect(asksUndoLast("please undo the last change")).toBe(true);
    expect(asksUndoLast("revert what you just did")).toBe(true);
    expect(asksUndoLast("undo the fixes, my balance is off")).toBe(false);
    expect(asksUndoLast("I want to undo my gym membership")).toBe(false);
  });
});

describe("a guess with nothing said is not an entry", () => {
  const rows = [tx({ id: "f1", description: "my spending" }), tx({ id: "f2", type: "Revenue", fromWallet: "", toWallet: "Cash", category: "Revenue", item: "Allowance", description: "income", status: "Received" })];
  it("offers no card for a question with no figure, no item said and nothing done", () => {
    expect(readEntry("income vs spending this year", rows, reference, asOf).worthOffering).toBe(false);
    expect(readEntry("look for a pattern in my spending", rows, reference, asOf).worthOffering).toBe(false);
  });
  it("still offers one when the item is said, or something happened", () => {
    expect(readEntry("food usual amount cash", rows, reference, asOf).worthOffering).toBe(true);
    expect(readEntry("food 150 cash", rows, reference, asOf).worthOffering).toBe(true);
  });
});
