/**
 * Everything one activity event says, and the trail as a whole, for the
 * screen's "More details" and the PDF.
 *
 * The owner, 26 October 2026, on the Activity screen: "Add more details also
 * i can export it as pdf with all details also make the ui cleaner in pdf".
 * The row showed a summary, a time and who; the event also holds the entry it
 * was about, field by field, how it came in and which model read it. Both the
 * screen and the PDF read them from here, so they never say different things.
 */
import type { ActivityEvent, Via } from "./activity";
import { factChanges, readRow, type FactChange } from "./activityRead";
import { MONTH_NAMES, WEEKDAY_NAMES } from "./dates";
import { formatMoney } from "./money";

export interface EventDetail {
  readonly label: string;
  readonly value: string;
}

/** How a change arrived, in words. */
export const VIA_WORDS: Readonly<Record<Via, string>> = {
  manual: "Typed on a screen",
  ai_chat: "From the chat",
  ai_image: "Read from a picture",
  csv_import: "Imported from a file",
  migration: "Moved over from the Excel",
  restore: "Restored from a backup",
  system: "Done by the app itself",
};

/** What kind of change, as the filters name it. */
export function kindOf(action: string): string {
  if (action === "transaction.create") return "Added";
  if (action === "transaction.update") return "Edited";
  if (action === "transaction.bin") return "Moved to the bin";
  if (action === "transaction.restore") return "Restored";
  if (action === "budget.update") return "Budget";
  if (action.startsWith("settings.")) return "Settings";
  if (action === "backup.restore") return "Backup restored";
  if (action.startsWith("plan.")) return "Planner";
  if (action === "ai.proposal.accepted") return "Card accepted";
  if (action === "ai.proposal.discarded") return "Card discarded";
  return "Change";
}

const pad = (n: number): string => String(n).padStart(2, "0");

/** "October 26, 2026, 10:44:07 AM", on this device's clock. */
export function whenInFull(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return at;
  const h = d.getHours();
  return `${MONTH_NAMES[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}, ${h % 12 === 0 ? 12 : h % 12}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${h < 12 ? "AM" : "PM"}`;
}

/** "10:44 AM". */
export function timeOfDay(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  const h = d.getHours();
  return `${h % 12 === 0 ? 12 : h % 12}:${pad(d.getMinutes())} ${h < 12 ? "AM" : "PM"}`;
}

/** The day an event happened, on this device, as YYYY-MM-DD. */
export function eventDay(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "Monday, October 26, 2026". */
export function dayInFull(day: string): string {
  const d = new Date(`${day}T00:00:00`);
  if (Number.isNaN(d.getTime())) return day;
  return `${WEEKDAY_NAMES[d.getDay()] ?? ""}, ${MONTH_NAMES[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

const dateWords = (iso: string): string =>
  iso
    .split(" to ")
    .map((part) => {
      const d = new Date(`${part.trim()}T00:00:00`);
      return Number.isNaN(d.getTime()) ? part.trim() : `${MONTH_NAMES[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
    })
    .join(" to ");

/**
 * Every detail the event holds, in reading order: when, who and how, then the
 * entry it was about, field by field. A blank field is left out rather than
 * shown as a dash. An edit's before and after are `changesOf`, apart.
 */
export function eventDetails(e: ActivityEvent): EventDetail[] {
  const out: EventDetail[] = [
    { label: "When", value: whenInFull(e.at) },
    { label: "Who", value: e.actor === "ai" ? "The assistant" : "You" },
    { label: "How", value: VIA_WORDS[e.via] ?? e.via },
    { label: "Kind", value: kindOf(e.action) },
  ];
  if (e.model) out.push({ label: "Model", value: e.model });
  if (e.recordNumber !== undefined) out.push({ label: "Entry", value: `#${String(e.recordNumber).padStart(4, "0")}` });
  // The entry as it is now, or as it was when it was binned.
  const facts = readRow(e.after ?? e.before);
  if (facts) {
    if (facts.date) out.push({ label: "For", value: dateWords(facts.date) });
    if (facts.type) out.push({ label: "Type", value: facts.type });
    if (facts.item) out.push({ label: "Item", value: facts.item });
    if (facts.from) out.push({ label: "From", value: facts.from });
    if (facts.to) out.push({ label: "To", value: facts.to });
    if (facts.amount) out.push({ label: "Amount", value: facts.amount.replace(/^PHP\s*/, "₱") });
    if (facts.fee) out.push({ label: "Fee", value: facts.fee.replace(/^PHP\s*/, "₱") });
    if (facts.status) out.push({ label: "Status", value: facts.status });
  } else if (e.amount !== undefined) {
    out.push({ label: "Amount", value: formatMoney(e.amount) });
  }
  // A budget or setting keeps its before and after as plain lines.
  if (!facts && e.action !== "transaction.update") {
    if (e.before) out.push({ label: "Before", value: e.before });
    if (e.after) out.push({ label: "After", value: e.after });
  }
  return out;
}

/** An edit, field by field. */
export function changesOf(e: ActivityEvent): FactChange[] {
  return e.action === "transaction.update" ? factChanges(e.before, e.after) : [];
}

export interface TrailSummary {
  readonly total: number;
  readonly added: number;
  readonly edited: number;
  readonly binnedOrRestored: number;
  readonly budgetOrSettings: number;
  readonly byAssistant: number;
  /** The first and last day in it, oldest first. */
  readonly from: string;
  readonly to: string;
}

export function trailSummary(events: readonly ActivityEvent[]): TrailSummary {
  const count = (test: (e: ActivityEvent) => boolean): number => events.filter(test).length;
  const days = events.map((e) => eventDay(e.at)).filter(Boolean).sort();
  return {
    total: events.length,
    added: count((e) => e.action === "transaction.create"),
    edited: count((e) => e.action === "transaction.update"),
    binnedOrRestored: count((e) => e.action === "transaction.bin" || e.action === "transaction.restore"),
    budgetOrSettings: count((e) => e.action === "budget.update" || e.action.startsWith("settings.")),
    byAssistant: count((e) => e.actor === "ai"),
    from: days[0] ?? "",
    to: days[days.length - 1] ?? "",
  };
}

/** Newest first, in runs of one day. */
export function byDay(events: readonly ActivityEvent[]): { readonly day: string; readonly events: readonly ActivityEvent[] }[] {
  const groups: { day: string; events: ActivityEvent[] }[] = [];
  for (const e of events) {
    const day = eventDay(e.at);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.events.push(e);
    else groups.push({ day, events: [e] });
  }
  return groups;
}

/** "activity-2026-10-20-to-2026-10-26.pdf". */
export function trailFilename(s: TrailSummary): string {
  return s.from && s.to ? `activity-${s.from}${s.to !== s.from ? `-to-${s.to}` : ""}.pdf` : "activity.pdf";
}
