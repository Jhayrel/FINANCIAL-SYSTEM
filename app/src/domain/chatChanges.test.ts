import { describe, expect, it } from "vitest";

import { changeWords, planEdit, readEditAsk } from "./chatChanges";
import type { ReferenceLists, Transaction } from "./types";

const reference: ReferenceLists = {
  wallets: ["Cash", "Gcash", "Maya"],
  savings: [],
  bills: ["Electricity"],
  subscriptions: ["Spotify"],
  revenueCategories: ["Allowance"],
  spendingTypes: [{ name: "Food", remark: "" }, { name: "Travel", remark: "" }, { name: "Treat", remark: "" }],
};
const ASOF = "2026-09-10";

let n = 0;
const row = (over: Partial<Transaction>): Transaction => {
  n += 1;
  return {
    id: `r${n}`,
    recordNumber: 400 + n,
    date: "2026-09-09",
    type: "Spending",
    fromWallet: "Gcash",
    toWallet: "",
    category: "Spending",
    item: "Food",
    description: "",
    amount: 10000,
    fee: 0,
    total: 10000,
    notes: "",
    status: "Paid",
    ...over,
  };
};

const ledger: Transaction[] = [
  row({ id: "in", type: "Revenue", category: "Revenue", item: "Allowance", fromWallet: "", toWallet: "Gcash", amount: 1_000_000, total: 1_000_000, date: "2026-09-01", status: "Received" }),
  row({ id: "in2", type: "Revenue", category: "Revenue", item: "Allowance", fromWallet: "", toWallet: "Maya", amount: 1_000_000, total: 1_000_000, date: "2026-09-01", status: "Received" }),
  row({ id: "treat", item: "Treat", amount: 110000, total: 110000, date: "2026-09-09", recordNumber: 440 }),
  row({ id: "spotify", category: "Subscriptions", item: "Spotify", amount: 8500, total: 8500, date: "2026-09-05" }),
  row({ id: "grab1", item: "Travel", description: "grab ride", amount: 25000, total: 25000, date: "2026-09-03" }),
  row({ id: "grab2", item: "Travel", description: "grab ride", amount: 18000, total: 18000, date: "2026-09-07" }),
  row({ id: "unknown", item: "", description: "unknown", amount: 6000, total: 6000, date: "2026-08-28" }),
];

describe("reading a change to saved entries", () => {
  it("reads an amount", () => {
    expect(readEditAsk("change the treat yesterday to 1200", reference, ASOF)).toMatchObject({ change: { amount: 120000 }, all: false });
  });

  it("reads a wallet moved", () => {
    expect(readEditAsk("move my spotify payment from gcash to maya", reference, ASOF)).toMatchObject({
      change: { wallet: { from: "Gcash", to: "Maya" } },
    });
  });

  it("reads every matching row", () => {
    expect(readEditAsk("move all grab rides this month to cash", reference, ASOF)).toMatchObject({ all: true, change: { wallet: { to: "Cash" } } });
  });

  it("reads a date", () => {
    expect(readEditAsk("change the date of #440 to aug 27", reference, ASOF)).toMatchObject({ change: { date: "2026-08-27" } });
  });

  it("reads an item from the owner's own lists", () => {
    expect(readEditAsk("change the unknown on aug 28 to food", reference, ASOF)).toMatchObject({ change: { item: "Food" } });
  });

  it("leaves a new transfer to be recorded, not edited", () => {
    expect(readEditAsk("move 500 from gcash to maya", reference, ASOF)).toBeNull();
    expect(readEditAsk("how much did I spend", reference, ASOF)).toBeNull();
  });
});

describe("planning the change", () => {
  it("changes the one row meant, and says how", () => {
    const ask = readEditAsk("change the treat yesterday to 1200", reference, ASOF)!;
    const plan = planEdit(ask, ledger, reference, [], ASOF);
    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0]?.after).toMatchObject({ id: "treat", amount: 120000, total: 120000 });
    expect(changeWords(plan.rows[0]!)).toBe("₱1,100.00 to ₱1,200.00");
  });

  it("moves the wallet on the side that held it", () => {
    const ask = readEditAsk("move my spotify payment from gcash to maya", reference, ASOF)!;
    const plan = planEdit(ask, ledger, reference, [], ASOF);
    expect(plan.rows[0]?.after).toMatchObject({ id: "spotify", fromWallet: "Maya" });
  });

  it("moves every match when asked for all of them", () => {
    const ask = readEditAsk("move all grab rides this month to cash", reference, ASOF)!;
    const plan = planEdit(ask, [...ledger, row({ id: "cashin", type: "Revenue", category: "Revenue", item: "Allowance", fromWallet: "", toWallet: "Cash", amount: 100000, total: 100000, date: "2026-09-01" })], reference, [], ASOF);
    expect(plan.rows.map((r) => r.after.id).sort()).toEqual(["grab1", "grab2"]);
    expect(plan.rows.every((r) => r.after.fromWallet === "Cash")).toBe(true);
  });

  it("files a changed item under its own category", () => {
    const ask = readEditAsk("change the unknown on aug 28 to spotify", reference, ASOF)!;
    const plan = planEdit(ask, ledger, reference, [], ASOF);
    expect(plan.rows[0]?.after).toMatchObject({ item: "Spotify", category: "Subscriptions" });
  });

  it("refuses a change the form would refuse, and says why", () => {
    const ask = { target: "treat", all: false, change: { amount: 0 } };
    const plan = planEdit(ask, ledger, reference, [], ASOF);
    expect(plan.rows).toEqual([]);
    expect(plan.refused[0]?.reason).toBeTruthy();
  });
});
