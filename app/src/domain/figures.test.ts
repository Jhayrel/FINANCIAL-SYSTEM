/**
 * A list of amounts is not one amount: "999, 199, 239" was saved as
 * PHP 999,199,239.00.
 */

import { describe, expect, it } from "vitest";

import { applyReply } from "./capture";
import { emptyDraft } from "./entry";
import { loadFixture } from "../fixtures/load";
import { figuresIn } from "./money";

const fx = loadFixture();

describe("figures in a reply", () => {
  it("reads a list as separate figures", () => {
    expect(figuresIn("999, 199, 239")).toEqual([99900, 19900, 23900]);
    expect(figuresIn("999 199 239")).toEqual([99900, 19900, 23900]);
    expect(figuresIn("wifi 999 and dito 199")).toEqual([99900, 19900]);
  });

  it("keeps a thousands comma and centavos in one figure", () => {
    expect(figuresIn("1,234.50")).toEqual([123450]);
    expect(figuresIn("PHP 12,000")).toEqual([1200000]);
    expect(figuresIn("500")).toEqual([50000]);
  });

  it("does not take a list as the answer to how much it was", () => {
    const draft = { ...emptyDraft("2026-09-15"), flow: "Spending" as const, fromWallet: "Gcash", category: "Bills" as const, item: "Wifi" };
    expect(applyReply(draft, "amount", "999, 199, 239", fx.reference)).toBeNull();
    expect(applyReply(draft, "amount", "999", fx.reference)?.amount).toBe(99900);
    expect(applyReply(draft, "amount", "1,234.50", fx.reference)?.amount).toBe(123450);
  });
});
