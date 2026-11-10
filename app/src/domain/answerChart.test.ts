/**
 * Charts of an answer's own figures (owner, 10 November 2026: "come up with
 * random data then said 'chart that' ... any type of chart, vs, trend, pie
 * ... make sure its accurate"), and what-ifs on a plan worked out before any
 * card. Every figure here is invented.
 */
import { describe, expect, it } from "vitest";

import { answerChart, answerFigures, INVENTED } from "./answerChart";
import { chartReading } from "./chartAsk";
import { planWhatIfWords } from "./planWhatIf";

const DASH = String.fromCharCode(0x2014);

describe("figures read back out of an answer, exactly as written", () => {
  it("a list, with its total checked", () => {
    const c = answerChart("A made-up monthly budget:\n- **Snacks**: PHP 3,000.00\n- Fare: ₱1,200\n- Fun: PHP 800.50\nTotal: PHP 5,000.00", "chart that")!;
    expect(c.kind).toBe("bars");
    expect(c.rows.map((r) => [r.label, r.value])).toEqual([["Snacks", 300000], ["Fare", 120000], ["Fun", 80050]]);
    expect(c.total).toBe(500050);
    expect(c.scope).toContain("not entries in your ledger");
    expect(c.scope).toContain("The answer gives a total of PHP 5,000.00; its own parts add up to PHP 5,000.50.");
    expect(c.fromAnswer).toBe(true);
  });
  it("periods in order are a trend; a pie when asked; largest first otherwise", () => {
    const trend = answerChart("Savings, made up:\n- March: PHP 300\n- January: PHP 100\n- February: PHP 200\n- April: PHP 400", "chart that")!;
    expect(trend.kind).toBe("line");
    expect(trend.rows.map((r) => r.label)).toEqual(["January", "February", "March", "April"]);
    const pie = answerChart("Example:\n- A: 100\n- B: 200", "pie")!;
    expect(pie.kind).toBe("pie");
    expect(chartReading(pie)).toMatch(/^B is the largest, PHP 200\.00/);
  });
  it("two figures a line, or a table, are two series side by side", () => {
    const vs = answerChart("Plan A vs Plan B:\n- Snacks: PHP 400 vs PHP 300\n- Fare: PHP 120 vs PHP 90", "chart that")!;
    expect(vs.against).toMatchObject({ now: "Plan A", name: "Plan B", total: 39000 });
    expect(chartReading(vs)).toBe("Plan A comes to PHP 520.00 and Plan B to PHP 390.00: Plan A is PHP 130.00 more. The widest gap is Snacks: PHP 400.00 against PHP 300.00.");
    const table = answerChart("Made up:\n\n| Month | Income | Spending |\n|---|---|---|\n| January | 2,000 | 1,500 |\n| February | 2,200 | 1,800 |", "chart that")!;
    expect(table.against).toMatchObject({ now: "Income", name: "Spending" });
    expect(table.rows.map((r) => [r.label, r.value, r.previous])).toEqual([["January", 200000, 150000], ["February", 220000, 180000]]);
    expect(chartReading(table)).not.toContain(DASH);
  });
  it("draws nothing it cannot draw truthfully: one figure, or shares with no pesos", () => {
    expect(answerFigures("Only one:\n- Snacks: PHP 100")).toBeNull();
    expect(answerChart("A split:\n- Needs: 50%\n- Wants: 30%\n- Savings: 20%", "chart that")).toBeNull();
  });
  it("knows a request to make figures up", () => {
    expect(INVENTED.test("come up with random data for my spending")).toBe(true);
    expect(INVENTED.test("make up a sample budget")).toBe(true);
    expect(INVENTED.test("how much did I spend on food")).toBe(false);
  });
});

describe("a what-if on a plan, worked out before anything changes", () => {
  const month = { name: "December 2026", usual: 1_000_000, others: 0, income: 1_100_000 };
  it("skipping it: the month as it is, and after", () => {
    const words = planWhatIfWords({ title: "Speakers", left: 200_000, month, undated: false, heldNow: null, due: "sometime in December 2026" }, { kind: "skip" });
    expect(words).toContain("**If you skip \"Speakers\"** (now ₱2,000.00 to pay, sometime in December 2026):");
    expect(words).toContain("- December 2026 would cost about ₱10,000.00 instead of ₱12,000.00, against about ₱11,000.00 that usually comes in: ₱1,000.00 short as it is, ₱1,000.00 to spare after.");
    expect(words).toContain('Nothing is skipped yet. To do it, say "skip the speakers plan"');
    expect(words).not.toContain(DASH);
  });
  it("a new amount, this month's safe to spend, and a plan with no date", () => {
    expect(planWhatIfWords({ title: "Speakers", left: 200_000, month, undated: false, heldNow: null, due: "x" }, { kind: "amount", amount: 150_000 })).toContain("₱11,500.00 instead of ₱12,000.00");
    expect(planWhatIfWords({ title: "Shoes", left: 90_000, month: null, undated: false, heldNow: { daysLeft: 20 }, due: "x" }, { kind: "skip" })).toContain("₱900.00 would be free again: about ₱45.00 a day more for the 20 days left.");
    expect(planWhatIfWords({ title: "Fund", left: 500_000, month: null, undated: true, heldNow: null, due: "x" }, { kind: "skip" })).toContain("It has no date, so nothing is held back for it now");
  });
});
