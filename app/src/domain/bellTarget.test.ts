/**
 * A finding from the bell: where it is on the screen it opens, and hiding
 * one until it changes (owner, 14 November 2026). Invented findings.
 */
import { describe, expect, it } from "vitest";

import { bellNeedles, prunedHidden, sayingOf, splitHidden } from "./bellTarget";

const low = { id: "wallet-low-b", title: "Wallet B is running low", detail: "₱120.00 left, below your ₱500.00 minimum." };
const pace = { id: "budget-pace", title: "Spending faster than the budget allows", detail: "₱400.00 a day so far." };

describe("where a finding is on its screen", () => {
  it("looks for its own heading, then the names it mentions, longest first", () => {
    expect(bellNeedles(low, ["Cash", "Wallet B", "Wallet"])).toEqual(["Wallet B is running low", "Wallet B", "Wallet"]);
    expect(bellNeedles(pace, ["Cash", "Wallet B"])).toEqual(["Spending faster than the budget allows"]);
  });
});

describe("a finding put away", () => {
  it("stays away while it says the same, and comes back when it changes", () => {
    const hidden = { [low.id]: sayingOf(low) };
    expect(splitHidden([low, pace], hidden)).toEqual({ shown: [pace], away: [low] });
    const changed = { ...low, detail: "₱80.00 left, below your ₱500.00 minimum." };
    expect(splitHidden([changed, pace], hidden)).toEqual({ shown: [changed, pace], away: [] });
  });
  it("is forgotten once the finding is gone or changed", () => {
    expect(prunedHidden([pace], { [low.id]: sayingOf(low), [pace.id]: sayingOf(pace) })).toEqual({ [pace.id]: sayingOf(pace) });
  });
});
