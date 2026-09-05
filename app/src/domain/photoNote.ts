/**
 * What a photo said, written down, because the photo is not kept.
 *
 * ── Why this deserves a module ────────────────────────────────────────────
 *
 * A picture is never stored: a megabyte against a one megabyte document cap,
 * and the least useful byte in a financial database. So the description is
 * the only thing that survives a refresh, and it is the entire answer to
 * "which receipt was that, and what did it say".
 *
 * The first version was one line, capped at three entries:
 *
 *   Screenshot_20260905.jpg, a receipt: Spotify, PHP 85.00; Transfer,
 *   PHP 2,015.00; Transfer, PHP 2.23
 *
 * The owner asked for it to be really detailed, and they are right to. That
 * line says three of the eight rows, gives no dates, no wallets, no total,
 * and silently drops five. A month later it cannot answer whether a row came
 * off this receipt or a different one.
 *
 * ── What is written instead ───────────────────────────────────────────────
 *
 *   Screenshot_20260905_132223_Maya.jpg, 74 KB
 *   A receipt, read on 2026-09-05. 3 entries, PHP 2,102.23 in total.
 *     2026-09-04  Spending  Spotify  PHP 85.00  from Maya
 *     2026-09-02  Transfer  PHP 2,015.00  Maya to Cash
 *     2026-09-02  Transfer  PHP 2.23  into Gcash
 *
 * Every row, its date, its kind, its item, its figure and its wallets. Still
 * a few hundred bytes against a megabyte, and it answers the question without
 * the picture.
 */

import { formatMoney } from "./money";
import type { Draft } from "./entry";
import type { IsoDate } from "./types";

/** Longest a single file's description may run. */
export const MAX_NOTE = 800;

/** How many rows are written out in full before the rest are counted. */
const MOST_ROWS = 8;

const bytesIn = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/**
 * One entry, as a line under its file.
 *
 * The wallets are named the way the flow reads: money out comes `from` one,
 * money in goes `into` one, and a transfer names both ends because which end
 * it was is the whole question about a transfer.
 */
function rowLine(draft: Draft): string {
  const parts = [draft.date, draft.flow || "Entry"];

  if (draft.item.trim()) parts.push(draft.item.trim());
  parts.push(formatMoney(draft.amount ?? 0));

  const from = draft.fromWallet.trim();
  const to = draft.toWallet.trim();

  if (from && to) parts.push(`${from} to ${to}`);
  else if (from) parts.push(`from ${from}`);
  else if (to) parts.push(`into ${to}`);
  else if (draft.flow === "Transfer") parts.push("sent out of your accounts");

  if (draft.fee > 0) parts.push(`fee ${formatMoney(draft.fee)}`);

  return `  ${parts.join("  ")}`;
}

/**
 * A file and what came out of it, in the words that replace it.
 *
 * `kind` is what it turned out to be rather than what it was called: a photo
 * that produced entries is a receipt, and one that produced none is a photo,
 * whatever its extension says.
 */
export function describeFile(
  file: { readonly name: string; readonly bytes: number; readonly kind: "image" | "text" },
  found: readonly Draft[],
  asOf: IsoDate,
): string {
  const what = file.kind === "text" ? "file" : found.length > 0 ? "receipt" : "photo";
  const head = `${file.name}, ${bytesIn(file.bytes)}`;

  if (found.length === 0) {
    return [
      head,
      `A ${what}, read on ${asOf}. Nothing readable in it: no amount and no date were found.`,
    ].join("\n");
  }

  const total = found.reduce((sum, d) => sum + (d.amount ?? 0) + d.fee, 0);
  const shown = found.slice(0, MOST_ROWS);
  const rest = found.length - shown.length;

  const lines = [
    head,
    `A ${what}, read on ${asOf}. ${found.length} ${
      found.length === 1 ? "entry" : "entries"
    }, ${formatMoney(total)} in total.`,
    ...shown.map(rowLine),
    ...(rest > 0 ? [`  and ${rest} more`] : []),
  ];

  /**
   * Trimmed from the end, never from the middle.
   *
   * A description that stops early still reads correctly down to where it
   * stops. One with a hole in it looks complete and is not, which is worse
   * than being short.
   */
  const whole = lines.join("\n");
  if (whole.length <= MAX_NOTE) return whole;

  const kept: string[] = [];
  let length = 0;
  for (const line of lines) {
    if (length + line.length + 1 > MAX_NOTE - 20) break;
    kept.push(line);
    length += line.length + 1;
  }
  kept.push("  and the rest, cut");
  return kept.join("\n");
}

/** The same thing in one line, for the AI log, which shows a row per file. */
export function summariseFile(found: readonly Draft[]): string {
  if (found.length === 0) return "nothing readable";
  const total = found.reduce((sum, d) => sum + (d.amount ?? 0) + d.fee, 0);
  const named = found
    .slice(0, 3)
    .map((d) => `${d.item || d.flow || "entry"}, ${formatMoney(d.amount ?? 0)}`)
    .join("; ");
  const rest = found.length - Math.min(3, found.length);
  return `${found.length} entries, ${formatMoney(total)} total: ${named}${
    rest > 0 ? `; and ${rest} more` : ""
  }`;
}
