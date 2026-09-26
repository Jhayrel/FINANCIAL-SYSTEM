/**
 * When a bill is next expected, read from how it has actually landed.
 */

import { describe, expect, it } from "vitest";

import { billStatuses, rhythmDays } from "./bills";
import type { ReferenceLists, Transaction } from "./types";

const reference: ReferenceLists = {
  wallets: ["Maya"],
  savings: [],
  bills: ["Wifi"],
  subscriptions: ["Spotify"],
  revenueCategories: [],
  spendingTypes: [],
};

let n = 0;
const paid = (item: string, date: string, amount = 99900, category: "Bills" | "Subscriptions" = "Bills"): Transaction => {
  n += 1;
  return {
    id: `b${n}`,
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

const statusOf = (rows: readonly Transaction[], item: string, asOf: string) =>
  billStatuses(rows, reference, asOf).find((s) => s.item === item);

describe("the rhythm of a bill", () => {
  it("reads a steady run of gaps, and refuses an unsteady one", () => {
    expect(rhythmDays(["2026-01-05", "2026-02-02", "2026-03-02", "2026-03-30"])).toBe(28);
    expect(rhythmDays(["2026-01-05", "2026-02-20", "2026-03-01"])).toBeNull();
    expect(rhythmDays(["2026-01-05", "2026-02-05"])).toBeNull();
  });

  it("ignores a payment split across one day", () => {
    expect(rhythmDays(["2026-01-05", "2026-01-05", "2026-02-04", "2026-03-06"])).toBe(30);
  });
});

describe("when a bill is next expected", () => {
  it("keeps the calendar month for a monthly bill, so the day of the month holds", () => {
    const rows = [paid("Wifi", "2026-06-30"), paid("Wifi", "2026-07-30"), paid("Wifi", "2026-08-30")];
    const wifi = statusOf(rows, "Wifi", "2026-09-10");
    expect(wifi?.rhythm).toBe("monthly");
    expect(wifi?.nextDue).toBe("2026-09-30");
  });

  it("follows a four-weekly bill on its own cycle rather than calling it late", () => {
    const rows = [
      paid("Spotify", "2026-06-07", 25500, "Subscriptions"),
      paid("Spotify", "2026-07-05", 25500, "Subscriptions"),
      paid("Spotify", "2026-08-02", 25500, "Subscriptions"),
    ];
    const spotify = statusOf(rows, "Spotify", "2026-08-20");
    expect(spotify?.rhythm).toBe("days");
    expect(spotify?.everyDays).toBe(28);
    expect(spotify?.nextDue).toBe("2026-08-30");
    // The old rule would have made it due on 2 September and called it late for three days.
    expect(spotify?.daysToDue).toBe(10);
  });

  it("goes by the payment that happened after a cycle is skipped, with no backlog", () => {
    const rows = [
      paid("Wifi", "2026-05-05"),
      paid("Wifi", "2026-06-05"),
      // July skipped deliberately.
      paid("Wifi", "2026-08-05"),
    ];
    const wifi = statusOf(rows, "Wifi", "2026-08-20");
    expect(wifi?.nextDue).toBe("2026-09-05");
    expect(wifi?.daysToDue).toBe(16);
  });

  it("says a bill declared but never paid has no date at all", () => {
    const wifi = statusOf([], "Wifi", "2026-09-10");
    expect(wifi?.rhythm).toBe("never");
    expect(wifi?.nextDue).toBeUndefined();
    expect(wifi?.timesPaid).toBe(0);
  });

  it("counts a bill paid twice in one month once for the date, and both for the month", () => {
    const rows = [paid("Wifi", "2026-09-02"), paid("Wifi", "2026-09-20")];
    const wifi = statusOf(rows, "Wifi", "2026-09-25");
    expect(wifi?.paidThisMonth).toBe(true);
    expect(wifi?.paidThisMonthAmount).toBe(199800);
    expect(wifi?.nextDue).toBe("2026-10-20");
  });
});

describe("a bill that has stopped", () => {
  const paid = (item: string, date: string, category: "Bills" | "Subscriptions" = "Subscriptions"): Transaction => ({
    id: `${item}-${date}`,
    recordNumber: 1,
    date,
    type: "Spending",
    fromWallet: "Maya",
    toWallet: "",
    category,
    item,
    description: "",
    amount: 8500,
    fee: 0,
    total: 8500,
    notes: "",
    status: "Paid",
  });
  const none = { wallets: [], savings: [], bills: [], subscriptions: [], revenueCategories: [], spendingTypes: [] };

  it("is not past due years later when nobody declared it", () => {
    // Imported history: paid monthly in 2023, then never again.
    const rows = ["2023-04-14", "2023-05-14", "2023-06-14"].map((d) => paid("Storyblocks", d));
    expect(billStatuses(rows, none, "2026-09-26")).toEqual([]);
  });

  it("is still expected when it is in the owner's list", () => {
    const rows = ["2023-05-14", "2023-06-14"].map((d) => paid("Storyblocks", d));
    const statuses = billStatuses(rows, { ...none, subscriptions: ["Storyblocks"] }, "2026-09-26");
    expect(statuses.map((b) => b.item)).toEqual(["Storyblocks"]);
  });

  it("stays while it is only a month or two late", () => {
    const rows = ["2026-06-17", "2026-07-17", "2026-08-17"].map((d) => paid("Google Drive", d));
    expect(billStatuses(rows, none, "2026-09-26").map((b) => b.item)).toEqual(["Google Drive"]);
  });
});

