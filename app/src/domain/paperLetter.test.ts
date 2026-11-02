/**
 * A letter is read as a letter, and its payment is looked for in the ledger
 * (`notPaid.ts`). The owner, 1 November 2026, sending a school's consent
 * letter for a trip: "what if thats not a plan or like thats a
 * acknowledgement ... i need you to be accurate".
 *
 * The papers below are made up, with the faults a phone photo gives the
 * reading ("Gollege", "fransportation", "af the office"), so they read as a
 * real one does. No name, school or account in them is the owner's.
 */
import { describe, expect, it } from "vitest";
import { classifyPaper } from "./paperKind";
import { trainingFrom } from "./paperMemory";
import { paidAlready, paidDraftFor, paperDueDay, pastDueWords, planToPay, readNotPaid, type NotPaid, type PaidRow } from "./notPaid";
import type { ReferenceLists } from "./types";

const LETTER = `Saint Brendan Gollege
of San Isidro, La Paz
The Beacon of Learning in the North
January 20, 2026
To Whom It May Concern
I, the undersigned parent/guardian of ______
understand that part of the requirement of the curriculum of
the Bachelor of Science in Information Technology Program
is to undergo an educational company tour on March 11 - 13, 2026 at Metro Manila.
I was informed by my son/daughter/ward that the payment for the said activity is
Fourteen thousand nine hundred fifty pesos only (₱14,950.00) which shall cover
fransportation, accommodation and food for the three-days and two-nights trip. The full payment
should be paid on or before February 28, 2026 af the Accounting Office while the notary fee of
the parent's consent amounting to one hundred pesos (₱100.00) will be paid by the student
personally at the office of the school's legal counsel.
The following is the tentative itinerary of the trip:
March 10, 2026 (Tuesday) 10:00pm Assembly at the school grounds
March 11, 2026 (Wednesday) 12:00am Departure
6:00am Breakfast
12:00pm Lunch
7:00pm HOTEL CHECK IN
March 14, 2026 (Saturday) 3:00am ETA: school
Signature over printed name of parent/guardian`;

const CREDIT_SCREEN = `@owner > Q
Wallet Savings ( Credit ) Loans Cards
Pay partially or in full anytime
Latest bill (1) ₱0.00
Statement for Oct 2026 Due Oct 21, 2026
View statement Pay this bill
Transactions See all
Fee applied 2 hours ago
DST - ₱0.62
Fee applied 2 hours ago
Service Fee - ₱74.90
Transferred money to 2 hours ago
My Wallet - ₱1,000.00
Paid amount due 27 Sep 2026
4,302.06
Fee applied 20 Sep 2026
DST - ₱1.23`;

const row = (n: number, date: string, type: string, item: string, description: string, total: number, toWallet = ""): PaidRow => ({ recordNumber: n, date, type, item, description, total, toWallet });

describe("a letter that names an amount", () => {
  const training = trainingFrom();
  const doc = readNotPaid([LETTER], training) as NotPaid;

  it("is a letter, not a receipt or a bill", () => {
    expect(classifyPaper(LETTER, training.model).kind).toBe("letter");
    expect(doc.kind).toBe("letter");
  });

  it("reads what it asks, by when, from whom, and the smaller fee apart", () => {
    expect(doc.amount).toBe(1_495_000);
    expect(doc.due).toBe("February 28, 2026");
    expect(doc.from).toBe("Saint Brendan College");
    expect(doc.parts).toEqual(["₱100.00 notary fee also named"]);
  });

  it("is a plan to pay only while its day is ahead", () => {
    expect(planToPay(doc, "2026-02-28", "2026-01-25")).toEqual({ title: "Saint Brendan College payment", amount: 1_495_000, due: "2026-02-28" });
    expect(planToPay(doc, "2026-02-28", "2026-11-01")).toBeNull();
  });

  it("gets its day and amount from what they say when they paid it, not today and not the day's number", () => {
    const reference = { wallets: ["Cash", "Gcash"], savings: [], spendingTypes: [{ name: "School", remark: "tuition and fees" }], bills: [] } as unknown as ReferenceLists;
    const card = paidDraftFor(doc, "paid it from cash on feb 20", reference, "2026-11-01");
    expect(card.date).toBe("2026-02-20");
    expect(card.amount).toBe(1_495_000);
    expect(card.fromWallet).toBe("Cash");
    expect(card.item).toBe("School");
    expect(card.description).toBe("Payment asked by Saint Brendan College");
  });
});

describe("a paper whose day has passed: is it in the ledger already?", () => {
  const doc = readNotPaid([LETTER]) as NotPaid;
  const ledger: PaidRow[] = [
    row(10, "2026-02-13", "Transfer", "", "Money for the trip", 1_500_000, "Hidden cash"),
    row(11, "2026-02-16", "Transfer", "", "Use to pay the trip", 1_500_000, "Cash"),
    row(12, "2026-02-17", "Spending", "School", "Paid school trip fee", 1_500_000),
    row(13, "2026-02-18", "Spending", "Food", "Groceries", 1_500_000),
  ];

  it("finds the payment, not the move between their own pockets on its way", () => {
    const found = paidAlready(doc, "2026-02-28", ledger, "School");
    expect(found?.rows.map((r) => r.recordNumber)).toEqual([12]);
    expect(found?.sure).toBe(true);
    const words = pastDueWords(doc, "2026-02-28", found, "2026-11-01");
    expect(words).toContain("It looks paid already: #0012 on February 17, 2026, ₱15,000.00");
    expect(words).toContain("₱50.00 more than it asks for");
    expect(words).toContain("Nothing is added, so it is not counted twice.");
  });

  it("says only maybe when the amount alone matches", () => {
    const found = paidAlready(doc, "2026-02-28", [ledger[3]!], "School");
    expect(found?.sure).toBe(false);
    expect(pastDueWords(doc, "2026-02-28", found, "2026-11-01")).toMatch(/^It may be paid already: #0013 .*Only the amount matches/);
  });

  it("finds it paid in parts of its kind", () => {
    const found = paidAlready(doc, "2026-02-28", [row(20, "2026-01-30", "Spending", "School", "Trip, first half", 750_000), row(21, "2026-02-25", "Spending", "School", "Trip, second half", 745_000)], "School");
    expect(found?.rows.map((r) => r.recordNumber)).toEqual([20, 21]);
    expect(pastDueWords(doc, "2026-02-28", found, "2026-11-01")).toContain("in 2 parts");
  });

  it("says the day passed with none found, and what to do", () => {
    const found = paidAlready(doc, "2026-02-28", [row(30, "2025-06-01", "Spending", "School", "Tuition", 1_495_000)], "School");
    expect(found).toBeNull();
    expect(pastDueWords(doc, "2026-02-28", null, "2026-11-01")).toMatch(/^Its day to pay, February 28, 2026, has passed, and I found no payment near ₱14,950\.00/);
    // Not yet due and not found: nothing to say; the plan offer says it.
    expect(pastDueWords(doc, "2026-12-01", null, "2026-11-01")).toBe("");
  });

  it("never takes last month's bill for this month's", () => {
    const bill: NotPaid = { kind: "bill", from: "RIVERSIDE POWER COOPERATIVE", amount: 120_000, due: "Oct 21", parts: [], figures: [] };
    expect(paidAlready(bill, "2026-10-21", [row(40, "2026-09-20", "Spending", "Electricity", "Power bill", 120_000)], "Electricity")).toBeNull();
    expect(paidAlready(bill, "2026-10-21", [row(41, "2026-10-19", "Spending", "Electricity", "Power bill", 120_000)], "Electricity")?.sure).toBe(true);
  });
});

describe("the day a paper's due date means", () => {
  it("is the day printed with its year, and the nearest one without", () => {
    expect(paperDueDay("February 28, 2026", "2026-11-01")).toBe("2026-02-28");
    expect(paperDueDay("Oct 21", "2026-11-01")).toBe("2026-10-21");
    expect(paperDueDay("Nov 10", "2026-11-01")).toBe("2026-11-10");
    expect(paperDueDay("Jan 5", "2026-11-01")).toBe("2027-01-05");
  });
});

describe("papers that look alike but are not", () => {
  const training = trainingFrom();
  it("a credit line's screen with its latest bill is a history, not a bill to pay", () => {
    expect(classifyPaper(CREDIT_SCREEN, training.model).kind).toBe("history");
    expect(readNotPaid([CREDIT_SCREEN], training)).toBeNull();
  });
  it("an acknowledgement of documents is a letter; an acknowledgement receipt records a payment", () => {
    const docs = `ACKNOWLEDGEMENT
This is to acknowledge that the office has received the following documents from the applicant:
1. Birth certificate (photocopy)
2. Two 2x2 pictures
3. Barangay clearance
Received by: ______ Date: October 3, 2026`;
    expect(classifyPaper(docs, training.model).kind).toBe("letter");
    const paid = `ACKNOWLEDGEMENT RECEIPT
No. 0412 Date: October 3, 2026
Received from ______ the sum of Five thousand pesos (Php 5,000.00)
as payment for the rent of October 2026.
Cash
Received by: ______`;
    expect(classifyPaper(paid, training.model).kind).toBe("receipt");
    expect(readNotPaid([paid], training)).toBeNull();
  });
});
