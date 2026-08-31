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
