/**
 * The sentences that came back useless, and what they read as now.
 *
 * Every case in the first block is quoted from the deployed app.
 */

import { describe, expect, it } from "vitest";

import { readEntry } from "./readEntry";
import { nextQuestion } from "./capture";
import { checkDraft } from "./entry";
import type { ReferenceLists, Transaction } from "./types";

const reference: ReferenceLists = {
  wallets: ["Cash", "Gcash", "Maya"],
  savings: ["Maya Bank (Personal savings)"],
  bills: ["Electricity"],
  subscriptions: ["Spotify"],
  revenueCategories: ["Allowance"],
  spendingTypes: [{ name: "Load", remark: "" }, { name: "Food", remark: "" }],
};

let n = 0;
const row = (over: Partial<Transaction> = {}): Transaction => {
  n += 1;
  return {
    id: `t-${n}`,
    recordNumber: n,
    date: "2026-07-01",
    type: "Spending",
    fromWallet: "Gcash",
    toWallet: "",
    category: "Spending",
    item: "Load",
    description: "",
    amount: 5000,
    fee: 0,
    total: 5000,
    notes: "",
    status: "Paid",
    ...over,
  };
};

const ledger: Transaction[] = [
  row(),
  row(),
  row({ item: "Food", fromWallet: "Cash", description: "lunch" }),
  row({ item: "Food", fromWallet: "Cash", description: "restaurant" }),
  row({ item: "Food", fromWallet: "Cash", description: "restaurant dinner" }),
  row({ item: "Spotify", category: "Subscriptions", fromWallet: "Maya", status: "Paid" }),
  row({ item: "Spotify", category: "Subscriptions", fromWallet: "Maya", status: "Paid" }),
  row({
    type: "Revenue",
    category: "Revenue",
    item: "Allowance",
    fromWallet: "",
    toWallet: "Maya",
    status: "Received",
  }),
  row({
    type: "Revenue",
    category: "Revenue",
    item: "Allowance",
    fromWallet: "",
    toWallet: "Maya",
    status: "Received",
  }),
];

const ASOF = "2026-08-31";
const read = (text: string) => readEntry(text, ledger, reference, ASOF);

describe("the sentences that used to fail", () => {
  it('"I paid spotify" becomes a subscription, from the right wallet', () => {
    const { draft, worthOffering } = read("I paid spotify");
    expect(worthOffering).toBe(true);
    expect(draft).toMatchObject({
      flow: "Spending",
      item: "Spotify",
      category: "Subscriptions",
      fromWallet: "Maya",
      status: "Paid",
    });
    // No figure was given, so exactly one question remains.
    expect(nextQuestion(draft, reference)?.blank).toBe("amount");
  });

  it('"I spent 100 today buying load using maya" is complete, with no question left', () => {
    const { draft } = read("I spent 100 today buying load using maya");
    expect(draft).toMatchObject({
      flow: "Spending",
      date: ASOF,
      item: "Load",
      amount: 10000,
      fromWallet: "Maya",
      status: "Paid",
    });
    expect(nextQuestion(draft, reference)).toBeNull();
    expect(checkDraft(draft, [], reference, []).ok).toBe(true);
  });

  it('"I spend 100 on restaurant yesterday" dates itself and finds the item', () => {
    const { draft } = read("I spend 100 on restaurant yesterday");
    expect(draft.date).toBe("2026-08-30");
    expect(draft.amount).toBe(10000);
    // "restaurant" is not an item, but it is what the Food rows say.
    expect(draft.item).toBe("Food");
  });

  it('"I have paid my load today" reads, and asks only for the figure', () => {
    const { draft } = read("I have paid my load today");
    expect(draft.item).toBe("Load");
    expect(draft.amount).toBeNull();
    expect(nextQuestion(draft, reference)?.blank).toBe("amount");
  });
});

describe("which way the money went", () => {
  it("reads income, and puts it in the wallet those rows land in", () => {
    const { draft } = read("got 5000 allowance");
    expect(draft).toMatchObject({
      flow: "Revenue",
      category: "Revenue",
      item: "Allowance",
      toWallet: "Maya",
      amount: 500000,
      status: "Received",
    });
    expect(draft.fromWallet).toBe("");
  });

  it("reads a transfer, both ends", () => {
    const { draft } = read("transferred 1000 from cash to gcash");
    expect(draft).toMatchObject({
      flow: "Transfer",
      category: "Transfer",
      fromWallet: "Cash",
      toWallet: "Gcash",
      amount: 100000,
      status: "Transferred",
    });
  });

  it('reads "sent me" as income rather than as a transfer out', () => {
    expect(read("my mom sent me 2000").draft.flow).toBe("Revenue");
  });

  it("offers nothing for a sentence with no money verb in it", () => {
    expect(read("what is my balance").worthOffering).toBe(false);
    expect(read("hatdog").worthOffering).toBe(false);
  });
});

describe("dates", () => {
  it("defaults to today without claiming it was told so", () => {
    const { draft, because } = read("bought load 100");
    expect(draft.date).toBe(ASOF);
    expect(because.join(" ")).not.toContain("from what you said");
  });

  it("reads yesterday and the day before", () => {
    expect(read("spent 100 yesterday").draft.date).toBe("2026-08-30");
    expect(read("spent 100 day before yesterday").draft.date).toBe("2026-08-29");
  });

  it("reads a written date, and does not read it as the amount", () => {
    expect(read("paid 500 on 2026-08-12").draft.date).toBe("2026-08-12");
    expect(read("paid 500 on 2026-08-12").draft.amount).toBe(50000);
    expect(read("paid 500 on 8/12/2026").draft.date).toBe("2026-08-12");
  });
});

describe("amounts", () => {
  it("reads the forms people type", () => {
    expect(read("spent 1,234.56 on food").draft.amount).toBe(123456);
    expect(read("spent ₱250 on food").draft.amount).toBe(25000);
    expect(read("spent PHP 99.50 on food").draft.amount).toBe(9950);
  });

  it("never invents one", () => {
    expect(read("bought food").draft.amount).toBeNull();
  });

  it("ignores a single stray digit", () => {
    expect(read("bought food for 1 person").draft.amount).toBeNull();
  });
});

describe("it never invents a wallet", () => {
  it("leaves a wallet that is not the owner's blank", () => {
    // "bpi" is not an account, and Food's usual wallet is Cash.
    const { draft } = read("paid 500 for food using bpi");
    expect(draft.fromWallet).toBe("Cash");
    expect(reference.wallets).not.toContain("bpi");
  });

  it("does not match a wallet name inside a longer word", () => {
    const { draft } = read("paid 100 to the cashier");
    // Nothing named, so history fills it, and history says Cash for Food.
    expect([...reference.wallets, ""]).toContain(draft.fromWallet);
  });

  it("prefers the longer account name", () => {
    const { draft } = read("moved 500 from Maya Bank (Personal savings) to gcash");
    expect(draft.fromWallet).toBe("Maya Bank (Personal savings)");
    expect(draft.toWallet).toBe("Gcash");
  });
});

describe("it never produces debt", () => {
  it("reads borrowing as nothing rather than as a debt row", () => {
    // "borrowed" is in none of the three verb sets, on purpose.
    expect(read("borrowed 500 from maya credit").worthOffering).toBe(false);
  });
});

describe("money that leaves your accounts", () => {
  /**
   * The transfer that broke. It became Gcash to Gcash, was refused as needing
   * two different wallets, and then asked which of five accounts a friend's
   * bank was.
   */
  it("reads sending to a friend as a transfer out, with no destination to ask about", () => {
    const { draft, settled, because } = read(
      "I sent money to my friend gotyme 1000 using my gcash",
    );
    expect(draft.flow).toBe("Transfer");
    expect(draft.fromWallet).toBe("Gcash");
    expect(draft.toWallet).toBe("");
    expect(draft.amount).toBe(100000);
    expect(settled).toContain("toWallet");
    expect(because.join(" ")).toContain("left your accounts");
    // Nothing left to ask: the blank destination is the answer.
    expect(nextQuestion(draft, reference, settled)).toBeNull();
  });

  it("still asks for the destination when the transfer is between your own", () => {
    const { draft, settled } = read("moved 500 from cash");
    expect(settled).toHaveLength(0);
    expect(nextQuestion(draft, reference, settled)?.blank).toBe("toWallet");
  });

  it("keeps a named account as the destination rather than treating it as sent out", () => {
    const { draft, settled } = read("transferred 1000 from cash to gcash");
    expect(draft.toWallet).toBe("Gcash");
    expect(settled).toHaveLength(0);
  });
});

describe("debt is never guessed at", () => {
  it("refuses every shape of borrowing and repaying", () => {
    for (const text of [
      "borrowed 500 from maya credit",
      "I paid my credit card 2000",
      "repaid 1500 to maya",
      "paid off my loan",
      "I owe 300 to my friend",
    ]) {
      const result = read(text);
      expect(result.readsAsDebt, text).toBe(true);
      expect(result.worthOffering, text).toBe(false);
    }
  });

  it("does not mistake ordinary spending for debt", () => {
    expect(read("I paid 200 for food").readsAsDebt).toBe(false);
    expect(read("bought load 100").readsAsDebt).toBe(false);
  });
});
