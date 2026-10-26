/**
 * "What did I change today?", "what did the AI add this week?", "show my
 * activity": the activity trail, read out in the chat.
 *
 * The owner, 26 October 2026: "make sure ai can do it all like everything".
 * Activity was a screen the chat could not see, so the questions it answers
 * went to the month's headline. Read from the same trail the screen shows,
 * newest first, and never more than a screenful.
 */
import { addDays, dayInWords, dayOfWeek } from "./dates";
import type { Action, ActivityEvent } from "./activity";
import type { IsoDate } from "./types";

export interface ActivityAsk {
  readonly from: IsoDate;
  readonly to: IsoDate;
  /** In words: "today", "this week". */
  readonly span: string;
  readonly by: "ai" | "owner" | null;
  readonly action: "add" | "edit" | "bin" | "restore" | "budget" | "settings" | null;
}

const ASKS =
  /\b(?:what|which|show|list|any)\b[^?.!]{0,40}\b(?:did|have|has)\s+(?:i|you|the ai|the assistant|it)\b[^?.!]{0,30}\b(?:change[ds]?|add(?:ed)?|edit(?:ed)?|delet(?:ed|e)?|bin(?:ned)?|restor(?:ed|e)?|enter(?:ed)?)\b|\b(?:my|the|recent|latest|today'?s)\s+(?:activity|changes|edits|trail)\b|\bactivity\s+(?:trail|log|today|this week|yesterday)\b|\bwhat\s+changed\b|\bwho\s+(?:added|changed|edited|deleted|entered)\b/i;

export function readActivityAsk(text: string, asOf: IsoDate): ActivityAsk | null {
  const t = text.trim();
  if (!ASKS.test(t) || t.split(/\s+/).length > 18) return null;
  // About money, not about what was entered: "what did I spend", "what did I buy".
  if (/\b(?:spend|spent|buy|bought|pay|paid|earn|earned|receive|received|borrow\w*|owe|how much|expenses?|cost)\b/i.test(t)) return null;
  // A screen, a chart or a budget asked about is someone else's question.
  if (/\b(?:chart|graph|pie|trend|draw)\b/i.test(t)) return null;
  const monday = addDays(asOf, -((dayOfWeek(asOf) + 6) % 7));
  const span: Pick<ActivityAsk, "from" | "to" | "span"> = /\byesterday\b/i.test(t)
    ? { from: addDays(asOf, -1), to: addDays(asOf, -1), span: "yesterday" }
    : /\blast\s+week\b/i.test(t)
      ? { from: addDays(monday, -7), to: addDays(monday, -1), span: "last week" }
      : /\b(?:this|past)\s+week\b|\blast\s+7\s+days\b/i.test(t)
        ? { from: /\bpast\b|7 days/i.test(t) ? addDays(asOf, -6) : monday, to: asOf, span: /\bpast\b|7 days/i.test(t) ? "in the last seven days" : "this week" }
        : /\bthis\s+month\b/i.test(t)
          ? { from: `${asOf.slice(0, 7)}-01`, to: asOf, span: "this month" }
          : /\btoday\b/i.test(t)
            ? { from: asOf, to: asOf, span: "today" }
            : { from: addDays(asOf, -6), to: asOf, span: "in the last seven days" };
  const by = /\b(?:the\s+)?(?:ai|assistant|chat|you)\b/i.test(t.replace(/\bdid\s+you\s+(?:see|know)\b/i, "")) ? "ai" : /\b(?:i|me|myself)\b/i.test(t) && !/\b(?:ai|assistant)\b/i.test(t) ? "owner" : null;
  const action = /\b(?:delet\w*|bin\w*|remov\w*)\b/i.test(t)
    ? "bin"
    : /\brestor\w*\b/i.test(t)
      ? "restore"
      : /\b(?:edit\w*|correct\w*|fix\w*|modif\w*)\b/i.test(t)
        ? "edit"
        : /\b(?:add\w*|enter\w*|record\w*|log(?:ged)?)\b/i.test(t)
          ? "add"
          : /\bbudget\w*\b/i.test(t)
            ? "budget"
            : /\bsettings?\b/i.test(t)
              ? "settings"
              : null;
  return { ...span, by, action };
}

const ACTIONS: Readonly<Record<NonNullable<ActivityAsk["action"]>, readonly Action[]>> = {
  add: ["transaction.create"],
  edit: ["transaction.update"],
  bin: ["transaction.bin"],
  restore: ["transaction.restore"],
  budget: ["budget.update"],
  settings: ["settings.update"],
};

const VERB: Readonly<Record<NonNullable<ActivityAsk["action"]>, string>> = {
  add: "added",
  edit: "edited",
  bin: "moved to the bin",
  restore: "restored",
  budget: "changed in the budget",
  settings: "changed in Settings",
};

const pad = (n: number): string => String(n).padStart(2, "0");
/** The day and time of an event on this device's clock, the one "today" is read from. */
const local = (at: string): { readonly day: IsoDate; readonly time: string } => {
  const d = new Date(at);
  return { day: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
};
const dayOf = (at: string): IsoDate => local(at).day;

/** The trail over the span, by whom and of what kind when said, newest first and at most twelve lines. */
export function activityAnswer(ask: ActivityAsk, events: readonly ActivityEvent[], loaded: boolean): string {
  if (!loaded) return "The activity trail could not be read just now. Open Activity to see every change, or ask again in a moment.";
  const wanted = events
    .filter((e) => e.action !== "ai.proposal.accepted" && e.action !== "ai.proposal.discarded")
    .filter((e) => {
      const d = dayOf(e.at);
      return d >= ask.from && d <= ask.to;
    })
    .filter((e) => (ask.by ? e.actor === ask.by : true))
    .filter((e) => (ask.action ? ACTIONS[ask.action].includes(e.action) : true));
  const who = ask.by === "ai" ? "the assistant" : ask.by === "owner" ? "you" : "";
  const what = ask.action ? VERB[ask.action] : "changed";
  if (wanted.length === 0) {
    return `Nothing was ${what}${who ? ` by ${who}` : ""} ${ask.span}. Activity shows everything further back.`;
  }
  const counts = new Map<string, number>();
  for (const e of wanted) counts.set(e.action, (counts.get(e.action) ?? 0) + 1);
  const part = (a: Action, word: string): string | null => {
    const n = counts.get(a) ?? 0;
    return n > 0 ? `${n} ${word}` : null;
  };
  const tally = [
    part("transaction.create", "added"),
    part("transaction.update", "edited"),
    part("transaction.bin", "binned"),
    part("transaction.restore", "restored"),
    part("budget.update", "budget changes"),
    part("settings.update", "settings changes"),
    part("backup.restore", "backups restored"),
  ].filter(Boolean);
  const shown = wanted.slice(0, 12).map((e) => {
    const d = dayOf(e.at);
    const when = ask.from === ask.to ? local(e.at).time : dayInWords(d).replace(/^\w+, /, "");
    const by = ask.by ? "" : e.actor === "ai" ? " (assistant)" : "";
    return `- ${when}: ${e.summary}${by}`;
  });
  return [
    `**${wanted.length} ${wanted.length === 1 ? "change" : "changes"} ${ask.span}${who ? ` by ${who}` : ""}**${tally.length > 1 ? `: ${tally.join(", ")}` : ""}.`,
    ...shown,
    wanted.length > 12 ? `And ${wanted.length - 12} more: Activity has every one.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** "Undo", "undo that", "undo the last change", "revert what you did": the last thing done from this chat. */
export function asksUndoLast(text: string): boolean {
  return /^\s*(?:(?:please|pls|ok(?:ay)?|sige|can you|could you)[\s,]+)*(?:undo|revert|reverse|cancel|take back|ibalik)(?:\s+(?:it|that|this|the last(?: one| change| thing| entry| edit)?|what (?:you|i) (?:just )?(?:did|added|changed|deleted|made)|my last(?: change| entry| edit)?|the change|the last thing (?:you|i) did|that change|that entry))?(?:\s+(?:please|pls|now|po))*\s*[.!?]*\s*$/i.test(
    text,
  );
}
