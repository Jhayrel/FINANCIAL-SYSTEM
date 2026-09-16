/**
 * The check that runs between the reading and the card.
 *
 * Every case here is a reading that passes every field check in
 * `domain/proposal.ts` and is still wrong about the sentence it came from,
 * plus the cases that must stay quiet so this does not become noise.
 */

import { describe, expect, it } from "vitest";

import { emptyDraft, type Draft } from "./entry";
import type { ReferenceLists } from "./types";
import { centavosIn, verifyReading } from "./verify";

const ASOF = "2026-09-16";

const reference: ReferenceLists = {
  wallets: ["Maya", "Gcash", "Cash"],
  savings: ["Maya Bank"],
  bills: ["Globe at Home Wifi"],
  subscriptions: ["Spotify"],
  revenueCategories: ["Allowance"],
  spendingTypes: [
    { name: "Food", remark: "Meals, snacks, drinks" },
    { name: "Gas", remark: "" },
  ],
  credits: ["Maya Credit"],
};

const spending = (over: Partial<Draft> = {}): Draft => ({
  ...emptyDraft(ASOF),
  flow: "Spending",
  category: "Spending",
  item: "Food",
  fromWallet: "Gcash",
  amount: 50000,
  ...over,
});

describe("the figure in the sentence against the figure that was read", () => {
  it("says so when the sentence carries a larger one", () => {
    const v = verifyReading(spending(), "I paid 1,500 for food from gcash", reference, ASOF);
    expect(v.notes.join(" ")).toContain("PHP 1,500.00");
    expect(v.notes.join(" ")).toContain("PHP 500.00");
    expect(v.confidence).toBe("low");
  });

  it("stays quiet when the figures agree", () => {
    const v = verifyReading(spending(), "I paid 500 for food from gcash", reference, ASOF);
    expect(v.findings.filter((f) => f.check === "figure")).toHaveLength(0);
  });

  /**
   * Dates, quantities and times are all small numbers, and flagging them
   * would make this noise rather than a check.
   */
  it("ignores smaller numbers, which are dates and counts", () => {
    const v = verifyReading(spending(), "on the 3rd I paid 500 for 2 meals", reference, ASOF);
    expect(v.findings.filter((f) => f.check === "figure")).toHaveLength(0);
  });

  it("says nothing about a figure when none was read, which the readiness check covers", () => {
    const v = verifyReading(spending({ amount: null }), "I paid 1500 for food", reference, ASOF);
    expect(v.findings.filter((f) => f.check === "figure")).toHaveLength(0);
    expect(v.ready).toBe(false);
    expect(v.missing).toContain("amount");
  });
});

describe("the wallet in the sentence against the wallet that was read", () => {
  it("says so when a different account was named", () => {
    const v = verifyReading(spending({ fromWallet: "Maya" }), "I paid 500 for food from gcash", reference, ASOF);
    expect(v.notes.join(" ")).toContain("You named Gcash");
    expect(v.notes.join(" ")).toContain("read as Maya");
  });

  it("says so when one was named and none was filled in", () => {
    const v = verifyReading(spending({ fromWallet: "" }), "I paid 500 for food from gcash", reference, ASOF);
    expect(v.notes.join(" ")).toContain("no wallet was filled in");
  });

  it("stays quiet when the sentence names the wallet that was used", () => {
    const v = verifyReading(spending(), "I paid 500 for food from gcash", reference, ASOF);
    expect(v.findings.filter((f) => f.check === "wallet")).toHaveLength(0);
  });

  /**
   * "Maya Credit" contains "Maya". Reading the account out of a sentence
   * about borrowing is the mistake that put borrowed money through a wallet.
   */
  it("says nothing about wallets when a credit line was named", () => {
    const v = verifyReading(
      spending({ fromWallet: "Gcash" }),
      "I borrowed 500 on maya credit",
      reference,
      ASOF,
    );
    expect(v.findings.filter((f) => f.check === "wallet")).toHaveLength(0);
  });

  it("stays quiet when two accounts are named, because a transfer names both", () => {
    const v = verifyReading(
      spending({ fromWallet: "Maya" }),
      "moved it from maya to gcash",
      reference,
      ASOF,
    );
    expect(v.findings.filter((f) => f.check === "wallet")).toHaveLength(0);
  });
});

describe("the item in the sentence against the item that was read", () => {
  it("says so when a different one of the owner's items was named", () => {
    const v = verifyReading(spending({ item: "Food" }), "I paid 500 for gas from gcash", reference, ASOF);
    expect(v.notes.join(" ")).toContain("You named Gas");
  });

  it("stays quiet when they agree", () => {
    const v = verifyReading(spending(), "I paid 500 for food from gcash", reference, ASOF);
    expect(v.findings.filter((f) => f.check === "item")).toHaveLength(0);
  });

  it("says nothing about a word that is not one of the owner's items", () => {
    const v = verifyReading(spending(), "I paid 500 for lunch from gcash", reference, ASOF);
    expect(v.findings.filter((f) => f.check === "item")).toHaveLength(0);
  });
});

describe("a date after today", () => {
  it("is flagged, because it is usually a year read wrong", () => {
    const v = verifyReading(spending({ date: "2027-01-05" }), "", reference, ASOF);
    expect(v.notes.join(" ")).toContain("after today");
  });

  it("leaves today and the past alone", () => {
    expect(verifyReading(spending({ date: ASOF }), "", reference, ASOF).findings).toHaveLength(0);
    expect(verifyReading(spending({ date: "2026-01-05" }), "", reference, ASOF).findings).toHaveLength(0);
  });
});

describe("whether it is ready to hand over", () => {
  it("names what is still missing, in the words the form uses", () => {
    const v = verifyReading(spending({ amount: null, fromWallet: "" }), "", reference, ASOF);
    expect(v.ready).toBe(false);
    expect(v.notes.join(" ")).toContain("the amount");
    expect(v.notes.join(" ")).toContain("the wallet it came from");
  });

  it("is ready when the flow has everything it needs", () => {
    const v = verifyReading(spending(), "", reference, ASOF);
    expect(v.ready).toBe(true);
    expect(v.findings).toHaveLength(0);
  });

  it("does not ask a Revenue row for a source wallet", () => {
    const v = verifyReading(
      { ...emptyDraft(ASOF), flow: "Revenue", category: "Revenue", item: "Allowance", toWallet: "Maya", amount: 100000 },
      "",
      reference,
      ASOF,
    );
    expect(v.ready).toBe(true);
  });

  /** A transfer with no destination is Money Send, a real saveable row. */
  it("does not ask a Money Send for a destination", () => {
    const v = verifyReading(
      { ...emptyDraft(ASOF), flow: "Transfer", fromWallet: "Maya", toWallet: "", amount: 100000, sentOut: true },
      "",
      reference,
      ASOF,
    );
    expect(v.ready).toBe(true);
  });

  it("does ask an ordinary transfer for one", () => {
    const v = verifyReading(
      { ...emptyDraft(ASOF), flow: "Transfer", fromWallet: "Maya", toWallet: "", amount: 100000 },
      "",
      reference,
      ASOF,
    );
    expect(v.ready).toBe(false);
    expect(v.missing).toContain("toWallet");
  });
});

describe("reading a figure out of text", () => {
  it("reads pesos and centavos as integer centavos", () => {
    expect(centavosIn("1,234.56")).toBe(123456);
    expect(centavosIn("500")).toBe(50000);
    expect(centavosIn("0.05")).toBe(5);
    expect(centavosIn("85.5")).toBe(8550);
  });

  it("refuses what is not a figure", () => {
    expect(centavosIn("12.345")).toBeNull();
    expect(centavosIn("1.2.3")).toBeNull();
    expect(centavosIn("abc")).toBeNull();
  });
});

describe("confidence", () => {
  it("is lowered by a finding and never raised without one", () => {
    expect(verifyReading(spending(), "I paid 9000 for food", reference, ASOF, "high").confidence).toBe("low");
    expect(verifyReading(spending(), "I paid 500 for food from gcash", reference, ASOF, "high").confidence).toBe("high");
    expect(verifyReading(spending(), "I paid 500 for food from gcash", reference, ASOF, "medium").confidence).toBe("medium");
  });
});
