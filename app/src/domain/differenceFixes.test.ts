/**
 * Find the difference, and then fix it with one press. The owner, 9
 * November 2026: "find the difference somethimes its bad at helping fix it".
 * Each finding below used to be "Check it" beside a row, with the right
 * figure left to work out and type. Now each comes with the edit, worked out
 * to the centavo, as a card; nothing changes until it is pressed.
 *
 * Every figure here is invented.
 */
import { describe, expect, it } from "vitest";

import { walletBalance } from "./balances";
import { feeFixes, fixForClue, investigate, investigationWords, type Clue } from "./investigate";
import type { Transaction } from "./types";

let n = 0;
const row = (over: Partial<Transaction>): Transaction => {
  n += 1;
  const amount = over.amount ?? 0;
  const fee = over.fee ?? 0;
  return {
    id: `r${n}`,
    recordNumber: n,
    date: "2026-11-01",
    type: "Spending",
    fromWallet: "Maya",
    toWallet: "",
    category: "Spending",
    item: "Food",
    description: "",
    notes: "",
    status: "Paid",
    ...over,
    amount,
    fee,
    total: amount + fee,
  };
};
const spend = (date: string, amount: number, item: string, wallet = "Maya", description = "") => row({ date, amount, item, fromWallet: wallet, description });
const income = (date: string, amount: number, item: string, wallet = "Maya") =>
  row({ date, type: "Revenue", category: "Revenue", fromWallet: "", toWallet: wallet, amount, item, status: "Received" });

/** Applying the edits the cards hold, as pressing them would. */
const applied = (rows: readonly Transaction[], edits: readonly { before: Transaction; after: Transaction }[]): Transaction[] =>
  rows.map((t) => edits.find((e) => e.before.id === t.id)?.after ?? t);

describe("a figure saved wrong, put right from the statement", () => {
  const ledger = [income("2026-11-01", 500_000, "Allowance"), spend("2026-11-03", 15_000, "Food", "Maya", "jollibee")];

  it("spending: the statement's figure, with the fee kept, closes the difference", () => {
    // The statement shows ₱1,500.00 for the meal; it was saved as ₱150.00.
    const result = investigate({
      transactions: ledger,
      account: "Maya",
      actual: 350_000,
      asOf: "2026-11-05",
      statement: [
        { date: "2026-11-01", amount: 500_000, description: "Allowance" },
        { date: "2026-11-03", amount: -150_000, description: "Jollibee" },
      ],
    });
    const clue = result.found.find((c) => c.kind === "amount-differs")!;
    const fix = fixForClue(clue, "Maya")!;
    expect(fix.after.amount).toBe(150_000);
    expect(fix.after.total).toBe(150_000);
    expect(fix.why).toBe("The history shows ₱1,500.00 out on November 3, 2026.");
    expect(walletBalance(applied(ledger, [fix]), "Maya")).toBe(350_000);
  });

  it("income: the statement's figure", () => {
    const clue: Clue = { kind: "amount-differs", row: ledger[0]!, line: { date: "2026-11-01", amount: 550_000, description: "Allowance" }, explains: -50_000 };
    const fix = fixForClue(clue, "Maya")!;
    expect(fix.after.amount).toBe(550_000);
    expect(walletBalance(applied(ledger, [fix]), "Maya")).toBe(535_000);
  });

  it("a row whose fee alone is more than the statement's figure is left to be done by hand", () => {
    const t = row({ date: "2026-11-03", amount: 10_000, fee: 2_000, fromWallet: "Maya" });
    const clue: Clue = { kind: "amount-differs", row: t, line: { date: "2026-11-03", amount: -1_500, description: "" }, explains: 0 };
    expect(fixForClue(clue, "Maya")).toBeNull();
  });
});

describe("a withdrawal with the machine's fee inside its figure", () => {
  it("splits it: the cash in Amount and the fee in Fee, the account moving the same", () => {
    const ledger = [income("2026-11-01", 500_000, "Allowance"), row({ date: "2026-11-02", type: "Transfer", category: "Transfer", item: "", fromWallet: "Maya", toWallet: "Cash", amount: 101_800 })];
    const result = investigate({ transactions: ledger, account: "Cash", actual: 100_000, asOf: "2026-11-05" });
    const clue = result.possible.find((c) => c.kind === "fee-inside");
    expect(clue).toBeDefined();
    const fixes = feeFixes(clue!, "Cash");
    expect(fixes).toHaveLength(1);
    expect(fixes[0]!.after).toMatchObject({ amount: 100_000, fee: 1_800, total: 101_800 });
    const after = applied(ledger, fixes);
    expect(walletBalance(after, "Cash")).toBe(100_000);
    // Maya moves exactly as before.
    expect(walletBalance(after, "Maya")).toBe(walletBalance(ledger, "Maya"));
  });
});

describe("an estimate of spending that was too high", () => {
  it("lowers it by what is in hand beyond the ledger", () => {
    const ledger = [income("2026-10-25", 300_000, "Allowance", "Cash"), spend("2026-11-01", 200_000, "Unknown", "Cash", "Cash spending not written down at the time")];
    // The ledger says ₱1,000.00; ₱1,340.00 is in hand.
    const result = investigate({ transactions: ledger, account: "Cash", actual: 134_000, asOf: "2026-11-05" });
    const clue = result.possible.find((c) => c.kind === "estimate");
    expect(clue).toBeDefined();
    const fix = fixForClue(clue!, "Cash")!;
    expect(fix.after.amount).toBe(166_000);
    expect(walletBalance(applied(ledger, [fix]), "Cash")).toBe(134_000);
  });
});

describe("a row filed on another account", () => {
  it("moves it onto this one, closing the difference", () => {
    const ledger = [income("2026-11-01", 500_000, "Allowance", "Maya"), income("2026-11-01", 500_000, "Allowance", "Gcash"), spend("2026-11-03", 12_500, "Food", "Gcash")];
    // Maya really holds ₱125.00 less than the ledger says: the ₱125.00 meal left Maya, not Gcash.
    const result = investigate({ transactions: ledger, account: "Maya", actual: 487_500, asOf: "2026-11-05" });
    const clue = result.possible.find((c) => c.kind === "wrong-account");
    expect(clue).toBeDefined();
    const fix = fixForClue(clue!, "Maya")!;
    expect(fix.after.fromWallet).toBe("Maya");
    expect(fix.why).toBe("Filed on Gcash: if it was Maya, this moves it.");
    const after = applied(ledger, [fix]);
    expect(walletBalance(after, "Maya")).toBe(487_500);
    expect(walletBalance(after, "Gcash")).toBe(500_000);
  });

  it("never makes a transfer from an account into itself", () => {
    const t = row({ type: "Transfer", category: "Transfer", item: "", fromWallet: "Gcash", toWallet: "Maya", amount: 10_000 });
    expect(fixForClue({ kind: "wrong-account", row: t, other: "Gcash", explains: 10_000 }, "Maya")).toBeNull();
  });
});

describe("a copy is binned, not edited", () => {
  it("has no edit", () => {
    const a = spend("2026-11-03", 9_500, "Food");
    const b = spend("2026-11-03", 9_500, "Food");
    expect(fixForClue({ kind: "duplicate", row: b, twin: a, explains: -9_500 }, "Maya")).toBeNull();
  });
});

describe("a ledger short, with a doubled income beside it (the 19 October 2026 case, invented figures)", () => {
  it("does not count the copy toward the difference, and still offers the rest to add", () => {
    const ledger = [
      income("2026-10-01", 250_000, "Allowance", "Maya Bank"),
      income("2026-10-15", 31, "Bank interest", "Maya Bank"),
      income("2026-10-15", 31, "Bank interest", "Maya Bank"),
    ];
    const recorded = walletBalance(ledger, "Maya Bank");
    const result = investigate({ transactions: ledger, account: "Maya Bank", actual: recorded + 150, asOf: "2026-10-19" });
    expect(result.found).toHaveLength(0);
    expect(result.against?.[0]?.kind).toBe("duplicate");
    expect(result.unexplained).toBe(-150);
    expect(result.possible.some((c) => c.kind === "unrecorded" && c.direction === "in")).toBe(true);
    const words = investigationWords(result).lines.join(" ");
    expect(words).toMatch(/That makes the ledger too high, not too low, so it is not the difference/);
  });
});

describe("a balance told in the owner's own words is a difference to find", async () => {
  const { readInvestigateAsk } = await import("./investigateAsk");
  const { readBudgetMove } = await import("./incomeBudget");
  const accounts = ["Cash", "Maya", "Gcash", "Maya Bank (Personal savings)", "Extra Cash"];
  const held: Record<string, number> = { Cash: 120_000, Maya: 160_000, Gcash: 30_000, "Maya Bank (Personal savings)": 500_000, "Extra Cash": 0 };
  const read = (q: string) => readInvestigateAsk(q, accounts, (a: string) => held[a] ?? 0, "2026-11-09");

  it("reads them, with the account and what it really holds", () => {
    expect(read("my cash is 300 only why its different")).toEqual({ account: "Cash", actual: 30_000, gap: null });
    expect(read("nasa 300 lang ang cash ko")).toEqual({ account: "Cash", actual: 30_000, gap: null });
    expect(read("gcash 120 lang laman")).toEqual({ account: "Gcash", actual: 12_000, gap: null });
    expect(read("my gcash is 120 only")).toEqual({ account: "Gcash", actual: 12_000, gap: null });
    expect(read("bakit iba ang maya ko 1400 lang")).toEqual({ account: "Maya", actual: 140_000, gap: null });
    // Cash has no app of its own: "app says" is this one.
    expect(read("cash on hand 500 but app says 800")).toEqual({ account: "Cash", actual: 50_000, gap: null });
  });

  it("two figures and no account: the one the ledger holds names it, else which account is asked", () => {
    expect(read("my current balance in wallet is 1500 but here in the system its 1200 fix it")).toEqual({ account: "Cash", actual: 150_000, gap: null });
    expect(read("you dont get it. I said my current balance in wallet is 1500 but here in the system its 4500 fix it make it balance also just make it unknown spending")).toEqual({ account: "", actual: 150_000, gap: null });
    expect(read("my wallet is 1500 only")).toEqual({ account: "", actual: 150_000, gap: null });
  });

  it("is not a budget move, and questions and entries are left alone", () => {
    expect(readBudgetMove("you dont get it. I said my current balance in wallet is 1500 but here in the system its 4500 fix it make it balance")).toBeNull();
    expect(readBudgetMove("lower my budget to what my money keeps")).toEqual({ kind: "fit" });
    for (const q of ["where did I spend the most", "how much is in my maya", "gas 300 cash", "lunch 150 gcash"]) expect(read(q), q).toBeNull();
  });
});

describe("a saved entry put right in plain words (9 November 2026 sweep)", async () => {
  const { readEditAsk } = await import("./chatChanges");
  const { looksLikeAnswer } = await import("./cardQuestions");
  const reference = { wallets: ["Cash", "Maya", "Gcash"], savings: ["Maya Bank (Personal savings)"], spendingTypes: [{ name: "Travel", remark: "" }, { name: "Food", remark: "" }], bills: [], subscriptions: [], revenueCategories: ["Random"] } as never;

  it("\"was gcash not cash\" moves the row, found by the day and the item", () => {
    expect(readEditAsk("the travel on nov 8 was gcash not cash", reference, "2026-11-09")).toEqual({ target: "travel on nov 8", all: false, change: { wallet: { from: "Cash", to: "Gcash" } } });
    expect(readEditAsk("the food yesterday was gcash not cash", reference, "2026-11-09")?.change).toEqual({ wallet: { from: "Cash", to: "Gcash" } });
    expect(readEditAsk("travel nov 8 should be gcash", reference, "2026-11-09")?.change).toEqual({ wallet: { to: "Gcash" } });
  });

  it("new money said is not an edit", () => {
    expect(readEditAsk("lunch 150 gcash", reference, "2026-11-09")).toBeNull();
    expect(readEditAsk("it was gcash not maya credit", reference, "2026-11-09")).toBeNull();
  });

  it("a record named, or a command, is never the amount a waiting card asked for", () => {
    for (const q of ["put back #4000", "#4000", "restore #4000", "edit #3999 to 450", "move #3999 to gcash", "recover the deleted food"]) {
      expect(looksLikeAnswer(q, "amount"), q).toBe(false);
    }
    expect(looksLikeAnswer("450", "amount")).toBe(true);
    expect(looksLikeAnswer("4,000", "amount")).toBe(true);
  });
});
