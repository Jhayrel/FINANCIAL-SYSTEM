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
export function conversationBlock(earlier: string, history: readonly Spoken[], max = 14_000): string {
  const HEADER = "Earlier in this conversation:";
  const lines = history.map((h) => `${h.role}: ${h.text}`).join("\n");
  const now = lines ? `${HEADER}\n${keepNewest(lines, max - HEADER.length - 1)}` : "";
  const room = max - now.length - 2;
  const before = earlier.trim() && room > 300 ? `Earlier sessions, oldest first:\n${keepNewest(earlier.trim(), room - 40)}` : "";
  return [before, now].filter(Boolean).join("\n\n");
}
