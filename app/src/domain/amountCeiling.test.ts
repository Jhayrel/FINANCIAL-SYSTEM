/**
 * Extra zeros (stress test, 9 November 2026): "99999999999" typed as an
 * amount was taken as ₱99,999,999,999.00. Invented data.
 */
import { describe, expect, it } from "vitest";

describe("extra zeros are refused (stress test, 9 November 2026)", () => {
  it("an amount or a fee past ₱1,000,000,000.00 is never saved, from any path", async () => {
    const { checkDraft, emptyDraft } = await import("./entry");
    const { MAX_MONEY } = await import("./money");
    const base = { ...emptyDraft("2026-11-09"), flow: "Spending" as const, category: "Spending" as const, item: "Food", fromWallet: "Cash" };
    const said = (amount: number, fee = 0): string[] => checkDraft({ ...base, amount, fee }, [], { wallets: ["Cash"], savings: [], bills: [], subscriptions: [], revenueCategories: [], spendingTypes: [{ name: "Food", remark: "" }] } as never, [], "2026-11-09").errors.map((e: { message: string }) => e.message);
    expect(said(9_999_999_999_900).join(" ")).toContain("too large to be right");
    expect(said(MAX_MONEY).join(" ")).not.toContain("too large");
    expect(said(10_000, MAX_MONEY + 1).join(" ")).toContain("A fee of");
  });
});
