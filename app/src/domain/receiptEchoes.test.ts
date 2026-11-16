/**
 * A receipt and a credit line's screen sent together (owner, 16 November
 * 2026): the peso sign read as a digit made a second, larger card; a
 * payment half under the menu bar came back one digit off and was offered
 * as new; and every row printed with a minus was refused, the same notice
 * three times. Every name and figure here is invented.
 */
import { describe, expect, it } from "vitest";

import { duplicatesOf } from "./duplicates";
import { emptyDraft, type Draft } from "./entry";
import { tidyReading } from "./ocrText";
import { readProposals, refusalWords, withoutSignEchoes, type Proposal } from "./proposal";
import { readReviewRowAsk } from "./reviewAsk";
import type { ReferenceLists, Transaction } from "./types";

const ASOF = "2026-11-16";
const reference = {
  wallets: ["Cash", "Wallet B"],
  savings: ["Bank C"],
  spendingTypes: [{ name: "Food", remark: "" }, { name: "Treat", remark: "" }],
  bills: [],
  subscriptions: [],
  revenueCategories: ["Pay"],
  credits: ["Line D"],
  onBehalf: [],
} as unknown as ReferenceLists;

describe("a row printed with a minus is read by its size", () => {
  it("a credit line's fees and a borrowing, each a card, the fees folded into the borrowing", () => {
    const read = readProposals(
      {
        proposals: [
          { flow: "Debt", debt: "Line D", debtEffect: "charge", amountText: "- ₱0.40", date: ASOF, description: "DST" },
          { flow: "Debt", debt: "Line D", debtEffect: "charge", amountText: "-₱35.50", amountPesos: -35.5, date: ASOF, description: "Service Fee" },
          { flow: "Debt", debt: "Line D", debtEffect: "draw", amountText: "- ₱500.00", toWallet: "Wallet B", date: ASOF, description: "Transferred money to My Wallet" },
        ],
      },
      reference,
      ASOF,
    );
    expect(read.refused).toEqual([]);
    expect(read.proposals).toHaveLength(1);
    expect(read.proposals[0]!.draft).toMatchObject({ flow: "Debt", debtEffect: "draw", item: "Line D", toWallet: "Wallet B", amount: 50_000, charges: 3_590 });
  });
  it("a row with truly no figure is still refused, and said once however many there are", () => {
    const read = readProposals({ proposals: [1, 2, 3].map(() => ({ flow: "Debt", debt: "Line D", debtEffect: "charge", amountText: "", date: ASOF })) }, reference, ASOF);
    expect(read.refused).toHaveLength(3);
    const said = refusalWords(read.refused);
    expect(said).toHaveLength(1);
    expect(said[0]).toMatch(/^3 rows, each for the same reason: A debt movement with no amount/);
    expect(refusalWords([{ sourceRef: "a", reason: "One." }, { sourceRef: "b", reason: "Two." }])).toEqual(["One.", "Two."]);
  });
});

describe("the peso sign read as a digit", () => {
  const card = (amount: number, item = "", description = ""): Proposal => ({
    draft: { ...emptyDraft(ASOF), flow: "Spending", category: "Spending", fromWallet: "Wallet B", item, description, amount },
    confidence: "medium",
    sourceRef: "r.jpg",
    adjustments: [],
  });
  it("a bold 7 read as a slash is a 7, only inside a figure after a currency mark", () => {
    expect(tidyReading("-P//5.00\nDINER 0042")).toBe("-₱775.00\nDINER 0042");
    expect(tidyReading("Total P 1,2/4.50 and 3/4 cup")).toBe("Total ₱1,274.50 and 3/4 cup");
    expect(tidyReading("Date 12/04/2026")).toBe("Date 12/04/2026");
  });
  it("the longer card is left out when the picture shows the shorter and not the longer", () => {
    const readings = [tidyReading("-P//5.00\nDINER 0042\nNov 16, 2026"), "Fee 0.40 Service 35.50 Wallet 500.00"];
    const { kept, echoes } = withoutSignEchoes([card(77_500, "Food", "Diner 0042"), card(577_500, "", "Paid via wallet")], readings);
    expect(kept.map((p) => p.draft.amount)).toEqual([77_500]);
    expect(echoes).toHaveLength(1);
    expect(echoes[0]!.reason).toContain("peso sign taken for a 5");
    expect(echoes[0]!.reason).toContain("If it was a second payment, type it.");
  });
  it("and kept whenever the paper does not settle it", () => {
    // Both shown: two real payments.
    expect(withoutSignEchoes([card(77_500), card(577_500)], ["₱775.00 ₱5,775.00 ₱1.00"]).kept).toHaveLength(2);
    // Neither shown: the reading proves nothing, so `notOnPaper` flags rather than drops.
    expect(withoutSignEchoes([card(77_500), card(577_500)], ["Fee 0.40"]).kept).toHaveLength(2);
    // Typed by the owner with the picture.
    expect(withoutSignEchoes([card(77_500), card(577_500)], ["₱775.00"], "also 5775 for the party").kept).toHaveLength(2);
    // Another account or another day is another payment.
    expect(withoutSignEchoes([card(77_500), { ...card(577_500), draft: { ...card(577_500).draft, fromWallet: "Cash" } }], ["₱775.00"]).kept).toHaveLength(2);
    // No reading at all.
    expect(withoutSignEchoes([card(77_500), card(577_500)], []).kept).toHaveLength(2);
  });
  it("through the whole reader, the echo is a notice and not a card", () => {
    const read = readProposals(
      {
        proposals: [
          { flow: "Spending", item: "Food", fromWallet: "Wallet B", amountPesos: 775, date: ASOF, description: "Diner 0042" },
          { flow: "Spending", fromWallet: "Wallet B", amountPesos: 5775, date: ASOF, description: "Paid via wallet" },
        ],
      },
      reference,
      ASOF,
      { readings: [tidyReading("-P//5.00\nDINER 0042"), "Fee 0.40\nService Fee 35.50\nMy Wallet 500.00"] },
    );
    expect(read.proposals.map((p) => p.draft.amount)).toEqual([77_500]);
    expect(read.refused.map((r) => r.reason).join(" ")).toContain("left out");
  });
});

describe("a figure one digit off a payment already saved", () => {
  const saved: Transaction = {
    id: "t-1", recordNumber: 900, date: "2026-11-14", type: "Debt", category: "Debt", item: "Line D", fromWallet: "Bank C", toWallet: "",
    description: "Paid amount due", amount: 310_540, fee: 0, total: 310_540, notes: "", status: "Paid",
  } as unknown as Transaction;
  const card: Draft = { ...emptyDraft("2026-11-14"), flow: "Debt", item: "Line D", fromWallet: "Bank C", amount: 370_540, debtEffect: "repay", status: "Paid" };
  it("read off a picture: said, with both figures and the row", () => {
    const found = duplicatesOf(card, [saved]);
    expect(found).toHaveLength(1);
    expect(found[0]!.row.recordNumber).toBe(900);
    expect(found[0]!.certainty).toBe("close");
    expect(found[0]!.evidence[0]).toBe("₱3,705.40 here, ₱3,105.40 there: one digit apart, as a figure half hidden or misread on a picture is.");
  });
  it("never when typed, round, two digits apart, through another account, or days away", () => {
    expect(duplicatesOf(card, [saved], { typed: true })).toEqual([]);
    expect(duplicatesOf({ ...card, amount: 370_000 }, [{ ...saved, amount: 310_000, total: 310_000 }])).toEqual([]);
    expect(duplicatesOf({ ...card, amount: 370_541 }, [saved])).toEqual([]);
    expect(duplicatesOf({ ...card, fromWallet: "Wallet B" }, [saved])).toEqual([]);
    expect(duplicatesOf({ ...card, date: "2026-11-10" }, [saved])).toEqual([]);
    expect(duplicatesOf({ ...card, item: "Other line" }, [{ ...saved, description: "" }])).toEqual([]);
  });
});

describe("a bare no before a figure is not a record number", () => {
  it.each(["There's no 5650 there check it again", "no 5650 there", "there is no 5650, check"])("%s", (said) => {
    expect(readReviewRowAsk(said)).toBeNull();
  });
  it("and a number named still is", () => {
    expect(readReviewRowAsk("check no. 3831")).toEqual({ recordNumber: 3831, keep: false });
    expect(readReviewRowAsk("why is no #3831 flagged")).toEqual({ recordNumber: 3831, keep: false });
    expect(readReviewRowAsk("check entry 3831")).toEqual({ recordNumber: 3831, keep: false });
  });
});
