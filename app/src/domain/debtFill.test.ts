/**
 * Debt sentences naming a line that is archived, or a person by title alone
 * (20 October 2026). Every name and figure here is invented.
 */
import { describe, expect, it } from "vitest";

import type { Debt } from "./debt";
import { fillDebt } from "./debtFill";
import { emptyDraft } from "./entry";

const debt = (over: Partial<Debt>): Debt =>
  ({ id: "d", name: "", kind: "payable", form: "informal", counterparty: "", counterpartyType: "person", openedDate: "2026-01-01", wallet: "", interestType: "none", interestRate: 0, notes: "", archived: false, ...over }) as Debt;
const debts = [
  debt({ id: "bank", name: "Town Bank loan", kind: "payable", form: "credit-line", counterparty: "Town Bank", counterpartyType: "institution", archived: true }),
  debt({ id: "tita", name: "Loan to Tita", kind: "receivable", counterparty: "Tita", archived: true }),
  debt({ id: "card", name: "Shop Credit", kind: "payable", form: "credit-line", counterparty: "Shop", counterpartyType: "institution" }),
];
const accounts = ["Cash", "Wallet"];

describe("a debt sentence naming an archived line", () => {
  it("takes the archived loan named outright, to be reopened on save", () => {
    const draft = { ...emptyDraft("2026-10-20"), flow: "Debt" as const, debtEffect: "repay" as const, amount: 100_000, fromWallet: "Wallet" };
    expect(fillDebt(draft, "I paid 1000 to Town Bank loan from wallet", debts, [], accounts, "2026-10-20").draft.debtId).toBe("bank");
  });

  it("reads a person named by title alone, and finds their archived line", () => {
    const draft = { ...emptyDraft("2026-10-20"), flow: "Debt" as const, debtEffect: "lend" as const, amount: 30_000, fromWallet: "Cash" };
    const fill = fillDebt(draft, "I lent 300 to Tita using cash", debts, [], accounts, "2026-10-20");
    expect(fill.newPerson).toBeUndefined();
    expect(fill.draft.debtId).toBe("tita");
  });
});
