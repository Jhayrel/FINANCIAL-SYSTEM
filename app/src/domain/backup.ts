/**
 * Backup and restore.
 *
 * ── What "everything" means ───────────────────────────────────────────────
 *
 * A backup here is the whole system, not just the ledger. Restoring one into a
 * browser that has never seen this app must reproduce it exactly: the same
 * balances, the same accounts and goals, the same categories, the same budget,
 * the same credit lines, the same recycle bin, the same theme, and the same
 * record of which one-time migrations have already run.
 *
 * That last part is the one that is easy to miss and expensive to get wrong.
 * The debt migration and the opening-balance migration each rewrite historical
 * rows once. If a restore forgot that they had run, the next start would run
 * them again on rows that were already converted.
 *
 * The Excel's own backup was narrower than this: `BackupDatabaseToExcel` copies
 * DATABASE, BUDGETING and DELETED DATA, and leaves CATEGORIES behind. Restoring
 * one of those files gets the money back but not the wallet list, the bills,
 * the subscriptions or the spending types.
 *
 * ── Rules carried over from `Module8.bas` ─────────────────────────────────
 *
 *   1. VALIDATE BEFORE TOUCHING ANYTHING. Nothing is written until the file has
 *      been checked end to end. A restore that fails halfway is worse than one
 *      that refuses to start.
 *
 *   2. MERGE MUST NOT DUPLICATE. Identity is content, not id, then everything
 *      is renumbered. Restoring the same file twice leaves you where you were.
 *
 *   3. REPLACE IS REVERSIBLE. The caller takes a snapshot first and can hand it
 *      straight back to `restore` to undo.
 *
 * ── Forward compatibility ─────────────────────────────────────────────────
 *
 * Version 1 files still restore. A file from a NEWER app is refused rather than
 * read partially, because the one thing worse than not restoring is restoring
 * three quarters of someone's financial history and calling it done.
 */

import type { Account } from "./accounts";
import type { Debt } from "./debt";
import type { AppSettings, ThemePreference } from "./settings";
import { normaliseSettings, SETTINGS_VERSION } from "./settings";
import type { Budgets, DeletedTransaction, Transaction } from "./types";

/**
 * 1: transactions, deleted, budgets, settings.
 * 2: adds preferences, migration flags, a manifest and a checksum.
 */
export const BACKUP_VERSION = 2;

/** Per-device settings that live outside the settings document. */
export interface Preferences {
  /** `theme.ts` keeps its own copy so the page can paint before React starts. */
  readonly theme: ThemePreference;
}

/** One-time rewrites, recorded so a restore never runs them a second time. */
export interface Migrations {
  /** Borrowing reclassified out of Revenue. `domain/debtMigration.ts`. */
  readonly debt: boolean;
  /** Carry-forward rows reclassified out of Revenue. `domain/year.ts`. */
  readonly opening: boolean;
}

export interface BackupData {
  readonly transactions: readonly Transaction[];
  readonly deleted: readonly DeletedTransaction[];
  readonly budgets: Budgets;
  readonly settings: AppSettings;
  readonly preferences: Preferences;
  readonly migrations: Migrations;
  /**
   * The three append-only records, so nothing is left behind.
   *
   * ── What the file was missing ─────────────────────────────────────────
   *
   * The panel calls this "the whole system in one file" and it left out the
   * activity trail, the conversation and the assistant's own record. On this
   * database that is 604 documents against 451 transactions, so more rows
   * were being dropped from the backup than kept in it.
   *
   * They are exported and never restored, and that asymmetry is deliberate.
   * An audit trail says what happened; writing one back from a file would
   * make it say what a file claims happened, which is a different thing and
   * a worse one. `firestore.rules` refuses to update or delete them for the
   * same reason. So the export is complete and the restore stays honest.
   *
   * Optional, because a version 2 file written before this has none, and
   * refusing to read those would make the owner's own history unrestorable.
   */
  readonly logs?: {
    readonly activity: readonly unknown[];
    readonly chat: readonly unknown[];
    readonly ai: readonly unknown[];
  };
}

/** One line of the manifest, so a restore can say what it is about to do. */
export interface ManifestEntry {
  readonly part: string;
  readonly count: number;
}

export interface Backup {
  readonly format: "fms-backup";
  readonly version: number;
  readonly createdAt: string;
  readonly app: { readonly name: string; readonly settingsVersion: number };
  /** Corruption check over `data`. Not a signature: it proves nothing about who wrote it. */
  readonly checksum: string;
  readonly manifest: readonly ManifestEntry[];
  readonly data: BackupData;
}

export interface BackupInput extends BackupData {}

/**
 * A 32-bit FNV-1a hash of the canonical form of the data.
 *
 * Its job is catching a truncated download or a hand edit, and it does that.
 * It is not a signature and is not meant to be one: anyone who can change the
 * data can change the checksum. `crypto.subtle` would be no better at the
 * threat that matters here, and it is asynchronous, which would push async all
 * the way up into the settings screen for nothing.
 */
export function checksum(data: unknown): string {
  const text = canonical(data);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    // FNV prime, via shifts so it stays in 32-bit integer arithmetic.
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * Key-sorted JSON.
 *
 * `JSON.stringify` preserves insertion order, so two objects holding the same
 * values can serialise differently and hash differently. Sorting keys makes the
 * checksum depend on the data rather than on how it was built.
 */
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : 1));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}

function manifestOf(d: BackupData): ManifestEntry[] {
  return [
    { part: "Transactions", count: d.transactions.length },
    { part: "Recycle bin", count: d.deleted.length },
    { part: "Accounts and goals", count: d.settings.accounts.length },
    { part: "Credit and loans", count: d.settings.credits.length },
    { part: "Bills", count: d.settings.bills.length },
    { part: "Subscriptions", count: d.settings.subscriptions.length },
    { part: "Revenue categories", count: d.settings.revenueCategories.length },
    { part: "Spending types", count: d.settings.spendingTypes.length },
    { part: "Budget years", count: Object.keys(d.budgets).length },
    { part: "Activity trail", count: d.logs?.activity.length ?? 0 },
    { part: "Conversation", count: d.logs?.chat.length ?? 0 },
    { part: "What the assistant did", count: d.logs?.ai.length ?? 0 },
  ];
}

export function createBackup(input: BackupInput, now: string): Backup {
  const data: BackupData = {
    transactions: input.transactions,
    deleted: input.deleted,
    budgets: input.budgets,
    settings: input.settings,
    preferences: input.preferences,
    migrations: input.migrations,
    ...(input.logs ? { logs: input.logs } : {}),
  };

  return {
    format: "fms-backup",
    version: BACKUP_VERSION,
    createdAt: now,
    app: { name: "Financial Management System", settingsVersion: SETTINGS_VERSION },
    checksum: checksum(data),
    manifest: manifestOf(data),
    data,
  };
}

// ── Validation ─────────────────────────────────────────────────────────────

export interface Problem {
  readonly severity: "error" | "warning";
  readonly message: string;
}

export interface Validation {
  readonly ok: boolean;
  readonly problems: readonly Problem[];
  readonly backup?: Backup;
  readonly summary?: string;
  /** Shown before restoring, so the owner sees what is in the file. */
  readonly manifest?: readonly ManifestEntry[];
}

const DEFAULT_PREFERENCES: Preferences = { theme: "system" };
const DEFAULT_MIGRATIONS: Migrations = { debt: false, opening: false };

export function validateBackup(raw: unknown): Validation {
  const problems: Problem[] = [];
  const err = (message: string): void => void problems.push({ severity: "error", message });
  const warn = (message: string): void => void problems.push({ severity: "warning", message });

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      ok: false,
      problems: [{ severity: "error", message: "That file is not a backup. It does not contain an object." }],
    };
  }

  const b = raw as Record<string, unknown>;

  if (b.format !== "fms-backup") {
    err("That file was not written by this app. The format marker is missing.");
  }

  const version = typeof b.version === "number" ? b.version : null;
  if (version === null) {
    err("The file has no version, so there is no way to know how to read it.");
  } else if (version > BACKUP_VERSION) {
    err(
      `The file is version ${version} and this app reads up to ${BACKUP_VERSION}. Update the app before restoring, rather than restoring part of it.`,
    );
  }

  // Version 1 kept the parts at the top level. Version 2 moved them under
  // `data` so the checksum has one thing to cover.
  const src = (version === 1 ? b : (b.data as Record<string, unknown> | undefined)) ?? {};

  const transactions = src.transactions;
  if (!Array.isArray(transactions)) {
    err("No transactions in the file. This is the part that cannot be reconstructed.");
  }
  if (!Array.isArray(src.deleted)) warn("No recycle bin in the file. It will restore as empty.");
  if (!src.settings || typeof src.settings !== "object") {
    warn("No settings in the file. Accounts and categories will keep their current values.");
  }
  if (version === 1) {
    warn("This is an older backup. It has no theme or migration record, so those keep their current values.");
  }

  // A truncated download is the failure that actually happens, and it stays
  // valid JSON right up until the row count is short.
  const counts = b.counts as { transactions?: number } | undefined;
  const manifest = Array.isArray(b.manifest) ? (b.manifest as ManifestEntry[]) : undefined;
  const claimed =
    counts?.transactions ?? manifest?.find((m) => m.part === "Transactions")?.count;

  if (Array.isArray(transactions) && typeof claimed === "number" && transactions.length !== claimed) {
    err(
      `The file says it holds ${claimed} transactions but contains ${transactions.length}. It is incomplete.`,
    );
  }

  if (Array.isArray(transactions)) {
    const shaped = transactions.filter(isTransactionShaped);
    if (shaped.length !== transactions.length) {
      const bad = transactions.length - shaped.length;
      err(`${bad} transaction${bad === 1 ? " is" : "s are"} missing required fields.`);
    }

    const broken = shaped.filter((t) => t.total !== t.amount + t.fee);
    if (broken.length > 0) {
      err(
        `${broken.length} row${broken.length === 1 ? " does" : "s do"} not add up: total is not amount plus fee. Restoring would import wrong balances.`,
      );
    }

    const floats = shaped.filter((t) => ![t.amount, t.fee, t.total].every(Number.isInteger));
    if (floats.length > 0) {
      err(
        `${floats.length} row${floats.length === 1 ? " has" : "s have"} a fractional amount. Money is whole centavos.`,
      );
    }
  }

  if (problems.some((p) => p.severity === "error")) return { ok: false, problems };

  const data: BackupData = {
    transactions: transactions as Transaction[],
    deleted: Array.isArray(src.deleted) ? (src.deleted as DeletedTransaction[]) : [],
    budgets: (src.budgets ?? {}) as Budgets,
    settings: normaliseSettings(src.settings),
    preferences: readPreferences(src.preferences),
    migrations: readMigrations(src.migrations),
  };

  // Checked after the shape, so a corrupt file reports what is actually wrong
  // with it rather than only that the hash disagrees.
  if (version !== null && version >= 2 && typeof b.checksum === "string") {
    if (checksum(data) !== b.checksum) {
      warn(
        "The checksum does not match, so the file has been edited or partly corrupted since it was written. Everything in it still passed the shape checks.",
      );
    }
  }

  const backup: Backup = {
    format: "fms-backup",
    version: version ?? BACKUP_VERSION,
    createdAt: typeof b.createdAt === "string" ? b.createdAt : "",
    app: { name: "Financial Management System", settingsVersion: SETTINGS_VERSION },
    checksum: checksum(data),
    manifest: manifestOf(data),
    data,
  };

  return { ok: true, problems, backup, summary: describe(backup), manifest: backup.manifest };
}

function readPreferences(v: unknown): Preferences {
  if (!v || typeof v !== "object") return DEFAULT_PREFERENCES;
  const t = (v as Preferences).theme;
  return { theme: t === "light" || t === "dark" || t === "system" ? t : "system" };
}

function readMigrations(v: unknown): Migrations {
  if (!v || typeof v !== "object") return DEFAULT_MIGRATIONS;
  const m = v as Partial<Migrations>;
  return { debt: m.debt === true, opening: m.opening === true };
}

function isTransactionShaped(t: unknown): t is Transaction {
  if (!t || typeof t !== "object") return false;
  const r = t as Partial<Transaction>;
  return (
    typeof r.id === "string" &&
    typeof r.date === "string" &&
    typeof r.amount === "number" &&
    typeof r.fee === "number" &&
    typeof r.total === "number" &&
    typeof r.type === "string"
  );
}

function describe(b: Backup): string {
  const when = b.createdAt ? new Date(b.createdAt).toLocaleString() : "an unknown date";
  const rows = b.data.transactions;
  const span = dateSpan(rows);
  return `${rows.length.toLocaleString()} transactions${span}. Taken ${when}.`;
}

function dateSpan(rows: readonly Transaction[]): string {
  if (rows.length === 0) return "";
  let lo = rows[0]!.date;
  let hi = rows[0]!.date;
  for (const t of rows) {
    if (t.date < lo) lo = t.date;
    if (t.date > hi) hi = t.date;
  }
  return ` covering ${lo} to ${hi}`;
}

// ── Restoring ──────────────────────────────────────────────────────────────

export type RestoreMode = "replace" | "merge";

export interface RestoreResult extends BackupData {
  readonly added: number;
  readonly kept: number;
  readonly replaced: number;
}

export interface RestoreCurrent extends BackupData {}

/**
 * Apply a validated backup.
 *
 * `replace` swaps everything for what is in the file, including the theme and
 * the migration record: the point is to reproduce that system, not to keep half
 * of this one.
 *
 * `merge` keeps what you have and adds only rows that are not already there.
 * Identity is content, not id. A row exported, edited elsewhere and re-imported
 * still carries its old id, and the same purchase typed on two devices has two
 * different ids. Only content gives the right answer for both.
 */
export function restore(
  backup: Backup,
  current: RestoreCurrent,
  mode: RestoreMode,
): RestoreResult {
  const b = backup.data;

  if (mode === "replace") {
    return {
      transactions: b.transactions,
      deleted: b.deleted,
      budgets: b.budgets,
      settings: { ...b.settings, version: SETTINGS_VERSION },
      preferences: b.preferences,
      migrations: b.migrations,
      added: b.transactions.length,
      kept: 0,
      replaced: current.transactions.length,
    };
  }

  const seen = new Set(current.transactions.map(identity));
  const incoming = b.transactions.filter((t) => !seen.has(identity(t)));

  const merged = [...current.transactions, ...incoming].sort((a, b2) =>
    a.date === b2.date ? a.recordNumber - b2.recordNumber : a.date < b2.date ? -1 : 1,
  );

  return {
    // Renumbered so the record column stays sequential. This is
    // `RenumberDatabaseAfterMerge` in the VBA, and skipping it leaves gaps and
    // duplicates in the one column the owner reads by eye.
    transactions: merged.map((t, i) => ({ ...t, recordNumber: i + 1 })),
    deleted: mergeBin(current.deleted, b.deleted),
    budgets: { ...b.budgets, ...current.budgets },
    settings: mergeSettings(current.settings, b.settings),
    // A merge keeps this device's theme: it is a preference, not data.
    preferences: current.preferences,
    // Either side having run a migration means it has run.
    migrations: {
      debt: current.migrations.debt || b.migrations.debt,
      opening: current.migrations.opening || b.migrations.opening,
    },
    added: incoming.length,
    kept: current.transactions.length,
    replaced: 0,
  };
}

const identity = (t: Transaction): string =>
  [t.date, t.type, t.total, t.fromWallet, t.toWallet, t.item, t.description.trim()].join(" ");

function mergeBin(
  current: readonly DeletedTransaction[],
  incoming: readonly DeletedTransaction[],
): DeletedTransaction[] {
  const seen = new Set(current.map(identity));
  return [...current, ...incoming.filter((t) => !seen.has(identity(t)))];
}

/** Union of both lists, this device's scalar choices winning. */
function mergeSettings(current: AppSettings, incoming: AppSettings): AppSettings {
  const byName = <T extends { name: string }>(a: readonly T[], b: readonly T[]): T[] => {
    const out = [...a];
    const have = new Set(a.map((x) => x.name.toLowerCase()));
    for (const x of b) if (!have.has(x.name.toLowerCase())) out.push(x);
    return out;
  };

  const strings = (a: readonly string[], b: readonly string[]): string[] => {
    const out = [...a];
    const have = new Set(a.map((x) => x.toLowerCase()));
    for (const x of b) if (!have.has(x.toLowerCase())) out.push(x);
    return out;
  };

  return {
    ...current,
    accounts: byName<Account>([...current.accounts], [...incoming.accounts]),
    credits: byName<Debt>([...current.credits], [...incoming.credits]),
    bills: strings(current.bills, incoming.bills),
    subscriptions: strings(current.subscriptions, incoming.subscriptions),
    revenueCategories: strings(current.revenueCategories, incoming.revenueCategories),
    spendingTypes: byName([...current.spendingTypes], [...incoming.spendingTypes]),
  };
}
