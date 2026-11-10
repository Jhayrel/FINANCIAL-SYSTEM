/**
 * The owner, 10 November 2026: "help me why i spent this like always in a
 * bad way" became an entry at a usual amount, twice; "I also treated my
 * friend gym because he forgot his money. Just make it random" made two
 * PHP 0.00 cards; and "Today" and a figure, the answer to how much, changed the
 * kind and left the amount blank. Every name and figure here is invented.
 */
import { describe, expect, it } from "vitest";

import { answerCard, keepTheMoney } from "./cardQuestions";
import { emptyDraft, type Draft } from "./entry";
import { asideKind, sameAsBefore, withoutAside } from "./entryAside";
import { detectIntent, isAdvice } from "./intent";
import { readEntry, splitEntries } from "./readEntry";
import type { ReferenceLists, Transaction } from "./types";

const ASOF = "2026-11-10";
const KINDS = ["Snacks", "Random necessities", "Treat", "Fitness", "Fare"];
const reference = { wallets: ["Cash", "Wallet B"], savings: [], spendingTypes: KINDS.map((name) => ({ name, remark: name === "Fitness" ? "help yourself feel better" : "" })), bills: [], subscriptions: [], revenueCategories: ["Pay", "Random"], credits: [], onBehalf: [] } as unknown as ReferenceLists;
let n = 0;
const row = (item: string, amount: number, description = ""): Transaction =>
  ({ id: `a${(n += 1)}`, recordNumber: 100 + n, date: "2026-10-01", type: "Spending", category: "Spending", item, fromWallet: "Cash", toWallet: "", description, amount, fee: 0, total: amount, notes: "", status: "Done" }) as Transaction;
const history = [...[1, 2, 3, 4, 5].map(() => row("Fitness", 5000, "help me feel better")), row("Snacks", 3000)];

describe("asking why is never an entry", () => {
  it.each([
    "Also help me why i spent this like always in a bad way like ever since starting its bad",
    "help me why i spent this like always in a bad way",
    "i want to know why my snacks are so high",
    "bakit ang laki ng gastos ko",
    "what am i doing wrong with my money",
  ])("%s", (said) => {
    expect(isAdvice(said)).toBe(true);
    expect(detectIntent(said)).toBe("ask");
    expect(readEntry(said, history, reference, ASOF).worthOffering).toBe(false);
  });
  it("nor what something would do, or a rate", () => {
    for (const said of ["that would cover 65 pesos per session and 3x per week", "it would be 120 a session", "50 twice a week"]) {
      expect(detectIntent(said), said).toBe("ask");
      expect(readEntry(said, history, reference, ASOF).worthOffering, said).toBe(false);
    }
    expect(readEntry("I would like to add snacks 40", history, reference, ASOF).worthOffering).toBe(true);
  });
  it("and an entry is still one", () => {
    expect(readEntry("bought snacks 30", history, reference, ASOF).worthOffering).toBe(true);
    expect(isAdvice("paid fare 20")).toBe(false);
  });
});

describe("a sentence that only names the kind", () => {
  it("names one of their kinds, by name or its first word", () => {
    expect(asideKind("Just make it random", KINDS)).toBe("Random necessities");
    expect(asideKind("put it under treat", KINDS)).toBe("Treat");
    expect(asideKind("file this as fare.", KINDS)).toBe("Fare");
    expect(asideKind("snacks na lang", KINDS)).toBe("Snacks");
    expect(asideKind("make it 65", KINDS)).toBeNull();
    expect(asideKind("make it a good day", KINDS)).toBeNull();
  });
  it("is taken out of the message, so it is not an entry of its own", () => {
    const said = "I also treated my friend swim because he forgot his money. Just make it random";
    const { rest, kind } = withoutAside(said, KINDS);
    expect(kind).toBe("Random necessities");
    expect(rest).toBe("I also treated my friend swim because he forgot his money.");
    expect(splitEntries(rest)).toHaveLength(1);
    // A message that is only the instruction is left alone.
    expect(withoutAside("Just make it random", KINDS).kind).toBeNull();
  });
});

describe("also, with no figure, is the amount just before", () => {
  const before = { amount: 7500, item: "Fitness", description: "swim", said: "I paid 75 today swim", recordNumber: 4100 };
  it("when it is the same thing", () => {
    const same = sameAsBefore("I also treated my friend swim because he forgot his money.", before);
    expect(same).toEqual({ amount: 7500, because: "₱75.00, the same as the swim entry just before (#4100), since you said also. Change it if this one was different." });
  });
  it("never with a figure of its own, without also, or about something else", () => {
    expect(sameAsBefore("I also paid swim 100", before)).toBeNull();
    expect(sameAsBefore("I treated my friend swim", before)).toBeNull();
    expect(sameAsBefore("I also bought snacks", before)).toBeNull();
    expect(sameAsBefore("I also treated my friend swim", { ...before, amount: null })).toBeNull();
  });
});

describe("the answer to how much fills the amount", () => {
  const card: Draft = { ...emptyDraft(ASOF), flow: "Spending", category: "Spending", item: "Random necessities", fromWallet: "Cash", description: "Treated friend at the pool", amount: null };
  it("read on the device", () => {
    expect(answerCard(card, "amount", "Today 75 pesos", reference, history)?.amount).toBe(7500);
    expect(answerCard(card, "amount", "75 pesos", reference, history)?.amount).toBe(7500);
  });
  it("and a model's reading keeps it, but nothing else about the money", () => {
    expect(keepTheMoney(card, { ...card, item: "Treat", amount: 7500 }, "Today 75 pesos").amount).toBe(7500);
    expect(keepTheMoney({ ...card, amount: 5000 }, { ...card, amount: 7500 }, "75").amount).toBe(5000);
    expect(keepTheMoney(card, { ...card, amount: 9000 }, "75 pesos").amount).toBeNull();
  });
});
