/**
 * Every item a card carries is one of the owner's own: 3 October 2026, "I
 * said I travel to this place but the entry says vacation instead of travel
 * ... make it always align in the database". Lists and rows are invented.
 */
import { describe, expect, it } from "vitest";

import { amend } from "./capture";
import { emptyDraft, type Draft } from "./entry";
import { inferFromHistory } from "./infer";
import { fitItem, itemOnList, offListProblem } from "./onList";
import { readProposals } from "./proposal";
import type { ReferenceLists, Transaction } from "./types";

const reference: ReferenceLists = {
  wallets: ["Cash", "Wallet A"],
  savings: [],
  bills: ["Internet"],
  subscriptions: ["Music app"],
  revenueCategories: ["Allowance", "Random"],
  spendingTypes: [
    { name: "Food", remark: "Meals, snacks, drinks" },
    { name: "Travel", remark: "Trips, fares, rides" },
    { name: "Fun", remark: "Outings, parties, leisure" },
    { name: "Health", remark: "Medicine or medical needs" },
    { name: "Home Needs", remark: "Groceries, home items" },
  ],
};
const ASOF = "2026-10-03";

const spend = (item: string, description = ""): Draft => ({ ...emptyDraft(ASOF), flow: "Spending", category: "Spending", fromWallet: "Cash", item, description, amount: 50_000 });
const modelSaid = (item: string, description: string, flow = "Spending") => ({
  proposals: [{ flow, date: ASOF, fromWallet: "Cash", toWallet: flow === "Revenue" ? "Wallet A" : "", category: flow, item, description, amountPesos: 500, amountText: "500", confidence: "high" }],
});

describe("a kind the model made up", () => {
  it("is the one the owner said: Travel, not Vacation", () => {
    const [p] = readProposals(modelSaid("Vacation", "Beach"), reference, ASOF, { note: "I travel to the beach 500 cash" }).proposals;
    expect(p?.draft.item).toBe("Travel");
    expect(p?.adjustments.join(" ")).toContain('Booked as Travel, as you said: "Vacation" is not one of your kinds of spending.');
  });

  it("is read against the owner's notes and the everyday words, when they named none", () => {
    const read = (item: string): string => readProposals(modelSaid(item, ""), reference, ASOF, { note: "500 cash" }).proposals[0]?.draft.item ?? "?";
    expect(read("Vacation")).toBe("Travel");
    expect(read("Transportation")).toBe("Travel");
    expect(read("Groceries")).toBe("Home Needs");
    expect(read("Medicine")).toBe("Health");
    expect(read("Entertainment")).toBe("Fun");
    expect(read("Snacks")).toBe("Food");
    expect(read("food")).toBe("Food");
  });

  it("is left for the owner when nothing of theirs fits, the word kept in the description", () => {
    const [p] = readProposals(modelSaid("Salary", "", "Revenue"), reference, ASOF, { note: "salary 500" }).proposals;
    expect(p?.draft.item).toBe("");
    expect(p?.draft.description).toBe("Salary");
    expect(p?.adjustments.join(" ")).toContain('"Salary" is not one of your kinds of income, so pick one of yours.');
  });

  it("never takes the owner's word for one card from a message about two", () => {
    const two = {
      proposals: [
        { flow: "Spending", date: ASOF, fromWallet: "Cash", category: "Spending", item: "Souvenirs", description: "", amountPesos: 100, amountText: "100" },
        { flow: "Spending", date: ASOF, fromWallet: "Cash", category: "Spending", item: "Travel", description: "fare", amountPesos: 50, amountText: "50" },
      ],
    };
    const [first] = readProposals(two, reference, ASOF, { note: "souvenirs 100 and travel 50 cash" }).proposals;
    expect(first?.draft.item).toBe("");
  });
});

describe("the owner's own words", () => {
  it("count in another form: traveled is Travel", () => {
    expect(fitItem(spend("Sightseeing"), "I traveled to the city 500 cash", reference).draft.item).toBe("Travel");
  });

  it("only when they name one kind", () => {
    expect(fitItem(spend("Sightseeing"), "food and travel 500 cash", reference).draft.item).toBe("");
  });
});

describe("saving", () => {
  it("is refused for a kind on no list, and says what to do", () => {
    expect(itemOnList(spend("Vacation"), reference)).toBe(false);
    expect(offListProblem(spend("Vacation"), reference)).toBe('"Vacation" is not one of your kinds of spending. Pick one of yours, or add it in Settings first.');
    expect(offListProblem(spend("travel"), reference)).toBe("");
    expect(offListProblem({ ...spend(""), flow: "Transfer" }, reference)).toBe("");
  });
});

describe("a change said on the card", () => {
  it("is set when it is one of theirs, and refused when not", () => {
    expect(amend(spend("Food"), "change the item to vacation", reference, ASOF)?.draft.item).toBe("Travel");
    expect(amend(spend("Food"), "change the item to music app", reference, ASOF)?.draft).toMatchObject({ item: "Music app", category: "Subscriptions" });
    const refused = amend(spend("Food"), "change the item to souvenirs", reference, ASOF);
    expect(refused?.draft.item).toBe("Food");
    expect(refused?.what).toContain('"Souvenirs" is not one of your kinds of spending');
  });
});

describe("the ledger's own history", () => {
  it("never files a row under a kind that is on no list now", () => {
    const old = (item: string, description: string): Transaction => ({
      id: description, recordNumber: 1, date: "2024-05-07", type: "Spending", fromWallet: "Cash", toWallet: "", category: "Spending",
      item, description, amount: 50_000, fee: 0, total: 50_000, notes: "", status: "Paid",
    });
    const history = [old("Pasalubong", "pasalubong for home"), old("Pasalubong", "pasalubong")];
    expect(inferFromHistory(spend(""), history, reference, "pasalubong 500 cash").draft.item).not.toBe("Pasalubong");
  });
});

describe("a name on the owner's other spending list", () => {
  it("moves the card to that list rather than reading it for another kind", () => {
    const bill = fitItem({ ...spend("internet"), category: "Spending" }, "", reference);
    expect(bill.draft).toMatchObject({ item: "Internet", category: "Bills" });
    expect(bill.note).toBe("Internet is one of your bills, so it is filed there.");
    const back = fitItem({ ...spend("Food"), category: "Subscriptions" }, "", reference);
    expect(back.draft).toMatchObject({ item: "Food", category: "Spending" });
  });
});
