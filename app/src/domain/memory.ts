/**
 * What was said before this conversation, for the assistant to remember.
 *
 * The owner, 28 September 2026: "it can read sessions and chats ... like it
 * knows whats your conversation". The model was sent the last ten things said
 * on screen and nothing else, so after "Clear this view", or the next day, it
 * had forgotten everything: a purchase explained yesterday, a rule stated
 * once ("based on balance, not budget"), the budget they said they expect.
 *
 * So the saved conversation, older than what is on screen, goes with each
 * question as its own section: the newest of it, dated, short. Developer
 * notes ("//fix this") and the app's own bookkeeping lines are left out,
 * because they are not what was said between the two of them.
 */

import type { ChatMessage } from "./chat";
import { goesByBalance } from "./affordAsk";
import { expectedIncomeIn, savingsGoalIn } from "./budgetAdvice";
import { formatMoney } from "./money";

/** Lines the app writes about itself, which say nothing the ledger does not. */
const BOOKKEEPING =
  /^(?:New entry:|Discarded:|File offered:|File saved:|Noted, and kept|Dropped it\.|What was it for\?|How much was it\?|Still (?:reading|checking|waiting)|That was the last question|\d+ cards? need an answer|One entry\. Check it|\d+ entries\. Check each)/i;

/**
 * The saved messages before the ones on screen, newest last, as lines:
 * "2026-09-27 you: ..." Empty when there are none.
 *
 * `onScreen` is the text of what the model is already sent as this
 * conversation, so nothing is said twice.
 */
export function earlierSessions(
  all: readonly ChatMessage[],
  onScreen: readonly string[],
  most = 30,
  room = 3_500,
): string {
  const shown = new Set(onScreen.map((t) => t.trim()));
  const said = [...all]
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
    .filter((m) => m.text.trim() !== "" && !m.text.trim().startsWith("//") && !BOOKKEEPING.test(m.text.trim()));
  // What is on screen is the newest part of the saved thread: stop where it begins.
  let end = said.length;
  while (end > 0 && shown.has((said[end - 1]?.text ?? "").trim())) end -= 1;
  const lines: string[] = [];
  let used = 0;
  for (let i = end - 1; i >= 0 && lines.length < most; i -= 1) {
    const m = said[i];
    if (!m) continue;
    const text = m.text.replace(/\s+/g, " ").trim();
    const line = `${m.at.slice(0, 10)} ${m.role === "you" ? "you" : "assistant"}: ${text.length > 220 ? `${text.slice(0, 220)}...` : text}`;
    if (used + line.length > room) break;
    used += line.length + 1;
    lines.unshift(line);
  }
  return lines.join("\n");
}

/** One turn of the conversation, as the model is sent it. */
export interface Spoken {
  readonly role: "you" | "assistant";
  readonly text: string;
}

/**
 * The conversation for the model: the newest turns whole, older ones short.
 *
 * Every turn was cut to 500 characters. A recommendation with its split runs
 * to two thousand, so "tell me the separation of that budget" was sent a
 * quarter of the answer it asked about, and "I am asking about the first you
 * said" none of it (28 September 2026). What was just said is what a
 * follow-up is about, so the last few turns go whole.
 */
export function chatHistory(said: readonly Spoken[], most = 12, whole = 4, long = 2_400, short = 400): Spoken[] {
  const recent = said.filter((t) => t.text.trim() !== "").slice(-most);
  return recent.map((t, i) => {
    const limit = i >= recent.length - whole ? long : short;
    return { role: t.role, text: t.text.length > limit ? `${t.text.slice(0, limit)}...` : t.text };
  });
}

/** The newest lines of a block that fit, oldest dropped first, and said so. */
export function keepNewest(text: string, max: number): string {
  if (text.length <= max) return text;
  const lines = text.split("\n");
  const kept: string[] = [];
  let used = 0;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i] ?? "";
    if (used + line.length + 1 > max - 40) {
      if (kept.length === 0) kept.unshift(line.slice(-(max - 40)));
      break;
    }
    kept.unshift(line);
    used += line.length + 1;
  }
  return ["(Older lines left out.)", ...kept].join("\n");
}

/**
 * Earlier sessions and this conversation, as one block the server never trims
 * with the figures (`functions/api/ai.ts`, `fitConversation`).
 *
 * It used to be appended to the figures, below the entries, and a free model
 * that refused the size got the figures cut from the end: the conversation
 * went first, every time, which is why the assistant "forgot" what it had
 * just said. This conversation is kept before earlier sessions when room is
 * short, and within each the newest lines are kept.
 */
export function conversationBlock(earlier: string, history: readonly Spoken[], max = 14_000, pinned = ""): string {
  const HEADER = "Earlier in this conversation:";
  const keep = pinned.trim() ? pinned.trim().slice(0, PINNED_ROOM) : "";
  const left = max - keep.length - 2;
  const lines = history.map((h) => `${h.role}: ${h.text}`).join("\n");
  const now = lines ? `${HEADER}\n${keepNewest(lines, left - HEADER.length - 1)}` : "";
  const room = left - now.length - 2;
  const before = earlier.trim() && room > 300 ? `Earlier sessions, oldest first:\n${keepNewest(earlier.trim(), room - 40)}` : "";
  return [keep, before, now].filter(Boolean).join("\n\n");
}

/** The most the pinned block may take: it goes with every question, whole. */
export const PINNED_ROOM = 2_600;

const short = (text: string, most: number): string => {
  const flat = text.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
  return flat.length > most ? `${flat.slice(0, most - 3)}...` : flat;
};
const firstSentence = (text: string): string => {
  const flat = text.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
  const end = flat.search(/(?<=[.!?])\s/);
  return end > 0 ? flat.slice(0, end) : flat;
};
const money = (c: number): string => formatMoney(c).replace(/^₱/, "PHP ");

/**
 * What the model is never allowed to forget, pinned above the conversation.
 *
 * ── Why a pinned block ────────────────────────────────────────────────────
 *
 * The owner, 28 September 2026: "make an algorithm so the ai wont forget".
 * The conversation is long and gets shortened; what matters in it is small.
 * So two things are worked out here, on the device, every time, and sent
 * whole with every question, above the conversation, where no trimming
 * reaches (`functions/api/ai.ts`, `fitConversation`):
 *
 *   What they told you. From everything the owner ever typed, newest first:
 *   what they expect to receive, what they want saved, how they want
 *   "can I afford it" judged, their plans, what they asked to be
 *   remembered, and what they corrected. Across sessions and past Clear
 *   this view, because it is read from the saved record.
 *
 *   This conversation, in outline. Every question on screen and the first
 *   sentence of its answer, numbered, so "the first you said", "that
 *   budget" and "why 14K" point at something the model can see, however
 *   much of the rest had to go.
 *
 * Only the owner's own words become facts. Nothing is inferred about them,
 * and a developer note ("//...") is never one.
 */
export function keepInMind(saved: readonly ChatMessage[], onScreen: readonly Spoken[], asOf?: string): string {
  const theirs = [...saved]
    .filter((m) => m.role === "you" && m.text.trim() !== "" && !m.text.trim().startsWith("//"))
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  // What is on screen and not saved yet counts too, as said today.
  const seen = new Set(theirs.map((m) => m.text.trim()));
  const unsaved = onScreen.filter((t) => t.role === "you" && !seen.has(t.text.trim()) && !t.text.trim().startsWith("//"));
  const said: { text: string; day: string }[] = [
    ...[...unsaved].reverse().map((t) => ({ text: t.text, day: "today" })),
    ...theirs.map((m) => ({ text: m.text, day: m.at.slice(0, 10) })),
  ];

  const facts: string[] = [];
  const income = said.find((m) => expectedIncomeIn(m.text) !== null);
  if (income) facts.push(`They expect about ${money(expectedIncomeIn(income.text) ?? 0)} coming in (${income.day}: "${short(income.text, 110)}").`);
  const goal = said.find((m) => savingsGoalIn(m.text) !== null);
  if (goal) facts.push(`They want to keep ${money(savingsGoalIn(goal.text) ?? 0)} aside to save (${goal.day}).`);
  const basis = said.find((m) => goesByBalance(m.text));
  if (basis) facts.push(`They want "can I afford it" judged by what the wallets hold, not by the budget (${basis.day}).`);

  const PLAN = /\b(?:i'?m planning|i plan|planning to|i will|i'?ll|i'?m going to|i am going to|next week|balak|plano)\b/i;
  const REMEMBER = /\b(?:remember|tandaan|keep in mind|note that|fyi|for your info)\b/i;
  const CORRECTED = /\b(?:that'?s wrong|that is wrong|not correct|incorrect|mali|you are wrong|you'?re wrong|i said|i mean|i meant|not what i (?:want|asked))\b/i;
  const asking = (t: string): boolean => /\?\s*$/.test(t);
  const pick = (test: (t: string) => boolean, most: number, label: string): void => {
    const found = said.filter((m) => test(m.text)).slice(0, most);
    for (const m of found) facts.push(`${label} (${m.day}): "${short(m.text, 160)}"`);
  };
  pick((t) => REMEMBER.test(t), 4, "Asked you to remember");
  /*
   * A plan is for its own few days. 3 October 2026: "I'm planning to go to
   * the gym this week and 70 per session 2x a week", said on 28 September,
   * was still pinned five days later and came back as "gym sessions (PHP
   * 140)" in advice about something else. Three days, then it is history.
   */
  const recent = (day: string): boolean => {
    if (!asOf || day === "today") return true;
    const apart = (Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000;
    return Number.isFinite(apart) && apart <= 3;
  };
  const plans = said.filter((m) => PLAN.test(m.text) && !asking(m.text) && recent(m.day)).slice(0, 3);
  for (const m of plans) facts.push(`A plan they mentioned (${m.day}): "${short(m.text, 160)}"`);
  pick((t) => CORRECTED.test(t), 3, "They corrected you");

  const outline: string[] = [];
  let n = 0;
  for (let i = 0; i < onScreen.length; i += 1) {
    const turn = onScreen[i];
    if (!turn || turn.role !== "you") continue;
    const reply = onScreen.slice(i + 1).find((t) => t.role === "assistant");
    const next = onScreen.slice(i + 1).find((t) => t.role === "you");
    const answered = reply && (!next || onScreen.indexOf(reply) < onScreen.indexOf(next));
    n += 1;
    // An answer whose figures the app could not trace is not to be repeated (`aiFigures.ts`).
    const untraced = answered && reply && /not (?:a figure|figures) this app worked out/.test(reply.text);
    outline.push(
      `${n}. They asked: "${short(turn.text, 120)}"${answered && reply ? ` You answered: "${short(firstSentence(reply.text), 180)}"` : ""}${untraced ? " (That answer had figures not from the data: never repeat them.)" : ""}`,
    );
  }

  const parts: string[] = [];
  if (facts.length > 0) parts.push(["What they have told you, newest first (never ask for these again):", ...facts.map((f) => `- ${f}`)].join("\n"));
  // The first question stays whatever else goes: "the first you said" is about it.
  const kept = outline.length > 12 ? [outline[0] ?? "", "...", ...outline.slice(-10)] : outline;
  if (outline.length > 1) parts.push(["This conversation so far, in order (\"the first\", \"that\", \"it\" point at these):", ...kept].join("\n"));
  if (parts.length === 0) return "";
  const block = ["What to keep in mind:", ...parts].join("\n");
  return block.length > PINNED_ROOM ? `${block.slice(0, PINNED_ROOM - 3)}...` : block;
}
