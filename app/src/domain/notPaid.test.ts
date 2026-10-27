/** A bill read off a paper or a PDF, offered as a plan to pay it (`notPaid.ts`, `planToPay`). */
import { describe, expect, it } from "vitest";
import { planToPay } from "./notPaid";

describe("a plan to pay a bill read off a paper (27 October 2026)", () => {
  const bill = { kind: "bill" as const, from: "RIVERSIDE POWER COOPERATIVE, INC.", amount: 129_900, due: "November 15, 2026", parts: [], figures: [] };
  it("names it and dates it by its due day", () => {
    expect(planToPay(bill, "2026-11-15", "2026-10-27")).toEqual({ title: "Riverside Power Cooperative bill", amount: 129_900, due: "2026-11-15" });
    expect(planToPay({ ...bill, kind: "assessment", from: "" }, "2026-11-15", "2026-10-27")?.title).toBe("School fees");
  });
  it("offers none for an order not placed, a day gone, or no amount", () => {
    expect(planToPay({ ...bill, kind: "checkout" }, "2026-11-15", "2026-10-27")).toBeNull();
    expect(planToPay(bill, "2026-10-01", "2026-10-27")).toBeNull();
    expect(planToPay({ ...bill, amount: null }, "2026-11-15", "2026-10-27")).toBeNull();
    expect(planToPay(bill, null, "2026-10-27")).toBeNull();
  });
});
