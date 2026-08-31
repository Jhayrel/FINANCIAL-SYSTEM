/**
 * What happened, when, and who did it.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * Two rows in the ledger look identical whether they were typed or read off a
 * receipt, and once the assistant can fill a form that stops being acceptable.
 * The question "where did this row come from" needs an answer that survives
 * the row being edited later, so the answer lives beside the ledger rather
 * than inside it.
 *
 * ── Append only, and why that is the whole point ──────────────────────────
 *
 * `firestore.rules` denies `update` and `delete` on this collection. Not by
 * convention, at the database: an event cannot be revised after the fact by
 * this app, by the console, or by anything holding the owner's credentials.
 * A log that can be edited is not a log, it is a note.
 *
 * That is also why the events are small and flat. Everything here is a string,
 * an integer, or absent, because a rule can check those and cannot check a
 * nested object of unknown depth.
 *
 * ── What `actor` does and does not prove ──────────────────────────────────
 *
 * It is written by this app, so it records rather than enforces. The thing
 * that actually stops the assistant writing is that it has no writer: it
 * returns JSON, and the only path into the ledger is the Add button. `actor`
 * is how you find out afterwards, not what makes it true.
 */

import type { Centavos } from "./money";
import type { Transaction } from "./types";

/** Who. `ai` means a row the assistant proposed and the owner approved. */
export type Actor = "owner" | "ai";

/** How it arrived. */
export type Via = "manual" | "ai_chat" | "ai_image" | "csv_import" | "migration" | "restore" | "system";

export type Action =
  | "transaction.create"
  | "transaction.update"
  | "transaction.bin"
  | "transaction.restore"
  | "settings.update"
  | "budget.update"
  | "backup.restore"
  | "ai.proposal.accepted"
  | "ai.proposal.discarded";

export interface ActivityEvent {
  readonly id: string;
  /** ISO 8601, UTC. Sorting key and the only clock this log has. */
  readonly at: string;
  readonly actor: Actor;
  readonly via: Via;
  readonly action: Action;
  /** One line a person can read, following the writing rules. */
  readonly summary: string;
  readonly targetId?: string;
  readonly recordNumber?: number;
  /** The model that proposed it, when `actor` is ai. */
  readonly model?: string;
  readonly amount?: Centavos;
  /** For an edit: the fields that changed, as one short line each. */
  readonly before?: string;
  readonly after?: string;
}

/** Where a write came from, carried down to whatever writes the event. */
export interface Provenance {
  readonly actor: Actor;
  readonly via: Via;
  readonly model?: string;
}

/** The default: someone typed it into the form. */
export const BY_OWNER: Provenance = { actor: "owner", via: "manual" };

let counter = 0;

/**
 * Ids are time plus a counter, not a random string.
 *
 * Two rows added from one screenshot happen in the same millisecond, and an
 * id collision in an append-only collection is a lost event rather than an
 * error anyone would see.
 */
function eventId(at: string): string {
  counter += 1;
  return `${at.replace(/[^0-9]/g, "")}-${counter.toString(36)}`;
}

const money = (centavos: Centavos): string =>
  `PHP ${(centavos / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const nameOf = (t: Transaction): string => t.item.trim() || t.description.trim() || t.type;

const numbered = (t: Transaction): string => `#${String(t.recordNumber).padStart(4, "0")}`;

/**
 * A row's fields as one short line.
 *
 * Kept to the fields that change meaning. A rule caps `before` and `after` at
 * 600 characters, and a truncated audit line is worse than a brief one.
 */
export function describeRow(t: Transaction): string {
  const parts = [
    t.date,
    t.type,
    t.fromWallet || "-",
    t.toWallet || "-",
    t.item || "-",
    money(t.amount),
  ];
  if (t.fee > 0) parts.push(`fee ${money(t.fee)}`);
  if (t.status) parts.push(t.status);
  return parts.join(" | ").slice(0, 600);
}

/** Which fields differ, for the summary line of an edit. */
export function changedFields(before: Transaction, after: Transaction): string[] {
  const keys = [
    "date",
    "type",
    "fromWallet",
    "toWallet",
    "category",
    "item",
    "description",
    "amount",
    "fee",
    "notes",
    "status",
  ] as const;
  return keys.filter((k) => before[k] !== after[k]);
}

function build(
  action: Action,
  by: Provenance,
  summary: string,
  extra: Partial<ActivityEvent> = {},
): ActivityEvent {
  const at = new Date().toISOString();
  return {
    id: eventId(at),
    at,
    actor: by.actor,
    via: by.via,
    action,
    /**
     * Capped here rather than at each call site.
     *
     * `validActivity()` caps `summary` at 300 characters, and a document the
     * rule refuses is not an error the owner would ever see: the ledger write
     * succeeds, the audit write fails, and the trail quietly has a hole in it.
     * The one place every event is built is the one place to be sure.
     */
    summary: summary.slice(0, 300),
    ...(by.model ? { model: by.model } : {}),
    ...extra,
  };
}

export function created(row: Transaction, by: Provenance = BY_OWNER): ActivityEvent {
  return build(
    "transaction.create",
    by,
    `Added ${numbered(row)}, ${nameOf(row)}, ${money(row.total)}${by.actor === "ai" ? ", read by the assistant" : ""}.`,
    { targetId: row.id, recordNumber: row.recordNumber, amount: row.total, after: describeRow(row) },
  );
}

export function updated(
  before: Transaction,
  after: Transaction,
  by: Provenance = BY_OWNER,
): ActivityEvent {
  const changed = changedFields(before, after);
  return build(
    "transaction.update",
    by,
    changed.length > 0
      ? `Changed ${numbered(after)}: ${changed.join(", ")}.`
      : `Saved ${numbered(after)} with no change.`,
    {
      targetId: after.id,
      recordNumber: after.recordNumber,
      amount: after.total,
      before: describeRow(before),
      after: describeRow(after),
    },
  );
}

export function binned(row: Transaction, by: Provenance = BY_OWNER): ActivityEvent {
  return build("transaction.bin", by, `Moved ${numbered(row)}, ${nameOf(row)}, to the bin.`, {
    targetId: row.id,
    recordNumber: row.recordNumber,
    amount: row.total,
    before: describeRow(row),
  });
}

export function restored(row: Transaction, by: Provenance = BY_OWNER): ActivityEvent {
  return build("transaction.restore", by, `Restored ${numbered(row)}, ${nameOf(row)}.`, {
    targetId: row.id,
    recordNumber: row.recordNumber,
    amount: row.total,
    after: describeRow(row),
  });
}

export function settingsChanged(what: string, by: Provenance = BY_OWNER): ActivityEvent {
  return build("settings.update", by, what);
}

export function proposalDiscarded(what: string, model?: string): ActivityEvent {
  return build(
    "ai.proposal.discarded",
    { actor: "ai", via: "ai_chat", ...(model ? { model } : {}) },
    `Discarded a suggested entry: ${what}.`,
  );
}

/** Newest first, which is the only order this is ever read in. */
export const byNewest = (a: ActivityEvent, b: ActivityEvent): number =>
  a.at < b.at ? 1 : a.at > b.at ? -1 : b.id.localeCompare(a.id);
