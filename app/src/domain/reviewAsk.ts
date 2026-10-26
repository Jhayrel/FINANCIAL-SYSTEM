/**
 * One flagged entry, asked about by its number: "what's wrong with #3831?",
 * "why is 3831 flagged?", "keep #3831 as it is".
 *
 * The owner, 26 October 2026: "make sure ai can do it all like everything".
 * The Database's "i" says what a flag means and Keep marks the entry checked
 * without moving money (`reviewExplain.ts`); from the chat, the same question
 * was answered with the month's headline. The answer here is the "i"'s own
 * words, and Keep is a card, the same note and nothing else.
 */
import { checkIntegrity, KEPT_NOTE, type Issue } from "./integrity";
import { explainFlag, type FlagExplained } from "./reviewExplain";
import type { IsoDate, Transaction } from "./types";

export interface ReviewRowAsk {
  readonly recordNumber: number;
  /** Keep it as it is, rather than say what is wrong. */
  readonly keep: boolean;
}

const NUMBER = /#\s?(\d{1,5})\b|\b(?:record|entry|row|number|no\.?)\s*#?\s?(\d{1,5})\b/i;

export function readReviewRowAsk(text: string): ReviewRowAsk | null {
  const t = text.trim();
  if (t.split(/\s+/).length > 16) return null;
  const m = NUMBER.exec(t) ?? /^\s*(?:what'?s|what is|why is)\s+(?:wrong\s+with\s+)?(\d{3,5})\b/i.exec(t);
  const n = Number(m?.[1] ?? m?.[2] ?? NaN);
  if (!Number.isInteger(n) || n <= 0) return null;
  // Changing a figure is an edit, read by the edit finder: "change #3831 to 200".
  if (/\b(?:change|edit|set|make|move|delete|bin|remove|restore)\b/i.test(t) && !/\bkeep\b/i.test(t)) return null;
  const keep =
    /\bkeep\b|\b(?:is|it'?s|looks)\s+(?:correct|right|fine|ok(?:ay)?|good)\b|\bmark\b[^.?!]{0,20}\b(?:checked|reviewed|correct|ok(?:ay)?|fine)\b|\b(?:leave|ignore)\s+(?:it|this|that)\b|\bdismiss\b/i.test(t);
  const why = /\bwrong\b|\bwhy\b|\bflag\w*\b|\bproblem\b|\bissue\b|\bexplain\b|\bwhat(?:'s| is)\s+(?:the\s+)?(?:matter|up)\b|\breview\b|\bcheck\b|\bano(?:ng)?\s+(?:mali|problema)\b/i.test(t);
  if (!keep && !why) return null;
  return { recordNumber: n, keep };
}

export interface ReviewRowAnswer {
  readonly words: string;
  /** Whether Needs review lists it, so the answer offers that list only then. */
  readonly flagged: boolean;
  /** The keep card's rows, before and after, when a keep was asked and it can be kept. */
  readonly keep?: { readonly rows: readonly { readonly before: Transaction; readonly after: Transaction }[]; readonly note: string };
}

const no = (t: Transaction): string => `#${String(t.recordNumber).padStart(4, "0")}`;

/** "#3831", "#3831 and #3823", "#3831, #3823 and #3824". */
export const numbersInWords = (rows: readonly Transaction[]): string => {
  const all = rows.map(no);
  return all.length <= 1 ? (all[0] ?? "") : `${all.slice(0, -1).join(", ")} and ${all[all.length - 1] ?? ""}`;
};

/** What is wrong with the entry and what to do, or the keep card, from the Database's own checks. */
export function reviewRowAnswer(
  ask: ReviewRowAsk,
  transactions: readonly Transaction[],
  context: { readonly wallets: readonly string[]; readonly asOf: IsoDate },
): ReviewRowAnswer {
  const row = transactions.find((t) => t.recordNumber === ask.recordNumber);
  if (!row) return { flagged: false, words: `There is no #${String(ask.recordNumber).padStart(4, "0")} in the ledger. If it was deleted, it is in the Bin.` };
  const issues: Issue[] = checkIntegrity(transactions, { wallets: context.wallets }).filter((i) => i.severity !== "info" && i.ids.includes(row.id));
  if (issues.length === 0) {
    const kept = row.notes.includes(KEPT_NOTE);
    return {
      flagged: false,
      words: kept
        ? `${no(row)} was checked and kept as it is, so Needs review no longer lists it. Nothing about it needs doing.`
        : `${no(row)} is not flagged: the app's checks find nothing wrong with it. If something about it looks wrong to you, say what ("${no(row)} should be 200", "${no(row)} was from Gcash") and I will make the change card.`,
    };
  }
  const explained: FlagExplained = explainFlag(row, issues, transactions, context);
  const what = explained.problems.map((p) => `- ${p.what} ${p.why}`);
  if (!ask.keep) {
    return {
      flagged: true,
      words: [
        `**${no(row)} is in Needs review.**`,
        ...what,
        `**To fix it:** ${explained.fix}`,
        `**To keep it as it is:** ${explained.keep}${explained.kept.length > 0 ? ` Say "keep ${no(row)} as it is".` : ""}`,
      ].join("\n"),
    };
  }
  if (explained.kept.length === 0) return { flagged: true, words: explained.keep };
  const rows = explained.keepRows.map((before, i) => ({ before, after: explained.kept[i] ?? before }));
  return {
    flagged: true,
    words: `${explained.keepRows.length > 1 ? `${numbersInWords(explained.keepRows)} are` : `${no(row)} is`} kept as ${explained.keepRows.length > 1 ? "they are" : "it is"} with one press. Check your wallets first: if they already show the right amounts, this is the right choice.`,
    keep: { rows, note: explained.keep },
  };
}
