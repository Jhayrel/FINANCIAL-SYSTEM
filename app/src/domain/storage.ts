/**
 * Storage accounting.
 *
 * How much room the ledger takes, and what is taking it. Measured, not
 * estimated: each section is serialised the way it is actually stored and its
 * UTF-8 length taken, so the numbers move when the data does.
 *
 * Why bother, for a few hundred rows? Because the two places this can live
 * both have a ceiling, and both fail badly at it. `localStorage` is about 5 MB
 * and throws once full, which would silently stop settings from saving.
 * Firestore's free tier is 1 GiB. Neither warns you. This does.
 */

export interface StorageSection {
  readonly id: string;
  readonly label: string;
  /** A `--cat-N` token, so the bar and the list agree without hardcoding hex. */
  readonly colour: string;
  readonly bytes: number;
  /** How many things are in it, for the row's secondary line. */
  readonly count: number;
}

export interface StorageReport {
  readonly sections: readonly StorageSection[];
  readonly used: number;
  readonly quota: number;
  /** 0 to 1. Clamped, so a blown quota reports 1 rather than 1.4. */
  readonly fraction: number;
  readonly free: number;
  /** True once it is worth saying something about. */
  readonly nearlyFull: boolean;
}

/** Bytes a value occupies once serialised as JSON, UTF-8. */
export function byteSize(value: unknown): number {
  if (value === undefined) return 0;
  const json = JSON.stringify(value);
  if (json === undefined) return 0;
  // TextEncoder is the honest measure: a peso sign is 3 bytes, not 1, and
  // `.length` would undercount every description with one in it.
  return new TextEncoder().encode(json).length;
}

/** Human-readable size. Binary units, matching what a phone's storage screen shows. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let n = bytes / 1024;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  // One decimal below 100, none above: 4.38 GB reads better than 4 GB, and
  // 823 MB reads better than 823.4 MB.
  return `${n < 100 ? n.toFixed(n < 10 ? 2 : 1) : Math.round(n)} ${units[i]}`;
}

/** localStorage in practice, once the browser's own overhead is allowed for. */
export const BROWSER_QUOTA = 5 * 1024 * 1024;
/** Firestore's free tier. */
export const FIRESTORE_QUOTA = 1024 * 1024 * 1024;

export interface StorageInput {
  readonly transactions: readonly unknown[];
  readonly deleted: readonly unknown[];
  readonly accounts: readonly unknown[];
  readonly credits: readonly unknown[];
  readonly budgets: Readonly<Record<string, unknown>>;
  /** Everything in settings that is not accounts or credits. */
  readonly categories: readonly unknown[];
  readonly quota: number;
}

/**
 * Measure the ledger.
 *
 * Sections come back largest first, so the bar and the list read the same way
 * and the thing worth acting on is at the top.
 */
export function measureStorage(input: StorageInput): StorageReport {
  const raw: StorageSection[] = [
    section("transactions", "Transactions", "var(--cat-2)", input.transactions),
    section("deleted", "Recycle bin", "var(--cat-11)", input.deleted),
    section("accounts", "Accounts and goals", "var(--cat-4)", input.accounts),
    section("categories", "Categories", "var(--cat-6)", input.categories),
    section("credits", "Credit and loans", "var(--cat-9)", input.credits),
    section("budgets", "Budgets", "var(--cat-3)", Object.values(input.budgets)),
  ];

  const sections = raw.sort((a, b) => b.bytes - a.bytes);
  const used = sections.reduce((a, s) => a + s.bytes, 0);
  const quota = Math.max(1, input.quota);

  return {
    sections,
    used,
    quota,
    fraction: Math.min(1, used / quota),
    free: Math.max(0, quota - used),
    // A ledger this size will not get near it, so anything over 80% means
    // something is wrong rather than merely full.
    nearlyFull: used / quota > 0.8,
  };
}

function section(
  id: string,
  label: string,
  colour: string,
  items: readonly unknown[],
): StorageSection {
  return { id, label, colour, bytes: byteSize(items), count: items.length };
}

/**
 * What one more year would cost, from what a year already costs.
 *
 * Returns null when there is not enough history to say. A projection from two
 * weeks of data would be a guess dressed up as a number.
 */
export function projectAnnualGrowth(
  bytesPerRow: number,
  rowsSoFar: number,
  daysSoFar: number,
): number | null {
  if (daysSoFar < 60 || rowsSoFar < 30) return null;
  return Math.round((rowsSoFar / daysSoFar) * 365 * bytesPerRow);
}

/** Bytes per transaction, for the projection and for the row's caption. */
export function averageRowSize(totalBytes: number, count: number): number {
  return count === 0 ? 0 : Math.round(totalBytes / count);
}
