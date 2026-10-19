import { describe, expect, it } from "vitest";

import { interestFromPicture } from "./interestFromPicture";
import type { Proposal } from "./proposal";

const card = (amount: number, item: string, description: string, toWallet = "Savings"): Proposal =>
  ({ draft: { flow: "Revenue", date: "2026-01-14", fromWallet: "", toWallet, category: "Revenue", item, description, amount, fee: 0, notes: "", status: "Done" }, confidence: "high", sourceRef: "shot.jpg", adjustments: [] }) as unknown as Proposal;

describe("interest from a balance screenshot", () => {
  const balances = [{ account: "Savings", amount: 353985, date: "2026-01-14", sourceRef: "shot.jpg" }];
  const ledger = (a: string) => (a === "Savings" ? 353908 : 0);

  it("is the balance less the ledger, and the month's total read off the screen is dropped", () => {
    const r = interestFromPicture("This is my new balance, how much interest did I earn?", [card(527, "Bank interest", "Interest earned this month"), card(1000, "Allowance", "", "Cash")], balances, ["Savings", "Cash"], ledger)!;
    expect(r.gap).toBe(77);
    expect(r.others.map((p) => p.draft.item)).toEqual(["Allowance"]);
  });

  it("needs the question and a balance near the ledger's", () => {
    expect(interestFromPicture("this is my new balance", [], balances, ["Savings"], ledger)).toBeNull();
    expect(interestFromPicture("how much interest", [], [{ ...balances[0]!, amount: 527 }], ["Savings"], ledger)).toBeNull();
  });
});
