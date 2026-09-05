/**
 * A photo leaves its description behind, and it has to survive the round trip.
 *
 * The owner has reported this three times: upload a picture, refresh, and the
 * message comes back as a small blank bubble. The picture is never stored,
 * deliberately, so the description is the only thing that can come back, and
 * every link in that chain has to hold:
 *
 *   said()      keeps the descriptions on the message
 *   the store   writes them under `files`
 *   the reload  turns `files` back into something to render
 *
 * The first and last are pure and are tested here. The middle is a database
 * rule, which is why `AskPanel` retries without the field when it is refused.
 */

import { describe, expect, it } from "vitest";

import { said, drawn, type ChatMessage } from "./chat";

/**
 * The reload, as `AskPanel` does it.
 *
 * Kept in step with the mapping in `AskPanel`'s history effect: a chart
 * becomes a chart, anything else becomes a said turn carrying whatever file
 * descriptions the message holds.
 */
const rebuild = (m: ChatMessage): { text: string; described?: readonly string[] } => {
  const chart = drawn(m);
  if (chart) return { text: m.text };
  return {
    text: m.text,
    ...(m.files && m.files.length > 0 ? { described: m.files } : {}),
  };
};

const ONE = "IMG_1234.jpg, a receipt: Food, PHP 300.00";

describe("a photo message survives a refresh", () => {
  it("keeps the description on the message", () => {
    expect(said("you", "", undefined, [ONE]).files).toEqual([ONE]);
  });

  /**
   * The exact case in the screenshot: a picture sent with no words at all.
   * The message text is empty, so the description is the whole content.
   */
  it("keeps it when the message has no text of its own", () => {
    const message = said("you", "", undefined, [ONE]);
    expect(message.text).toBe("");
    const back = rebuild(message);
    expect(back.described).toEqual([ONE]);
  });

  it("gives one line per file, in order", () => {
    const lines = ["a.png, a receipt: Food, PHP 300.00", "b.png, a photo: nothing readable"];
    expect(rebuild(said("you", "", undefined, lines)).described).toEqual(lines);
  });

  it("keeps a description saying nothing was readable, which is still an answer", () => {
    const line = "image.png, a photo: nothing readable";
    expect(rebuild(said("you", "", undefined, [line])).described).toEqual([line]);
  });

  it("keeps the words when there were words as well as pictures", () => {
    const back = rebuild(said("you", "all paid today using maya", undefined, [ONE]));
    expect(back.text).toBe("all paid today using maya");
    expect(back.described).toEqual([ONE]);
  });

  it("caps at five, matching what one message may carry", () => {
    const many = Array.from({ length: 8 }, (_, i) => `f${i}.png, a photo: nothing readable`);
    expect(said("you", "", undefined, many).files).toHaveLength(5);
  });

  it("carries no `files` at all when there were none, rather than an empty list", () => {
    expect(said("you", "hello").files).toBeUndefined();
    expect(rebuild(said("you", "hello")).described).toBeUndefined();
  });

  /** A line of spaces is not a description and must not become a blank row. */
  it("drops a description that is only whitespace", () => {
    expect(said("you", "", undefined, ["   ", ONE]).files).toEqual([ONE]);
  });

  /**
   * The one thing this field must never become. A megabyte of image against a
   * one megabyte document cap, and the least useful byte in a ledger.
   */
  it("never carries the picture itself", () => {
    const message = said("you", "", undefined, [ONE]);
    expect(JSON.stringify(message)).not.toContain("data:image");
  });
});
