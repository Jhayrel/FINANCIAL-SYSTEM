/**
 * Allocations, every what-if in docs/17-ALLOCATIONS.md A7, on invented rows.
 * The owner's own notes are the shapes: gas ₱300.00 a week for 4 weeks, the
 * gym ₱50.00 a time twice a week, tuition held as a plan.
 */
import { describe, expect, it } from "vitest";

import {
  addFormNote,
  allocationAlerts,
  checkAllocation,
  checkRestore,
  copyLines,
  countsAgainst,
  lineName,
  linesIn,
  makeAllocation,
  monthAllocations,
  monthWordsFor,
  normaliseAllocations,
  removedIn,
  renameAllocations,
  walletNeeds,
  weekDays,
  weekOfMonth,
  type AllocationLine,
} from "./monthAllocation";
import { monthBrief, nextMonthStart } from "./monthPlan";
import { makePlan } from "./planner";
import type { Budgets, ReferenceLists, Transaction } from "./types";

const asOf = "2026-11-04";
let n = 0;
const spend = (date: string, item: string, amount: number, over: Partial<Transaction> = {}): Transaction =>
  ({ id: `t${(n += 1)}`, recordNumber: n, date, type: "Spending", fromWallet: "Cash", toWallet: "", category: "Spending", item, description: "", amount, fee: 0, total: amount, notes: "", status: "Paid", ...over }) as Transaction;
const income = (date: string, wallet: string, amount: number): Transaction =>
  ({ id: `t${(n += 1)}`, recordNumber: n, date, type: "Revenue", fromWallet: "", toWallet: wallet, category: "Revenue", item: "Allowance", description: "", amount, fee: 0, total: amount, notes: "", status: "Received" }) as Transaction;

const reference = {
  wallets: ["Cash", "Gcash", "Maya"],
  savings: ["Extra Cash"],
  bills: ["Globe at Home Wifi"],
  subscriptions: ["Spotify"],
  revenueCategories: ["Allowance"],
  spendingTypes: ["Gas", "Parking", "Self Care", "Food", "School", "Fun"].map((name) => ({ name, remark: "" })),
  stopped: [],
} as unknown as ReferenceLists;

const id = (k: string): string => `a-${k}`;
const gas = makeAllocation({ kind: "Gas", amount: null, each: 30_000, times: 4, per: "week", wallet: "Cash" }, "2026-11", "2026-11-01", id("gas"));
const gym = makeAllocation({ name: "Gym", kind: "Self Care", words: "gym", amount: null, each: 5_000, times: 8, per: "time", wallet: "Cash" }, "2026-11", "2026-11-01", id("gym"));
const parking = makeAllocation({ kind: "Parking", amount: 40_000 }, "2026-11", "2026-11-01", id("park"));

const ledger: Transaction[] = [
  income("2026-11-01", "Cash", 500_000),
  income("2026-11-01", "Gcash", 300_000),
  spend("2026-11-03", "Gas", 30_000),
  spend("2026-11-02", "Self Care", 5_000, { description: "gym session" }),
  spend("2026-11-03", "Self Care", 5_000, { description: "Gym" }),
  spend("2026-11-03", "Self Care", 15_000, { description: "haircut" }),
  spend("2026-11-02", "Food", 12_000),
  // October, for the month before.
  spend("2026-10-10", "Gas", 80_000),
];

describe("what counts against an allocation (A4)", () => {
  it("its kind, and its words when it has any, as whole words", () => {
    expect(countsAgainst({ item: "Gas", description: "", notes: "" }, gas)).toBe(true);
    expect(countsAgainst({ item: "gas ", description: "", notes: "" }, gas)).toBe(true);
    expect(countsAgainst({ item: "Self Care", description: "gym session", notes: "" }, gym)).toBe(true);
    expect(countsAgainst({ item: "Self Care", description: "haircut", notes: "" }, gym)).toBe(false);
    expect(countsAgainst({ item: "Self Care", description: "", notes: "paid at the GYM" }, gym)).toBe(true);
    expect(countsAgainst({ item: "Self Care", description: "agymnast", notes: "" }, gym)).toBe(false);
    expect(lineName(gym)).toBe("Gym");
    expect(lineName(gas)).toBe("Gas");
  });
});

describe("the month, worked out from the ledger (A4, A5, A6)", () => {
  const month = monthAllocations([gas, gym, parking], ledger, "2026-11", asOf);
  const of = (lid: string) => month.lines.find((s) => s.line.id === lid)!;

  it("spent, left and held, to the centavo", () => {
    expect(of(id("gas"))).toMatchObject({ spent: 30_000, left: 90_000, over: 0, held: 90_000, entries: 1 });
    expect(of(id("gym"))).toMatchObject({ spent: 10_000, left: 30_000, held: 30_000, timesUsed: 2 });
    expect(of(id("park"))).toMatchObject({ spent: 0, left: 40_000, held: 40_000 });
    expect(month).toMatchObject({ allocated: 200_000, spent: 40_000, held: 160_000, over: 0 });
  });

  it("the week running: the 1st to the 7th is week 1, its ₱300.00 used", () => {
    expect(weekOfMonth("2026-11-04")).toBe(1);
    expect(weekOfMonth("2026-11-29")).toBe(5);
    expect(weekDays("2026-11", 4, 4)).toEqual({ from: "2026-11-22", to: "2026-11-30" });
    expect(of(id("gas")).week).toEqual({ index: 1, from: "2026-11-01", to: "2026-11-07", share: 30_000, spent: 30_000, left: 0 });
  });

  it("over: says how far, holds nothing more, and the bell says so", () => {
    const m = monthAllocations([gas], [...ledger, spend("2026-11-04", "Gas", 100_000)], "2026-11", asOf);
    expect(m.lines[0]).toMatchObject({ spent: 130_000, left: -10_000, over: 10_000, held: 0 });
    expect(allocationAlerts(m, [gas], asOf).map((a) => a.title)).toEqual(["Gas is ₱100.00 over its allocation"]);
  });

  it("past this week's share, not the month's: an info, and the month's amount unchanged", () => {
    const m = monthAllocations([gas], [...ledger, spend("2026-11-04", "Gas", 10_000)], "2026-11", asOf);
    expect(m.lines[0]!.week?.left).toBe(-10_000);
    expect(m.lines[0]!.left).toBe(80_000);
    expect(allocationAlerts(m, [gas], asOf)[0]).toMatchObject({ level: "info", title: "Gas is ₱100.00 past this week's share" });
  });

  it("a past month holds nothing and says what was not used; a month ahead holds nothing yet", () => {
    const oct = makeAllocation({ kind: "Gas", amount: 100_000 }, "2026-10", "2026-10-01", id("oct"));
    expect(monthAllocations([oct], ledger, "2026-10", asOf)).toMatchObject({ phase: "past", held: 0, spent: 80_000, unused: 20_000 });
    const dec = makeAllocation({ kind: "Gas", amount: 100_000 }, "2026-12", asOf, id("dec"));
    expect(monthAllocations([dec], ledger, "2026-12", asOf)).toMatchObject({ phase: "ahead", held: 0 });
  });

  it("added mid-month: what was spent from the 1st counts", () => {
    const late = makeAllocation({ kind: "Food", amount: 20_000 }, "2026-11", asOf, id("food"));
    expect(monthAllocations([late], ledger, "2026-11", asOf).lines[0]).toMatchObject({ spent: 12_000, held: 8_000 });
  });

  it("an entry binned, or edited to another kind, moves the money at once", () => {
    expect(monthAllocations([gas], ledger.filter((t) => t.item !== "Gas"), "2026-11", asOf).lines[0]!.spent).toBe(0);
    const moved = ledger.map((t) => (t.item === "Gas" && t.date.startsWith("2026-11") ? { ...t, item: "Fun" } : t));
    expect(monthAllocations([gas], moved, "2026-11", asOf).lines[0]!.spent).toBe(0);
    const binned = ledger.map((t) => (t.item === "Gas" ? ({ ...t, deletedAt: "2026-11-04T00:00:00Z" } as Transaction) : t));
    expect(monthAllocations([gas], binned, "2026-11", asOf).lines[0]!.spent).toBe(0);
  });

  it("a transfer counts only its fee", () => {
    const fee = { ...spend("2026-11-03", "Transaction Fee", 200_000), type: "Transfer", toWallet: "Gcash", fee: 1_500, total: 201_500 } as Transaction;
    const feeLine = { ...makeAllocation({ kind: "Food", amount: 2_000 }, "2026-11", asOf, id("x")), kind: "Transaction Fee" } as AllocationLine;
    expect(monthAllocations([feeLine], [fee], "2026-11", asOf).lines[0]!.spent).toBe(1_500);
  });
});

describe("safe to spend and the daily figures (A5)", () => {
  const ref = (allocations: readonly AllocationLine[], plans = [] as ReturnType<typeof makePlan>[]) => ({ ...reference, allocations, plans }) as ReferenceLists;
  const brief = (r: ReferenceLists, rows = ledger, day = asOf, budgets: Budgets = {}) => monthBrief({ transactions: rows, reference: r, budgets, debts: [], year: 2026, month: 11, asOf: day });

  it("no allocations: exactly as before, to the centavo", () => {
    const before = brief({ ...reference } as ReferenceLists).safe!;
    expect(brief(ref([])).safe!).toEqual(before);
    expect(before.reservedAllocations).toBeUndefined();
  });

  it("what is left of each is held: the figure is lower by exactly that", () => {
    const without = brief(ref([])).safe!;
    const withAlloc = brief(ref([gas, gym, parking])).safe!;
    expect(withAlloc.reservedAllocations).toBe(160_000);
    expect(withAlloc.free).toBe(without.free - 160_000);
    expect(withAlloc.safe).toBe(Math.max(0, without.free - 160_000));
  });

  it("gas bought out of its allocation moves nothing: safe to spend, today's share, today's figure, tomorrow's rate", () => {
    const before = brief(ref([gas])).safe!;
    const after = brief(ref([gas]), [...ledger, spend(asOf, "Gas", 30_000)]).safe!;
    expect(after.safe).toBe(before.safe);
    expect(after.spentToday).toBe(before.spentToday);
    expect(after.todayShare).toBe(before.todayShare);
    expect(after.perDay).toBe(before.perDay);
    expect(after.perDayAfter).toBe(before.perDayAfter);
  });

  it("nor the budget's day figure: the allocation is part of the budget, already spoken for", () => {
    const budgets = { "2026": { spending: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 600_000, 0], billsSubs: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] } } as unknown as Budgets;
    const none = brief(ref([]), ledger, asOf, budgets).safe!;
    const before = brief(ref([gas]), ledger, asOf, budgets).safe!;
    // ₱900.00 of gas still held: the budget's day figure is after it.
    expect(before.budgetPerDay).toBe(Math.floor(Math.max(0, (none.budgetLeft ?? 0) - 90_000) / before.daysLeft));
    const after = brief(ref([gas]), [...ledger, spend(asOf, "Gas", 30_000)], asOf, budgets).safe!;
    expect(after.budgetPerDay).toBe(before.budgetPerDay);
    // Past the allocation, the extra lowers it.
    const over = brief(ref([gas]), [...ledger, spend(asOf, "Gas", 100_000)], asOf, budgets).safe!;
    expect(over.budgetPerDay!).toBeLessThan(before.budgetPerDay!);
  });

  it("over the allocation: the extra comes out of safe to spend, and today's share sees it", () => {
    const before = brief(ref([gas])).safe!;
    const after = brief(ref([gas]), [...ledger, spend(asOf, "Gas", 100_000)]).safe!;
    expect(after.reservedAllocations).toBe(0);
    expect(after.safe).toBe(before.safe - 10_000);
    expect(after.spentToday).toBe(before.spentToday + 10_000);
  });

  it("removed: it stops holding at once, and put back it holds again", () => {
    const removed = { ...gas, removedOn: asOf };
    expect(brief(ref([removed])).safe!.safe).toBe(brief(ref([])).safe!.safe);
    expect(brief(ref([gas])).safe!.safe).toBeLessThan(brief(ref([removed])).safe!.safe);
  });

  it("a plan of the same kind is held once: the larger of the two", () => {
    const tuition = makePlan({ title: "Tuition", amount: 310_000, due: "2026-11-20", dueKind: "day", item: "School", wallet: "Cash", need: true, setAside: true, notes: "" }, asOf, "owner", "p-t");
    const school = makeAllocation({ kind: "School", amount: 300_000 }, "2026-11", asOf, id("school"));
    const both = brief(ref([school], [tuition])).safe!;
    expect(both.reservedPlans).toBe(0);
    expect(both.reservedAllocations).toBe(310_000);
    expect(both.allocations?.lines[0]?.plansInside.map((p) => p.title)).toEqual(["Tuition"]);
    const trip = makePlan({ title: "Trip", amount: 50_000, due: "2026-11-20", dueKind: "day", item: "Fun", wallet: "", need: false, setAside: true, notes: "" }, asOf, "owner", "p-f");
    expect(brief(ref([school], [tuition, trip])).safe!.reservedPlans).toBe(50_000);
  });

  it("more set aside than the wallets hold: nothing is safe, and it says by how much", () => {
    const big = makeAllocation({ kind: "Fun", amount: 900_000 }, "2026-11", asOf, id("fun"));
    const b = brief(ref([big]));
    expect(b.safe!.safe).toBe(0);
    expect(b.safe!.free).toBeLessThan(0);
    expect(b.warnings.join(" ")).toMatch(/allocations (?:still due or set aside|set aside) this month is ₱[\d,.]+ more than your wallets hold/);
  });

  it("next month's start counts next month's allocations, whole", () => {
    const now = brief(ref([gas])).safe!;
    const dec = makeAllocation({ kind: "Gas", amount: 120_000 }, "2026-12", asOf, id("dec"));
    const next = nextMonthStart({ transactions: ledger, reference: ref([gas, dec]), budgets: {}, debts: [], asOf }, now);
    expect(next.reservedAllocations).toBe(120_000);
    const none = nextMonthStart({ transactions: ledger, reference: ref([gas]), budgets: {}, debts: [], asOf }, now);
    expect(next.safe).toBe(Math.max(0, none.safe - 120_000));
  });
});

describe("making, changing, removing and putting back (A7)", () => {
  it("refuses a bill, a kind not on the list, no amount, and the same kind twice", () => {
    expect(checkAllocation({ kind: "Spotify", amount: 8_500 }, "2026-11", [], reference)).toMatch(/held already/);
    expect(checkAllocation({ kind: "Globe at Home Wifi", amount: 99_900 }, "2026-11", [], reference)).toMatch(/held already/);
    expect(checkAllocation({ kind: "Shoes", amount: 1_000 }, "2026-11", [], reference)).toMatch(/not one of your kinds/);
    expect(checkAllocation({ kind: "Food", amount: null }, "2026-11", [], reference)).toMatch(/Say how much/);
    expect(checkAllocation({ kind: "Gas", amount: 1_000 }, "2026-11", [gas], reference)).toMatch(/has an allocation for Gas already/);
    expect(checkAllocation({ kind: "Gas", words: "motor", amount: 1_000 }, "2026-11", [gas], reference)).toBeNull();
    expect(checkAllocation({ kind: "Gas", amount: 1_000 }, "2026-12", [gas], reference)).toBeNull();
    expect(checkAllocation({ kind: "Gas", amount: 1_000, wallet: "Nowhere" }, "2026-12", [gas], reference)).toMatch(/not one of your accounts/);
  });

  it("a removed line is kept and listed, holds nothing, and does not block a new one", () => {
    const removed = { ...gas, removedOn: asOf };
    expect(linesIn([removed], "2026-11")).toEqual([]);
    expect(removedIn([removed], "2026-11").map((l) => l.id)).toEqual([id("gas")]);
    expect(checkAllocation({ kind: "Gas", amount: 1_000 }, "2026-11", [removed], reference)).toBeNull();
    expect(monthAllocations([removed], ledger, "2026-11", asOf).held).toBe(0);
  });

  it("put back: refused only when a live line of the same kind is there", () => {
    const removed = { ...gas, removedOn: asOf };
    expect(checkRestore(removed, [removed])).toBeNull();
    const fresh = makeAllocation({ kind: "Gas", amount: 50_000 }, "2026-11", asOf, "fresh");
    expect(checkRestore(removed, [removed, fresh])).toMatch(/has an allocation for Gas already/);
  });

  it("each times how many is the month's amount", () => {
    expect(gas.amount).toBe(120_000);
    expect(gym.amount).toBe(40_000);
  });

  it("an amount below what is spent is allowed, and is over at once", () => {
    expect(monthAllocations([{ ...gas, amount: 10_000 }], ledger, "2026-11", asOf).lines[0]).toMatchObject({ over: 20_000, held: 0 });
  });

  it("copy last month: amounts and pace, not what was left; lines there kept; removed ones not copied", () => {
    const oct = [
      makeAllocation({ kind: "Gas", amount: 80_000, each: 20_000, times: 4, per: "week" }, "2026-10", "2026-10-01", "o1"),
      makeAllocation({ kind: "Parking", amount: 40_000 }, "2026-10", "2026-10-01", "o2"),
      { ...makeAllocation({ kind: "Fun", amount: 10_000 }, "2026-10", "2026-10-01", "o3"), removedOn: "2026-10-05" },
    ];
    let k = 0;
    expect(copyLines([...oct, gas], "2026-10", "2026-11", asOf, () => `new${(k += 1)}`).map((l) => [l.kind, l.amount, l.month, l.id])).toEqual([["Parking", 40_000, "2026-11", "new1"]]);
    expect(copyLines(oct, "2026-10", "2026-11", asOf, () => `x${(k += 1)}`).map((l) => [l.kind, l.amount, l.each, l.times])).toEqual([
      ["Gas", 80_000, 20_000, 4],
      ["Parking", 40_000, undefined, undefined],
    ]);
  });

  it("a kind renamed in Settings: the lines follow; a wallet renamed too", () => {
    expect(renameAllocations([gas, gym], "kind", "Gas", "Fuel").map((l) => l.kind)).toEqual(["Fuel", "Self Care"]);
    expect(renameAllocations([gas], "wallet", "Cash", "Pocket")[0]!.wallet).toBe("Pocket");
  });

  it("whatever comes back from storage: malformed lines left out, good ones kept with their removed day", () => {
    const raw = [gas, { id: "bad", month: "2026-11", kind: "Gas", amount: 12.5 }, { month: "x" }, null, { ...gym, per: "fortnight" }, { ...parking, removedOn: "2026-11-02" }];
    const out = normaliseAllocations(raw);
    expect(out.map((l) => l.id)).toEqual([id("gas"), id("gym"), id("park")]);
    expect(out[1]!.per).toBeUndefined();
    expect(out[2]!.removedOn).toBe("2026-11-02");
    expect(normaliseAllocations("nope")).toEqual([]);
  });
});

describe("need to withdraw, the Add form and the words (A8, A11)", () => {
  const month = monthAllocations([gas, gym, parking], ledger, "2026-11", asOf);
  it("each wallet's allocations against what it holds", () => {
    expect(walletNeeds(month, (w) => (w === "Cash" ? 50_000 : 0))).toEqual([{ wallet: "Cash", needs: 120_000, holds: 50_000, short: 70_000 }]);
    expect(walletNeeds(month, () => 500_000)[0]!.short).toBe(0);
  });

  it("the Add form: what is left, and over before saving", () => {
    expect(addFormNote(month, "Gas", { description: "", notes: "" }, 30_000)).toEqual({ text: "Gas allocation: ₱900.00 of ₱1,200.00 left (this week ₱0.00 of ₱300.00 left), ₱600.00 after this.", over: false });
    expect(addFormNote(month, "Gas", { description: "", notes: "" }, 100_000)).toEqual({
      text: "This takes Gas ₱100.00 over its ₱1,200.00 allocation: ₱900.00 of this is covered by what is left of it, and ₱100.00 comes out of safe to spend.",
      over: true,
    });
    // Already past it: the whole entry is out of safe to spend, said as its own figure.
    const past = monthAllocations([gas, gym, parking], [...ledger, spend("2026-11-04", "Gas", 100_000)], "2026-11", asOf);
    expect(addFormNote(past, "Gas", { description: "", notes: "" }, 20_000)).toEqual({
      text: "Gas is already ₱100.00 over its ₱1,200.00 allocation, so all ₱200.00 of this comes out of safe to spend.",
      over: true,
    });
    expect(addFormNote(past, "Gas", { description: "", notes: "" }, 0)?.over).toBe(true);
    expect(addFormNote(month, "Food", { description: "", notes: "" }, 100)).toBeNull();
  });

  it("said for the chat and the model", () => {
    const words = monthWordsFor(month);
    expect(words).toContain("Allocations for November 2026:");
    expect(words).toContain("- Gas: ₱300.00 spent of ₱1,200.00, ₱900.00 left (week 1: ₱300.00 of ₱300.00).");
    expect(words).toContain("- Gym: ₱100.00 spent of ₱400.00, ₱300.00 left (2 of 8 times).");
    expect(words).toContain("Allocated ₱2,000.00, spent ₱400.00; ₱1,600.00 is set aside out of safe to spend.");
  });

  it("the first week of a month with none, after one with some: the copy offer", () => {
    const oct = makeAllocation({ kind: "Gas", amount: 80_000 }, "2026-10", "2026-10-01", "o1");
    const empty = monthAllocations([oct], ledger, "2026-11", asOf);
    expect(allocationAlerts(empty, [oct], asOf).map((a) => a.title)).toEqual(["No allocations for November 2026 yet"]);
    expect(allocationAlerts(empty, [oct], "2026-11-12")).toEqual([]);
  });
});

describe("stress", () => {
  it("30 lines a month for a year, against 40,000 entries, in well under a second", () => {
    const kinds = Array.from({ length: 30 }, (_, i) => `Kind ${i}`);
    const lines: AllocationLine[] = [];
    for (let m = 1; m <= 12; m += 1) for (const k of kinds) lines.push(makeAllocation({ kind: k, amount: 100_000 }, `2026-${String(m).padStart(2, "0")}`, asOf, `${m}-${k}`));
    const rows: Transaction[] = [];
    for (let i = 0; i < 40_000; i += 1) rows.push(spend(`2026-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`, kinds[i % 30]!, 100 + (i % 500)));
    const started = performance.now();
    const month = monthAllocations(lines, rows, "2026-11", asOf);
    expect(month.lines).toHaveLength(30);
    expect(month.spent).toBe(rows.filter((t) => t.date.startsWith("2026-11")).reduce((s, t) => s + t.amount, 0));
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});
