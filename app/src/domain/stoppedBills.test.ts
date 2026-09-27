/**
 * A bill or subscription the owner stopped paying.
 *
 * The owner, 27 September 2026: a cloud storage subscription was cancelled
 * and the app still called it due, with no way to say so short of removing
 * it and losing its name from the lists. Stopping keeps it listed and its
 * history filed, and takes it off everything that expects it; paying again
 * starts it again. Names and figures are invented.
 */

import { describe, expect, it } from "vitest";

import { financeAlerts } from "./alerts";
import { billStatuses, overdue } from "./bills";
import { monthBills } from "./budgetView";
import { checkDraft, emptyDraft, type Draft } from "./entry";
import { REFERENCE } from "./eval/corpus";
import { normaliseSettings } from "./settings";
import type { ReferenceLists, Transaction } from "./types";

let n = 0;
const paid = (date: string, item: string, amount: number, category: "Bills" | "Subscriptions" = "Subscriptions"): Transaction => {
  n += 1;
  return {
    id: `p${n}`,
    recordNumber: n,
    date,
    type: "Spending",
    fromWallet: "Maya",
    toWallet: "",
    category,
    item,
    description: "",
    amount,
    fee: 0,
    total: amount,
    notes: "",
    status: "Paid",
  };
};

const ledger: Transaction[] = [
  paid("2026-06-16", "Cloud Box", 11900),
  paid("2026-07-16", "Cloud Box", 11900),
  paid("2026-08-16", "Cloud Box", 11900),
  paid("2025-01-28", "Movie Plus", 24900),
  paid("2026-09-03", "Tunes", 8500),
];

const reference: ReferenceLists = {
  ...REFERENCE,
  subscriptions: ["Cloud Box", "Movie Plus", "Tunes"],
};
const stopped: ReferenceLists = { ...reference, stopped: [{ name: "cloud box", since: "2026-09-20" }] };
const TODAY = "2026-09-27";

describe("stopping one", () => {
  it("is past due while it runs, and never due once stopped", () => {
    const running = billStatuses(ledger, reference, TODAY).find((b) => b.item === "Cloud Box");
    expect(running?.daysToDue).toBeLessThan(0);
    const halted = billStatuses(ledger, stopped, TODAY).find((b) => b.item === "Cloud Box");
    expect(halted).toMatchObject({ stopped: "2026-09-20", nextDue: undefined, daysToDue: undefined, timesPaid: 3 });
    expect(overdue(billStatuses(ledger, stopped, TODAY)).map((b) => b.item)).not.toContain("Cloud Box");
  });

  it("leaves the month's bills and the bell", () => {
    expect(monthBills(ledger, reference, 2026, 9, TODAY).bills.map((b) => b.item)).toContain("Cloud Box");
    expect(monthBills(ledger, stopped, 2026, 9, TODAY).bills.map((b) => b.item)).not.toContain("Cloud Box");
    const bell = financeAlerts({
      transactions: ledger,
      accounts: [],
      budgets: {},
      debts: [],
      bills: billStatuses(ledger, stopped, TODAY),
      lowBalanceThreshold: 0,
      asOf: TODAY,
    });
    expect(bell.map((a) => a.detail).join(" ")).not.toContain("Cloud Box");
  });

  it("still shows a payment made in the month it stopped as paid", () => {
    const septPaid = [...ledger, paid("2026-09-10", "Cloud Box", 11900)];
    const month = monthBills(septPaid, { ...reference, stopped: [{ name: "Cloud Box", since: "2026-09-10" }] }, 2026, 9, TODAY);
    expect(month.bills.find((b) => b.item === "Cloud Box")?.state).toBe("paid");
  });
});

describe("starting it again", () => {
  it("runs again from a payment after the day it stopped, with nothing to switch back", () => {
    const again = [...ledger, paid("2026-10-02", "Cloud Box", 11900)];
    const status = billStatuses(again, stopped, "2026-10-05").find((b) => b.item === "Cloud Box");
    expect(status?.stopped).toBeUndefined();
    expect(status?.resumed).toBe("2026-10-02");
    expect(status?.nextDue).toBe("2026-11-02");
  });

  it("says so on the card before that payment is saved", () => {
    const draft: Draft = { ...emptyDraft("2026-10-02"), flow: "Spending", category: "Subscriptions", item: "Cloud Box", fromWallet: "Maya", amount: 11900 };
    const check = checkDraft(draft, ledger, stopped, [], "2026-10-02");
    expect(check.errors).toEqual([]);
    expect(check.warnings.map((w) => w.message).join(" ")).toContain("You stopped Cloud Box on September 20, 2026");
  });
});

describe("one long gone is asked about, not called late", () => {
  it("says it looks stopped instead of past due", () => {
    const bell = financeAlerts({
      transactions: ledger,
      accounts: [],
      budgets: {},
      debts: [],
      bills: billStatuses(ledger, reference, TODAY),
      lowBalanceThreshold: 0,
      asOf: TODAY,
    });
    expect(bell.find((a) => a.id === "bills-overdue")?.detail).not.toContain("Movie Plus");
    expect(bell.find((a) => a.id === "bills-lapsed")?.title).toBe("Movie Plus looks stopped");
  });
});

describe("saved with the settings", () => {
  it("keeps a stop through a reload and drops a malformed one", () => {
    const s = normaliseSettings({ stopped: [{ name: "Cloud Box", since: "2026-09-20" }, { name: "", since: "x" }, { since: "2026-01-01" }] });
    expect(s.stopped).toEqual([{ name: "Cloud Box", since: "2026-09-20" }]);
    expect(normaliseSettings({}).stopped).toEqual([]);
  });
});
