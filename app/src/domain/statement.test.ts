/**
 * A statement screenshot is one account, all the way down.
 *
 * `Screenshot_20260905_132223_Maya.jpg` held eight rows. The first two cards
 * came back with Maya on them and the rest came back with Gcash. Nothing
 * about the picture changed halfway down: the model drifted, which is what a
 * small model does over eight repetitive rows, and every drifted row is money
 * booked against the wrong wallet.
 */

import { describe, expect, it } from "vitest";

import { accountNamedIn, ownSide, readAgainst, statementAccount } from "./statement";
import { emptyDraft, type Draft } from "./entry";

const ACCOUNTS = ["Gcash", "Maya", "Cash", "Maya Bank (Personal savings)", "Reserved Fund"];

const spend = (wallet: string): Draft => ({
  ...emptyDraft("2026-09-05"),
  flow: "Spending",
  item: "Food",
  amount: 10000,
  fromWallet: wallet,
});

const receive = (wallet: string): Draft => ({
  ...emptyDraft("2026-09-05"),
  flow: "Revenue",
  item: "Allowance",
  amount: 10000,
  toWallet: wallet,
});

describe("the account a file name records", () => {
  it("reads the account out of a phone's own screenshot name", () => {
    expect(accountNamedIn("Screenshot_20260905_132223_Maya.jpg", ACCOUNTS)).toBe("Maya");
  });

  it("reads it however the punctuation falls", () => {
    expect(accountNamedIn("gcash statement sept.png", ACCOUNTS)).toBe("Gcash");
    expect(accountNamedIn("MAYA-2026-09.jpeg", ACCOUNTS)).toBe("Maya");
  });

  it("prefers the longer account when one name contains another", () => {
    expect(accountNamedIn("maya bank personal savings.png", ACCOUNTS)).toBe(
      "Maya Bank (Personal savings)",
    );
  });

  it("says nothing when the name says nothing", () => {
    expect(accountNamedIn("image.png", ACCOUNTS)).toBe("");
    expect(accountNamedIn("IMG_1234.jpg", ACCOUNTS)).toBe("");
  });
});

describe("which account a batch came off", () => {
  it("takes the file name, because the device wrote it", () => {
    const drifted = [spend("Maya"), spend("Gcash"), spend("Gcash")];
    expect(statementAccount("Screenshot_Maya.jpg", drifted, ACCOUNTS)).toBe("Maya");
  });

  it("lets the rows vote when the name says nothing", () => {
    const rows = [spend("Maya"), spend("Maya"), spend("Gcash")];
    expect(statementAccount("image.png", rows, ACCOUNTS)).toBe("Maya");
  });

  /**
   * Four and four is a mixture, not a statement with mistakes in it.
   * Guessing between them would be inventing the answer.
   */
  it("refuses to pick when the rows are evenly split", () => {
    const split = [spend("Maya"), spend("Maya"), spend("Gcash"), spend("Gcash")];
    expect(statementAccount("image.png", split, ACCOUNTS)).toBe("");
  });

  it("never lets a single row decide for the rest", () => {
    expect(statementAccount("image.png", [spend("Maya")], ACCOUNTS)).toBe("");
  });

  it("counts the receiving end for money coming in", () => {
    const income = [receive("Maya"), receive("Maya")];
    expect(statementAccount("image.png", income, ACCOUNTS)).toBe("Maya");
  });
});

describe("every row read against that account", () => {
  const drafts = [spend("Maya"), spend(""), spend("Gcash")];
  const read = readAgainst("Maya", drafts);

  it("leaves a row that already agrees completely alone", () => {
    expect(read[0]?.draft.fromWallet).toBe("Maya");
    expect(read[0]?.note).toBe("");
  });

  it("fills a blank, which is what the button used to be for", () => {
    expect(read[1]?.draft.fromWallet).toBe("Maya");
    expect(read[1]?.note).toContain("Filled in Maya");
  });

  /**
   * Reported, never rewritten. This cannot tell a drift from a genuine
   * transfer into another pocket, and the owner can at a glance. Integrity
   * checks report and never auto-correct.
   */
  it("leaves a disagreement exactly as it was read", () => {
    expect(read[2]?.draft.fromWallet).toBe("Gcash");
  });

  it("says so, naming both accounts", () => {
    expect(read[2]?.note).toContain("came off a Maya statement but reads as Gcash");
  });

  it("checks the receiving end for money coming in", () => {
    const [only] = readAgainst("Maya", [receive("Gcash")]);
    expect(only?.note).toContain("reads as Gcash");
    expect(only?.draft.toWallet).toBe("Gcash");
  });

  it("does not care where a transfer went, only where it came from", () => {
    const out: Draft = { ...spend("Maya"), flow: "Transfer", toWallet: "Gcash" };
    expect(readAgainst("Maya", [out])[0]?.note).toBe("");
  });

  it("changes nothing at all when the account could not be worked out", () => {
    const untouched = readAgainst("", drafts);
    expect(untouched.map((r) => r.draft)).toEqual(drafts);
    expect(untouched.every((r) => r.note === "")).toBe(true);
  });

  it("knows which end of a row belongs to the account", () => {
    expect(ownSide("Revenue")).toBe("toWallet");
    expect(ownSide("Spending")).toBe("fromWallet");
    expect(ownSide("Transfer")).toBe("fromWallet");
  });
});
