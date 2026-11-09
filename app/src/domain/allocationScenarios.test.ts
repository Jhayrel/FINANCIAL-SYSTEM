/**
 * What-if scenarios for allocations (docs/17-ALLOCATIONS.md), on invented
 * rows: the owner, 9 November 2026, "run a deep scenario analysis and what
 * if scenario and if not pass fix it". Each names the situation, then what
 * the app must do. The last block runs 300 random ledgers against the
 * promises every one of them has to keep.
 */
import { describe, expect, it } from "vitest";

import { spreadCovered } from "./covers";
import {
  allocationAlerts,
  checkAllocation,
  copyLines,
  entryAllocationNote,
  lineFor,
  makeAllocation,
  monthAllocations,
  renameAllocations,
  walletNeeds,
  MAX_LINES_A_MONTH,
  type AllocationLine,
} from "./monthAllocation";
import { monthBrief, nextMonthStart } from "./monthPlan";
import { costOf } from "./totals";
import type { Budgets, ReferenceLists, Transaction } from "./types";

const asOf = "2026-11-09";
let n = 0;
const row = (over: Partial<Transaction> & Pick<Transaction, "date" | "item" | "amount">): Transaction => {
  n += 1;
  const fee = over.fee ?? 0;
  return { id: `t${n}`, recordNumber: n, type: "Spending", fromWallet: "Cash", toWallet: "", category: "Spending", description: "", notes: "", status: "Paid", fee, total: over.amount + fee, ...over } as Transaction;
};
const spend = (date: string, item: string, amount: number, over: Partial<Transaction> = {}): Transaction => row({ date, item, amount, ...over });
const income = (date: string, wallet: string, amount: number): Transaction =>
  row({ date, item: "Allowance", amount, type: "Revenue", category: "Revenue", fromWallet: "", toWallet: wallet, status: "Received" } as Partial<Transaction> & Pick<Transaction, "date" | "item" | "amount">);

const base: ReferenceLists = {
  wallets: ["Cash", "Gcash", "Maya"],
  savings: ["Savings"],
  bills: ["Globe"],
  subscriptions: ["Spotify"],
  revenueCategories: ["Allowance"],
  spendingTypes: ["Gas", "Parking", "Self Care", "Food", "Fun", "School", "Fuel"].map((name) => ({ name, remark: "" })),
  stopped: [],
} as unknown as ReferenceLists;
const ref = (allocations: readonly AllocationLine[]): ReferenceLists => ({ ...base, allocations }) as ReferenceLists;
const budgets = { "2026": { spending: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1_000_000, 1_200_000], billsSubs: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] } } as unknown as Budgets;
const brief = (lines: readonly AllocationLine[], rows: readonly Transaction[], day = asOf) =>
  monthBrief({ transactions: rows, reference: ref(lines), budgets, debts: [], year: Number(day.slice(0, 4)), month: Number(day.slice(5, 7)), asOf: day }).safe!;

const line = (input: Parameters<typeof makeAllocation>[0], ym = "2026-11", created = "2026-11-01", id = `a${(n += 1)}`) => makeAllocation(input, ym, created, id);

const ledger: Transaction[] = [
  income("2026-11-01", "Cash", 600_000),
  income("2026-11-01", "Gcash", 300_000),
  spend("2026-11-03", "Gas", 30_000),
  spend("2026-11-03", "Self Care", 15_000, { description: "haircut" }),
  spend("2026-11-04", "Self Care", 5_000, { description: "gym" }),
  spend("2026-11-05", "Food", 20_000, { fromWallet: "Gcash" }),
];

describe("two allocations on one kind: each entry counts once", () => {
  const selfCare = line({ kind: "Self Care", amount: 100_000 });
  const gym = line({ name: "Gym", kind: "Self Care", words: "gym", amount: 40_000 }, "2026-11", "2026-11-02");

  it("the gym entry goes to Gym, the haircut to Self Care, never both", () => {
    const m = monthAllocations([selfCare, gym], ledger, "2026-11", asOf);
    const of = (l: AllocationLine) => m.lines.find((s) => s.line.id === l.id)!;
    expect(of(selfCare)).toMatchObject({ spent: 15_000, held: 85_000 });
    expect(of(gym)).toMatchObject({ spent: 5_000, held: 35_000 });
    expect(m.held).toBe(120_000);
  });

  it("spending ₱100.00 at the gym inside its allocation leaves safe to spend where it was (it rose by ₱100.00 before)", () => {
    const before = brief([selfCare, gym], ledger);
    const after = brief([selfCare, gym], [...ledger, spend(asOf, "Self Care", 10_000, { description: "gym" })]);
    expect(after.safe).toBe(before.safe);
    expect(after.perDay).toBe(before.perDay);
  });

  it("the words line wins whichever was made first", () => {
    expect(lineFor({ item: "Self Care", description: "gym", notes: "" }, [gym, selfCare])).toBe(gym);
    expect(lineFor({ item: "Self Care", description: "gym", notes: "" }, [selfCare, gym])).toBe(gym);
    expect(lineFor({ item: "Self Care", description: "nails", notes: "" }, [gym, selfCare])).toBe(selfCare);
    expect(lineFor({ item: "Self Care", description: "nails", notes: "" }, [gym])).toBeNull();
  });

  it("two lines with words that overlap: the first made takes the entry", () => {
    const wellness = line({ name: "Wellness", kind: "Self Care", words: "gym, spa", amount: 50_000 }, "2026-11", "2026-11-03");
    const m = monthAllocations([wellness, gym], [...ledger, spend("2026-11-06", "Self Care", 8_000, { description: "spa" })], "2026-11", asOf);
    expect(m.lines.find((s) => s.line.id === gym.id)!.spent).toBe(5_000);
    expect(m.lines.find((s) => s.line.id === wellness.id)!.spent).toBe(8_000);
  });

  it("the Add form names the line the entry will count against", () => {
    const note = entryAllocationNote([selfCare, gym], ledger, [spend(asOf, "Self Care", 5_000, { description: "gym" })], null, asOf);
    expect(note?.text).toMatch(/^Gym allocation: ₱350\.00 of ₱400\.00 left, ₱300\.00 after this\.$/);
  });
});

describe("the same allocation twice (two phones offline, or a merge)", () => {
  const gasA = line({ kind: "Gas", amount: 120_000 }, "2026-11", "2026-11-01", "gas-a");
  const gasB = line({ kind: "Gas", amount: 100_000 }, "2026-11", "2026-11-02", "gas-b");

  it("the first made counts; the second holds nothing and is said, never removed by itself", () => {
    for (const order of [[gasA, gasB], [gasB, gasA]]) {
      const m = monthAllocations(order, ledger, "2026-11", asOf);
      const a = m.lines.find((s) => s.line.id === "gas-a")!;
      const b = m.lines.find((s) => s.line.id === "gas-b")!;
      expect(a).toMatchObject({ spent: 30_000, held: 90_000, twinOf: null });
      expect(b).toMatchObject({ spent: 0, held: 0, twinOf: "Gas" });
      expect(m.allocated).toBe(120_000);
      expect(m.held).toBe(90_000);
      expect(allocationAlerts(m, order, asOf).map((x) => x.title)).toContain("Gas is allocated twice in November 2026");
    }
  });

  it("safe to spend is what it is with the first alone", () => {
    expect(brief([gasA, gasB], ledger).safe).toBe(brief([gasA], ledger).safe);
  });

  it("a kind renamed onto one that has its own allocation is a twin too", () => {
    const fuel = line({ kind: "Fuel", amount: 50_000 }, "2026-11", "2026-11-05", "fuel");
    const renamed = renameAllocations([gasA, fuel], "kind", "Fuel", "Gas");
    const m = monthAllocations(renamed, ledger, "2026-11", asOf);
    expect(m.lines.find((s) => s.line.id === "fuel")!.twinOf).toBe("Gas");
  });

  it("copied to next month once", () => {
    expect(copyLines([gasA, gasB], "2026-11", "2026-12", asOf, () => `c${(n += 1)}`)).toHaveLength(1);
  });

  it("a twin by case or spacing is refused at the form", () => {
    const why = checkAllocation({ kind: "gas", words: "  ", amount: 1_000 }, "2026-11", [gasA], base);
    expect(why).toMatch(/already/);
  });
});

describe("where the money came from, and when", () => {
  const gas = line({ kind: "Gas", amount: 120_000, wallet: "Cash" });

  it("gas paid from savings: the allocation needs less, the spending wallets did not move, so safe to spend rises by it", () => {
    const before = brief([gas], ledger);
    const after = brief([gas], [...ledger, spend(asOf, "Gas", 30_000, { fromWallet: "Savings" })]);
    expect(after.wallets).toBe(before.wallets);
    expect(after.reservedAllocations).toBe((before.reservedAllocations ?? 0) - 30_000);
    expect(after.safe).toBe(before.safe + 30_000);
    // Today's spending is the spending wallets': unchanged.
    expect(after.spentToday).toBe(before.spentToday);
  });

  it("gas dated later this month: wallets and the allocation both take it now; today is untouched", () => {
    const before = brief([gas], ledger);
    const after = brief([gas], [...ledger, spend("2026-11-20", "Gas", 30_000)]);
    expect(after.safe).toBe(before.safe);
    expect(after.perDay).toBe(before.perDay);
    expect(after.spentToday).toBe(before.spentToday);
  });

  it("gas dated last month: November's allocation is untouched and the wallets are lower", () => {
    const before = brief([gas], ledger);
    const after = brief([gas], [...ledger, spend("2026-10-28", "Gas", 30_000)]);
    expect(after.reservedAllocations).toBe(before.reservedAllocations);
    expect(after.safe).toBe(before.safe - 30_000);
  });

  it("an entry over several days counts each day's share in its own month, once", () => {
    const trip = spend("2026-10-30", "Gas", 40_000, { coversTo: "2026-11-02" } as Partial<Transaction>);
    const m = monthAllocations([gas], spreadCovered([...ledger, trip]), "2026-11", asOf);
    expect(m.lines[0]).toMatchObject({ spent: 30_000 + 20_000, entries: 2 });
  });

  it("money sent out under the kind counts amount and fee; a move between your own accounts only its fee", () => {
    const fun = line({ kind: "Fun", amount: 100_000 });
    const sent = row({ date: "2026-11-06", item: "Fun", amount: 20_000, fee: 1_500, type: "Transfer", fromWallet: "Gcash", toWallet: "" } as Partial<Transaction> & Pick<Transaction, "date" | "item" | "amount">);
    const moved = row({ date: "2026-11-06", item: "Fun", amount: 50_000, fee: 1_000, type: "Transfer", fromWallet: "Gcash", toWallet: "Maya" } as Partial<Transaction> & Pick<Transaction, "date" | "item" | "amount">);
    const m = monthAllocations([fun], [...ledger, sent, moved], "2026-11", asOf);
    expect(costOf(sent)).toBe(21_500);
    expect(costOf(moved)).toBe(1_000);
    expect(m.lines[0]!.spent).toBe(22_500);
  });
});

describe("today: within, partly past, and two at once", () => {
  const gas = line({ kind: "Gas", amount: 120_000 });
  const spentAlready = [...ledger, spend("2026-11-07", "Gas", 70_000)]; // ₱1,000.00 spent, ₱200.00 left

  it("₱500.00 with ₱200.00 left: ₱300.00 comes out of safe to spend and today's share", () => {
    const before = brief([gas], spentAlready);
    const after = brief([gas], [...spentAlready, spend(asOf, "Gas", 50_000)]);
    expect(after.allocations!.coveredToday).toBe(20_000);
    expect(after.spentToday).toBe(before.spentToday + 30_000);
    expect(after.safe).toBe(before.safe - 30_000);
  });

  it("two entries today, ₱150.00 each, with ₱200.00 left: ₱100.00 past it", () => {
    const before = brief([gas], spentAlready);
    const after = brief([gas], [...spentAlready, spend(asOf, "Gas", 15_000), spend(asOf, "Gas", 15_000)]);
    expect(after.allocations!.coveredToday).toBe(20_000);
    expect(after.spentToday).toBe(before.spentToday + 10_000);
    expect(after.safe).toBe(before.safe - 10_000);
  });

  it("within it on a day already over today's share: the gas changes nothing more", () => {
    const busy = [...ledger, spend(asOf, "Food", 80_000)];
    const before = brief([gas], busy);
    const after = brief([gas], [...busy, spend(asOf, "Gas", 30_000)]);
    expect(after.safe).toBe(before.safe);
    expect(after.perDay).toBe(before.perDay);
    expect(after.overToday).toBe(before.overToday);
  });

  it("the last day of the month: within changes nothing", () => {
    const day = "2026-11-30";
    const before = brief([gas], ledger, day);
    const after = brief([gas], [...ledger, spend(day, "Gas", 30_000)], day);
    expect(after.daysLeft).toBe(1);
    expect(after.perDay).toBe(before.perDay);
  });
});

describe("edits, bins and kinds changed", () => {
  const gas = line({ kind: "Gas", amount: 120_000 });
  const g = spend("2026-11-06", "Gas", 30_000);
  const rows = [...ledger, g];

  it("an edit from ₱300.00 to ₱1,500.00 that goes ₱300.00 past it lowers safe to spend by ₱300.00 more than it was", () => {
    // Gas spent: ₱300.00 + ₱300.00 = ₱600.00; edited, ₱300.00 + ₱1,500.00 = ₱1,800.00, ₱600.00 over.
    const before = brief([gas], rows);
    const after = brief([gas], [...ledger, { ...g, amount: 150_000, total: 150_000 }]);
    expect(after.safe).toBe(before.safe - 120_000 + 60_000);
    expect(after.allocations!.lines[0]!.over).toBe(60_000);
  });

  it("binning a counted entry: the wallet gets it back and the allocation holds it again, so safe to spend is unchanged", () => {
    expect(brief([gas], ledger).safe).toBe(brief([gas], rows).safe);
  });

  it("a binned row that is still in the list is not counted", () => {
    const binned = { ...g, deletedAt: "2026-11-08" } as Transaction;
    expect(monthAllocations([gas], [...ledger, binned], "2026-11", asOf).lines[0]!.spent).toBe(30_000);
  });

  it("an entry moved from Gas to Food: the gas money is held again, so safe to spend falls by it", () => {
    expect(brief([gas], [...ledger, { ...g, item: "Food" }]).safe).toBe(brief([gas], rows).safe - 30_000);
  });

  it("the Add form, editing ₱300.00 to ₱350.00: counted as ₱350.00 against the rest, not ₱350.00 on top of ₱300.00", () => {
    const note = entryAllocationNote([gas], rows, [{ ...g, amount: 35_000, total: 35_000 }], g.id, asOf);
    expect(note?.text).toBe("Gas allocation: ₱900.00 of ₱1,200.00 left, ₱550.00 after this.");
  });

  it("the Add form for an entry over several days counts this month's days only", () => {
    const span = spend("2026-11-29", "Gas", 30_000, { coversTo: "2026-12-01" } as Partial<Transaction>);
    const note = entryAllocationNote([gas], ledger, [span], null, asOf);
    // Two of three days in November: ₱200.00.
    expect(note?.text).toBe("Gas allocation: ₱900.00 of ₱1,200.00 left, ₱700.00 after this.");
  });

  it("the Add form for an entry in a month that has ended says nothing", () => {
    expect(entryAllocationNote([gas], ledger, [spend("2026-10-15", "Gas", 1_000)], null, asOf)).toBeNull();
  });
});

describe("changing the allocations themselves", () => {
  it("removed mid-month: safe to spend rises by exactly what it held", () => {
    const gas = line({ kind: "Gas", amount: 120_000 });
    const held = brief([gas], ledger);
    const removed = brief([{ ...gas, removedOn: asOf }], ledger);
    expect(removed.safe).toBe(held.safe + (held.reservedAllocations ?? 0));
  });

  it("removing one that is over changes nothing: it held nothing", () => {
    const small = line({ kind: "Gas", amount: 10_000 });
    expect(brief([{ ...small, removedOn: asOf }], ledger).safe).toBe(brief([small], ledger).safe);
  });

  it("set below what is spent: over at once, holds nothing", () => {
    const small = line({ kind: "Gas", amount: 20_000 });
    expect(monthAllocations([small], ledger, "2026-11", asOf).lines[0]).toMatchObject({ over: 10_000, held: 0 });
  });

  it("the 31st line in a month is refused, and a copy stops at 30", () => {
    const many = Array.from({ length: MAX_LINES_A_MONTH }, (_, i) => line({ kind: "Fun", words: `w${i}`, amount: 100 }));
    expect(checkAllocation({ kind: "Food", amount: 1_000 }, "2026-11", many, base)).toMatch(/30 allocations/);
    const oct = many.map((l) => ({ ...l, month: "2026-10" }));
    expect(copyLines([...oct, ...many.slice(0, 5).map((l) => ({ ...l, words: `${l.words}x` }))], "2026-10", "2026-11", asOf, () => `k${(n += 1)}`)).toHaveLength(25);
  });
});

describe("month and year edges", () => {
  it("February: four weeks, the fourth the 22nd to the 28th", () => {
    const gas = line({ kind: "Gas", amount: null, each: 30_000, times: 4, per: "week" }, "2027-02", "2027-02-01");
    const m = monthAllocations([gas], [spend("2027-02-25", "Gas", 10_000)], "2027-02", "2027-02-28");
    expect(m.lines[0]!.week).toMatchObject({ index: 4, from: "2027-02-22", to: "2027-02-28", spent: 10_000 });
  });

  it("four weeks in a 31-day month: the 29th to the 31st are week 4's", () => {
    const gas = line({ kind: "Gas", amount: null, each: 30_000, times: 4, per: "week" }, "2026-12", "2026-12-01");
    const m = monthAllocations([gas], [spend("2026-12-23", "Gas", 10_000), spend("2026-12-30", "Gas", 10_000)], "2026-12", "2026-12-31");
    expect(m.lines[0]!.week).toMatchObject({ index: 4, from: "2026-12-22", to: "2026-12-31", spent: 20_000 });
  });

  it("five weeks: the fifth is the 29th to the 31st", () => {
    const gas = line({ kind: "Gas", amount: null, each: 30_000, times: 5, per: "week" }, "2026-12", "2026-12-01");
    expect(monthAllocations([gas], [], "2026-12", "2026-12-30").lines[0]!.week).toMatchObject({ index: 5, from: "2026-12-29", to: "2026-12-31" });
  });

  it("a time pace used more times than planned: counted, and over by the money", () => {
    const gym = line({ kind: "Self Care", words: "gym", amount: null, each: 5_000, times: 8, per: "time" });
    const visits = Array.from({ length: 9 }, (_, i) => spend(`2026-11-0${(i % 9) + 1}`, "Self Care", 5_000, { description: "gym" }));
    expect(monthAllocations([gym], visits, "2026-11", asOf).lines[0]).toMatchObject({ timesUsed: 9, over: 5_000 });
  });

  it("over the new year: January's allocations count in From 1 January, and the copy offer looks back to December", () => {
    const dec = line({ kind: "Gas", amount: 120_000 }, "2026-12", "2026-12-01");
    const jan = line({ kind: "Gas", amount: 100_000 }, "2027-01", "2026-12-30");
    const rows = [income("2026-12-01", "Cash", 500_000)];
    const now = monthBrief({ transactions: rows, reference: ref([dec, jan]), budgets: {}, debts: [], year: 2026, month: 12, asOf: "2026-12-30" }).safe!;
    const next = nextMonthStart({ transactions: rows, reference: ref([dec, jan]), budgets: {}, debts: [], asOf: "2026-12-30" }, now);
    expect(next.reservedAllocations).toBe(100_000);
    const january = monthAllocations([dec], rows, "2027-01", "2027-01-03");
    expect(allocationAlerts(january, [dec], "2027-01-03").map((a) => a.title)).toEqual(["No allocations for January 2027 yet"]);
  });

  it("a month that ended holds nothing and says what was not used", () => {
    const oct = line({ kind: "Gas", amount: 120_000 }, "2026-10", "2026-10-01");
    expect(monthAllocations([oct], [spend("2026-10-05", "Gas", 30_000)], "2026-10", asOf)).toMatchObject({ phase: "past", held: 0, unused: 90_000 });
  });
});

describe("need to withdraw", () => {
  it("a wallet below zero needs the whole of what it holds for", () => {
    const gas = line({ kind: "Gas", amount: 120_000, wallet: "Cash" });
    const m = monthAllocations([gas], ledger, "2026-11", asOf);
    expect(walletNeeds(m, () => -5_000)).toEqual([{ wallet: "Cash", needs: 90_000, holds: -5_000, short: 90_000 }]);
  });
});

// ── 300 random ledgers ─────────────────────────────────────────────────────

/** A small seeded generator, so a failure can be run again exactly. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("300 random months: the promises hold every time", () => {
  const kinds = ["Gas", "Parking", "Self Care", "Food", "Fun"];
  const wallets = ["Cash", "Gcash", "Maya", "Savings"];
  const words = ["", "", "gym", "spa", "lunch"];

  it("within an allocation nothing moves; past it, safe to spend falls by exactly the part past it; no entry counts twice", () => {
    for (let seed = 1; seed <= 300; seed += 1) {
      const r = seeded(seed);
      const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
      const rows: Transaction[] = [income("2026-11-01", "Cash", 400_000 + Math.floor(r() * 800_000)), income("2026-11-01", "Gcash", Math.floor(r() * 300_000))];
      for (let i = 0; i < 25; i += 1) {
        const day = `2026-11-${String(1 + Math.floor(r() * 9)).padStart(2, "0")}`;
        rows.push(spend(day, pick(kinds), 100 + Math.floor(r() * 30_000), { fromWallet: pick(wallets), description: pick(["", "gym", "spa", "lunch", "snacks"]) }));
      }
      const lines: AllocationLine[] = [];
      for (let i = 0; i < 1 + Math.floor(r() * 5); i += 1) {
        const input = { kind: pick(kinds), words: pick(words), amount: 10_000 + Math.floor(r() * 150_000) };
        if (!checkAllocation(input, "2026-11", lines, base)) lines.push(line(input, "2026-11", `2026-11-0${1 + (i % 9)}`, `s${seed}-${i}`));
      }
      const before = brief(lines, rows);
      const m = before.allocations ?? monthAllocations(lines, rows, "2026-11", asOf);

      // No entry counted twice: what the lines say was spent is never more than the entries cost.
      const counted = m.lines.reduce((s, l) => s + l.spent, 0);
      const ofKinds = rows.filter((t) => t.type === "Spending" && lines.some((l) => l.kind === t.item)).reduce((s, t) => s + costOf(t), 0);
      expect(counted, `seed ${seed}`).toBeLessThanOrEqual(ofKinds);
      expect(m.held, `seed ${seed}`).toBe(m.lines.reduce((s, l) => s + (l.twinOf ? 0 : Math.max(0, l.left)), 0));

      // A new entry today, from Cash, against one line chosen at random.
      const target = pick(m.lines);
      const t = { item: target.line.kind, description: target.line.words.split(",")[0]?.trim() ?? "", notes: "" };
      if (lineFor(t, m.lines.map((s) => s.line)) !== target.line) continue;
      const room = Math.max(0, target.left);
      if (room > 0) {
        const within = brief(lines, [...rows, spend(asOf, t.item, Math.max(1, Math.floor(room * r())), { description: t.description })]);
        expect(within.safe, `within, seed ${seed}`).toBe(before.safe);
        expect(within.perDay, `within, seed ${seed}`).toBe(before.perDay);
        expect(within.perDayAfter, `within, seed ${seed}`).toBe(before.perDayAfter);
        expect(within.budgetPerDay, `within, seed ${seed}`).toBe(before.budgetPerDay);
      }
      const past = 1 + Math.floor(r() * 20_000);
      const beyond = brief(lines, [...rows, spend(asOf, t.item, room + past, { description: t.description })]);
      expect(beyond.free, `past, seed ${seed}`).toBe(before.free - past);
    }
  });
});
