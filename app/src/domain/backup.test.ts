/**
 * Backup and restore, against the real ledger.
 *
 * Most of these check that it REFUSES. A restore that silently does the wrong
 * thing to 440 rows of someone's financial history is the worst outcome this
 * module has, so declining is the behaviour worth pinning.
 */

import { describe, expect, it } from "vitest";

import { loadFixture } from "../fixtures/load";
import {
  BACKUP_VERSION,
  checksum,
  createBackup,
  restore,
  validateBackup,
  type BackupData,
} from "./backup";
import { defaultSettings } from "./settings";
import type { Transaction } from "./types";

const fixture = loadFixture();

const input: BackupData = {
  transactions: fixture.transactions,
  deleted: fixture.deleted,
  budgets: fixture.budgets,
  settings: { ...defaultSettings(), theme: "dark" },
  preferences: { theme: "dark" },
  migrations: { debt: true, opening: true },
};

const good = createBackup(input, "2026-08-30T00:00:00.000Z");
const clone = (): Record<string, unknown> => JSON.parse(JSON.stringify(good));

describe("a backup holds the whole system", () => {
  it("lists every part in the manifest", () => {
    expect(good.manifest.map((m) => m.part)).toEqual([
      "Transactions",
      "Recycle bin",
      "Accounts and goals",
      "Credit and loans",
      "Bills",
      "Subscriptions",
      "Revenue categories",
      "Spending types",
      "Budget years",
    ]);
  });

  it("carries the theme, which lives outside the settings document", () => {
    expect(good.data.preferences.theme).toBe("dark");
  });

  it("carries which one-time migrations have already run", () => {
    expect(good.data.migrations).toEqual({ debt: true, opening: true });
  });

  it("restores into an empty app byte for byte", () => {
    const v = validateBackup(clone());
    const empty: BackupData = {
      transactions: [],
      deleted: [],
      budgets: {},
      settings: defaultSettings(),
      preferences: { theme: "system" },
      migrations: { debt: false, opening: false },
    };
    const r = restore(v.backup!, empty, "replace");
    expect(r.transactions).toEqual(fixture.transactions);
    expect(r.deleted).toEqual(fixture.deleted);
    expect(r.budgets).toEqual(fixture.budgets);
    expect(r.preferences.theme).toBe("dark");
    expect(r.migrations).toEqual({ debt: true, opening: true });
  });
});

describe("checksum", () => {
  it("does not depend on key order", () => {
    expect(checksum({ a: 1, b: 2 })).toBe(checksum({ b: 2, a: 1 }));
  });

  it("changes when a single centavo changes", () => {
    const other = { ...input, transactions: [{ ...fixture.transactions[0]!, amount: 1 }] };
    expect(checksum(other)).not.toBe(checksum(input));
  });

  it("notices a hand-edited file", () => {
    const b = clone();
    const d = b.data as { transactions: Transaction[] };
    d.transactions[0] = { ...d.transactions[0]!, notes: "edited" };
    const v = validateBackup(b);
    expect(v.ok).toBe(true);
    expect(v.problems.some((p) => p.message.includes("checksum does not match"))).toBe(true);
  });
});

describe("it refuses a file it cannot trust", () => {
  it("rejects something that is not a backup at all", () => {
    expect(validateBackup(null).ok).toBe(false);
    expect(validateBackup({ hello: "world" }).ok).toBe(false);
    expect(validateBackup([]).ok).toBe(false);
  });

  it("rejects a file from a newer app rather than reading part of it", () => {
    const v = validateBackup({ ...clone(), version: BACKUP_VERSION + 1 });
    expect(v.ok).toBe(false);
    expect(v.problems[0]?.message).toContain("Update the app");
  });

  it("catches a truncated download from the manifest", () => {
    const b = clone();
    const d = b.data as { transactions: Transaction[] };
    d.transactions = d.transactions.slice(0, 100);
    const v = validateBackup(b);
    expect(v.ok).toBe(false);
    expect(v.problems[0]?.message).toContain("incomplete");
  });

  it("catches a row where total is not amount plus fee", () => {
    const b = clone();
    const d = b.data as { transactions: Transaction[] };
    d.transactions[0] = { ...d.transactions[0]!, total: 999_999 };
    const v = validateBackup(b);
    expect(v.ok).toBe(false);
    expect(v.problems.some((p) => p.message.includes("add up"))).toBe(true);
  });

  it("catches money that is not whole centavos", () => {
    const b = clone();
    const d = b.data as { transactions: Transaction[] };
    d.transactions[0] = { ...d.transactions[0]!, amount: 10.5, fee: 0, total: 10.5 };
    const v = validateBackup(b);
    expect(v.ok).toBe(false);
    expect(v.problems.some((p) => p.message.includes("whole centavos"))).toBe(true);
  });
});

describe("older backups still restore", () => {
  const v1 = {
    format: "fms-backup",
    version: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    counts: { transactions: fixture.transactions.length, deleted: 0, accounts: 0, credits: 0 },
    transactions: fixture.transactions,
    deleted: [],
    budgets: fixture.budgets,
    settings: defaultSettings(),
  };

  it("reads a version 1 file", () => {
    const v = validateBackup(v1);
    expect(v.ok).toBe(true);
    expect(v.backup!.data.transactions).toHaveLength(440);
  });

  it("says what an old file cannot carry, instead of inventing it", () => {
    const v = validateBackup(v1);
    expect(v.problems.some((p) => p.message.includes("older backup"))).toBe(true);
    expect(v.backup!.data.preferences.theme).toBe("system");
    expect(v.backup!.data.migrations).toEqual({ debt: false, opening: false });
  });

  it("still catches a truncated version 1 file", () => {
    const v = validateBackup({ ...v1, transactions: fixture.transactions.slice(0, 5) });
    expect(v.ok).toBe(false);
  });
});

describe("merge", () => {
  const current: BackupData = { ...input, transactions: fixture.transactions.slice(0, 200) };

  it("adds only what is missing", () => {
    const r = restore(validateBackup(clone()).backup!, current, "merge");
    expect(r.kept).toBe(200);
    expect(r.added).toBe(240);
    expect(r.transactions).toHaveLength(440);
  });

  it("is idempotent, so restoring twice is not restoring twice", () => {
    const v = validateBackup(clone());
    const once = restore(v.backup!, current, "merge");
    const twice = restore(v.backup!, { ...current, transactions: once.transactions }, "merge");
    expect(twice.added).toBe(0);
    expect(twice.transactions).toHaveLength(440);
  });

  it("renumbers so the record column has no gaps or repeats", () => {
    const r = restore(validateBackup(clone()).backup!, current, "merge");
    expect(r.transactions.map((t) => t.recordNumber)).toEqual(
      r.transactions.map((_, i) => i + 1),
    );
  });

  it("keeps this device's theme rather than the file's", () => {
    const here: BackupData = { ...current, preferences: { theme: "light" } };
    expect(restore(validateBackup(clone()).backup!, here, "merge").preferences.theme).toBe("light");
  });

  it("treats a migration as run if either side has run it", () => {
    const here: BackupData = { ...current, migrations: { debt: false, opening: true } };
    const r = restore(validateBackup(clone()).backup!, here, "merge");
    expect(r.migrations).toEqual({ debt: true, opening: true });
  });

  it("does not duplicate the recycle bin either", () => {
    const r = restore(validateBackup(clone()).backup!, current, "merge");
    expect(r.deleted).toHaveLength(fixture.deleted.length);
  });
});

describe("replace", () => {
  it("reports what it threw away", () => {
    const r = restore(
      validateBackup(clone()).backup!,
      { ...input, transactions: fixture.transactions.slice(0, 10) },
      "replace",
    );
    expect(r.replaced).toBe(10);
    expect(r.added).toBe(440);
  });

  it("can be undone from a snapshot taken beforehand", () => {
    const before = createBackup(input, "2026-08-30T00:00:00.000Z");
    const wiped = restore(validateBackup(clone()).backup!, { ...input, transactions: [] }, "replace");
    const undone = restore(before, { ...input, transactions: wiped.transactions }, "replace");
    expect(undone.transactions).toEqual(fixture.transactions);
  });
});
