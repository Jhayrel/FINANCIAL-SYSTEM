/**
 * Where the money came from and where it went, for a stretch of days.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * The owner, 28 September 2026: "why I have 19k of spending this month? like
 * where do the funds even comming from?", then "give me the exact source".
 * The model answered that September's PHP 21,791.45 came from "Cash PHP
 * 14.00, Gcash PHP 15,000.00 and Maya Bank interest PHP 6.25", which adds up
 * to PHP 15,020.25, and that "no credit entries are recorded for this month"
 * when two Maya Credit draws and PHP 25,000.00 held for a funeral were.
 * It had totals and a list of rows, and was left to do the reconciling
 * itself, which it must never do.
 *
 * So the app does it. The spending wallets are treated as one pool, the
 * money the owner can use, and every row that moved money into or out of
 * that pool is put under what it was: income, borrowing, money held for
 * someone, money brought out of savings; spending, bills, repayments, money
 * put aside. The start, every part and the end are all worked out here, in
 * centavos, with the same rules the balances use (`balances.ts`, rule 3.1),
 * so the end is the start plus what came in less what went out, exactly.
 */

import type { Debt } from "./debt";
import type { Centavos } from "./money";
import type { IsoDate, Transaction } from "./types";

export interface FlowLine {
  /** What it was, in words: "Allowance", "Borrowed on Maya Credit". */
  readonly name: string;
  readonly amount: Centavos;
  readonly count: number;
  /** The wallets it came into or left from, with how much each. */
  readonly wallets: readonly { readonly wallet: string; readonly amount: Centavos }[];
  /** The days, for a handful of movements; empty when there are many. */
  readonly days: readonly IsoDate[];
}

export interface FlowGroup {
  readonly title: string;
  readonly total: Centavos;
  readonly lines: readonly FlowLine[];
}

export interface MoneyFlow {
  readonly from: IsoDate;
  readonly to: IsoDate;
  /** The spending wallets, the pool this is about. */
  readonly pool: readonly string[];
  readonly start: Centavos;
  readonly end: Centavos;
  readonly moneyIn: readonly FlowGroup[];
  readonly moneyOut: readonly FlowGroup[];
  readonly totalIn: Centavos;
  readonly totalOut: Centavos;
  /** Income that went straight to savings or reserve, never into the pool. */
  readonly besidePool: readonly FlowLine[];
}

type Bucket = Map<string, Map<string, { amount: Centavos; count: number; wallets: Map<string, Centavos>; days: IsoDate[] }>>;

const add = (bucket: Bucket, group: string, name: string, wallet: string, amount: Centavos, day: IsoDate): void => {
  if (amount === 0) return;
  const lines = bucket.get(group) ?? new Map();
  const line = lines.get(name) ?? { amount: 0, count: 0, wallets: new Map<string, Centavos>(), days: [] };
  line.amount += amount;
  line.count += 1;
  line.wallets.set(wallet, (line.wallets.get(wallet) ?? 0) + amount);
  line.days.push(day);
  lines.set(name, line);
  bucket.set(group, lines);
};

const groupsOf = (bucket: Bucket, order: readonly string[]): FlowGroup[] =>
  order
    .filter((title) => bucket.has(title))
    .map((title) => {
      const lines = [...(bucket.get(title) ?? new Map()).entries()]
        .map(([name, l]) => ({
          name,
          amount: l.amount,
          count: l.count,
          wallets: [...l.wallets.entries()].map(([wallet, amount]) => ({ wallet, amount })).sort((a, b) => b.amount - a.amount),
          days: l.days.length <= 4 ? [...l.days].sort() : [],
        }))
        .sort((a, b) => b.amount - a.amount);
      return { title, total: lines.reduce((sum, l) => sum + l.amount, 0), lines };
    });

const IN_ORDER = ["Income", "Borrowed", "Held for someone else", "Paid back to you", "Brought out of savings or reserve", "Other money in"] as const;
const OUT_ORDER = [
  "Spending",
  "Bills",
  "Subscriptions",
  "Sent away",
  "Transfer fees",
  "Interest and charges paid",
  "Repaid",
  "Lent or advanced",
  "Passed on for someone else",
  "Put into savings or reserve",
  "Other money out",
] as const;

/** The balance of the pool before a day, by the balance rule (`balances.ts`). */
function poolBefore(rows: readonly Transaction[], pool: ReadonlySet<string>, day: IsoDate): Centavos {
  let balance = 0;
  for (const t of rows) {
    if (t.date >= day) continue;
    if (t.type === "Revenue" && pool.has(t.fromWallet)) balance += t.total;
    if (pool.has(t.toWallet)) balance += t.amount;
    if (pool.has(t.fromWallet) && t.type !== "Revenue") balance -= t.total;
  }
  return balance;
}

export function moneyFlow(
  transactions: readonly Transaction[],
  pool: readonly string[],
  from: IsoDate,
  to: IsoDate,
  debts: readonly Debt[] = [],
): MoneyFlow {
  const rows = transactions.filter((t) => !(t as Transaction & { deletedAt?: string }).deletedAt);
  const inPool = new Set(pool);
  const debtName = new Map(debts.map((d) => [d.id, d]));
  const incoming: Bucket = new Map();
  const outgoing: Bucket = new Map();
  const beside: Bucket = new Map();

  for (const t of rows) {
    if (t.date < from || t.date > to) continue;
    const debt = t.debtId ? debtName.get(t.debtId) : undefined;
    const who = debt?.name || t.item.trim() || "a debt";
    const onBehalf = debt?.form === "pass-through";
    const label = t.item.trim() || t.category.trim() || t.type;

    // ── In ────────────────────────────────────────────────────────────────
    const revenueIn = t.type === "Revenue" && inPool.has(t.fromWallet) ? t.total : 0;
    const arrivesIn = inPool.has(t.toWallet) && !(t.type === "Revenue" && inPool.has(t.fromWallet) && t.fromWallet === t.toWallet) ? t.amount : 0;
    const leaves = inPool.has(t.fromWallet) && t.type !== "Revenue" ? t.total : 0;
    const wallet = inPool.has(t.toWallet) ? t.toWallet : t.fromWallet;

    // A move between two spending wallets is not money in or out: only its fee left.
    if (t.type === "Transfer" && inPool.has(t.fromWallet) && inPool.has(t.toWallet)) {
      add(outgoing, "Transfer fees", "Moving between your spending wallets", t.fromWallet, t.total - t.amount, t.date);
      continue;
    }

    if (t.type === "Revenue") {
      const amount = revenueIn + (inPool.has(t.toWallet) ? t.amount : 0);
      // What was already held when counting started: in the balance, never income.
      if (t.category === "Opening") {
        if (amount > 0) add(incoming, "Other money in", "Balance carried in when counting started", wallet, amount, t.date);
        continue;
      }
      if (amount > 0) add(incoming, "Income", label, wallet, amount, t.date);
      else if (t.toWallet || t.fromWallet) add(beside, "Beside", label, t.toWallet || t.fromWallet, t.total, t.date);
      continue;
    }

    if (arrivesIn > 0) {
      if (t.type === "Transfer") add(incoming, "Brought out of savings or reserve", `From ${t.fromWallet || "outside your accounts"}`, t.toWallet, arrivesIn, t.date);
      else if (t.type === "Debt" && t.debtEffect === "draw") add(incoming, onBehalf ? "Held for someone else" : "Borrowed", onBehalf ? who : `Borrowed on ${who}`, t.toWallet, arrivesIn, t.date);
      else if (t.type === "Debt" && t.debtEffect === "collect") add(incoming, onBehalf ? "Paid back to you" : "Paid back to you", who, t.toWallet, arrivesIn, t.date);
      else add(incoming, "Other money in", `${t.type}: ${label}`, t.toWallet, arrivesIn, t.date);
    }

    if (leaves > 0) {
      if (t.type === "Spending") {
        const group = t.category === "Bills" ? "Bills" : t.category === "Subscriptions" ? "Subscriptions" : "Spending";
        add(outgoing, group, label, t.fromWallet, leaves, t.date);
      } else if (t.type === "Transfer") {
        const fee = t.total - t.amount;
        if (!t.toWallet) add(outgoing, "Sent away", t.item.trim() && t.item !== "Money Send" ? t.item : t.description.trim().slice(0, 40) || "Money sent", t.fromWallet, t.amount, t.date);
        else add(outgoing, "Put into savings or reserve", `To ${t.toWallet}`, t.fromWallet, t.amount, t.date);
        if (fee > 0) add(outgoing, "Transfer fees", "Fees on transfers", t.fromWallet, fee, t.date);
      } else if (t.type === "Debt") {
        const effect = t.debtEffect;
        const principal = t.amount;
        const fee = Math.max(0, t.total - t.amount);
        if (effect === "interest" || effect === "fee" || effect === "charge") add(outgoing, "Interest and charges paid", who, t.fromWallet, principal, t.date);
        else if (effect === "repay") add(outgoing, onBehalf ? "Passed on for someone else" : "Repaid", who, t.fromWallet, principal, t.date);
        else if (effect === "lend") add(outgoing, "Lent or advanced", who, t.fromWallet, principal, t.date);
        else add(outgoing, "Other money out", `${effect ?? "debt"}: ${who}`, t.fromWallet, principal, t.date);
        if (fee > 0) add(outgoing, "Transfer fees", "Fees on debt payments", t.fromWallet, fee, t.date);
      } else {
        add(outgoing, "Other money out", `${t.type}: ${label}`, t.fromWallet, leaves, t.date);
      }
    }
  }

  const moneyIn = groupsOf(incoming, IN_ORDER);
  const moneyOut = groupsOf(outgoing, OUT_ORDER);
  const totalIn = moneyIn.reduce((sum, g) => sum + g.total, 0);
  const totalOut = moneyOut.reduce((sum, g) => sum + g.total, 0);
  const start = poolBefore(rows, inPool, from);
  const nextDay = new Date(Date.parse(`${to}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const end = poolBefore(rows, inPool, nextDay);
  return {
    from,
    to,
    pool,
    start,
    end,
    moneyIn,
    moneyOut,
    totalIn,
    totalOut,
    besidePool: groupsOf(beside, ["Beside"])[0]?.lines ?? [],
  };
}

/** The flow, as lines the model reads. `money` formats centavos. */
export function flowWords(f: MoneyFlow, money: (c: Centavos) => string): string[] {
  const line = (l: FlowLine): string => {
    const where = l.wallets.length > 1 ? ` (${l.wallets.map((w) => `${w.wallet} ${money(w.amount)}`).join(", ")})` : l.wallets[0]?.wallet ? ` into or from ${l.wallets[0].wallet}` : "";
    const when = l.days.length > 0 ? `, on ${l.days.join(", ")}` : `, ${l.count} entries`;
    return `  - ${l.name}: ${money(l.amount)}${where}${when}`;
  };
  const out = [
    `The spending wallets (${f.pool.join(", ")}) are the money they can use. Every movement into or out of them from ${f.from} to ${f.to}, worked out by the app; each group's lines add up to its total, and start plus in less out is the end. Quote these; never add them up yourself.`,
    `Started with ${money(f.start)} in the spending wallets.`,
    `Money in: ${money(f.totalIn)}.`,
  ];
  for (const g of f.moneyIn) {
    out.push(`- ${g.title}: ${money(g.total)}`);
    for (const l of g.lines.slice(0, 10)) out.push(line(l).replace("into or from", "into"));
  }
  out.push(`Money out: ${money(f.totalOut)}.`);
  for (const g of f.moneyOut) {
    out.push(`- ${g.title}: ${money(g.total)}`);
    for (const l of g.lines.slice(0, 8)) out.push(line(l).replace("into or from", "from"));
    if (g.lines.length > 8) out.push(`  - and ${g.lines.length - 8} more`);
  }
  out.push(`Ended with ${money(f.end)}: ${money(f.start)} + ${money(f.totalIn)} - ${money(f.totalOut)}.`);
  if (f.besidePool.length > 0) {
    out.push(`Also came in, but straight to savings or reserve, not to the spending wallets: ${f.besidePool.map((l) => `${l.name} ${money(l.amount)} into ${l.wallets[0]?.wallet ?? ""}`).join("; ")}.`);
  }
  return out;
}
