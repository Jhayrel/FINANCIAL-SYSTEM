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
