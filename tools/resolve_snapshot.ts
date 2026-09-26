/**
 * A clean snapshot of the live ledger, every review finding resolved.
 *
 * The owner, 27 September 2026: "give me json too for new snapshot so I can
 * start fresh, all should be resolved". The input is the ledger as it stands
 * (from a Coderview export, kept out of the repository); the output is a file
 * for Settings, Start clean from this file.
 *
 * Every change is a relabelling or a re-filing that moves the same money the
 * same way. The script proves it: every wallet's balance, every year's
 * spending and income, and every debt's position are compared before and
 * after, and it refuses to write the file if any of them differ.
 *
 * Run from app/:
 *
 *   npx vite-node ../tools/resolve_snapshot.ts IN.json OUT_DIR
 *
 * IN.json: { live: Transaction[], settings, budgets }.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createBackup, validateBackup } from "../app/src/domain/backup";
import { allWalletBalances } from "../app/src/domain/balances";
import { positionsOf } from "../app/src/domain/debt";
import { actionableIssues, checkIntegrity, type Issue } from "../app/src/domain/integrity";
import { normaliseSettings } from "../app/src/domain/settings";
import { costOf, incomeOf } from "../app/src/domain/totals";
import type { Transaction } from "../app/src/domain/types";

const [input, out] = process.argv.slice(2);
if (!input || !out) throw new Error("usage: vite-node ../tools/resolve_snapshot.ts IN.json OUT_DIR");

const dump = JSON.parse(readFileSync(input, "utf8")) as {
  live: (Transaction & Record<string, unknown>)[];
  settings: unknown;
  budgets: Record<string, unknown>;
};

// Only the fields a transaction has; Coderview's own additions stay behind.
const FIELDS = [
  "id", "recordNumber", "date", "type", "fromWallet", "toWallet", "category", "item", "description",
  "amount", "fee", "total", "notes", "status", "debtId", "debtEffect", "partOf", "entrySource", "time",
] as const;
const before: Transaction[] = dump.live.map((row) => {
  const t: Record<string, unknown> = {};
  for (const f of FIELDS) if (row[f] !== undefined) t[f] = row[f];
  return t as unknown as Transaction;
});

const issues = actionableIssues(checkIntegrity(before));
const notes: string[] = [];
const fixes = new Map<string, Transaction>();

/** One finding, resolved the way the app itself would have saved the row. */
function resolve(issue: Issue, t: Transaction): Transaction | null {
  const tag = `#${t.recordNumber} ${t.date}`;
  if (issue.code === "uncategorised-fee" && t.type === "Transfer") {
    const sentOut = !t.toWallet.trim();
    notes.push(`${tag}: transfer fee filed as Spending / ${sentOut ? "Money Send" : "Transaction Fee"}, as the Add form saves it. Money moved: unchanged.`);
    return { ...t, category: "Spending", item: sentOut ? "Money Send" : "Transaction Fee" };
  }
  if (issue.code === "fee-row-with-amount" && t.type === "Spending") {
    notes.push(`${tag}: "${t.description}" was a fee row holding PHP ${(t.amount / 100).toFixed(2)}: re-filed as money sent out (Money Send), fee kept. Spent: unchanged.`);
    return { ...t, type: "Transfer", toWallet: "", category: "Spending", item: "Money Send", status: t.status || "Transferred" };
  }
  if (issue.code === "transfer-same-wallet" && t.type === "Transfer") {
    notes.push(`${tag}: ${t.fromWallet} to ${t.fromWallet} moves nothing but its fee: now the PHP ${(t.fee / 100).toFixed(2)} fee alone. ${t.fromWallet}'s balance: unchanged.`);
    return {
      ...t,
      type: "Spending",
      toWallet: "",
      category: "Spending",
      item: "Transaction Fee",
      // A fee row carries its money in the fee column, which is what the fee check reads.
      amount: 0,
      fee: t.fee,
      total: t.fee,
      notes: [t.notes, `Was a ${t.fromWallet} to ${t.fromWallet} transfer of PHP ${(t.amount / 100).toFixed(2)} with this fee.`].filter(Boolean).join(" "),
    };
  }
  return null;
}

const unresolved: string[] = [];
for (const issue of issues) {
  for (const id of issue.ids) {
    const t = fixes.get(id) ?? before.find((r) => r.id === id);
    if (!t) continue;
    const fixed = resolve(issue, t);
    if (fixed) fixes.set(id, fixed);
    else unresolved.push(`${issue.code} #${t.recordNumber}: ${issue.message}`);
  }
}
const after = before.map((t) => fixes.get(t.id) ?? t);

// ── The proof ────────────────────────────────────────────────────────────
const settings = normaliseSettings(dump.settings);
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const byYear = (rows: readonly Transaction[], f: (t: Transaction) => number): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const t of rows) out[t.date.slice(0, 4)] = (out[t.date.slice(0, 4)] ?? 0) + f(t);
  return out;
};
const asOf = [...after].map((t) => t.date).sort().at(-1) ?? "2026-12-31";
const proofs: [string, boolean][] = [
  ["every wallet's balance", same(allWalletBalances(before), allWalletBalances(after))],
  ["spending, year by year", same(byYear(before, costOf), byYear(after, costOf))],
  ["income, year by year", same(byYear(before, incomeOf), byYear(after, incomeOf))],
  ["every debt's position", same(positionsOf(settings.credits, before, asOf), positionsOf(settings.credits, after, asOf))],
  ["the same rows, the same ids", same(before.map((t) => t.id), after.map((t) => t.id))],
];
const left = actionableIssues(checkIntegrity(after));
proofs.push(["no finding left to review", left.length === 0 && unresolved.length === 0]);

for (const [what, ok] of proofs) console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
if (proofs.some(([, ok]) => !ok)) {
  for (const i of left) console.log(`  left: ${i.code} ${i.recordNumbers.join(",")} ${i.message}`);
  for (const u of unresolved) console.log(`  unresolved: ${u}`);
  throw new Error("Not written: the snapshot would not match the ledger it came from.");
}

const now = new Date().toISOString();
const backup = createBackup(
  {
    transactions: after,
    deleted: [],
    budgets: dump.budgets as never,
    settings,
    preferences: { theme: settings.theme },
    migrations: { debt: true, opening: true },
  },
  now,
);
const valid = validateBackup(JSON.parse(JSON.stringify(backup)));
if (!valid.ok) throw new Error(`Not written: the file does not validate (${valid.problems.map((p) => p.message).join("; ")}).`);

const day = now.slice(0, 10);
writeFileSync(join(out, `fms-snapshot-${day}.json`), JSON.stringify(backup, null, 2), "utf8");
writeFileSync(
  join(out, `snapshot-report-${day}.md`),
  [
    `# Snapshot ${day}`,
    "",
    `${after.length} entries, ${fixes.size} put right, nothing else changed.`,
    "",
    ...notes.map((n) => `- ${n}`),
    "",
    ...proofs.map(([what, ok]) => `- ${ok ? "Checked" : "FAILED"}: ${what}`),
  ].join("\n"),
  "utf8",
);
console.log(`written: ${fixes.size} fixed, ${after.length} rows`);
for (const n of notes) console.log(`  ${n}`);
