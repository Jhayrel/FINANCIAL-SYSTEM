import { describe, expect, it } from "vitest";
import { typedOnce } from "./typedOnce";

const card = (sourceRef: string, flow: string, item: string, amount: number, fromWallet = "", toWallet = "") => ({
  sourceRef,
  draft: { flow, date: "2026-01-05", amount, item, fromWallet, toWallet },
});

describe("typedOnce", () => {
  const note = "I received 500 from a client and 200 for gas in cash";
  const pictures = ["bank.jpg", "receipt.jpg"];

  it("keeps the typed entries once when two pictures each read them", () => {
    const read = [
      card("bank.jpg and text", "Revenue", "Client", 50000, "", "Wallet A"),
      card("bank.jpg, text: 200 for gas", "Spending", "Gas", 20000, "Cash"),
      card("receipt.jpg, What they said: I received 500", "Revenue", "Client", 50000, "", "Wallet A"),
      card("receipt.jpg, What they said: 200 for gas", "Spending", "Gas", 20000, "Cash"),
      card("receipt.jpg, Receipt: TOTAL DUE 495.00", "Spending", "Food", 49500, "Cash"),
    ];
    expect(typedOnce(read, pictures, note).map((p) => p.draft.item)).toEqual(["Client", "Gas", "Food"]);
  });

  it("leaves two pictures' own amounts alone when the message never says them", () => {
    const read = [card("bank.jpg", "Spending", "Gas", 30000, "Cash"), card("receipt.jpg", "Spending", "Gas", 30000, "Cash")];
    expect(typedOnce(read, pictures, note)).toHaveLength(2);
  });

  it("keeps twins from one picture, and does nothing with one picture", () => {
    const one = [card("bank.jpg", "Spending", "Gas", 20000, "Cash"), card("bank.jpg", "Spending", "Gas", 20000, "Cash")];
    expect(typedOnce(one, pictures, note)).toHaveLength(2);
    expect(typedOnce(one, ["bank.jpg"], note)).toHaveLength(2);
  });

  it("one picture and the words: the deposit the message describes is the picture's, once, with its wallet (3 November 2026)", () => {
    const words = "I paid my debt and also deposited 1500 to my bank";
    const read = [
      card("a.jpg line 2", "Transfer", "", 150000, "Wallet A", "Bank"),
      card("b.jpg", "Debt", "", 98000, "Wallet A"),
      card("b.jpg, user message", "Transfer", "", 150000, "", "Bank"),
    ];
    const kept = typedOnce(read, ["a.jpg", "b.jpg", "c.jpg"], words);
    expect(kept.map((p) => [p.draft.flow, p.draft.amount, p.draft.fromWallet])).toEqual([
      ["Transfer", 150000, "Wallet A"],
      ["Debt", 98000, "Wallet A"],
    ]);
    // The fuller card stays when the words' card came first.
    const first = typedOnce([read[2]!, read[0]!], ["a.jpg"], words);
    expect(first).toHaveLength(1);
    expect(first[0]!.draft.fromWallet).toBe("Wallet A");
    // Into another account: two movements.
    expect(typedOnce([read[0]!, card("b.jpg, user message", "Transfer", "", 150000, "", "Other")], ["a.jpg", "b.jpg"], words)).toHaveLength(2);
  });
});
