/**
 * "How much?" of a transfer out of an account, answered "all of it".
 *
 * The owner, 5 October 2026: "Transfer extra cash to cash" was asked how
 * much, "Check my balance and transfer it" went to the chat, and the card the
 * chat wrote warned "Extra Cash is savings" of an account kept as a reserve.
 * Every figure here is invented.
 */

import { describe, expect, it } from "vitest";

import { applyReply, saysAllOfIt } from "./capture";
import { pendingChoices } from "./cardQuestions";
import { checkDraft, emptyDraft, type Draft } from "./entry";
import type { ReferenceLists, Transaction } from "./types";

const reference: ReferenceLists = {
  wallets: ["Cash", "Maya"],
  savings: ["Extra Cash", "Laptop Fund"],
  accountKinds: { Cash: "spending", Maya: "spending", "Extra Cash": "reserve", "Laptop Fund": "goal" },
  bills: [],
  subscriptions: [],
  revenueCategories: ["Allowance"],
  spendingTypes: [{ name: "Food", remark: "" }],
};

const into = (wallet: string, amount: number): Transaction => ({
  id: `in-${wallet}`, recordNumber: 1, date: "2026-10-01", type: "Revenue", fromWallet: "", toWallet: wallet, category: "Revenue", item: "Allowance",
  description: "", amount, fee: 0, total: amount, notes: "", status: "Received",
});
const ledger = [into("Extra Cash", 100000), into("Cash", 5000)];

const transfer: Draft = { ...emptyDraft("2026-10-05"), flow: "Transfer", category: "Transfer", fromWallet: "Extra Cash", toWallet: "Cash" };

describe("all of it", () => {
  it("is said many ways, never with a figure", () => {
    for (const said of ["all of it", "All", "everything", "lahat", "Check my balance and transfer it", "the whole balance", "whatever is left"]) {
      expect(saysAllOfIt(said), said).toBe(true);
    }
    for (const said of ["all 500", "500", "half", "it was yesterday"]) expect(saysAllOfIt(said), said).toBe(false);
  });

  it("is what the account holds, less the fee", () => {
    expect(applyReply(transfer, "amount", "all of it", reference, ledger)?.amount).toBe(100000);
    expect(applyReply(transfer, "amount", "Check my balance and transfer it", reference, ledger)?.amount).toBe(100000);
    expect(applyReply({ ...transfer, fee: 1500 }, "amount", "everything", reference, ledger)?.amount).toBe(98500);
  });

  it("is nothing from an empty account, or with no account named", () => {
    expect(applyReply({ ...transfer, fromWallet: "Laptop Fund" }, "amount", "all of it", reference, ledger)).toBeNull();
    expect(applyReply({ ...transfer, fromWallet: "" }, "amount", "all of it", reference, ledger)).toBeNull();
  });

  it("is offered under the question, and the offer reads back as its figure", () => {
    const [offered] = pendingChoices(transfer, "amount", reference, ledger);
    expect(offered).toBe("All of it (₱1,000.00)");
    expect(applyReply(transfer, "amount", offered ?? "", reference, ledger)?.amount).toBe(100000);
    // Spending is not offered all of an account.
    expect(pendingChoices({ ...transfer, flow: "Spending", category: "Spending", toWallet: "" }, "amount", reference, ledger)).toEqual([]);
  });
});

describe("taking money out of an account set aside", () => {
  const warning = (d: Draft): string | undefined => checkDraft(d, ledger, reference, [], "2026-10-05").warnings.find((w) => /Taking/.test(w.message))?.message;

  it("names it as Settings does: a reserve, a goal, or savings", () => {
    expect(warning({ ...transfer, amount: 50000 })).toBe("Extra Cash is a reserve, set aside. Taking ₱500.00 out of it?");
    expect(warning({ ...transfer, fromWallet: "Laptop Fund", amount: 50000 })).toBe("Laptop Fund is a goal. Taking ₱500.00 out of it?");
  });
});
