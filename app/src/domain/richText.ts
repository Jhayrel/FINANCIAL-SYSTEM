/**
 * Structure in a chat answer, rendered rather than stripped.
 *
 * ── Why this is a change of mind, and why it is safe ──────────────────────
 *
 * `aiText.ts` strips Markdown, and the reason is sound: the app renders text,
 * not Markdown, so a model that bolds a figure puts a literal `**PHP 5,000**`
 * on screen. The rule was never "structure is bad", it was "raw markup on
 * screen is bad", and stripping was the only way to be sure of that.
 *
 * A long answer about four months of spending genuinely reads better with a
 * line per month. So the chat parses the markup instead of deleting it, and
 * renders real emphasis and real list items. No asterisk reaches the screen,
 * which is the thing the rule was protecting.
 *
 * Everything else still goes through `plainText`. A five word description or
 * an alert line has no use for a bullet, and the surfaces that render one
 * string into one element cannot show structure anyway.
 *
 * ── What it deliberately does not support ─────────────────────────────────
 *
 * Headings, links, tables, code blocks, images, raw HTML. This is emphasis,
 * bullets and paragraphs, which is everything a financial answer needs. A
 * parser that accepted more would be a parser with more ways to be wrong, and
 * nothing here ever becomes HTML: the output is data, and the component
 * renders it with React elements.
 */

export interface Segment {
  readonly text: string;
  readonly bold: boolean;
}

export type Block =
  | { readonly kind: "paragraph"; readonly spans: readonly Segment[] }
  | { readonly kind: "list"; readonly items: readonly (readonly Segment[])[] };

/** `**bold**` and `__bold__`. Single marks are left alone: a lone asterisk in
    "2 * 3" is arithmetic, and italics add nothing to a figure. */
const BOLD = /(\*\*|__)(?=\S)([\s\S]*?\S)\1/g;

/** A list line: a hyphen, a bullet, an asterisk, or "1." at the start. */
const BULLET = /^[ \t]*(?:[-•*+]|\d+[.)])[ \t]+/;

/** Split one line into bold and plain runs. */
function spansOf(line: string): Segment[] {
  const spans: Segment[] = [];
  let at = 0;

  // `lastIndex` is state on a global regex, so this gets its own copy.
  const pattern = new RegExp(BOLD.source, "g");
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(line)) !== null) {
    if (match.index > at) spans.push({ text: line.slice(at, match.index), bold: false });
    spans.push({ text: match[2] ?? "", bold: true });
    at = match.index + match[0].length;
  }

  if (at < line.length) spans.push({ text: line.slice(at), bold: false });

  /**
   * Whatever emphasis marks survive were unbalanced, which is what a reply cut
   * off by a token limit looks like. A lone asterisk is never meaningful here,
   * so it goes, exactly as `plainText` does it.
   */
  return spans
    .map((s) => (s.bold ? s : { ...s, text: s.text.replace(/\*+|__+/g, "") }))
    .filter((s) => s.text.length > 0);
}

/**
 * Read an answer into paragraphs and lists.
 *
 * Consecutive bullet lines become one list. A blank line ends a paragraph.
 * Everything else joins the paragraph it is in, because a model wraps its
 * lines and a hard break inside a sentence is not a new thought.
 */
export function readRich(text: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let items: string[] = [];

  const closeParagraph = (): void => {
    if (paragraph.length === 0) return;
    blocks.push({ kind: "paragraph", spans: spansOf(paragraph.join(" ")) });
    paragraph = [];
  };

  const closeList = (): void => {
    if (items.length === 0) return;
    blocks.push({ kind: "list", items: items.map(spansOf) });
    items = [];
  };

  for (const raw of text.split("\n")) {
    const line = raw.trim();

    if (!line) {
      closeList();
      closeParagraph();
      continue;
    }

    if (BULLET.test(line)) {
      closeParagraph();
      items.push(line.replace(BULLET, ""));
      continue;
    }

    closeList();
    paragraph.push(line);
  }

  closeList();
  closeParagraph();

  return blocks.filter((b) => (b.kind === "paragraph" ? b.spans.length > 0 : b.items.length > 0));
}
