/**
 * Questions about the cards a picture made, one card at a time.
 *
 * The owner, 27 September 2026, about a Maya history of twenty four rows:
 * "it should ask following question like the entry on this have send money
 * to? etc like it need questions". A batch used to end with one line, "6 of
 * them still need what it was for", and a red blank on each card. That is a
 * form, not a conversation. Now the assistant asks about the first card that
 * needs something, naming the row so it is plain which one, takes the answer
 * into that card, and moves to the next. "skip" leaves a card for its own
 * pickers; "stop" ends the questions.
 *
 * Nothing here saves anything: every answer changes a card on screen, and
 * the owner still presses Add.
 */

import { MONTH_NAMES } from "./dates";
import { applyReply, asksToRename, NAMES_A_FIELD, nextQuestion, walletInside, type Blank } from "./capture";
import type { Draft } from "./entry";
import { formatMoney } from "./money";
import type { ReferenceLists, Transaction } from "./types";

/** A card waiting for an answer, as it was when the questions began. */
export interface CardToAsk {
  readonly cardId: string;
  readonly draft: Draft;
  /**
   * Money in off a picture that is worth a question even with its kind
   * filled in (`confirmsIncome`). Cleared once it is answered.
   */
  readonly confirm?: boolean;
}

/** A credit line an answer can name: "borrowed on Maya Credit". */
export interface LineToName {
  readonly id: string;
  readonly name: string;
  /** The wallet it pays into, which picks the line when the answer names none. */
  readonly wallet?: string | undefined;
}

/**
 * Money in, read off a picture, big enough to ask about.
 *
 * 27 September 2026: two Maya Credit borrowings of PHP 2,000.00 each came
 * off the owner's Maya history as income, "Received money from \viavag
 * creqiy", because the picture's lettering did not read. Filed as Random,
 * nothing asked about them, and PHP 4,000.00 of debt became PHP 4,000.00 of
 * income. Only the owner knows what arrived: pay, an allowance, a borrowing,
 * or their own money from another account. From PHP 500.00 up, it is asked.
 */
export const ASK_ABOUT_INCOME_FROM = 50_000;

export function confirmsIncome(draft: Draft): boolean {
  return draft.flow === "Revenue" && draft.amount !== null && draft.amount >= ASK_ABOUT_INCOME_FROM;
}

/** Leave this card for its pickers and go on. */
export const SKIP_CARD = /^\s*(?:skip|next|pass|later|not now|leave it|i don'?t know|idk|not sure|di ko alam)\b/i;
/** No more questions: the rest stay on their cards. */
export const STOP_ASKING = /^\s*(?:stop|done|that'?s all|enough|no more|stop asking|ok(?:ay)? that'?s it)\b/i;

/**
 * Whether a message typed while a card's question is open is the answer.
 *
 * Not a question of its own ("how much did I spend this week?"), not an
 * instruction to do something else, and not a new entry: a figure is only
 * an answer when the question was how much. Skip and stop always are.
 */
export function looksLikeAnswer(note: string, blank: Blank): boolean {
  const text = note.trim();
  if (!text) return false;
  // "//fix this" is the owner's note to the developer, never an answer: it was booked as an item name.
  if (text.startsWith("//")) return false;
  if (SKIP_CARD.test(text) || STOP_ASKING.test(text)) return true;
  if (/\?\s*$/.test(text)) return false;
  // "Change the title", "edit the date": an instruction about the card, not the answer to its question.
  if (NAMES_A_FIELD.test(text) || asksToRename(text)) return false;
  if (/^(?:what|how|why|when|where|who|which|can|could|should|would|will|is|are|do|does|did|show|chart|graph|delete|remove|bin|restore|export|download|undo|add all|save all)\b/i.test(text)) return false;
  if (blank !== "amount" && /\d[\d,]*(?:\.\d+)?/.test(text.replace(/\b20\d{2}\b/g, ""))) return false;
  return text.split(/\s+/).length <= 12;
}

/** "20 Sep", from 2026-09-20. */
function day(iso: string): string {
  const month = MONTH_NAMES[Number(iso.slice(5, 7)) - 1] ?? "";
  return `${Number(iso.slice(8, 10))} ${month.slice(0, 3)}`;
}

/** The row in words, enough to find it in the picture: "₱1,018.00 out, TANQUI SFLU, 20 Sep". */
export function rowWords(draft: Draft): string {
  const amount = draft.amount !== null && draft.amount > 0 ? formatMoney(draft.amount) : "The row";
  const what = draft.description.trim() || draft.item.trim();
  const incoming =
    draft.flow === "Revenue" ||
    (draft.flow === "Debt" && (draft.debtEffect === "draw" || draft.debtEffect === "collect")) ||
    // Money in from another of their own accounts, not yet named.
    (draft.flow === "Transfer" && draft.toWallet.trim() !== "" && draft.fromWallet.trim() === "");
  return `${amount} ${incoming ? "in" : "out"}, ${what ? `${what}, ` : ""}${day(draft.date)}`;
}

/** Rows that one answer covers: the same kind and the same words. Empty for a row with no words. */
export function alikeKey(draft: Draft): string {
  const words = draft.description.trim().toLowerCase().replace(/\s+/g, " ");
  return words ? `${draft.flow}|${words}` : "";
}

/**
 * The question for one card, or null when it needs nothing.
 *
 * The blank comes from `nextQuestion`, so a card asks exactly what the
 * single-entry conversation would. The wording is fuller here, because the
 * row is one of many and the answer that fits is not always one of the
 * listed kinds: money that went to a person is not a kind of spending.
 */
export function cardQuestion(
  draft: Draft,
  reference: ReferenceLists,
  at: number,
  of: number,
  /** Ask about money in even when its kind is filled (`confirmsIncome`), naming these lines as answers. */
  confirm?: { readonly lines: readonly string[] },
): CardAsk | null {
  const asked = nextQuestion(draft, reference) ?? (confirm && confirmsIncome(draft) ? { blank: "item" as const, question: "" } : null);
  if (!asked) return null;
  /*
   * One short question, and the answers as buttons.
   *
   * The owner, 27 September 2026, on "(1 of 1) ₱5,000.00 out, to PNB
   * (business), 27 Sep. And which one did it go into? Cash, Gcash, Maya,
   * Allowance (Reserve), Extra Cash, Maya Bank (Personal savings), Reserved
   * Fund. Say "someone else" if it left your accounts": "fix the ui its
   * ugly ... look what to answer?". The list is buttons now, and the words
   * still work typed.
   */
  const head = rowWords(draft);
  const count = of > 1 ? `${at} of ${of}` : "";
  const accounts = [...reference.wallets, ...reference.savings];
  if (asked.blank === "item" && draft.flow === "Spending") {
    return {
      blank: "item",
      count,
      text: `${head}. What was it for?`,
      choices: [...reference.spendingTypes.slice(0, 6).map((t) => t.name), "Sent to someone"],
    };
  }
  if (asked.blank === "item" && draft.flow === "Revenue") {
    const lines = confirm?.lines ?? [];
    const filed = draft.item.trim() ? ` Filed as ${draft.item} for now.` : "";
    return {
      blank: "item",
      count,
      text: `${head}.${filed} What was it?`,
      choices: [...reference.revenueCategories.slice(0, 5), ...(lines[0] ? [`Borrowed on ${lines[0]}`] : []), "From my own account"],
    };
  }
  if (asked.blank === "toWallet" && draft.flow === "Transfer") {
    return {
      blank: "toWallet",
      count,
      text: `${head}. Where did it go?`,
      choices: ["Someone else", ...accounts.filter((a) => a !== draft.fromWallet)],
    };
  }
  if (asked.blank === "toWallet") {
    return { blank: "toWallet", count, text: `${head}. Which account did it land in?`, choices: accounts };
  }
  if (asked.blank === "fromWallet") {
    return { blank: "fromWallet", count, text: `${head}. Which account paid?`, choices: accounts.filter((a) => a !== draft.toWallet) };
  }
  return { blank: asked.blank, count, text: `${head}. ${asked.question}`, choices: [] };
}

/** A question about one card: the words, the answers to tap, and which of how many it is. */
export interface CardAsk {
  readonly blank: Blank;
  readonly text: string;
  /** Each a reply `answerCard` reads, shown as a button. */
  readonly choices: readonly string[];
  /** "2 of 5", or empty for a single card. */
  readonly count: string;
}

/** "from my own account", "that's mine": money from another of their own accounts. */
const OWN = /\b(?:my own|mine|myself|own account|my other account|sarili ko|akin yan|akin iyon)\b/i;
/** Words for money that was borrowed rather than earned. */
// "I credit it" is how the owner says it: 27 September 2026 it became an income item by that name.
const BORROWED = /\b(?:borrow(?:ed)?|loan|utang|inutang|hiniram|credit line|cash ?loan|i\s+credit(?:ed)?|credit(?:ed)?\s+(?:it|this|that))\b/i;

/** Words for money handed to someone rather than spent on something. */
const SENT = /\b(?:sent|send|padala|pinadala|gave|given|transfer(?:red)?|money send)\b/i;

/** "from my BPI", "galing sa gcash": a wallet named as where the money came from. */
function namedAsSource(text: string, wallet: string): boolean {
  const at = text.toLowerCase().indexOf(wallet.toLowerCase());
  return at > 0 && /\b(?:from|galing sa|mula sa)\s+(?:my\s+|ko\s+)?$/i.test(text.slice(0, at));
}

/**
 * An answer to a card's question, into that card.
 *
 * Mostly `applyReply`, the same reading the single-entry questions use. Two
 * answers change what the row is, because a wallet list does not say:
 *
 *   money out, "sent it to my friend" a Transfer that left the accounts
 *   money out, "sent to my gcash"     a Transfer to Gcash, still theirs
 *   money in,  "my own" or "from bpi" a Transfer from that account, not income
 *
 * Null when the answer does not fit, so the question can be put again.
 */
export function answerCard(
  draft: Draft,
  blank: Blank,
  reply: string,
  reference: ReferenceLists,
  transactions: readonly Transaction[] = [],
  lines: readonly LineToName[] = [],
): Draft | null {
  const text = reply.trim();
  if (!text) return null;
  const accounts = [...reference.wallets, ...reference.savings];

  /*
   * Money in that was borrowed: a draw on the line named, or the one line
   * that pays into this wallet, or the only line there is.
   */
  if (draft.flow === "Revenue" && lines.length > 0) {
    const named = walletInside(text, lines.map((l) => l.name));
    if (named || BORROWED.test(text)) {
      const line =
        lines.find((l) => l.name === named) ??
        (lines.length === 1 ? lines[0] : lines.find((l) => l.wallet === draft.toWallet));
      if (line) {
        return {
          ...draft,
          flow: "Debt",
          category: "",
          item: line.name,
          debtId: line.id,
          debtEffect: "draw",
          status: "Received",
          fromWallet: "",
        };
      }
    }
  }

  const wallet = walletInside(text, accounts);

  if (draft.flow === "Spending" && SENT.test(text)) {
    const toOwn = wallet && wallet !== draft.fromWallet ? wallet : "";
    return {
      ...draft,
      flow: "Transfer",
      category: "Transfer",
      item: "",
      status: "Transferred",
      toWallet: toOwn,
      sentOut: !toOwn,
    };
  }

  const fromOwn = wallet && wallet !== draft.toWallet && namedAsSource(text, wallet) ? wallet : "";
  if (draft.flow === "Revenue" && (OWN.test(text) || fromOwn)) {
    return {
      ...draft,
      flow: "Transfer",
      category: "Transfer",
      item: "",
      status: "Transferred",
      fromWallet: fromOwn,
      sentOut: false,
    };
  }

  return applyReply(draft, blank, text, reference, transactions);
}

/** What an answer changed on a card, in one line; empty when nothing did. */
export function whatChanged(before: Draft, after: Draft): string {
  if (after.flow === "Debt" && before.flow !== "Debt") {
    return `Booked as borrowing on ${after.item}${after.toWallet ? ` into ${after.toWallet}` : ""}, which is owed, not income. Add the fees the lender charged on it on the card.`;
  }
  if (after.flow === "Transfer" && before.flow !== "Transfer") {
    if (after.sentOut) return "Booked as money sent out of your accounts, so all of it counts as spent.";
    const from = after.fromWallet ? ` from ${after.fromWallet}` : "";
    const to = after.toWallet ? ` to ${after.toWallet}` : "";
    return `Booked as a transfer${from}${to}, between your own accounts, so it is neither spending nor income.`;
  }
  const said: string[] = [];
  if (after.item !== before.item && after.item) said.push(`Booked as ${after.item}.`);
  if (after.fromWallet !== before.fromWallet && after.fromWallet) said.push(`Out of ${after.fromWallet}.`);
  if (after.toWallet !== before.toWallet && after.toWallet) said.push(`Into ${after.toWallet}.`);
  if (after.sentOut && !before.sentOut) said.push("Left your accounts.");
  if (after.amount !== before.amount && after.amount !== null) said.push(`Amount ${formatMoney(after.amount)}.`);
  if (after.description !== before.description && after.description) said.push(`Description: ${after.description}.`);
  return said.join(" ");
}

/**
 * An answer to a card's question, for the model to read.
 *
 * The owner, 27 September 2026: "use ai in questions not device like ai ->
 * device". The rules here read "school" well and "I credit it" not at all:
 * it became an item called "I credit it". So the answer goes to the model
 * with the row it is about and the question it answers, as one sentence to
 * read into one row (`extractProposals`), and the device checks and applies
 * what comes back (`keepTheMoney`). These rules are what is left when no
 * model can be reached.
 */
export function cardAnswerNote(draft: Draft, question: string, reply: string): string {
  const wallet =
    draft.flow === "Revenue" || (draft.flow === "Transfer" && !draft.fromWallet)
      ? draft.toWallet && ` It came into ${draft.toWallet}.`
      : draft.fromWallet && ` It went out of ${draft.fromWallet}.`;
  const filed = [draft.flow, draft.item].filter(Boolean).join(", ");
  return [
    `One row from the owner's history, as it was read: ${rowWords(draft)}${filed ? `, read as ${filed}` : ""}.${wallet || ""}`,
    `The question was: ${question.replace(/^\(\d+ of \d+\)\s*/, "").replace(/\s*Say skip to leave one for its card, or stop\.$/, "")}`,
    `The owner answered: "${reply.trim()}"`,
    "Give that one row again as the answer says, and nothing else. Keep its date, its amount and its wallet unless the answer changes them. Borrowed on a credit line is flow Debt, debtEffect borrowed, into the wallet it came into. Money from another of their own accounts is a Transfer from that account into this wallet. Money sent or given to a person is a Transfer with toWallet empty. An answer naming what it was for picks the item from their lists.",
  ].join("\n");
}

/**
 * The model's reading of an answer, held to the row it answers.
 *
 * An answer about what a payment was for is never a reason for its amount
 * or its day to move, so both are the card's. A side the model left blank
 * keeps the card's wallet, and a transfer from a wallet into itself loses
 * its source so the card asks which account it came from.
 */
export function keepTheMoney(before: Draft, after: Draft): Draft {
  const incoming = after.flow === "Revenue" || (after.flow === "Debt" && (after.debtEffect === "draw" || after.debtEffect === "collect"));
  const wasIncoming = before.flow === "Revenue" || (before.flow === "Transfer" && !before.fromWallet && Boolean(before.toWallet));
  let next: Draft = { ...after, date: before.date, amount: before.amount };
  if (incoming && !next.toWallet) next = { ...next, toWallet: before.toWallet };
  if (!incoming && after.flow !== "Transfer" && !next.fromWallet) next = { ...next, fromWallet: before.fromWallet };
  if (after.flow === "Transfer") {
    // Money in that became a transfer arrives where it arrived; money out leaves where it left.
    if (wasIncoming && !next.toWallet) next = { ...next, toWallet: before.toWallet };
    if (!wasIncoming && !next.fromWallet) next = { ...next, fromWallet: before.fromWallet };
    if (next.fromWallet && next.fromWallet === next.toWallet) next = { ...next, fromWallet: wasIncoming ? "" : next.fromWallet, toWallet: wasIncoming ? next.toWallet : "" };
    // A transfer to nobody named is money that left the accounts, which is what the model is told an empty toWallet means.
    if (!wasIncoming && !next.toWallet) next = { ...next, sentOut: true };
  }
  return next;
}
