import { describe, expect, it } from "vitest";

import { readRich, type Block } from "./richText";

const text = (b: Block): string =>
  b.kind === "paragraph"
    ? b.spans.map((s) => s.text).join("")
    : b.items.map((i) => i.map((s) => s.text).join("")).join(" | ");

describe("readRich: structure", () => {
  it("keeps a plain sentence as one paragraph", () => {
    const blocks = readRich("You spent PHP 8,791.37 in August.");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind).toBe("paragraph");
    expect(text(blocks[0]!)).toBe("You spent PHP 8,791.37 in August.");
  });

  it("joins the wrapped lines of one paragraph", () => {
    const blocks = readRich("You spent PHP 8,791.37\nin August 2026.");
    expect(blocks).toHaveLength(1);
    expect(text(blocks[0]!)).toBe("You spent PHP 8,791.37 in August 2026.");
  });

  it("splits paragraphs on a blank line", () => {
    const blocks = readRich("First thing.\n\nSecond thing.");
    expect(blocks).toHaveLength(2);
    expect(blocks.every((b) => b.kind === "paragraph")).toBe(true);
  });

  it("gathers consecutive bullets into one list", () => {
    const blocks = readRich("Where it went:\n- Food PHP 1,581.00\n- Treat PHP 1,640.00");
    expect(blocks.map((b) => b.kind)).toEqual(["paragraph", "list"]);
    expect(text(blocks[1]!)).toBe("Food PHP 1,581.00 | Treat PHP 1,640.00");
  });

  it("reads every bullet character a model reaches for", () => {
    for (const mark of ["-", "*", "+", "•", "1.", "2)"]) {
      const blocks = readRich(`${mark} Food PHP 100.00`);
      expect(blocks[0]?.kind, mark).toBe("list");
      expect(text(blocks[0]!), mark).toBe("Food PHP 100.00");
    }
  });

  it("starts a new paragraph after a list ends", () => {
    const blocks = readRich("- one\n- two\nAnd that is the month.");
    expect(blocks.map((b) => b.kind)).toEqual(["list", "paragraph"]);
  });
});

describe("readRich: emphasis", () => {
  it("reads bold as bold, and drops the marks", () => {
    const blocks = readRich("You are **PHP 1,091.37** over.");
    const spans = blocks[0]?.kind === "paragraph" ? blocks[0].spans : [];
    expect(spans.map((s) => s.text)).toEqual(["You are ", "PHP 1,091.37", " over."]);
    expect(spans.map((s) => s.bold)).toEqual([false, true, false]);
    expect(text(blocks[0]!)).not.toContain("*");
  });

  it("reads underscores the same way", () => {
    const blocks = readRich("__Food__ was the largest.");
    const spans = blocks[0]?.kind === "paragraph" ? blocks[0].spans : [];
    expect(spans[0]).toEqual({ text: "Food", bold: true });
  });

  it("leaves a lone asterisk out rather than showing it", () => {
    // What a reply cut off by a token limit looks like.
    expect(text(readRich("You spent **PHP 5,000")[0]!)).toBe("You spent PHP 5,000");
  });

  it("never rewrites a figure", () => {
    const money = "PHP 1,234.56 and −PHP 363.79 and 8,791.37";
    expect(text(readRich(money)[0]!)).toBe(money);
  });

  it("keeps the minus sign W1 exempts", () => {
    expect(text(readRich("Cash is at −PHP 39.00.")[0]!)).toContain("−");
  });

  it("carries emphasis inside a list item", () => {
    const blocks = readRich("- **Food** PHP 1,581.00");
    const item = blocks[0]?.kind === "list" ? blocks[0].items[0] : [];
    expect(item?.[0]).toEqual({ text: "Food", bold: true });
  });
});

describe("readRich: nothing to show", () => {
  it("returns no blocks for an empty answer", () => {
    expect(readRich("")).toEqual([]);
    expect(readRich("\n\n  \n")).toEqual([]);
  });
});

/**
 * 26 September 2026: "the ai bold text and bullet points and numbering is not
 * working, it just says **". A numbered list became a bulleted one, so a
 * ranking lost its order marks, and a heading or a single-asterisk emphasis
 * left its marks in the text.
 */
describe("readRich: numbers, headings and emphasis", () => {
  it("keeps a numbered list numbered", () => {
    const blocks = readRich("The biggest three:\n1. Treat PHP 21,354.00\n2. Food PHP 5,633.00\n3. School PHP 4,800.00");
    expect(blocks.map((b) => b.kind)).toEqual(["paragraph", "list"]);
    const list = blocks[1];
    expect(list?.kind === "list" && list.ordered).toBe(true);
    expect(list?.kind === "list" && list.start).toBeUndefined();
    expect(text(list!)).toBe("Treat PHP 21,354.00 | Food PHP 5,633.00 | School PHP 4,800.00");
  });

  it("keeps the first number when it is not 1", () => {
    const list = readRich("3) Gas\n4) Parking")[0];
    expect(list?.kind === "list" && list.start).toBe(3);
  });

  it("does not run bullets and numbers into one list", () => {
    const blocks = readRich("- Food\n- Gas\n1. Save first\n2. Then spend");
    expect(blocks.map((b) => (b.kind === "list" ? (b.ordered ? "ol" : "ul") : "p"))).toEqual(["ul", "ol"]);
  });

  it("reads a heading as a bold line, with no hash marks", () => {
    const blocks = readRich("## Where it went\nMostly on food.");
    expect(blocks[0]).toEqual({ kind: "paragraph", spans: [{ text: "Where it went", bold: true }] });
    expect(text(blocks[1]!)).toBe("Mostly on food.");
  });

  it("drops the marks of single emphasis and keeps the words", () => {
    expect(text(readRich("That is *well* over, and _much_ more than July.")[0]!)).toBe(
      "That is well over, and much more than July.",
    );
  });

  it("reads bold inside a numbered item", () => {
    const list = readRich("1. **Treat** rose by **PHP 19,714.00**")[0];
    expect(list?.kind === "list" && list.items[0]?.filter((s) => s.bold).map((s) => s.text)).toEqual(["Treat", "PHP 19,714.00"]);
  });

  it("leaves a name with underscores in it alone", () => {
    expect(text(readRich("The answer came from gpt_oss_120b and _was_ short.")[0]!)).toBe(
      "The answer came from gpt_oss_120b and was short.",
    );
  });
});
