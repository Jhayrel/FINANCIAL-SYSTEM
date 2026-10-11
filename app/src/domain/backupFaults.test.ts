/**
 * Faults found in the owner's backup of 7 October 2026, each pinned so it
 * stays fixed. Every figure here is invented except where a comment says the
 * shape came from the log.
 */

import { describe, expect, it } from "vitest";

import { saysItWasAQuestion } from "./intent";
import { interestFromBalance } from "./interestAsk";
import { readInvestigateAsk } from "./investigateAsk";

const ACCOUNTS = ["Cash", "Gcash", "Maya", "Maya Bank (Personal savings)"];
const held: Record<string, number> = { Cash: 70000, Gcash: 0, Maya: 600000, "Maya Bank (Personal savings)": 350000 };
const recorded = (a: string): number => held[a] ?? 0;

describe("Maya or Maya Bank, when only maya is said", () => {
  it("takes the account whose balance is nearest the figure", () => {
    expect(readInvestigateAsk("But in my real balance in my maya is 3500.40", ACCOUNTS, recorded)?.account).toBe("Maya Bank (Personal savings)");
  });

  it("takes the account the conversation is about", () => {
    expect(readInvestigateAsk("my real balance in my maya is 9000", ACCOUNTS, recorded, undefined, "Maya Bank (Personal savings)")?.account).toBe("Maya Bank (Personal savings)");
  });

  it("keeps Maya when the figure is Maya's", () => {
    expect(readInvestigateAsk("my real balance in my maya is 5950", ACCOUNTS, recorded)?.account).toBe("Maya");
  });

  it("keeps Maya Bank when it is named in full", () => {
    expect(readInvestigateAsk("my maya bank balance is 5600", ACCOUNTS, recorded)?.account).toBe("Maya Bank (Personal savings)");
  });

  it("reads interest in my maya against Maya Bank when that is where the figure fits", () => {
    const got = interestFromBalance("I earned interest in my maya, it is 3500.84 now", ACCOUNTS, recorded);
    expect(got?.account).toBe("Maya Bank (Personal savings)");
    expect(got?.gap).toBe(84);
  });
});

describe("saying the message before was a question", () => {
  it.each(["THATWS A QUESTION", "Thats a question", "that's a question read it"])("%s", (said) => {
    expect(saysItWasAQuestion(said)).toBe(true);
  });
});

describe("Stop before a read is sent", () => {
  it("sends nothing and offers nothing", async () => {
    const { extractProposals } = await import("../data/aiClient");
    const control = new AbortController();
    control.abort();
    let calls = 0;
    const result = await extractProposals({
      note: "I paid 599 for food from maya",
      attachments: [],
      reference: { wallets: ["Maya"], savings: [], bills: [], subscriptions: [], revenueCategories: [], spendingTypes: [{ name: "Food", remark: "" }] } as never,
      asOf: "2026-10-07",
      signal: control.signal,
      fetcher: (async () => {
        calls += 1;
        return new Response("{}");
      }) as typeof fetch,
      token: async () => "t",
    } as never);
    expect(calls).toBe(0);
    expect(result.source).not.toBe("model");
  });
});

describe("a can question is about what is safe, never a past sum", () => {
  it.each(["How much money i can spend tommorow?", "if we consider gas how much money i can spend daily?", "how much cash can i spend today"])("%s", async (said) => {
    const { asksSafeToSpend } = await import("./safeAsk");
    const { readSpendAsk } = await import("./spendAsk");
    expect(asksSafeToSpend(said)).toBe(true);
    expect(readSpendAsk(said, ["Gas", "Food"], "2026-10-06")).toBeNull();
  });
});
