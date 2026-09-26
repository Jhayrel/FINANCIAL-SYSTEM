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
  /**
   * A list. `ordered` keeps the numbers the model wrote.
   *
   * "1." and "-" used to become the same bulleted list, so a ranked answer
   * ("1. Treat, 2. Food, 3. School") lost the one thing that made it a
   * ranking: the owner's "numbering is not working", 26 September 2026.
   */
  | {
      readonly kind: "list";
      readonly items: readonly (readonly Segment[])[];
      readonly ordered?: boolean;
      /** The first number, when a numbered list does not start at 1. */
      readonly start?: number;
    };

/** `**bold**` and `__bold__`. Single marks are left alone: a lone asterisk in
    "2 * 3" is arithmetic, and italics add nothing to a figure. */
const BOLD = /(\*\*|__)(?=\S)([\s\S]*?\S)\1/g;

/** A bulleted line: a hyphen, a bullet or an asterisk at the start. */
const BULLET = /^[ \t]*[-•*+][ \t]+/;

/** A numbered line: "1." or "1)" at the start, with the number kept. */
const NUMBERED = /^[ \t]*(\d{1,3})[.)][ \t]+/;

/**
 * A heading: "## Where it went". Shown as a bold line of its own, because it
 * is a label for what follows and the marks are not the point.
 */
const HEADING = /^[ \t]*#{1,6}[ \t]+/;

/** `*a word*` and `_a word_`: the marks go and the words stay. */
const ITALIC = /(^|[\s(])[*_](?=\S)([^*_\n]*?\S)[*_](?=[\s).,;:!?]|$)/g;

/** Split one line into bold and plain runs. */
function spansOf(raw: string): Segment[] {
  const spans: Segment[] = [];
  let at = 0;
  // Bold-and-italic first, then italic on its own: both are only emphasis marks here.
  const line = raw.replace(/\*\*\*(?=\S)([\s\S]*?\S)\*\*\*/g, "**$1**").replace(ITALIC, "$1$2");

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
  /** Whether the open list is numbered, and the number it starts from. */
  let numbered: { start: number } | null = null;

  const closeParagraph = (): void => {
    if (paragraph.length === 0) return;
    blocks.push({ kind: "paragraph", spans: spansOf(paragraph.join(" ")) });
    paragraph = [];
  };

  const closeList = (): void => {
    if (items.length === 0) return;
    blocks.push(
      numbered
        ? { kind: "list", items: items.map(spansOf), ordered: true, ...(numbered.start !== 1 ? { start: numbered.start } : {}) }
        : { kind: "list", items: items.map(spansOf) },
    );
    items = [];
    numbered = null;
  };

  for (const raw of text.split("\n")) {
    const line = raw.trim();

    if (!line) {
      closeList();
      closeParagraph();
      continue;
    }

    if (HEADING.test(line)) {
      closeList();
      closeParagraph();
      const words = line.replace(HEADING, "").replace(/\*\*|__/g, "").trim();
      if (words) blocks.push({ kind: "paragraph", spans: [{ text: words, bold: true }] });
      continue;
    }

    const number = NUMBERED.exec(line);
    if (number) {
      closeParagraph();
      // A bulleted list followed by a numbered one is two lists, not one.
      if (items.length > 0 && !numbered) closeList();
      if (!numbered) numbered = { start: Number(number[1]) };
      items.push(line.replace(NUMBERED, ""));
      continue;
    }

    if (BULLET.test(line)) {
      closeParagraph();
      if (numbered) closeList();
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
