/**
 * Making model output fit the app's writing rules.
 *
 * ── Why a filter and not just an instruction ──────────────────────────────
 *
 * The prompt tells the model to write plain sentences. Models ignore that
 * constantly: they bold the figures, open with a heading, or turn three facts
 * into a bullet list, because that is what most of their training data looks
 * like. The app renders text, not Markdown, so those asterisks reach the
 * screen literally and the owner reads "**PHP 5,000.00**".
 *
 * An instruction that is followed most of the time is not a rule. This is the
 * rule. The instruction stays because it improves the odds and costs nothing.
 *
 * ── What it removes ───────────────────────────────────────────────────────
 *
 * Markdown emphasis, headings, bullets, quotes, code marks and links, and the
 * em dash, which `docs/07-WRITING-RULES.md` W1 bans everywhere including
 * anything the app displays. A model has no idea about that rule, so it is
 * applied here rather than hoped for.
 *
 * ── What it must never touch ──────────────────────────────────────────────
 *
 * Money. The minus sign in a negative figure is U+2212, which W1 explicitly
 * exempts, and it is a different character from the dashes being stripped.
 * Digits, decimal points and thousands separators are never rewritten: a
 * filter that edits a figure is worse than the formatting it was cleaning up.
 */

/** Emphasis: **bold**, *italic*, __bold__, _italic_, and stray runs of them. */
const EMPHASIS = /(\*{1,3}|_{2,3})(?=\S)([\s\S]*?\S)\1/g;

/** A link, reduced to the words a person would have read anyway. */
const LINK = /\[([^\]]+)\]\([^)]*\)/g;

/** Leading list markers, quote marks and heading hashes, per line. */
const LINE_PREFIX = /^[ \t]*(?:[>#]+[ \t]*|[-*+][ \t]+|\d+[.)][ \t]+)/;

export function plainText(raw: string): string {
  let s = raw;

  // Fenced blocks first: their content is kept, the fence is not.
  s = s.replace(/```[a-z]*\n?([\s\S]*?)```/gi, "$1");
  s = s.replace(/`([^`]+)`/g, "$1");

  s = s.replace(LINK, "$1");

  // Twice, so ***both*** unwraps fully rather than leaving one layer behind.
  s = s.replace(EMPHASIS, "$2").replace(EMPHASIS, "$2");

  /**
   * Whatever emphasis marks survive were unbalanced, which is the common case
   * when a model is cut off mid-sentence by a token limit. A lone asterisk is
   * never meaningful in this app's prose, so it goes.
   */
  s = s.replace(/\*+/g, "");

  s = s
    .split("\n")
    .map((line) => line.replace(LINE_PREFIX, ""))
    .join("\n");

  /**
   * The em dash, and the en dash when it is being used as one. W1 says a
   * colon, full stop, comma or parentheses. A comma is the substitution that
   * reads correctly in the most positions, so it is the one used when the
   * dash is separating clauses.
   */
  s = s.replace(/\s*[\u2014]\s*/g, ", ");
  s = s.replace(/ [\u2013] /g, ", ");

  // A dash swap can leave doubled punctuation: "spent, , which" or "x ,".
  s = s.replace(/,\s*,/g, ",");
  s = s.replace(/([,:;.!?])\s*,/g, "$1");
  s = s.replace(/\s+([,.;:!?])/g, "$1");

  // Collapse the blank lines a stripped heading leaves behind.
  s = s.replace(/\n{3,}/g, "\n\n");
  s = s
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n");

  return s.trim();
}

/**
 * The rules as the model is told them.
 *
 * Kept next to the filter so the two cannot drift: if something is added to
 * one, the omission from the other is visible in the same file.
 */
export const PLAIN_TEXT_RULES = [
  "Write plain sentences. No Markdown of any kind.",
  "Never use asterisks, underscores, backticks, hash marks, bullet points, numbered lists, or headings.",
  "Never use an em dash. Use a comma, a colon, or a full stop.",
  "Do not bold or emphasise anything, especially not the figures.",
].join(" ");
