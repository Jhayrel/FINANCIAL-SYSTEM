/**
 * One row here, several on the statement: 2 October 2026.
 *
 * A wallet history listed three load purchases on one day, ₱204.00, ₱102.00
 * and ₱102.00, which the owner had logged as one ₱408.00 row. Each was
 * compared alone, matched nothing, and all three were offered and added
 * again; the owner then said what the wallet really held, and the card on
 * screen took that as its amount. Rows and figures here are invented in the
 * same shape.
 */
import { describe, expect, it } from "vitest";

import { amend, statesBalance } from "./capture";
import { inLedgerOrNot } from "./checkPicture";
import { duplicateHeadline, togetherAsOne } from "./duplicates";
import { emptyDraft, type Draft } from "./entry";
import { investigate, investigationWords, linesFromDrafts } from "./investigate";
import { readInvestigateAsk } from "./investigateAsk";
import type { ReferenceLists, Transaction } from "./types";

let n = 3000;
const row = (over: Partial<Transaction>): Transaction => {
  n += 1;
  return {
    id: `t-${n}`,
    recordNumber: n,
    date: "2026-10-02",
    type: "Spending",
    fromWallet: "Wallet A",
    toWallet: "",
    category: "Spending",
    item: "Online Buy",
    description: "Buy load",
    amount: 0,
    fee: 0,
    total: 0,
    notes: "",
    status: "Paid",
    ...over,
  };
};
const spent = (date: string, amount: number, description = "Shop purchase"): Draft => ({
  ...emptyDraft(date),
  flow: "Spending",
  category: "Spending",
  fromWallet: "Wallet A",
  item: "Unknown",
  description,
  amount,
  status: "Paid",
});

const opening = row({ date: "2026-09-20", type: "Revenue", fromWallet: "", toWallet: "Wallet A", category: "Revenue", item: "Allowance", description: "Allowance", amount: 100_000, total: 100_000 });
const asOne = row({ amount: 40_800, total: 40_800 });
const sent = row({ date: "2026-09-30", type: "Transfer", toWallet: "", category: "Transfer", item: "", description: "Sent to a friend", amount: 57_100, total: 57_100 });
const ledger = [opening, asOne, sent];

// The picture: today's ₱100.00, yesterday's ₱100.00, the three that are one row, and the ₱571.00 sent.
const picture = [spent("2026-10-03", 10_000), spent("2026-10-02", 10_000), spent("2026-10-02", 20_400), spent("2026-10-02", 10_200), spent("2026-10-02", 10_200), { ...spent("2026-10-01", 57_100, "Sent via QR"), flow: "Transfer" as const, category: "Transfer" as const, item: "" }];

describe("several picture rows that are one row here", () => {
  it("are found together, and only the two new ones are offered", () => {
    const verdict = inLedgerOrNot(picture, ledger);
    expect(verdict.missing).toEqual([0, 1]);
    expect(verdict.words).toContain(`₱204.00, ₱102.00 and ₱102.00 Shop purchase, Oct 2: together #${asOne.recordNumber}, ₱408.00 as one row`);
    expect(verdict.words).toContain(`#${sent.recordNumber}`);
  });

  it("each card says which row, and which other cards make it up", () => {
    const together = togetherAsOne(picture, ledger, (i) => i === 5);
    expect([...together.keys()].sort()).toEqual([2, 3, 4]);
    expect(duplicateHeadline(together.get(2)!)).toBe(`This and the ₱102.00 and ₱102.00 cards are #${asOne.recordNumber}, already in the ledger as one row.`);
  });

  it("never by a coincidence of two cards on another account or day", () => {
    const elsewhere = [spent("2026-10-02", 20_400), { ...spent("2026-10-02", 20_400), fromWallet: "Wallet B" }];
    expect(togetherAsOne(elsewhere, ledger).size).toBe(0);
    const later = [spent("2026-10-06", 20_400), spent("2026-10-06", 20_400)];
    expect(togetherAsOne(later, ledger).size).toBe(0);
  });
});

describe("finding the difference after they were added again", () => {
  // The three cards were added: two of them repeat part of the one row.
  const again = [row({ description: "Shop purchase", item: "Unknown", amount: 10_000, total: 10_000 }), row({ description: "Shop purchase", item: "Unknown", amount: 20_400, total: 20_400 }), row({ description: "Shop purchase", item: "Unknown", amount: 10_200, total: 10_200 })];
  const elsewhere = row({ date: "2026-10-01", type: "Revenue", fromWallet: "", toWallet: "Wallet A", category: "Revenue", item: "Random", description: "Cashback", amount: 2_082, total: 2_082 });
  const transactions = [...ledger, ...again, elsewhere];
  // What the wallet really holds: the ledger before the copies, less the two ₱100.00 purchases.
  const actual = 100_000 - 40_800 - 57_100 + 2_082 - 20_000;

  it("names the copies, the missing purchase on its own day, and nothing more", () => {
    const result = investigate({ transactions, account: "Wallet A", actual, asOf: "2026-10-03", statement: linesFromDrafts(picture, "Wallet A") });
    expect(result.unexplained).toBe(0);
    expect(result.found.map((c) => c.kind).sort()).toEqual(["inside", "inside", "missing"]);
    const missing = result.found.find((c) => c.kind === "missing");
    expect(missing?.kind === "missing" && missing.line.date).toBe("2026-10-03");
    const words = investigationWords(result).lines.join("\n");
    expect(words).toContain(`is already part of #${asOne.recordNumber}`);
    // The cashback is not on the picture, and the difference does not need it.
    expect(result.aside.map((c) => ("row" in c ? c.row.id : ""))).toEqual([elsewhere.id]);
    expect(words).toContain("most likely past the edge of the picture");
  });

  it("matches a row dated a day before the statement's first", () => {
    const result = investigate({ transactions, account: "Wallet A", actual, asOf: "2026-10-03", statement: linesFromDrafts(picture, "Wallet A") });
    expect(result.found.some((c) => c.kind === "missing" && c.line.amount === -57_100)).toBe(false);
  });
});

describe("what the wallet really holds, said in the chat", () => {
  const reference = { wallets: ["Wallet A"], savings: [], bills: [], subscriptions: [], revenueCategories: [], spendingTypes: [{ name: "Online Buy", remark: "" }] } as ReferenceLists;

  it("is never a card's new amount", () => {
    expect(statesBalance("wait my original balance is 176.56")).toBe(true);
    expect(amend(spent("2026-10-02", 10_200), "wait my original balance is 176.56", reference, "2026-10-03")).toBeNull();
    expect(amend(spent("2026-10-02", 10_200), "make it 120", reference, "2026-10-03")?.draft.amount).toBe(12_000);
    expect(statesBalance("I paid my balance of 500")).toBe(false);
  });

  it("is a difference to find on the account the picture was about", () => {
    const ask = readInvestigateAsk("wait my original balance is 176.56", ["Wallet A", "Wallet B"], () => 0, "2026-10-03", "Wallet A");
    expect(ask).toEqual({ account: "Wallet A", actual: 17_656, gap: null });
    expect(readInvestigateAsk("wait my original balance is 176.56", ["Wallet A"], () => 0, "2026-10-03")).toBeNull();
  });
});
