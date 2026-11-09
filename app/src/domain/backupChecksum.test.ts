/**
 * The checksum is checked over the file as written (owner, 9 November 2026:
 * a backup the app had just written was called "edited or partly corrupted").
 * Invented rows, so it runs on a fresh clone without the workbook.
 */
import { describe, expect, it } from "vitest";

import { checksum, createBackup, validateBackup, type BackupData } from "./backup";
import { defaultSettings } from "./settings";
import type { Transaction } from "./types";

const row = (n: number, amount: number): Transaction =>
  ({ id: `t${n}`, recordNumber: n, date: "2026-11-0" + ((n % 9) + 1), type: "Spending", fromWallet: "Cash", toWallet: "", category: "Spending", item: "Food", description: "lunch", amount, fee: 0, total: amount, notes: "", status: "Paid" }) as Transaction;

const input: BackupData = {
  transactions: [row(1, 12_500), row(2, 30_000), row(3, 4_999)],
  deleted: [],
  budgets: {},
  settings: defaultSettings(),
  preferences: { theme: "system" },
  migrations: { debt: true, opening: true },
  logs: { activity: [], chat: [], ai: [] },
};

const said = (raw: unknown): boolean => validateBackup(raw).problems.some((p) => p.message.includes("checksum does not match"));
const asFile = (b: unknown): Record<string, unknown> => JSON.parse(JSON.stringify(b));

describe("the checksum, read back", () => {
  it("a file just written, with its logs, passes", () => {
    expect(said(asFile(createBackup(input, "2026-11-09T00:29:08.102Z")))).toBe(false);
  });

  it("a file written before a setting existed passes: the reader's defaults are not the file", () => {
    const { allocations: _gone, ...older } = defaultSettings();
    const file = asFile(createBackup({ ...input, settings: older as ReturnType<typeof defaultSettings> }, "2026-11-09T00:29:08.102Z"));
    expect((file.data as { settings: Record<string, unknown> }).settings.allocations).toBeUndefined();
    expect(said(file)).toBe(false);
  });

  it("is the hash of the file's data, logs included", () => {
    const file = asFile(createBackup(input, "2026-11-09T00:29:08.102Z"));
    expect(checksum(file.data)).toBe(file.checksum);
  });

  it("still notices a hand edit", () => {
    const file = asFile(createBackup(input, "2026-11-09T00:29:08.102Z"));
    const rows = (file.data as { transactions: Transaction[] }).transactions;
    rows[0] = { ...rows[0]!, notes: "edited" };
    expect(said(file)).toBe(true);
  });

  it("still notices a centavo changed", () => {
    const file = asFile(createBackup(input, "2026-11-09T00:29:08.102Z"));
    const t = (file.data as { transactions: Transaction[] }).transactions[1]!;
    (file.data as { transactions: Transaction[] }).transactions[1] = { ...t, amount: t.amount + 1, total: t.total + 1 };
    expect(said(file)).toBe(true);
  });
});
