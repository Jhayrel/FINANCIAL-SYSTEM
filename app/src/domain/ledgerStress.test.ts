/**
 * The whole ledger under stress (owner, 9 November 2026: "very hard test ...
 * stress test"): random ledgers with every kind of row, and every part of the
 * app that reads the same money made to agree with every other. Seeded, so a
 * failure repeats exactly. Invented data only.
 */
import { describe, expect, it } from "vitest";

import { allWalletBalances } from "./balances";
import { assessMonth, budgetForMonth } from "./budget";
import { buildChart } from "./charts";
import { spreadCovered } from "./covers";
import { trendOf } from "./insightWindow";
import { statementBudget } from "./statementBudget";
import { buildSheet } from "./statementSheet";
import { costOf, monthTotals } from "./totals";
import type { ReferenceLists, Transaction } from "./types";

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

const WALLETS = ["Cash", "Gcash", "Maya"];
const reference = {
  wallets: WALLETS,
  savings: ["Maya Bank"],
  bills: ["Globe"],
  subscriptions: ["Spotify"],
  revenueCategories: ["Allowance", "Salary"],
  spendingTypes: ["Food", "Gas", "Fun", "School"].map((name) => ({ name, remark: "" })),
  credits: ["Maya Credit"],
  stopped: [],
  allocations: [],
} as unknown as ReferenceLists;
const debts = [
  { id: "mc", name: "Maya Credit", counterparty: "Maya", kind: "payable", archived: false },
  { id: "ana", name: "Ana", counterparty: "Ana", kind: "receivable", form: "informal", counterpartyType: "person", archived: false },
] as never[];

function randomLedger(r: () => number, size: number): Transaction[] {
  const out: Transaction[] = [];
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
  const day = (): string => `2026-${String(9 + Math.floor(r() * 3)).padStart(2, "0")}-${String(1 + Math.floor(r() * 28)).padStart(2, "0")}`;
  const money = (most: number): number => (1 + Math.floor(r() * most)) * 100 + (r() < 0.3 ? Math.floor(r() * 100) : 0);
  let n = 0;
  const add = (over: Partial<Transaction>): void => {
    n += 1;
    const amount = over.amount ?? money(500);
    const fee = over.fee ?? 0;
    out.push({ id: `t-${n}`, recordNumber: n, date: day(), type: "Spending", fromWallet: "", toWallet: "", category: "Spending", item: "", description: "", notes: "", status: "Paid", ...over, amount, fee, total: amount + fee } as Transaction);
  };
  for (const w of WALLETS) add({ date: "2026-09-01", type: "Revenue", category: "Opening", item: "Opening balance", toWallet: w, amount: money(5000), status: "Received" });
  for (let i = 0; i < size; i += 1) {
    const roll = r();
    if (roll < 0.35) add({ type: "Spending", category: "Spending", item: pick(["Food", "Gas", "Fun", "School"]), fromWallet: pick(WALLETS), ...(r() < 0.1 ? { coversTo: "2026-11-28" } : {}) });
    else if (roll < 0.45) add({ type: "Spending", category: r() < 0.5 ? "Bills" : "Subscriptions", item: r() < 0.5 ? "Globe" : "Spotify", fromWallet: pick(WALLETS) });
    else if (roll < 0.6) add({ type: "Revenue", category: "Revenue", item: pick(["Allowance", "Salary"]), toWallet: pick([...WALLETS, "Maya Bank"]), amount: money(3000), status: "Received" });
    else if (roll < 0.72) { const from = pick(WALLETS); add({ type: "Transfer", category: "Spending", item: "Transaction Fee", fromWallet: from, toWallet: pick([...WALLETS.filter((w) => w !== from), "Maya Bank"]), fee: r() < 0.6 ? money(20) : 0, status: "Transferred" }); }
    else if (roll < 0.77) add({ type: "Transfer", category: "Spending", item: "Money Send", fromWallet: pick(WALLETS), toWallet: "", fee: r() < 0.5 ? 1_000 : 0, status: "Transferred" });
    else if (roll < 0.83) add({ type: "Debt", category: "", item: "Maya Credit", toWallet: pick(WALLETS), debtId: "mc", debtEffect: "draw", status: "Received" });
    else if (roll < 0.88) add({ type: "Debt", category: "", item: "Maya Credit", fromWallet: pick(WALLETS), debtId: "mc", debtEffect: "repay" });
    else if (roll < 0.91) add({ type: "Debt", category: "", item: "Maya Credit", debtId: "mc", debtEffect: "charge", status: "" });
    else if (roll < 0.95) add({ type: "Debt", category: "", item: "", fromWallet: pick(WALLETS), debtId: "ana", debtEffect: "lend" });
    else if (roll < 0.98) add({ type: "Debt", category: "", item: "", toWallet: pick(WALLETS), debtId: "ana", debtEffect: "collect", status: "Received" });
    else add({ type: "Debt", category: "Spending", item: "", debtId: "ana", debtEffect: "writeoff", status: "" });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.recordNumber - b.recordNumber);
}

const MONTHS: [number, number][] = [[2026, 9], [2026, 10], [2026, 11]];
const NAMES = ["", "", "", "", "", "", "", "", "", "September", "October", "November"];

describe("every part of the app reads the same money the same way", () => {
  for (const seed of Array.from({ length: 12 }, (_, i) => i + 1)) {
    it(`seed ${seed}`, () => {
      const r = rng(seed * 7919);
      const raw = randomLedger(r, 260);
      const rows = spreadCovered(raw);
      const asOf = "2026-11-30";
      const budgets = { "2026": { spending: Array(12).fill(1_000_000), billsSubs: Array(12).fill(200_000) } } as never;
      const byMonth = buildChart("spending by month this year", rows, asOf, undefined, null, 200)!;
      for (const [y, m] of MONTHS) {
        const ym = `${y}-${String(m).padStart(2, "0")}`;
        const total = monthTotals(rows, y, m).total;
        // Money only ever in whole centavos.
        expect(Number.isInteger(total)).toBe(true);
        // The month total is what every spending row and fee cost.
        expect(total).toBe(rows.filter((t) => t.date.slice(0, 7) === ym).reduce((s, t) => s + costOf(t), 0));
        // The chart's bar, by item, by wallet; Insights' calendar; Budget's two tracks.
        expect(byMonth.rows.find((x) => x.label.startsWith(NAMES[m]!))?.value ?? 0).toBe(total);
        const inMonth = `spending by item in ${NAMES[m]!.toLowerCase()}`;
        expect(buildChart(inMonth, rows, asOf, undefined, null, 500)?.total ?? 0).toBe(total);
        const days = trendOf(rows, { start: `${ym}-01`, end: `${ym}-${m === 9 || m === 11 ? "30" : "31"}` }, "day");
        expect(days.reduce((s, p) => s + p.spent, 0)).toBe(total);
        const a = assessMonth(monthTotals(rows, y, m), budgetForMonth(budgets, y, m));
        expect(a.spending.spent + a.billsSubs.spent).toBe(total);
        // The statement's budget part and its expense sheet agree with all of it.
        const b = statementBudget("expense", raw, budgets, `${ym}-01`, `${ym}-${m === 9 || m === 11 ? "30" : "31"}`)!;
        expect(b.months[0]!.parts.filter((p) => p.kind === "spending" || p.kind === "bills").reduce((s, p) => s + p.spent, 0)).toBe(total);
        const sheet = buildSheet(raw, { type: "expense", year: y, fromMonth: m, toMonth: m }, reference, debts);
        expect(sheet.totalOut).toBe(total);
      }
      // The account statement ends where the wallets and savings are.
      const account = buildSheet(raw, { type: "account", year: 2026, fromMonth: 9, toMonth: 11 }, reference, debts);
      const held = [...allWalletBalances(raw)].filter(([w]) => [...WALLETS, "Maya Bank"].includes(w)).reduce((s, [, v]) => s + v, 0);
      expect(account.closing).toBe(held);
    });
  }
});
