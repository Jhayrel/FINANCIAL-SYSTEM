/**
 * The paper reader is trained, not written: it learns from examples, and
 * the owner's own examples teach it more.
 *
 * The owner, 5 October 2026: "Dont hard code those please train them".
 * Every paper here is invented.
 */

import { describe, expect, it } from "vitest";

import { fileAsTaught, type ExtractResult } from "../data/aiClient";
import { emptyDraft } from "./entry";
import { readNotPaid, SURE_UNPAID } from "./notPaid";
import { classifyPaper, trainPapers, UNPAID } from "./paperKind";
import { maskNumbers, nearestTaught, paperEvent, papersFrom, taughtFromCard, trainingFrom, wantsTraining, type TaughtPaper } from "./paperMemory";
import { PAPER_SEED } from "./paperSeed";

const model = trainPapers(PAPER_SEED);

describe("the starter examples", () => {
  it("tell kinds apart on papers they never saw", () => {
    const unseen: [string, string][] = [
      ["receipt", "GOLDEN BAKERY\nSales Invoice\nPandesal 10 pcs 50.00\nTotal 50.00\nCash 100.00 Change 50.00\nThank you"],
      ["slip", "UNIONBANK\nSALE\nCARD NO **** 7781\nAPPR CODE 400221\nTRACE NO 000112\nAMOUNT PHP 950.00\nAPPROVED\nCUSTOMER COPY"],
      ["wallet", "Sent via GCash\nExpress Send\nAmount 250.00\nTotal Amount Sent 250.00\nRef No. 9988 776 655443"],
      ["bill", "CITY WATERWORKS\nWATER BILL\nBilling period Sep 2026\nCurrent bill 380.00\nTotal amount due 380.00\nDue date 10/15/2026\nThis is not a receipt"],
      ["assessment", "RIVERBEND COLLEGE\nASSESSMENT OF FEES\nTuition 4,000.00 Misc 900.00\nTotal assessment 4,900.00\nDownpayment 1,500.00\nAmount due 1,500.00"],
      ["checkout", "Checkout\nMerchandise Subtotal 799.00\nShipping Subtotal 40.00\nTotal Payment 839.00\nPlace Order"],
      ["quote", "QUOTATION\nAircon cleaning 1,200.00\nTotal quoted amount 1,200.00\nValid for 30 days"],
    ];
    for (const [kind, text] of unseen) expect(classifyPaper(text, model).kind, text.split("\n")[0]).toBe(kind);
  });

  it("are right on most of their own, each held out in turn", () => {
    let right = 0;
    PAPER_SEED.forEach((ex, i) => {
      const without = trainPapers(PAPER_SEED.filter((_, j) => j !== i));
      if (classifyPaper(ex.text, without).kind === ex.kind) right += 1;
    });
    expect(right / PAPER_SEED.length).toBeGreaterThanOrEqual(0.85);
  });

  it("never hold back a paid paper, each held out in turn: losing an entry is worse than asking", () => {
    for (const [i, ex] of PAPER_SEED.entries()) {
      if (UNPAID.has(ex.kind)) continue;
      const without = trainPapers(PAPER_SEED.filter((_, j) => j !== i));
      const guess = classifyPaper(ex.text, without);
      expect(UNPAID.has(guess.kind) && guess.p >= SURE_UNPAID, ex.text.split("\n")[0]).toBe(false);
    }
  });
});

describe("what the owner teaches", () => {
  const at = "2026-10-05T08:00:00.000Z";
  // A paper the starter set reads as a receipt: a parking notice that is really a fine still to pay.
  const notice = "CITY PARKING OFFICE\nNOTICE OF VIOLATION\nPlate ABC 123\nFine 500.00\nSettle at the city treasurer";
  const taughtNotice: TaughtPaper = { at, kind: "bill", text: notice, paid: false, amount: 50000, flow: "Spending", category: "Bills", item: "", fromWallet: "", toWallet: "", person: "", description: "Parking fine" };

  it("makes a paper like it the kind they taught", () => {
    expect(readNotPaid([notice.replace("ABC 123", "XYZ 789")])).toBeNull();
    const taught = trainingFrom([taughtNotice]);
    expect(readNotPaid([notice.replace("ABC 123", "XYZ 789")], taught)).toMatchObject({ kind: "bill", amount: 50000 });
  });

  it("finds its amount on the line their example carried it on", () => {
    const next = "CITY PARKING OFFICE\nNOTICE OF VIOLATION\nPlate XYZ 789\nTowing 300.00\nFine 750.00\nSettle at the city treasurer";
    expect(readNotPaid([next], trainingFrom([taughtNotice]))?.amount).toBe(75000);
  });

  it("is kept in their record and read back, numbers masked", () => {
    const draft = { ...emptyDraft("2026-10-05"), flow: "Spending" as const, category: "Spending" as const, item: "Food", amount: 20800, fromWallet: "Maya", description: "Lunch" };
    const event = paperEvent(taughtFromCard("receipt", "NOODLE BAR\nAcct 0917 555 1234 567\nTotal 208.00", draft, true));
    expect(event).toMatchObject({ action: "accepted", where: "add", field: "paper" });
    expect(event.text).not.toMatch(/0917 555 1234/);
    expect((event.entry ?? "").length).toBeLessThanOrEqual(300);
    const [back] = papersFrom([event]);
    expect(back).toMatchObject({ kind: "receipt", paid: true, amount: 20800, item: "Food", fromWallet: "Maya", description: "Lunch" });
    expect(maskNumbers("Ref No. 7045 4900 4209 0")).toBe("Ref No. #######");
  });

  it("files the next paper like it the way they filed this one, where the model left it open", () => {
    const lunch = "NOODLE BAR\nSales invoice\nBeef noodles 180.00\nIced tea 45.00\nTotal 225.00\nCash 300.00 Change 75.00";
    const taught: TaughtPaper = { at, kind: "receipt", text: lunch, paid: true, amount: 22500, flow: "Spending", category: "Spending", item: "Food", fromWallet: "Cash", toWallet: "", person: "", description: "Noodle Bar" };
    const result: ExtractResult = {
      proposals: [{ draft: { ...emptyDraft("2026-10-05"), flow: "Spending", category: "Spending", amount: 19000, description: "Noodle Bar" }, confidence: "high", sourceRef: "image 1", adjustments: [] }],
      refused: [],
      source: "model",
      readings: [lunch.replace("225.00", "190.00"), ""],
    };
    const filed = fileAsTaught(result, trainingFrom([taught]));
    expect(filed.proposals[0]?.draft).toMatchObject({ item: "Food", fromWallet: "Cash" });
    expect(filed.proposals[0]?.adjustments.at(-1)).toBe("Filed as Food, from Cash, as you taught from a paper like this one.");
  });

  it("finds nothing alike in an unrelated paper", () => {
    expect(nearestTaught("Sent via GCash Amount 100.00", [taughtNotice])).toBeNull();
  });

  it("knows a message that asks to train from one that asks to add", () => {
    for (const said of ["Training receipts. Dont add this just train", "train", "for training only", "don't save these"]) expect(wantsTraining(said), said).toBe(true);
    for (const said of ["add these", "paid this from cash", "", "what is this?"]) expect(wantsTraining(said), said).toBe(false);
  });
});
