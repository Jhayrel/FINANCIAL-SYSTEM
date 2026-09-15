import { describe, expect, it } from "vitest";

import { loadFixture } from "../fixtures/load";
import { assessMonthFor, budgetForYear } from "./budget";
import { saveLimit } from "./budgetLock";
import { getMonth, getYear } from "./dates";
import { emptyDraft, transactionToDraft, type Draft } from "./entry";
import { entryImpact } from "./entryImpact";
import { costOf } from "./totals";

const fx = loadFixture();
const AS_OF = fx.expected.asOf;
const YEAR = getYear(AS_OF);
const MONTH = getMonth(AS_OF);

const draft = (over: Partial<Draft>): Draft => ({ ...emptyDraft(AS_OF), ...over });

describe("what an entry does to its month's budget", () => {
  it("takes a spending entry off the spending track, as rule 3.6 counts it", () => {
    const impact = entryImpact(
      draft({ flow: "Spending", fromWallet: "Cash", category: "Spending", item: "Food", amount: 10000 }),
      fx.transactions,
      fx.budgets,
      AS_OF,
    );
    const track = assessMonthFor(fx.transactions, fx.budgets, YEAR, MONTH).spending;
    expect(impact).toMatchObject({
      year: YEAR,
      month: MONTH,
      cost: 10000,
      track: "spending",
      budget: track.budget,
      spentBefore: track.spent,
      leftAfter: track.budget - track.spent - 10000,
      kind: "Food",
      limit: null,
    });
  });

  it("counts a bill against bills and subscriptions", () => {
    const impact = entryImpact(
      draft({ flow: "Spending", fromWallet: "Maya", category: "Bills", item: "Globe at Home Wifi", amount: 99900 }),
      fx.transactions,
      fx.budgets,
      AS_OF,
    );
    expect(impact?.track).toBe("billsSubs");
    expect(impact?.kind).toBeNull();
  });

  it("costs nothing for income, or for moving money between your own accounts", () => {
    expect(entryImpact(draft({ flow: "Revenue", toWallet: "Maya", amount: 500000 }), fx.transactions, fx.budgets, AS_OF)).toBeNull();
    expect(
      entryImpact(draft({ flow: "Transfer", fromWallet: "Maya", toWallet: "Cash", amount: 100000 }), fx.transactions, fx.budgets, AS_OF),
    ).toBeNull();
  });

  it("costs a transfer its fee, filed as a transaction fee", () => {
    const impact = entryImpact(
      draft({ flow: "Transfer", fromWallet: "Maya", toWallet: "Cash", amount: 100000, fee: 1500 }),
      fx.transactions,
      fx.budgets,
      AS_OF,
    );
    expect(impact).toMatchObject({ cost: 1500, track: "spending", kind: "Transaction Fee" });
  });

  it("measures an edited row against the month without it", () => {
    const row = fx.transactions.find(
      (t) => t.type === "Spending" && t.category === "Spending" && getYear(t.date) === YEAR && getMonth(t.date) === MONTH,
    );
    if (!row) throw new Error("no spending row in the captured month");
    const impact = entryImpact(transactionToDraft(row), fx.transactions, fx.budgets, AS_OF);
    const track = assessMonthFor(fx.transactions, fx.budgets, YEAR, MONTH).spending;
    expect(impact?.spentBefore).toBe(track.spent - costOf(row));
    expect(impact?.leftAfter).toBe(track.budget - track.spent);
  });

  it("shows the limit for its kind of spending when one is set", () => {
    const withFood = saveLimit(budgetForYear(fx.budgets, YEAR), YEAR, MONTH, "Food", 300000, "month", AS_OF, "2026-08-29T01:00:00.000Z");
    const impact = entryImpact(
      draft({ flow: "Spending", fromWallet: "Cash", category: "Spending", item: "Food", amount: 10000 }),
      fx.transactions,
      { ...fx.budgets, [String(YEAR)]: withFood.plan },
      AS_OF,
    );
    expect(impact?.limit).toBe(300000);
  });

  it("says when the month's budget is closed, and still counts the entry", () => {
    const impact = entryImpact(
      draft({ date: `${YEAR}-01-15`, flow: "Spending", fromWallet: "Cash", category: "Spending", item: "Food", amount: 10000 }),
      fx.transactions,
      fx.budgets,
      AS_OF,
    );
    expect(impact?.lock.state).toBe("closed");
    expect(impact?.cost).toBe(10000);
  });

  it("says when the same bill was already paid that month, and not for the row being edited", () => {
    const isBill = (t: (typeof fx.transactions)[number]): boolean =>
      t.type === "Spending" &&
      (t.category === "Bills" || t.category === "Subscriptions") &&
      t.item.trim() !== "" &&
      getYear(t.date) === YEAR &&
      getMonth(t.date) === MONTH;
    const paid = fx.transactions.find(isBill);
    if (!paid) throw new Error("no bill paid in the captured month");
    const payments = fx.transactions.filter((t) => isBill(t) && t.category === paid.category && t.item === paid.item);
    const latest = payments.reduce((a, b) => (b.date > a.date ? b : a));

    const again = entryImpact(
      draft({ flow: "Spending", fromWallet: "Cash", category: paid.category, item: paid.item, amount: 10000 }),
      fx.transactions,
      fx.budgets,
      AS_OF,
    );
    expect(again?.paidAlready).toEqual({ date: latest.date, cost: costOf(latest) });

    if (payments.length === 1) {
      expect(entryImpact(transactionToDraft(paid), fx.transactions, fx.budgets, AS_OF)?.paidAlready).toBeNull();
    }

    const nextMonth = entryImpact(
      draft({ date: `${YEAR + 1}-01-10`, flow: "Spending", fromWallet: "Cash", category: paid.category, item: paid.item, amount: 10000 }),
      fx.transactions,
      fx.budgets,
      AS_OF,
    );
    expect(nextMonth?.paidAlready).toBeNull();
  });

  it("waits for an amount", () => {
    expect(entryImpact(draft({ flow: "Spending", fromWallet: "Cash" }), fx.transactions, fx.budgets, AS_OF)).toBeNull();
  });
});
