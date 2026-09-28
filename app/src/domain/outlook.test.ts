/**
 * The months ahead, as the Budget screen plans them (`outlook.ts`).
 *
 * 28 September 2026, the owner, of the forecast it replaced: "fix the
 * forecast that will be also the realistic basis for alloting budget ... it
 * should know really well my spending habits". These pin what makes it
 * realistic: every month ahead read from the same recent months, one-offs
 * left out of the usual month but shown beside it, stopped bills left out,
 * last year's same month named and not added, and words from the device and
 * facts for the model that carry the same figures.
 */

import { describe, expect, it } from "vitest";

import { formatMoney } from "./money";
import { monthsSaid, outlookAhead, outlookFacts, outlookFor, outlookWords } from "./outlook";
import { onlyTheirFigures } from "./spendNote";
import type { Budgets, Transaction } from "./types";

let n = 0;
const row = (over: Partial<Transaction>): Transaction => {
  n += 1;
  return {
    id: `o-${n}`,
    recordNumber: n,
    date: "2026-08-01",
    type: "Spending",
    fromWallet: "Cash",
    toWallet: "",
    category: "Spending",
    item: "Food",
    description: "",
    amount: 10_000,
    fee: 0,
    total: 10_000,
    notes: "",
    status: "Paid",
    ...over,
  };
};
const spend = (date: string, item: string, pesos: number): Transaction => row({ date, item, amount: pesos * 100, total: pesos * 100 });
const bill = (date: string, item: string, pesos: number, category: "Bills" | "Subscriptions"): Transaction =>
  row({ date, item, category, amount: pesos * 100, total: pesos * 100 });
const earn = (date: string, pesos: number): Transaction =>
  row({ date, type: "Revenue", category: "Revenue", item: "Allowance", fromWallet: "", toWallet: "Cash", amount: pesos * 100, total: pesos * 100 });

const twelve = (v: number) => [v, v, v, v, v, v, v, v, v, v, v, v] as unknown as Budgets[string]["spending"];

const months = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
const food = [2_000, 1_500, 1_000, 1_200, 1_800, 1_600];
const ledger: Transaction[] = [
  ...months.map((m, i) => spend(`${m}-05`, "Food", food[i] ?? 0)),
  ...months.map((m) => bill(`${m}-12`, "Wifi", 999, "Bills")),
  ...months.map((m) => bill(`${m}-15`, "Netflix", 149, "Subscriptions")),
  ...months.map((m) => earn(`${m}-01`, 8_000)),
  // One Shopee order: not a normal month.
  spend("2026-05-01", "Online Buy", 30_978),
  // Last December held tuition; this year's usual month has none.
  spend("2025-12-10", "School", 5_000),
];
const stopped = [{ name: "Netflix", since: "2026-09-20" }];
const ASOF = "2026-09-28";

describe("the months ahead", () => {
  const ahead = outlookAhead(ledger, {}, ASOF, 3, { stopped });
  const [october, november, december] = ahead;

  it("plans the next three months, each read from the same recent months", () => {
    expect(ahead.map((o) => o.name)).toEqual(["October 2026", "November 2026", "December 2026"]);
    expect(october?.read).toEqual(months);
    expect(december?.read).toEqual(october?.read);
  });

  it("is the usual month: each item at its median, the one-off left out", () => {
    // Food's median over the six months is 1,550.00, already a round PHP 50.00.
    expect(october?.spending).toBe(155_000);
    expect(october?.advice.items.map((l) => l.name)).toEqual(["Food"]);
  });

  it("leaves a stopped subscription out of the bills", () => {
    // Wifi at its last amount, and Netflix, stopped on the 20th, not at all.
    expect(october?.billsSubs).toBe(99_900);
    expect(october?.total).toBe(254_900);
  });

  it("says what a month with one-offs came to, without adding it", () => {
    // The months' spending as they went, sorted: 1,000 1,200 1,600 1,800 2,000 32,478. The middle is 1,700.
    expect(october?.withExtras).toBe(170_000);
    expect(october?.low).toBe(october?.spending);
  });

  it("works out what is left from what usually comes in", () => {
    expect(october?.income).toBe(800_000);
    expect(october?.left).toBe(800_000 - 254_900);
  });

  it("names what last year's same month held, and does not add it to the plan", () => {
    expect(december?.seasonal).toEqual([{ item: "School", lastYear: 500_000, usual: 0 }]);
    expect(december?.total).toBe(november?.total);
    expect(december?.high).toBe(155_000 + 500_000);
    expect(november?.seasonal).toEqual([]);
  });

  it("crosses the end of the year with the same months read", () => {
    const late = outlookAhead(ledger, {}, "2026-11-28", 3, { stopped });
    expect(late.map((o) => o.name)).toEqual(["December 2026", "January 2027", "February 2027"]);
    expect(late[2]?.read).toEqual(late[0]?.read);
  });

  it("leaves out a month that has barely started", () => {
    const early = outlookFor([...ledger, spend("2026-10-02", "Food", 50)], {}, 2026, 11, "2026-10-03", { stopped });
    expect(early.read).not.toContain("2026-10");
    const later = outlookFor([...ledger, spend("2026-10-02", "Food", 50)], {}, 2026, 11, "2026-10-25", { stopped });
    expect(later.read).toContain("2026-10");
  });

  it("ignores deleted entries", () => {
    const withDeleted = [...ledger, { ...spend("2026-08-20", "Food", 90_000), deletedAt: "2026-08-21T00:00:00Z" } as Transaction];
    expect(outlookAhead(withDeleted, {}, ASOF, 1, { stopped })[0]?.spending).toBe(155_000);
  });
});

describe("against the budget set", () => {
  const budgets: Budgets = { "2026": { spending: twelve(150_000), billsSubs: twelve(50_000) } };
  const [october] = outlookAhead(ledger, budgets, ASOF, 1, { stopped });

  it("carries the budget set for the month", () => {
    expect(october?.budget).toEqual({ spending: 150_000, billsSubs: 50_000, total: 200_000 });
  });

  it("says how far under a usual month it is, in the words and the facts", () => {
    const list = outlookAhead(ledger, budgets, ASOF, 3, { stopped });
    const words = outlookWords(list, formatMoney);
    expect(words).toContain("The budget for October to December 2026 of ₱2,000.00 is, each month, ₱549.00 under a usual month.");
    expect(outlookFacts(list, formatMoney).join(" ")).toContain("₱549.00 under a usual month");
  });
});

describe("in words", () => {
  const list = outlookAhead(ledger, {}, ASOF, 3, { stopped });
  const words = outlookWords(list, formatMoney);
  const facts = outlookFacts(list, formatMoney);

  it("says the usual month, what comes in and what is left", () => {
    expect(words).toContain("A usual month costs about ₱2,549.00: ₱1,550.00 of spending and ₱999.00 of bills and subscriptions");
    expect(words).toContain("half your months spent ₱1,700.00 or more");
    expect(words).toContain("It usually brings in ₱8,000.00, which leaves about ₱5,451.00.");
    expect(words).toContain("October to December 2026 have no budget yet.");
    expect(words).toContain("Last December also had School ₱5,000.00 (usually ₱0.00): if it comes again, plan for it.");
  });

  it("says alike months once", () => {
    expect(facts.filter((f) => f.startsWith("October to December 2026, each:"))).toHaveLength(1);
    expect(facts.some((f) => f.startsWith("November 2026:"))).toBe(false);
  });

  it("gives the model every figure the device says, so its words can be checked against them", () => {
    expect(onlyTheirFigures(words, facts, 2_000)).toBe(true);
    expect(onlyTheirFigures("Plan for ₱9,999.00 a month.", facts, 2_000)).toBe(false);
  });
});

describe("naming the months", () => {
  const at = (year: number, month: number) => outlookFor(ledger, {}, year, month, ASOF, { stopped });

  it("says a run of months the way a person would", () => {
    expect(monthsSaid([at(2026, 10)])).toBe("October 2026");
    expect(monthsSaid([at(2026, 10), at(2026, 11)])).toBe("October and November 2026");
    expect(monthsSaid([at(2026, 10), at(2026, 11), at(2026, 12)])).toBe("October to December 2026");
    expect(monthsSaid([at(2026, 12), at(2027, 1)])).toBe("December 2026 and January 2027");
  });
});

describe("a long history", () => {
  it("plans a year ahead over twenty thousand entries quickly", () => {
    const big: Transaction[] = [];
    for (let y = 2022; y <= 2026; y += 1) {
      for (let m = 1; m <= (y === 2026 ? 9 : 12); m += 1) {
        const k = `${y}-${String(m).padStart(2, "0")}`;
        for (let d = 1; d <= 28; d += 1) {
          for (const item of ["Food", "Transport", "Load", "Snacks", "Home Needs", "School", "Online Buy", "Treat", "Gas", "Coffee", "Rice", "Medicine", "Fare", "Laundry"]) {
            big.push(spend(`${k}-${String(d).padStart(2, "0")}`, item, 25 + ((d * 7 + m) % 40)));
          }
        }
      }
    }
    expect(big.length).toBeGreaterThan(20_000);
    const t0 = performance.now();
    const list = outlookAhead(big, {}, ASOF, 12, {});
    const took = performance.now() - t0;
    expect(list).toHaveLength(12);
    expect(list[0]?.total).toBeGreaterThan(0);
    expect(took).toBeLessThan(3_000);
  });
});
