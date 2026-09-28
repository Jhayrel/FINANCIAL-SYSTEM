import { describe, expect, it } from "vitest";

import { amend, asksToRename, titleFrom, WORDED_AS_CORRECTION } from "./capture";
import { looksLikeAnswer } from "./cardQuestions";
import { emptyDraft, type Draft } from "./entry";
import { detectIntent } from "./intent";
import { findRows } from "./recall";
import type { ReferenceLists, Transaction } from "./types";

/**
 * "Change the title", 28 September 2026: a receipt's card, read as "Read it"
 * and discarded, and the words that came after it. The finder for saved rows
 * answered with three entries to correct.
 */

const reference: ReferenceLists = {
  wallets: ["Cash", "Gcash", "Maya"],
  savings: [],
  bills: [],
  subscriptions: [],
  revenueCategories: ["Random"],
  spendingTypes: [
    { name: "Food", remark: "Meals, snacks, drinks" },
    { name: "Home Needs", remark: "Groceries, home items, small tools" },
  ],
};

const card: Draft = {
  ...emptyDraft("2026-09-28"),
  flow: "Spending",
  category: "Spending",
  fromWallet: "Cash",
  amount: 10800,
  description: "Read it",
};

describe("changing a card's title", () => {
  it("knows the instruction however it is put", () => {
    for (const said of [
      "Change the title",
      "change the title please",
      "Edit the description",
      "rename it",
      "fix the name",
      "can you change the title?",
      "the title is wrong",
      "wrong title",
      "Change the product name",
    ]) {
      expect(asksToRename(said), said).toBe(true);
    }
  });

  it("is not a title to change when the words come with it", () => {
    // Those go straight to the card through `amend`.
    expect(asksToRename("change the title to Reed diffuser")).toBe(false);
    expect(amend(card, "change the title to Reed diffuser", reference, "2026-09-28")?.draft.description).toBe("Reed diffuser");
    expect(amend(card, "title: Reed diffuser wood and santal", reference, "2026-09-28")?.draft.description).toBe("Reed diffuser wood and santal");
    expect(amend(card, "call it Reed diffuser", reference, "2026-09-28")?.draft.description).toBe("Reed diffuser");
    expect(amend(card, "rename it to Reed diffuser", reference, "2026-09-28")?.draft.description).toBe("Reed diffuser");
  });

  it("is never the answer to the card's own question", () => {
    expect(looksLikeAnswer("Change the title", "item")).toBe(false);
    expect(looksLikeAnswer("edit the date", "item")).toBe(false);
    expect(looksLikeAnswer("change the amount", "fromWallet")).toBe(false);
    // An ordinary answer still is.
    expect(looksLikeAnswer("for my room", "item")).toBe(true);
    expect(looksLikeAnswer("change from the electric bill", "item")).toBe(true);
  });

  it("takes the next message as the words, without the lead-in", () => {
    expect(titleFrom("Reed defuser wood and santal")).toBe("Reed defuser wood and santal");
    expect(titleFrom("it's Reed diffuser.")).toBe("Reed diffuser");
    expect(titleFrom("call it “Reed diffuser”")).toBe("Reed diffuser");
    expect(titleFrom("should be Reed diffuser")).toBe("Reed diffuser");
  });

  it("does not search the ledger for the word title", () => {
    const row = (recordNumber: number, description: string): Transaction =>
      ({
        id: `r${recordNumber}`,
        recordNumber,
        date: "2026-09-20",
        flow: "Spending",
        category: "Spending",
        item: "Food",
        description,
        fromWallet: "Cash",
        toWallet: "",
        amount: 10000,
        fee: 0,
        status: "Paid",
      }) as unknown as Transaction;
    const rows = [row(1, "Land title copy"), row(2, "Title fee"), row(3, "Book with a long title")];
    expect(findRows("Change the title", rows, "2026-09-28")).toEqual([]);
  });
});

describe("a correction while the card's question waits", () => {
  it("reads 'Its 109' as the amount on the card", () => {
    expect(WORDED_AS_CORRECTION.test("Its 109 fuck")).toBe(true);
    expect(amend(card, "Its 109 fuck", reference, "2026-09-28")?.draft.amount).toBe(10900);
  });

  it("leaves a new entry alone", () => {
    for (const said of ["lunch 150 gcash", "I paid 500 for food from gcash", "bought gas 200 cash"]) {
      expect(WORDED_AS_CORRECTION.test(said), said).toBe(false);
    }
  });

  it("reads the usual ways of correcting", () => {
    for (const said of ["no, its 109", "it was 109", "actually it's 109", "make it 109", "the amount is 109", "should be 109"]) {
      expect(WORDED_AS_CORRECTION.test(said), said).toBe(true);
      expect(amend(card, said, reference, "2026-09-28")?.draft.amount, said).toBe(10900);
    }
  });

  it("is an ask to the intent reader, so an open card takes it", () => {
    expect(detectIntent("Its 109")).toBe("ask");
  });
});

describe("what is learned from corrections", () => {
  it("never learns a row summary or a note as a phrase", async () => {
    const { correctionsFrom } = await import("./aiLog");
    const events = [
      { id: "1", at: "2026-09-27T03:03:50.954Z", action: "edited", where: "add", field: "item", proposed: "2026-09-15 Revenue ", corrected: "2026-09-15 Revenue //fix this" },
      { id: "2", at: "2026-09-27T03:03:54.136Z", action: "edited", where: "add", field: "item", proposed: "2026-09-12 Spending ", corrected: "2026-09-12 Spending Fix this" },
      { id: "3", at: "2026-09-27T03:04:00.000Z", action: "edited", where: "add", field: "item", proposed: "jollibee", corrected: "Food" },
      { id: "4", at: "2026-09-27T03:05:00.000Z", action: "edited", where: "add", field: "item", proposed: "milk tea", corrected: "//fix" },
    ] as never[];
    const learned = correctionsFrom(events, "item", ["Food"]);
    expect([...learned.entries()]).toEqual([["jollibee", "Food"]]);
  });

  it("keys a lesson on what the thing was, not how the money moved", async () => {
    const { lessonKey } = await import("./learning");
    expect(lessonKey("18 fee", reference)).toBe("");
    expect(lessonKey("moved into", reference)).toBe("");
    expect(lessonKey("gave mom 500", reference)).toBe("mom");
    expect(lessonKey("jollibee 285 today using gcash", reference)).toBe("jollibee");
  });
});

describe("money in, answered as borrowed", () => {
  it("reads 'I credit it' as a draw on the credit line", async () => {
    const { answerCard } = await import("./cardQuestions");
    const inflow: Draft = { ...emptyDraft("2026-09-20"), flow: "Revenue", category: "Revenue", toWallet: "Maya", amount: 200000, item: "Random" };
    const lines = [{ id: "maya-credit", name: "Maya Credit", wallet: "Maya" }];
    const drawn = answerCard(inflow, "item", "I credit it", reference, [], lines);
    expect(drawn?.flow).toBe("Debt");
    expect(drawn?.debtEffect).toBe("draw");
    expect(drawn?.item).toBe("Maya Credit");
  });
});

describe("a new entry typed while a card is open", () => {
  it("is its own row, and a correction is still a correction", async () => {
    const { startsNewEntry } = await import("./capture");
    const { readEntry } = await import("./readEntry");
    const read = (said: string) => startsNewEntry(said, readEntry(said, [], { ...reference, revenueCategories: ["Random", "Allowance"] }, "2026-09-28"));
    expect(read("revenue 14 pesos change of the electric bill payment cash")).toBe(true);
    expect(read("bought lunch 150 using gcash")).toBe(true);
    expect(read("spent 95 on food using cash")).toBe(true);
    expect(read("make it 300")).toBe(false);
    expect(read("gcash")).toBe(false);
    expect(read("300 gcash")).toBe(false);
    expect(read("its 109")).toBe(false);
    expect(read("change the date to yesterday")).toBe(false);
  });
});

describe("the answers to tap under an entry's question", () => {
  it("puts the items used most lately first, then the rest, and never more than six", async () => {
    const { pendingChoices } = await import("./cardQuestions");
    const spent = (item: string, n: number): Transaction =>
      ({ id: `s${n}`, recordNumber: n, date: "2026-09-20", type: "Spending", item, category: "Spending", fromWallet: "Cash", toWallet: "", amount: 100, fee: 0, total: 100, description: "", notes: "", status: "Paid" }) as Transaction;
    const rows = [spent("Home Needs", 1), spent("Home Needs", 2), spent("Food", 3)];
    const draft: Draft = { ...card, item: "" };
    expect(pendingChoices(draft, "item", reference, rows)).toEqual(["Home Needs", "Food"]);
    expect(pendingChoices(draft, "fromWallet", reference, rows)).toEqual(["Cash", "Gcash", "Maya"]);
    expect(pendingChoices(draft, "amount", reference, rows)).toEqual([]);
    const income: Draft = { ...emptyDraft("2026-09-28"), flow: "Revenue", category: "Revenue", toWallet: "Cash", amount: 1400 };
    expect(pendingChoices(income, "item", reference, rows)).toEqual(["Random"]);
  });
});
