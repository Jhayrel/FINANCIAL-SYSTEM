/**
 * Two readings of one sentence, and which to believe on each field.
 *
 * The device reading was only ever used when the model could not be reached,
 * so in ordinary use it was never used at all, and every improvement made to
 * it was dead the moment a provider answered. The record shows the cost:
 *
 *   nag bayad ako ng tricycle 500 kanina cash gamit ko
 *     model:  Transfer, from Maya
 *     device: Spending, Travel, from Cash
 *
 * The owner corrected the wallet by hand and wrote "wrong it recognize it as
 * transfer", then hit the same thing again on the next sentence.
 */

import { describe, expect, it } from "vitest";

import { reconcile } from "./reconcile";
import { readEntry } from "./readEntry";
import { emptyDraft, type Draft } from "./entry";
import type { ReferenceLists } from "./types";

const reference: ReferenceLists = {
  wallets: ["Gcash", "Maya", "Cash"],
  savings: ["Maya Bank (Personal savings)"],
  bills: [],
  subscriptions: [],
  revenueCategories: ["Allowance"],
  spendingTypes: [
    { name: "Food", remark: "Meals, snacks, drinks" },
    { name: "Travel", remark: "Trips, fares, rides" },
  ],
  credits: ["Maya Credit"],
};

const local = (text: string) => readEntry(text, [], reference, "2026-09-06");

const modelSaid = (over: Partial<Draft>): Draft => ({
  ...emptyDraft("2026-09-06"),
  flow: "Transfer",
  category: "Transfer",
  fromWallet: "Maya",
  amount: 50000,
  status: "Transferred",
  ...over,
});

describe("the two sentences the owner corrected by hand", () => {
  it("puts the tricycle fare back to Spending from Cash", () => {
    const said = "nag bayad ako ng tricycle 500 kanina cash gamit ko";
    const { draft, notes } = reconcile(modelSaid({}), local(said));
    expect(draft.flow).toBe("Spending");
    expect(draft.fromWallet).toBe("Cash");
    expect(notes.join(" ")).toContain("Spending");
  });

  it("puts the food back to Spending from Gcash", () => {
    const said = "bumuli ako ng pagkain 200 gcash";
    const model = modelSaid({ amount: 20000, toWallet: "Gcash" });
    const { draft } = reconcile(model, local(said));
    expect(draft.flow).toBe("Spending");
    expect(draft.fromWallet).toBe("Gcash");
  });

  it("says what it changed rather than changing it quietly", () => {
    const { notes } = reconcile(modelSaid({}), local("nag bayad ako ng tricycle 500 kanina cash"));
    expect(notes.length).toBeGreaterThan(0);
  });
});

describe("what the device wins on", () => {
  it("the flow, which decides what every other field means", () => {
    const { draft } = reconcile(modelSaid({}), local("I paid 500 for food from cash"));
    expect(draft.flow).toBe("Spending");
  });

  it("a wallet the sentence actually named", () => {
    const { draft } = reconcile(
      modelSaid({ fromWallet: "Gcash" }),
      local("I paid 500 for food from cash"),
    );
    expect(draft.fromWallet).toBe("Cash");
  });

  it("money that went to a person", () => {
    const { draft } = reconcile(
      modelSaid({ toWallet: "Gcash" }),
      local("I gave 500 to my mom from gcash"),
    );
    expect(draft.sentOut).toBe(true);
    expect(draft.toWallet).toBe("");
  });
});

describe("what the model keeps", () => {
  it("its description, which is judgement about free text", () => {
    const model = modelSaid({ description: "Tricycle to school, morning" });
    const { draft } = reconcile(model, local("nag bayad ako ng tricycle 500 kanina cash"));
    expect(draft.description).toBe("Tricycle to school, morning");
  });

  it("its item, when it named one", () => {
    const model = modelSaid({ item: "Travel", flow: "Spending", category: "Spending" });
    const { draft } = reconcile(model, local("nag bayad ako ng tricycle 500 kanina cash"));
    expect(draft.item).toBe("Travel");
  });

  /**
   * The one field where being wrong costs money directly. Picking a winner
   * would be inventing confidence, so a disagreement is reported instead.
   */
  it("its amount, and a disagreement is reported rather than resolved", () => {
    const model = modelSaid({ amount: 60000 });
    const { draft, notes } = reconcile(model, local("I paid 500 for food from cash"));
    expect(draft.amount).toBe(60000);
    expect(notes.join(" ")).toContain("Two readings of the amount");
  });
});

describe("when it stands well back", () => {
  it("changes nothing when the device read nothing worth offering", () => {
    const model = modelSaid({});
    const { draft, notes } = reconcile(model, local("what should I do about this"));
    expect(draft).toEqual(model);
    expect(notes).toEqual([]);
  });

  it("changes nothing when both readings already agree", () => {
    const model = modelSaid({
      flow: "Spending",
      category: "Spending",
      fromWallet: "Cash",
      item: "Food",
      amount: 50000,
    });
    expect(reconcile(model, local("I paid 500 for food from cash")).notes).toEqual([]);
  });

  it("leaves a wallet the sentence did not name", () => {
    const model = modelSaid({ flow: "Spending", category: "Spending", fromWallet: "Gcash" });
    const { draft } = reconcile(model, local("I paid 500 for food"));
    expect(draft.fromWallet).toBe("Gcash");
  });
});

/**
 * 28 September 2026. Two cards that said something untrue about the owner's
 * own words, and one that saved a row whose kind and category disagreed.
 */
describe("a guess from habit never overrules what was said", () => {
  const history = [
    {
      id: "t1",
      recordNumber: 1,
      date: "2026-09-01",
      type: "Spending" as const,
      fromWallet: "Cash",
      toWallet: "",
      category: "Bills" as const,
      item: "Electric bill",
      description: "Electric bill payment",
      amount: 150000,
      fee: 0,
      total: 150000,
      notes: "",
      status: "Paid" as const,
    },
    {
      id: "t2",
      recordNumber: 2,
      date: "2026-09-02",
      type: "Spending" as const,
      fromWallet: "Cash",
      toWallet: "",
      category: "Spending" as const,
      item: "Unknown",
      description: "unknown spending",
      amount: 600,
      fee: 0,
      total: 600,
      notes: "",
      status: "Paid" as const,
    },
  ];
  const withHistory: ReferenceLists = {
    ...reference,
    bills: ["Electric bill"],
    revenueCategories: ["Allowance", "Random"],
    spendingTypes: [...reference.spendingTypes, { name: "Unknown", remark: "" }],
  };
  const read = (text: string) => readEntry(text, history, withHistory, "2026-09-28");

  it("revenue said in words stays revenue, with its income kind", () => {
    const said = "revenue 14 pesos change of the electric bill payment";
    const model = modelSaid({ flow: "Revenue", category: "Revenue", item: "Random", fromWallet: "", toWallet: "Cash", amount: 1400 });
    const { draft, notes } = reconcile(model, read(said), withHistory);
    expect(draft.flow).toBe("Revenue");
    expect(draft.category).toBe("Revenue");
    expect(draft.item).toBe("Random");
    expect(notes.join(" ")).not.toContain("rather than Revenue");
  });

  it("a wallet found in the history fills a blank and says it was guessed", () => {
    const model = modelSaid({ flow: "Spending", category: "Spending", item: "Unknown", fromWallet: "", amount: 600 });
    const { draft, notes } = reconcile(model, read("6 peosos unknown spending"), withHistory);
    expect(draft.fromWallet).toBe("Cash");
    expect(notes.join(" ")).toContain("the wallet you usually use for this");
    expect(notes.join(" ")).not.toContain("your message named");
  });

  it("a wallet found in the history never replaces one the model gave", () => {
    const model = modelSaid({ flow: "Spending", category: "Spending", item: "Unknown", fromWallet: "Gcash", amount: 600 });
    const { draft } = reconcile(model, read("6 peosos unknown spending"), withHistory);
    expect(draft.fromWallet).toBe("Gcash");
  });

  it("a flow the words do change takes a category that fits it, and drops an item that does not", () => {
    const model = modelSaid({ flow: "Revenue", category: "Revenue", item: "Allowance", toWallet: "Cash", fromWallet: "" });
    const { draft } = reconcile(model, read("I paid 500 for food from cash"), withHistory);
    expect(draft.flow).toBe("Spending");
    expect(draft.category).toBe("Spending");
    // Allowance is income, so it goes; the sentence's own "food" takes its place.
    expect(draft.item).toBe("Food");
  });

  it("an income kind is never carried into spending when the words give nothing instead", () => {
    const model = modelSaid({ flow: "Revenue", category: "Revenue", item: "Allowance", toWallet: "Cash", fromWallet: "" });
    const { draft } = reconcile(model, read("I paid 500 from cash"), withHistory);
    expect(draft.flow).toBe("Spending");
    expect(draft.item).toBe("");
  });
});
