import { describe, expect, it } from "vitest";

import type { ChatMessage } from "./chat";
import { chatHistory, conversationBlock, earlierSessions, keepInMind, PINNED_ROOM } from "./memory";

const m = (at: string, role: "you" | "assistant", text: string): ChatMessage => ({ id: at, at, role, text });

const saved = [
  m("2026-09-27T15:12:07Z", "you", "I need gas for tomorrow, can I afford it? based on balance not budget"),
  m("2026-09-27T15:12:09Z", "assistant", "What was it for?"),
  m("2026-09-27T15:12:15Z", "you", "//error"),
  m("2026-09-27T15:19:50Z", "assistant", "Yes, you can spend PHP 100.00 in cash."),
  m("2026-09-28T07:01:27Z", "you", "if I go to the gym today can I go?"),
  m("2026-09-28T07:01:29Z", "assistant", "Yes. You have PHP 4,798.95 in spending wallets."),
];

describe("what was said in earlier sessions", () => {
  it("keeps what they said, dated, without notes or the app's own lines", () => {
    const text = earlierSessions(saved, []);
    expect(text.split("\n")).toEqual([
      "2026-09-27 you: I need gas for tomorrow, can I afford it? based on balance not budget",
      "2026-09-27 assistant: Yes, you can spend PHP 100.00 in cash.",
      "2026-09-28 you: if I go to the gym today can I go?",
      "2026-09-28 assistant: Yes. You have PHP 4,798.95 in spending wallets.",
    ]);
  });

  it("stops where the conversation on screen begins, so nothing is sent twice", () => {
    const text = earlierSessions(saved, ["if I go to the gym today can I go?", "Yes. You have PHP 4,798.95 in spending wallets."]);
    expect(text).not.toContain("gym");
    expect(text).toContain("based on balance not budget");
  });

  it("stays within its room, newest kept", () => {
    const many = Array.from({ length: 200 }, (_, i) => m(`2026-09-${String(1 + (i % 27)).padStart(2, "0")}T00:00:${String(i % 60).padStart(2, "0")}Z`, "you", `message number ${i} ${"x".repeat(80)}`));
    const text = earlierSessions(many, [], 30, 1_000);
    expect(text.length).toBeLessThanOrEqual(1_000);
    expect(text.split("\n").length).toBeGreaterThan(3);
  });
});

describe("the conversation sent with a question", () => {
  const long = `I recommend a budget of PHP 14,322.00 for October 2026. ${"- Food: PHP 1,450.00\n".repeat(80)}`;

  /*
   * 28 September 2026: every turn was cut to 500 characters, so "tell me
   * the separation of that budget" was sent a quarter of the answer it was
   * about.
   */
  it("keeps the newest turns whole and shortens the older ones", () => {
    const said = [
      { role: "you" as const, text: "x".repeat(900) },
      { role: "assistant" as const, text: "y".repeat(900) },
      { role: "you" as const, text: "what budget do you recommend?" },
      { role: "assistant" as const, text: long },
      { role: "you" as const, text: "tell me whats the separation of that budget?" },
    ];
    const history = chatHistory(said, 12, 4);
    expect(history[0]?.text.length).toBeLessThanOrEqual(403);
    expect(history[3]?.text.length).toBeGreaterThan(1_500);
    expect(history[4]?.text).toBe("tell me whats the separation of that budget?");
  });

  it("puts this conversation last, and keeps it before earlier sessions when short of room", () => {
    const block = conversationBlock("2026-09-27 you: old thing", [{ role: "you", text: "new thing" }]);
    expect(block.indexOf("Earlier sessions")).toBeLessThan(block.indexOf("Earlier in this conversation:"));
    const tight = conversationBlock("2026-09-27 you: old thing ".repeat(50), [{ role: "you", text: "new thing" }], 300);
    expect(tight).toContain("Earlier in this conversation:\nyou: new thing");
    expect(tight.length).toBeLessThanOrEqual(300);
  });
});

/*
 * The owner, 28 September 2026: "make an algorithm so the ai wont forget".
 * What they told it and the outline of the conversation go whole with every
 * question, above the conversation, where nothing trims them.
 */
describe("what the model must not forget", () => {
  const said = (at: string, text: string, role: "you" | "assistant" = "you") => ({ id: at, at, role, text });
  const saved = [
    said("2026-09-26T08:00:00Z", "my allowance is 8000 a month"),
    said("2026-09-27T08:00:00Z", "remember that Netflix and Google Drive are stopped"),
    said("2026-09-27T09:00:00Z", "I want to save 1000 every month"),
    said("2026-09-27T10:00:00Z", "can I afford gas tomorrow? based on balance not budget"),
    said("2026-09-28T07:56:00Z", "I'm planning to go to the gym this week and 70 per session 2x a week"),
    said("2026-09-28T08:00:00Z", "//the ai is broken here"),
    said("2026-09-28T08:10:00Z", "that's wrong, I meant December not October"),
  ];
  const conversation = [
    { role: "you" as const, text: "what's your realistic budget recommendation next month?" },
    { role: "assistant" as const, text: "I recommend a budget of **PHP 14,322.00** for October 2026. It is each item's usual month." },
    { role: "you" as const, text: "tell me whats the separation of that budget?" },
    { role: "assistant" as const, text: "Spending is PHP 12,800.00 and bills PHP 1,522.00. School leads." },
    { role: "you" as const, text: "why 14K" },
  ];
  const block = keepInMind(saved, conversation);

  it("keeps what they told it, across sessions", () => {
    expect(block).toContain("They expect about PHP 8,000.00 coming in");
    expect(block).toContain("They want to keep PHP 1,000.00 aside to save");
    expect(block).toContain('judged by what the wallets hold, not by the budget');
    expect(block).toContain("Asked you to remember (2026-09-27)");
    expect(block).toContain("A plan they mentioned (2026-09-28)");
    expect(block).toContain("They corrected you (2026-09-28)");
  });

  it("never takes a developer note for something they said", () => {
    expect(block).not.toContain("the ai is broken");
  });

  it("outlines this conversation, so the first and that point somewhere", () => {
    expect(block).toContain('1. They asked: "what\'s your realistic budget recommendation next month?" You answered: "I recommend a budget of PHP 14,322.00 for October 2026."');
    expect(block).toContain('3. They asked: "why 14K"');
  });

  it("goes first in the conversation block, whole, and stays inside its room", () => {
    const text = conversationBlock("2026-09-27 you: old ".repeat(400), conversation, 3_000, block);
    expect(text.startsWith("What to keep in mind:")).toBe(true);
    expect(text).toContain("Earlier in this conversation:");
    expect(block.length).toBeLessThanOrEqual(PINNED_ROOM);
  });

  it("is nothing when there is nothing to keep", () => {
    expect(keepInMind([], [{ role: "you", text: "hello" }])).toBe("");
  });
});
