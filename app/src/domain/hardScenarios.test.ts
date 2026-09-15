/**
 * The hard cases the owner asked about on 2026-09-16, each run for real.
 *
 *   A budget set after the month's spending is already past it.
 *   The same entry saved on the phone and the laptop at once.
 *   Settings changed on two devices at the same moment.
 *   The connection cutting off while changes are waiting.
 *   A ledger far larger than today's.
 *
 * Each says what the owner would see, and fails if the app would say
 * something else.
 */

import { describe, expect, it } from "vitest";

import { loadFixture } from "../fixtures/load";
import { financeAlerts } from "./alerts";
import { billStatuses } from "./bills";
import { saveTracks } from "./budgetLock";
import { rangeReport } from "./dayRange";
import { checkIntegrity } from "./integrity";
import { monthBrief } from "./monthPlan";
import { defaultSettings } from "./settings";
import { changedSections } from "./settingsDiff";
import { connectionWords, syncWords } from "./syncState";
import type { BudgetYear, Budgets, ReferenceLists, Transaction } from "./types";

const fx = loadFixture();
const AS_OF = "2026-09-16";
const AT = "2026-09-16T02:00:00.000Z";
const reference: ReferenceLists = { ...fx.reference, wallets: ["Cash", "Maya"], savings: [], bills: ["Wifi"], subscriptions: [] };
const EMPTY: BudgetYear = {
  spending: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  billsSubs: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
};

let n = 0;
const row = (over: Partial<Transaction>): Transaction => {
  n += 1;
  const amount = over.amount ?? 0;
  return {
    id: `h${n}`,
    recordNumber: n,
    date: "2026-09-01",
    type: "Spending",
    fromWallet: "Cash",
    toWallet: "",
    category: "Spending",
    item: "Food",
    description: "",
    fee: 0,
    notes: "",
    status: "",
    ...over,
    amount,
    total: amount + (over.fee ?? 0),
  };
};

const alertsFor = (transactions: readonly Transaction[]) =>
  financeAlerts({
    transactions,
    accounts: [],
    budgets: {},
    debts: [],
    bills: billStatuses(transactions, reference, AS_OF),
    lowBalanceThreshold: 0,
    asOf: AS_OF,
  });

describe("a budget set after the month's spending is already past it", () => {
  const ledger = [
    row({ date: "2026-09-01", type: "Revenue", fromWallet: "", toWallet: "Cash", category: "Revenue", item: "Allowance", amount: 5000000 }),
    row({ date: "2026-09-05", item: "Food", amount: 2000000 }),
  ];
  const brief = (budgets: Budgets) =>
    monthBrief({ transactions: ledger, reference, budgets, debts: [], year: 2026, month: 9, asOf: AS_OF });

  it("saves it, and from that moment the month reads as over with nothing safe to spend", () => {
    expect(brief({}).tracks.spending.budget).toBe(0);

    const out = saveTracks(EMPTY, 2026, 9, { spending: 1000000, billsSubs: 0 }, "month", AS_OF, AT);
    expect(out.refused).toBeUndefined();
    expect(out.written).toEqual([9]);

    const after = brief({ "2026": out.plan });
    expect(after.tracks.spending.remaining).toBe(-1000000);
    expect(after.tracks.spending.status).toBe("OVER THE BUDGET");
    expect(after.safe?.perDay).toBe(0);
    expect(after.safe?.limitedBy).toBe("budget");
    expect(after.notes.some((line) => line.includes("over its budget"))).toBe(true);
    expect(after.notes.some((line) => line.includes("used up"))).toBe(true);
  });

  it("refuses to change a closed month without a reason, and takes it with one", () => {
    const july = saveTracks(EMPTY, 2026, 7, { spending: 1000000, billsSubs: 0 }, "month", AS_OF, AT);
    expect(july.refused).toBeTruthy();
    expect(july.written).toEqual([]);

    const withReason = saveTracks(EMPTY, 2026, 7, { spending: 1000000, billsSubs: 0 }, "month", AS_OF, AT, "Forgot to set it in July");
    expect(withReason.written).toEqual([7]);
  });

  it("never saves a budget below zero, whatever reaches it", () => {
    const out = saveTracks(EMPTY, 2026, 9, { spending: -50000, billsSubs: -1 }, "month", AS_OF, AT);
    expect(out.plan.spending[8]).toBe(0);
    expect(out.plan.billsSubs[8]).toBe(0);
  });
});

describe("the same entry saved on the phone and the laptop at once", () => {
  it("names both when the two devices gave them the same record number", () => {
    const phone = row({ id: "phone-1", recordNumber: 519, date: "2026-09-15", item: "Load", amount: 10000 });
    const laptop = row({ id: "laptop-1", recordNumber: 519, date: "2026-09-15", item: "Load", amount: 10000 });
    const shared = alertsFor([phone, laptop]).find((a) => a.id === "shared-number-519");
    expect(shared?.title).toBe("2 entries share record #0519");
    expect(shared?.query).toBe("#0519");
  });

  it("leaves alone a split repayment, whose interest row shares its payment's number by design", () => {
    const pay = row({ id: "t-1", recordNumber: 600, type: "Debt", category: "", item: "", debtId: "d1", debtEffect: "repay", amount: 250000 });
    const interest = row({ id: "t-1-interest", recordNumber: 600, type: "Debt", category: "", item: "", debtId: "d1", debtEffect: "interest", amount: 18879 });
    expect(alertsFor([pay, interest]).some((a) => a.id.startsWith("shared-number"))).toBe(false);
  });

  it("asks about the same purchase saved twice with different numbers, from ₱500.00 up", () => {
    const first = row({ date: "2026-09-15", item: "Groceries", amount: 120000 });
    const again = row({ date: "2026-09-15", item: "Groceries", amount: 120000 });
    expect(alertsFor([first, again]).some((a) => a.id === `repeat-${first.id}`)).toBe(true);
  });
});

describe("settings changed on two devices at the same moment", () => {
  const server = defaultSettings();

  it("sends only the section each device changed, so both changes survive", () => {
    const phone = { ...server, lowBalanceThreshold: 80000 };
    const laptop = { ...server, bills: [...server.bills, "Netflix"] };
    const phonePart = changedSections(server, phone);
    const laptopPart = changedSections(server, laptop);
    expect(Object.keys(phonePart)).toEqual(["lowBalanceThreshold"]);
    expect(Object.keys(laptopPart)).toEqual(["bills"]);

    // What the database holds once both have arrived, in either order.
    for (const merged of [{ ...server, ...phonePart, ...laptopPart }, { ...server, ...laptopPart, ...phonePart }]) {
      expect(merged.lowBalanceThreshold).toBe(80000);
      expect(merged.bills).toContain("Netflix");
    }
  });

  it("sends nothing when nothing changed", () => {
    expect(changedSections(server, { ...server })).toEqual({});
  });
});

describe("the connection cuts off", () => {
  it("says how many changes are waiting on the device, and that they will go by themselves", () => {
    const notice = syncWords({ online: false, pending: 3, error: null });
    expect(notice).toMatchObject({ level: "warn", title: "Offline, 3 changes waiting" });
    expect(notice?.detail).toContain("kept on this device");
  });

  it("says it is offline even with nothing waiting", () => {
    expect(syncWords({ online: false, pending: 0, error: null })?.title).toBe("Offline");
  });

  it("says nothing when everything has arrived, and names a slow save when not", () => {
    expect(syncWords({ online: true, pending: 0, error: null })).toBeNull();
    expect(syncWords({ online: true, pending: 1, error: null })?.title).toBe("Saving 1 change");
  });

  it("says plainly that a refused change did not save, and what to do", () => {
    const notice = syncWords({ online: true, pending: 0, error: "Missing or insufficient permissions." });
    expect(notice?.level).toBe("over");
    expect(notice?.detail).toContain("sign in again");
    expect(notice?.detail).toContain("add it again");
  });
});

describe("the Add form says where a save goes", () => {
  it("names the database when connected and nothing is waiting", () => {
    expect(connectionWords({ signedIn: true, online: true, pending: 0 })).toEqual({ tone: "ok", text: "Connected to the database" });
  });

  it("counts what is still on its way, and what is kept offline", () => {
    expect(connectionWords({ signedIn: true, online: true, pending: 2 }).text).toBe("Saving 2 changes");
    expect(connectionWords({ signedIn: true, online: false, pending: 1 })).toEqual({ tone: "warn", text: "Offline: 1 change kept here" });
    expect(connectionWords({ signedIn: true, online: false, pending: 0 }).text).toBe("Offline: saves kept on this device");
  });

  it("says a save stays on this device when nobody is signed in", () => {
    expect(connectionWords({ signedIn: false, online: true, pending: 0 })).toEqual({ tone: "local", text: "Saving on this device only" });
  });
});

describe("a ledger far larger than today's", () => {
  it("reads twenty thousand entries in a few seconds", () => {
    const items = ["Food", "Travel", "Gas", "School", "Treat", "Online Buy"];
    const many: Transaction[] = Array.from({ length: 20000 }, (_, i) =>
      row({
        id: `v${i}`,
        recordNumber: 10000 + i,
        date: `2026-${String(1 + (i % 9)).padStart(2, "0")}-${String(1 + (i % 28)).padStart(2, "0")}`,
        item: items[i % items.length] ?? "Food",
        amount: 5000 + (i % 700) * 10,
      }),
    );

    const start = performance.now();
    monthBrief({ transactions: many, reference, budgets: {}, debts: [], year: 2026, month: 9, asOf: AS_OF });
    rangeReport({ transactions: many, reference, debts: [], range: { start: "2026-01-01", end: "2026-09-30" }, asOf: AS_OF });
    alertsFor(many);
    checkIntegrity(many);
    expect(performance.now() - start).toBeLessThan(5000);
  });
});
