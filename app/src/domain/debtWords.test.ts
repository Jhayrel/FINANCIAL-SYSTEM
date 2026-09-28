import { describe, expect, it } from "vitest";

/**
 * Settings, Credit and loans: Maya Credit with Bill closes and Payment due
 * both on the 6th (28 September 2026, "are you sure about this 2x").
 */
describe("the same day for the bill and the payment", async () => {
  const { sameDayNote } = await import("./debtWords");
  it("says what it means when both are the 6th", () => {
    const note = sameDayNote("Maya Credit", 6, 6);
    expect(note).toContain("both are the 6th");
    expect(note).toContain("due on the 6th of the month after");
  });
  it("says nothing when they differ or one is unset", () => {
    expect(sameDayNote("Maya Credit", 6, 21)).toBe("");
    expect(sameDayNote("Maya Credit", 6, undefined)).toBe("");
  });
});

describe("what the app does with the same day twice", async () => {
  const { debtDue, positionOf } = await import("./debt");
  it("is due on the 6th a month after the bill closes, as the note says", () => {
    const debt = { id: "mc", name: "Maya Credit", kind: "payable", counterparty: "Maya", openedDate: "2026-01-01", wallet: "Maya", interestType: "none", interestRate: 0, notes: "", archived: false, form: "credit-line", billingDay: 6 } as const;
    const rows = [{ id: "d1", recordNumber: 1, date: "2026-09-10", type: "Debt", fromWallet: "", toWallet: "Maya", category: "", item: "Maya Credit", description: "", amount: 200000, fee: 0, total: 200000, notes: "", status: "Received", debtId: "mc", debtEffect: "draw" }] as never;
    const due = (d: object) => debtDue(positionOf(d as never, rows, "2026-09-28"), rows, "2026-09-28");
    const both = due({ ...debt, dueDay: 6 });
    const one = due(debt);
    // Borrowed on 10 September: on the bill that closes 6 October, due 6 November.
    expect(both.nextDue).toBe("2026-11-06");
    // With only the closing day, it is due when that bill closes.
    expect(one.nextDue).toBe("2026-10-06");
  });
});
