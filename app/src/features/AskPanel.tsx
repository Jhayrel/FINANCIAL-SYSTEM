/**
 * The assistant, beside the entry form.
 *
 * ── Two jobs, and how it works out which one you meant ────────────────────
 *
 * "How much did I spend on food" wants sentences. "I spent 500 at McDonalds"
 * wants a row. Both are typed into the same box, so the difference has to be
 * worked out rather than declared, and `domain/intent.ts` does it locally,
 * from the words, before anything is sent. Attaching a photo settles it
 * outright: a picture is always something to read.
 *
 * The guess is shown on a chip above the box, and one tap changes it. A
 * visible wrong guess you can correct beats an invisible right one, and it
 * means the wrong answer costs a tap instead of a round trip.
 *
 * This is the bug that made the feature useless: "I buy food ealier at
 * mcdonalds i spent 500" came back as "the data does not contain a record of
 * a PHP 500 food purchase", which is true, unhelpful, and precisely backwards.
 *
 * ── Reading the ledger before asking anything ─────────────────────────────
 *
 * "I spent 100 today buying load using maya" was answered with "What was it
 * for?", which the ledger could already answer: there are rows for load, they
 * have an item, a usual category, a usual wallet and a usual status.
 *
 * So `domain/infer.ts` runs first and fills what history can fill, counted,
 * with the reason shown on the card. Only what the ledger genuinely does not
 * know gets asked about.
 *
 * ── Asking rather than giving up ──────────────────────────────────────────
 *
 * "I have paid my load today" is an entry with one detail missing. It used to
 * come back as "the data does not include a figure for the load payment you
 * made today". Now it asks how much, holds what it already read, and puts the
 * card up when you answer. The answers are parsed on this device by
 * `domain/capture.ts`: reading "500" as five hundred pesos does not need a
 * model, and a round trip to be told so is a round trip wasted.
 *
 * ── The one thing it will never do ────────────────────────────────────────
 *
 * Write. There is no path from here to the database: the only writer is the
 * save handler, which runs when a person presses a button. A proposal is a
 * filled-in form that has not been submitted. Pressing Add on one runs the
 * identical `checkDraft` a typed entry runs, and the button is disabled while
 * that reports a problem, so an unreadable receipt cannot become a row by
 * being confident.
 *
 * That is a property of the wiring, not a promise in a prompt. The prompt says
 * it too, so a model asked to record something says it cannot rather than
 * pretending it did.
 *
 * ── Why the panel never grows ─────────────────────────────────────────────
 *
 * It is a fixed frame the height of the row, and everything scrolls inside it.
 * A first version stretched to fit its answer, which turned a narrow column
 * into a wall of text taller than the form beside it. A long answer, or five
 * proposals off one screenshot, changes what is in the box and never the shape
 * of the page.
 *
 * ── Why the history travels with the question ─────────────────────────────
 *
 * The endpoint keeps no conversation, on purpose: nothing accumulates on the
 * server and there is no session to leak. So a follow-up like "what about last
 * month" carries the last few turns with it, bounded, and the server still
 * treats every call as its own.
 */

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";

import { Button } from "../components/primitives";
import {
  amend,
  applyReply,
  detectAlsoIn,
  matchItem,
  nextQuestion,
  type Blank,
} from "../domain/capture";
import { readEntry, splitEntries } from "../domain/readEntry";
import { readRich } from "../domain/richText";
import {
  detectRecall,
  detectSweep,
  findRows,
  sweepRows,
  wantsDiscardAll,
  wantsDiscardOpen,
  type Candidate,
  type RecallAction,
} from "../domain/recall";
import {
  buildChart,
  chartInWords,
  chartLabel,
  isChartFollowUp,
  wantsChart,
  wantsStatement,
  type Chart,
} from "../domain/charts";
import { inferFromHistory } from "../domain/infer";
import { debtWalletDirection, itemsFor, withDebtEffect } from "../domain/entry";
import { detectIntent, isQuestion, type Intent } from "../domain/intent";
import { addressesEveryCard } from "../domain/capture";
import { modelLabel } from "../domain/modelName";
import { formatMoney } from "../domain/money";
import { describeFile, summariseFile } from "../domain/photoNote";
import { readAgainst, statementAccount } from "../domain/statement";
import {
  duplicateHeadline,
  duplicatesOf,
  repeatsWithin,
  type Duplicate,
} from "../domain/duplicates";
import { classifyItem, extractProposals, routeMessage, type Intent as Routed } from "../data/aiClient";
import { chatStore } from "../data/chatStore";
import { aiLogStore } from "../data/aiLogStore";
import { aiEvent, correctionsFrom, type AiEvent, type AttachmentNote } from "../domain/aiLog";
import { carded, cardsIn, drawn, drew, proposed, said, type StoredCard } from "../domain/chat";
import { formatBytes, readFiles, totalBytes, type Attachment } from "../data/attachments";
import { useAi } from "./useAi";
import { transactionToDraft } from "../domain/entry";
import type { Draft } from "../domain/entry";
import type { Proposal } from "../domain/proposal";
import type { Debt, DebtEffect } from "../domain/debt";
import type { Provenance } from "../domain/activity";
import { imageLimits, type AppSettings } from "../domain/settings";
import type { Budgets, DeletedTransaction, ReferenceLists, Transaction } from "../domain/types";

/**
 * What the panel is allowed to do with a proposal.
 *
 * Deliberately narrow. The panel cannot save; it can ask the form to check a
 * draft, to load one, or to save one, and every one of those is implemented
 * in `AddTransaction` with the same functions the form itself uses.
 */
export interface ProposalSink {
  readonly check: (draft: Draft) => {
    readonly ok: boolean;
    readonly problems: readonly string[];
    readonly warnings: readonly string[];
  };
  /** Put it in the form, for a correction before saving. */
  readonly use: (draft: Draft) => void;
  /**
   * Save it, through the same path a typed entry takes.
   *
   * `by` records where it came from. It defaults to the assistant, because
   * that is what this panel is, and it is a record of what happened rather
   * than a permission to do it.
   */
  readonly add: (draft: Draft, by?: Provenance) => number | null;
  /**
   * Move a row to the bin, and bring one back.
   *
   * Both are the app own handlers. A delete here is the same soft delete the
   * Database screen does: the row moves to the Bin with deletedAt set and
   * nothing is ever removed, which is what makes acting on a sentence about
   * deleting acceptable at all.
   */
  readonly bin: (id: string) => void;
  /**
   * Several at once, as one move with one record of it.
   *
   * Not a loop over `bin`. Forty rows through that is forty state updates and
   * forty toasts where the last one wins, which is how "delete all data
   * entered by ai" would report itself as having removed one row.
   */
  readonly binMany: (ids: readonly string[]) => void;
  readonly restore: (id: string) => void;
  /** The number this entry would take, shown before it is saved. */
  readonly nextRecordNumber: number;
}

interface Said {
  readonly kind: "you" | "assistant";
  readonly text: string;
  /**
   * What any attached photos turned out to be, one line each.
   *
   * The photo itself lives in `shown` and only for this session: an image is
   * never stored. On a refresh `shown` is gone and the message read as
   * somebody saying nothing about nothing, so these are what comes back in
   * its place, and they are what is written to the database.
   */
  readonly described?: readonly string[];
  /**
   * True for a line that only makes sense beside something transient.
   *
   * "One entry. Check it, then add it." and "Which one did it come out of?"
   * both refer to a card or a question that lives only in this session. The
   * lines were being stored and the cards were not, so a reload brought back
   * a conversation full of instructions pointing at nothing.
   *
   * They are still said, still read back to the model as history, and simply
   * never written down.
   */
  readonly ephemeral?: boolean;
  /** Assistant turns: which model, or that this device wrote it. */
  readonly from?: string;
  /**
   * The pictures that went with it, for this session only.
   *
   * A row of filenames tells you what you sent; the pictures show you, which
   * is the point of having sent them. Kept in memory and never written: the
   * database gets a description (`domain/aiLog.ts`), not the bytes.
   */
  readonly shown?: readonly Attachment[];
}

/**
 * Rows found by a sentence about deleting or restoring one.
 *
 * Never acted on by itself. It is a list to look at with a button beside each
 * one, because a sentence that matches three rows must not pick one, and
 * binning the wrong entry is a quiet loss even when it is recoverable.
 */
interface Found {
  readonly kind: "found";
  /**
   * `edit` loads the row into the form rather than binning it.
   *
   * The routing already recognised "edit the last one" and then handed it to
   * the finder, which only knew how to bin and restore, so the button said
   * "Move to bin" for a request to change something.
   */
  readonly action: RecallAction | "edit";
  readonly candidates: readonly Candidate[];
  /** A whole named set, so the card offers one button for all of them. */
  readonly sweep?: boolean;
  /** Ids already acted on, so a button does not offer the same row twice. */
  readonly done: readonly string[];
}

/** A chart the owner asked to see. */
interface Drawn {
  readonly kind: "chart";
  readonly chart: Chart;
}

/**
 * A debt movement, waiting on the two things nobody may guess.
 *
 * The credit line and the effect are not in a sentence, and reading either
 * wrong misfiles borrowing as income: that mistake put PHP 5,450 of borrowed
 * money into the income line for eight months. So they are chosen, not
 * inferred, and they are chosen here rather than by sending you to the form.
 */
interface DebtChoice {
  readonly kind: "debt";
  readonly draft: Draft;
  readonly state: "open" | "settled";
  /**
   * Stable across a refresh, so the record can say what became of this card.
   *
   * The array index cannot do this job: it identifies a card within one
   * render and means nothing to the next session. Every state change writes
   * a message carrying this id, and the last one wins on load.
   */
  readonly cardId: string;
}

interface Offered {
  readonly kind: "proposal";
  readonly proposal: Proposal;
  /**
   * `used` keeps the card. Sending it to the form used to replace it with one
   * line of text, so the thing you had just asked to look at disappeared at
   * the moment you asked to look at it. It stays, marked, with its buttons
   * gone.
   */
  readonly state: "open" | "added" | "used" | "discarded";
  /**
   * The number this card's row was actually given, once it has one.
   *
   * Absent while the card is open, because it does not have one yet: what is
   * shown then is a prediction, worked out from where the card sits in the
   * stack. Fixed the moment it saves, so a settled card stops following a
   * figure that has moved on to the next entry.
   */
  readonly recordNumber?: number;
  /** Stable across a refresh. See `DebtChoice.cardId`. */
  readonly cardId: string;
}

type Turn = Said | Offered | Found | Drawn | DebtChoice;

const isOffer = (t: Turn): t is Offered => t.kind === "proposal";
const isFound = (t: Turn): t is Found => t.kind === "found";
const isChart = (t: Turn): t is Drawn => t.kind === "chart";
const isDebt = (t: Turn): t is DebtChoice => t.kind === "debt";

/**
 * A turn that is actually words, said by one of us.
 *
 * ── The bug this replaces ─────────────────────────────────────────────────
 *
 * The conversation sent to the model was built by *subtracting*: everything
 * that is not a proposal, or not a proposal and not a chart. Written that way
 * it is wrong the moment a new kind of turn is added, and it was: cards,
 * charts, found lists and debt cards all carry no `text`, so they arrived as
 *
 *     found: undefined
 *     chart: undefined
 *
 * with a role the model has never been told about. That is what "it does not
 * read the chat" was. It was reading it, and half of what it read was noise
 * from this function.
 *
 * Positive, not negative. A turn is history when it is words, and a kind of
 * turn added later has to opt in rather than leak in.
 */
const isSaid = (t: Turn): t is Said => t.kind === "you" || t.kind === "assistant";

/** The conversation, as the model should see it: words, in order, no gaps. */
const spokenHistory = (turns: readonly Turn[], most: number) =>
  turns
    .filter(isSaid)
    .filter((t) => t.text.trim() !== "")
    .slice(-most)
    .map((t) => ({ role: t.kind, text: t.text }));

/**
 * How much of the thread goes back with each question.
 *
 * Enough to follow a pronoun, not so much that a long session quietly grows
 * every request until it hits the token limit.
 */
/**
 * What a stored card's message says it is.
 *
 * The encoded half is for rebuilding the card. This half is for a reader, and
 * for the model when the turn goes back as history: "Added: 2026-09-05
 * Spending Food PHP 500.00" is a fact about the ledger, where "New entry"
 * would be a fact about a form nobody can see any more.
 */
/**
 * The destination that is not an account.
 *
 * Money sent to another person leaves the accounts, which this ledger books
 * as a Money Send: the whole amount counts as spending rather than just the
 * fee. It is a choice about the row, not a wallet, so it is a label here and
 * never a value that could be mistaken for one of the owner's accounts.
 */
const SOMEONE_ELSE = "Someone else";

const CARD_WORD: Record<string, string> = {
  open: "New entry",
  added: "Added",
  used: "Sent to the form",
  discarded: "Discarded",
  settled: "Added",
};

/**
 * A card id, stable across a refresh.
 *
 * The clock plus a counter, like message ids: two cards off one statement
 * land in the same millisecond, and a collision would merge two entries into
 * one on the next load.
 */
let cards = 0;
const newCardId = (): string => {
  cards += 1;
  return `c-${Date.now()}-${cards.toString(36)}`;
};

/**
 * A stored card, back into a turn on screen.
 *
 * Defensive about what comes out of the database: this is JSON written by an
 * older build of the app, and a field that used to exist may not any more.
 * Everything missing falls back to something safe rather than throwing, since
 * one bad card must not take the whole conversation down with it.
 */
function turnFromCard(card: StoredCard): Turn {
  const draft = card.draft as unknown as Draft;

  if (card.kind === "debt") {
    return {
      kind: "debt",
      draft,
      state: card.state === "open" ? "open" : "settled",
      cardId: card.id,
    };
  }

  const state: Offered["state"] =
    card.state === "added" || card.state === "used" || card.state === "discarded"
      ? card.state
      : "open";

  return {
    kind: "proposal",
    proposal: {
      draft,
      confidence: (card.confidence as Proposal["confidence"]) ?? "medium",
      sourceRef: card.sourceRef ?? "an earlier session",
      adjustments: card.adjustments ?? [],
      ...(card.said ? { said: card.said } : {}),
    },
    state,
    cardId: card.id,
    ...(card.recordNumber === undefined ? {} : { recordNumber: card.recordNumber }),
  };
}

const HISTORY_TURNS = 6;

/** Openers, because a blank box invites nothing. */
const STARTERS = ["How is this month going?", "What needs attention?"] as const;

export function AskPanel({
  settings,
  transactions,
  budgets,
  reference,
  asOf,
  sink,
  lastSaved,
  uid,
  deleted,
  debts,
}: {
  settings: AppSettings;
  transactions: readonly Transaction[];
  budgets: Budgets;
  reference: ReferenceLists;
  asOf: string;
  sink: ProposalSink;
  /** Signed in, so the conversation has somewhere to live. Null in local mode. */
  uid: string | null;
  /** The bin, so "bring back the groceries" has somewhere to look. */
  deleted: readonly DeletedTransaction[];
  /** The credit lines, so a debt movement can be finished in the chat. */
  debts: readonly Debt[];
  /**
   * The last row the form saved.
   *
   * A card sent to the form with "Edit first" stayed reading "In the form"
   * even after you pressed Save there, so the two halves of one entry
   * disagreed about what had happened to it.
   */
  lastSaved: { draft: Draft; at: number } | null;
}) {
  /**
   * Gated on its own setting, not on the Insights panel's.
   *
   * It was reading `insightSummary`, so switching off the summary on the
   * Insights screen silently switched off the conversation here: every
   * follow-up came back with "I cannot read your question without the
   * model" while the model was perfectly available.
   */
  const ai = useAi({ settings, transactions, budgets, reference, feature: "chat", asOf });

  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  /**
   * A half-read entry and the blank being asked about.
   *
   * While this is set the box is answering a question, not starting a new
   * one, which is why the intent chip hides and the placeholder changes.
   */
  const [pending, setPending] = useState<{
    draft: Draft;
    blank: Blank;
    /** Blanks that are blank on purpose, carried so they stay unasked. */
    settled: readonly Blank[];
  } | null>(null);
  /** A file is over the panel right now. */
  const [dragging, setDragging] = useState(false);
  /**
   * Set while a request is in flight, so it can be called off.
   *
   * A free model can sit there for the better part of a minute, and watching
   * three dots with no way to stop is the app holding you hostage to a
   * provider's queue.
   */
  const stopper = useRef<AbortController | null>(null);

  /** Abandon whatever is in flight and hand the box back. */
  const stop = (): void => {
    stopper.current?.abort();
    stopper.current = null;
    setBusy(false);
    say({
      kind: "assistant",
      ephemeral: true,
      text: "Stopped. Nothing was saved.",
      from: "this device",
    });
  };
  /** An attachment being looked at full size. Session only, never stored. */
  const [previewing, setPreviewing] = useState<Attachment | null>(null);
  /** What has been corrected before, so the same guess is not made twice. */
  const [learnedItems, setLearnedItems] = useState<ReadonlyMap<string, string>>(new Map());

  /**
   * Everything the assistant did, and what was done about it.
   *
   * Separate from the activity trail, which records what happened to the
   * money. This records what happened to the assistant, including the
   * corrections it learns from. Never awaited and never able to fail a turn:
   * the answer is already on screen.
   */
  const log = (event: AiEvent): void => {
    void aiLogStore(uid).record(event).catch(() => {});
  };

  // What was corrected before, read once, so a guess already put right is
  // not made a second time.
  useEffect(() => {
    let live = true;
    aiLogStore(uid)
      .recent()
      .then((events) => {
        if (live) setLearnedItems(correctionsFrom(events, "item"));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [uid]);
  const threadRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLInputElement>(null);

  /**
   * Mark a card added once the form saves the row it supplied.
   *
   * Matched on the fields that identify an entry rather than on a token: the
   * draft may have been corrected in the form before saving, and it is still
   * the same card. The date, the amount and the item agreeing is enough, and
   * a wrong match here costs a label, never a row.
   */
  useEffect(() => {
    if (!lastSaved) return;
    const saved = lastSaved.draft;
    setTurns((prev) =>
      prev.map((t) =>
        isOffer(t) &&
        t.state === "used" &&
        t.proposal.draft.date === saved.date &&
        t.proposal.draft.amount === saved.amount &&
        t.proposal.draft.item.trim().toLowerCase() === saved.item.trim().toLowerCase()
          ? { ...t, state: "added" }
          : t,
      ),
    );
  }, [lastSaved]);

  /**
   * Escape closes the picture.
   *
   * A dialog you can only leave with the mouse is a dialog someone gets stuck
   * in, and this one covers the whole screen.
   */
  useEffect(() => {
    if (!previewing) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setPreviewing(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [previewing]);

  /**
   * Follow the conversation, unless you have scrolled up to read something.
   *
   * ── What this used to do ────────────────────────────────────────────────
   *
   * It jumped to the bottom on every change, including the ones you caused
   * while reading. The owner wrote it down: "why if I scroll up then click
   * discard and it just scroll back again in the bottom fix it". Pressing a
   * button on a card you had scrolled up to look at threw you back to the
   * end, so the result of the thing you just did was off screen.
   *
   * Near the bottom means you are following along and a new line should
   * follow you. Scrolled up means you are reading something, and the page
   * should hold still. Sixty pixels of tolerance, so a line arriving while
   * you sit at the end still counts as being at the end.
   *
   * ── Why that was not enough ─────────────────────────────────────────────
   *
   * It fixed the case where you had scrolled away, and missed the one where
   * you had not. The owner described it exactly: three cards stacked, add the
   * first, and the view lands on the third. Add the second, and the view
   * lands on the third again.
   *
   * Nothing scrolled. A card that is added loses its buttons and a card that
   * is discarded collapses to one line, so the content above the fold got
   * shorter, and a browser whose `scrollTop` is now past the end of a shorter
   * document clamps it to the new end. The view moved because the page
   * shrank underneath it, which no amount of tolerance can detect after the
   * fact: by the time the effect runs, the clamp has already happened and it
   * reads as being at the bottom.
   *
   * So the position is taken before the change instead. `hold` remembers
   * where on screen the card you pressed was sitting, and the layout effect
   * puts it back there before the browser paints. Press Add on the first of
   * three and it stays exactly where it is, saying it saved, with the second
   * card following it up the screen. Nothing jumps, and the next thing to
   * decide arrives where you are already looking.
   */
  const NEAR_BOTTOM = 60;

  /** The live card elements, by their index in `turns`. */
  const cardElements = useRef(new Map<number, HTMLDivElement>());
  /** Where the card being acted on sat, measured before the state changed. */
  const held = useRef<{ readonly index: number; readonly offset: number } | null>(null);

  /**
   * How far below the top of the thread this element starts.
   *
   * Measured off the rectangles rather than `offsetTop`, so it does not
   * depend on which ancestor happens to be positioned.
   */
  const topWithin = (el: HTMLElement, thread: HTMLElement): number =>
    el.getBoundingClientRect().top - thread.getBoundingClientRect().top;

  /**
   * Remember where a card is, so pressing a button on it does not move it.
   *
   * Called from the button, before the state update. React has not touched
   * the DOM yet at that point, so this measures what the owner can still see.
   */
  const hold = (index: number): void => {
    const thread = threadRef.current;
    const el = cardElements.current.get(index);
    if (!thread || !el) return;
    held.current = { index, offset: topWithin(el, thread) };
  };

  /**
   * A card, registering itself so it can be measured.
   *
   * Indexes are stable: a settled card keeps its place in `turns` rather than
   * being removed, which is what lets the anchor survive the very update it
   * is anchoring against.
   */
  const keepCard = (index: number, el: HTMLDivElement | null): void => {
    if (el) cardElements.current.set(index, el);
    else cardElements.current.delete(index);
  };

  useLayoutEffect(() => {
    const thread = threadRef.current;
    if (!thread) return;

    const anchor = held.current;
    held.current = null;

    if (anchor) {
      const el = cardElements.current.get(anchor.index);
      if (el) {
        thread.scrollTop = Math.max(0, thread.scrollTop + topWithin(el, thread) - anchor.offset);
        return;
      }
    }

    const distance = thread.scrollHeight - thread.scrollTop - thread.clientHeight;
    if (distance <= NEAR_BOTTOM) thread.scrollTop = thread.scrollHeight;
  }, [turns, busy]);

  /**
   * Say it, and keep it.
   *
   * Only the said turns are stored. A proposal card is a decision in
   * progress: once it is decided the entry is in the ledger and the fact that
   * the assistant read it is in the activity trail, and a card that came back
   * tomorrow would be offering to add a row that already exists.
   *
   * The write is not awaited and cannot fail the turn. The answer is on
   * screen; a failed record of it is not the reader's problem.
   */
  /**
   * A card into the record, in whatever state it is in.
   *
   * Called when a card appears and again every time it changes, because the
   * chat collection takes creates and refuses updates: the state is replayed
   * on load rather than edited in place, and the last message carrying a
   * given card id is the truth about that card.
   */
  const recordCard = (turn: Offered | DebtChoice): void => {
    const card = isOffer(turn)
      ? {
          id: turn.cardId,
          kind: "proposal" as const,
          state: turn.state,
          draft: turn.proposal.draft as unknown as Record<string, unknown>,
          sourceRef: turn.proposal.sourceRef,
          confidence: turn.proposal.confidence,
          adjustments: turn.proposal.adjustments,
          ...(turn.proposal.said ? { said: turn.proposal.said } : {}),
          ...(turn.recordNumber === undefined ? {} : { recordNumber: turn.recordNumber }),
        }
      : {
          id: turn.cardId,
          kind: "debt" as const,
          state: turn.state,
          draft: turn.draft as unknown as Record<string, unknown>,
        };

    const d = isOffer(turn) ? turn.proposal.draft : turn.draft;
    const what = isOffer(turn)
      ? `${d.date} ${d.flow} ${d.item} ${formatMoney(d.amount ?? 0)}`
      : `${d.date} Debt ${formatMoney(d.amount ?? 0)}`;

    void chatStore(uid)
      .record(proposed(card, `${CARD_WORD[card.state]}: ${what}`))
      .catch(() => {});
  };

  const say = (turn: Turn): void => {
    setTurns((prev) => [...prev, turn]);
    // Only what was said is kept. A card and a found list are decisions in
    // progress, and the entry or the bin already holds their outcome.
    /**
     * A chart is kept. A card is not.
     *
     * A card is a decision in progress, and storing one means it comes back
     * tomorrow offering to add a row that was already added. A chart is not a
     * decision, it is an answer, and asking to see the year by item only to
     * find the picture gone on the next visit loses the half of the
     * conversation that was hardest to ask for.
     *
     * The figures are stored, never an image: at most eight rows of label and
     * centavos, redrawn by the same renderer. Photos stay the one thing never
     * kept, described in the AI log with the bytes thrown away.
     */
    if (isChart(turn)) {
      void chatStore(uid)
        .record(drew(turn.chart, turn.chart.title, chartInWords(turn.chart)))
        .catch(() => {});
      return;
    }
    /**
     * A card is kept too, now, and every change to it.
     *
     * ── What changed, and why the old reasoning stopped holding ─────────
     *
     * Cards were not stored because a card is a decision in progress, and one
     * that came back tomorrow would offer to add a row already added. That
     * was right when nothing could tell the difference. It is not right now:
     * `duplicatesOf` puts a warning on any card whose row is already in the
     * ledger, naming the record and the fields that agree.
     *
     * Meanwhile the cost of not storing them was landing on the owner. Eight
     * cards read off a statement, one interruption, and a refresh threw all
     * eight away. That is lost work, not a stale decision, and they asked for
     * it to stop.
     *
     * The state is replayed rather than updated, because this collection
     * takes creates and refuses updates: settling writes a second message
     * carrying the same card id, and the last one wins. Append only is what
     * makes it a record, so it stays append only.
     */
    if (isOffer(turn) || isDebt(turn)) {
      recordCard(turn);
      return;
    }

    if (isFound(turn) || turn.ephemeral) return;

    /**
     * A message carrying photos waits until it knows what they were.
     *
     * ── Why the descriptions kept vanishing on a refresh ────────────────
     *
     * The photo is read after the message is on screen, which is right: the
     * owner sees what they sent immediately and the answer follows. But the
     * write happened here, at the moment it was said, and the descriptions
     * were attached to the turn a second or two later. So the stored message
     * had no `files` on it, and this collection is append only at the
     * database, deliberately, so the later update had nowhere to go.
     *
     * Nothing was broken about the writing or the rules. The message was
     * simply written a moment too early, every time.
     *
     * So a message with photos on it is not written here. `describeUpload`
     * writes it once the descriptions exist, which is the first moment the
     * message is complete.
     */
    if (isSaid(turn) && turn.shown && turn.shown.length > 0) return;

    void chatStore(uid)
      .record(said(turn.kind, turn.text, turn.from, turn.described))
      .catch(() => {});
  };

  /**
   * What was said last time.
   *
   * Loaded once, and only into an empty thread, so a reload picks up where
   * you left off without a conversation already in progress being pushed
   * down by its own history.
   */
  useEffect(() => {
    let live = true;
    const since = clearedAt();
    chatStore(uid)
      .recent()
      .then((all) => {
        const history = since ? all.filter((m) => m.at > since) : all;
        if (!live || history.length === 0) return;

        /**
         * Cards come back where they were, in the state they ended in.
         *
         * A card that changed wrote a second message with the same id, so
         * the final state is worked out first and the card is then emitted
         * once, at its first appearance. Without that, a card added after
         * three corrections would come back four times.
         */
        const final = cardsIn(history);

        setTurns((prev) => {
          if (prev.length > 0) return prev;
          const rebuilt: Turn[] = [];
          /**
           * Inside the updater, not outside it.
           *
           * React calls a state updater more than once in development, and it
           * must be pure. Held outside, this set was already full on the
           * second call, so every card hit the "already emitted" branch and
           * the rebuilt thread came back with none of them: the conversation
           * loaded, the cards silently did not.
           */
          const done = new Set<string>();

          for (const m of history) {
            const chart = drawn(m) as Chart | null;
            if (chart) {
              rebuilt.push({ kind: "chart", chart });
              continue;
            }

            // `carded` rather than JSON.parse: a malformed card must lose
            // that one card, not the whole conversation.
            const here = carded(m);
            const stored = here ? final.get(here.id) : undefined;
            if (stored) {
              if (done.has(stored.id)) continue;
              done.add(stored.id);
              rebuilt.push(turnFromCard(stored));
              continue;
            }

            rebuilt.push({
              kind: m.role,
              text: m.text,
              ...(m.from ? { from: m.from } : {}),
              ...(m.files && m.files.length > 0 ? { described: m.files } : {}),
            });
          }

          return rebuilt;
        });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [uid]);

  const settle = (index: number, state: Offered["state"], recordNumber?: number): void =>
    setTurns((prev) =>
      prev.map((t, i) => {
        if (i !== index || !isOffer(t)) return t;
        const next: Offered = {
          ...t,
          state,
          ...(recordNumber === undefined ? {} : { recordNumber }),
        };
        // What became of it goes into the record too, or a refresh would
        // bring an added card back offering to add the row a second time.
        recordCard(next);
        return next;
      }),
    );

  /** The card a correction would apply to: the last one still open. */
  const openCard = (): { index: number; turn: Offered } | null => {
    for (let i = turns.length - 1; i >= 0; i--) {
      const turn = turns[i];
      if (turn && isOffer(turn) && turn.state === "open") return { index: i, turn };
    }
    return null;
  };

  /** Mark one found row as dealt with, so its button does not offer twice. */
  const settleFound = (index: number, ...ids: readonly string[]): void =>
    setTurns((prev) =>
      prev.map((t, i) =>
        i === index && isFound(t) ? { ...t, done: [...t.done, ...ids] } : t,
      ),
    );

  const replaceProposal = (index: number, proposal: Proposal): void =>
    setTurns((prev) =>
      prev.map((t, i) => (i === index && isOffer(t) ? { ...t, proposal } : t)),
    );

  /**
   * Put one wallet on every open card that is missing one.
   *
   * A statement screenshot is one account, so picking the wallet eight times
   * is eight taps to say the same thing once.
   */
  const applyToAll = (source: Draft): void =>
    setTurns((prev) =>
      prev.map((t) => {
        if (!isOffer(t) || t.state !== "open") return t;
        const draft = t.proposal.draft;
        const wants = draft.flow === "Revenue" ? "toWallet" : "fromWallet";
        if (draft[wants]) return t;
        const value = source[wants];
        if (!value) return t;
        return { ...t, proposal: { ...t.proposal, draft: { ...draft, [wants]: value } } };
      }),
    );

  /** From Settings, clamped there, so a typo cannot ask for a hundred. */
  const limits = imageLimits(settings.ai);

  /**
   * Pictures already sent in this session, by fingerprint.
   *
   * ── Why the message-level check was not enough ────────────────────────
   *
   * `readFiles` refuses the same file twice in one message, which is the
   * case where three identical copies go up together. The owner hit the other
   * one: send a receipt, read the card, and send the same receipt again a few
   * minutes later in a new message. Nothing compared them, because by then
   * the first message's attachments were gone.
   *
   * Said, not refused. Re-sending a photo is often deliberate: the first read
   * came back "nothing readable" and the owner is trying again, and refusing
   * that would break the retry. What is wrong is doing it without noticing,
   * so this notices out loud and leaves the decision alone.
   */
  const sentBefore = useRef(new Map<string, string>());

  const attach = async (picked: ArrayLike<File> | null): Promise<void> => {
    if (!picked || picked.length === 0) return;
    const { attachments, rejected } = await readFiles(Array.from(picked), files, limits);

    const seenAgain = attachments.filter(
      (a) => a.digest !== undefined && sentBefore.current.has(a.digest),
    );

    if (attachments.length > 0) setFiles((prev) => [...prev, ...attachments]);
    for (const r of rejected) {
      say({ kind: "assistant", text: `${r.name}: ${r.reason}`, from: "this device" });
    }

    for (const a of seenAgain) {
      const when = a.digest ? sentBefore.current.get(a.digest) : undefined;
      say({
        kind: "assistant",
        text: `${a.name} is the same picture you sent at ${when}. Send it again if that is what you meant: anything it reads that is already in the ledger will say so on the card.`,
        from: "this device",
      });
    }
  };

  /**
   * Put a read row in front of the owner, or ask for what is missing from it.
   *
   * One question at a time: a card with three blanks on it is a form, and a
   * form is what the assistant exists to avoid.
   */
  const offer = async (
    proposal: Proposal,
    hint: string,
    useHistory = true,
    batch = false,
    settled: readonly Blank[] = [],
  ): Promise<void> => {
    /**
     * ── Step 2 of 4: what you have already corrected ────────────────────
     *
     * Every card goes through the same four steps, in this order:
     *
     *   1. ANALYSE  the model reads the sentence, or the rules do when it
     *               cannot be reached. That happens before this function.
     *   2. LEARN    your own corrections, applied here.
     *   3. GROUND   the ledger fills the blanks and Settings constrains the
     *               item, just below.
     *   4. RESULT   a card, with every field visible before anything saves.
     *
     * Step 2 was missing. `learnedItems` was consulted when you answered
     * "what was it for?" and nowhere else, so telling it once that a phrase
     * means Food did nothing at all when the model or the reader guessed the
     * item directly, which is almost every time. The whole point of keeping
     * corrections is that they outrank the next guess, and they were not.
     *
     * Only when the taught item is one the flow actually offers, so a
     * correction made against a Spending card cannot put a spending type on
     * a Revenue row.
     */
    const said = (proposal.said ?? hint).trim().toLowerCase();
    const taught = said ? learnedItems.get(said) : undefined;
    const flow = proposal.draft.flow;
    const teachable =
      taught && flow && itemsFor(flow, proposal.draft.category, reference).includes(taught);

    const start = teachable ? { ...proposal.draft, item: taught } : proposal.draft;
    const learned = teachable
      ? [`Booked as ${taught}, which is what you corrected this to last time.`]
      : [];

    /**
     * ── Step 3 of 4: the ledger, then Settings ─────────────────────────
     *
     * Asking a question the ledger already answers is the assistant failing
     * to read its own data. `readEntry` has already done this pass on the
     * offline path, so it says so rather than having it run twice.
     */
    const { draft, because } = useHistory
      ? inferFromHistory(start, transactions, reference, hint)
      : { draft: start, because: learned };
    const filled: Proposal = {
      ...proposal,
      draft,
      adjustments: [...proposal.adjustments, ...(useHistory ? [...learned, ...because] : because)],
    };

    /**
     * Debt gets its own card, whoever read it.
     *
     * An ordinary card would show a debt row with Add greyed out and no way
     * to un-grey it, because the two things it is missing are not fields the
     * card has. This is the same branch the local reader takes, so a model
     * reading "borrowed 500 from maya credit" and the rules reading it end up
     * in the same place.
     */
    if (filled.draft.flow === "Debt") {
      /**
       * A debt card is a proposal, and it was recorded as nothing.
       *
       * Five sentences about borrowing looked completely silent in the
       * record: no card, no answer, no chart. They were not silent, they
       * produced a debt card, and nothing wrote it down. That gap sent me
       * looking for a fault in the reader that was not there.
       */
      log(
        aiEvent("proposed", "add", {
          entry: `${filled.draft.date} Debt ${formatMoney(filled.draft.amount ?? 0)}`,
          text: hint,
        }),
      );
      say({ kind: "debt", draft: filled.draft, state: "open", cardId: newCardId() });
      return;
    }

    /**
     * One entry gets a question. A batch gets cards.
     *
     * A screenshot of a statement produced eight rows, four of them missing a
     * wallet, and each one set the same pending question and overwrote the
     * last: four identical "which one did it come out of" with no way to tell
     * which row any of them meant. A conversation cannot hold four questions
     * at once, and it should not try. The cards carry their own blanks, in
     * red, with a picker on each one.
     */
    /**
     * About to ask what it was for, when a model could say.
     *
     * "I paid 300 Jollibee today at Sevilla" names the thing plainly; nothing
     * local recognises it because the ledger has never seen it and no note
     * mentions it. Asking what kind of thing it is, from the owner's own
     * list, beats asking the owner a question they already answered.
     */
    let ready = filled;

    /**
     * Whatever else is missing, work out what the thing was.
     *
     * Tried whenever the item is blank rather than only when the item is the
     * next question. "I paid 300 Jollibee today at Sevilla" names no wallet,
     * so the wallet is asked about first, and waiting until after that to
     * wonder what Jollibee is means asking two questions where the ledger and
     * a model between them can answer one.
     */
    const wantsItem =
      (ready.draft.flow === "Spending" || ready.draft.flow === "Revenue") &&
      !ready.draft.item.trim();

    if (wantsItem && ready.draft.flow && !ai.disabled) {
      const known = itemsFor(ready.draft.flow, ready.draft.category, reference);
      const withNotes = known.map((name) => ({
        name,
        remark: reference.spendingTypes.find((t) => t.name === name)?.remark ?? "",
      }));
      const guessed = await classifyItem(hint, withNotes);
      if (guessed) {
        ready = {
          ...ready,
          draft: { ...ready.draft, item: guessed.item },
          adjustments: [
            ...ready.adjustments,
            `Booked as ${guessed.item}, going by what it is.`,
          ],
        };
      }
    }

    /**
     * A new spending type is worth seeing before it is saved, however the
     * entry got here: a second type that differs only in wording splits every
     * ranking that groups by item.
     */
    const itemFlow = ready.draft.flow;
    if (
      ready.draft.item.trim() &&
      (itemFlow === "Spending" || itemFlow === "Revenue") &&
      !matchItem(ready.draft.item, itemFlow, ready.draft.category, reference, learnedItems).matched
    ) {
      ready = {
        ...ready,
        adjustments: [
          ...ready.adjustments,
          `"${ready.draft.item}" is not one of your spending types. Saving this adds it as a new one.`,
        ],
      };
    }

    const asked = batch ? null : nextQuestion(ready.draft, reference, settled);

    if (!asked) {
      say({ kind: "proposal", proposal: ready, state: "open", cardId: newCardId() });
      log(
        aiEvent("proposed", "add", {
          entry: `${ready.draft.date} ${ready.draft.flow} ${ready.draft.item} ${formatMoney(ready.draft.amount ?? 0)}`,
          model: ready.sourceRef,
        }),
      );
      return;
    }
    setPending({ draft: ready.draft, blank: asked.blank, settled });
    say({ kind: "assistant", ephemeral: true, text: asked.question, from: "this device" });
  };

  /** An answer to the question the assistant just asked. */
  const answerPending = async (reply: string): Promise<void> => {
    if (!pending) return;
    say({ kind: "you", text: reply });

    const filled = applyReply(pending.draft, pending.blank, reply, reference, transactions);
    if (!filled) {
      say({
        kind: "assistant",
        text:
          pending.blank === "amount"
            ? "I could not find a figure in that. How much was it, in pesos?"
            : pending.blank === "item"
              ? "What was it for?"
              : `That is not one of your accounts. ${[...reference.wallets, ...reference.savings].join(", ")}`,
        from: "this device",
      });
      return;
    }

    const asked = nextQuestion(filled, reference, pending.settled);
    if (asked) {
      setPending({ draft: filled, blank: asked.blank, settled: pending.settled });
      say({ kind: "assistant", ephemeral: true, text: asked.question, from: "this device" });
      return;
    }

    setPending(null);
    // One more pass: an answered blank often unlocks the rest. Telling it the
    // item is Load is enough to know the wallet and the status too.
    const read = inferFromHistory(filled, transactions, reference, reply);
    let complete = read.draft;
    const because = [...read.because];

    /**
     * Nothing local recognised it. Ask what kind of thing it is.
     *
     * "Jolibee" went into the ledger as a brand new spending type, because
     * neither the ledger nor the owner's notes mention it. A model knows what
     * Jollibee is, and is given nothing but the owner's own list to choose
     * from, so the worst it can do is put a wrong type on a card that shows
     * every field before anything is saved.
     */
    if (pending.blank === "item" && complete.flow) {
      const local = matchItem(reply, complete.flow, complete.category, reference, learnedItems);
      if (!local.matched && !ai.disabled) {
        const known = itemsFor(complete.flow, complete.category, reference);
        const withNotes = known.map((name) => ({
          name,
          remark: reference.spendingTypes.find((t) => t.name === name)?.remark ?? "",
        }));
        const guessed = await classifyItem(reply, withNotes);
        if (guessed) {
          complete = { ...complete, item: guessed.item };
          because.push(`"${reply.trim()}" reads as ${guessed.item}, going by what it is.`);
        }
      }

      /**
       * Decided from the item that will actually be saved.
       *
       * An earlier version compared the item against the raw reply, so a
       * reply that only had its casing tidied ("dog" into "Dog") no longer
       * matched and the warning was skipped. What matters is whether the
       * final item is one of the owner's types, which is the question
       * `matchItem` answers.
       */
      const replyFlow = complete.flow;
      const settledItem =
        replyFlow === ""
          ? null
          : matchItem(complete.item, replyFlow, complete.category, reference, learnedItems);
      if (settledItem && !settledItem.matched) {
        because.push(
          `"${complete.item}" is not one of your spending types. Saving this adds it as a new one.`,
        );
      }
    }
    say({
      kind: "proposal",
      proposal: {
        draft: complete,
        confidence: "high",
        sourceRef: "what you told me",
        said: reply,
        adjustments: because,
      },
      state: "open",
      cardId: newCardId(),
    });
  };

  /** Read the attached files into proposals. Returns false when there were none. */
  const readAttached = async (note: string): Promise<boolean> => {
    const sent = files;
    setFiles([]);

    // Remembered on the way out, so the next message can recognise them.
    const clock = new Date().toTimeString().slice(0, 5);
    for (const f of sent) if (f.digest) sentBefore.current.set(f.digest, clock);
    // Only once: if this falls through to the question path, that path must
    // not echo the same message a second time.
    if (sent.length > 0 || note) {
      say({
        kind: "you",
        // The pictures speak for themselves; a list of filenames beside them
        // is the same information twice, in the less useful form.
        text: note,
        ...(sent.length > 0 ? { shown: sent } : {}),
      });
    }

    const control = new AbortController();
    stopper.current = control;
    const result = await extractProposals({
      note,
      attachments: sent,
      reference,
      asOf,
      signal: control.signal,
    });
    stopper.current = null;

    /**
     * The photo, as a description of itself.
     *
     * Never the bytes: a picture is a megabyte and a document is capped at
     * one. What is worth keeping is which file produced which rows, so the
     * name, what it turned out to be and what was read out of it go in, and
     * the image stays in this session and nowhere else.
     */
    if (sent.length > 0) {
      const found = result.proposals;
      const drafts = found.map((p) => p.draft);
      const notes: AttachmentNote[] = sent.map((f) => ({
        name: f.name,
        kind: f.kind === "text" ? "file" : found.length > 0 ? "receipt" : "photo",
        bytes: f.bytes,
        details: summariseFile(drafts),
      }));
      log(aiEvent("uploaded", "add", { text: note, files: notes, model: result.model ?? "" }));

      /**
       * The same description, onto the message, so it survives a refresh.
       *
       * The picture is in `shown` and lives only in this session. Written
       * beside the message it becomes the thing that comes back:
       *
       *   IMG_123.png, a receipt: Food, PHP 300.00
       *
       * One line per file, which is what the owner asked for when several
       * are sent at once.
       */
      /**
       * Written out in full, because this is what replaces the picture.
       *
       * Every row it produced, with its date, its kind, its item, its figure
       * and its wallets, plus the total and the file's own size. A few
       * hundred bytes against the megabyte the photo would have cost, and it
       * answers "which receipt was that" a month later, which the old
       * three-item summary could not.
       */
      const described = sent.map((f) => describeFile(f, drafts, asOf));
      setTurns((prev) => {
        let at = -1;
        for (let i = prev.length - 1; i >= 0; i -= 1) {
          const turn = prev[i];
          if (turn && isSaid(turn) && turn.kind === "you") {
            at = i;
            break;
          }
        }
        if (at < 0) return prev;
        return prev.map((t, i) => (i === at && isSaid(t) ? { ...t, described } : t));
      });

      /**
       * Now write it, complete, and make sure something lands either way.
       *
       * `say` deliberately skipped this message when it went up, because at
       * that moment nobody knew what the photos were and the chat collection
       * takes creates and refuses updates. This is the first point at which
       * the message is whole, so this is where it is written.
       *
       * ── Why there is a second attempt ───────────────────────────────────
       *
       * Skipping the first write made this the only one, so anything that
       * rejects it loses the message rather than just its descriptions. The
       * `files` field is the part a database rule can refuse: it is the
       * newest thing on a chat message, and rules are deployed by hand and by
       * a separate command from the app.
       *
       * So a refusal is retried without it. The owner gets a message that
       * says a picture was sent, rather than a blank bubble or nothing at
       * all, and the descriptions are the only thing lost.
       */
      void chatStore(uid)
        .record(said("you", note, undefined, described))
        .catch(() => {
          void chatStore(uid)
            .record(said("you", note || `${described.length} attached, not kept.`))
            .catch(() => {});
        });
    }

    if (result.source === "offline") {
      // A picture that could not be sent is worth saying so about. A sentence
      // that could not be sent is better answered by the question path, which
      // has its own offline reply, so this stays quiet and lets it try.
      if (sent.length > 0) {
        say({ kind: "assistant", text: result.reason ?? "Nothing came back.", from: "this device" });
      }
      return false;
    }

    if (result.proposals.length === 0 && result.refused.length === 0) {
      if (sent.length > 0) {
        say({
          kind: "assistant",
          text: "No transaction was readable in that. A clearer photo of the amount and the date usually works.",
          from: modelLabel(result.model ?? "") || "the provider",
        });
      }
      return false;
    }

    /**
     * ── The model may not return fewer entries than the sentence holds ──
     *
     * "I borrowed 2000 on maya credit into gcash, then paid 500 for food from
     * gcash, then gave 300 to my mom" is three movements of three different
     * kinds, and it came back as one debt card. The other two were dropped
     * without a word. The owner hit this six times across four sessions, and
     * every fix so far has been to a path the model was not taking.
     *
     * The rules can already see there are three, because the sentence says
     * "then" twice and each clause reads on its own. So when the local reader
     * finds strictly more parts than the model returned, the model lost
     * something and the split is used instead.
     *
     * Only for a typed sentence. A photo's contents are not in the message,
     * so there is nothing for the rules to count and nothing to compare.
     *
     * The reverse is never done: the model returning more than the rules
     * found is the model reading better, which is what it is for.
     */
    const parts =
      sent.length === 0 && note
        ? splitEntries(note).map((line) => ({
            line,
            read: readEntry(line, transactions, reference, asOf),
          }))
        : [];
    const usable = parts.filter((p) => p.read.readsAsDebt || p.read.worthOffering);

    if (usable.length > result.proposals.length && usable.length > 1) {
      say({
        kind: "assistant",
        ephemeral: true,
        text: `${usable.length} entries. Check each one, then add it.`,
        from: "this device",
      });

      for (const { line, read } of usable) {
        if (read.readsAsDebt) {
          log(
            aiEvent("proposed", "add", {
              entry: `${read.draft.date} Debt ${formatMoney(read.draft.amount ?? 0)}`,
              text: line,
            }),
          );
          say({ kind: "debt", draft: read.draft, state: "open", cardId: newCardId() });
          continue;
        }
        await offer(
          {
            draft: read.draft,
            confidence: "high",
            sourceRef: `part of what you said: ${line}`,
            said: line,
            adjustments: read.because,
          },
          line,
          false,
          true,
          read.settled,
        );
      }
      return true;
    }

    if (result.proposals.length > 0) {
      say({
        kind: "assistant",
        ephemeral: true,
        text:
          result.proposals.length === 1
            ? "One entry. Check it, then add it."
            : `${result.proposals.length} entries. Check each one, then add it.`,
        from: modelLabel(result.model ?? "") || "the provider",
      });
    }

    /**
     * ── One statement is one account, all the way down ─────────────────
     *
     * A Maya statement holding eight rows came back with Maya on the first
     * two cards and Gcash on the rest. Nothing about the picture changed
     * halfway down: the model drifted, which is what a small model does over
     * eight repetitive rows, and every drifted row is money booked against
     * the wrong wallet. That is the exact failure this reading layer exists
     * to prevent.
     *
     * The phone named the file `Screenshot_20260905_132223_Maya.jpg`. That
     * is not a guess about the contents, it is a fact the device recorded
     * when the picture was taken. Failing a name, the rows vote.
     *
     * Blanks get filled, which is what "same for all" was a button for.
     * Disagreements are flagged and left alone, because this cannot tell a
     * drift from a genuine transfer into another pocket and the owner can.
     */
    const fromOneFile = sent.length === 1 ? sent[0] : undefined;
    const account = fromOneFile
      ? statementAccount(
          fromOneFile.name,
          result.proposals.map((p) => p.draft),
          [...reference.wallets, ...reference.savings],
        )
      : "";

    const readings = readAgainst(
      account,
      result.proposals.map((p) => p.draft),
    );

    const checked = result.proposals.map((proposal, i) => {
      const reading = readings[i];
      if (!reading) return proposal;
      return {
        ...proposal,
        draft: reading.draft,
        adjustments: reading.note
          ? [...proposal.adjustments, reading.note]
          : proposal.adjustments,
      };
    });

    const odd = readings.filter((r) => r.note.includes("but reads as")).length;
    if (odd > 0) {
      say({
        kind: "assistant",
        ephemeral: true,
        text: `${odd} of these name a different account than the ${account} statement they came off. They are marked, and nothing was changed for you.`,
        from: "this device",
      });
    }

    const batch = checked.length > 1;
    for (const proposal of checked) await offer(proposal, note, true, batch);
    if (batch) {
      const blanks = result.proposals.filter(
        (p) => nextQuestion(p.draft, reference) !== null,
      ).length;
      if (blanks > 0) {
        say({
          kind: "assistant",
          ephemeral: true,
          text: `${blanks} of them need a wallet picked. Choose it on the card, or set one for all of them.`,
          from: "this device",
        });
      }
    }
    for (const refused of result.refused) {
      say({ kind: "assistant", text: refused.reason, from: "this device" });
    }
    return result.proposals.length > 0;
  };

  /** Ask a question about the figures. */
  const askQuestion = async (question: string, echo = true): Promise<void> => {
    if (echo) say({ kind: "you", text: question });

    const history = spokenHistory(turns, HISTORY_TURNS);

    const answer = await ai.ask("chat", { question, history });

    const from =
      answer.source === "model" ? modelLabel(answer.model ?? "") || "the provider" : "this device";
    say({ kind: "assistant", text: answer.text, from });
    log(aiEvent("answered", "add", { text: answer.text, model: from }));
  };

  const send = async (typed?: string, as?: Intent): Promise<void> => {
    const note = (typed ?? draft).trim();
    if (busy) return;
    if (!note && files.length === 0) return;

    /**
     * What does this message want.
     *
     * The model decides. Every branch below used to be a regular expression
     * and every one of them got things wrong: "Delete that last" found
     * nothing because "last" was stripped as filler, "how about this week"
     * was answered in prose because the chart follow-up pattern knew nothing
     * about weeks, and "edit the last one" was told the assistant cannot
     * change anything. Those are not patterns, they are sentences that mean
     * something only next to what came before them.
     *
     * `routed` is null when there is no model or it could not answer, and
     * then the local rules run exactly as they did. Wrong sometimes beats
     * absent.
     */
    let routed: { intent: Routed; target: string; period: string } | null = null;
    if (files.length === 0 && !as && !ai.disabled) {
      setBusy(true);
      try {
        routed = await routeMessage({
          text: note,
          history: spokenHistory(turns, HISTORY_TURNS),
          onScreen: {
            openCard: turns.some((t) => isOffer(t) && t.state === "open"),
            chart: turns.some(isChart),
            awaitingAnswer: pending?.blank ?? "",
          },
        });
      } finally {
        setBusy(false);
      }
    }

    /**
     * Every message, whatever it turns out to be.
     *
     * Logged here rather than down each branch, because a question, an entry,
     * a correction and an instruction to delete something all start as a
     * typed line, and a record with only the questions in it would say
     * nothing about the times this got it wrong.
     */
    if (note) log(aiEvent("asked", "add", { text: note }));

    /**
     * A line starting with "//" is a note, not an instruction.
     *
     * The owner writes them constantly while testing: "// fix this it didnt
     * know what wallet it came from", "// it should now the amount access the
     * database". One of them was read as a chart request, because it happened
     * to contain the word "shows", and answered with "No chart drawn: nothing
     * in that period", which is a reply to a question nobody asked.
     *
     * They are still recorded, and they should be: they are the clearest
     * account of what went wrong and when, written at the moment it happened.
     * They are just not commands.
     */
    if (files.length === 0 && !as && /^\s*\/\//.test(note)) {
      setDraft("");
      say({ kind: "you", text: note });
      say({
        kind: "assistant",
        text: "Noted, and kept in the record rather than acted on.",
        from: "this device",
        ephemeral: true,
      });
      /**
       * Recorded as answered, because it was.
       *
       * Coderview lists a message with no card and no answer under "Said, and
       * nothing happened", which is the list of failures worth chasing. Every
       * note the owner wrote while testing landed in it, because the reply is
       * ephemeral and nothing else was logged. Forty of the last forty lines
       * in that list were notes, so the list stopped being readable and the
       * real silences hid inside it.
       *
       * Deliberately not acting is not the same as doing nothing.
       */
      log(aiEvent("answered", "add", { text: "Noted, not acted on.", model: "this device" }));
      return;
    }

    /**
     * "discard all", before anything else looks at the sentence.
     *
     * Eleven cards came back off a screenshot of a statement and none of them
     * were wanted. Typing it did nothing, so they went one at a time: eleven
     * clicks between 09:31:27 and 09:31:48.
     *
     * First, because every branch below is about making or finding something
     * and this is about wanting none of it. Nothing is confirmed either: a
     * card has not been added to anything, so throwing one away is the
     * cheapest action in the app, and the sentence has already said so.
     */
    /**
     * "also in gcash 100000000 too": that again, somewhere else.
     *
     * Typed at 12:14:41 and 12:15:01, straight after an entry was added, and
     * both did nothing. Each was read as a fresh sentence, found nothing to
     * work with, and produced no card at all.
     *
     * Answered from the last entry actually added, not from the last card on
     * screen: "that again" means the thing that happened, and a card that was
     * rejected or is still open did not happen.
     *
     * The wallet goes on the side the flow uses, so income lands in it and
     * spending comes out of it. A new figure replaces the old one; without
     * one, the previous amount carries over, which is what "also in cash"
     * means when nothing else is said.
     */
    if (files.length === 0 && !as) {
      const also = detectAlsoIn(note, reference);
      const previous = [...turns]
        .reverse()
        .find((t): t is Offered => isOffer(t) && t.state === "added");

      if (also && previous) {
        const was = previous.proposal.draft;
        const into = was.flow === "Revenue" ? "toWallet" : "fromWallet";
        const repeated: Draft = {
          ...was,
          id: undefined,
          [into]: also.wallet,
          ...(also.amount === null ? {} : { amount: also.amount }),
        };

        setDraft("");
        say({ kind: "you", text: note });
        say({
          kind: "assistant",
          text: `The same again, ${
            was.flow === "Revenue" ? "into" : "out of"
          } ${also.wallet}${also.amount === null ? ` for ${formatMoney(was.amount ?? 0)}` : ""}.`,
          from: "this device",
          ephemeral: true,
        });
        say({
          kind: "proposal",
          proposal: {
            draft: repeated,
            confidence: "high",
            adjustments: [`Copied from the ${was.item || was.flow} entry above.`],
            sourceRef: "the entry before this one",
            said: note,
          },
          state: "open",
          cardId: newCardId(),
        });
        return;
      }
    }

    const openCards = turns.filter((t) => isOffer(t) && t.state === "open");

    /**
     * "discard", meaning the card in front of you.
     *
     * The word is in the delete list, so a bare "discard" searched the ledger
     * and offered real rows for binning. The owner wrote it down while
     * testing: "I said the word discard then it show data from database and
     * it moved to bin". One is throwing away a guess; the other is moving
     * money records out of the ledger.
     *
     * Above the finder, so the card wins whenever there is one. With no card
     * open it falls through and "discard" means the ledger again, which is
     * the only reading left.
     */
    if (openCards.length > 0 && files.length === 0 && !as && wantsDiscardOpen(note)) {
      setDraft("");
      say({ kind: "you", text: note });
      for (const card of openCards) {
        if (isOffer(card)) {
          log(
            aiEvent("rejected", "add", {
              entry: `${card.proposal.draft.date} ${card.proposal.draft.flow} ${card.proposal.draft.item}`,
              text: note,
            }),
          );
        }
      }
      setTurns((prev) =>
        prev.map((t) => (isOffer(t) && t.state === "open" ? { ...t, state: "discarded" } : t)),
      );
      say({
        kind: "assistant",
        text:
          openCards.length === 1
            ? "Thrown away. Nothing was added to the ledger, so there is nothing to undo."
            : `Thrown away, all ${openCards.length}. Nothing reached the ledger.`,
        from: "this device",
        ephemeral: true,
      });
      return;
    }

    if (openCards.length > 0 && files.length === 0 && !as && wantsDiscardAll(note)) {
      setDraft("");
      say({ kind: "you", text: note });
      for (const card of openCards) {
        if (isOffer(card)) {
          log(
            aiEvent("rejected", "add", {
              entry: `${card.proposal.draft.date} ${card.proposal.draft.flow} ${card.proposal.draft.item}`,
            }),
          );
        }
      }
      setTurns((prev) =>
        prev.map((t) => (isOffer(t) && t.state === "open" ? { ...t, state: "discarded" } : t)),
      );
      say({
        kind: "assistant",
        text: `Thrown away, all ${openCards.length} of them. Nothing was added to the ledger, so there is nothing to undo.`,
        from: "this device",
        ephemeral: true,
      });
      return;
    }

    // A starter button is always a question, whatever the box happens to say.
    /**
     * While a question is outstanding, what you type is the answer to it. An
     * attachment overrides that: a picture is a new thing to read, not a
     * reply, so the half-finished row is dropped rather than confused with it.
     */
    /**
     * Two places the model is reliably wrong, and the local rule is not.
     *
     * The instruction says to prefer these, and it still picks `question`
     * and `chat` for them, so it is overruled here rather than argued with.
     * Both overrides are narrow enough to be safe: they only fire when the
     * model chose the one intent that ends the conversation in prose, and
     * only when a precise local rule fires as well.
     *
     * 1. "Delete that last", then "edit the last cata", were answered with
     *    "I cannot add, change or delete anything here." That is not a
     *    misreading, it is the assistant denying something it can do: both
     *    those sentences have buttons waiting behind them.
     *
     * 2. "how about this month", "also in this month", "i want pie", each
     *    straight after a chart, were answered in prose. `isChartFollowUp`
     *    is deliberately strict: a short fragment, naming a period, with no
     *    question word in it, and a chart already on screen.
     */
    const modelGaveUp = routed?.intent === "question" || routed?.intent === "chat";
    const localRecall = modelGaveUp && files.length === 0 && !as ? detectRecall(note) : null;

    const saysAnswer = routed?.intent === "answer";
    const saysCorrection = routed?.intent === "correction";

    if (pending && files.length === 0 && !as && (routed === null || saysAnswer || saysCorrection)) {
      setDraft("");
      setBusy(true);
      try {
        await answerPending(note);
      } finally {
        setBusy(false);
      }
      return;
    }

    /**
     * "show me a chart of this month".
     *
     * Drawn here, from figures added up in TypeScript. A chart is a claim
     * about money, and a wrong bar is a wrong figure drawn large, so no model
     * is involved in the arithmetic or in choosing what to draw.
     */
    /**
     * A chart, or the same chart over a different window.
     *
     * "How about this month?" straight after a chart was answered in prose,
     * which is reading the words and ignoring the conversation. A short
     * message naming a period, with a chart already on screen, is asking for
     * that chart again.
     */
    /**
     * "give me a pdf of my financial status this month".
     *
     * It cannot produce a file and says so correctly. What it did not do was
     * say where one lives: Statements is the printable view of a month, and
     * a flat no is a worse answer than a pointer.
     *
     * Said first, then the question is answered normally, so the figures
     * still arrive rather than being replaced by a signpost.
     */
    if (files.length === 0 && !as && wantsStatement(note)) {
      say({ kind: "you", text: note });
      say({
        kind: "assistant",
        text: "I cannot make a file here. The Statements screen is the printable month, so open that and print it to PDF from your browser. Here is what it would say:",
        from: "this device",
        ephemeral: true,
      });
      log(aiEvent("answered", "statements", { text: `Pointed at Statements for: ${note}` }));
      setDraft("");
      setBusy(true);
      try {
        await askQuestion(note, false);
      } finally {
        setBusy(false);
      }
      return;
    }

    const followUp = isChartFollowUp(note, turns.some(isChart));
    const saysChart = routed?.intent === "chart";
    if (
      files.length === 0 &&
      !as &&
      (saysChart ||
        (routed === null && (wantsChart(note) || followUp)) ||
        // The model said prose; a chart is on screen and this names a period.
        (modelGaveUp && followUp) ||
        // "i want pie", "pie chart": asking to see it, however it was routed.
        (modelGaveUp && wantsChart(note)))
    ) {
      /**
       * The period the model read out of it, if it read one.
       *
       * "how about this week" was answered in prose because no pattern here
       * knew about weeks. The model names the window in the owner's own
       * words and `buildChart` reads that, so the vocabulary is theirs and
       * not a list somebody remembered to write down.
       */
      /**
       * A follow-up narrows the chart on screen, it does not replace it.
       *
       * "chart my treats from may to august" then "treat only" drew Treat
       * across September, because the second message named no period and
       * fell back to this month. The window was on screen a second earlier
       * and the follow-up threw it away.
       *
       * So the previous chart's own title is carried into the question. It
       * already holds the period in words ("May 2026 to August 2026"), which
       * is exactly what `windowOf` reads, so the window survives and only
       * what the new message says changes.
       */
      const shown = [...turns].reverse().find(isChart)?.chart;
      const carried =
        shown && !/\b(20\d{2}|january|february|march|april|may|june|july|august|september|october|november|december|month|year|week|today|yesterday|all|everything)\b/i.test(
          note,
        )
          ? `${note} ${shown.title}`
          : note;

      const chart = buildChart(
        routed?.period ? `${carried} ${routed.period}` : carried,
        transactions,
        asOf,
      );
      setDraft("");
      say({ kind: "you", text: note });
      /**
       * Both outcomes are recorded, and that is the point of recording it.
       *
       * `asked` caught the question and nothing caught the answer, so the
       * record could not say whether a chart request had produced a chart or
       * fallen through to prose. That gap is most of what made the follow-up
       * faults hard to find: the failures looked identical to the successes.
       */
      if (chart) {
        say({ kind: "chart", chart });
        log(
          aiEvent("answered", "add", {
            text: `Drew ${chart.title}. ${chartInWords(chart)}`,
            entry: chart.title,
          }),
        );
      } else {
        say({
          kind: "assistant",
          text: "There is no spending in that period to draw. Try a month with entries in it, or ask for the year.",
          from: "this device",
        });
        log(
          aiEvent("answered", "add", {
            text: `No chart drawn: nothing in that period. Asked: ${note}`,
          }),
        );
      }
      return;
    }

    /**
     * "delete the data I created yesterday about the groceries".
     *
     * Finds and shows; it never bins anything by itself. A sentence that
     * matches three rows must not pick one, so the rows come back as a list
     * with a button beside each, and a sentence that matches nothing says so
     * rather than offering the ledger sorted arbitrarily.
     */
    const saysRecall =
      routed?.intent === "delete" || routed?.intent === "restore" || routed?.intent === "editEntry";
    const recall =
      files.length > 0 || as
        ? null
        : saysRecall
          ? {
              action: (routed?.intent === "restore"
                ? "restore"
                : routed?.intent === "editEntry"
                  ? "edit"
                  : "bin") as RecallAction | "edit",
              phrase: routed?.target || note,
            }
          : routed === null
            ? detectRecall(note)
            : localRecall;

    if (recall) {
      const pool = recall.action === "restore" ? deleted : transactions;

      /**
       * A whole set named at once: "delete all data entered by ai".
       *
       * Asked three times in three minutes and answered "no entry matches
       * that" each time, because the finder below is built to pick one row
       * out of many and this names all of them. `entrySource` is written on
       * every row when it is saved, so the answer is already in the data.
       *
       * Offered, never done. It is the largest delete in the app and it
       * still goes through the same buttons as every other one: the rows are
       * listed with what they add up to, and nothing moves until it is
       * pressed.
       */
      const sweep = recall.action === "bin" ? detectSweep(recall.phrase) : null;
      if (sweep) {
        const found = sweepRows(sweep, pool);
        setDraft("");
        say({ kind: "you", text: note });

        if (found.length === 0) {
          say({
            kind: "assistant",
            text: "Nothing in the ledger is marked as entered by me, so there is nothing to remove. Rows saved before I existed carry no source, and I leave those alone.",
            from: "this device",
          });
          return;
        }

        say({
          kind: "assistant",
          text: `${found.length} ${found.length === 1 ? "row is" : "rows are"} marked ${
            sweep.label
          }, totalling ${formatMoney(found.reduce((sum, r) => sum + r.total, 0))}. They are listed below. Nothing moves until you press the button, and everything goes to the bin, where it can be restored.`,
          from: "this device",
        });
        say({
          kind: "found",
          action: "bin",
          candidates: found.map((row) => ({ row, score: 100, why: [sweep.label] })),
          done: [],
          sweep: true,
        });
        return;
      }

      /**
       * "the last one" means the most recent, not a word to search for.
       *
       * "Delete that last" came back with "No entry matches that", because
       * "last" was stripped as a filler word and the search was left with
       * nothing to look for. It is not filler: it is the whole instruction.
       */
      const wantsLatest = /^(last|the last|that last|latest|most recent|it)$/i.test(
        recall.phrase.trim(),
      );
      const candidates = wantsLatest
        ? [...pool]
            .sort((a, b) => b.recordNumber - a.recordNumber)
            .slice(0, 1)
            .map((row) => ({ row, score: 100, why: ["the most recent one"] }))
        : findRows(recall.phrase, pool, asOf);

      setDraft("");
      say({ kind: "you", text: note });

      if (candidates.length === 0) {
        say({
          kind: "assistant",
          text:
            recall.action === "restore"
              ? `Nothing in the bin matches that. There ${deleted.length === 1 ? "is 1 entry" : `are ${deleted.length} entries`} in it.`
              : "No entry matches that. Naming the day, the item or the amount is usually enough, or give the record number.",
          from: "this device",
        });
        return;
      }

      say({ kind: "found", action: recall.action, candidates, done: [] });
      return;
    }

    /**
     * A correction to the card already showing.
     *
     * "make it 300" was being read as a new question and answered with a
     * summary of the month. There is a card on screen with an amount on it,
     * and that is what "it" refers to.
     *
     * Only for a message that is not itself an entry. "I paid my debt
     * yesterday 2950 using maya" mentions a wallet, and without this guard it
     * silently changed the wallet on an unrelated card instead of being read
     * as the new entry it is. A correction is "gcash", "food", "make it 300":
     * no verb, nothing that happened, which is exactly what `detectIntent`
     * already calls a question.
     */
    if (files.length === 0 && !as && detectIntent(note) === "ask") {
      /**
       * "edit them 2026 and make also I use maya to all".
       *
       * A screenshot of a statement makes one card per line, all from the
       * same account and often all needing the same year, and both of the
       * sentences above say so plainly. Each changed exactly one card: the
       * record holds a single correction for that whole session, against
       * eleven cards on screen.
       *
       * The amendment is worked out per card rather than copied, because
       * "2026" means a different date on each one: the year changes and the
       * day does not. A card the sentence does not apply to is left alone,
       * so a wallet correction never touches a card that already has one.
       */
      const everyCard = turns.flatMap((t, index) =>
        isOffer(t) && t.state === "open" ? [{ index, turn: t }] : [],
      );
      if (everyCard.length > 1 && addressesEveryCard(note)) {
        const changed = everyCard.flatMap((c) => {
          const change = amend(c.turn.proposal.draft, note, reference, asOf);
          return change ? [{ ...c, change }] : [];
        });

        if (changed.length > 0) {
          setDraft("");
          const touched = new Set(changed.map((c) => c.index));
          for (const c of changed) {
            log(
              aiEvent("edited", "add", {
                field: "several",
                proposed: `${c.turn.proposal.draft.date} ${c.turn.proposal.draft.fromWallet}`,
                corrected: `${c.change.draft.date} ${c.change.draft.fromWallet}`,
                entry: `${c.change.draft.date} ${c.change.draft.flow} ${c.change.draft.item}`,
              }),
            );
          }
          setTurns((prev) => [
            ...prev.filter((_, i) => !touched.has(i)),
            { kind: "you", text: note },
            {
              kind: "assistant",
              text: `Changed on all ${changed.length}: ${changed[0]?.change.what ?? ""}`,
              from: "this device",
              ephemeral: true,
            },
            // The same cards, corrected. They keep their ids, so the record
            // shows one card that changed rather than a second card.
            ...changed.map((c) => ({
              kind: "proposal" as const,
              proposal: {
                ...c.turn.proposal,
                draft: c.change.draft,
                adjustments: [...c.turn.proposal.adjustments, c.change.what],
              },
              state: "open" as const,
              cardId: c.turn.cardId,
            })),
          ]);
          return;
        }
      }

      const card = openCard();
      if (card) {
        const change = amend(card.turn.proposal.draft, note, reference, asOf);
        if (change) {
          setDraft("");
          /**
           * The old card goes, and the corrected one arrives at the bottom.
           *
           * Changing the card in place worked and looked like nothing had
           * happened: the card sits above the message that changed it, so
           * the one field that moved was off screen. Leaving a collapsed
           * stub behind was not much better, because two versions of one
           * entry on screen is one more than there are. So the order reads
           * as the conversation did:
           *
           *   what you said, then the entry as it now stands.
           */
          /**
           * The training signal.
           *
           * What was proposed and what it became, as a pair. Read back by
           * `correctionsFrom`, so telling it once that a word means Food is
           * enough: it does not ask a second time. This is the whole of what
           * "learning" means here, and it is a table of your own corrections
           * in your own database.
           */
          const was = card.turn.proposal.draft;
          const now = change.draft;

          /**
           * Learned under the words that produced the card, not the value it
           * guessed.
           *
           * Keying on the guess taught "gas is Food" after one correction,
           * and applying that would have turned every future Gas entry into
           * Food. What the correction actually says is that the sentence
           * meant Food, so the sentence is the key, and a phrase that is
           * itself one of the owner's item names is never learned from.
           */
          const phrase = (card.turn.proposal.said ?? "").trim();
          const teaches =
            phrase.length > 0 &&
            phrase.length <= 80 &&
            !matchItem(phrase, now.flow || "Spending", now.category, reference).matched;

          for (const field of ["item", "fromWallet", "toWallet"] as const) {
            if (was[field] === now[field] || !now[field]) continue;
            if (field === "item" && !teaches) continue;
            log(
              aiEvent("edited", "add", {
                field,
                proposed: field === "item" ? phrase : was[field],
                corrected: now[field],
                entry: `${now.date} ${now.flow} ${now.item}`,
              }),
            );
          }
          if (was.amount !== now.amount || was.date !== now.date) {
            log(
              aiEvent("edited", "add", {
                field: was.amount !== now.amount ? "amount" : "date",
                proposed: was.amount !== now.amount ? formatMoney(was.amount ?? 0) : was.date,
                corrected: was.amount !== now.amount ? formatMoney(now.amount ?? 0) : now.date,
              }),
            );
          }

          setTurns((prev) => [
            ...prev.filter((_, i) => i !== card.index),
            { kind: "you", text: note },
            {
              kind: "proposal",
              proposal: {
                ...card.turn.proposal,
                draft: change.draft,
                adjustments: [...card.turn.proposal.adjustments, change.what],
              },
              state: "open",
              // The same card, corrected, so it keeps its id.
              cardId: card.turn.cardId,
            },
          ]);
          return;
        }
      }
    }
    if (files.length > 0) setPending(null);

    /**
     * Try reading it as an entry unless it is plainly a question.
     *
     * `detectIntent` decides from the words alone, so it called "I gas today
     * usual ammount cash" a question: no verb in it. The reader has the
     * ledger and recognises Gas and Cash at once, and running it costs
     * nothing, so anything that is not phrased as a question gets offered to
     * it first and falls through to the conversation if it finds nothing.
     */
    /**
     * Entry or question, decided by the model when there is one.
     *
     * `chat` and `question` both mean answer it in words; everything else
     * that reaches this line is something to record. The local rules only
     * decide when no model could be reached.
     */
    /**
     * An entry the model called a question is still an entry.
     *
     * "I withdraw also 5000 and the fee is 18 maya to cash" at 09:36:57
     * produced no card. Nor did "maya to cash" ten seconds later, nor "I
     * withdraw" eight seconds after that. What came back at 09:38:17 was a
     * paragraph about a different withdrawal from two weeks earlier. Three
     * attempts, twenty seconds, no entry.
     *
     * That sentence is money that moved, said in the past tense, with an
     * amount and both wallets in it. `worthOffering` is the conservative
     * test for exactly that, and it is not satisfied by a question: it wants
     * a flow verb and a figure, and `isQuestion` vetoes it besides.
     *
     * So the model's `question` is overruled here in the same narrow way as
     * the chart and delete overrides above: only when it chose prose, and
     * only when a strict local rule disagrees. Being shown a card that can
     * be discarded is a smaller failure than being told about the wrong
     * withdrawal three times.
     */
    const readsAsEntry =
      modelGaveUp &&
      files.length === 0 &&
      !as &&
      !isQuestion(note) &&
      readEntry(note, transactions, reference, asOf).worthOffering;

    const job =
      as ??
      (files.length > 0
        ? "log"
        : readsAsEntry
          ? "log"
          : routed
            ? routed.intent === "question" || routed.intent === "chat"
              ? "ask"
              : "log"
            : !isQuestion(note)
              ? "log"
              : detectIntent(note));

    setDraft("");
    setBusy(true);
    try {
      if (job === "ask") {
        await askQuestion(note);
        return;
      }

      /**
       * This device first.
       *
       * `readEntry` reads the sentence against the owner's own ledger, which
       * is instant, free, works with the model off or rate limited, and is
       * better than a free model at this particular job because it is reading
       * data rather than guessing at English. The model is called only when
       * this finds too little, which is mostly photos.
       */
      /**
       * Several lines, several entries.
       *
       * Shift plus Enter makes a message like:
       *
       *   I pay 100
       *   I paid gas 200
       *
       * Each line is its own row. Only when every line reads as one: a single
       * line that happens to wrap, or a question with a line break in it,
       * stays one message and goes down the ordinary path.
       */
      /**
       * Line breaks, and the words that do the same job in a paragraph.
       *
       * "Transfer 1000 to my firend maya payment for things I bought and also
       * add spending treat food 1000 paid gcash and also I paid my spotify
       * and globe at home for next month" is four things, typed as one line,
       * and it made one row. Splitting only ever looked at line breaks.
       *
       * Splitting liberally is safe because of the test below: a piece is
       * kept only when it reads as an entry on its own, so "I paid 250 for
       * gas and food" splits, fails, and goes back to being one message. The
       * cost of a wrong split is a discarded guess, not a wrong row.
       */
      if (files.length === 0) {
        const local = readEntry(note, transactions, reference, asOf);

        /**
         * Borrowing and repaying go to the form, always.
         *
         * A debt row needs the credit line and whether it is a draw, a
         * repayment, interest or a write-off. Neither is in a sentence, and
         * reading either wrong misfiles borrowing as income, which is the
         * mistake this whole app was built to stop.
         */
        /**
         * Only when the whole sentence is the debt movement.
         *
         * "I acquire a debt at maya credit 5000 to be paid soon, I received
         * that in maya, then I transferred 2000 of it to gcash with 15 fee"
         * contains the word debt, so this gate matched, showed one debt card
         * and returned. The transfer at the end was dropped without a word.
         * The owner hit it five times across three sessions.
         *
         * A sentence that splits into two usable parts is not one movement,
         * whatever words it contains, so it goes to the splitter below and
         * each part gets what it needs: a debt card for the borrowing, an
         * ordinary card for the transfer.
         */
        const parts = splitEntries(note).map((line) =>
          readEntry(line, transactions, reference, asOf),
        );
        const severalParts =
          parts.length > 1 &&
          parts.filter((r) => r.readsAsDebt || r.worthOffering).length > 1;

        if (local.readsAsDebt && !severalParts) {
          say({ kind: "you", text: note });
          /**
           * Finished here, not by being sent to the form.
           *
           * The two things missing are the credit line and the effect, and
           * neither is in a sentence: reading either wrong misfiles borrowing
           * as income. They are the one part of an entry that has to be
           * chosen rather than inferred, so they are offered as buttons and
           * the rest of the row is already filled in.
           */
          say({
            kind: "assistant",
            text: `That reads as debt. I have filled in ${
              local.draft.amount !== null ? "the amount" : "what the sentence gave"
            }, the wallet and the date. Pick which credit line it belongs to and what it does, then add it: those two are not in a sentence, and reading either wrong turns borrowing into income.`,
            from: "this device",
            ephemeral: true,
          });
          log(
            aiEvent("proposed", "add", {
              entry: `${local.draft.date} Debt ${formatMoney(local.draft.amount ?? 0)}`,
              text: note,
            }),
          );
          say({ kind: "debt", draft: local.draft, state: "open", cardId: newCardId() });
          return;
        }

        /**
         * ── Step 1 of 4: the model reads it, unless it cannot ──────────────
         *
         * The rules used to go first for anything with more than one part in
         * it, and the model was never asked at all. So "I transfer 1000 to
         * cash 15 fee then use that 1000 to pay my food today" was split by
         * pattern rather than read for meaning, and the reply was "you give
         * wrong entry fix this".
         *
         * The order is now the one that was asked for: analyse, then apply
         * what was learned, then ground it in the ledger and Settings, then
         * show the result. The rules are the floor underneath, for a model
         * that is switched off or rate limited, not the first opinion.
         *
         * Debt is the one exception and it is above this line: it never
         * reaches a model, because the credit line and the effect are not in
         * a sentence and reading either wrong turns borrowing into income.
         */
        /**
         * One sentence, one card, even when it was three payments.
         *
         * This shortcut existed so a switched-off model still records an
         * entry, and it returned before the splitter below ever ran. So with
         * the model off, "I paid 500 for food from gcash, then 300 for gas
         * from cash, then 250 for fun from maya" produced a single PHP 500
         * card and the other two payments were dropped in silence: the same
         * class of failure as the debt sentence above, from the same cause,
         * a gate that matched the whole message when the message was several.
         *
         * `severalParts` is already worked out above for the debt gate, so
         * both gates now stand down for the same reason and the splitter gets
         * what it was written for.
         */
        if (ai.disabled && local.worthOffering && !severalParts) {
          say({ kind: "you", text: note });
          await offer(
            {
              draft: local.draft,
              confidence: "high",
              sourceRef: "read on this device",
              said: note,
              adjustments: local.because,
            },
            note,
            false,
            false,
            local.settled,
          );
          return;
        }
      }

      /**
       * Read it as an entry, and answer it as a question if there was no
       * entry in it after all.
       *
       * "I paid Maya 500" and "I paid too much for Maya" are one word apart,
       * and a guess that costs a wrong answer is worse than one that quietly
       * tries the other job.
       */
      const found = await readAttached(note);
      if (found || files.length > 0 || !note) return;

      /**
       * The model could not be reached. Try the rules rather than give up.
       *
       * Only now, and only for a sentence: with no key, or every provider
       * rate limited, a rough reading of "I paid 300 for gas" beats telling
       * someone their entry cannot be recorded because a provider is busy.
       */
      /**
       * The model could not be reached, so the rules take over, and only
       * here. Several parts in one sentence are split by pattern at this
       * point, which the model does for itself when it is available.
       */
      const lines = splitEntries(note);

      if (files.length === 0 && lines.length > 1) {
        const each = lines.map((line) => readEntry(line, transactions, reference, asOf));

        /**
         * A sentence can be part debt and part not, and it was all or nothing.
         *
         * "I acquire a debt at maya credit 5000 to be paid soon, I received
         * that in maya, then I transferred 2000 of it to gcash with 15 fee"
         * splits into a debt clause, a fragment, and a transfer. The debt
         * clause cannot be offered as an ordinary card, `every` was therefore
         * false, and the whole split was thrown away: the transfer went with
         * it and the owner got one card instead of two. They hit this five
         * times across three sessions.
         *
         * A part is usable when it is a debt movement or reads as an entry.
         * Two usable parts is a real split; one is a sentence that happens to
         * contain the word "then". Fragments in between are skipped and said
         * out loud, rather than taking the rest down with them.
         */
        const usable = each.filter((r) => r.readsAsDebt || r.worthOffering);

        if (usable.length > 1) {
          const skipped = lines.filter((_, i) => {
            const r = each[i];
            return r ? !r.readsAsDebt && !r.worthOffering : true;
          });

          for (const [i, r] of each.entries()) {
            if (r.readsAsDebt) {
              log(
                aiEvent("proposed", "add", {
                  entry: `${r.draft.date} Debt ${formatMoney(r.draft.amount ?? 0)}`,
                  text: lines[i] ?? "",
                }),
              );
              say({ kind: "debt", draft: r.draft, state: "open", cardId: newCardId() });
              continue;
            }
            if (!r.worthOffering) continue;
            await offer(
              {
                draft: r.draft,
                confidence: "high",
                sourceRef: `part ${i + 1}: ${lines[i] ?? ""}`,
                said: lines[i] ?? "",
                adjustments: r.because,
              },
              lines[i] ?? "",
              false,
              true,
              r.settled,
            );
          }

          if (skipped.length > 0) {
            say({
              kind: "assistant",
              text: `I could not make an entry out of ${skipped
                .map((line) => `"${line}"`)
                .join(" or ")}. Say it again on its own if it was one.`,
              from: "this device",
              ephemeral: true,
            });
          }
          return;
        }

        if (each.every((r) => r.worthOffering)) {
          // No echo: `readAttached` above already put the message on screen
          // before it tried the model. Saying it again here printed it twice.
          for (const [i, r] of each.entries()) {
            await offer(
              {
                draft: r.draft,
                confidence: "high",
                sourceRef: `line ${i + 1}: ${lines[i] ?? ""}`,
                said: lines[i] ?? "",
                adjustments: r.because,
              },
              lines[i] ?? "",
              false,
              true,
              r.settled,
            );
          }
          return;
        }
      }


      const offline = readEntry(note, transactions, reference, asOf);
      if (offline.worthOffering) {
        await offer(
          {
            draft: offline.draft,
            confidence: "low",
            sourceRef: "read on this device, without the model",
            said: note,
            adjustments: [
              ...offline.because,
              "The model could not be reached, so this was read here. Check it more carefully than usual.",
            ],
          },
          note,
          false,
          false,
          offline.settled,
        );
        return;
      }

      await askQuestion(note, false);
    } finally {
      setBusy(false);
    }
  };

  /** Cards still waiting on a decision, and how many of those could save. */
  const open = turns.filter((t): t is Offered => isOffer(t) && t.state === "open");
  const openCount = open.length;
  const readyCount = open.filter((t) => sink.check(t.proposal.draft).ok).length;

  /**
   * Have I got this one already.
   *
   * ── The failure this answers ────────────────────────────────────────────
   *
   * The owner uploads a receipt, reads the card, and later uploads the same
   * receipt again. The record has it three times over: one message carrying
   * three byte-identical copies of the same screenshot, another carrying two,
   * every one of them read separately into an identical PHP 1,447.90 card,
   * and nothing anywhere saying they were the same picture. The only thing
   * standing between the ledger and three identical rows was the owner
   * noticing.
   *
   * Two different checks, because there are two ways to end up with the same
   * row twice:
   *
   *   `alreadyInLedger`  it is already saved, from an earlier upload.
   *   `repeatOfCard`     it is not saved yet, but the card above says it too.
   *
   * Neither one blocks anything. A duplicate warning that refused to save
   * would be wrong the first time the owner genuinely bought the same lunch
   * twice, and CLAUDE.md is explicit that an integrity check reports and
   * never corrects. So both of these carry their evidence and leave the
   * decision alone.
   *
   * Recomputed only when the cards or the ledger move, since it is a pass
   * over every transaction per open card.
   */
  const alreadyInLedger = useMemo(() => {
    const found = new Map<number, readonly Duplicate[]>();
    turns.forEach((t, i) => {
      if (!isOffer(t) || t.state !== "open") return;
      const matches = duplicatesOf(t.proposal.draft, transactions);
      if (matches.length > 0) found.set(i, matches);
    });
    return found;
  }, [turns, transactions]);

  /**
   * The earlier card a card repeats, as the entry it holds.
   *
   * Its position was the obvious thing to carry, and it was the wrong thing:
   * settled cards stay in the thread, so "the second card" counts one way in
   * the code and another way on screen. The entry itself cannot be
   * miscounted, and it is evidence rather than a reference.
   */
  /**
   * The number each open card would get, counting the ones above it.
   *
   * Three cards in a batch all printed the same figure, and a card that had
   * already saved went on printing whatever was next rather than what it got.
   * Both came from reading `sink.nextRecordNumber` at render time, which is a
   * live value about the future and not a fact about the card.
   */
  const predictedNumber = useMemo(() => {
    const byTurn = new Map<number, number>();
    let ahead = 0;
    turns.forEach((t, i) => {
      if (!isOffer(t) || t.state !== "open") return;
      byTurn.set(i, sink.nextRecordNumber + ahead);
      ahead += 1;
    });
    return byTurn;
  }, [turns, sink.nextRecordNumber]);

  const repeatOfCard = useMemo(() => {
    const indexes: number[] = [];
    turns.forEach((t, i) => {
      if (isOffer(t) && t.state === "open") indexes.push(i);
    });
    const drafts = indexes.map((i) => (turns[i] as Offered).proposal.draft);
    const byTurn = new Map<number, Draft>();
    for (const [later, earlier] of repeatsWithin(drafts)) {
      const at = indexes[later];
      const twin = drafts[earlier];
      if (at !== undefined && twin) byTurn.set(at, twin);
    }
    return byTurn;
  }, [turns]);

  /**
   * Add every card that would save, and leave the rest showing.
   *
   * One pass over the list rather than one setState per card, so eight rows
   * are one render and one batch of writes rather than eight of each.
   */
  const addReady = (): void => {
    // Each card keeps the number its own row was given. Reading the next one
    // afterwards showed every card in the batch the same figure.
    const given = new Map<number, number | null>();
    turns.forEach((t, i) => {
      if (isOffer(t) && t.state === "open" && sink.check(t.proposal.draft).ok) {
        given.set(
          i,
          sink.add(t.proposal.draft, {
            actor: "ai",
            via: t.proposal.sourceRef.toLowerCase().includes("image") ? "ai_image" : "ai_chat",
          }),
        );
      }
    });
    setTurns((prev) =>
      prev.map((t, i) => {
        if (!given.has(i) || !isOffer(t)) return t;
        const number = given.get(i);
        return {
          ...t,
          state: "added" as const,
          ...(number === null || number === undefined ? {} : { recordNumber: number }),
        };
      }),
    );
  };

  const discardOpen = (): void =>
    setTurns((prev) =>
      prev.map((t) => (isOffer(t) && t.state === "open" ? { ...t, state: "discarded" } : t)),
    );

  const attached = files.length > 0;
  const weight = totalBytes(files);

  /**
   * A picture is always something to read. Otherwise the words decide.
   *
   * There used to be a chip here offering to change it. It appeared and
   * vanished as you typed, it was tiny, and it asked you to make a decision
   * the app can make on its own. So it decides, and when it decides wrong it
   * corrects itself: see the fallback in `send`.
   */
  const intent: Intent = attached ? "log" : detectIntent(draft);

  return (
    /**
     * Dropping and pasting, as well as the button.
     *
     * A screenshot is almost always already on the clipboard, and dragging one
     * from a folder is how anyone would try first. Both end up in the same
     * `readFiles`, so the size caps, the compression and the rejection
     * messages are identical however the file arrived.
     */
    <aside
      className={dragging ? "fms-panel fms-ask fms-ask--drop" : "fms-panel fms-ask"}
      data-thinking={busy ? "true" : undefined}
      onDragOver={(e) => {
        if (![...e.dataTransfer.types].includes("Files")) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        // Only when the pointer has actually left the panel, not a child.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => {
        if (e.dataTransfer.files.length === 0) return;
        e.preventDefault();
        setDragging(false);
        void attach(e.dataTransfer.files);
      }}
      onPaste={(e) => {
        const pasted = [...e.clipboardData.files];
        if (pasted.length === 0) return;
        // Let a pasted screenshot in without also pasting its filename.
        e.preventDefault();
        void attach(pasted);
      }}
    >
      <div className="fms-askhead">
        <div className="t-label" style={{ color: "var(--ink-2)" }}>
          Ask
        </div>
        <p className="t-caption" style={{ margin: "2px 0 0", color: "var(--ink-3)" }}>
          Reads your figures and your receipts. It proposes; you save.
        </p>
      </div>

      {/*
        A batch gets one bar rather than eight decisions.

        Eight cards off two screenshots is a lot of scrolling to find out how
        many are ready, and "add the ready ones" is the thing you actually
        want to press. It sits above the thread so it stays put while the
        cards scroll under it.
      */}
      {openCount > 1 && (
        <div className="fms-batchbar">
          <span className="t-micro">
            {openCount} suggested, {readyCount} ready
          </span>
          <Button size="sm" variant="primary" disabled={readyCount === 0 || busy} onClick={addReady}>
            Add {readyCount === openCount ? "all" : `the ${readyCount} ready`}
          </Button>
          <button type="button" className="t-micro fms-linkish" onClick={discardOpen}>
            Discard the rest
          </button>
        </div>
      )}

      <div className="fms-thread" ref={threadRef}>
        {turns.length === 0 && !busy && (
          <div className="fms-askempty">
            <p className="t-caption" style={{ margin: 0, color: "var(--ink-3)" }}>
              {ai.disabled
                ? "The model is off in Settings, so answers come from this device."
                : "Ask about the month, type an entry, or attach a receipt."}
            </p>
            {STARTERS.map((q) => (
              <Button key={q} size="sm" onClick={() => void send(q, "ask")}>
                {q}
              </Button>
            ))}
          </div>
        )}

        {turns.map((turn, i) =>
          isDebt(turn) ? (
            <DebtCard
              key={i}
              turn={turn}
              debts={debts}
              sink={sink}
              hostRef={(el) => keepCard(i, el)}
              onSettle={() => {
                hold(i);
                setTurns((prev) =>
                  prev.map((t, j) => {
                    if (j !== i || !isDebt(t)) return t;
                    const next: DebtChoice = { ...t, state: "settled" };
                    // Same as an ordinary card: what became of it is recorded,
                    // so a refresh does not bring it back still asking.
                    recordCard(next);
                    return next;
                  }),
                );
              }}
              onChange={(draft) =>
                setTurns((prev) => prev.map((t, j) => (j === i && isDebt(t) ? { ...t, draft } : t)))
              }
            />
          ) : isChart(turn) ? (
            <ChartView key={i} chart={turn.chart} />
          ) : isFound(turn) ? (
            <FoundList
              key={i}
              found={turn}
              onAct={(id) => {
                if (turn.action === "edit") {
                  const row = transactions.find((t) => t.id === id);
                  if (row) sink.use(transactionToDraft(row));
                } else if (turn.action === "bin") {
                  sink.bin(id);
                } else {
                  sink.restore(id);
                }
                settleFound(i, id);
              }}
              onActAll={(ids) => {
                /**
                 * One move, one record of it.
                 *
                 * `binMany` is the Database screen's own bulk handler, so a
                 * set removed from the chat behaves exactly like a set
                 * removed from the table: one toast, one audit batch, and
                 * every row restorable together from the Bin.
                 */
                sink.binMany(ids);
                log(
                  aiEvent("accepted", "add", {
                    entry: `Moved ${ids.length} rows to the bin`,
                  }),
                );
                settleFound(i, ...ids);
              }}
            />
          ) : isOffer(turn) ? (
            <ProposalCard
              key={i}
              offered={turn}
              sink={sink}
              reference={reference}
              hostRef={(el) => keepCard(i, el)}
              alreadyInLedger={alreadyInLedger.get(i) ?? []}
              repeatOfCard={repeatOfCard.get(i)}
              recordNumber={
                turn.recordNumber ?? predictedNumber.get(i) ?? sink.nextRecordNumber
              }
              onChange={(draft) => replaceProposal(i, { ...turn.proposal, draft })}
              onChangeAll={(draft) => applyToAll(draft)}
              onAdd={() => {
                hold(i);
                log(
                  aiEvent("accepted", "add", {
                    entry: `${turn.proposal.draft.date} ${turn.proposal.draft.flow} ${turn.proposal.draft.item} ${formatMoney(turn.proposal.draft.amount ?? 0)}`,
                    /**
                     * Added anyway, over a duplicate warning.
                     *
                     * Worth recording on its own: a warning the owner
                     * overrides every time is a warning that is wrong, and
                     * without this the record cannot tell the difference
                     * between a warning that worked and one nobody heeded.
                     */
                    ...(alreadyInLedger.get(i)?.length
                      ? { text: `Added over a duplicate warning: ${duplicateHeadline(alreadyInLedger.get(i)![0]!)}` }
                      : {}),
                  }),
                );
                const given = sink.add(turn.proposal.draft, {
                  actor: "ai",
                  // A picture and a sentence are different enough to tell
                  // apart when reading the trail back.
                  via: turn.proposal.sourceRef.toLowerCase().includes("image")
                    ? "ai_image"
                    : "ai_chat",
                });
                settle(i, "added", given ?? undefined);
              }}
              onUse={() => {
                hold(i);
                sink.use(turn.proposal.draft);
                settle(i, "used");
              }}
              onDiscard={() => {
                hold(i);
                log(
                  aiEvent("rejected", "add", {
                    entry: `${turn.proposal.draft.date} ${turn.proposal.draft.flow} ${turn.proposal.draft.item} ${formatMoney(turn.proposal.draft.amount ?? 0)}`,
                  }),
                );
                settle(i, "discarded");
              }}
            />
          ) : (
            <div key={i} className={turn.kind === "you" ? "fms-turn fms-turn--you" : "fms-turn"}>
              {turn.kind === "assistant" ? (
                <Rich text={turn.text} />
              ) : (
                <>
                  {turn.shown && turn.shown.length > 0 && (
                    <div className="fms-saidfiles">
                      {turn.shown.map((f) =>
                        f.kind === "image" && f.dataUrl ? (
                          <button
                            key={f.id}
                            type="button"
                            className="fms-thumbopen"
                            title={`${f.name}, ${formatBytes(f.bytes)}`}
                            aria-label={`Look at ${f.name}`}
                            onClick={() => setPreviewing(f)}
                          >
                            <img src={f.dataUrl} alt="" />
                          </button>
                        ) : (
                          <span key={f.id} className="fms-thumbfile t-micro" title={f.name}>
                            {f.name.split(".").pop()?.toUpperCase().slice(0, 4) ?? "FILE"}
                          </span>
                        ),
                      )}
                    </div>
                  )}
                  {/*
                    What the photo said, once the photo is gone.

                    The picture above lives only in this session: an image is
                    never stored. After a refresh these lines are what comes
                    back in its place, one per file, so a message that was a
                    receipt still says which receipt and what was on it.

                    Only when the picture is not showing, so the same thing is
                    never said twice in one message.
                  */}
                  {turn.described && turn.described.length > 0 && !turn.shown && (
                    <div className="fms-described">
                      {turn.described.map((line) => (
                        <p key={line} className="t-micro fms-describedline">
                          {line}
                        </p>
                      ))}
                    </div>
                  )}
                  {turn.text && (
                    <p className="t-caption" style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                      {turn.text}
                    </p>
                  )}
                  {/*
                    Never an empty bubble.

                    A photo sent with no words is a message whose entire
                    content is the picture, and the picture is never stored.
                    If its description did not come back either, this rendered
                    as a small blank pill: something was clearly there and
                    there was no way to tell what. The owner circled it.

                    This is the floor. It says what the bubble is even when
                    everything that made it interesting is gone.
                  */}
                  {!turn.text &&
                    !(turn.shown && turn.shown.length > 0) &&
                    !(turn.described && turn.described.length > 0) && (
                      <p className="t-micro" style={{ margin: 0, color: "var(--ink-3)" }}>
                        A picture, which is not kept.
                      </p>
                    )}
                </>
              )}
              {turn.from && (
                <p className="t-micro" style={{ margin: "var(--space-1) 0 0", color: "var(--ink-3)" }}>
                  {turn.from}
                </p>
              )}
            </div>
          ),
        )}

        {busy && (
          <div className="fms-working" role="status" aria-live="polite">
            {/*
              Three dots rather than a word that sits still.

              "Thinking" with nothing moving reads as a message, not as work
              in progress, and a receipt can take fifteen seconds. Motion is
              minimal and stops entirely under reduced motion (rule D9),
              where the words alone still say what is happening.
            */}
            <span className="fms-dots" aria-hidden>
              <i />
              <i />
              <i />
            </span>
            <span className="t-caption" style={{ color: "var(--ink-3)" }}>
              {attached ? "Reading the picture" : intent === "log" ? "Reading" : "Thinking"}
            </span>
          </div>
        )}
      </div>

      {attached && (
        <div className="fms-askfiles">
          {files.map((f) => (
            <span key={f.id} className="fms-thumb">
              {f.kind === "image" && f.dataUrl ? (
                <button
                  type="button"
                  className="fms-thumbopen"
                  title={`${f.name}, ${formatBytes(f.bytes)}`}
                  aria-label={`Look at ${f.name}`}
                  onClick={() => setPreviewing(f)}
                >
                  <img src={f.dataUrl} alt="" />
                </button>
              ) : (
                <span className="fms-thumbfile t-micro" title={f.name}>
                  {f.name.split(".").pop()?.toUpperCase().slice(0, 4) ?? "FILE"}
                </span>
              )}
              <button
                type="button"
                aria-label={`Remove ${f.name}`}
                className="fms-thumbclose"
                onClick={() => setFiles((prev) => prev.filter((x) => x.id !== f.id))}
              >
                ×
              </button>
            </span>
          ))}
          <span className="t-micro" style={{ color: "var(--ink-3)" }}>
            {files.length} of {limits.maxCount}, {formatBytes(weight)}
          </span>
        </div>
      )}

      {/*
        Full size, over everything, with a way out.

        Only for this session: the picture lives in memory and is never
        written anywhere, which is the whole point of describing photos
        rather than storing them.
      */}
      {previewing?.dataUrl && (
        <div
          className="fms-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={previewing.name}
          onClick={() => setPreviewing(null)}
        >
          <button
            type="button"
            className="fms-lightboxclose"
            aria-label="Close"
            onClick={() => setPreviewing(null)}
          >
            ×
          </button>
          <img
            src={previewing.dataUrl}
            alt={previewing.name}
            onClick={(e) => e.stopPropagation()}
          />
          <p className="t-micro fms-lightboxname">
            {previewing.name}, {formatBytes(previewing.bytes)}. This picture is not saved anywhere.
          </p>
        </div>
      )}

      {pending && (
        <div className="fms-intent">
          <span className="t-micro" style={{ color: "var(--ink-3)" }}>
            Finishing an entry
          </span>
          <button
            type="button"
            className="fms-intentpick t-micro"
            onClick={() => {
              setPending(null);
              say({ kind: "assistant", text: "Dropped it.", from: "this device" });
            }}
          >
            never mind
          </button>
        </div>
      )}

      <form
        className="fms-askform"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input
          ref={pickerRef}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,.csv,.txt,.md,.json,.tsv"
          hidden
          onChange={(e) => {
            void attach(e.target.files);
            // Cleared so picking the same file twice in a row still fires.
            e.target.value = "";
          }}
        />
        <button
          type="button"
          className="fms-attach"
          aria-label="Attach a photo or a file"
          title="Attach a photo or a file"
          disabled={busy || files.length >= limits.maxCount}
          onClick={() => pickerRef.current?.click()}
        >
          +
        </button>
        {/*
          A textarea, so several entries fit in one message.

          Enter sends and Shift plus Enter starts a line, which is what every
          chat does and therefore what the fingers already expect. It grows to
          a few lines and then scrolls, so a long paste cannot push the
          composer over the conversation.
        */}
        <textarea
          className="t-caption fms-askinput"
          rows={1}
          value={draft}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.shiftKey) return;
            e.preventDefault();
            void send();
          }}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={
            pending
              ? pending.blank === "amount"
                ? "How much?"
                : "Your answer"
              : attached
                ? "Anything to add about these?"
                : "Ask, or type an entry"
          }
          aria-label={attached ? "A note about the attached files" : "Ask a question, or type an entry"}
          disabled={busy}
        />
        {busy ? (
          /*
            A way out of the queue.

            A free model can sit there for the better part of a minute, and
            three dots with no way to stop is the app holding you to a
            provider's queue. Stopping abandons the request; nothing was
            going to be saved by it either way.
          */
          <Button size="sm" onClick={stop}>
            Stop
          </Button>
        ) : (
          <Button
            size="sm"
            variant="primary"
            type="submit"
            disabled={!draft.trim() && !attached}
          >
            {attached ? "Read" : pending ? "Answer" : intent === "log" ? "Log" : "Send"}
          </Button>
        )}
      </form>

      {turns.length > 0 && (
        <button
          type="button"
          className="t-micro fms-linkish"
          onClick={() => {
            log(aiEvent("cleared", "add"));
            /**
             * Cleared here, kept there.
             *
             * The record is append only and nothing in this app can remove
             * it, so clearing marks where you cleared rather than deleting
             * anything: what comes back next time is what was said after
             * that mark. Without it, clearing looked like it worked and then
             * the whole conversation reappeared on the next visit.
             *
             * The mark is per device on purpose. It is a view preference,
             * not a fact about the money, so it has no business in the
             * database.
             */
            markCleared();
            setTurns([]);
          }}
        >
          {/*
            Clears the screen, not the record. The collection is append only
            at the database, so there is no gesture here that could delete
            what was said, and pretending otherwise would be a lie about
            where your data is.
          */}
          Clear this view
        </button>
      )}
    </aside>
  );
}

/**
 * An answer, with the structure it was written with.
 *
 * Parsed rather than stripped, then rendered as real elements: no asterisk
 * reaches the screen, which is what the no-Markdown rule was protecting, and
 * a four month comparison gets a line per month instead of one long sentence.
 * Nothing here builds HTML from the model's text: `readRich` returns data and
 * this turns it into React elements.
 */
function Rich({ text }: { text: string }) {
  const blocks = readRich(text);

  // Nothing parsed: show it exactly as it came, rather than nothing at all.
  if (blocks.length === 0) {
    return (
      <p className="t-caption" style={{ margin: 0, whiteSpace: "pre-wrap" }}>
        {text}
      </p>
    );
  }

  return (
    <div className="fms-rich">
      {blocks.map((block, i) =>
        block.kind === "list" ? (
          <ul key={i} className="fms-richlist">
            {block.items.map((item, j) => (
              <li key={j} className="t-caption">
                {item.map((span, k) =>
                  span.bold ? <strong key={k}>{span.text}</strong> : <span key={k}>{span.text}</span>,
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p key={i} className="t-caption" style={{ margin: 0 }}>
            {block.spans.map((span, k) =>
              span.bold ? <strong key={k}>{span.text}</strong> : <span key={k}>{span.text}</span>,
            )}
          </p>
        ),
      )}
    </div>
  );
}

/**
 * One proposed row, as the form it is.
 *
 * ── Why every field is shown, including the empty ones ────────────────────
 *
 * This is an entry about to go into a ledger of real money, and a card that
 * shows four of its eleven fields is asking to be trusted about the other
 * seven. So it shows the row: the number it will take, its type, both
 * wallets, the category, the item, the amount, the fee, the status. A field
 * that is empty says so, in the colour that means "this stops it saving",
 * because knowing what is missing is the point of looking.
 *
 * ── Why it fits any width ─────────────────────────────────────────────────
 *
 * It is a two column grid that becomes one column when there is no room, and
 * every value can break inside its own cell. The panel it sits in is a fixed
 * frame that scrolls, so a card can be as tall as it likes and nothing else
 * on the page moves.
 *
 * The check is the form's own, run on every render, so the Add button
 * reflects the ledger as it stands rather than as it stood when the model
 * answered.
 */
function ProposalCard({
  offered,
  sink,
  reference,
  hostRef,
  alreadyInLedger,
  repeatOfCard,
  recordNumber,
  onChange,
  onChangeAll,
  onAdd,
  onUse,
  onDiscard,
}: {
  offered: Offered;
  sink: ProposalSink;
  reference: ReferenceLists;
  /** So the panel can measure this card and hold it still when it changes. */
  hostRef: (el: HTMLDivElement | null) => void;
  /** Rows in the ledger this card looks like it repeats. Usually empty. */
  alreadyInLedger: readonly Duplicate[];
  /**
   * The number to print.
   *
   * An open card shows the number it would get, counting the cards above it
   * that are also waiting. A settled one shows the number it actually got.
   * Reading `sink.nextRecordNumber` directly showed every card in a batch the
   * same figure, and went on changing it after the row was saved.
   */
  recordNumber: number;
  /** The entry an earlier card already holds, when this one repeats it. */
  repeatOfCard?: Draft | undefined;
  onChange: (draft: Draft) => void;
  onChangeAll: (draft: Draft) => void;
  onAdd: () => void;
  onUse: () => void;
  onDiscard: () => void;
}) {
  const { proposal, state } = offered;
  const { draft } = proposal;
  const check = sink.check(draft);
  // Stable and unique per card, so each label points at its own select.
  const pickerId = useId();
  const itemPickerId = useId();
  const toPickerId = useId();

  /**
   * A discarded card goes. A settled one stays.
   *
   * Sending a card to the form used to replace it with one line of text, so
   * the entry you had just asked to look at vanished at the moment you asked
   * to look at it. It stays now, showing the same fields, with the buttons
   * replaced by what happened to it.
   */
  if (state === "discarded") {
    return (
      <div ref={hostRef} className="fms-turn t-micro" style={{ color: "var(--ink-3)" }}>
        Discarded.
      </div>
    );
  }

  const settled = state !== "open";
  const flow = draft.flow || "Spending";

  /**
   * The wallet, pickable on the card.
   *
   * Eight rows off one screenshot cannot be resolved by a conversation that
   * holds one question at a time. Each card carries its own, and "for all of
   * them" exists because a statement screenshot is one account and saying so
   * eight times is seven taps too many.
   */
  const accounts = [...reference.wallets, ...reference.savings];
  /**
   * Which end of this row the owner picks.
   *
   * Spending has one wallet, Revenue has one, and a Transfer has two but only
   * ever one blank at a time by the time a card is shown. The row stays on an
   * open card even once it is filled, so a wrong wallet can be corrected and
   * so "same for all" is still reachable.
   */
  const walletField: "fromWallet" | "toWallet" = flow === "Revenue" ? "toWallet" : "fromWallet";
  const walletLabel = flow === "Revenue" ? "Which wallet received it" : "Which wallet paid";
  /** A transfer that left the accounts has no destination to show or ask for. */
  const moneySend = flow === "Transfer" && draft.sentOut === true;

  /**
   * The item, when the card is missing one and the flow has the field.
   *
   * Spending and Revenue both classify by item and neither total works
   * without it. Transfer and Debt do not have one, so nothing is asked.
   */
  const itemChoices =
    flow === "Spending" || flow === "Revenue" ? itemsFor(flow, draft.category, reference) : [];
  const needsItem = itemChoices.length > 0 && draft.item.trim() === "";

  /**
   * Where a transfer went, which the card could not ask.
   *
   * ── The row that could not be saved ────────────────────────────────────
   *
   * "Sent money via InstaPay, PHP 130.00" came off a statement as a Transfer
   * from Maya with no destination. The card asked which wallet *paid*, which
   * was already filled in, and printed "Pick the wallet the money lands in"
   * in the colour that means this stops it saving. There was no control for
   * that field anywhere on the card. The only exit was Discard.
   *
   * Worse, the answer was usually not an account at all. Money sent to
   * another person leaves the accounts entirely, which this ledger calls a
   * Money Send: a blank destination books the whole amount as spending, a
   * named one books only the fee. The form has always offered that choice.
   * The card never did, so a card could not express the commonest kind of
   * transfer there is.
   *
   * `SOMEONE_ELSE` is a label, never a wallet name. Choosing it sets the flag
   * the ledger actually reads and leaves the destination blank.
   */
  const needsDestination = flow === "Transfer" && !moneySend && draft.toWallet.trim() === "";
  const confidence =
    proposal.confidence === "high"
      ? "clear"
      : proposal.confidence === "medium"
        ? "fairly clear"
        : "hard to read";

  return (
    <div ref={hostRef} className={settled ? "fms-proposal fms-proposal--settled" : "fms-proposal"}>
      <div className="fms-proposalhead">
        <span className="t-label" style={{ color: "var(--ink-2)" }}>
          {state === "added" ? "Added" : state === "used" ? "In the form" : "New entry"}
        </span>
        <span className="t-micro" style={{ color: "var(--ink-3)" }}>
          {settled ? "" : confidence}
        </span>
      </div>

      {/*
        The same fields, in the same order, under the same names the form and
        the database use. An earlier version called `description` "Note",
        which is a different column: the ledger has both, and a card that
        renames one of them is teaching the wrong thing about the data.
      */}
      <dl className="fms-proposalfields">
        <Field label="Record number" value={String(recordNumber).padStart(4, "0")} mono />
        <Field label="Type" value={flow} />
        <Field label="Date" value={draft.date} mono />
        {flow !== "Revenue" && <Field label="From wallet" value={draft.fromWallet} required />}
        {flow !== "Spending" &&
          (moneySend ? (
            // Blank on purpose: the money left the accounts, so there is no
            // destination to pick and marking it required reads as an error.
            <Field label="To wallet" value="Someone else" />
          ) : (
            <Field label="To wallet" value={draft.toWallet} required={flow === "Transfer"} />
          ))}
        <Field label="Category" value={draft.category} />
        {(flow === "Spending" || flow === "Revenue") && (
          <Field label="Item" value={draft.item} required />
        )}
        <Field
          label="Amount"
          value={draft.amount === null ? "" : formatMoney(draft.amount)}
          required
          mono
        />
        <Field label="Fee" value={formatMoney(draft.fee)} mono />
        <Field label="Description" value={draft.description} />
        {draft.notes && <Field label="Notes" value={draft.notes} />}
        <Field label="Status" value={draft.status} />
      </dl>

      {!settled && (
        <div className="fms-proposalpick">
          <label className="t-micro fms-pfieldlabel" htmlFor={pickerId}>
            {walletLabel}
          </label>
          <select
            id={pickerId}
            className="t-caption fms-proposalselect"
            value={draft[walletField]}
            onChange={(e) => onChange({ ...draft, [walletField]: e.target.value })}
          >
            <option value="">Pick one</option>
            {accounts.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          {draft[walletField] && (
            <button
              type="button"
              className="t-micro fms-linkish"
              onClick={() => onChangeAll(draft)}
              title="Put this wallet on every other card that still needs one"
            >
              Same for all
            </button>
          )}
        </div>
      )}

      {/*
        A card that needs an item has to offer one.
        
        The card marked Item as "you pick" in the red that means this stops it
        saving, and then the only control on it was a wallet picker. The owner
        wrote it down: "error in entry like its say item but in which wallet it
        say wallet instead of item". There was no way to answer the question
        being asked, so the card was unsaveable and the only exit was Discard.
        
        Shown only when it is missing, and only where an item is a field at
        all: a Transfer has none, and a card that already read one correctly
        does not need a picker for it.
      */}
      {!settled && (needsDestination || moneySend) && (
        <div className="fms-proposalpick">
          <label className="t-micro fms-pfieldlabel" htmlFor={toPickerId}>
            Where it went
          </label>
          <select
            id={toPickerId}
            className="t-caption fms-proposalselect"
            value={moneySend ? SOMEONE_ELSE : draft.toWallet}
            onChange={(e) => {
              const picked = e.target.value;
              onChange(
                picked === SOMEONE_ELSE
                  ? { ...draft, toWallet: "", sentOut: true }
                  : { ...draft, toWallet: picked, sentOut: false },
              );
            }}
          >
            <option value="">Pick one</option>
            {accounts
              .filter((a) => a !== draft.fromWallet)
              .map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            <option value={SOMEONE_ELSE}>{SOMEONE_ELSE}</option>
          </select>
        </div>
      )}

      {!settled && needsItem && (
        <div className="fms-proposalpick">
          <label className="t-micro fms-pfieldlabel" htmlFor={itemPickerId}>
            {flow === "Revenue" ? "Where it came from" : "What it was for"}
          </label>
          <select
            id={itemPickerId}
            className="t-caption fms-proposalselect"
            value={draft.item}
            onChange={(e) => onChange({ ...draft, item: e.target.value })}
          >
            <option value="">Pick one</option>
            {itemChoices.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
      )}

      {proposal.adjustments.length > 0 && (
        <div className="fms-proposalnotes">
          {proposal.adjustments.map((a) => (
            <p key={a} className="t-micro fms-proposalnote">
              {a}
            </p>
          ))}
        </div>
      )}

      {check.problems.map((p) => (
        <p key={p} className="t-micro fms-proposalnote fms-proposalnote--stop">
          {p}
        </p>
      ))}
      {check.warnings.map((w) => (
        <p key={w} className="t-micro fms-proposalnote fms-proposalnote--warn">
          {w}
        </p>
      ))}

      {/*
        Already got this one.

        Shown on an open card only. Once a card is decided the warning has
        done its work, and a saved row carrying "this might be a duplicate"
        for the rest of the session is an alarm about a settled question.

        It sits directly above the buttons because that is the last thing
        read before pressing one. Nothing is disabled: the evidence is here so
        the owner can tell in two seconds whether it is a repeat or a genuine
        second purchase, and only the owner knows which.
      */}
      {!settled && repeatOfCard !== undefined && (
        <div className="fms-dupe">
          <p className="t-micro fms-dupehead">A card above already says this.</p>
          <p className="t-micro fms-dupeline">
            {repeatOfCard.date} {repeatOfCard.item || repeatOfCard.flow || "entry"},{" "}
            {formatMoney(repeatOfCard.amount ?? 0)}
            {repeatOfCard.fromWallet ? ` out of ${repeatOfCard.fromWallet}` : ""}
            {repeatOfCard.toWallet ? ` into ${repeatOfCard.toWallet}` : ""}.
          </p>
          <p className="t-micro fms-dupeline">
            Same date, same amount, same thing. If the receipt went up twice, discard this one.
          </p>
        </div>
      )}

      {!settled && repeatOfCard === undefined && alreadyInLedger.length > 0 && (
        <div className="fms-dupe">
          {alreadyInLedger.map((match) => (
            <div key={match.row.id}>
              <p className="t-micro fms-dupehead">{duplicateHeadline(match)}</p>
              <p className="t-micro fms-dupeline">
                {match.row.date} {match.row.item || match.row.type}
                {match.row.description ? `, ${match.row.description}` : ""}
              </p>
              <ul className="fms-dupewhy">
                {match.evidence.map((line) => (
                  <li key={line} className="t-micro fms-dupeline">
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <p className="t-micro fms-dupeline">
            Add it anyway if you really paid twice. Nothing here is blocked.
          </p>
        </div>
      )}

      {settled ? (
        <>
          <p className="t-micro fms-proposalfrom">
            {state === "added"
              ? "Saved to the ledger. It is in the Database and in the activity trail."
              : "Loaded into the form beside this. Check it and press Save transaction."}
          </p>
          {/*
            A way back.

            Pressing Edit first and then Clear on the form emptied the form
            and left this card with no buttons: the entry was on screen and
            there was no way to get it back. The card keeps what it read, so
            it can always load it again.
          */}
          {state === "used" && (
            <div className="fms-proposalactions">
              <Button size="sm" onClick={onUse}>
                Put back in the form
              </Button>
              <Button size="sm" variant="primary" disabled={!check.ok} onClick={onAdd}>
                Add to ledger
              </Button>
              <Button size="sm" onClick={onDiscard}>
                Discard
              </Button>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="fms-proposalactions">
            <Button size="sm" variant="primary" disabled={!check.ok} onClick={onAdd}>
              Add to ledger
            </Button>
            <Button size="sm" onClick={onUse}>
              Edit first
            </Button>
            <Button size="sm" onClick={onDiscard}>
              Discard
            </Button>
          </div>
          <p className="t-micro fms-proposalfrom">From {proposal.sourceRef}</p>
        </>
      )}
    </div>
  );
}

/**
 * One labelled value.
 *
 * A required field left empty is shown in the "stops it saving" colour with
 * the words that say what to do, rather than as an empty cell you have to
 * notice.
 */
function Field({
  label,
  value,
  required,
  mono,
}: {
  label: string;
  value: string;
  required?: boolean;
  mono?: boolean;
}) {
  const missing = !value.trim();
  return (
    <div className="fms-pfield">
      <dt className="t-micro fms-pfieldlabel">{label}</dt>
      <dd
        className={mono && !missing ? "t-caption fms-proposalmoney" : "t-caption"}
        style={{
          margin: 0,
          color: missing ? (required ? "var(--over)" : "var(--ink-3)") : "var(--ink)",
        }}
      >
        {value.trim() || (required ? "you pick" : "none")}
      </dd>
    </div>
  );
}

/**
 * The rows a sentence about deleting or restoring turned up.
 *
 * Every one is shown whole, with what matched, and every one has its own
 * button. Nothing here acts on more than one at a time and nothing acts
 * without being pressed: a sentence is evidence about which row was meant,
 * not permission to remove it.
 */
function FoundList({
  found,
  onAct,
  onActAll,
}: {
  found: Found;
  onAct: (id: string) => void;
  onActAll: (ids: readonly string[]) => void;
}) {
  const { action, candidates, done, sweep } = found;
  const verb = action === "edit" ? "Edit this" : action === "bin" ? "Move to bin" : "Restore";

  /**
   * A named set gets one button, and a shortened list.
   *
   * Forty rows with a button each is not an offer, it is a chore, and the
   * point of asking for all of them was not to press forty things. Enough
   * rows are shown to recognise what is about to go, and the total is in the
   * sentence above the card.
   */
  const settledAll = candidates.length > 0 && candidates.every((c) => done.includes(c.row.id));
  const shown = sweep ? candidates.slice(0, 6) : candidates;
  const hidden = candidates.length - shown.length;

  return (
    <div className="fms-proposal">
      <div className="fms-proposalhead">
        <span className="t-label" style={{ color: "var(--ink-2)" }}>
          {candidates.length === 1 ? "One entry matches" : `${candidates.length} entries match`}
        </span>
        <span className="t-micro" style={{ color: "var(--ink-3)" }}>
          {/* Past tense once it has happened: "nothing is deleted yet" stayed
              on screen after the rows had gone, which is a card contradicting
              itself about money. */}
          {settledAll
            ? action === "edit"
              ? "loaded into the form"
              : action === "bin"
                ? "moved to the bin"
                : "restored"
            : action === "edit"
              ? "nothing is changed yet"
              : action === "bin"
                ? "nothing is deleted yet"
                : "from the bin"}
        </span>
      </div>

      {sweep && action === "bin" && (
        <div className="fms-proposalactions">
          {settledAll ? (
            <p className="t-micro fms-proposalfrom" style={{ margin: 0 }}>
              All {candidates.length} moved to the bin. They are restorable from the Bin screen.
            </p>
          ) : (
            <Button
              size="sm"
              variant="danger"
              onClick={() => onActAll(candidates.map((c) => c.row.id))}
            >
              Move all {candidates.length} to bin
            </Button>
          )}
        </div>
      )}

      {shown.map(({ row, why }) => {
        const settled = done.includes(row.id);
        return (
          <div key={row.id} className="fms-foundrow">
            <div className="t-caption">
              #{String(row.recordNumber).padStart(4, "0")} · {row.date} · {row.type} ·{" "}
              {row.item || row.description || "no item"} · {formatMoney(row.total)}
            </div>
            <p className="t-micro fms-proposalnote">Matched on {why.join(", ")}.</p>
            {settled ? (
              <p className="t-micro fms-proposalfrom">
                {action === "edit"
                  ? "Loaded into the form beside this. Change it and press Save transaction."
                  : action === "bin"
                    ? "Moved to the bin. It is restorable from the Bin screen."
                    : "Restored. It is back in the Database."}
              </p>
            ) : sweep ? null : (
              <Button size="sm" onClick={() => onAct(row.id)}>
                {verb}
              </Button>
            )}
          </div>
        );
      })}

      {hidden > 0 && (
        <p className="t-micro fms-proposalnote">
          and {hidden} more, all of them {candidates[0]?.why[0] ?? "in this set"}.
        </p>
      )}

      <p className="t-micro fms-proposalfrom">
        {action === "edit"
          ? "Editing keeps the same record number: it is the entry corrected, not a new one."
          : action === "bin"
            ? "A deleted entry moves to the Bin and can be brought back. Nothing is ever removed."
            : "Restoring puts it back where it was, with its own record number."}
      </p>
    </div>
  );
}

/**
 * A chart, as bars.
 *
 * ── Why not a pie ─────────────────────────────────────────────────────────
 *
 * This column is 280px. A pie of a month's spending is a dozen slices, most
 * of them a few degrees across, and reading one needs a legend, which in that
 * space is a list of labels beside a circle nobody can read. These are the
 * same figures sorted, each with its own number printed next to it.
 *
 * ── Why one colour ───────────────────────────────────────────────────────
 *
 * Flow colour means direction of money in this app (rule D3), so a chart may
 * not spend colour telling one bar from another. Length carries the
 * comparison, which is what a bar chart is for, and it stays readable to
 * anyone who cannot separate the hues a legend would have needed.
 */
function ChartView({ chart }: { chart: Chart }) {
  return (
    <div className="fms-proposal">
      <div className="fms-proposalhead">
        <span className="t-label" style={{ color: "var(--ink-2)" }}>
          {chart.title}
        </span>
        <span className="t-micro fms-proposalmoney" style={{ color: "var(--ink-3)" }}>
          {chartLabel(chart.total)}
        </span>
      </div>

      {chart.kind === "pie" ? (
        <PieView chart={chart} />
      ) : chart.kind === "line" ? (
        <LineView chart={chart} />
      ) : (
      <div className="fms-chartrows">
        {chart.rows.map((r) => (
          <div key={r.label} className="fms-chartrow">
            <div className="fms-chartlabel t-micro">{r.label}</div>
            <div className="fms-charttrack">
              {/* Width is the only thing carrying the comparison. */}
              <div className="fms-chartbar" style={{ width: `${Math.max(r.share * 100, 1.5)}%` }} />
            </div>
            <div className="t-micro fms-chartvalue fms-proposalmoney">{chartLabel(r.value)}</div>
          </div>
        ))}
      </div>
      )}

      <p className="t-micro fms-proposalfrom">
        {chart.othersCount > 0
          ? `The ${chart.rows.length} largest, with ${chart.othersCount} smaller left off. Totals worked out on this device.`
          : "Totals worked out on this device, from your entries."}
      </p>
    </div>
  );
}

/**
 * Where the conversation was last cleared, on this device.
 *
 * The record itself is append only and nothing in the app can remove it, so
 * "Clear this view" marks a point rather than deleting anything: the panel
 * shows what was said after the mark, and Settings still shows all of it.
 *
 * Per device, and in the browser rather than the database, because it is a
 * view preference and not a fact about the money. Storage can throw in a
 * private window, and a cleared view that quietly comes back is a smaller
 * problem than a screen that will not render.
 */
const CLEARED_KEY = "fms.chat.clearedAt";

function clearedAt(): string | null {
  try {
    return window.localStorage.getItem(CLEARED_KEY);
  } catch {
    return null;
  }
}

function markCleared(): void {
  try {
    window.localStorage.setItem(CLEARED_KEY, new Date().toISOString());
  } catch {
    // A view preference is not worth a broken screen.
  }
}

/**
 * Shares of a whole, as a donut.
 *
 * ── Why a donut and not a pie ─────────────────────────────────────────────
 *
 * The hole is where the total goes. In a 280px column that saves the line of
 * text a pie would need underneath it, and the figure everyone looks at first
 * ends up in the middle rather than off to one side.
 *
 * ── Why one hue ──────────────────────────────────────────────────────────
 *
 * Flow colour means direction of money in this app (rule D3), so slices may
 * not be told apart by hue: a red slice would read as spending and a grey one
 * as a transfer. They are told apart by lightness, in order, largest first,
 * which also means the chart survives being printed or read by someone who
 * cannot separate the hues a legend would have needed.
 *
 * Every slice is labelled underneath with its own figure, so the drawing is a
 * summary of the list rather than the only way to read it.
 */
function PieView({ chart }: { chart: Chart }) {
  const size = 132;
  const radius = 52;
  const centre = size / 2;
  const circumference = 2 * Math.PI * radius;

  let offset = 0;
  const slices = chart.rows.map((r, i) => {
    const fraction = chart.total > 0 ? r.value / chart.total : 0;
    const slice = {
      label: r.label,
      value: r.value,
      dash: fraction * circumference,
      offset,
      // Largest darkest, then stepping lighter. Never below 0.28, where the
      // ring stops being distinguishable from the surface behind it.
      opacity: Math.max(0.28, 1 - i * (0.72 / Math.max(chart.rows.length - 1, 1))),
      percent: Math.round(fraction * 100),
    };
    offset += fraction * circumference;
    return slice;
  });

  return (
    <div className="fms-pie">
      <svg viewBox={`0 0 ${size} ${size}`} className="fms-piesvg" role="img" aria-label={chart.title}>
        {/* Rotated so the first slice starts at the top, where reading starts. */}
        <g transform={`rotate(-90 ${centre} ${centre})`}>
          {slices.map((s) => (
            <circle
              key={s.label}
              cx={centre}
              cy={centre}
              r={radius}
              fill="none"
              stroke="var(--brand-600)"
              strokeOpacity={s.opacity}
              strokeWidth={22}
              strokeDasharray={`${s.dash} ${circumference - s.dash}`}
              strokeDashoffset={-s.offset}
            />
          ))}
        </g>
        <text x={centre} y={centre - 2} className="fms-pietotal" textAnchor="middle">
          {chartLabel(chart.total).replace("PHP ", "")}
        </text>
        <text x={centre} y={centre + 14} className="fms-pieunit" textAnchor="middle">
          PHP in total
        </text>
      </svg>

      <ul className="fms-pielegend">
        {slices.map((s) => (
          <li key={s.label} className="t-micro">
            <span
              className="fms-pieswatch"
              style={{ opacity: s.opacity }}
              aria-hidden
            />
            <span className="fms-pielabel">{s.label}</span>
            <span className="fms-piefigure fms-proposalmoney">
              {s.percent}% · {chartLabel(s.value)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A series over time, as a line.
 *
 * Only ever months, because a line says "this followed that" and items have
 * no order for it to say that about. Points are drawn as well as the line, so
 * a month with one entry is still a thing you can see and not just a bend.
 *
 * The axis starts at zero. A line chart of money that starts at the lowest
 * value makes a quiet month look like a collapse, which is a lie told with
 * geometry rather than with a figure.
 */
function LineView({ chart }: { chart: Chart }) {
  const width = 260;
  const height = 96;
  const pad = 6;
  const top = pad;
  const bottom = height - pad;

  const highest = Math.max(...chart.rows.map((r) => r.value), 1);
  const step = chart.rows.length > 1 ? (width - pad * 2) / (chart.rows.length - 1) : 0;

  const points = chart.rows.map((r, i) => ({
    label: r.label,
    value: r.value,
    x: pad + i * step,
    y: bottom - (r.value / highest) * (bottom - top),
  }));

  const line = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const area = `${pad},${bottom} ${line} ${(pad + (chart.rows.length - 1) * step).toFixed(1)},${bottom}`;

  return (
    <div className="fms-line">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="fms-linesvg"
        role="img"
        aria-label={chart.title}
      >
        <polygon points={area} className="fms-linefill" />
        <polyline points={line} className="fms-linestroke" />
        {points.map((p) => (
          <circle key={p.label} cx={p.x} cy={p.y} r={2.5} className="fms-linedot" />
        ))}
      </svg>

      {/* The figures, because a line says the shape and not the numbers. */}
      <ul className="fms-linelegend">
        {points.map((p) => (
          <li key={p.label} className="t-micro">
            <span className="fms-pielabel">{p.label}</span>
            <span className="fms-piefigure fms-proposalmoney">{chartLabel(p.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The four things a debt movement can do, in the words the form uses. */
const DEBT_EFFECTS: readonly { readonly value: DebtEffect; readonly label: string }[] = [
  { value: "draw", label: "Borrowed more" },
  { value: "repay", label: "Paid it down" },
  { value: "interest", label: "Interest or fee" },
  { value: "writeoff", label: "Written off" },
];

/**
 * A debt movement, finished in the chat.
 *
 * ── Why these two are chosen and never inferred ───────────────────────────
 *
 * Which credit line, and what the movement does to it. Neither is in a
 * sentence: "I paid my debt 2950" says nothing about whether that was
 * principal, interest, or a line being written off, and reading it wrong
 * misfiles borrowing as income. That is the mistake that put PHP 5,450 of
 * borrowed money into this ledger's income line for eight months.
 *
 * So they are buttons. Everything else the sentence gave up is already
 * filled in, and `checkDraft` still decides whether Add may be pressed:
 * rule D1 refuses a debt row without both of these anyway, so the card
 * cannot be saved half-answered even if this component let it.
 */
function DebtCard({
  turn,
  debts,
  sink,
  hostRef,
  onSettle,
  onChange,
}: {
  turn: DebtChoice;
  debts: readonly Debt[];
  sink: ProposalSink;
  /** So the panel can measure this card and hold it still when it changes. */
  hostRef: (el: HTMLDivElement | null) => void;
  onSettle: () => void;
  onChange: (draft: Draft) => void;
}) {
  const { draft, state } = turn;
  const check = sink.check(draft);
  const live = debts.filter((d) => !d.archived);
  const named = draft.fromWallet || draft.toWallet;
  const direction = debtWalletDirection(draft.debtEffect);


  if (state === "settled") {
    return (
      <div ref={hostRef} className="fms-turn t-micro" style={{ color: "var(--ink-3)" }}>
        Added: {draft.item || "debt movement"}, {formatMoney(draft.amount ?? 0)}. It is in the
        Database and in the activity trail.
      </div>
    );
  }

  return (
    <div ref={hostRef} className="fms-proposal">
      <div className="fms-proposalhead">
        <span className="t-label" style={{ color: "var(--ink-2)" }}>
          Debt movement
        </span>
        <span className="t-micro" style={{ color: "var(--ink-3)" }}>
          two things to pick
        </span>
      </div>

      <dl className="fms-proposalfields">
        <Field label="Date" value={draft.date} mono />
        <Field
          label="Amount"
          value={draft.amount === null ? "" : formatMoney(draft.amount)}
          required
          mono
        />
        <Field
          label={direction === "in" ? "Lands in" : direction === "out" ? "Paid from" : "Wallet"}
          value={named}
        />
      </dl>

      <div className="fms-debtpick">
        <label className="t-micro fms-pfieldlabel" htmlFor="debt-line">
          Which credit line
        </label>
        <select
          id="debt-line"
          className="t-caption fms-proposalselect"
          value={draft.debtId ?? ""}
          onChange={(e) => onChange({ ...draft, debtId: e.target.value })}
        >
          <option value="">Pick one</option>
          {live.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </div>

      <div className="fms-debteffects">
        <span className="t-micro fms-pfieldlabel">What it does</span>
        {/*
          The form's own choice control, in the debt colour.

          It was four buttons with the chosen one filled in brand green,
          which is the colour this app spends on income (rule D3): a green
          "Paid it down" on a card about borrowing is the same confusion the
          selected-row tint had. Amber is what a liability is written in
          here, and this is a radio group, so it says so to a screen reader
          as well as to the eye.
        */}
        <div className="fms-choicerow" role="radiogroup" aria-label="What this debt movement does">
          {DEBT_EFFECTS.map((e) => (
            <button
              key={e.value}
              type="button"
              role="radio"
              aria-checked={draft.debtEffect === e.value}
              className={
                draft.debtEffect === e.value
                  ? "fms-choice fms-choice--debt t-body-strong"
                  : "fms-choice fms-choice--debt t-body"
              }
              onClick={() => onChange(withDebtEffect(draft, e.value))}
            >
              {e.label}
            </button>
          ))}
        </div>
      </div>

      {check.problems.map((p) => (
        <p key={p} className="t-micro fms-proposalnote fms-proposalnote--stop">
          {p}
        </p>
      ))}
      {check.warnings.map((w) => (
        <p key={w} className="t-micro fms-proposalnote fms-proposalnote--warn">
          {w}
        </p>
      ))}

      <div className="fms-proposalactions">
        <Button
          size="sm"
          variant="primary"
          disabled={!check.ok}
          onClick={() => {
            sink.add(draft, { actor: "ai", via: "ai_chat" });
            onSettle();
          }}
        >
          Add to ledger
        </Button>
        <Button size="sm" onClick={() => sink.use(draft)}>
          Open in the form
        </Button>
        <Button size="sm" onClick={onSettle}>
          Discard
        </Button>
      </div>

      <p className="t-micro fms-proposalfrom">
        Which line and what it does are the two things nobody should guess at with borrowed money,
        so they are picked rather than read out of the sentence.
      </p>
    </div>
  );
}
