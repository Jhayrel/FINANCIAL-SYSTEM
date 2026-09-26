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
import { applyReply, nextQuestion, walletInside, type Blank } from "./capture";
import type { Draft } from "./entry";
import { formatMoney } from "./money";
import type { ReferenceLists, Transaction } from "./types";

/** A card waiting for an answer, as it was when the questions began. */
export interface CardToAsk {
  readonly cardId: string;
  readonly draft: Draft;
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
  if (SKIP_CARD.test(text) || STOP_ASKING.test(text)) return true;
  if (/\?\s*$/.test(text)) return false;
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
): { readonly blank: Blank; readonly text: string } | null {
  const asked = nextQuestion(draft, reference);
  if (!asked) return null;
  const head = `(${at} of ${of}) ${rowWords(draft)}.`;
  if (asked.blank === "item" && draft.flow === "Spending") {
    const kinds = reference.spendingTypes.slice(0, 5).map((t) => t.name);
    return {
      blank: "item",
      text: `${head} What was it for? ${kinds.length > 0 ? `${kinds.join(", ")} or another of yours` : "Say what it was"}, or say "sent to someone" if it went to a person.`,
    };
  }
  if (asked.blank === "item" && draft.flow === "Revenue") {
    const kinds = reference.revenueCategories.slice(0, 5);
    return {
      blank: "item",
      text: `${head} What was it? ${kinds.length > 0 ? `${kinds.join(", ")}` : "Say what it was"}, or say "my own" if it came from another of your accounts.`,
    };
  }
  return { blank: asked.blank, text: `${head} ${asked.question}` };
}

/** "from my own account", "that's mine": money from another of their own accounts. */
const OWN = /\b(?:my own|mine|myself|own account|my other account|sarili ko|akin yan|akin iyon)\b/i;
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
): Draft | null {
  const text = reply.trim();
  if (!text) return null;
  const accounts = [...reference.wallets, ...reference.savings];
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
