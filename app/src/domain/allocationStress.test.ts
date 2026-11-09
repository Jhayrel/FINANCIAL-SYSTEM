/**
 * Allocations under stress (owner, 9 November 2026: "very hard test ... stress
 * test"): thousands of random changes, through the one path Budget and the
 * chat share, against random spending, with what must always hold checked
 * after every step. Seeded, so a failure repeats exactly. Invented data only.
 */
import { describe, expect, it } from "vitest";

import { applyAllocationChange } from "./allocationApply";
import { readAllocationChange } from "./allocationChange";
import { monthAfter } from "./monthAllocation";
import { linesIn, monthAllocations, normaliseAllocations, removedLines, type AllocationChange, type AllocationInput, type AllocationLine } from "./monthAllocation";
import type { ReferenceLists, Transaction } from "./types";

/** A small, seeded random number source (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const KINDS = ["Gas", "Food", "Self Care", "Parking", "Fun"];
const reference = {
  spendingTypes: KINDS.map((name) => ({ name, remark: "" })),
  bills: ["Globe"],
  subscriptions: ["Spotify"],
  wallets: ["Cash", "Maya"],
  savings: ["Maya Bank"],
} as unknown as ReferenceLists;
const MONTHS = ["2026-10", "2026-11", "2026-12", "2027-01"];

function ledger(r: () => number, size: number): Transaction[] {
  const out: Transaction[] = [];
  for (let i = 0; i < size; i += 1) {
    const ym = MONTHS[Math.floor(r() * MONTHS.length)]!;
    const day = String(1 + Math.floor(r() * 28)).padStart(2, "0");
    const item = KINDS[Math.floor(r() * KINDS.length)]!;
    const amount = (1 + Math.floor(r() * 500)) * 100 + Math.floor(r() * 100);
    out.push({ id: `t${i}`, recordNumber: i + 1, date: `${ym}-${day}`, type: "Spending", fromWallet: r() < 0.5 ? "Cash" : "Maya", toWallet: "", category: "Spending", item, description: r() < 0.4 ? "gym" : r() < 0.5 ? "lunch" : "", amount, fee: 0, total: amount, notes: "", status: "Paid" } as Transaction);
  }
  return out;
}

function randomInput(r: () => number): AllocationInput {
  const kind = KINDS[Math.floor(r() * KINDS.length)]!;
  const words = r() < 0.3 ? "gym" : "";
  const shape = Math.floor(r() * 4);
  const repeat = r() < 0.4;
  const until = repeat && r() < 0.5 ? MONTHS[1 + Math.floor(r() * 3)] : undefined;
  const base = { kind, words, name: words ? "Gym" : "", wallet: r() < 0.5 ? "Cash" : "", ...(repeat ? { repeat: true, ...(until ? { until } : {}) } : {}) };
  if (shape === 0) return { ...base, amount: (1 + Math.floor(r() * 3000)) * 100 };
  if (shape === 1) return { ...base, amount: null, per: "week", each: (1 + Math.floor(r() * 500)) * 100, times: 1 + Math.floor(r() * 5) };
  if (shape === 2) return { ...base, amount: null, per: "time", each: (1 + Math.floor(r() * 200)) * 100, times: 1 + Math.floor(r() * 12) };
  const days = [0, 1, 2, 3, 4, 5, 6].filter(() => r() < 0.4);
  return { ...base, amount: null, per: "day", each: (1 + Math.floor(r() * 200)) * 100, days: days.length ? days : [2] };
}

function randomChange(r: () => number, lines: readonly AllocationLine[]): AllocationChange {
  const pick = (): AllocationLine | undefined => lines[Math.floor(r() * lines.length)];
  const month = MONTHS[Math.floor(r() * MONTHS.length)]!;
  const roll = r();
  const l = pick();
  if (roll < 0.35 || !l) return { kind: "add", month, input: randomInput(r) };
  if (roll < 0.55) return { kind: "edit", id: l.id, input: randomInput(r), month };
  if (roll < 0.65) return { kind: "remove", id: l.id, month };
  if (roll < 0.75) return { kind: "restore", id: l.id, month };
  if (roll < 0.85) return { kind: "done", id: l.id, month };
  if (roll < 0.92) return { kind: "undone", id: l.id, month };
  return { kind: "copy", from: month, to: monthAfter(month) };
}

/** What must hold, always. */
function invariants(lines: readonly AllocationLine[], rows: readonly Transaction[], asOf: string): void {
  // Saved and read back, exactly.
  const back = normaliseAllocations(JSON.parse(JSON.stringify(lines)));
  for (let i = 0; i < lines.length; i += 1) expect(back[i]).toEqual(lines[i]);
  expect(back).toEqual(lines);
  // Ids are unique.
  expect(new Set(lines.map((l) => l.id)).size).toBe(lines.length);
  for (const ym of MONTHS) {
    const m = monthAllocations(lines, rows, ym, asOf);
    for (const s of m.lines) {
      for (const v of [s.spent, s.left, s.over, s.held, s.line.amount]) expect(Number.isInteger(v)).toBe(true);
      expect(s.held).toBeGreaterThanOrEqual(0);
      expect(s.over).toBeGreaterThanOrEqual(0);
      if (s.twinOf) expect([s.spent, s.held, s.entries]).toEqual([0, 0, 0]);
      if (s.done) expect(s.held).toBe(0);
      if (m.phase !== "running") expect(s.held).toBe(0);
    }
    // One entry, one allocation: nothing is counted twice.
    const spentAll = m.lines.reduce((t, s) => t + s.spent, 0);
    const ofKinds = rows.filter((t) => t.date.slice(0, 7) === ym && m.lines.some((s) => s.line.kind === t.item)).reduce((t, x) => t + x.total, 0);
    expect(spentAll).toBeLessThanOrEqual(ofKinds);
    // Never two live lines that count for the same kind and words.
    const counting = m.lines.filter((s) => !s.twinOf).map((s) => `${s.line.kind.toLowerCase()}|${s.line.words.toLowerCase()}`);
    expect(new Set(counting).size).toBe(counting.length);
    expect(m.allocated).toBe(m.lines.filter((s) => !s.twinOf).reduce((t, s) => t + s.line.amount, 0));
  }
}

describe("allocations under thousands of random changes", () => {
  for (const seed of Array.from({ length: 20 }, (_, i) => i + 1)) {
    it(`seed ${seed}: every change keeps every rule`, () => {
      const r = rng(seed);
      const rows = ledger(r, 120);
      const asOf = "2026-11-17";
      let id = 0;
      let lines: AllocationLine[] = [];
      for (let step = 0; step < 400; step += 1) {
        const change = randomChange(r, lines);
        const done = applyAllocationChange(lines, change, { reference, transactions: rows, asOf, newId: () => `a${(id += 1)}` });
        if (!done.ok) {
          // Refused: said in words, and nothing changed.
          expect(done.why.length).toBeGreaterThan(5);
          continue;
        }
        // Undo of each kind gives back exactly what was there.
        if ((change.kind === "remove" || change.kind === "done") && done.was) {
          const back = applyAllocationChange(done.lines, change.kind === "remove" ? { kind: "restore", id: change.id, month: change.month } : { kind: "undone", id: change.id, month: change.month }, { reference, transactions: rows, asOf, newId: () => "x" });
          if (back.ok) expect(back.lines.find((l) => l.id === change.id)).toEqual(lines.find((l) => l.id === change.id));
        }
        lines = done.lines;
        invariants(lines, rows, asOf);
      }
      expect(lines.length).toBeGreaterThan(0);
      // Every removed line can be listed, and none is ever lost.
      expect(removedLines(lines).every((l) => lines.includes(l))).toBe(true);
    });
  }
});

describe("the chat reader under random sentences", () => {
  const WORDS = ["allocate", "allocation", "gas", "gym", "food", "300", "1,500", "50", "a week", "each", "every", "tuesday", "and", "thursday", "month", "next month", "until", "march", "remove", "stop", "from", "done", "put back", "change", "the", "my", "to", "for", "what if", "how much", "?", "extend", "copy", "last month", "raise", "by", "200", "under", "self care", "weekdays", "please", "can you", "twice", "times", "8", "is"];
  it("never crashes, never changes from a question, and every card it offers can be pressed", () => {
    const r = rng(42);
    const gas = applyAllocationChange([], { kind: "add", month: "2026-11", input: { kind: "Gas", amount: null, per: "week", each: 30_000, times: 4 } }, { reference, transactions: [], asOf: "2026-11-09", newId: () => "g" });
    const lines = gas.ok ? gas.lines : [];
    let cards = 0;
    for (let i = 0; i < 3000; i += 1) {
      const n = 2 + Math.floor(r() * 9);
      const text = Array.from({ length: n }, () => WORDS[Math.floor(r() * WORDS.length)]).join(" ");
      const said = readAllocationChange(text, { lines, reference, transactions: [], asOf: "2026-11-09" });
      if ((/\b(?:what if|how much)\b/.test(text) || (/\?\s*$/.test(text) && !/\b(?:can you|please)\b/.test(text))) && said?.kind === "change") throw new Error(`a question made a change: "${text}"`);
      if (said?.kind === "change") {
        cards += 1;
        const pressed = applyAllocationChange(lines, said.change, { reference, transactions: [], asOf: "2026-11-09", newId: () => "n" });
        expect(pressed.ok).toBe(true);
        expect(said.words.includes(String.fromCharCode(0x2014))).toBe(false);
      }
    }
    expect(cards).toBeGreaterThan(20);
  });

  it("linesIn and the rest never throw on odd stored data", () => {
    const odd = normaliseAllocations([null, 1, "x", { id: "a" }, { id: "b", month: "2026-13x", kind: "Gas", amount: 1 }, { id: "c", month: "2026-11", kind: "Gas", amount: 100, per: "day", each: 50, times: 2, days: ["x", 9] }, { id: "d", month: "2026-11", kind: "Gas", amount: 100, repeat: "yes", done: [{ month: 5 }] }]);
    expect(odd.map((l) => l.id)).toEqual(["c", "d"]);
    expect(odd[0]!.per).toBeUndefined();
    expect(() => linesIn(odd, "2026-11")).not.toThrow();
    expect(() => monthAllocations(odd, [], "2026-11", "2026-11-09")).not.toThrow();
  });
});
