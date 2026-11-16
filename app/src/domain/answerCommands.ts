/**
 * The commands a model's answer tells the owner to type, offered as buttons.
 *
 * ── Why ────────────────────────────────────────────────────────────────────
 *
 * The owner, 10 November 2026: "also why I cant edit or add here in
 * allocation using ai?". Answers ended "Type change the gym allocation to"
 * a figure "to update it", or with a bare "allocate" line of their own, or
 * "Pressing the card below will set this" with no card below. A
 * command the app understands is a button under the answer instead: pressing
 * it sends the command, which shows the card, and nothing changes until the
 * card is pressed too, so the owner stays in control.
 */

/** A command the chat carries out as a card: a verb that changes something, and the thing it changes. */
const VERB = /^(?:allocate|change|make|set|plan|move|skip|remove|extend|stop|copy|put back|lower|raise|increase|decrease|mark)\b/i;
const THING = /\b(?:allocation|budget|plan|limit)\b|^allocate\b/i;

function command(raw: string): string | null {
  const c = raw.replace(/[*_`"“”]/g, "").replace(/\s+/g, " ").trim().replace(/[.,;:!]+$/, "");
  if (!VERB.test(c) || !THING.test(c)) return null;
  const words = c.split(" ").length;
  if (words < 3 || words > 14) return null;
  // A sentence about the command, not the command: "change it when you are ready".
  if (/\b(?:you|your|i|we|will|would|can|could|should|when|if|this|it)\b/i.test(c.replace(/^\w+\s+(?:it|this)\b/i, ""))) return null;
  return c.charAt(0).toLowerCase() + c.slice(1);
}

/** The commands an answer suggests, in order, without repeats; at most two. */
export function suggestedCommands(answer: string): string[] {
  const found: string[] = [];
  const add = (raw: string | undefined): void => {
    const c = raw ? command(raw) : null;
    if (c && !found.some((f) => f.toLowerCase() === c.toLowerCase())) found.push(c);
  };
  /*
   * The command ends before "to update it" or a full stop, but not before
   * "to 750" or inside "1,500.00": the button sent "change the gym
   * allocation" without its figure, and was asked what should change
   * (owner, 14 November 2026).
   */
  for (const m of answer.matchAll(/\b(?:type|say|send|write)\s*:?\s*(\*\*[^*\n]{4,90}\*\*|"[^"\n]{4,90}"|“[^”\n]{4,90}”|[a-z](?:[^.\n]|\.(?=\d)){4,90}?)(?=\s+(?:to(?!\s+(?:₱|php\s*)?\d)|and|on|in|here)\b|[.,;!](?!\d)|\n|$)/gi)) add(m[1]);
  for (const m of answer.matchAll(/^\s*(?:[-*]\s*)?(\**[A-Za-z][^\n]{4,90}?)\s*$/gm)) add(m[1]);
  return found.slice(0, 2);
}

/**
 * The answer without what the buttons say instead: a line that is only a
 * command, and a sentence that only tells the owner to type one ("Type
 * change the gym allocation to" a figure "to update it."), which read twice
 * with the button under it.
 */
export function withoutCommandLines(answer: string, commands: readonly string[]): string {
  if (commands.length === 0) return answer;
  const lower = commands.map((c) => c.toLowerCase());
  const plainOf = (t: string): string => t.replace(/[*_`"“”]/g, "").toLowerCase();
  const tellsToType = (sentence: string): boolean => /\b(?:type|say|send|write)\b/i.test(sentence) && lower.some((c) => plainOf(sentence).includes(c));
  return answer
    .split("\n")
    .filter((line) => {
      const c = command(line.replace(/^\s*[-*]\s*/, ""));
      return !(c && lower.includes(c.toLowerCase()));
    })
    .map((line) =>
      line
        .split(/(?<=[.!?])\s+(?=[A-Z*"“])/)
        .filter((sentence) => !tellsToType(sentence))
        .join(" "),
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const FILLER = new Set(["the", "a", "an", "my", "of", "for", "to", "please", "pls", "now", "it", "that"]);
const keyWords = (t: string): string[] => t.toLowerCase().replace(/[^a-z0-9.\s]/g, " ").split(/\s+/).filter((w) => w && !FILLER.has(w));

/**
 * The command an answer suggested, when the owner types it without its
 * figure: "To set this, type change the gym allocation to 750", then
 * "change the gym allocation", was asked "What should change on Gym?", and
 * so was "Change the allocation of gym" (owner, 14 November 2026). The
 * words typed, in any order, are all in the one command suggested, and only
 * its figure is missing. Null otherwise.
 */
export function completedCommand(typed: string, answer: string): string | null {
  const t = typed.trim();
  if (!t || /\d/.test(t) || t.endsWith("?") || t.split(/\s+/).length > 10) return null;
  const mine = keyWords(t);
  if (mine.length < 2) return null;
  const fits = suggestedCommands(answer).filter((c) => /\d/.test(c) && mine.every((w) => keyWords(c).includes(w)));
  return fits.length === 1 ? fits[0]! : null;
}
