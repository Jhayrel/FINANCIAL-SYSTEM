/**
 * Someone named again after they were archived. 3 October 2026: a settled,
 * archived "Loan to Tita" sat in Settings, and lending to her again made a
 * second Tita with an empty history. Names are invented.
 */
import { describe, expect, it } from "vitest";

import { withDebt, type Debt } from "./debt";
import { archivedNamed, personDebt } from "./debtFill";
import { emptyDraft, type Draft } from "./entry";

const person = (over: Partial<Debt>): Debt => ({
  id: "tita", name: "Tita", kind: "receivable", form: "informal", counterparty: "Tita", counterpartyType: "person",
  openedDate: "2025-01-01", wallet: "Cash", interestType: "none", interestRate: 0, notes: "", archived: true, ...over,
});
const lend: Draft = { ...emptyDraft("2026-10-03"), flow: "Debt", debtEffect: "lend", fromWallet: "Cash", amount: 50000 };

describe("an archived person named again", () => {
  it("is the same person, reopened", () => {
    const back = personDebt("tita", lend, [person({})], "Cash");
    expect(back).toMatchObject({ id: "tita", archived: false, openedDate: "2025-01-01" });
  });

  it("is never someone on the other side, or of another form", () => {
    expect(archivedNamed("Tita", "payable", false, [person({})])).toBeUndefined();
    expect(archivedNamed("Tita", "receivable", true, [person({})])).toBeUndefined();
    expect(personDebt("Tita", { ...lend, debtEffect: "draw" }, [person({})], "Cash").id).toBe("tita-2");
  });

  it("is saved in its own place, not listed twice", () => {
    const list = [person({}), person({ id: "maya", name: "Maya Credit", kind: "payable", archived: false })];
    const saved = withDebt(list, { ...person({}), archived: false });
    expect(saved).toHaveLength(2);
    expect(saved.find((d) => d.id === "tita")?.archived).toBe(false);
    expect(withDebt(list, person({ id: "juan", name: "Juan", archived: false }))).toHaveLength(3);
  });
});
