/**
 * The owner's "//" notes, replayed on the device alone on 16 November 2026:
 * what still came back wrong. The words are the owner's; the ledger and the
 * figures beside them are invented.
 */
import { describe, expect, it } from "vitest";

import { asksRatherThanTells } from "./budgetAsk";
import { readCreditWhatIf } from "./creditWhatIf";
import type { Debt } from "./debt";
import { readGoalAsk } from "./goalAsk";
import { readIncomePlan } from "./incomeBudget";
import { parseAmount } from "./money";
import { readSpendAsk } from "./spendAsk";

describe("questions read as what they ask", () => {
  it("how much did I spend today and on what? lists the day, not entries that say what", () => {
    const ask = readSpendAsk("how much did I spend today and on what?", ["Food", "Gas"], "2026-11-16");
    expect(ask?.from).toBe("2026-11-16");
    expect(ask?.to).toBe("2026-11-16");
    expect(ask?.list).toBe(true);
    expect(ask && "word" in ask ? ask.word : undefined).toBeUndefined();
  });

  it("which 2 items should I cut first is not a target of 2 pesos to save", () => {
    expect(readGoalAsk("which 2 items should I cut first and how much would I save?", "2026-11-16")).toBeNull();
    expect(readGoalAsk("how long to save 5000", "2026-11-16")?.target).toBe(500_000);
  });

  it("asking is not telling", () => {
    expect(asksRatherThanTells("so can we make my emergency fund higher? like in case of emergency or to start a emergency fund?")).toBe(true);
    expect(asksRatherThanTells("Based on current balance and income let me know if we can higher up the budget this month")).toBe(true);
    expect(asksRatherThanTells("can you change the gas yesterday to 200")).toBe(false);
    expect(asksRatherThanTells("set my budget to 9000")).toBe(false);
  });

  it("a budget question without a question mark is not a budget card", () => {
    expect(readIncomePlan("Based on current balance and income let me know if we can higher up the budget this month")).toBeNull();
    expect(readIncomePlan("base my budget on my 10k income, save 20%")).not.toBeNull();
  });
});

describe("figures", () => {
  it("a list is not one amount", () => {
    expect(parseAmount("999, 199, 239")).toBeNull();
    expect(parseAmount("999 199 239")).toBeNull();
    expect(parseAmount("1,234.56")).toBe(123_456);
    expect(parseAmount("₱ 1,234.56")).toBe(123_456);
  });

  it("a borrowing supposed in a long message takes its figure and day from its own sentence", () => {
    const line = { id: "card", name: "Card Credit", counterparty: "Bank", kind: "payable", form: "credit-line", archived: false, openedDate: "2026-01-01", interestRate: 0, billingDay: 6, dueAfterDays: 15, notes: "" } as unknown as Debt;
    const said = "Now the gym: what did they cost on average compared to the ₱70 I planned, and how much do I need to add so it lasts until November 30? Separately, if I put ₱2,000 of the motorcycle repair on Card Credit on November 25, when do I pay it back?";
    const ask = readCreditWhatIf(said, [line], "2026-11-16");
    expect(ask?.amount).toBe(200_000);
    expect(ask?.on).toBe("2026-11-25");
  });
});
