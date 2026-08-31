/**
 * The conversation the model is given.
 *
 * ── The bug ───────────────────────────────────────────────────────────────
 *
 * It was built by subtraction: everything that is not a proposal, or not a
 * proposal and not a chart. Written that way it is wrong the moment a new
 * kind of turn exists, and it was. Cards, charts, found lists and debt cards
 * carry no `text` at all, so the history handed to the model looked like
 *
 *     found: undefined
 *     chart: undefined
 *
 * with roles it has never been told about. "It does not read the chat" was
 * exactly right: it read it, and much of what it read was noise.
 *
 * The rule is now positive. A turn counts as conversation when it is words
 * somebody said, so anything added later has to opt in rather than leak in.
 * This file pins that, because the same mistake is one careless filter away
 * from coming back.
 */

import { describe, expect, it } from "vitest";

/**
 * The shapes, copied rather than imported.
 *
 * `AskPanel.tsx` is a React component and importing it drags in Firebase.
 * What is under test is a rule about kinds, so the rule is what is here, and
 * `spokenHistory` in that file must stay identical to it.
 */
type Turn =
  | { kind: "you"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "proposal" }
  | { kind: "found" }
  | { kind: "chart" }
  | { kind: "debt" };

const isSaid = (t: Turn): t is { kind: "you" | "assistant"; text: string } =>
  t.kind === "you" || t.kind === "assistant";

const spokenHistory = (turns: readonly Turn[], most: number) =>
  turns
    .filter(isSaid)
    .filter((t) => t.text.trim() !== "")
    .slice(-most)
    .map((t) => ({ role: t.kind, text: t.text }));

/** A conversation shaped like a real one: words with cards between them. */
const conversation: Turn[] = [
  { kind: "you", text: "I earned 1000000 to all wallet from framelink" },
  { kind: "assistant", text: "One entry. Check it, then add it." },
  { kind: "proposal" },
  { kind: "you", text: "also in gcash 100000000 too" },
  { kind: "chart" },
  { kind: "assistant", text: "Which wallet did it land in?" },
  { kind: "found" },
  { kind: "debt" },
  { kind: "you", text: "also in cahs" },
];

describe("only words reach the model", () => {
  it("keeps every said turn, in order", () => {
    expect(spokenHistory(conversation, 20).map((h) => h.text)).toEqual([
      "I earned 1000000 to all wallet from framelink",
      "One entry. Check it, then add it.",
      "also in gcash 100000000 too",
      "Which wallet did it land in?",
      "also in cahs",
    ]);
  });

  /** The whole bug, in one assertion. */
  it("never sends a turn with no text", () => {
    for (const turn of spokenHistory(conversation, 20)) {
      expect(turn.text).toBeTypeOf("string");
      expect(turn.text.length).toBeGreaterThan(0);
    }
  });

  it("only ever labels a turn you or assistant", () => {
    for (const turn of spokenHistory(conversation, 20)) {
      expect(["you", "assistant"]).toContain(turn.role);
    }
  });

  /**
   * A kind added later must not leak in.
   *
   * This is the property that failed. Both filters were written as "not a
   * proposal", and a debt card added months afterwards was neither excluded
   * nor considered.
   */
  it("ignores a kind of turn nobody thought about", () => {
    const withNew = [
      ...conversation,
      { kind: "receipt" } as unknown as Turn,
      { kind: "poll" } as unknown as Turn,
    ];
    expect(spokenHistory(withNew, 20).length).toBe(5);
  });
});

describe("the window", () => {
  it("takes the most recent, not the first", () => {
    expect(spokenHistory(conversation, 2).map((h) => h.text)).toEqual([
      "Which wallet did it land in?",
      "also in cahs",
    ]);
  });

  /** Counted in words, not in turns: cards must not use up the window. */
  it("counts said turns, so cards do not push the conversation out", () => {
    const padded: Turn[] = [
      { kind: "you", text: "first" },
      { kind: "proposal" },
      { kind: "chart" },
      { kind: "found" },
      { kind: "debt" },
      { kind: "assistant", text: "second" },
    ];
    expect(spokenHistory(padded, 2).map((h) => h.text)).toEqual(["first", "second"]);
  });

  it("drops a blank line rather than sending an empty turn", () => {
    const blank: Turn[] = [
      { kind: "you", text: "   " },
      { kind: "you", text: "real" },
    ];
    expect(spokenHistory(blank, 10)).toEqual([{ role: "you", text: "real" }]);
  });

  it("is empty for a conversation with nothing said in it", () => {
    expect(spokenHistory([{ kind: "proposal" }, { kind: "chart" }], 10)).toEqual([]);
  });
});
