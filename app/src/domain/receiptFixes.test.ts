/**
 * Receipts and pasted confirmations (owner, 12 to 15 November 2026): a send
 * whose fee was taken for its amount, a withdrawal with the machine's fee
 * inside its one figure, a balance read as a movement, and a card's question
 * said plainly. Every name and figure here is invented.
 */
import { describe, expect, it } from "vitest";

import { rowWords } from "./cardQuestions";
import { emptyDraft } from "./entry";
import { checkAgainstReadings, readProposals, type Proposal } from "./proposal";
import { readEntry, splitEntries } from "./readEntry";
import type { ReferenceLists } from "./types";

const ASOF = "2026-11-15";
const reference = { wallets: ["Cash", "Wallet B"], savings: [], spendingTypes: [{ name: "Fare", remark: "" }], bills: [], subscriptions: [], revenueCategories: ["Pay"], credits: [], onBehalf: [] } as unknown as ReferenceLists;

describe("a figure the reading already accounts for is not a second reading of the amount", () => {
  const sent: Proposal = { draft: { ...emptyDraft(ASOF), flow: "Transfer", category: "Transfer", fromWallet: "Wallet B", amount: 150_000, fee: 1_500 }, confidence: "high", sourceRef: "a.jpg", adjustments: [] };
  it("the fee is never taken for the amount with its point moved", () => {
    // The device's own reading of the picture found the fee and missed the amount.
    const out = checkAgainstReadings([sent], ["Fee 15.00 Sent via QR"]);
    expect(out[0]!.draft.amount).toBe(150_000);
    expect(out[0]!.adjustments.join(" ")).not.toContain("Using");
  });
  it("and a real slip of the point is still put right", () => {
    const out = checkAgainstReadings([{ ...sent, draft: { ...sent.draft, fee: 0 } }], ["Amount 1,500.00"]);
    expect(out[0]!.draft.amount).toBe(150_000);
    const slipped = checkAgainstReadings([{ ...sent, draft: { ...sent.draft, amount: 1_500_000, fee: 0 } }], ["Amount 15,000.00"]);
    expect(slipped[0]!.draft.amount).toBe(1_500_000);
  });
});

describe("a withdrawal's one figure, cash and the machine's fee together", () => {
  const sms = "Success! You withdrew PHP3018.00 from Wallet B account 512345******0001 at BANCNET ATM. Balance: PHP640.25. Ref. No. 000000012345";
  it("pasted: one entry, the balance after it never a movement", () => {
    const parts = splitEntries(sms);
    expect(parts).toHaveLength(1);
    const r = readEntry(parts[0]!, [], reference, ASOF);
    expect(r.draft).toMatchObject({ flow: "Transfer", fromWallet: "Wallet B", toWallet: "Cash", amount: 300_000, fee: 1_800, status: "Withdrawn" });
    expect(r.because.join(" ")).toContain("₱3,000.00 of cash and a ₱18.00 machine fee");
  });
  it("a fee said, or whole hundreds, is left as it is", () => {
    expect(readEntry("withdrew 3000 from wallet b 18 fee", [], reference, ASOF).draft).toMatchObject({ amount: 300_000, fee: 1_800 });
    expect(readEntry("withdrew 3000 from wallet b", [], reference, ASOF).draft).toMatchObject({ amount: 300_000, fee: 0 });
  });
  it("read off a receipt by the model: the same split, whether or not it gave the fee", () => {
    const both = readProposals({ proposals: [{ flow: "Transfer", fromWallet: "Wallet B", toWallet: "Cash", amountPesos: 3018, fee: 18, date: ASOF, description: "Withdrawal from an ATM", status: "Withdrawn" }] }, reference, ASOF);
    expect(both.proposals[0]!.draft).toMatchObject({ amount: 300_000, fee: 1_800 });
    const none = readProposals({ proposals: [{ flow: "Transfer", fromWallet: "Wallet B", toWallet: "Cash", amountPesos: 3018, date: ASOF, description: "Withdrawal from an ATM" }] }, reference, ASOF);
    expect(none.proposals[0]!.draft).toMatchObject({ amount: 300_000, fee: 1_800 });
  });
});

describe("a card's question names the entry by what it was", () => {
  it("with no amount yet", () => {
    expect(rowWords({ ...emptyDraft(ASOF), flow: "Spending", description: "fare for classmate", amount: null })).toBe("Fare for classmate, 15 Nov");
    expect(rowWords({ ...emptyDraft(ASOF), flow: "Spending", description: "fare", amount: 2_600 })).toBe("₱26.00 out, fare, 15 Nov");
  });
});
