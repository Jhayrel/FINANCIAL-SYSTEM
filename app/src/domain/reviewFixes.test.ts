/**
 * "Can you implement a fix so I can just click it" (20 October 2026): each
 * Needs review finding with a fix that follows from the ledger, as the same
 * entry edited. Every figure here is invented.
 */
import { describe, expect, it } from "vitest";

import { actionableIssues, checkIntegrity } from "./integrity";
import { walletDelta } from "./balances";
import { consistentRow, reviewFixes } from "./reviewFixes";
import type { Transaction } from "./types";

let n = 0;
const row = (over: Partial<Transaction>): Transaction => {
  n += 1;
  return { id: `r${n}`, recordNumber: n, date: "2026-09-01", type: "Spending", fromWallet: "Bank", toWallet: "", category: "Spending", item: "Food", description: "", amount: 0, fee: 0, total: 0, notes: "", status: "Paid", ...over };
};
const wallets = ["Cash", "Bank", "Wallet"];
const ledger = [
  row({ date: "2026-09-01", type: "Revenue", fromWallet: "", toWallet: "Bank", category: "Revenue", item: "Allowance", amount: 300_000, total: 300_000 }),
  // A withdrawal with the machine's fee inside the cash.
  row({ date: "2026-09-05", type: "Transfer", toWallet: "Cash", category: "", item: "", amount: 51_600, total: 51_600 }),
  // A total that leaves out its fee.
  row({ date: "2026-09-06", type: "Transfer", toWallet: "Cash", item: "Transaction Fee", amount: 100_000, fee: 1_800, total: 100_000 }),
  // Paid the day before the money came in.
  row({ date: "2026-09-10", amount: 160_000, total: 160_000 }),
  row({ date: "2026-09-11", type: "Transfer", fromWallet: "Wallet", toWallet: "Bank", category: "", item: "", amount: 50_000, total: 50_000 }),
  // The money for that transfer only reached Wallet the same day, so the transfer cannot be dated earlier.
  row({ date: "2026-09-11", type: "Revenue", fromWallet: "", toWallet: "Wallet", category: "Revenue", item: "Allowance", amount: 50_000, total: 50_000 }),
];

describe("Needs review, fixed in one press", () => {
  const all = reviewFixes(ledger, { wallets, asOf: "2026-09-20" });
  // The fixes themselves; each finding's "keep it as it is" card is tested below.
  const isKeep = (title: string): boolean => /: keep it as it is$|^Keep /.test(title);
  const ready = { ...all, fixes: all.fixes.filter((f) => !isKeep(f.title)) };

  it("splits the fee out, says what Cash does, and files it as the form would", () => {
    const split = ready.fixes.find((f) => f.rows.some((r) => r.before.recordNumber === 2))!;
    expect(split.rows[0]!.after).toMatchObject({ amount: 50_000, fee: 1_600, total: 51_600, item: "Transaction Fee", category: "Spending" });
    expect(split.words).toContain("Cash goes down ₱16.00. September 2026 spending goes up ₱16.00");
  });

  it("offers both readings of a total without its fee, one group", () => {
    const both = ready.fixes.filter((f) => f.rows.some((r) => r.before.recordNumber === 3));
    expect(both).toHaveLength(2);
    expect(new Set(both.map((f) => f.group)).size).toBe(1);
    // Keeping the balances leads: with no fee every wallet reads as now.
    expect(both[0]!.title).toContain("keep the balances as they are");
    expect(both[0]!.words).toContain("No balance changes. September 2026 spending goes down ₱18.00");
    expect(both[1]!.words).toContain("Bank goes down ₱18.00");
  });

  it("dates the day's payment to when the money came, on that condition, and leaves nothing flagged", () => {
    const moved = ready.fixes.find((f) => f.rows.some((r) => r.before.recordNumber === 4))!;
    expect(moved.rows[0]!.after.date).toBe("2026-09-11");
    expect(moved.onlyIf).toContain("paid on");
    expect(ready.leftAfter).toBe(0);
  });

  it("moves the money that came in next instead, when that clears it and breaks nothing", () => {
    const early = [...ledger.slice(0, 5), { ...ledger[5]!, date: "2026-08-01" }];
    const moved = reviewFixes(early, { wallets, asOf: "2026-09-20" }).fixes.find((f) => !/: keep it as it is$|^Keep /.test(f.title) && f.rows.some((r) => r.before.recordNumber === 5))!;
    expect(moved.rows[0]!.after.date).toBe("2026-09-10");
    expect(moved.onlyIf).toContain("really reached Bank");
  });

  it("offers every finding as kept as it is first, moving nothing, in the same group as its fixes", () => {
    for (const f of ready.fixes) {
      // A row the database refuses as it is has its balance-keeping fix in place of a note.
      if (f.rows.some((r) => r.before.total !== r.before.amount + r.before.fee)) continue;
      const keep = all.fixes.find((k) => isKeep(k.title) && k.group === f.group)!;
      expect(all.fixes.indexOf(keep)).toBeLessThan(all.fixes.indexOf(f));
      expect(keep.words).toContain("nothing moves");
      for (const r of keep.rows) expect(r.after).toEqual({ ...r.before, notes: expect.stringContaining("kept as it is") });
    }
  });

  it("says where a balance ends up before it moves", () => {
    const split = ready.fixes.find((f) => f.rows.some((r) => r.before.recordNumber === 2))!;
    expect(split.onlyIf).toMatch(/Cash really holds ₱\S+ once it is applied \(it shows ₱\S+ now\)/);
  });

  it("stops listing a finding once kept", () => {
    const keep = all.fixes.find((k) => isKeep(k.title))!;
    const byId = new Map(keep.rows.map((r) => [r.after.id, r.after] as const));
    const after = ledger.map((t) => byId.get(t.id) ?? t);
    const ids = new Set(actionableIssues(checkIntegrity(after, { wallets, asOf: "2026-09-20" })).flatMap((i) => i.ids));
    for (const r of keep.rows) expect(ids.has(r.before.id)).toBe(false);
  });

  it("never offers a fix the checks would flag in turn", () => {
    for (const f of ready.fixes) {
      const byId = new Map(f.rows.map((r) => [r.after.id, r.after] as const));
      const after = ledger.map((t) => byId.get(t.id) ?? t);
      const fresh = actionableIssues(checkIntegrity(after, { wallets, asOf: "2026-09-20" })).filter((i) => i.ids.some((id) => byId.has(id)) && i.code !== "below-zero-day");
      expect(fresh.filter((i) => !actionableIssues(checkIntegrity(ledger, { wallets, asOf: "2026-09-20" })).some((j) => j.code === i.code && j.ids.join() === i.ids.join()))).toEqual([]);
    }
  });
});

describe("a row the database refuses as it was", () => {
  it("is put back with every wallet moved as before, in a shape the database takes", () => {
    // Invented: a transfer whose total left out its fee, as imported.
    const imported = row({ type: "Transfer", toWallet: "Cash", item: "Transaction Fee", amount: 100_000, fee: 1_800, total: 100_000 });
    const fixed = consistentRow(imported);
    expect(fixed.total).toBe(fixed.amount + fixed.fee);
    expect(fixed).toMatchObject({ amount: 100_000, fee: 0, total: 100_000, item: "" });
    for (const w of ["Bank", "Cash"]) expect(walletDelta(fixed, (x) => x === w)).toBe(walletDelta(imported, (x) => x === w));
  });

  it("offers keeping the balances first, and no notes-only keep the database would refuse", () => {
    const imported = row({ type: "Transfer", toWallet: "Cash", item: "Transaction Fee", amount: 100_000, fee: 1_800, total: 100_000, date: "2026-09-02" });
    const ready = reviewFixes([ledger[0]!, imported], { wallets, asOf: "2026-09-20" });
    const mine = ready.fixes.filter((f) => f.rows.some((r) => r.before.id === imported.id));
    expect(mine[0]!.title).toContain("keep the balances as they are");
    expect(mine.some((f) => /: keep it as it is$/.test(f.title))).toBe(false);
    for (const f of mine) for (const r of f.rows) expect(r.after.total).toBe(r.after.amount + r.after.fee);
  });
});
