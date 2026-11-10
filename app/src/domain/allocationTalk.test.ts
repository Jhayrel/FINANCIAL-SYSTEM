/**
 * A talk about one allocation (owner, 10 November 2026): what it takes to
 * last the month at its share and at what it has cost, week by week, a
 * total or a rate named, "budget" said of it, and follow-ups that do not
 * say the word. Every figure here is invented.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { allocationMeant, allocationWords, coverWords, followsAllocation, lineTalkedAbout, weeksWords } from "./allocationAsk";
import { readAllocationChange } from "./allocationChange";
import { makeAllocation, monthAllocations } from "./monthAllocation";
import { readIncomeIf } from "./whatIfAsk";
import type { ReferenceLists, Transaction } from "./types";

const asOf = "2026-11-10";
const DASH = String.fromCharCode(0x2014);
let n = 0;
const spend = (date: string, item: string, amount: number, over: Partial<Transaction> = {}): Transaction =>
  ({ id: `t${(n += 1)}`, recordNumber: n, date, type: "Spending", fromWallet: "Cash", toWallet: "", category: "Spending", item, description: "", amount, fee: 0, total: amount, notes: "", status: "Paid", ...over }) as Transaction;
const swim = makeAllocation({ name: "Swim", kind: "Self Care", words: "swim", amount: null, each: 5_000, times: 8, per: "time" }, "2026-11", "2026-11-01", "a-swim");
const fare = makeAllocation({ kind: "Fare", amount: null, each: 20_000, times: 4, per: "week", wallet: "Cash" }, "2026-11", "2026-11-01", "a-fare");
const rows = [spend("2026-11-04", "Self Care", 7_000, { description: "swim" }), spend("2026-11-10", "Self Care", 6_000, { description: "swim" }), spend("2026-11-03", "Fare", 10_000)];
const month = monthAllocations([swim, fare], rows, "2026-11", asOf);
const line = month.lines.find((l) => l.line.id === "a-swim")!;

describe("what it takes to last the month", () => {
  it("at its share and at what the uses so far cost, and what each takes from safe to spend", () => {
    const words = coverWords(line, "is my allocation enough", asOf, month.phase, 20_000)!;
    expect(words).toContain("To last until November 30, 2026: 6 more times counted (8 less the 2 used), with ₱270.00 left.");
    expect(words).toContain("- At ₱50.00 each, its share: ₱300.00 for the 6, ₱30.00 more than is left, so ₱430.00 in all.");
    expect(words).toContain("- At ₱65.00 each, what the 2 so far cost on average: ₱390.00 for the 6, ₱120.00 more than is left, so ₱520.00 in all.");
    expect(words).toContain("Raising it sets the extra aside now, out of safe to spend (₱200.00): ₱170.00 at ₱430.00; ₱80.00 at ₱520.00.");
    expect(words).not.toContain(DASH);
  });
  it("a total named, and a price and a rate named", () => {
    const words = coverWords(line, "can we up it to 800? that would cover 60 pesos per session and 3x per week", asOf, month.phase, 20_000)!;
    expect(words).toContain("At ₱800.00 in all: ₱400.00 more than now, ₱670.00 left after the ₱130.00 spent, which pays for 13 at ₱50.00 or 10 at ₱65.00; safe to spend would be ₱200.00 short, below zero.");
    expect(words).toContain("At ₱60.00 a session, 3 a week: from November 11, 2026 to November 30, 2026 (20 days) is about 9 sessions, ₱540.00; with the ₱130.00 already spent the month comes to ₱670.00. Four whole weeks at that rate is 12 sessions, ₱720.00.");
  });
  it("week by week", () => {
    const words = weeksWords(line, asOf, month.phase)!;
    expect(words).toContain("- Nov 2 to 8: 1 used, ₱70.00.");
    expect(words).toContain("- Nov 9 to 15: 1 used, ₱60.00; 2 still counted, covered by what is left.");
    expect(words).toContain("- Nov 23 to 29: 2 still counted, 1 covered, 1 needing ₱50.00 more.");
  });
  it("is said with the allocation's answer, for a line counted in times only", () => {
    const words = allocationWords("is my allocation accurate?", month, { safe: 20_000, perDay: 0 }, asOf);
    expect(words).toContain("To last until November 30, 2026");
    expect(coverWords(month.lines.find((l) => l.line.id === "a-fare")!, "", asOf, month.phase, 0)).toBeNull();
  });
});

describe("a talk about one allocation", () => {
  const live = month.lines.map((l) => l.line);
  const talked = lineTalkedAbout(["is my allocation accurate?", "why swim is off?"], live);
  it("knows the line being talked about", () => {
    expect(talked?.name).toBe("Swim");
    expect(lineTalkedAbout(["swim and fare"], live)).toBeNull();
  });
  it("reads budget said of it as the allocation, and leaves a month's budget alone", () => {
    expect(allocationMeant("make the swim budget higher 800", live, null)).toBe("make the swim allocation higher 800");
    expect(allocationMeant("can we up the budget to 800?", live, talked)).toBe("can we up the swim allocation to 800?");
    expect(allocationMeant("set my december budget to 13000", live, talked)).toBe("set my december budget to 13000");
    expect(allocationMeant("can we up the budget to 800?", live, null)).toBe("can we up the budget to 800?");
  });
  it("and the change it reads is the allocation's", () => {
    const reference = { spendingTypes: [{ name: "Self Care", remark: "" }, { name: "Fare", remark: "" }], bills: [], subscriptions: [], wallets: ["Cash"], savings: [] } as unknown as ReferenceLists;
    const read = readAllocationChange(allocationMeant("make the swim budget higher 800", live, null), { lines: [swim, fare], reference, transactions: rows, asOf, safe: 20_000 });
    expect(read?.kind).not.toBe("ask");
    expect(JSON.stringify(read)).toContain("safe to spend goes from ₱200.00 to ₱200.00 below zero: more than is free this month. It is still your call");
  });
  it("carries on without the word, and lets another subject go", () => {
    for (const t of ["like how much to add?", "what are you proposing?", "so is it safe to make it higher?", "can you make it until the months end?"]) expect(followsAllocation(t), t).toBe(true);
    for (const t of ["how much did I spend on food this month", "show me a chart of my income", "thanks", "set my november budget to 950"]) expect(followsAllocation(t), t).toBe(false);
  });
  it("money brought in is a what-if of money in", () => {
    expect(readIncomeIf("what if I can bring another 1000?")).toBe(100_000);
    expect(readIncomeIf("what if I buy shoes 1000")).toBeNull();
  });
});

describe("the chat around it", () => {
  const source = readFileSync(new URL("../features/AskPanel.tsx", import.meta.url), "utf8");
  it("draws the allocation chart once, not under every question", () => {
    expect(source).toContain('const shownLately = turns.slice(-14).some((t) => isChart(t) && t.chart.measure === "allocation");');
    expect(source).toContain("(wantsChart(note) || (!carriesOn && !shownLately && !yesNo");
  });
  it("never offers a month's budget below its own bills", () => {
    expect(source).toContain("budgetAsk.total < hint");
  });
});
