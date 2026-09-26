/**
 * Turn the rebuilt 2023 to 2025 history into a backup file the app merges.
 *
 * Reads DIR/history.json (written by tools/migrate_history.py) and writes
 * DIR/fms-history-2023-2025.json and DIR/report.md. The directory is outside
 * the repository: this is the owner's financial history and is never
 * committed.
 *
 * Run from app/, so the app's own code builds and checks the file:
 *
 *   npx vite-node ../tools/build_history_backup.ts DIR
 *
 * ── Joining the years ────────────────────────────────────────────────────
 *
 * Each old workbook started a year from its own figures, and none of them
 * started where the previous one ended: the 2024 workbook starts every
 * account at zero, 2025 opens with its own carried-forward rows, and 2026's
 * opening rows (docs/08, rule Y1) are already in the ledger. Copied as they
 * are, the balances would be counted again at every New Year.
 *
 * So at each year end, every account's closing balance is handed over in one
 * row dated 1 January, category Opening: neither spending nor income, the
 * mirror of the Opening rows the next year starts with. Each year then shows
 * exactly the figures its own workbook shows, and the ledger from 2026 on is
 * untouched: the history nets to zero by the time 2026's own rows begin.
 *
 * ── What it checks before writing anything ───────────────────────────────
 *
 * The file validates, merging it adds every row and nothing twice, merging
 * it again adds nothing, every account's balance from 2026 on is exactly what
 * it was, and each year closes on its workbook's figures.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createBackup, restore, validateBackup } from "../app/src/domain/backup";
import { defaultSettings } from "../app/src/domain/settings";
import { allWalletBalances } from "../app/src/domain/balances";
import { costOf, incomeOf } from "../app/src/domain/totals";
import { checkIntegrity } from "../app/src/domain/integrity";
import { positionOf, type Debt } from "../app/src/domain/debt";
import type { Account } from "../app/src/domain/accounts";
import type { Transaction } from "../app/src/domain/types";

const dir = process.argv[2];
if (!dir) throw new Error("usage: vite-node ../tools/build_history_backup.ts DIR");

interface YearData {
  rows: Transaction[];
  checks: { what: string; workbook: number; migrated: number; ok: boolean }[];
  notes: string[];
  roundingCentavos: number;
  debts?: FoundDebt[];
}
/** A debt the migration found in a year's rows (migrate_history.py, Year.debt). */
interface FoundDebt {
  id: string;
  name: string;
  kind: "payable" | "receivable";
  counterparty: string;
  counterpartyType: "person" | "institution";
  openedDate: string;
  wallet: string;
}
const history = JSON.parse(readFileSync(join(dir, "history.json"), "utf8")) as {
  years: Record<string, YearData>;
  current2026?: Transaction[];
};

const YEARS = Object.keys(history.years).map(Number).sort();
const peso = (c: number): string =>
  `${c < 0 ? "-" : ""}₱${(Math.abs(c) / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// ── The debts the workbooks describe ──────────────────────────────────────

const rows: Transaction[] = YEARS.flatMap((y) => history.years[String(y)]?.rows ?? []);
const found = YEARS.flatMap((y) => history.years[String(y)]?.debts ?? []);
const totalOf = (id: string, effect: string): number =>
  rows.filter((t) => t.debtId === id && t.debtEffect === effect).reduce((s, t) => s + t.total, 0);

// Money borrowed before the records began is only ever seen being repaid. What
// was owed when they begin is what the repayments add up to, booked as an
// Opening draw: where the debt stood, as an Opening row is where a wallet stood.
for (const d of found) {
  const owed = d.kind === "payable" ? totalOf(d.id, "repay") - totalOf(d.id, "draw") : 0;
  if (owed <= 0) continue;
  const first = rows.filter((t) => t.debtId === d.id).map((t) => t.date).sort()[0]!;
  const opened = `${first.slice(0, 4)}-01-01`;
  d.openedDate = opened;
  rows.push({
    id: `${d.id}-owed`,
    recordNumber: 0,
    date: opened,
    type: "Debt",
    fromWallet: "",
    toWallet: "",
    category: "Opening",
    item: d.name,
    description: `Owed to ${d.counterparty} when the ${first.slice(0, 4)} records begin`,
    amount: owed,
    fee: 0,
    total: owed,
    notes:
      "Added by the migration. Borrowed before the records began, so the amount is what the recorded repayments add up to. The money was received before then, so no wallet moves here.",
    status: "Done",
    debtId: d.id,
    debtEffect: "draw",
  });
}

const credits: Debt[] = found.map((d) => {
  // The opening draw is in rows by now, so a repaid debt is one whose repayments reach its draws.
  const settled = d.kind === "payable" && totalOf(d.id, "repay") >= totalOf(d.id, "draw");
  return {
    id: d.id,
    name: d.name,
    kind: d.kind,
    counterparty: d.counterparty,
    openedDate: d.openedDate,
    wallet: d.wallet,
    interestType: "none",
    interestRate: 0,
    form: d.counterpartyType === "institution" ? "credit-line" : "informal",
    counterpartyType: d.counterpartyType,
    notes:
      d.kind === "payable"
        ? "From the old workbooks: borrowed before the records began and repaid in them. The last repayment clears it."
        : "From the old workbooks: money lent, with no repayment recorded. If it was paid back, record it as collected; if it will not be, write it off.",
    // A debt cleared inside the history is kept for the record, not offered.
    archived: settled,
  };
});

// ── Joining the years ─────────────────────────────────────────────────────

const handovers: Transaction[] = [];
const closings: Record<number, Map<string, number>> = {};
for (const y of YEARS) {
  const through = [...rows, ...handovers].filter((t) => t.date <= `${y}-12-31`);
  const closing = allWalletBalances(through);
  closings[y] = closing;
  for (const [account, balance] of [...closing.entries()].sort()) {
    if (balance === 0) continue;
    const next = y + 1;
    const text = `The ${y} records closed ${account} at ${peso(balance)}. ${next}'s records start from their own opening figures, so the ${y} balance is handed over here and counted once.`;
    handovers.push({
      id: `hist-close-${y}-${slug(account)}`,
      recordNumber: 0,
      date: `${next}-01-01`,
      // Out of the account if it held money, into it if it closed below zero. Opening: neither spending nor income.
      type: balance > 0 ? "Spending" : "Revenue",
      fromWallet: balance > 0 ? account : "",
      toWallet: balance > 0 ? "" : account,
      category: "Opening",
      item: `Balance at the end of ${y}`,
      description: text,
      amount: Math.abs(balance),
      fee: 0,
      total: Math.abs(balance),
      notes: "Added by the migration where one year's workbook ends and the next begins. Neither spending nor income.",
      status: "Done",
    });
  }
}

// Chronological, and on a New Year the handover first, so no running balance dips through the join.
const all = [...handovers, ...rows]
  .map((t, i) => ({ t, i }))
  .sort((a, b) =>
    a.t.date === b.t.date ? (a.t.id.startsWith("hist-close-") ? -1 : b.t.id.startsWith("hist-close-") ? 1 : a.i - b.i) : a.t.date < b.t.date ? -1 : 1,
  )
  .map(({ t }, i) => ({ ...t, recordNumber: i + 1 }));

// ── Accounts the history names ─────────────────────────────────────────────

const named = new Set(all.flatMap((t) => [t.fromWallet, t.toWallet]).filter(Boolean));
const KNOWN: Record<string, Omit<Account, "id" | "name">> = {
  Cash: { kind: "spending", archived: false, channel: "cash" },
  Gcash: { kind: "spending", archived: false },
  Maya: { kind: "spending", archived: false },
  "Maya Bank (Personal savings)": { kind: "savings", archived: false },
  "Extra Cash": { kind: "reserve", archived: false, channel: "cash" },
};
const accounts: Account[] = [...named].sort().map((name) => ({
  id: `hist-acct-${slug(name)}`,
  name,
  // Accounts the history uses and the app does not track any more come in retired: kept, counted, not offered.
  ...(KNOWN[name] ?? { kind: name.startsWith("Maya Goal") ? ("savings" as const) : ("spending" as const), archived: true, openedDate: "2023-01-01" }),
}));

// ── The file ───────────────────────────────────────────────────────────────

const settings = {
  ...defaultSettings(),
  accounts,
  credits,
  // Nothing is added to the lists a screen offers or expects: an old bill here would be
  // expected every month on the Budget screen.
  bills: [],
  subscriptions: [],
  revenueCategories: [],
  spendingTypes: [],
};
const backup = createBackup(
  {
    transactions: all,
    deleted: [],
    budgets: {},
    settings,
    preferences: { theme: "system" },
    migrations: { debt: true, opening: true },
  },
  new Date().toISOString(),
);

// ── Checks, before anything is written ────────────────────────────────────

const failures: string[] = [];
const lines: string[] = [];
const say = (s = ""): void => void lines.push(s);

const validation = validateBackup(JSON.parse(JSON.stringify(backup)));
if (!validation.ok) failures.push(`The file does not validate: ${validation.problems.map((p) => p.message).join("; ")}`);

for (const y of YEARS) {
  const bad = history.years[String(y)]!.checks.filter((c) => !c.ok);
  if (bad.length) failures.push(`${y}: ${bad.length} of the workbook's own figures differ from the migrated rows`);
}

const current = history.current2026 ?? [];
const base = {
  transactions: current,
  deleted: [],
  budgets: {},
  settings: defaultSettings(),
  preferences: { theme: "system" as const },
  migrations: { debt: true, opening: true },
};
const merged = restore(backup, base, "merge");
if (merged.added !== all.length) failures.push(`Merging added ${merged.added} of ${all.length} rows: some matched rows already there`);
const again = restore(backup, merged, "merge");
if (again.added !== 0) failures.push(`Merging a second time added ${again.added} rows; it must add none`);

const before = allWalletBalances(current);
const after = allWalletBalances(merged.transactions);
const moved = [...new Set([...before.keys(), ...after.keys()])].filter((a) => (before.get(a) ?? 0) !== (after.get(a) ?? 0));
if (moved.length) failures.push(`Balances today would move: ${moved.map((a) => `${a} ${peso(before.get(a) ?? 0)} to ${peso(after.get(a) ?? 0)}`).join(", ")}`);

const today = new Date().toISOString().slice(0, 10);
const positions = credits.map((c) => ({ c, p: positionOf(c, merged.transactions, today) }));
for (const { c, p } of positions) {
  if (c.archived && p.outstanding !== 0) failures.push(`${c.name} is repaid in the records and shows ${peso(p.outstanding)} outstanding`);
}

// Findings the review list shows (not the notes it leaves out), on migrated rows only.
const newIssues = checkIntegrity(merged.transactions).filter(
  (i) => i.severity !== "info" && i.ids.some((id) => id.startsWith("h") && !id.startsWith("x")),
);
const byCode = new Map<string, number>();
for (const i of newIssues) byCode.set(i.code, (byCode.get(i.code) ?? 0) + 1);

// ── The report ─────────────────────────────────────────────────────────────

say("# Migrating 2023 to 2025");
say();
say(failures.length ? `**Not ready: ${failures.length} check(s) failed.**` : "**Ready to merge. Every check passed.**");
for (const f of failures) say(`- ${f}`);
say();
say("## What the file holds");
say();
const openings = rows.filter((t) => t.debtId && t.category === "Opening").length;
say(`- ${all.length.toLocaleString()} rows: ${YEARS.map((y) => `${y}: ${history.years[String(y)]!.rows.length}`).join(", ")}, ${openings} debt opening balance(s), and ${handovers.length} year-end handovers.`);
say(`- ${accounts.length} account names, merged by name, so the ones you already have are left as they are. New and retired: ${accounts.filter((a) => a.archived).map((a) => a.name).join(", ") || "none"}.`);
say(
  `- ${credits.length} debt(s): ${positions
    .map(({ c, p }) =>
      c.kind === "payable"
        ? `${c.name} (${p.outstanding ? `${peso(p.outstanding)} still owed` : "cleared"})`
        : `${c.name} (${peso(p.outstanding)} still owed to you${p.outstanding ? ": no repayment is recorded" : ""})`,
    )
    .join(", ") || "none"}.`,
);
say("- No bills, subscriptions, revenue categories or spending types are added to your lists, and no budgets.");
say();
say("## Every year against its own workbook");
say();
for (const y of YEARS) {
  const d = history.years[String(y)]!;
  const ok = d.checks.filter((c) => c.ok).length;
  const yr = all.filter((t) => t.date.startsWith(String(y)));
  say(`### ${y}`);
  say();
  say(`${ok} of ${d.checks.length} of the workbook's own figures reproduced to the centavo. Rounding to whole centavos moved ${(d.roundingCentavos / 100).toFixed(4)} pesos in total.`);
  say();
  say(`| | As the app will count it |`);
  say(`|---|---:|`);
  say(`| Income | ${peso(yr.reduce((s, t) => s + incomeOf(t), 0))} |`);
  say(`| Spending, bills and subscriptions | ${peso(yr.reduce((s, t) => s + costOf(t), 0))} |`);
  say(`| Moved between your own accounts | ${peso(yr.filter((t) => t.type === "Transfer" && t.fromWallet && t.toWallet).reduce((s, t) => s + t.amount, 0))} |`);
  const ncOut = yr.filter((t) => t.item === "Not classified" && t.type === "Spending");
  const ncIn = yr.filter((t) => t.item === "Not classified" && t.type === "Transfer");
  if (ncOut.length || ncIn.length) {
    say(`| Not classified, out (${ncOut.length} days) | ${peso(ncOut.reduce((s, t) => s + t.amount, 0))} |`);
    say(`| Not classified, in (${ncIn.length} days) | ${peso(ncIn.reduce((s, t) => s + t.amount, 0))} |`);
  }
  const spent = yr.filter((t) => t.type === "Spending" && t.category === "Spending");
  const itemised = spent.filter((t) => t.item && t.item !== "Day total");
  say();
  say(
    spent.some((t) => t.item === "Day total")
      ? `Spending is kept as ${spent.length} day totals: the ${y} workbook did not record each purchase.`
      : `${itemised.length} of ${spent.length} spending rows were given an item from their description (${[...new Set(itemised.map((t) => t.item))].sort().join(", ")}); the rest keep their description and no item.`,
  );
  say();
  say(`Closing balances, as the ${y} workbook shows them:`);
  say();
  for (const [a, b] of [...closings[y]!.entries()].sort()) say(`- ${a}: ${peso(b)}`);
  say();
  if (d.notes.length) {
    say("Notes:");
    say();
    for (const n of d.notes) say(`- ${n}`);
    say();
  }
}
say("## Where one year's workbook ends and the next begins");
say();
for (const y of YEARS) {
  const next = y + 1;
  const opened = next === 2026 ? current.filter((t) => t.date === "2026-01-01" && !t.fromWallet) : all.filter((t) => t.date === `${next}-01-01` && t.category === "Opening" && t.type === "Revenue" && !t.id.startsWith("hist-close-"));
  say(`- **${y} to ${next}.** Closed: ${[...closings[y]!.entries()].filter(([, b]) => b).map(([a, b]) => `${a} ${peso(b)}`).join(", ") || "nothing"}. ${next} opened: ${opened.map((t) => `${t.toWallet} ${peso(t.amount)}`).join(", ") || "every account at zero (the workbook starts from nothing)"}.`);
  if (opened.length) {
    const start = new Map(opened.map((t) => [t.toWallet, t.amount]));
    const names = [...new Set([...closings[y]!.keys(), ...start.keys()])].sort();
    const gaps = names
      .map((a) => [a, (start.get(a) ?? 0) - (closings[y]!.get(a) ?? 0)] as const)
      .filter(([, d]) => d !== 0);
    say(`  Not recorded between the two: ${gaps.map(([a, d]) => `${a} ${d > 0 ? "+" : ""}${peso(d)}`).join(", ")}. Money that came and went after the last ${y} entry and before ${next}'s first; it is shown by the handover rows, not guessed as spending or income.`);
  }
}
say();
say("## Checks on the merge");
say();
say(`- Merged into the 2026 records from your backup (${current.length} rows): ${merged.added} added, none twice. Merged again: ${again.added} added.`);
say(`- Every account's balance today: ${moved.length ? "MOVES" : "unchanged, to the centavo"}.`);
say(`- Findings the review list will show for migrated rows: ${newIssues.length ? [...byCode].map(([c, n]) => `${c} (${n}): ${newIssues.find((i) => i.code === c)!.message.replace(/\.$/, "")}`).join("; ") : "none"}.`);

writeFileSync(join(dir, "report.md"), lines.join("\n"), "utf8");
if (failures.length) {
  console.error(lines.join("\n"));
  process.exit(1);
}
writeFileSync(join(dir, "fms-history-2023-2025.json"), JSON.stringify(backup, null, 2), "utf8");
console.log(lines.join("\n"));
