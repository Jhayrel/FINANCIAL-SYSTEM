/**
 * E-wallet confirmation screens, read on the device and held to on the card.
 *
 * The owner, 4 October 2026, with a GCash "Sent via GCash" receipt: "Make
 * sure it knows this type of receipt etc. More powerful". The texts here are
 * shaped like what the device reads off such screens, misreadings included
 * (the "+" of +63 read as a peso sign, "279g (gCO2e)" read as "2799
 * (gcoze)"). Every name, number and reference is invented.
 */

import { describe, expect, it } from "vitest";

import { onDeviceWhenUnread, type ExtractResult } from "../data/aiClient";
import { checkWalletReceipts, readProposals, type Proposal } from "./proposal";
import { emptyDraft, type Draft } from "./entry";
import { readWalletReceipt, walletFor, walletReceiptNote, walletReceiptsIn } from "./walletReceipt";
import type { ReferenceLists } from "./types";

const reference: ReferenceLists = {
  wallets: ["Cash", "Gcash", "Maya"],
  savings: ["Maya Bank (Personal savings)", "PNB"],
  bills: ["Globe at Home Wifi", "Meralco"],
  subscriptions: ["Spotify"],
  revenueCategories: ["Allowance", "Random"],
  spendingTypes: [
    { name: "Food", remark: "Meals, snacks, drinks" },
    { name: "Load", remark: "Mobile load" },
    { name: "Online Buy", remark: "Online orders" },
  ],
  credits: ["Maya Credit"],
};

const ASOF = "2026-10-04";

// ── What the device reads off a GCash "Sent via GCash" screen ───────────────

/** The plain reading: the masked name is lost, a line of noise is added. */
const SENT_PLAIN = "Sent via GCash\nAmount 120.00\nTotal Amount Sent ₱120.00\nRef No. 1234 567 890123 Oct 04,2026 9:15 AM\n240 0040400400040 A0A0A0AA0A0AA0AAA0";
/** The raised reading: "+63" read as "₱63", "279g" as "2799", and the amount moved off its label. */
const SENT_RAISED =
  "₱63 O......1234\nSent via GCash\nAmount\nTotal Amount Sent ₱120.00\nRef No. 1234 567 890123 Oct 04, 2026 9:15 AM\nJi 2799 (gcoze)\nBy going digital, you reduce your carbon footprint from\ntransportation, paper, and plastic.";

const proposal = (over: Partial<Draft>, sourceRef = "image 1"): Proposal => ({
  draft: { ...emptyDraft(ASOF), ...over },
  confidence: "high",
  sourceRef,
  adjustments: [],
});

describe("reading the screen", () => {
  it("reads a GCash send: the amount, no fee, the day, the time and the reference", () => {
    const r = readWalletReceipt([SENT_RAISED, SENT_PLAIN])!;
    expect(r).toMatchObject({ app: "GCash", kind: "send", amount: 12000, fee: 0, total: 12000, date: "2026-10-04", time: "9:15 AM", ref: "1234 567 890123", confidence: "high" });
  });

  it("names what looks like money and is not", () => {
    const r = readWalletReceipt([SENT_RAISED, SENT_PLAIN])!;
    expect(r.notMoney.join(" | ")).toMatch(/reference number 1234 567 890123/);
    expect(r.notMoney.join(" | ")).toMatch(/phone number/);
    expect(r.notMoney.join(" | ")).toMatch(/carbon figure/);
    // The phone's "63", the carbon "2799" and "279", the reference's groups.
    for (const c of [6300, 279900, 27900, 123400]) expect(r.notMoneyFigures).toContain(c);
    expect(r.notMoneyFigures).not.toContain(12000);
  });

  it("tells the model what it is, in one proposal, from the wallet that printed it", () => {
    const r = readWalletReceipt([SENT_RAISED, SENT_PLAIN])!;
    expect(walletFor(r.app, reference)).toBe("Gcash");
    const note = walletReceiptNote(r, "Gcash");
    expect(note).toContain("flow Transfer with toWallet empty");
    expect(note).toContain("amountPesos 120, feePesos 0, dated 2026-10-04 at 9:15 AM");
    expect(note).toContain("Not amounts, never rows");
  });

  it("reads a bank transfer with its fee", () => {
    const text = "Bank Transfer\nSent via InstaPay\nBDO Unibank\nAccount Name JUAN DELA CRUZ\nAccount Number ••••••5678\nAmount 1,000.00\nTransfer Fee 15.00\nTotal Amount ₱1,015.00\nRef No. 9876 543 210987\nOct 2, 2026 6:05 PM";
    expect(readWalletReceipt([text])).toMatchObject({ app: "", kind: "bank", amount: 100000, fee: 1500, total: 101500, date: "2026-10-02", party: "JUAN DELA CRUZ" });
  });

  it("reads a Maya send with the fee printed as free and the figure under its heading", () => {
    const text = "Maya\nSent money\n₱500.00\nto PEDRO S.\n+63 917 ••• 4567\nFee Free\nReference ID 5A1B 2C3D 4E5F\nOct 3, 2026, 7:15 PM";
    expect(readWalletReceipt([text])).toMatchObject({ app: "Maya", kind: "send", amount: 50000, fee: 0, date: "2026-10-03", party: "PEDRO S." });
    expect(walletFor("Maya", reference)).toBe("Maya");
  });

  it("reads a bill, load, a QR payment and money received", () => {
    const bill = "GCash\nBills Payment\nGLOBE TELECOM\nAccount Number 1234567890\nAmount 1,299.00\nConvenience Fee 0.00\nTotal Amount ₱1,299.00\nRef No. 1111 222 333444\nOct 1, 2026 8:00 PM";
    expect(readWalletReceipt([bill])).toMatchObject({ kind: "bills", amount: 129900, fee: 0, party: "GLOBE TELECOM" });
    const load = "GCash\nBuy Load\nRegular Load\n+63 917 ••• 4567\nAmount 50.00\nTotal Amount Paid ₱50.00\nRef No. 2222 333 444555\nOct 1, 2026 9:00 AM";
    expect(readWalletReceipt([load])).toMatchObject({ kind: "load", amount: 5000 });
    const qr = "GCash\nPaid via QR Ph\nMerchant: SARI SARI STORE\nAmount ₱85.00\nRef No. 3333 444 555666\nOct 4, 2026 12:10 PM";
    expect(readWalletReceipt([qr])).toMatchObject({ kind: "pay", amount: 8500, party: "SARI SARI STORE" });
    const received = "GCash\nYou received\n₱1,000.00\nfrom MARIA S.\nRef No. 4444 555 666777\nOct 4, 2026 3:00 PM";
    expect(readWalletReceipt([received])).toMatchObject({ kind: "received", amount: 100000, party: "MARIA S." });
  });

  it("reads the text message form, leaving the balance after it out", () => {
    const sms = "You have sent PHP 100.00 to JUAN D. on 10-04-2026 1:30 PM with MSG: . Your new balance is PHP 950.00. Ref. No. 1234567890123.";
    const r = readWalletReceipt([sms])!;
    expect(r).toMatchObject({ kind: "send", amount: 10000, date: "2026-10-04" });
    expect(r.notMoneyFigures).toContain(95000);
  });

  it("leaves a history list, a shop receipt and an ATM slip to their own readers", () => {
    const list = Array.from({ length: 8 }, (_, i) => `Sent money to JUAN D. Oct ${i + 1}, 2026 -₱${100 + i}.00`).join("\n");
    expect(readWalletReceipt([list])).toBeNull();
    expect(readWalletReceipt(["MINI STOP\nVATable Sales 97.32\nVAT 11.68\nTOTAL 109.00\nCASH 200.00\nCHANGE 91.00\nPaid via GCash"])).toBeNull();
    expect(readWalletReceipt(["CASH WITHDRAWAL 1,000.00\nATM FEE 18.00\nTERMINAL ID 1234"])).toBeNull();
  });

  it("finds each screen once across its two readings", () => {
    expect(walletReceiptsIn([SENT_PLAIN, SENT_RAISED])).toHaveLength(1);
  });
});

describe("holding the card to the screen", () => {
  const r = readWalletReceipt([SENT_RAISED, SENT_PLAIN])!;

  it("makes money sent to a person a transfer out of Gcash, with the screen's day", () => {
    const [card] = checkWalletReceipts([proposal({ flow: "Spending", category: "Spending", item: "", amount: 12000, fromWallet: "Gcash", date: ASOF })], [r], reference, ASOF);
    expect(card?.draft).toMatchObject({ flow: "Transfer", fromWallet: "Gcash", toWallet: "", sentOut: true, amount: 12000, fee: 0, date: "2026-10-04", status: "Transferred", description: "Sent via GCash", notes: "9:15 AM, ref 1234 567 890123" });
    expect(card?.adjustments.join(" ")).toContain("Money Send");
  });

  it("puts a figure read off the phone, the reference or the carbon line back to the amount", () => {
    for (const wrong of [6300, 279900, 123400]) {
      const [card, ...rest] = checkWalletReceipts([proposal({ flow: "Transfer", amount: wrong, fromWallet: "Gcash" })], [r], reference, ASOF);
      expect(rest).toEqual([]);
      expect(card?.draft.amount).toBe(12000);
      expect(card?.adjustments.join(" ")).toContain("not money on this screen");
    }
  });

  it("makes one card of the amount and the carbon figure read as two", () => {
    const out = checkWalletReceipts(
      [proposal({ flow: "Transfer", amount: 12000, fromWallet: "Gcash" }), proposal({ flow: "Spending", amount: 27900, fromWallet: "Gcash" })],
      [r],
      reference,
      ASOF,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.draft.amount).toBe(12000);
  });

  it("keeps what the owner said it paid for", () => {
    const [card] = checkWalletReceipts([proposal({ flow: "Spending", category: "Spending", item: "Food", amount: 12000, description: "Lunch for the group" })], [r], reference, ASOF);
    expect(card?.draft).toMatchObject({ flow: "Spending", item: "Food", fromWallet: "Gcash", description: "Lunch for the group", date: "2026-10-04" });
  });

  it("keeps a send to one of their own accounts a transfer to it", () => {
    const [card] = checkWalletReceipts([proposal({ flow: "Transfer", amount: 12000, fromWallet: "Gcash", toWallet: "Maya" })], [r], reference, ASOF);
    expect(card?.draft).toMatchObject({ flow: "Transfer", toWallet: "Maya" });
    expect(card?.draft.sentOut).toBeUndefined();
  });

  it("never books money received as spending, and files a bill as the bill", () => {
    const received = readWalletReceipt(["GCash\nYou received\n₱1,000.00\nfrom MARIA S.\nRef No. 4444 555 666777\nOct 4, 2026 3:00 PM"])!;
    const [inCard] = checkWalletReceipts([proposal({ flow: "Spending", amount: 100000, fromWallet: "Gcash" })], [received], reference, ASOF);
    expect(inCard?.draft).toMatchObject({ flow: "Revenue", toWallet: "Gcash", fromWallet: "", item: "" });
    const bill = readWalletReceipt(["GCash\nBills Payment\nGLOBE TELECOM\nAmount 1,299.00\nTotal Amount ₱1,299.00\nRef No. 1111 222 333444\nOct 1, 2026 8:00 PM"])!;
    const [billCard] = checkWalletReceipts([proposal({ flow: "Transfer", amount: 129900 })], [bill], reference, ASOF);
    expect(billCard?.draft).toMatchObject({ flow: "Spending", category: "Bills", item: "Globe at Home Wifi", fromWallet: "Gcash", date: "2026-10-01" });
  });

  it("makes the card on its own when the model made none", () => {
    const { proposals } = readProposals([], reference, ASOF, { walletReceipts: [r] });
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.draft).toMatchObject({ flow: "Transfer", fromWallet: "Gcash", amount: 12000, date: "2026-10-04" });
  });
});

describe("with no model at all", () => {
  it("still gives the card, and says it was read on this device", () => {
    const offline: ExtractResult = { proposals: [], refused: [], source: "offline", reason: "Could not reach the AI endpoint.", readings: [SENT_PLAIN, SENT_RAISED] };
    const result = onDeviceWhenUnread(offline, { reference, asOf: ASOF });
    expect(result.source).toBe("device");
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]?.draft).toMatchObject({ flow: "Transfer", fromWallet: "Gcash", amount: 12000, fee: 0, date: "2026-10-04" });
    expect(result.proposals[0]?.adjustments.join(" ")).toContain("The model could not be reached");
    // A clean read keeps the screen's confidence, and says once that it was read here.
    expect(result.proposals[0]?.confidence).toBe("high");
    expect(result.proposals[0]?.adjustments.filter((a) => /read on this device/i.test(a))).toHaveLength(1);
  });

  it("leaves a picture it cannot read whole as it was", () => {
    const offline: ExtractResult = { proposals: [], refused: [], source: "offline", readings: ["a photo of a cat", ""] };
    expect(onDeviceWhenUnread(offline, { reference, asOf: ASOF })).toBe(offline);
  });
});
