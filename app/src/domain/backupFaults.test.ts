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

describe("the model is told whether the month is on track, as the alert decides it", () => {
  const spend = (date: string, amount: number) =>
    ({ id: `p${date}${amount}`, recordNumber: amount, date, type: "Spending", fromWallet: "Cash", toWallet: "", category: "Spending", item: "Food", description: "", amount, fee: 0, total: amount, notes: "", status: "Paid" }) as never;
  const income = { id: "in", recordNumber: 1, date: "2026-10-01", type: "Revenue", fromWallet: "", toWallet: "Cash", category: "Revenue", item: "Allowance", description: "", amount: 2000000, fee: 0, total: 2000000, notes: "", status: "Received" } as never;
  const budgets = { "2026": { spending: [0, 0, 0, 0, 0, 0, 0, 0, 0, 1500000, 0, 0], billsSubs: Array(12).fill(0) } };
  const text = async (rows: never[]) => {
    const { buildContext, contextToText } = await import("./aiContext");
    const reference = { wallets: ["Cash"], savings: [], bills: [], subscriptions: [], revenueCategories: ["Allowance"], spendingTypes: [{ name: "Food", remark: "" }] };
    const c = buildContext({ transactions: [income, ...rows], accounts: [], budgets, credits: [], reference, lowBalanceThreshold: 0, asOf: "2026-10-07" } as never);
    return { line: contextToText(c).split("\n").find((l) => l.startsWith("Spending budget pace:")) ?? "", alerts: c.alerts };
  };

  it("says not on track when the pace alert fires", async () => {
    const got = await text([spend("2026-10-02", 1062605)]);
    expect(got.line).toMatch(/: not on track\.$/);
    expect(JSON.stringify(got.alerts)).toContain("Spending faster than the budget allows");
  });

  it("says on track when it does not", async () => {
    const got = await text([spend("2026-10-02", 200000)]);
    expect(got.line).toMatch(/[^t] on track\.$/);
    expect(JSON.stringify(got.alerts)).not.toContain("Spending faster than the budget allows");
  });
});

describe("a budget for a day or a week is not a month's budget", () => {
  it.each([
    ["Give me a proposed budget for this week. I have class may b", true],
    ["can you suggest a budget for this week?", true],
    ["what budget do you recommend for today?", true],
    ["what budget do you recommend for November?", false],
    ["recommend a budget", false],
  ])("%s", async (said, short) => {
    const { asksShortBudget } = await import("./budgetAdvice");
    expect(asksShortBudget(said, "2026-10-05")).toBe(short);
  });
});

describe("an opening balance is one whatever its item is called", () => {
  it("counts a renamed opening row as already held, not income", async () => {
    const { incomeQuality } = await import("./debt");
    const row = (item: string, category: string, total: number) =>
      ({ id: item + total, recordNumber: total, date: "2026-01-01", type: "Revenue", fromWallet: "", toWallet: "Cash", category, item, description: "", amount: total, fee: 0, total, notes: "", status: "Done" }) as never;
    const q = incomeQuality([row("Random", "Opening", 95389), row("Transfer of balance", "Revenue", 10000), row("Allowance", "Revenue", 500000)], []);
    expect(q.openingBalance).toBe(105389);
    expect(q.trueIncome).toBe(500000);
  });
});

describe("a year-end row filed under Opening is not opened as a starting balance", () => {
  it("is refused for editing, and income can never carry a hidden second account", async () => {
    const { notEditable, transactionToDraft, draftToTransactions } = await import("./entry");
    const close = { id: "c", recordNumber: 3325, date: "2026-01-01", type: "Spending", fromWallet: "Cash", toWallet: "", category: "Opening", item: "", description: "Balance at the end of 2025", amount: 77900, fee: 0, total: 77900, notes: "", status: "Done" } as never;
    expect(notEditable(close)).toContain("#3325 is a balance the app carried over");
    expect(transactionToDraft(close).flow).toBe("Spending");
    const income = { ...transactionToDraft({ id: "i", recordNumber: 1, date: "2026-10-01", type: "Revenue", fromWallet: "Cash", toWallet: "Maya", category: "Revenue", item: "Allowance", description: "", amount: 1000, fee: 0, total: 1000, notes: "", status: "Received" } as never) };
    expect(draftToTransactions(income, 1, "i")[0]?.fromWallet).toBe("");
  });
});

describe("ledger checks from the backup", () => {
  const r = (o: object) => ({ id: Math.random().toString(36), recordNumber: 1, date: "2026-09-20", type: "Spending", fromWallet: "", toWallet: "", category: "Spending", item: "", description: "", amount: 0, fee: 0, total: 0, notes: "", status: "", ...o }) as never;
  it("names a withdrawal with the machine fee inside, and a day that closed below zero", async () => {
    const { checkIntegrity } = await import("./integrity");
    const rows = [
      r({ type: "Revenue", category: "Revenue", item: "Allowance", toWallet: "Maya", amount: 200000, total: 200000, date: "2026-09-01" }),
      r({ type: "Transfer", category: "", fromWallet: "Maya", toWallet: "Cash", amount: 101800, total: 101800, status: "Withdrawn", description: "ATM withdrawal" }),
      r({ fromWallet: "Maya", amount: 150000, total: 150000, item: "Food", date: "2026-09-26" }),
      r({ type: "Revenue", category: "Revenue", item: "Allowance", toWallet: "Maya", amount: 100000, total: 100000, date: "2026-09-27" }),
    ];
    const issues = checkIntegrity(rows, { wallets: ["Cash", "Maya"], asOf: "2026-10-07" });
    expect(issues.some((i) => i.code === "fee-inside-withdrawal" && i.message.includes("₱1,000.00 of cash and a ₱18.00 machine fee"))).toBe(true);
    expect(issues.find((i) => i.code === "below-zero-day")?.message).toContain("Maya closed September 26, 2026 at −₱518.00");
  });
  it("saves income with its category", async () => {
    const { draftToTransactions, emptyDraft } = await import("./entry");
    const d = { ...emptyDraft("2026-10-07"), flow: "Revenue" as const, category: "" as never, toWallet: "Maya", item: "Allowance", amount: 1000 };
    expect(draftToTransactions(d, 1, "x")[0]?.category).toBe("Revenue");
  });
});

describe("carry-over, ranges, settings and budget history (12 October 2026)", () => {
  it("raises tomorrow by what today leaves unspent, and works out a run of days", async () => {
    const { ifNothingMoreToday, safeOverDays } = await import("./monthPlan");
    const safe = { safe: 300000, perDay: 10000, perDayAfter: 10000, daysLeft: 20 };
    expect(ifNothingMoreToday(safe)).toBe(15789);
    const over = safeOverDays(safe, "2026-10-12", "2026-10-15", "2026-10-17");
    expect(over).toMatchObject({ days: 3, keeping: 30000, saving: Math.floor(300000 / 17) * 3 });
    expect(safeOverDays(safe, "2026-10-12", "2026-11-02", "2026-11-05")).toBeNull();
  });

  it("counts every budget change by month", async () => {
    const { budgetChangeWords } = await import("./settingsContext");
    const budgets = { "2026": { spending: Array(12).fill(0), billsSubs: Array(12).fill(0), revisions: { "10": [
      { at: "2026-10-04T10:00:00Z", what: "tracks", spending: 1500000, wasSpending: 770000, billsSubs: 170000, wasBillsSubs: 170000, when: "open" },
      { at: "2026-10-05T10:00:00Z", what: "limit", name: "Food", limit: 300000, when: "open" },
    ] } } } as never;
    const words = budgetChangeWords(budgets, "2026-10-12");
    expect(words[0]).toBe("2 changes in all. By month: October 2026: 2 changes (1 to limits).");
    expect(words.join("\n")).toContain("October 2026: spending ₱7,700.00 to ₱15,000.00");
  });
});

describe("where money sent out went (12 October 2026)", () => {
  const sent = { flow: "Transfer", date: "2026-10-11", fromWallet: "Maya", toWallet: "", category: "Transfer", item: "", description: "Sent money via InstaPay QRPh", amount: 80000, fee: 0, notes: "", status: "Transferred" } as never;
  it("is placed in the account that took the same amount in", async () => {
    const { placeSentMoney } = await import("./destination");
    const ledger = [{ id: "g", recordNumber: 3931, date: "2026-10-11", type: "Revenue", fromWallet: "", toWallet: "Gcash", category: "Revenue", item: "Allowance", description: "", amount: 80000, fee: 0, total: 80000, notes: "", status: "Received" }] as never[];
    expect(placeSentMoney(sent, ledger, ["Cash", "Gcash", "Maya"])?.draft.toWallet).toBe("Gcash");
  });
  it("is a purchase when it was a QR payment and nothing of theirs took it in", async () => {
    const { placeSentMoney } = await import("./destination");
    expect(placeSentMoney(sent, [], ["Cash", "Gcash", "Maya"])?.draft.flow).toBe("Spending");
  });
  it("is left to ask when it was not a QR payment", async () => {
    const { placeSentMoney } = await import("./destination");
    expect(placeSentMoney({ ...(sent as object), description: "InstaPay transfer" } as never, [], ["Cash", "Gcash", "Maya"])).toBeNull();
  });
});

describe("the days ahead a safe question asks about (12 October 2026)", () => {
  it.each([
    ["how much can i spend from oct 15 to oct 20?", "2026-10-15", "2026-10-20"],
    ["how much can i spend next week", "2026-10-19", "2026-10-25"],
    ["safe to spend this week", "2026-10-12", "2026-10-18"],
    ["what can i use the next 5 days", "2026-10-13", "2026-10-17"],
  ])("%s", async (said, from, to) => {
    const { daysAskedAbout } = await import("./safeAsk");
    expect(daysAskedAbout(said, "2026-10-12")).toMatchObject({ from, to });
  });
});
