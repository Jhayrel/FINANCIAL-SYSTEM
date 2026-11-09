/**
 * Allocations on set days, for how long, done early, over and unused
 * (docs/17-ALLOCATIONS.md A6, A7, A12). The owner, 9 November 2026: "I want
 * custom but weeks tuesday and thursday only", "what if I only want it to be
 * valid this month? or next month ... or what if its done", "what happen if
 * the month ended and I havent spend it or I spend it to somewhere else",
 * "what happens if I over spent". Invented rows only.
 */
import { describe, expect, it } from "vitest";

import {
  allocationAlerts,
  checkAllocation,
  checkRestore,
  copyLines,
  linesIn,
  makeAllocation,
  monthAllocations,
  normaliseAllocations,
  removedIn,
  removedLines,
  scheduledDates,
  spanWords,
  statusWords,
  type AllocationLine,
} from "./monthAllocation";
import type { ReferenceLists, Transaction } from "./types";

const reference = {
  spendingTypes: [{ name: "Self Care", remark: "" }, { name: "Gas", remark: "" }, { name: "Food", remark: "" }],
  bills: ["Globe"],
  subscriptions: [],
  wallets: ["Cash", "Maya"],
  savings: [],
} as unknown as ReferenceLists;

let n = 0;
const gym = (date: string, amount: number, over: Partial<Transaction> = {}): Transaction =>
  ({ id: `t${(n += 1)}`, recordNumber: n, date, type: "Spending", fromWallet: "Cash", toWallet: "", category: "Spending", item: "Self Care", description: "gym", amount, fee: 0, total: amount, notes: "", status: "Paid", ...over }) as Transaction;

const tueThu = { name: "Gym", kind: "Self Care", words: "gym", amount: null, each: 5_000, per: "day" as const, days: [2, 4] };

describe("set days of the week (A6)", () => {
  it("November 2026's Tuesdays and Thursdays", () => {
    expect(scheduledDates("2026-11", [4, 2]).map((d) => d.slice(8))).toEqual(["03", "05", "10", "12", "17", "19", "24", "26"]);
  });

  it("made on Monday the 9th: counts from that day, six days, ₱300.00", () => {
    const line = makeAllocation(tueThu, "2026-11", "2026-11-09", "a1");
    expect(line).toMatchObject({ per: "day", days: [2, 4], times: 6, amount: 30_000, from: "2026-11-09" });
    // The gym on the 5th was before it: ordinary spending, not counted against it.
    const m = monthAllocations([line], [gym("2026-11-05", 5_000), gym("2026-11-10", 5_000)], "2026-11", "2026-11-10");
    const s = m.lines[0]!;
    expect(s.spent).toBe(5_000);
    expect(s.held).toBe(25_000);
    expect(s.days?.today).toEqual({ share: 5_000, spent: 5_000, left: 0 });
    expect(s.days?.toCome).toBe(6);
    expect(s.timesUsed).toBe(1);
    expect(statusWords(s, m.phase)).toContain("Tuesday and Thursday: 1 of 6 days had spending; today ₱50.00 of ₱50.00");
  });

  it("made for a month ahead: the whole month", () => {
    const line = makeAllocation(tueThu, "2026-12", "2026-11-09", "a2");
    expect(line.from).toBeUndefined();
    expect(line).toMatchObject({ times: 10, amount: 50_000 });
  });

  it("past today's share is said in the bell; the month's amount is unchanged", () => {
    const line = makeAllocation(tueThu, "2026-11", "2026-11-09", "a3");
    const m = monthAllocations([line], [gym("2026-11-10", 8_000)], "2026-11", "2026-11-10");
    expect(m.lines[0]!.days?.today?.left).toBe(-3_000);
    expect(allocationAlerts(m, [line], "2026-11-10").map((a) => a.title)).toContain("Gym is ₱30.00 past today's share");
    expect(m.lines[0]!.held).toBe(22_000);
  });

  it("refused with no day picked, or none left in the month", () => {
    expect(checkAllocation({ ...tueThu, days: [] }, "2026-11", [], reference)).toBe("Pick at least one day of the week.");
    // The 30th is a Monday: no Tuesday is left from it.
    expect(checkAllocation({ ...tueThu, days: [2] }, "2026-11", [], reference, "2026-11-30")).toContain("None of those days is left in November 2026");
  });
});

describe("how long it lasts (A12)", () => {
  const every = makeAllocation({ ...tueThu, repeat: true }, "2026-11", "2026-11-09", "e1");

  it("this month only, by default", () => {
    const once = makeAllocation(tueThu, "2026-11", "2026-11-09", "o1");
    expect(linesIn([once], "2026-12")).toEqual([]);
    expect(spanWords(once)).toBe("November 2026 only");
  });

  it("every month: each month has its own amount, from its own days", () => {
    expect(linesIn([every], "2027-03").map((l) => l.id)).toEqual(["e1"]);
    const dec = monthAllocations([every], [], "2026-12", "2026-12-02");
    expect(dec.lines[0]!.line.amount).toBe(50_000);
    expect(spanWords(every)).toBe("every month from November 2026");
  });

  it("until a month, then it stops by itself", () => {
    const until = makeAllocation({ ...tueThu, repeat: true, until: "2027-01" }, "2026-11", "2026-11-09", "u1");
    expect(linesIn([until], "2027-01")).toHaveLength(1);
    expect(linesIn([until], "2027-02")).toHaveLength(0);
    expect(spanWords(until)).toBe("every month, November 2026 to January 2027");
    const jan = monthAllocations([until], [], "2027-01", "2027-01-26");
    expect(allocationAlerts(jan, [until], "2027-01-26").map((a) => a.title)).toContain("Gym ends with January 2027");
  });

  it("stopped from a month: the months before keep it, and it can be put back", () => {
    const stopped: AllocationLine = { ...every, stoppedFrom: "2027-01" };
    expect(linesIn([stopped], "2026-12")).toHaveLength(1);
    expect(linesIn([stopped], "2027-01")).toHaveLength(0);
    expect(removedIn([stopped], "2027-01").map((l) => l.id)).toEqual(["e1"]);
    expect(removedLines([stopped]).map((l) => l.id)).toEqual(["e1"]);
    expect(checkRestore(stopped, [stopped])).toBeNull();
  });

  it("never twice in a month: a repeating line into a month with its own", () => {
    const dec = makeAllocation(tueThu, "2026-12", "2026-11-09", "d1");
    expect(checkAllocation({ ...tueThu, repeat: true }, "2026-11", [dec], reference, "2026-11-09")).toBe(
      "December 2026 has its own allocation for Gym. Remove that one first, or make this one end before December 2026.",
    );
    expect(checkAllocation(tueThu, "2026-12", [every], reference)).toBe("December 2026 has an allocation for Gym already. Edit that one.");
  });

  it("copied: this month only, with that month's own days", () => {
    const once = makeAllocation(tueThu, "2026-11", "2026-11-09", "c1");
    const [copy] = copyLines([once], "2026-11", "2026-12", "2026-11-30", () => "c2");
    expect(copy).toMatchObject({ month: "2026-12", amount: 50_000, times: 10, days: [2, 4] });
    expect(copy!.repeat).toBeUndefined();
    expect(copy!.from).toBeUndefined();
    // A repeating line already covers next month: nothing to copy.
    expect(copyLines([every], "2026-11", "2026-12", "2026-11-30", () => "x")).toEqual([]);
  });

  it("comes back from storage as it went in", () => {
    const stored: AllocationLine = { ...every, until: "2027-06", stoppedFrom: "2027-03", done: [{ month: "2026-11", on: "2026-11-20" }] };
    expect(normaliseAllocations(JSON.parse(JSON.stringify([stored])))).toEqual([stored]);
  });
});

describe("done early, unused, spent elsewhere, over (A7)", () => {
  const line = makeAllocation({ name: "Gym", kind: "Self Care", words: "gym", amount: 30_000 }, "2026-11", "2026-11-01", "g1");

  it("done: what it had left is free, and later gym spending is ordinary", () => {
    const done: AllocationLine = { ...line, done: [{ month: "2026-11", on: "2026-11-20" }] };
    const m = monthAllocations([done], [gym("2026-11-10", 10_000), gym("2026-11-24", 5_000)], "2026-11", "2026-11-24");
    const s = m.lines[0]!;
    expect(s.done).toBe("2026-11-20");
    expect(s.spent).toBe(10_000);
    expect(s.held).toBe(0);
    expect(s.left).toBe(20_000);
    expect(statusWords(s, m.phase)).toBe("Gym: done on November 20, 2026, ₱100.00 spent of ₱300.00; the ₱200.00 it had left is free.");
    expect(allocationAlerts(m, [done], "2026-11-24")).toEqual([]);
  });

  it("spent somewhere else: the allocation still holds until done or lowered", () => {
    const food = gym("2026-11-10", 30_000, { item: "Food", description: "lunch" });
    const s = monthAllocations([line], [food], "2026-11", "2026-11-10").lines[0]!;
    expect(s.spent).toBe(0);
    expect(s.held).toBe(30_000);
  });

  it("over: holds nothing more, says by how much, and the bell says so", () => {
    const m = monthAllocations([line], [gym("2026-11-10", 40_000)], "2026-11", "2026-11-10");
    expect(m.lines[0]).toMatchObject({ over: 10_000, held: 0 });
    expect(allocationAlerts(m, [line], "2026-11-10")[0]!.title).toBe("Gym is ₱100.00 over its allocation");
  });

  it("every month, over in one: the next starts full", () => {
    const every = makeAllocation({ name: "Gym", kind: "Self Care", words: "gym", amount: 30_000, repeat: true }, "2026-11", "2026-11-01", "g2");
    const rows = [gym("2026-11-10", 40_000)];
    expect(monthAllocations([every], rows, "2026-12", "2026-12-01").lines[0]).toMatchObject({ spent: 0, held: 30_000, over: 0 });
  });

  it("the month ended unused: free money now, said in the first week", () => {
    const m = monthAllocations([line], [gym("2026-11-10", 10_000)], "2026-12", "2026-12-02");
    const alerts = allocationAlerts(m, [line], "2026-12-02", [gym("2026-11-10", 10_000)]);
    expect(alerts.map((a) => a.title)).toContain("₱200.00 of November 2026's allocations was not used");
    expect(alerts.find((a) => a.id.startsWith("alloc-unused"))!.detail).toContain("free money now, counted in safe to spend");
    expect(monthAllocations([line], [], "2026-11", "2026-12-02")).toMatchObject({ held: 0, unused: 30_000 });
  });

  it("never an em dash in what is said", () => {
    const every = makeAllocation({ ...tueThu, repeat: true, until: "2027-01" }, "2026-11", "2026-11-09", "w1");
    const m = monthAllocations([every], [gym("2026-11-10", 9_000)], "2026-11", "2026-11-10");
    const said = [...m.lines.map((s) => statusWords(s, m.phase)), ...allocationAlerts(m, [every], "2026-11-10").flatMap((a) => [a.title, a.detail]), spanWords(every)].join(" ");
    expect(said.includes(String.fromCharCode(0x2014))).toBe(false);
  });
});
