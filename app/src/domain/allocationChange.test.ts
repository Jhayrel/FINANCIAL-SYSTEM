/**
 * The chat changing allocations (docs/17 A9), on invented rows: what it reads
 * as a change, what it asks back, and what it must leave alone (owner, 9
 * November 2026: "be careful also in keywords").
 */
import { describe, expect, it } from "vitest";

import { applyAllocationChange } from "./allocationApply";
import { daysSaid, figuresIn, readAllocationChange, type AllocationRead, type ChangeContext } from "./allocationChange";
import { linesIn, makeAllocation, monthAllocations, type AllocationLine } from "./monthAllocation";
import type { ReferenceLists, Transaction } from "./types";

const asOf = "2026-11-09";
const reference = {
  spendingTypes: ["Gas", "Parking", "Self Care", "Food", "Fun"].map((name) => ({ name, remark: "" })),
  bills: ["Globe"],
  subscriptions: ["Spotify"],
  wallets: ["Cash", "Maya", "Gcash"],
  savings: ["Maya Bank"],
} as unknown as ReferenceLists;

let n = 0;
const row = (date: string, item: string, amount: number, description = ""): Transaction =>
  ({ id: `t${(n += 1)}`, recordNumber: n, date, type: "Spending", fromWallet: "Cash", toWallet: "", category: "Spending", item, description, amount, fee: 0, total: amount, notes: "", status: "Paid" }) as Transaction;
const transactions = [row("2026-10-06", "Self Care", 5_000, "gym"), row("2026-10-08", "Self Care", 5_000, "Gym"), row("2026-11-03", "Gas", 30_000)];

const gas = makeAllocation({ kind: "Gas", amount: null, each: 30_000, times: 4, per: "week", wallet: "Cash" }, "2026-11", "2026-11-01", "a-gas");
const parking = makeAllocation({ name: "Parking", kind: "Parking", amount: 40_000, repeat: true }, "2026-10", "2026-10-01", "a-park");
const gym = makeAllocation({ name: "Gym", kind: "Self Care", words: "gym", amount: null, each: 5_000, per: "day", days: [2, 4] }, "2026-11", "2026-11-01", "a-gym");
const food: AllocationLine = { ...makeAllocation({ kind: "Food", amount: 200_000 }, "2026-11", "2026-11-01", "a-food"), removedOn: "2026-11-05" };
const lines = [gas, parking, gym, food];
const ctx: ChangeContext = { lines, reference, transactions, asOf };

const read = (text: string, c: ChangeContext = ctx): AllocationRead | null => readAllocationChange(text, c);
const change = (text: string) => {
  const r = read(text);
  if (!r || r.kind !== "change") throw new Error(`not a change: ${text} -> ${JSON.stringify(r)}`);
  return r;
};
const asks = (text: string): string => {
  const r = read(text);
  if (!r || r.kind !== "ask") throw new Error(`not a question: ${text} -> ${JSON.stringify(r)}`);
  return r.text;
};
/** The lines after pressing the card. */
const after = (text: string): AllocationLine[] => {
  const r = change(text);
  const done = applyAllocationChange(lines, r.change, { reference, transactions, asOf, newId: () => "new" });
  if (!done.ok) throw new Error(done.why);
  return done.lines;
};

describe("left alone: questions, what-ifs, entries and plans", () => {
  it.each([
    "how much is left for gas allocation",
    "what if I remove the gym allocation",
    "if I cancel the gym allocation what happens to safe to spend",
    "should I raise my gas allocation?",
    "is my gas allocation ok",
    "can I add 200 to the gas allocation?",
    "gas 300 cash",
    "I spent 50 at the gym",
    "remove the gas entry from yesterday",
    "plan to buy shoes 2000 by december",
    "set aside 5000 for tuition by december",
    "delete #3992",
    "my allocations",
    "//fix the allocation card",
  ])("%s", (q) => {
    expect(read(q)).toBeNull();
  });

  it("a request phrased as a question is still a request", () => {
    expect(change("can you allocate 200 a week for fun").action).toBe("Add the allocation");
  });
});

describe("add", () => {
  it("a week, with the weeks", () => {
    const r = change("allocate 100 a week for fun for 3 weeks");
    expect(r.change).toMatchObject({ kind: "add", month: "2026-11", input: { kind: "Fun", per: "week", each: 10_000, times: 3 } });
    expect(r.words).toContain("It sets aside ₱300.00 more now, so safe to spend is ₱300.00 lower.");
  });

  it("the owner's own way: 1200 and 300 per week", () => {
    expect(change("add an allocation for fun 1200 and 300 per week").change).toMatchObject({ input: { per: "week", each: 30_000, times: 4 } });
  });

  it("on set days, the kind found from the entries: the gym is Self Care", () => {
    const fresh: ChangeContext = { ...ctx, lines: [gas] };
    const r = readAllocationChange("allocate 60 every monday and friday for gym", fresh);
    expect(r?.kind).toBe("change");
    if (r?.kind !== "change") return;
    expect(r.change).toMatchObject({ kind: "add", input: { kind: "Self Care", words: "gym", name: "Gym", per: "day", each: 6_000, days: [1, 5] } });
    // From Monday the 9th: the 9th, 13th, 16th, 20th, 23rd, 27th and 30th.
    expect(r.rows.find((x) => x.label === "Amount")?.value).toBe("₱420.00 for November 2026, ₱60.00 each Monday and Friday, 7 days");
  });

  it("for the month, every month, paid from Maya", () => {
    const r = change("allocate 2000 for food every month from maya");
    expect(r.change).toMatchObject({ kind: "add", input: { kind: "Food", amount: 200_000, repeat: true, wallet: "Maya" } });
  });

  it("next month, and until a month", () => {
    expect(change("allocate 500 for fun next month").change).toMatchObject({ kind: "add", month: "2026-12" });
    expect(change("allocate 500 for fun until march").change).toMatchObject({ kind: "add", month: "2026-11", input: { repeat: true, until: "2027-03" } });
  });

  it("asks what it cannot know", () => {
    expect(asks("allocate 500")).toContain("For which kind of spending?");
    expect(asks("add an allocation for fun")).toContain("How much for Fun?");
    expect(asks("allocate 50 a time for fun")).toContain("How many times in November 2026?");
    expect(asks("allocate 50 a day for fun")).toContain("Which days of the week?");
    expect(asks("allocate 300 a week for gas")).toContain("has an allocation for Gas already");
    expect(asks("allocate 300 for globe")).toContain("For which kind of spending?");
  });
});

describe("change and extend", () => {
  it("a bare amount on a weekly line keeps the weeks when it divides", () => {
    expect(change("change the gas allocation to 1600").change).toMatchObject({ kind: "edit", id: "a-gas", input: { per: "week", each: 40_000, times: 4 } });
    expect(change("change the gas allocation to 1300").change).toMatchObject({ input: { each: 32_500, times: 4 } });
    expect(asks("change the gas allocation to 1300.50")).toContain("Is ₱1,300.50 a week, or for the whole month?");
    expect(change("make the gas allocation 1300 for the month").change).toMatchObject({ input: { amount: 130_000, per: undefined } });
  });

  it("raised or lowered by an amount", () => {
    expect(change("raise the gas allocation by 400").change).toMatchObject({ input: { each: 40_000, times: 4 } });
    expect(change("lower the parking allocation by 100").change).toMatchObject({ input: { amount: 30_000 } });
    expect(change("add 200 to the gas allocation").change).toMatchObject({ input: { each: 35_000 } });
  });

  it("new days for the gym", () => {
    const r = change("change the gym allocation to monday, wednesday and friday");
    expect(r.change).toMatchObject({ kind: "edit", id: "a-gym", input: { per: "day", days: [1, 3, 5], each: 5_000 } });
  });

  it("extended: every month, until a month, more months", () => {
    expect(change("make the gym allocation every month").change).toMatchObject({ input: { repeat: true, until: undefined } });
    expect(change("extend the gas allocation until march").change).toMatchObject({ input: { repeat: true, until: "2027-03" } });
    expect(change("extend the gas allocation for 2 more months").change).toMatchObject({ input: { repeat: true, until: "2027-01" } });
    expect(change("extend the gas allocation to december").change).toMatchObject({ input: { repeat: true, until: "2026-12" } });
    expect(change("gas allocation this month only").change).toMatchObject({ input: { repeat: false } });
  });

  it("a repeating line changed from next month: the months before keep theirs", () => {
    const next = after("change the parking allocation to 600 from next month");
    const old = next.find((l) => l.id === "a-park")!;
    expect(old.until).toBe("2026-11");
    expect(linesIn(next, "2026-12").find((l) => l.kind === "Parking")?.amount).toBe(60_000);
    expect(linesIn(next, "2026-11").find((l) => l.kind === "Parking")?.amount).toBe(40_000);
  });

  it("a this-month line changed from next month: next month gets its own", () => {
    const r = change("change the gas allocation to 400 a week from next month");
    expect(r.change).toMatchObject({ kind: "add", month: "2026-12", input: { each: 40_000, per: "week" } });
  });

  it("nothing said to change: asked", () => {
    expect(asks("edit the gas allocation")).toContain("What should change on Gas?");
  });
});

describe("done, hold again, remove, stop, put back, copy", () => {
  it("done frees what is left today", () => {
    const r = change("the gym allocation is done");
    expect(r.change).toEqual({ kind: "done", id: "a-gym", month: "2026-11" });
    expect(r.action).toBe("Mark it done");
    const next = after("I'm done with the gym allocation");
    expect(monthAllocations(next, transactions, "2026-11", asOf).lines.find((s) => s.line.id === "a-gym")).toMatchObject({ held: 0 });
  });

  it("hold it again", () => {
    const doneGym: AllocationLine = { ...gym, done: [{ month: "2026-11", on: "2026-11-09" }] };
    const r = readAllocationChange("hold the gym allocation again", { ...ctx, lines: [gas, parking, doneGym] });
    expect(r).toMatchObject({ kind: "change", change: { kind: "undone", id: "a-gym" } });
  });

  it("remove, kept to put back", () => {
    const r = change("remove the gas allocation");
    expect(r.change).toEqual({ kind: "remove", id: "a-gas", month: "2026-11" });
    expect(r.words).toContain("kept under Removed on Budget and in the Bin");
    expect(change("cancel my gym allocation").change).toMatchObject({ kind: "remove", id: "a-gym" });
  });

  it("stop a repeating one from next month", () => {
    const r = change("stop the parking allocation from next month");
    expect(r.change).toEqual({ kind: "remove", id: "a-park", month: "2026-12" });
    expect(r.action).toBe("Stop it");
    expect(asks("stop the gas allocation from next month")).toContain("for November 2026 only, so it holds nothing in December 2026 already");
  });

  it("put back the removed one", () => {
    expect(change("put back the food allocation").change).toEqual({ kind: "restore", id: "a-food" });
    expect(asks("restore the gas allocation")).toContain("Which one? Removed: Food");
  });

  it("copy last month, or this month into next", () => {
    const oct = makeAllocation({ kind: "Fun", amount: 50_000 }, "2026-10", "2026-10-01", "a-fun");
    const r = readAllocationChange("copy last month's allocations", { ...ctx, lines: [...lines, oct] });
    expect(r).toMatchObject({ kind: "change", change: { kind: "copy", from: "2026-10", to: "2026-11" } });
    expect(change("copy the allocations to next month").change).toEqual({ kind: "copy", from: "2026-11", to: "2026-12" });
  });

  it("a line named without saying allocation: only with the, a verb that changes it, and its own name", () => {
    expect(change("remove the gym").change).toMatchObject({ kind: "remove", id: "a-gym" });
    expect(read("gym 50 cash")).toBeNull();
    expect(read("I went to the gym")).toBeNull();
  });
});

describe("the pieces", () => {
  it("days", () => {
    expect(daysSaid("every tue and thu")).toEqual([2, 4]);
    expect(daysSaid("tuwing martes at huwebes")).toEqual([2, 4]);
    expect(daysSaid("weekdays")).toEqual([1, 2, 3, 4, 5]);
    expect(daysSaid("money for the month")).toEqual([]);
    expect(daysSaid("a wedding on saturday")).toEqual([6]);
  });

  it("money, never counts or dates", () => {
    expect(figuresIn("allocate 300 a week for gas for 4 weeks")).toEqual([{ cents: 30_000, pace: "week" }]);
    expect(figuresIn("50 a time 8 times")).toEqual([{ cents: 5_000, pace: "time" }]);
    expect(figuresIn("1.5k for the month until march 2027")).toEqual([{ cents: 150_000, pace: "month" }]);
    expect(figuresIn("50 every tuesday from november 10")).toEqual([{ cents: 5_000, pace: "day" }]);
  });

  it("never an em dash in a card or a question", () => {
    const said = ["allocate 100 a week for fun", "change the gas allocation to 1300", "stop the parking allocation from next month", "remove the gas allocation", "the gym allocation is done", "allocate 500"].map((q) => {
      const r = read(q)!;
      return r.kind === "ask" ? r.text : `${r.words} ${r.rows.map((x) => x.value).join(" ")}`;
    });
    expect(said.join(" ").includes(String.fromCharCode(0x2014))).toBe(false);
  });
});

describe("where an allocation is paid from, moved (9 November 2026 sweep)", () => {
  it("\"move the gas allocation to maya\" changes its wallet and nothing else", () => {
    const moved = after("move the gas allocation to maya").find((l) => l.id === "a-gas")!;
    expect(moved.wallet).toBe("Maya");
    expect(moved.amount).toBe(gas.amount);
    expect(moved.each).toBe(gas.each);
  });
  it("\"switch the gas allocation to gcash\" too", () => {
    expect(after("switch the gas allocation to gcash").find((l) => l.id === "a-gas")!.wallet).toBe("Gcash");
  });
});
