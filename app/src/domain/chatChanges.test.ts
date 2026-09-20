import { describe, expect, it } from "vitest";

import { loadFixture } from "../fixtures/load";

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

/**
 * A correction that says what the row is now.
 *
 * The owner, 20 September 2026: "The food I recorded for today was paid with
 * my Gcash account and not with cash the way it is currently saved, and the
 * amount should be two hundred and fifty pesos rather than what is showing
 * now." Five food rows from one day came back, each with a button that
 * changes a saved record. The sentence had already said which one: the one
 * on Cash.
 */
describe("the wallet a row is on now", () => {
  const fx2 = loadFixture();
  const polite =
    "I think I made a mistake with one of my entries earlier. The food I recorded for today was paid with my Gcash account and not with cash the way it is currently saved. Could you fix that for me please?";

  it("is read as the one to move from", () => {
    const ask = readEditAsk(polite, fx2.reference, "2026-09-20");
    expect(ask?.change.wallet).toEqual({ from: "Cash", to: "Gcash" });
  });

  it("narrows the search to rows on that wallet", () => {
    const ask = readEditAsk(polite, fx2.reference, "2026-09-20");
    expect(ask).not.toBeNull();

    const rows: Transaction[] = [
      { id: "a", recordNumber: 1, date: "2026-09-20", type: "Spending", fromWallet: "Cash", toWallet: "", category: "Spending", item: "Food", description: "", amount: 12000, fee: 0, total: 12000, notes: "", status: "Paid" },
      { id: "b", recordNumber: 2, date: "2026-09-20", type: "Spending", fromWallet: "Gcash", toWallet: "", category: "Spending", item: "Food", description: "", amount: 80000, fee: 0, total: 80000, notes: "", status: "Paid" },
    ];

    const plan = planEdit(ask!, rows, fx2.reference, [], "2026-09-20");
    expect(plan.rows.map((r) => r.before.id)).toEqual(["a"]);
  });

  it("leaves a plain move alone", () => {
    const ask = readEditAsk("move my spotify from gcash to maya", fx2.reference, "2026-09-20");
    expect(ask?.change.wallet).toEqual({ from: "Gcash", to: "Maya" });
  });
});
