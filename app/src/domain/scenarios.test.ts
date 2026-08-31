/**
 * The sentences a person actually types, end to end.
 *
 * These exercise the offline path: `readEntry`, `inferFromHistory` and
 * `capture`. The model reads every message when it can be reached, so this is
 * the floor rather than the ceiling, and the floor is the part that has to
 * keep working when every free provider is rate limited at midnight.
 *
 * Every case is either a sentence the owner reported or the shape of one. A
 * file like this earns its keep by being dull to read and expensive to break.
 */

import { describe, expect, it } from "vitest";

import { readEntry } from "./readEntry";
import { applyReply, blanksIn, matchItem, nextQuestion } from "./capture";
import { checkDraft } from "./entry";
import { detectIntent, isQuestion } from "./intent";
import { detectRecall, findRows } from "./recall";
import type { ReferenceLists, Transaction } from "./types";

const reference: ReferenceLists = {
  wallets: ["Cash", "Gcash", "Maya"],
  savings: ["Maya Bank (Personal savings)", "Reserved Fund"],
  bills: ["Globe at Home Wifi", "Dito Prepaid"],
  subscriptions: ["Spotify", "Microsoft Office 365"],
  revenueCategories: ["Allowance", "Framelink"],
  spendingTypes: [
    { name: "Food", remark: "Meals, snacks, drinks" },
    { name: "Gas", remark: "Fuel for vehicle" },
    { name: "Fun", remark: "Outings, parties, leisure" },
    { name: "Online Buy", remark: "Online orders, apps, or subscriptions" },
    { name: "Treat", remark: "Treating someone" },
  ],
};

const accounts = [...reference.wallets, ...reference.savings];
const ASOF = "2026-08-29";

let n = 0;
const row = (over: Partial<Transaction> = {}): Transaction => {
  n += 1;
  return {
    id: `t-${n}`,
    recordNumber: n,
    date: "2026-08-01",
    type: "Spending",
    fromWallet: "Cash",
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

const twice = (over: Partial<Transaction>): Transaction[] => [row(over), row(over)];

const ledger: Transaction[] = [
  ...twice({ item: "Gas", fromWallet: "Cash", amount: 20000, total: 20000 }),
  row({ item: "Food", fromWallet: "Cash", description: "lunch" }),
  row({ item: "Food", fromWallet: "Cash", description: "merienda" }),
  ...twice({ item: "Spotify", category: "Subscriptions", fromWallet: "Maya", amount: 8500, total: 8500 }),
  ...twice({
    item: "Globe at Home Wifi",
    category: "Bills",
    fromWallet: "Maya",
    amount: 99900,
    total: 99900,
  }),
  ...twice({
    type: "Revenue",
    category: "Revenue",
    item: "Allowance",
    fromWallet: "",
    toWallet: "Gcash",
    amount: 500000,
    total: 500000,
    status: "Received",
  }),
];

const read = (text: string) => readEntry(text, ledger, reference, ASOF);

/** Walk the whole loop: read it, answer whatever it asks, see what is left. */
function complete(text: string, answers: readonly string[]) {
  const first = read(text);
  let draft = first.draft;
  const asked: string[] = [];

  for (const answer of answers) {
    const question = nextQuestion(draft, reference, first.settled);
    if (!question) break;
    asked.push(question.blank);
    const next = applyReply(draft, question.blank, answer, reference, ledger);
    if (!next) return { draft, asked, failedOn: answer, remaining: question.blank };
    draft = next;
  }

  return { draft, asked, remaining: nextQuestion(draft, reference, first.settled)?.blank ?? null };
}

describe("spending", () => {
  it("a complete sentence needs no questions", () => {
    const { draft, remaining } = complete("I paid 250 for gas using cash", []);
    expect(draft).toMatchObject({
      flow: "Spending",
      item: "Gas",
      amount: 25000,
      fromWallet: "Cash",
    });
    expect(remaining).toBeNull();
    expect(checkDraft(draft, ledger, reference, []).ok).toBe(true);
  });

  it("a bill keeps its own category rather than plain Spending", () => {
    const { draft } = complete("paid globe at home wifi 999 maya", []);
    expect(draft.item).toBe("Globe at Home Wifi");
    expect(draft.category).toBe("Bills");
  });

  it("a subscription keeps its own category", () => {
    const { draft } = complete("paid spotify 85 maya", []);
    expect(draft.item).toBe("Spotify");
    expect(draft.category).toBe("Subscriptions");
  });

  it("no amount becomes one question, and the answer finishes it", () => {
    const { draft, asked, remaining } = complete("I paid for gas today using cash", ["300"]);
    expect(asked).toEqual(["amount"]);
    expect(draft.amount).toBe(30000);
    expect(remaining).toBeNull();
  });

  it("the usual answers it from the rows", () => {
    expect(complete("I paid for gas today using cash", ["the usual"]).draft.amount).toBe(20000);
  });
});

describe("revenue", () => {
  it("reads income into the wallet those rows land in", () => {
    const { draft, remaining } = complete("i got 5000 allowance", []);
    expect(draft).toMatchObject({
      flow: "Revenue",
      category: "Revenue",
      item: "Allowance",
      toWallet: "Gcash",
      amount: 500000,
      status: "Received",
    });
    expect(remaining).toBeNull();
  });

  it("takes a wallet the sentence named over the usual one", () => {
    expect(complete("received 5000 allowance in maya", []).draft.toWallet).toBe("Maya");
  });
});

describe("transfer", () => {
  it("between the owner's own wallets keeps both ends", () => {
    const { draft, remaining } = complete("moved 1000 from cash to gcash", []);
    expect(draft).toMatchObject({ flow: "Transfer", fromWallet: "Cash", toWallet: "Gcash" });
    expect(remaining).toBeNull();
  });

  it("to someone else leaves the destination blank on purpose", () => {
    const { draft } = read("i sent 500 to my friend using maya");
    expect(draft.fromWallet).toBe("Maya");
    expect(draft.toWallet).toBe("");
    expect(draft.sentOut).toBe(true);
    expect(checkDraft(draft, ledger, reference, []).ok).toBe(true);
  });

  /** The withdrawal from the transcript: two figures in one sentence. */
  it("reads a fee without mistaking it for the amount", () => {
    const { draft } = read("withdraw 5000 from maya to cash, fee 18");
    expect(draft.amount).toBe(500000);
    expect(draft.fee).toBe(1800);
  });

  it("answers a wallet question that names a wallet", () => {
    const { draft } = read("i withdraw 5000 fee 18");
    expect(applyReply(draft, "fromWallet", "maya", reference, ledger)?.fromWallet).toBe("Maya");
  });
});

describe("debt is never guessed at", () => {
  it("every shape of it goes to the form", () => {
    for (const text of [
      "I paid my debt yesterday 2950 using maya",
      "borrowed 500 from maya credit",
      "I paid my credit card",
      "repaid 1500",
    ]) {
      const result = read(text);
      expect(result.readsAsDebt, text).toBe(true);
      expect(result.worthOffering, text).toBe(false);
    }
  });

  it("still gives up the amount, wallet and date for the form", () => {
    const { draft } = read("I paid my debt yesterday 2950 using maya");
    expect(draft.flow).toBe("Debt");
    expect(draft.amount).toBe(295000);
    expect(draft.fromWallet).toBe("Maya");
    expect(draft.date).toBe("2026-08-28");
  });
});

describe("questions stay questions", () => {
  it("never turns one into an entry", () => {
    for (const text of [
      "how much did I spend on food this month",
      "what is my balance",
      "why is gcash so low",
      "show me a chart",
      "compare july and august",
    ]) {
      expect(isQuestion(text) || detectIntent(text) === "ask", text).toBe(true);
    }
  });

  it("small talk is not an entry either", () => {
    expect(read("hatdog").worthOffering).toBe(false);
    expect(read("thanks").worthOffering).toBe(false);
  });
});

describe("deleting and restoring by describing it", () => {
  it("finds the row a sentence describes", () => {
    const recall = detectRecall("delete the gas I paid for");
    expect(recall?.action).toBe("bin");
    const found = findRows(recall?.phrase ?? "", ledger, ASOF);
    expect(found.length).toBeGreaterThan(0);
    expect(found[0]?.row.item).toBe("Gas");
  });

  it("finds nothing rather than offering the ledger at random", () => {
    const recall = detectRecall("delete the scuba lessons");
    expect(findRows(recall?.phrase ?? "", ledger, ASOF)).toEqual([]);
  });
});

describe("the item always comes from the owner's lists", () => {
  it("matches a name, a name inside a phrase, and a note", () => {
    expect(matchItem("food", "Spending", "Spending", reference).item).toBe("Food");
    expect(matchItem("outing fun", "Spending", "Spending", reference).item).toBe("Fun");
    expect(matchItem("parties", "Spending", "Spending", reference).item).toBe("Fun");
    expect(matchItem("fuel", "Spending", "Spending", reference).item).toBe("Gas");
  });

  it("says when something is genuinely new, and tidies it", () => {
    expect(matchItem("scuba lessons", "Spending", "Spending", reference)).toEqual({
      item: "Scuba lessons",
      matched: false,
    });
  });
});

describe("nothing is saveable without the fields that matter", () => {
  it("every incomplete draft fails checkDraft and has something to ask", () => {
    for (const text of ["I paid for gas", "i got allowance", "moved money from cash"]) {
      const { draft } = read(text);
      expect(checkDraft(draft, ledger, reference, []).ok, text).toBe(false);
      expect(blanksIn(draft, accounts).length, text).toBeGreaterThan(0);
    }
  });

  /**
   * The sentence that came back as Gas: a wallet name is not a description of
   * what was bought, and no rule may treat it as one.
   */
  it("does not book an unknown purchase under whatever shares a wallet name", () => {
    const { draft } = read("I paid my friend yesterday 600 cash because I buy clubshirt");
    expect(draft.item).not.toBe("Gas");
  });
});
