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
import { createPortal } from "react-dom";

import { Button, Money } from "../components/primitives";
import { PlainBox } from "../components/PlainBox";
import {
  amend,
  applyReply,
  usualAmountFor,
  leftoverFigure,
  detectAlsoIn,
  matchItem,
  nextQuestion,
  type Blank,
} from "../domain/capture";
import { readEntry, splitEntries } from "../domain/readEntry";
import { namedIn, partsTheModelMissed, readTotals, totalWords, withSaidItem, withoutTheTotal } from "../domain/entryTotals";
import { cashWallet, slipsIn, withdrawalSource } from "../domain/withdrawal";
import { cardAccount, cardSlipsIn } from "../domain/cardSlip";
import { checkCardSlips } from "../domain/proposal";
import { readReceipt } from "../domain/receipt";
import { Rich } from "../components/Rich";
import {
  saysLatestIsWrong,
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
  chartTopic,
  comparedPeriods,
  comparisonWorked,
  periodsSaid,
  wantsBothDirections,
  chartDirection,
  chartInWords,
  chartLabel,
  isChartFollowUp,
  asksChartColour,
  namesWindow,
  pointsAtScreen,
  asksForProse,
  wantsChart,
  overTime,
  asksPie,
  narrowsChart,
  saysOverTime,
  wantsStatement,
  withoutTheFilePart,
  type Chart,
  type ComparedPeriods,
} from "../domain/charts";
import { buildMeasureChart, chartHelps, chartReading, chartsWorked, inWords, localHint, measureOf, mergeHint, type ChartHint } from "../domain/chartAsk";
import { rampFor } from "../components/charts";
import { Icon } from "../components/Icon";
import { fileAsBefore } from "../domain/fileAsBefore";
import { asksAboutDeleted, deletedRows, deletedWindowIn, deletedWords, onlyAWindow } from "../domain/deletedAsk";
import { inferFromHistory } from "../domain/infer";
import { monthBills } from "../domain/budgetView";
import { debtWalletDirection, emptyDraft, itemsFor, withDebtEffect } from "../domain/entry";
import { allPaidScope, correctsWhatWasSaid, detectIntent, entriesInside, isAdvice, isBudgetCommand, isEssay, isPlan, isQuestion, meantInstead, notMeantIn, plainlyDone, sayInstead, wantsThoseEntries, type Intent } from "../domain/intent";
import { planWorked } from "../domain/planRate";
import { addressesEveryCard, asksToReadAgain, asksToRename, saysOneWasMissed, POINTS_ELSEWHERE, startsNewEntry, titleFrom, walletInside, WORDED_AS_CORRECTION } from "../domain/capture";
import { asksWhetherAdded, inLedgerOrNot } from "../domain/checkPicture";
import { kindSaidForAll } from "../domain/saidForAll";
import { modelLabel } from "../domain/modelName";
import { formatMoney, type Centavos } from "../domain/money";
import { describeFile, summariseFile } from "../domain/photoNote";
import { reconcile } from "../domain/reconcile";
import { readAgainst, statementAccount } from "../domain/statement";
import { useMediaQuery } from "./useMediaQuery";
import { ownNamesIn, senseStatementRows } from "../domain/statementSense";
import { allWalletBalances, walletBalance } from "../domain/balances";
import {
  draftForClue,
  investigate,
  investigationWords,
  linesFromDrafts,
  readHistory,
  type StatementLine,
} from "../domain/investigate";
import { buildSheet } from "../domain/statementSheet";
import { asksAboutAFile, exportWords, readExportAsk, sheetRequestOf, statementBrief, statementWords, withSheet, type ExportAsk } from "../domain/exportAsk";
import { readInvestigateAsk, type InvestigateAsk } from "../domain/investigateAsk";
import { affordAnswer, followsUpDecision, goesByBalance, isAffordQuestion, readAffordAsk } from "../domain/affordAsk";
import {
  duplicateHeadline,
  groupDuplicates,
  duplicatesOf,
  repeatsWithin,
  togetherAsOne,
  type Duplicate,
} from "../domain/duplicates";
import {
  classifyItem,
  extractProposals,
  itemsLastUsed,
  downSentence,
  routeMessage,
  type Intent as Routed,
} from "../data/aiClient";
import { chatStore } from "../data/chatStore";
import { readOriginal, readPicture } from "../data/ocr";
import { holdUpdates } from "../data/updateCheck";
import { useBackToClose } from "../data/backButton";
import { aiLogStore } from "../data/aiLogStore";
import { aiEvent, correctionsFrom, taughtFor, type AiEvent, type AttachmentNote } from "../domain/aiLog";
import { clauseFor, verifyReading } from "../domain/verify";
import { fitItem, itemOnList } from "../domain/onList";
import { carded, cardsIn, drawn, drew, proposed, said, type ChatMessage, type StoredCard } from "../domain/chat";
import { formatBytes, readFiles, totalBytes, type Attachment } from "../data/attachments";
import { useAi } from "./useAi";
import { currentScreen } from "./screenReport";
import { clearPick, currentPick, notePick } from "../chartPick";
import { asksAboutPick, pickAnswer, pickText } from "../domain/chartPick";
import { aboutTheScreen, screenText } from "../domain/screenContext";
import { figuresIn } from "../domain/money";
import { transactionToDraft } from "../domain/entry";
import { rowSavedFor } from "../domain/formSaved";
import type { Draft } from "../domain/entry";
import type { Proposal } from "../domain/proposal";
import { choicesFor, effectsFor, interestOnTop, outstandingOf, asAmountAndFees, owedParts, type Debt, type DebtEffect } from "../domain/debt";
import { BEHALF_EFFECTS, BEHALF_SIDE_LABEL, ON_BEHALF, effectInline, effectLabel, effectMeaning, type BehalfSide } from "../domain/debtWords";
import { debtCardIntro } from "../domain/debtSentence";
import { splitsWhose } from "../domain/behalfFor";
import { entryLineIn } from "../domain/intent";
import { fillDebt, personDebt } from "../domain/debtFill";
import { foldInterest } from "../domain/interestFold";
import { saysWhen } from "../domain/when";
import { lessonKey, lessonsFrom } from "../domain/learning";
import { AmountInput, Field as FormField } from "../components/forms";
import type { Provenance } from "../domain/activity";
import { imageLimits, type AppSettings } from "../domain/settings";
import type { BudgetYear, Budgets, DeletedTransaction, ReferenceLists, Transaction } from "../domain/types";
import { changeWords, planEdit, readEditAsk, type EditPlan } from "../domain/chatChanges";
import {
  asksRatherThanTells,
  confirmsProposal,
  isBudgetForm,
  namesBudgetCommand,
  planBudget,
  proposedBudgetIn,
  proposedMonthIn,
  readBudgetAsk,
  namesMoneyFigure,
  saysMoneyMoved,
  spanIn,
  type BudgetAsk,
  type BudgetPlan,
  type CardFigures,
  editedAsk,
} from "../domain/budgetAsk";
import { readSpendAsk, spendAnswer } from "../domain/spendAsk";
import { adviceMonthIn, adviceWords, asksBudgetAdvice, asksForTheSplit, budgetAdvice, expectedIncomeIn, savingsGoalIn, type BudgetAdvice } from "../domain/budgetAdvice";
import { asksSettingsChange, capabilitiesAnswer, SETTINGS_ARE_YOURS, wantsCapabilities } from "../domain/assistantScope";
import { budgetForYear } from "../domain/budget";
import { formatMedium, MONTH_NAMES } from "../domain/dates";
import { chatHistory, earlierSessions, keepInMind } from "../domain/memory";
import { alikeKey, answerCard, cardAnswerNote, cardQuestion, confirmsIncome, keepTheMoney, looksLikeAnswer, pendingChoices, SKIP_CARD, STOP_ASKING, whatChanged, type CardToAsk, type LineToName } from "../domain/cardQuestions";
import { discardedWords } from "../domain/discarded";
import { outlookFor } from "../domain/outlook";
import { withCommandWordsFixed } from "../domain/typos";
import { asksForWrongRows, flaggedRows } from "../domain/integrity";

/**
 * What the panel is allowed to do with a proposal.
 *
 * Deliberately narrow. The panel cannot save; it can ask the form to check a
 * draft, to load one, or to save one, and every one of those is implemented
 * in `AddTransaction` with the same functions the form itself uses.
 */
export interface ProposalSink {
  /** `extraDebts`: someone new the card will add in the same tap, so the check knows them. */
  readonly check: (draft: Draft, extraDebts?: readonly Debt[]) => {
    readonly ok: boolean;
    readonly problems: readonly string[];
    readonly warnings: readonly string[];
    /** Far larger than any row of its kind: how many times. The card asks twice before adding it. */
    readonly unusual?: number | undefined;
    /** A debt payment's two parts, what lowers the balance and what is interest. */
    readonly split?: { readonly principal: number; readonly interest: number } | undefined;
    /** What was borrowed plus the interest and fees already owed, read as one payment (`withFeesPaid`). */
    readonly feesPaid?: { readonly fees: number; readonly total: number } | undefined;
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
  /** Whether saved rows can be corrected from here. */
  readonly canUpdate: boolean;
  /** Correct saved rows, through the app's own correction path. */
  readonly update: (rows: readonly Transaction[], by?: Provenance) => void;
  /** Whether a budget can be set from here. */
  readonly canBudget: boolean;
  /** Replace a year's budget, as the Budget screen does. */
  readonly budget: (year: number, plan: BudgetYear, changes: readonly string[]) => void;
  /** Whether a person or lender can be added to the debt list from here. */
  readonly canAddDebt: boolean;
  /** Add someone to the debt list, as the Add form's "Someone new" does. */
  readonly addDebt: (debt: Debt) => void;
  /**
   * Hand over a file, the way the buttons on Settings and Statements do.
   *
   * The owner asked for every part to be reachable by saying it, and export
   * was the one that was not: a backup lives on Settings, a spreadsheet of
   * everything lives beside it, and a statement for one month lives on a
   * third screen. It goes to the browser's own download and nowhere else.
   */
  readonly exportFile: (ask: ExportAsk) => void;
}

/** Saved entries about to change: each one before, and after. */
interface Changing {
  readonly kind: "change";
  readonly plan: EditPlan;
  readonly state: "open" | "applied" | "discarded";
  /** Stable across a refresh. See `DebtChoice.cardId`. Given by `say` when missing. */
  readonly cardId?: string;
  /**
   * Came back from the record: the row ids and the fields that change, read
   * against the ledger as it is now rather than as it was when this was said.
   */
  readonly restored?: StoredChange;
}

/** A budget about to change. */
interface Budgeting {
  readonly kind: "budget";
  readonly plan: BudgetPlan;
  readonly state: "open" | "applied" | "discarded";
  /** What was asked, so an open card that comes back is worked out again against today's budget. */
  readonly ask?: BudgetAsk;
  readonly cardId?: string;
  /** Came back from the record. An open one is planned again before it can be applied. */
  readonly restored?: boolean;
  /** Where the figures came from, under the table: the income they are held to, a different figure the answer said. */
  readonly note?: string;
  /** Changed on the card by the owner. */
  readonly edited?: boolean;
}

/** A file the owner asked for, waiting to be saved. */
interface Exporting {
  readonly kind: "export";
  readonly ask: ExportAsk;
  readonly state: "open" | "applied" | "discarded";
  readonly cardId?: string;
}

/** A change card as it is kept: ids and fields, never whole rows. */
interface StoredChange {
  readonly rows: readonly {
    readonly id: string;
    /** The changed fields as they were. */
    readonly b: Partial<Transaction>;
    /** The changed fields as they will be. */
    readonly a: Partial<Transaction>;
  }[];
  readonly refused: readonly { readonly id: string; readonly reason: string }[];
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
   * They were said, read back to the model as history, and never written
   * down. Every card is kept now, so these are written like any other line
   * and come back beside the card they point at. The flag stays as a label
   * on the line; nothing reads it to leave a line out any more.
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
  /** An edit list that also offers the bin: "that last entry is a mistake" can mean either. */
  readonly alsoBin?: boolean;
  /** A whole named set, so the card offers one button for all of them. */
  readonly sweep?: boolean;
  /** Ids already acted on, so a button does not offer the same row twice. */
  readonly done: readonly string[];
  readonly cardId?: string;
  /**
   * Came back from the record: which rows, and why each matched.
   *
   * The rows are looked up in the ledger and the bin when the list is drawn,
   * not when it is loaded, because the conversation comes back before the
   * ledger has finished arriving, and a list resolved then would be empty.
   */
  readonly restored?: readonly { readonly id: string; readonly why: readonly string[] }[];
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
  /** Someone the sentence named who is not on the debt list yet, offered as a button. */
  readonly newPerson?: string | undefined;
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
  /**
   * What was read, and it never changes.
   *
   * This is the way back. It used to be overwritten while the card followed
   * the form, which destroyed the only copy of the entry as it was first
   * read: switching Transfer to Spending by accident cleared the wallet and
   * the status, the card followed it down, and "Put back in the form" had
   * nothing left to put back.
   */
  readonly proposal: Proposal;
  /**
   * What the form holds right now, while this card is the one in it.
   *
   * Separate from `proposal` on purpose. The card shows this, and adds this,
   * because it is what you can see; but the original above survives
   * underneath it, so an accidental change is always undoable.
   */
  readonly live?: Draft | undefined;
  /**
   * `used` keeps the card. Sending it to the form used to replace it with one
   * line of text, so the thing you had just asked to look at disappeared at
   * the moment you asked to look at it. It stays, marked, with its buttons
   * gone.
   */
  readonly state: "open" | "added" | "used" | "discarded";
  /**
   * When it was sent to the form, so a save in the form is matched only to
   * a card sent before it, never to one sent after (`lastSaved`).
   */
  readonly usedAt?: number;
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

type Turn = Said | Offered | Found | Drawn | DebtChoice | Changing | Budgeting | Exporting;

const isOffer = (t: Turn): t is Offered => t.kind === "proposal";

/** A card read off a picture or a statement, rather than from something typed. */
const readOffPicture = (p: Proposal): boolean =>
  // "user text" is what a model's card from a typed message is sourced to, kept by cards saved before `typed` was.
  // "the difference" is worked out from the ledger: a card from it was never in a picture (3 October 2026).
  !p.typed && !/^(user text|this message|the difference)\b/i.test(p.sourceRef.trim()) && (!p.said || /\b(image|picture|photo|screenshot|receipt|statement|part \d)/i.test(p.sourceRef));
const isFound = (t: Turn): t is Found => t.kind === "found";
const isChart = (t: Turn): t is Drawn => t.kind === "chart";
const isDebt = (t: Turn): t is DebtChoice => t.kind === "debt";
const isChanging = (t: Turn): t is Changing => t.kind === "change";
const isBudgeting = (t: Turn): t is Budgeting => t.kind === "budget";
const isExporting = (t: Turn): t is Exporting => t.kind === "export";

/**
 * A card still waiting, as it reads once it is thrown away; null for anything else.
 *
 * A debt card has no "discarded": it is settled, which is how pressing its
 * own close button leaves it.
 */
function closedCard(t: Turn): Offered | DebtChoice | Changing | Budgeting | Exporting | null {
  if (isOffer(t)) return t.state === "open" ? { ...t, state: "discarded" } : null;
  if (isDebt(t)) return t.state === "open" ? { ...t, state: "settled" } : null;
  if (isChanging(t) || isBudgeting(t) || isExporting(t)) return t.state === "open" ? { ...t, state: "discarded" } : null;
  return null;
}

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
    .map((t) => ({ role: t.kind, text: t.text.length > 500 ? `${t.text.slice(0, 500)}...` : t.text }));

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
  applied: "Applied",
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
/**
 * The conversation as stored, back into turns: the said lines in order, and
 * each card once, where it first appeared, in the state it ended in.
 */
function rebuildThread(all: readonly ChatMessage[], since: string | null): Turn[] {
  const history = since ? all.filter((m) => m.at > since) : [...all];

  /**
   * Cards come back where they were, in the state they ended in.
   *
   * A card that changed wrote a second message with the same id, so
   * the final state is worked out first and the card is then emitted
   * once, at its first appearance. Without that, a card added after
   * three corrections would come back four times.
   */
  const final = cardsIn(history);
  const rebuilt: Turn[] = [];
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
}

function turnFromCard(card: StoredCard): Turn {
  const draft = card.draft as unknown as Draft;
  const data = (card.data ?? {}) as Record<string, unknown>;
  const settled = (state: StoredCard["state"]): "open" | "applied" | "discarded" =>
    state === "open" ? "open" : state === "discarded" ? "discarded" : "applied";
  const list = <T,>(value: unknown): readonly T[] => (Array.isArray(value) ? (value as T[]) : []);

  if (card.kind === "found") {
    const shared = list<string>(data["why"]);
    const restored = list<{ id: string; why?: readonly string[] }>(data["rows"])
      .filter((r) => r && typeof r.id === "string")
      .map((r) => ({ id: r.id, why: r.why ? list<string>(r.why) : shared }));
    const action = data["action"];
    return {
      kind: "found",
      action: action === "edit" || action === "restore" || action === "bin" ? action : "bin",
      candidates: [],
      done: list<string>(data["done"]),
      ...(data["alsoBin"] === true ? { alsoBin: true } : {}),
      ...(data["sweep"] === true ? { sweep: true } : {}),
      cardId: card.id,
      restored,
    };
  }

  if (card.kind === "change") {
    return {
      kind: "change",
      plan: { rows: [], refused: [] },
      state: settled(card.state),
      cardId: card.id,
      restored: {
        rows: list<StoredChange["rows"][number]>(data["rows"]).filter((r) => r && typeof r.id === "string"),
        refused: list<StoredChange["refused"][number]>(data["refused"]).filter((r) => r && typeof r.id === "string"),
      },
    };
  }

  if (card.kind === "budget") {
    const ask = data["ask"] as BudgetAsk | undefined;
    const year = typeof ask?.year === "number" ? ask.year : new Date().getFullYear();
    const skipped = typeof data["skipped"] === "number" ? data["skipped"] : 0;
    return {
      kind: "budget",
      plan: {
        year,
        outcome: {
          plan: budgetForYear({}, year),
          written: [],
          skipped: Array.from({ length: skipped }, (_, i) => i + 1),
          revisions: [],
        },
        words: typeof data["words"] === "string" ? data["words"] : "A change to the budget.",
        changes: list<string>(data["changes"]),
      },
      state: settled(card.state),
      ...(ask ? { ask } : {}),
      ...(typeof data["note"] === "string" && data["note"] ? { note: data["note"] } : {}),
      cardId: card.id,
      restored: true,
    };
  }

  if (card.kind === "export") {
    const ask = data["ask"] as ExportAsk | undefined;
    if (!ask || typeof ask.kind !== "string") return { kind: "assistant", text: "A file was offered here.", from: "this device" };
    return { kind: "export", ask, state: settled(card.state), cardId: card.id };
  }

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
      ...(card.typed ? { typed: true } : {}),
    },
    state,
    cardId: card.id,
    ...(card.recordNumber === undefined ? {} : { recordNumber: card.recordNumber }),
  };
}

/** The fields of a row that a change touches, before and after. */
function changedFields(before: Transaction, after: Transaction): { b: Partial<Transaction>; a: Partial<Transaction> } {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    const was = (before as unknown as Record<string, unknown>)[key];
    const now = (after as unknown as Record<string, unknown>)[key];
    if (JSON.stringify(was) === JSON.stringify(now)) continue;
    b[key] = was ?? null;
    a[key] = now ?? null;
  }
  return { b: b as Partial<Transaction>, a: a as Partial<Transaction> };
}

/**
 * How many rows a kept list may name.
 *
 * A message is held to 4,000 characters by the rule, and a row id with its
 * JSON around it is about thirty. A sweep of more than this still says how
 * many it was in the sentence above it, and still moves every one of them.
 */
const MOST_KEPT_ROWS = 100;

/** A card as it goes into the record. Null for a turn that is not a card. */
function storedFrom(turn: Turn): StoredCard | null {
  if (isOffer(turn)) {
    return {
      id: turn.cardId,
      kind: "proposal",
      state: turn.state,
      // Once saved, what was saved: a card corrected in the form comes back as the row it became.
      draft: (turn.state === "added" ? (turn.live ?? turn.proposal.draft) : turn.proposal.draft) as unknown as Record<string, unknown>,
      sourceRef: turn.proposal.sourceRef,
      confidence: turn.proposal.confidence,
      adjustments: turn.proposal.adjustments,
      ...(turn.proposal.said ? { said: turn.proposal.said } : {}),
      ...(turn.proposal.typed ? { typed: true } : {}),
      ...(turn.recordNumber === undefined ? {} : { recordNumber: turn.recordNumber }),
    };
  }
  if (isDebt(turn)) {
    return { id: turn.cardId, kind: "debt", state: turn.state, draft: turn.draft as unknown as Record<string, unknown> };
  }
  if (!("cardId" in turn) || !turn.cardId) return null;

  if (isFound(turn)) {
    const rows =
      turn.candidates.length > 0
        ? turn.candidates.map((c) => ({ id: c.row.id, why: c.why }))
        : (turn.restored ?? []);
    const whys = new Set(rows.map((r) => r.why.join(", ")));
    const shared = whys.size === 1 ? rows[0]?.why : undefined;
    const kept = rows.slice(0, MOST_KEPT_ROWS);
    return {
      id: turn.cardId,
      kind: "found",
      state: kept.length > 0 && kept.every((r) => turn.done.includes(r.id)) ? "applied" : "open",
      draft: {},
      data: {
        action: turn.action,
        rows: kept.map((r) => (shared ? { id: r.id } : { id: r.id, why: r.why })),
        ...(shared ? { why: shared } : {}),
        done: turn.done.filter((id) => kept.some((r) => r.id === id)),
        ...(turn.alsoBin ? { alsoBin: true } : {}),
        ...(turn.sweep ? { sweep: true } : {}),
      },
    };
  }

  if (isChanging(turn)) {
    const change: StoredChange =
      turn.plan.rows.length > 0 || turn.plan.refused.length > 0
        ? {
            rows: turn.plan.rows.map((r) => ({ id: r.before.id, ...changedFields(r.before, r.after) })),
            refused: turn.plan.refused.map((r) => ({ id: r.row.id, reason: r.reason })),
          }
        : (turn.restored ?? { rows: [], refused: [] });
    return { id: turn.cardId, kind: "change", state: turn.state, draft: {}, data: { ...change } };
  }

  if (isBudgeting(turn)) {
    return {
      id: turn.cardId,
      kind: "budget",
      state: turn.state,
      draft: {},
      data: {
        ...(turn.ask ? { ask: turn.ask } : {}),
        ...(turn.note ? { note: turn.note } : {}),
        words: turn.plan.words,
        changes: turn.plan.changes,
        skipped: turn.plan.outcome.skipped.length,
      },
    };
  }

  if (isExporting(turn)) {
    return { id: turn.cardId, kind: "export", state: turn.state, draft: {}, data: { ask: turn.ask } };
  }

  return null;
}

/** What a card says in words, for anyone reading the record without the card. */
function cardWords(turn: Turn, state: StoredCard["state"]): string {
  if (isOffer(turn)) {
    const d = turn.proposal.draft;
    return `${CARD_WORD[state]}: ${d.date} ${d.flow} ${d.item} ${formatMoney(d.amount ?? 0)}`;
  }
  if (isDebt(turn)) return `${CARD_WORD[state]}: ${turn.draft.date} Debt ${formatMoney(turn.draft.amount ?? 0)}`;
  if (isFound(turn)) {
    const n = turn.candidates.length || turn.restored?.length || 0;
    const verb = turn.action === "edit" ? "to edit" : turn.action === "restore" ? "to restore" : "to move to the bin";
    return `${n} ${n === 1 ? "entry" : "entries"} found ${verb}.`;
  }
  if (isChanging(turn)) {
    const words = turn.plan.rows.map(changeWords).join("; ");
    return `${state === "applied" ? "Changed" : state === "discarded" ? "Left as it was" : "A change to saved entries"}${words ? `: ${words}` : "."}`;
  }
  if (isBudgeting(turn)) return `${state === "applied" ? "Budget set" : state === "discarded" ? "Budget left as it was" : "Budget change"}: ${turn.plan.words}`;
  if (isExporting(turn)) return `${state === "applied" ? "File saved" : state === "discarded" ? "File not saved" : "File offered"}: ${turn.ask.said}`;
  return "";
}

/*
 * Ten turns, each cut at 500 characters. Six lost the thread of an ordinary
 * back and forth ("can you read your own history, so it feels real", 27
 * September 2026); the cut keeps a long answer from crowding out the rest.
 */
const HISTORY_TURNS = 10;

/** "based on my income", "within my allowance", "income and spending": a budget held to what usually comes in. */
const BY_INCOME =
  /\b(?:based on|base(?:d)? sa|from|within|fit(?:s|ting)?(?: in| into| to)?|according to)\s+(?:my\s+|the\s+|ang\s+)?(?:usual\s+|monthly\s+)?(?:income|allowance|salary|sahod|kita|earnings)\b|\bincome and (?:spending|expenses|gastos)\b/i;

/** Asked to set a budget, not only told one: "can you set a plan", "adjust my budget this month". */
const SETS_BUDGET = /\b(?:set|adjust\w*|make|create|build|plan|apply|update|change|fix|redo|gawa\w*|ayusin)\b/i;

/** The recommendation's own words, without the line saying how to get the card that is already under it. */
const withoutSetIt = (text: string): string => text.replace(/\s*Say "set it"[^.]*\.\s*/g, " ").replace(/\s{2,}/g, " ").trim();

/** Asking what it should be, which the answer gives and "add it" applies. */
const ASKS_ONLY = /\b(?:re?c+om+e?n?d\w*|sug+est\w*|propos\w*|should i|what budget|how much should)\b/i;

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
  formDraft,
  ownerName = "",
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
  lastSaved: { draft: Draft; at: number; recordNumber?: number } | null;
  /**
   * What the form beside this holds, right now.
   *
   * The card sent to the form was a photograph of the entry at the moment it
   * was sent. Change the amount in the form from PHP 1,000.00 to PHP
   * 10,000.00 and the card went on saying PHP 1,000.00, so the two halves of
   * one entry disagreed on screen and the owner had no way to tell which one
   * was about to be saved.
   */
  formDraft?: Draft | undefined;
  /** The name the owner signed in with, which is how their bank prints them on a statement. */
  ownerName?: string;
}) {
  /**
   * Gated on its own setting, not on the Insights panel's.
   *
   * It was reading `insightSummary`, so switching off the summary on the
   * Insights screen silently switched off the conversation here: every
   * follow-up came back with "I cannot read your question without the
   * model" while the model was perfectly available.
   */
  const ai = useAi({ settings, transactions, budgets, reference, feature: "chat", asOf, deleted });

  /**
   * A computer's screen, where a card shows every field and a copy is set
   * beside the row it repeats. The phone keeps the three line summary: the
   * owner asked for both, "the ui in phone and pc should be different. more
   * detailed it pc" (27 September 2026).
   */
  const wide = useMediaQuery("(min-width: 1024px)");

  const [turns, setTurns] = useState<Turn[]>([]);

  /**
   * The last message that was answered as a question and had entries in it.
   *
   * Kept so "add them" has something to point at. A ref rather than state:
   * nothing on screen depends on it, and a render for it would be a render
   * for nothing.
   */
  const entriesLeftBehind = useRef<string | null>(null);
  /**
   * A message the assistant asked about rather than guessed at ("I paid all
   * my balances": which ones?). The short reply after it is read into it.
   */
  const clarifying = useRef<string | null>(null);

  /**
   * What this conversation put in the bin, newest first.
   *
   * Live, 20 September 2026: a row was binned from the chat, and the next
   * message, "restore it", came back with "nothing in the bin matches that.
   * There are 144 entries in it." A search needs words to look for, and "it"
   * has none: what it points at is the thing that just happened, which only
   * the conversation knows.
   */
  const binnedHere = useRef<string[]>([]);

  /**
   * The card in the form follows the form.
   *
   * ── Why the card's own draft moves, rather than just its display ────────
   *
   * Showing the live figure while the buttons still held the old one would be
   * worse than the staleness it fixes: the card would read PHP 10,000.00 and
   * Add to ledger would save PHP 1,000.00. So the card's draft is what moves.
   * Everything downstream then agrees by construction: the fields, the
   * checks, the warning about extra zeros, and the figure on the button.
   *
   * ── Why a cleared form stops it ─────────────────────────────────────────
   *
   * An empty form is not an edit, it is the entry being put down, and a card
   * that followed it there would erase the only remaining copy of what was
   * read. So clearing stops the tracking and the card keeps what it last
   * held, which is what makes "Put back in the form" a way back from a Clear
   * pressed by accident.
   *
   * Only the most recent card sent to the form, because only one entry can be
   * in the form at a time. Older ones keep what they held.
   */
  useEffect(() => {
    if (!formDraft) return;

    const empty =
      formDraft.amount === null &&
      formDraft.item.trim() === "" &&
      formDraft.description.trim() === "";
    /*
     * An emptied form with nothing saved is the edit called off. 4 October
     * 2026, the owner on a phone: "i cancel editing it manually but it look
     * like this", a card still reading "In the form" and "Following the form
     * beside this" over a form that held nothing. The card is open again, as
     * it was read, with Add to ledger and Edit first on it. Released in the
     * effect below, once a save has had its chance to claim it.
     */
    if (empty) return;

    setTurns((prev) => {
      let at = -1;
      for (let i = prev.length - 1; i >= 0; i -= 1) {
        const t = prev[i];
        if (t && isOffer(t) && t.state === "used") {
          at = i;
          break;
        }
      }
      if (at < 0) return prev;

      const card = prev[at];
      if (!card || !isOffer(card)) return prev;
      // Same entry, so nothing to do. Without this the effect would set state
      // on every render and never settle.
      const showing = card.live ?? card.proposal.draft;
      if (JSON.stringify(showing) === JSON.stringify(formDraft)) return prev;

      // Only `live` moves. The reading stays where it is, so there is always
      // something to go back to.
      return prev.map((t, i) => (i === at && isOffer(t) ? { ...t, live: formDraft } : t));
    });
  }, [formDraft]);
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  // Pictures waiting or an answer on its way: a new version waits until they are done (data/updateCheck.ts).
  useEffect(() => {
    holdUpdates("ask", files.length > 0 || busy);
    return () => holdUpdates("ask", false);
  }, [files.length, busy]);

  /**
   * What is happening right now, in words.
   *
   * "Thinking" sat there unchanged for as long as the work took, whether it
   * was routing a sentence, reading a receipt, counting entries or waiting on
   * a provider. It is the same word for every one of those, so it says
   * nothing, and after ten seconds of it the honest question is whether
   * anything is happening at all.
   *
   * Every word this shows is set at the point the work it names really
   * starts, and none of them is on a timer pretending to be progress. The
   * one thing that is time based is the "still" wording, which is true by
   * construction: it only appears while the same call is still running.
   */
  const [stage, setStage] = useState("");

  /**
   * Run something, saying what it is while it runs.
   *
   * `still` replaces the words once the call has been going for eight
   * seconds. That is not a second phase invented to look busy: the first
   * phase has not finished, and the new words say exactly that.
   */
  const during = async <T,>(words: string, run: () => Promise<T>, still?: string): Promise<T> => {
    setStage(words);
    const timer = still === undefined ? undefined : setTimeout(() => setStage(still), 8_000);
    try {
      return await run();
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };
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
    /**
     * The sentence the questions are about, and the entry as first read.
     *
     * The card an answer finishes was keyed on the answer ("food"), so the
     * sentence it answered was lost: nothing was learned, the description
     * was blank, and "bought kwek kwek 45 cash" asked the same question as
     * "bought kwek kwek 60 cash" had a minute before.
     */
    said: string;
    first: Draft;
  } | null>(null);
  /**
   * The cards a picture made that need an answer, and the one just asked
   * about. One card at a time, like a person going down the list with you
   * (domain/cardQuestions.ts).
   */
  const [asking, setAsking] = useState<{
    readonly cards: readonly CardToAsk[];
    readonly at: number;
    readonly blank: Blank;
    /** Cards the owner said skip to, with the rows like them, never asked again. */
    readonly skipped: ReadonlySet<string>;
    /** The question, shown above the box while it waits. */
    readonly text: string;
    /** Its answers, as buttons, and which question of how many it is. */
    readonly choices: readonly string[];
    readonly count: string;
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
  /**
   * Counts Stop and Clear this view, so an answer to something called off is
   * dropped when it lands rather than shown.
   *
   * 28 September 2026: "why that number?" was stopped at 08:53:48, said
   * "Stopped. Nothing was saved.", and its answer appeared anyway at
   * 08:54:20, under a question asked after it. Stop only aborted picture
   * reads; a chat question ran on regardless.
   */
  const generation = useRef(0);

  /** Abandon whatever is in flight and hand the box back. */
  const stop = (): void => {
    generation.current += 1;
    stopper.current?.abort();
    stopper.current = null;
    setBusy(false);
    setStage("");
    say({
      kind: "assistant",
      ephemeral: true,
      text: "Stopped. Nothing was saved.",
      from: "this device",
    });
  };
  /** An attachment being looked at full size. Session only, never stored. */
  const [previewing, setPreviewing] = useState<Attachment | null>(null);
  // Back closes a picture shown full size (data/backButton.ts).
  useBackToClose(previewing !== null, () => setPreviewing(null));
  /** What has been corrected before, so the same guess is not made twice. */
  /**
   * The corrections, kept as events rather than as a finished lookup.
   *
   * Working them out here, against the current lists, is what stops a
   * correction to a field value being applied as if it taught something about
   * the word. Kept raw because the lists can change while the panel is open.
   */
  const [learnedEvents, setLearnedEvents] = useState<readonly AiEvent[]>([]);

  const learnedItems = useMemo(
    () =>
      correctionsFrom(learnedEvents, "item", [
        ...reference.spendingTypes.map((s) => s.name),
        ...reference.bills,
        ...reference.subscriptions,
        ...reference.revenueCategories,
      ]),
    [learnedEvents, reference],
  );
  /** The wallets corrected before, keyed on the words, never on a wallet's own name. */
  const learnedFrom = useMemo(
    () => correctionsFrom(learnedEvents, "fromWallet", [...reference.wallets, ...reference.savings]),
    [learnedEvents, reference],
  );
  const learnedTo = useMemo(
    () => correctionsFrom(learnedEvents, "toWallet", [...reference.wallets, ...reference.savings]),
    [learnedEvents, reference],
  );

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
      .recentOnce()
      .then((events) => {
        if (live) setLearnedEvents(events);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [uid]);
  const threadRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLInputElement>(null);
  /** The phone's camera, opened straight to taking a picture (owner, 26 September 2026). */
  const cameraRef = useRef<HTMLInputElement>(null);

  /**
   * Mark a card added once the form saves the row it supplied.
   *
   * Matched on the fields that identify an entry rather than on a token: the
   * draft may have been corrected in the form before saving, and it is still
   * the same card. The date, the amount and the item agreeing is enough, and
   * a wrong match here costs a label, never a row.
   */
  /*
   * ── Saved, and said so everywhere ───────────────────────────────────────
   *
   * 29 September 2026: a Mang Inasal receipt's card was sent to the form,
   * corrected there and saved as #3859, and the card still read "In the form"
   * with Add to ledger on it; pressing Put back in the form then filled the
   * form with the reading again, a copy of #3859. The card was marked added
   * on this screen only and never written down, so the chat on any other
   * screen, or this one after a reload, brought it back as waiting.
   *
   * So the change is recorded like any other settling, with the number the
   * row was given, and it is looked for again whenever the conversation
   * changes: a chat that was not open when the form saved (the phone's AI
   * tab, the chat on another screen) finds its card once it has loaded. Only
   * a card sent to the form before the save, so a later one of the same
   * figure is never taken for it.
   */
  useEffect(() => {
    if (!lastSaved) return;
    const saved = lastSaved.draft;
    /*
     * The card the form was following, when there is one. Matched on the
     * item as well, it missed exactly the cards worth learning from: the ones
     * whose item was corrected in the form before saving.
     */
    const same = (t: Turn): t is Offered => {
      if (!isOffer(t) || t.state !== "used") return false;
      if (t.usedAt !== undefined && t.usedAt > lastSaved.at) return false;
      const shown = t.live ?? t.proposal.draft;
      const first = t.proposal.draft;
      const matches = (d: Draft): boolean => d.date === saved.date && d.amount === saved.amount && d.flow === saved.flow;
      return matches(shown) || matches(first);
    };
    const card = [...turns].reverse().find(same);
    if (!card) return;
    learnFrom(card, saved);
    const added: Offered = {
      ...card,
      state: "added",
      live: saved,
      ...(lastSaved.recordNumber !== undefined ? { recordNumber: lastSaved.recordNumber } : {}),
    };
    recordCard(added);
    setTurns((prev) => prev.map((t) => (isOffer(t) && t.cardId === card.cardId ? added : t)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastSaved, turns]);

  /*
   * The form emptied with no save behind it: the edit was called off, so the
   * card is open again (see the follow effect above). Never a card the form
   * saved, by the save the form reported or by a row the ledger already has:
   * that one is added, and opening it again would invite the same row twice.
   */
  useEffect(() => {
    if (!formDraft) return;
    const empty = formDraft.amount === null && formDraft.item.trim() === "" && formDraft.description.trim() === "";
    if (!empty) return;
    // Not in the moment between Edit first and the form filling, when it is still empty.
    const settledIn = (card: Offered): boolean => card.usedAt === undefined || Date.now() - card.usedAt > 1_500;
    const inForm = turns.filter((t): t is Offered => isOffer(t) && t.state === "used" && !addedCards.current.has(t.cardId) && settledIn(t));
    if (inForm.length === 0) return;
    const savedByForm = (card: Offered): boolean => {
      if (!lastSaved || (card.usedAt !== undefined && card.usedAt > lastSaved.at)) return false;
      const s0 = lastSaved.draft;
      return [card.live ?? card.proposal.draft, card.proposal.draft].some((d) => d.date === s0.date && d.amount === s0.amount && d.flow === s0.flow);
    };
    const back = inForm.filter(
      (card) => !savedByForm(card) && !rowSavedFor(card.cardId, [card.live ?? card.proposal.draft, card.proposal.draft], transactions, new Set()),
    );
    if (back.length === 0) return;
    const ids = new Set(back.map((c) => c.cardId));
    for (const card of back) recordCard({ ...card, state: "open", live: undefined });
    setTurns((prev) => prev.map((t) => (isOffer(t) && ids.has(t.cardId) ? { ...t, state: "open", live: undefined } : t)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formDraft, turns, lastSaved, transactions]);

  /*
   * A card still in the form whose row the ledger already has, saved after
   * it while this chat was not open to hear of it (domain/formSaved.ts).
   */
  useEffect(() => {
    /*
     * Not a card the form's own save has just settled. Both run on the same
     * update, so a card saved from the form was written down as added twice,
     * once as the form held it and once as the ledger row, and the chat
     * record carried two "Added" lines for one row (#3860, #3865, #3876 on
     * 30 September to 2 October 2026).
     */
    const waiting = turns.filter((t): t is Offered => isOffer(t) && t.state === "used" && !addedCards.current.has(t.cardId));
    if (waiting.length === 0) return;
    const claimed = new Set<string>();
    const settledNow = new Map<string, Offered>();
    for (const card of waiting) {
      const row = rowSavedFor(card.cardId, [card.live ?? card.proposal.draft, card.proposal.draft], transactions, claimed);
      if (!row) continue;
      claimed.add(row.id);
      const added: Offered = { ...card, state: "added", live: transactionToDraft(row), recordNumber: row.recordNumber };
      recordCard(added);
      settledNow.set(card.cardId, added);
    }
    if (settledNow.size === 0) return;
    setTurns((prev) => prev.map((t) => (isOffer(t) && settledNow.has(t.cardId) ? (settledNow.get(t.cardId) ?? t) : t)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turns, transactions]);

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
   * Whether the thread has been put at the latest message yet.
   *
   * A refresh restores the whole conversation in one render, and the rules
   * below only hold the view at the end when it is already near the end. On
   * the render where the history arrives the view is at the top, so that is
   * where it stayed: the owner opened the panel above months of conversation
   * and had to scroll all the way down to what they were last reading.
   *
   * Once, on the first render that has anything in it. After that the rules
   * below own the position again, so following along still follows and
   * reading something further up still holds still.
   */
  const landed = useRef(false);

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

  /*
   * Whether the view was at the end before this change, kept as it happens.
   *
   * Measured after the change, a reply and a card arriving together were
   * taller than the tolerance by themselves, so the view read as scrolled
   * away and stopped: a budget card's Apply sat under the message box until
   * it was scrolled to (3 October 2026). What counts is where the owner was,
   * so it is noted on every scroll and after every placement.
   */
  const atEnd = useRef(true);
  const distanceToEnd = (thread: HTMLElement): number => thread.scrollHeight - thread.scrollTop - thread.clientHeight;
  const noteScroll = (): void => {
    const thread = threadRef.current;
    if (thread) atEnd.current = distanceToEnd(thread) <= NEAR_BOTTOM;
  };

  useLayoutEffect(() => {
    const thread = threadRef.current;
    if (!thread) return;

    const anchor = held.current;
    held.current = null;
    const follow = atEnd.current;

    const placed = ((): boolean => {
      if (anchor) {
        const el = cardElements.current.get(anchor.index);
        if (el) {
          thread.scrollTop = Math.max(0, thread.scrollTop + topWithin(el, thread) - anchor.offset);
          return true;
        }
      }
      // The restored conversation, opened at its latest message.
      if (!landed.current && turns.length > 0) {
        landed.current = true;
        thread.scrollTop = thread.scrollHeight;
        return true;
      }
      return false;
    })();

    if (!placed && follow) thread.scrollTop = thread.scrollHeight;
    atEnd.current = distanceToEnd(thread) <= NEAR_BOTTOM;
  }, [turns, busy]);

  /*
   * The thread itself changing size: the bar under it grows or shrinks once
   * an answer is in, and the view was left 52px short of the end, a card's
   * buttons under the message box. At the end stays at the end.
   */
  useEffect(() => {
    const thread = threadRef.current;
    if (!thread || typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(() => {
      if (atEnd.current) thread.scrollTop = thread.scrollHeight;
    });
    watch.observe(thread);
    return () => watch.disconnect();
  }, []);

  /*
   * The card a question is about, brought into view. With a batch of
   * twenty four the question would otherwise be about a card the owner has
   * to go looking for.
   */
  const askedCard = asking ? asking.cards[asking.at]?.cardId : undefined;
  useEffect(() => {
    const thread = threadRef.current;
    if (!askedCard || !thread) return;
    const index = turns.findIndex((t) => isOffer(t) && t.cardId === askedCard);
    const el = cardElements.current.get(index);
    if (el) thread.scrollTop = Math.max(0, thread.scrollTop + topWithin(el, thread) - 8);
    // Only when the question moves to another card, not on every change to the thread.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askedCard]);

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
  /**
   * The last thing written for each card, so the same state is not written twice.
   *
   * Pressing "Put back in the form" six times in a second wrote six identical
   * "Sent to the form" messages, which then read in the record as six entries.
   */
  const lastRecorded = useRef(new Map<string, string>());
  /** The last question about the bin, so a period said alone after it ("last month?") narrows the same list. */
  const lastDeletedAsk = useRef<string | null>(null);
  /**
   * The rows the last picture showed, all of them, and the account they
   * moved: "wait my original balance is 176.56" after a Maya history is
   * Maya's, and its rows are the history to check the ledger against, those
   * already in as much as those added (2 October 2026).
   */
  const lastRead = useRef<{ readonly account: string; readonly drafts: readonly Draft[]; readonly at: number } | null>(null);
  /** Cards already written down as added, so a second path never writes the same one again. */
  const addedCards = useRef(new Set<string>());

  const recordCard = (turn: Offered | DebtChoice | Found | Changing | Budgeting | Exporting): void => {
    const card = storedFrom(turn);
    if (!card) return;
    if (card.state === "added") addedCards.current.add(card.id);

    const signature = JSON.stringify(card);
    if (lastRecorded.current.get(card.id) === signature) return;
    lastRecorded.current.set(card.id, signature);

    void chatStore(uid)
      .record(proposed(card, cardWords(turn, card.state)))
      .catch(() => {});
  };

  /**
   * A debt card, with the line and the amount filled where only one answer fits.
   *
   * "I paid my credit" names the one credit line and the Debt screen already
   * knows what is due on it. Every path that makes a debt card comes through
   * here, so a model reading and the rules reading end in the same card.
   */
  const debtCard = (draft: Draft, text: string): { turn: DebtChoice; notes: readonly string[] } => {
    const fill = fillDebt(draft, text, debts, transactions, [...reference.wallets, ...reference.savings], asOf);
    return {
      turn: {
        kind: "debt",
        draft: fill.draft,
        state: "open",
        cardId: newCardId(),
        ...(fill.newPerson ? { newPerson: fill.newPerson } : {}),
      },
      notes: fill.newPerson
        ? [...fill.notes, `**${fill.newPerson}** is not on your debt list yet. Press **Add ${fill.newPerson}** on the card and every movement with them adds up in one place.`]
        : fill.notes,
    };
  };

  /**
   * Each card as it was first read, by card id.
   *
   * What the owner changed before saving is the lesson, so the first reading
   * has to outlive the card's own edits.
   */
  const firstRead = useRef(new Map<string, Draft>());

  /** Learn from a card whose row was saved: every field changed is a lesson (domain/learning.ts). */
  const learnFrom = (turn: Offered, saved: Draft): void => {
    const first = firstRead.current.get(turn.cardId) ?? turn.proposal.draft;
    const lessons = lessonsFrom(first, saved, turn.proposal.said ?? "", reference);
    if (lessons.length === 0) return;
    for (const lesson of lessons) log(lesson);
    // Used from the next sentence on, not from the next visit.
    setLearnedEvents((prev) => [...prev, ...lessons]);
  };

  const say = (given: Turn): void => {
    // Every card gets an id it keeps across a refresh, so its later states replay onto it.
    const turn: Turn =
      (isFound(given) || isChanging(given) || isBudgeting(given) || isExporting(given)) && !given.cardId
        ? { ...given, cardId: newCardId() }
        : given;
    if (isOffer(turn) && !firstRead.current.has(turn.cardId)) firstRead.current.set(turn.cardId, turn.proposal.draft);
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
    if (isOffer(turn) || isDebt(turn) || isFound(turn) || isChanging(turn) || isBudgeting(turn) || isExporting(turn)) {
      recordCard(turn);
      return;
    }

    /*
     * A line said beside a card or a question is kept too.
     *
     * These were left out because the card they pointed at was not kept, and
     * a reload brought back "Apply it on the card" with no card under it.
     * Every card is kept now, so the line and its card come back together,
     * and leaving the line out was the other half of the same gap: "How much
     * was it?" and "I could not find an entry in that" were on screen, and
     * gone after a refresh (the owner, 26 September 2026).
     */

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
   * Loaded into an empty thread, so a reload picks up where you left off
   * without a conversation already in progress being pushed down by its own
   * history.
   *
   * Twice: first the copy this device holds, which is there at once, then
   * the server's, which replaces it only while the thread is still just that
   * history. Asking the server first left the phone's AI screen empty for
   * seconds after every refresh (the owner, 26 September 2026).
   */
  const shownHistory = useRef<Turn[] | null>(null);
  /** Every saved message, cleared or not, for what earlier sessions said (`domain/memory.ts`). */
  const savedChat = useRef<readonly ChatMessage[]>([]);
  /**
   * The conversation as another device left it, waiting for this one to be
   * free: never over an answer on its way, a question waiting for its reply,
   * or a card being asked about (data/chatStore.ts, `watch`).
   */
  const remoteThread = useRef<Turn[] | null>(null);
  const idle = useRef(true);
  idle.current = !busy && pending === null && asking === null;
  const takeRemote = (): void => {
    const next = remoteThread.current;
    if (!next || !idle.current) return;
    remoteThread.current = null;
    shownHistory.current = next;
    setTurns(next);
  };
  useEffect(() => {
    takeRemote();
    // Only when this device becomes free.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, pending, asking]);
  useEffect(() => {
    let live = true;
    const since = clearedAt();

    const rebuild = (all: readonly ChatMessage[]): Turn[] => rebuildThread(all, since);

    // Worked out once, outside the updater: React may call an updater twice.
    const show = (all: readonly ChatMessage[]): void => {
      if (!live) return;
      savedChat.current = all;
      const rebuilt = rebuild(all);
      if (rebuilt.length === 0) return;
      const was = shownHistory.current;
      shownHistory.current = rebuilt;
      setTurns((prev) => (prev.length === 0 || prev === was ? rebuilt : prev));
    };

    const store = chatStore(uid);
    void store
      .cached()
      .then(show)
      .catch(() => {})
      .finally(() => {
        void store.recent().then(show).catch(() => {});
      });
    // Said on the other device: shown here as it is said.
    const stop = store.watch((all) => {
      if (!live) return;
      savedChat.current = all;
      const rebuilt = rebuild(all);
      if (rebuilt.length === 0) return;
      remoteThread.current = rebuilt;
      takeRemote();
    });
    return () => {
      live = false;
      stop();
    };
  }, [uid]);

  /**
   * What became of a card, on screen and in the record.
   *
   * ── Why the write is out here and not inside the updater ───────────────
   *
   * A state updater must be pure. React calls it more than once in
   * development, and may re-invoke it under concurrent rendering, so a
   * database write inside one is a write that happens an unpredictable
   * number of times. The same mistake made the card replay drop every card
   * earlier today, which is how I know what it looks like when it bites.
   *
   * The turn is read from `turns` instead, which is the same value the
   * updater would have seen: nothing else settles a card, so there is no
   * newer state to miss.
   */
  const settle = (index: number, state: Offered["state"], recordNumber?: number): void => {
    const at = Date.now();
    const change = (t: Offered): Offered => ({
      ...t,
      state,
      ...(recordNumber === undefined ? {} : { recordNumber }),
      ...(state === "used" ? { usedAt: at } : {}),
    });

    const was = turns[index];
    if (was && isOffer(was)) recordCard(change(was));

    setTurns((prev) => prev.map((t, i) => (i === index && isOffer(t) ? change(t) : t)));
  };

  /**
   * Throw away every open card, and mean it.
   *
   * ── Why this is a function and not three copies of one line ─────────────
   *
   * Discarding a card one at a time went through `settle`, which calls
   * `recordCard` and writes the new state to the database. Discarding all of
   * them did not: all three bulk paths, the button and the two typed
   * commands, only called `setTurns`. The cards went grey on screen and
   * nothing was written, so the next refresh loaded them back from the
   * database exactly as they were, still open.
   *
   * The owner hit this on 21 September 2026: "I dicarded them all then
   * refresh then they are back." Work thrown away that reappears is worse
   * than work that was never thrown away, because the second time you are
   * not sure whether you already dealt with it.
   *
   * The button also logged nothing, so a batch thrown away never reached the
   * record the coderview calls "the list to fix next". Every discard is a
   * rejection now, however many went at once.
   */
  /*
   * Every kind of card, not only entries.
   *
   * 26 September 2026: "when I discard all or discard something then I
   * refresh some of them returning back". Only entry cards were written as
   * thrown away. A debt, budget, change or file card still open was set
   * aside on screen and nowhere else, so it came back open on the next load.
   */
  const discardEveryOpen = (said?: string): number => {
    let count = 0;
    for (const t of turns) {
      const closed = closedCard(t);
      if (!closed) continue;
      count += 1;
      if (isOffer(t)) {
        const d = t.proposal.draft;
        log(
          aiEvent("rejected", "add", {
            entry: `${d.date} ${d.flow} ${d.item} ${formatMoney(d.amount ?? 0)}`,
            ...(said ? { text: said } : {}),
          }),
        );
      }
      // The write that was missing. Without it the card comes back.
      recordCard(closed);
    }

    setTurns((prev) => prev.map((t) => closedCard(t) ?? t));
    setAsking(null);
    return count;
  };

  /**
   * Everything the conversation was holding, let go with it.
   *
   * 28 September 2026: "Clear this view" emptied the screen and nothing
   * else. A question still in flight answered into the empty view, an entry
   * still waiting on "which wallet?" took the next message as its answer, and
   * "set it" could reach a recommendation no longer on screen. A cleared
   * view is a new conversation, so nothing from before it is waited on.
   */
  const forgetConversation = (): void => {
    generation.current += 1;
    stopper.current?.abort();
    stopper.current = null;
    setBusy(false);
    setStage("");
    setPending(null);
    setAsking(null);
    entriesLeftBehind.current = null;
    clarifying.current = null;
    binnedHere.current = [];
    lastAdvice.current = null;
    budgetQuestion.current = null;
    renaming.current = null;
    lastPictures.current = [];
    lastWasPicture.current = false;
  };

  /** The credit lines an answer can name ("borrowed on Maya Credit"): not the people money is held for. */
  const creditLines: readonly LineToName[] = debts
    .filter((d) => !d.archived && d.form !== "pass-through")
    .map((d) => ({ id: d.id, name: d.name, wallet: d.wallet }));

  /** Every item name the ledger and the lists use, for "how much did I spend on food" (`spendAsk.ts`). */
  const knownItems = useMemo(
    () => [
      ...new Set(
        [
          ...transactions.map((t) => t.item.trim()),
          ...reference.spendingTypes.map((s) => (typeof s === "string" ? s : s.name).trim()),
          ...reference.bills,
          ...reference.subscriptions,
        ].filter((name) => name !== ""),
      ),
    ],
    [transactions, reference],
  );
  /** When each item was last used, so the reader is told which ones are years old (aiClient.ts). */
  const lastUsed = useMemo(() => itemsLastUsed(transactions), [transactions]);

  /**
   * The owner's own name, as a statement prints it: the one they signed in
   * with, and any they have filed as their own before. "Received money from"
   * it is money moved between their accounts (domain/statementSense.ts).
   */
  const ownNames = useMemo(
    () => [...(ownerName.trim() && !ownerName.includes("@") ? [ownerName.trim()] : []), ...ownNamesIn(transactions)],
    [ownerName, transactions],
  );

  /** The card a correction would apply to: the last one still open. */
  const openCard = (): { index: number; turn: Offered } | null => {
    for (let i = turns.length - 1; i >= 0; i--) {
      const turn = turns[i];
      if (turn && isOffer(turn) && turn.state === "open") return { index: i, turn };
    }
    return null;
  };

  /**
   * The card at `index`, changed, arriving again at the bottom under what was
   * said, as the corrections further down do: the same card, keeping its id.
   */
  const reviseCard = (index: number, turn: Offered, draft: Draft, what: string, said: string): void => {
    const proposal = { ...turn.proposal, draft, adjustments: [...turn.proposal.adjustments, what] };
    recordCard({ ...turn, proposal, state: "open", live: undefined });
    setTurns((prev) => [
      ...prev.filter((_, i) => i !== index),
      { kind: "you", text: said },
      { kind: "proposal", proposal, state: "open", cardId: turn.cardId },
    ]);
  };

  /** Mark one found row as dealt with, so its button does not offer twice. */
  const settleFound = (index: number, ...ids: readonly string[]): void => {
    const was = turns[index];
    // Kept, like a card's state, so a row binned from this list is not offered again after a refresh.
    if (was && isFound(was)) recordCard({ ...was, done: [...was.done, ...ids] });
    setTurns((prev) =>
      prev.map((t, i) =>
        i === index && isFound(t) ? { ...t, done: [...t.done, ...ids] } : t,
      ),
    );
  };

  /**
   * A change, budget or file card decided, on screen and in the record.
   *
   * Written from `turns` rather than inside the updater, for the reason given
   * at `settle`: an updater must be pure.
   */
  const decide = (index: number, state: "applied" | "discarded"): void => {
    const was = turns[index];
    if (was && (isChanging(was) || isBudgeting(was) || isExporting(was))) recordCard({ ...was, state });
    setTurns((prev) =>
      prev.map((t, i) => (i === index && (isChanging(t) || isBudgeting(t) || isExporting(t)) ? { ...t, state } : t)),
    );
  };

  /**
   * A card that came back from the record, read against the ledger as it is now.
   *
   * Only the ids and the changed fields are kept, so the rows are looked up
   * here, when the card is drawn, rather than when the conversation loaded:
   * the conversation arrives before the ledger does, and a list resolved at
   * load time came back empty. A row that has since gone from both the
   * ledger and the bin simply drops out of the card.
   */
  const current = (turn: Turn): Turn => {
    if (isFound(turn) && turn.restored && turn.candidates.length === 0) {
      const everywhere = new Map<string, Transaction>();
      for (const row of deleted) everywhere.set(row.id, row);
      for (const row of transactions) everywhere.set(row.id, row);
      const candidates = turn.restored.flatMap(({ id, why }, n) => {
        const row = everywhere.get(id);
        return row ? [{ row, score: 100 - n, why: [...why] }] : [];
      });
      return { ...turn, candidates };
    }
    if (isChanging(turn) && turn.restored && turn.plan.rows.length === 0 && turn.plan.refused.length === 0) {
      const byId = new Map(transactions.map((t) => [t.id, t] as const));
      const rows = turn.restored.rows.flatMap(({ id, b, a }) => {
        const row = byId.get(id);
        return row ? [{ before: { ...row, ...b } as Transaction, after: { ...row, ...a } as Transaction }] : [];
      });
      const refused = turn.restored.refused.flatMap(({ id, reason }) => {
        const row = byId.get(id);
        return row ? [{ row, reason }] : [];
      });
      return { ...turn, plan: { rows, refused } };
    }
    if (isBudgeting(turn) && turn.restored && turn.state === "open" && turn.ask) {
      // Planned again against today's budget: the month may have closed, or the change been made since.
      const plan = planBudget(turn.ask, budgets, asOf, new Date().toISOString());
      if (plan.outcome.refused) return { ...turn, plan: { ...turn.plan, words: `${turn.plan.words} ${plan.outcome.refused}` }, state: "discarded" };
      if (plan.outcome.written.length === 0) return { ...turn, state: "applied" };
      return { ...turn, plan };
    }
    return turn;
  };

  /** The month after the one `asOf` is in. */
  const nextOf = (day: string): { year: number; month: number } => {
    const y = Number(day.slice(0, 4));
    const m = Number(day.slice(5, 7));
    return m === 12 ? { year: y + 1, month: 1 } : { year: y, month: m + 1 };
  };

  /** The last budget this device recommended, so "set it" takes both parts and "the separation" shows them. */
  const lastAdvice = useRef<{ advice: BudgetAdvice; text: string; asked: string } | null>(null);
  /** The budget question just asked, so the next message can answer it. */
  const budgetQuestion = useRef<{ year: number; month: number; toMonth?: number; scope: "month" | "rest" | "year" } | null>(null);

  /** A total, its parts and what was said about all of them, in a typed message (domain/entryTotals.ts). */
  const totalsIn = (text: string) => {
    const totals = readTotals(text);
    return {
      totals,
      item: namedIn(
        totals.restated,
        reference.spendingTypes.map((t) => t.name),
      ),
      words: totalWords(totals, formatMoney),
    };
  };
  const saidItemWords = (item: string): string => `Booked as ${item}: you said they were all ${item}.`;
  /** A reading filed under the kind the owner said they all were, saying so. */
  const fileAsSaid = <R extends { draft: Draft; because: readonly string[] }>(read: R, item: string | null): R => {
    const filed = withSaidItem(read, item);
    return filed === read ? read : { ...filed, because: [...read.because.filter((b) => !/^Booked as /.test(b)), saidItemWords(item ?? "")] };
  };

  /**
   * What the Budget screen's forecast plans for a month: the figure "use the
   * forecast" means. The same usual month (`domain/outlook.ts`), read from
   * the same months, so the chat and the screen give one figure.
   */
  const forecastFor = (year: number, month: number): { spending: number; billsSubs: number } | null => {
    const nowYear = Number(asOf.slice(0, 4));
    // A month already running or over has no forecast, only what it spent.
    if (year * 12 + month <= nowYear * 12 + Number(asOf.slice(5, 7))) return null;
    const o = outlookFor(transactions, budgets, year, month, asOf, { stopped: settings.stopped ?? [], debts, readBefore: nextOf(asOf) });
    return o.read.length > 0 && o.total > 0 ? { spending: o.spending, billsSubs: o.billsSubs } : null;
  };

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
        /*
         * The side each card's money moves on. A borrowing lands in a wallet;
         * putting the wallet on its "from" side as well made "Maya -> Maya",
         * which moves nothing, and two Maya Credit borrowings were saved that
         * way on 27 September 2026.
         */
        const side = draft.flow === "Debt" ? debtWalletDirection(draft.debtEffect) : draft.flow === "Revenue" ? "in" : "out";
        if (side === "none") return t;
        const wants = side === "in" ? "toWallet" : "fromWallet";
        if (draft[wants]) return t;
        const value = source.fromWallet || source.toWallet;
        if (!value) return t;
        const other = side === "in" ? "fromWallet" : "toWallet";
        return { ...t, proposal: { ...t.proposal, draft: { ...draft, [wants]: value, ...(draft.flow === "Debt" ? { [other]: "" } : {}) } } };
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
  /**
   * The pictures last sent, this session, for reading again when asked.
   *
   * 28 September 2026: "Read it", "Read the receipt" and "look at the
   * receipt" were each sent with no picture attached, reached the chat, and
   * were told it "cannot read a physical receipt", or were given a receipt
   * that was never there. The picture was a message above. Kept in memory
   * only, like every picture: nothing is stored.
   */
  const lastPictures = useRef<readonly Attachment[]>([]);
  /** The last message was those pictures, so a bare "again" means them. */
  const lastWasPicture = useRef(false);
  /**
   * "Change the title" was asked with no words after it: the next message is
   * the title, for the entry waiting on a question or for this card.
   */
  const renaming = useRef<"pending" | { readonly cardId: string } | null>(null);

  const attach = async (given: ArrayLike<File> | null): Promise<void> => {
    if (!given || given.length === 0) return;
    /*
     * Copied now. The picker is cleared straight after it hands the files
     * over, and a FileList is live: by the time the files were read it was
     * empty, so the full-size original of a long screenshot was never found
     * and only the shrunk copy, where no letter is legible, was read.
     */
    const picked = Array.from(given);
    const { attachments, rejected } = await readFiles(picked, files, limits);

    const seenAgain = attachments.filter(
      (a) => a.digest !== undefined && sentBefore.current.has(a.digest),
    );

    if (attachments.length > 0) setFiles((prev) => [...prev, ...attachments]);
    /*
     * Read now, on this device, while the note is still being typed: by the
     * time Send is pressed the text is ready and only the AI step is left
     * (data/ocr.ts). Nothing is sent anywhere by this.
     */
    for (const a of attachments) {
      if (a.kind !== "image" || !a.dataUrl) continue;
      // The file as it arrived, not the copy shrunk for sending: a long screenshot is only legible at full size.
      const original = picked.find((f) => f.name === a.name);
      if (original) void readOriginal(a.digest ?? a.dataUrl, original);
      else void readPicture(a.dataUrl, a.digest);
    }
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
    /** What the reading is checked against, when not the words it came from. */
    against?: string,
  ): Promise<CardToAsk | null> => {
    // Steps 2 and 3 below are the work this names: your corrections, then the
    // ledger and Settings. It is set here because it starts here.
    setStage("Checking it against your ledger");
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
    // Matched on the words that carry the meaning, not on the whole sentence:
    // the figure changes every time and an exact lookup never fired twice.
    const taught = said ? taughtFor(said, learnedItems) : undefined;
    const flow = proposal.draft.flow;
    /*
     * The list the taught item is on decides the category: an item corrected
     * to a bill is a bill next time, even when the reading said Spending.
     */
    const taughtCategory: Draft["category"] | null =
      !taught || !flow
        ? null
        : flow === "Revenue"
          ? reference.revenueCategories.includes(taught) ? proposal.draft.category : null
          : flow === "Spending"
            ? reference.bills.includes(taught)
              ? "Bills"
              : reference.subscriptions.includes(taught)
                ? "Subscriptions"
                : reference.spendingTypes.some((s) => s.name === taught)
                  ? "Spending"
                  : null
            : null;
    const teachable = taught !== undefined && taughtCategory !== null;

    const accounts = [...reference.wallets, ...reference.savings];
    const taughtFrom = said ? taughtFor(said, learnedFrom) : undefined;
    const taughtTo = said ? taughtFor(said, learnedTo) : undefined;
    const fromTaught =
      !proposal.draft.fromWallet && taughtFrom && accounts.includes(taughtFrom) && (flow === "Spending" || flow === "Transfer")
        ? taughtFrom
        : "";
    const toTaught =
      !proposal.draft.toWallet && taughtTo && accounts.includes(taughtTo) && (flow === "Revenue" || (flow === "Transfer" && !proposal.draft.sentOut))
        ? taughtTo
        : "";

    // The words that named it, as the description, when the reading wrote none.
    const named = proposal.draft.description.trim() ? "" : lessonKey(said, reference);
    const start: Draft = {
      ...proposal.draft,
      ...(named ? { description: named } : {}),
      ...(teachable ? { item: taught, category: taughtCategory } : {}),
      ...(fromTaught ? { fromWallet: fromTaught } : {}),
      ...(toTaught ? { toWallet: toTaught } : {}),
    };
    const learned = [
      ...(teachable ? [`Booked as ${taught}, which is what you corrected this to last time.`] : []),
      ...(fromTaught ? [`Paid from ${fromTaught}, which is what you corrected this to last time.`] : []),
      ...(toTaught ? [`Into ${toTaught}, which is what you corrected this to last time.`] : []),
    ];

    /**
     * ── Step 3 of 4: the ledger, then Settings ─────────────────────────
     *
     * Asking a question the ledger already answers is the assistant failing
     * to read its own data. `readEntry` has already done this pass on the
     * offline path, so it says so rather than having it run twice.
     */
    /*
     * A card read off a picture has no typed words to go by, so its own
     * description is read for the item when the reading left the item blank:
     * two Maya cashback notifications asked "What was it?" though every
     * cashback before them was Random (28 September 2026).
     */
    /*
     * On the owner's own lists before anything else reads the item: a kind
     * they do not have is put back on one of theirs, or left for the ledger,
     * a model and then the owner to fill. Saving it as typed made a row no
     * list, total or filter knows (3 October 2026, `domain/onList.ts`).
     */
    const fitted = fitItem(start, against ?? proposal.said ?? clauseFor(hint, start.amount, reference), reference, learnedItems);
    const onTheirList = fitted.draft;
    const historyHint = onTheirList.item.trim() || !onTheirList.description.trim() || hint.toLowerCase().includes(onTheirList.description.trim().toLowerCase()) ? hint : `${hint} ${onTheirList.description}`.trim();
    const { draft, because } = useHistory
      ? inferFromHistory(onTheirList, transactions, reference, historyHint)
      : { draft: onTheirList, because: learned };

    /**
     * ── Between step 3 and step 4: check the reading against what was said ─
     *
     * Everything above this line builds the row: the model reads the
     * sentence, your corrections are applied, then the ledger and Settings
     * fill and constrain it. Every one of those steps checks a field against
     * a list. None of them looks back at the sentence.
     *
     * So a row could pass every check and still be wrong about the message,
     * which is the failure the owner kept hitting: the right shape built from
     * the wrong half of what they said. This asks the questions only the
     * sentence can answer. Did you write a larger figure than the one that
     * was read. Did you name a wallet other than this one. Did you name one
     * of your own items other than this one. Is it dated after today. And is
     * every field this flow needs actually filled in.
     *
     * It changes nothing and refuses nothing: every answer is a line on the
     * card, beside the field it is about, and `checkDraft` is still the only
     * thing that can stop a save. A reading with a question over it drops to
     * low confidence, which is what the card already uses to say "look at
     * this one".
     *
     * No second call to the model. These are answerable from the sentence and
     * your own lists, which is string matching and arithmetic: it runs in
     * well under a millisecond, with no key and no network, and it cannot be
     * wrong about the ledger in the way a model can.
     */
    const checked = verifyReading(
      draft,
      // The clause this row came from, not the whole message. A card the
      // model returned carries no `said`, so it is worked out from the
      // amount; see `clauseFor`.
      against ?? proposal.said ?? clauseFor(hint, draft.amount, reference),
      reference,
      asOf,
      proposal.confidence,
    );

    const filled: Proposal = {
      ...proposal,
      draft,
      confidence: checked.confidence,
      adjustments: [
        // One reason, said once: the ledger agreeing with a lesson is not a second note about the same item.
        ...proposal.adjustments.filter((note) => !(teachable && note.startsWith(`Booked as ${taught}`))),
        ...(fitted.note ? [fitted.note] : []),
        ...(useHistory ? [...learned, ...because] : because),
        ...checked.notes,
      ],
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
      say(debtCard(filled.draft, hint).turn);
      return null;
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

    /*
     * A bill at a fraction of what it costs is not that bill. Maya's "Globe
     * ₱50.00" was filed as Globe at Home Wifi, which is ₱999.00 every month
     * (27 September 2026): it was load. Filed as the bill it would have
     * marked the month's wifi paid. Left for the owner to say what it was.
     */
    const billed = ready.draft;
    if ((billed.category === "Bills" || billed.category === "Subscriptions") && billed.item.trim() && billed.amount !== null) {
      const usual = usualAmountFor(billed, transactions);
      if (usual !== null && usual >= billed.amount * 3) {
        ready = {
          ...ready,
          draft: { ...billed, item: "", category: "Spending" },
          confidence: "low",
          adjustments: [
            ...ready.adjustments,
            `${formatMoney(billed.amount)} is far below what ${billed.item} costs (usually ${formatMoney(usual)}), so it was not filed as that ${billed.category === "Bills" ? "bill" : "subscription"}. Say what it was for.`,
          ],
        };
      }
    }

    // Whatever filled the item since, it is one of theirs or it is left empty.
    const still = fitItem(ready.draft, "", reference, learnedItems);
    if (still.note) ready = { ...ready, draft: still.draft, adjustments: [...ready.adjustments, still.note] };

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

    /*
     * Not for a row of a batch. The hint there was the whole message ("add
     * these"), and a model reading the picture already had their list and
     * chose to leave it blank, which is what the questions after the batch
     * are for (domain/cardQuestions.ts).
     */
    if (wantsItem && ready.draft.flow && !ai.disabled && !batch) {
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

    const asked = batch ? null : nextQuestion(ready.draft, reference, settled);

    if (!asked) {
      const cardId = newCardId();
      say({ kind: "proposal", proposal: ready, state: "open", cardId });
      log(
        aiEvent("proposed", "add", {
          entry: `${ready.draft.date} ${ready.draft.flow} ${ready.draft.item} ${formatMoney(ready.draft.amount ?? 0)}`,
          model: ready.sourceRef,
        }),
      );
      return { cardId, draft: ready.draft };
    }
    setPending({ draft: ready.draft, blank: asked.blank, settled, said: proposal.said ?? hint, first: ready.draft });
    say({ kind: "assistant", ephemeral: true, text: asked.question, from: "this device" });
    return null;
  };

  /**
   * Ask about the next card from `from` on that still needs something.
   *
   * `known` holds a card's draft that the screen has not caught up with yet:
   * the one an answer has just changed. A card added or discarded meanwhile
   * is passed over.
   */
  const askFrom = (
    cards: readonly CardToAsk[],
    from: number,
    known: ReadonlyMap<string, Draft> = new Map(),
    skipped: ReadonlySet<string> = new Set(),
  ): void => {
    for (let i = from; i < cards.length; i += 1) {
      const card = cards[i];
      if (!card || skipped.has(card.cardId)) continue;
      const shown = turns.find((t): t is Offered => isOffer(t) && t.cardId === card.cardId);
      if (shown && shown.state !== "open") continue;
      const draft = known.get(card.cardId) ?? shown?.proposal.draft ?? card.draft;
      const q = cardQuestion(draft, reference, i + 1, cards.length, card.confirm ? { lines: creditLines.map((l) => l.name) } : undefined);
      if (!q) continue;
      /*
       * Asked once, in the bar above the box, with its answers as buttons.
       * It was said in the thread as well, the same words twice on screen.
       */
      setAsking({ cards, at: i, blank: q.blank, skipped, text: q.text, choices: q.choices, count: q.count });
      return;
    }
    setAsking(null);
    if (from > 0) {
      say({ kind: "assistant", ephemeral: true, text: "That was the last question. Check the cards, then add them.", from: "this device" });
    }
  };

  /**
   * A reply to a question about one card of a batch.
   *
   * False when it is not an answer, so the message goes on to be read as
   * whatever else it is: a correction, a question, a new entry.
   */
  const answerAsked = async (note: string): Promise<boolean> => {
    if (!asking) return false;
    const card = asking.cards[asking.at];
    const shown = card ? turns.find((t): t is Offered => isOffer(t) && t.cardId === card.cardId) : undefined;
    if (!card || !shown || shown.state !== "open") {
      setAsking(null);
      return false;
    }
    if (STOP_ASKING.test(note)) {
      setDraft("");
      say({ kind: "you", text: note });
      setAsking(null);
      say({ kind: "assistant", ephemeral: true, text: "No more questions. What each card still needs is marked on it.", from: "this device" });
      return true;
    }
    if (SKIP_CARD.test(note)) {
      setDraft("");
      say({ kind: "you", text: note });
      // The rows like it are skipped with it: the same question about the same shop is the same answer.
      const sameAs = alikeKey(shown.proposal.draft);
      const twins = asking.cards.filter((c) => {
        const t = turns.find((u): u is Offered => isOffer(u) && u.cardId === c.cardId);
        return sameAs !== "" && alikeKey(t?.proposal.draft ?? c.draft) === sameAs;
      });
      askFrom(asking.cards, asking.at + 1, new Map(), new Set([...asking.skipped, card.cardId, ...twins.map((c) => c.cardId)]));
      return true;
    }

    const before = shown.proposal.draft;
    /*
     * The model reads the answer, with the row and the question it answers;
     * the device holds it to the row and applies it (domain/cardQuestions.ts).
     * The rules below it are what is left when no model can be reached.
     */
    let filled: Draft | null = null;
    let readBy = "this device";
    if (!ai.disabled) {
      const read = await extractProposals({
        note: cardAnswerNote(before, asking.text, note),
        attachments: [],
        reference,
        asOf,
        lastUsed,
      });
      const first = read.source === "model" ? read.proposals[0] : undefined;
      if (first) {
        filled = keepTheMoney(before, first.draft);
        readBy = modelLabel(read.model ?? "") || "the model";
      }
    }
    const byModel = filled !== null;
    filled ??= answerCard(before, asking.blank, note, reference, transactions, creditLines);
    if (!filled) return false;
    // Answered: money in is not asked about again for being money in.
    const cards = asking.cards.map((c) => (c.cardId === card.cardId ? { ...c, confirm: false } : c));

    /*
     * Borrowed, not earned: the card becomes a debt card in its place, with
     * the line and the wallet filled and the lender's fees left to add. The
     * old card is closed and recorded, so it does not come back on refresh.
     */
    if (filled.flow === "Debt") {
      setDraft("");
      say({ kind: "you", text: note });
      const { turn: debt } = debtCard(filled, note);
      const closed = closedCard(shown);
      if (closed) recordCard(closed);
      recordCard(debt);
      setTurns((prev) => prev.map((t) => (isOffer(t) && t.cardId === card.cardId ? debt : t)));
      say({ kind: "assistant", ephemeral: true, text: whatChanged(before, filled), from: readBy });
      askFrom(cards, asking.at + 1, new Map(), asking.skipped);
      return true;
    }

    // Not one of their kinds by name: a model says which one it is, as for a single entry.
    const flow = filled.flow;
    if (!byModel && asking.blank === "item" && flow === before.flow && (flow === "Spending" || flow === "Revenue") && !ai.disabled) {
      if (!matchItem(note, flow, filled.category, reference, learnedItems).matched) {
        const known = itemsFor(flow, filled.category, reference);
        const withNotes = known.map((name) => ({
          name,
          remark: reference.spendingTypes.find((t) => t.name === name)?.remark ?? "",
        }));
        const guessed = await classifyItem(note, withNotes);
        if (guessed) filled = { ...filled, item: guessed.item };
      }
    }
    // One of their kinds, or the card is left to pick one: never a kind made up on the way (`domain/onList.ts`).
    const kept = fitItem(filled, note, reference, learnedItems);
    filled = kept.draft;

    setDraft("");
    say({ kind: "you", text: note });
    const what = [whatChanged(before, filled), kept.note].filter(Boolean).join(" ");

    /*
     * The same answer for the rows like it still to come: five cash backs
     * from Maya, or two payments to the same shop, are one question, not
     * five. Only rows with the same kind and the same words, waiting on the
     * same blank.
     */
    const answered = filled;
    const sameAs = alikeKey(before);
    const alike = sameAs
      ? asking.cards.slice(asking.at + 1).flatMap((c) => {
          const t = turns.find((u): u is Offered => isOffer(u) && u.cardId === c.cardId);
          if (!t || t.state !== "open" || alikeKey(t.proposal.draft) !== sameAs) return [];
          if (cardQuestion(t.proposal.draft, reference, 1, 1)?.blank !== asking.blank) return [];
          // The same answer, held to this row's own day, amount and words.
          const row = t.proposal.draft;
          return [{ turn: t, draft: keepTheMoney(row, { ...answered, description: row.description }) }];
        })
      : [];

    const changes = [{ turn: shown, draft: filled }, ...alike].filter((c) => whatChanged(c.turn.proposal.draft, c.draft) !== "");
    const updated = new Map(
      changes.map((c) => [
        c.turn.cardId,
        {
          ...c.turn,
          proposal: { ...c.turn.proposal, draft: c.draft, adjustments: [...c.turn.proposal.adjustments, whatChanged(c.turn.proposal.draft, c.draft)] },
        } satisfies Offered,
      ]),
    );
    setTurns((prev) => prev.map((t) => (isOffer(t) ? updated.get(t.cardId) ?? t : t)));
    for (const turn of updated.values()) recordCard(turn);
    /*
     * The field's own values, as every other correction is written. The whole
     * row went here once, and "2026-09-15 Revenue" was learned as a phrase
     * meaning the item "2026-09-15 Revenue //fix this".
     */
    const valueOf = (d: Draft): string => (asking.blank === "amount" ? (d.amount === null ? "" : formatMoney(d.amount)) : d[asking.blank]);
    if (valueOf(before) !== valueOf(filled)) {
      log(
        aiEvent("edited", "add", {
          field: asking.blank,
          proposed: valueOf(before),
          corrected: valueOf(filled),
          entry: `${filled.date} ${filled.flow} ${filled.item} ${formatMoney(filled.amount ?? 0)}`,
        }),
      );
    }
    const others = changes.length - (updated.has(card.cardId) ? 1 : 0);
    const told = [
      what || "That did not change the card, so it stays as it is. Fix it on the card if it needs it.",
      others > 0 ? `The same for the ${others === 1 ? "other row" : `other ${others} rows`} like it.` : "",
    ].filter(Boolean).join(" ");
    say({ kind: "assistant", ephemeral: true, text: told, from: readBy });

    // The same card again when the answer opened a new blank (a transfer from which account); the next when not.
    const again = cardQuestion(filled, reference, asking.at + 1, cards.length);
    const stuck = again !== null && again.blank === asking.blank;
    const known = new Map<string, Draft>([[card.cardId, filled], ...alike.map((a) => [a.turn.cardId, a.draft] as const)]);
    askFrom(cards, stuck ? asking.at + 1 : asking.at, known, asking.skipped);
    return true;
  };

  /*
   * The card being asked about was added or discarded from its own buttons:
   * the question moves on to the next card that needs something, or goes
   * away when none does. Add all leaves nothing to ask about.
   */
  useEffect(() => {
    if (!asking) return;
    const card = asking.cards[asking.at];
    const shown = card ? turns.find((t): t is Offered => isOffer(t) && t.cardId === card.cardId) : undefined;
    if (!shown || shown.state === "open") return;
    const more = asking.cards.slice(asking.at + 1).some((c) => {
      const t = turns.find((u): u is Offered => isOffer(u) && u.cardId === c.cardId);
      return t?.state === "open" && !asking.skipped.has(c.cardId) && cardQuestion(t.proposal.draft, reference, 1, 1, c.confirm ? { lines: [] } : undefined) !== null;
    });
    if (more) askFrom(asking.cards, asking.at + 1, new Map(), asking.skipped);
    else setAsking(null);
    // Only when the cards change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turns]);

  /** An answer to the question the assistant just asked. */
  const answerPending = async (reply: string): Promise<void> => {
    if (!pending) return;
    say({ kind: "you", text: reply });

    let filled = applyReply(pending.draft, pending.blank, reply, reference, transactions);
    /*
     * No figure in the reply, and one left in the message it was asked about:
     * that is the answer ("add it", "you already know it").
     */
    let fromMessage: number | null = null;
    if (!filled && pending.blank === "amount") {
      const taken = turns.flatMap((t) =>
        isOffer(t) ? [t.proposal.draft.amount, t.proposal.draft.fee] : isDebt(t) ? [t.draft.amount, t.draft.charges] : [],
      );
      fromMessage = leftoverFigure(pending.said, taken);
      if (fromMessage !== null) filled = { ...pending.draft, amount: fromMessage };
    }
    /*
     * A wallet, when the question was what it was for: "cash", 28 September
     * 2026, twice. Kept on the entry, and the question asked again, rather
     * than the same question with nothing said about the answer.
     */
    if (!filled && pending.blank === "item" && (pending.draft.flow === "Spending" || pending.draft.flow === "Revenue")) {
      const wallet = walletInside(reply, [...reference.wallets, ...reference.savings]);
      const rest = wallet
        ? reply
            .toLowerCase()
            .replace(wallet.toLowerCase(), " ")
            .replace(/\b(?:from|using|via|thru|in|into|to|sa|gamit|my|the|wallet|account|only|lang|po)\b|[^a-z0-9]+/g, " ")
            .trim()
        : "x";
      if (wallet && !rest) {
        const side = pending.draft.flow === "Revenue" ? "toWallet" : "fromWallet";
        setPending({ ...pending, draft: { ...pending.draft, [side]: wallet } });
        say({ kind: "assistant", text: `${side === "toWallet" ? "Into" : "From"} ${wallet}. What was it for?`, from: "this device" });
        return;
      }
    }
    if (!filled) {
      say({
        kind: "assistant",
        text:
          pending.blank === "amount"
            ? figuresIn(reply).length > 1
              ? `That reads as ${figuresIn(reply).length} separate amounts (${figuresIn(reply)
                  .map((c) => formatMoney(c))
                  .join(", ")}), not one. Send each one on its own with what it was for, such as "wifi 999".`
              : "I could not find a figure in that. Type only the amount, like 900, or say never mind to drop this entry."
            : pending.blank === "item"
              ? "What was it for?"
              : `That is not one of your accounts. ${[...reference.wallets, ...reference.savings].join(", ")}`,
        from: "this device",
      });
      return;
    }

    // Answered with what it was for rather than which kind: not asked again, the card offers the kinds.
    const settledNow: readonly Blank[] =
      pending.blank === "item" && !filled.item.trim() ? [...pending.settled, "item"] : pending.settled;
    const asked = nextQuestion(filled, reference, settledNow);
    if (asked) {
      setPending({ ...pending, draft: filled, blank: asked.blank, settled: settledNow });
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
      /*
       * "read it", "look at the product name": what it was is what the card
       * already says, from the receipt or the message, not the reply.
       */
      const pointing = POINTS_ELSEWHERE.test(reply);
      const about = pointing ? [complete.description, pending.said].filter((s) => s.trim()).join(". ") || reply : reply;
      const local = matchItem(about, complete.flow, complete.category, reference, learnedItems);
      if (local.matched && pointing) {
        complete = { ...complete, item: local.item };
      } else if (!local.matched && !ai.disabled) {
        const known = itemsFor(complete.flow, complete.category, reference);
        const withNotes = known.map((name) => ({
          name,
          remark: reference.spendingTypes.find((t) => t.name === name)?.remark ?? "",
        }));
        const guessed = await classifyItem(about, withNotes);
        if (guessed) {
          complete = { ...complete, item: guessed.item };
          because.push(`"${about.trim().slice(0, 60)}" reads as ${guessed.item}, going by what it is.`);
        }
      }

      /**
       * Decided from the item that will actually be saved: one of their
       * kinds, or left for them to pick on the card. A reply that named no
       * kind of theirs was saved as a new one and said so, and nothing put it
       * on any list (3 October 2026, `domain/onList.ts`).
       */
      const kept = fitItem(complete, about, reference, learnedItems);
      complete = kept.draft;
      if (kept.note) because.push(kept.note);
    }
    // The words that named it, as the description, when nothing else wrote one.
    const named = pending.said ? lessonKey(pending.said, reference) : "";
    if (!complete.description.trim() && named) complete = { ...complete, description: named };

    const cardId = newCardId();
    // Learned from when it is saved: what was blank before the answers is what was taught.
    firstRead.current.set(cardId, pending.first);
    say({
      kind: "proposal",
      proposal: {
        draft: complete,
        confidence: "high",
        sourceRef: "what you told me",
        said: pending.said || reply,
        adjustments: fromMessage !== null ? [`${formatMoney(fromMessage)}, the figure in your message that no other card took.`, ...because] : because,
      },
      state: "open",
      cardId,
    });
  };

  /** Read the attached files into proposals. Returns false when there were none. */
  const readAttached = async (note: string, again?: readonly Attachment[]): Promise<boolean> => {
    const sent = again ? [...again] : files;
    if (!again) setFiles([]);
    // Kept for "read it again" and "look at the receipt", which name no file (see READ_AGAIN).
    const pictures = sent.filter((a) => a.kind === "image" && a.dataUrl);
    if (pictures.length > 0) lastPictures.current = pictures;
    lastWasPicture.current = pictures.length > 0;

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
    const read = await during(
      sent.length > 0 ? "Reading what you sent" : "Working out the entry",
      () =>
        extractProposals({
          note,
          attachments: sent,
          reference,
          asOf,
          signal: control.signal,
          lastUsed,
          ownNames,
        }),
      "Still reading it",
    );
    stopper.current = null;
    // A screenful of daily interest is one entry, not sixty cards (domain/interestFold.ts).
    const folded = foldInterest(read.proposals, transactions, reference);
    /*
     * A typed message that names no day is today's, whatever the model dated
     * it (domain/when.ts). Pictures keep the dates printed on them.
     */
    const today = sent.length === 0 && note.trim() !== "" && !saysWhen(note);
    const dated = today
      ? folded.map((p) =>
          p.draft.date === asOf
            ? p
            : { ...p, draft: { ...p.draft, date: asOf }, adjustments: [...p.adjustments, "Dated today: your message named no day."] },
        )
      : folded;
    /*
     * A total and its parts (domain/entryTotals.ts): a card that is only the
     * total of the others is the same money twice, and "All school category"
     * files each one as School.
     */
    const typed = sent.length === 0 && note.trim() !== "" ? totalsIn(note) : null;
    const result = {
      ...read,
      proposals: (typed ? withoutTheTotal(dated, typed.totals).cards : dated).map((p) => {
        if (!typed) return p;
        const filed = withSaidItem(p, typed.item);
        return filed === p ? { ...p, typed: true } : { ...filed, typed: true, adjustments: [...p.adjustments, saidItemWords(typed.item ?? "")] };
      }),
    };
    /** Read on this device and then by a text model, said wherever the answer is (data/aiClient.ts). */
    const route = result.readOnDevice ? `, read on this device${result.sightMissed ? ` (Gemini could not: ${result.sightMissed})` : ""}` : "";

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
      /*
       * Which route read it, in the record and on the answer: the device and
       * then a text model, or a model that looked at the picture itself. The
       * next "not working" can then be traced to the step that failed.
       */
      log(aiEvent("uploaded", "add", { text: note, files: notes, model: `${result.model ?? ""}${route}` }));

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
        say({ kind: "assistant", text: downSentence(result.reason), from: result.reason ?? "this device" });
      }
      return false;
    }

    if (result.proposals.length === 0 && result.refused.length === 0) {
      /*
       * No entry, no figure, nothing done in the past tense: a question
       * worded as a statement, answered as one. The owner, 27 September
       * 2026, "I need gas for tommorrow ... I cannot travel if I dont have
       * gas", was told there was no entry in it and asked how much it was.
       */
      if (sent.length === 0 && note.trim() && !/\d/.test(note) && detectIntent(note) === "ask") {
        await askQuestion(note, false);
        return true;
      }
      /*
       * The model found nothing, but the rules here can: let them, without
       * saying first that nothing was found. "6 unknown spending" was told
       * "I could not find an entry in that" and then, a moment later by the
       * rules, "How much was it?" (28 September 2026). One message, one reply.
       */
      if (sent.length === 0 && readEntry(note, transactions, reference, asOf).worthOffering) return false;
      /*
       * Say so either way.
       *
       * With a photo it explained itself; with a sentence it returned in
       * silence. Live, 20 September 2026: "restore the snack from may 7" was
       * echoed into the thread and nothing came back at all, twice. A message
       * that produces no card, no answer and no reason reads as the app
       * having crashed, and there is no way to tell that from it having
       * decided there was nothing there (rule D8).
       */
      say({
        kind: "assistant",
        ephemeral: true,
        text:
          sent.length > 0
            ? "No transaction was readable in that. A clearer photo of the amount and the date usually works."
            : "I could not find an entry in that. Say it with the amount and the wallet, or use the form beside this.",
        from: sent.length > 0 ? `${result.source === "device" ? "this device" : `${modelLabel(result.model ?? "") || "the provider"}${route}`}` : "this device",
      });
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
            read: fileAsSaid(readEntry(line, transactions, reference, asOf), typed?.item ?? null),
          }))
        : [];
    const usable = parts.filter((p) => p.read.readsAsDebt || p.read.worthOffering);
    /*
     * The model returned cards, but fewer than the message holds: its cards
     * stay, and only what it left out is added from the reading here
     * (domain/entryTotals.ts, `partsTheModelMissed`).
     */
    const extras =
      usable.length > result.proposals.length && result.proposals.length > 0
        ? partsTheModelMissed(usable.map((p) => p.read.draft), result.proposals.map((p) => p.draft)).map((i) => usable[i]!).filter(Boolean)
        : [];

    if (usable.length > result.proposals.length && usable.length > 1 && result.proposals.length === 0) {
      say({
        kind: "assistant",
        ephemeral: true,
        text: `${usable.length} entries. Check each one, then add it.${typed?.words ? ` ${typed.words}` : ""}`,
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
          say(debtCard(read.draft, line).turn);
          continue;
        }
        await offer(
          {
            draft: read.draft,
            confidence: "high",
            sourceRef: `part of what you said: ${line}`,
            typed: true,
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
          (result.proposals.length + extras.length === 1
            ? "One entry. Check it, then add it."
            : `${result.proposals.length + extras.length} entries. Check each one, then add it.`) +
          (typed?.words && result.proposals.length + extras.length > 1 ? ` ${typed.words}` : "") +
          (result.repeated
            ? ` The picture shows ${result.repeated === 1 ? "one row" : `${result.repeated} rows`} twice, where the screenshot was stitched together, and each was read once.`
            : ""),
        from: `${result.source === "device" ? "this device" : `${modelLabel(result.model ?? "") || "the provider"}${route}`}`,
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

    /**
     * ── The device's reading corrects the model's ──────────────────────
     *
     * Every sentence is read twice, here and by a model, and the device
     * reading was only ever used when the model could not be reached. In
     * ordinary use it was therefore never used at all, and every improvement
     * made to it was dead the moment a provider answered.
     *
     * The record shows the cost. "nag bayad ako ng tricycle 500 kanina cash
     * gamit ko" came back as a Transfer from Maya; the device reads it as
     * Spending on Travel from Cash. "bumuli ako ng pagkain 200 gcash" came
     * back as a Transfer from Maya to Gcash; the device reads Food from
     * Gcash. Both were corrected by hand, and the owner wrote "wrong it
     * recognize it as transfer" and then "same again".
     *
     * Only for a single typed sentence. A batch off a photo is several rows
     * against one message and there is nothing to compare them with.
     */
    const oneSentence =
      sent.length === 0 && note && result.proposals.length === 1
        ? readEntry(note, transactions, reference, asOf)
        : null;

    const onDevice = result.proposals.map((proposal, i) => {
      const reading = readings[i];
      const base = reading
        ? {
            ...proposal,
            draft: reading.draft,
            adjustments: reading.note
              ? [...proposal.adjustments, reading.note]
              : proposal.adjustments,
          }
        : proposal;

      if (!oneSentence) return base;

      const agreed = reconcile(base.draft, oneSentence, reference);
      return agreed.notes.length === 0
        ? base
        : { ...base, draft: agreed.draft, adjustments: [...base.adjustments, ...agreed.notes] };
    });

    /*
     * What the statement's own words and the ledger say about each row: the
     * owner's own name is a transfer between their accounts, a payment to a
     * lender they owe is a payment on that line, and "Withdrawal from" is
     * cash taken out (27 September 2026: "it cant recognized the transfer
     * from gcash earlier, it doenst recognized the debt being paid").
     */
    const sensed =
      sent.length > 0
        ? senseStatementRows(onDevice, { account, readings: result.readings ?? [], ownNames, debts, transactions, reference })
        : onDevice;
    // A row with no money in it is not a row: a PHP 0.00 card came off a Maya history (28 September 2026).
    const nonZero = sent.length > 0 ? sensed.filter((p) => p.draft.amount !== 0) : sensed;
    /*
     * An ATM slip's card, with the account it came out of: by the balance the
     * slip prints, or where the owner's withdrawals come from (domain/withdrawal.ts).
     */
    const slips = sent.length > 0 ? slipsIn(result.readings ?? []) : [];
    const withdrawn =
      slips.length === 0
        ? nonZero
        : nonZero.map((p) => {
            const cashIn = cashWallet(reference.wallets);
            const w = slips.find((s) => p.draft.flow === "Transfer" && p.draft.toWallet === cashIn && p.draft.amount === s.cash && p.draft.fee === s.fee);
            if (!w) return p;
            const source = withdrawalSource(w, allWalletBalances(transactions), transactions, [...reference.wallets, ...reference.savings], cashIn);
            if (!source) {
              return p.draft.fromWallet ? p : { ...p, adjustments: [...p.adjustments, "Which account the card belongs to is not on the slip, and your past withdrawals do not say, so pick it."] };
            }
            const exact = source.off === 0 && w.balanceAfter !== undefined;
            if (p.draft.fromWallet && p.draft.fromWallet !== source.account && !exact) {
              return { ...p, adjustments: [...p.adjustments, `Check the account: ${source.how}.`] };
            }
            return { ...p, draft: { ...p.draft, fromWallet: source.account }, adjustments: [...p.adjustments, `From ${source.how}.`] };
          });
    /*
     * Paid by card: a terminal's slip, or a shop receipt that says card. The
     * account is where the owner's own card payments come from
     * (domain/cardSlip.ts, `cardAccount`), never what the slip calls the card.
     */
    const readingsList = result.readings ?? [];
    const cardAmounts = new Set<number>(sent.length > 0 ? cardSlipsIn(readingsList).map((c) => c.amount) : []);
    for (let i = 0; sent.length > 0 && i < readingsList.length; i += 2) {
      const r = readReceipt([readingsList[i] ?? "", readingsList[i + 1] ?? ""], asOf);
      if (r?.paidWith === "card") cardAmounts.add(r.total);
    }
    const byCard = cardAmounts.size > 0 ? cardAccount(transactions, [...reference.wallets, ...reference.savings]) : null;
    /*
     * Each picture may go to the model in its own request, so a slip and its
     * receipt can come back as a card each: they are one payment, and are
     * made one again here, across the requests (domain/proposal.ts).
     */
    /*
     * A new kind the model named, filed where the ledger has filed that word
     * before: water under Food, not a new "Water" (domain/fileAsBefore.ts).
     */
    const filedAsBefore = fileAsBefore(
      sent.length > 1 ? checkCardSlips(withdrawn, cardSlipsIn(readingsList), reference, asOf) : withdrawn,
      transactions,
      reference,
    );
    /*
     * "all that entry is load": the kind the owner said for every row goes on
     * every spending card, filed where the ledger files that word
     * (domain/saidForAll.ts). Five cards of Unknown came back on 2 October 2026.
     */
    const forAll = sent.length > 0 && note ? kindSaidForAll(note, transactions, reference, asOf) : null;
    const onePerPayment = forAll
      ? filedAsBefore.map((p) => {
          const d = p.draft;
          if (d.flow !== "Spending" || (d.category && d.category !== "Spending") || d.item === forAll.item) return p;
          const word = forAll.word.charAt(0).toUpperCase() + forAll.word.slice(1);
          const description = d.description.toLowerCase().includes(forAll.word) ? d.description : d.description.trim() ? `${word}, ${d.description.trim()}` : word;
          return {
            ...p,
            draft: { ...d, category: "Spending" as const, item: forAll.item, description },
            adjustments: [...p.adjustments, `Filed as ${forAll.item}: you said all of them are ${forAll.word}${forAll.because}.`],
          };
        })
      : filedAsBefore;
    const checked =
      cardAmounts.size === 0
        ? onePerPayment
        : onePerPayment.map((p) => {
            if (p.draft.flow !== "Spending" || p.draft.amount === null || !cardAmounts.has(p.draft.amount)) return p;
            // Nothing in the ledger says: the usual history check fills it, or the card asks.
            if (!byCard) return p;
            if (byCard.line) {
              return { ...p, adjustments: [...p.adjustments, `Your card payments are usually bought on ${byCard.line}: check the account.`] };
            }
            if (p.draft.fromWallet === byCard.account) {
              return { ...p, adjustments: [...p.adjustments, `Paid by card: your card payments come out of ${byCard.account}.`] };
            }
            if (p.draft.fromWallet && byCard.count < 3) {
              return { ...p, adjustments: [...p.adjustments, `Your recent card payments came out of ${byCard.account}: check the account.`] };
            }
            return {
              ...p,
              draft: { ...p.draft, fromWallet: byCard.account },
              adjustments: [...p.adjustments, `Paid by card: your card payments come out of ${byCard.account}, the last ${byCard.count === 1 ? "one did" : `${byCard.count} did`}.`],
            };
          });

    if (sent.length > 0) {
      const drafts = checked.map((p) => p.draft);
      const moved = account || mostMoved(drafts);
      lastRead.current = moved ? { account: moved, drafts, at: Date.now() } : null;
    }

    /*
     * "Can you check only if this is added?": a question about the picture,
     * answered from the ledger, with cards for the missing rows only
     * (domain/checkPicture.ts).
     */
    if (sent.length > 0 && asksWhetherAdded(note)) {
      const verdict = inLedgerOrNot(checked.map((p) => p.draft), transactions);
      say({ kind: "assistant", text: verdict.words, from: "this device" });
      log(aiEvent("answered", "add", { text: verdict.words, model: "this device" }));
      const missing = verdict.missing.map((i) => checked[i]).filter((p): p is Proposal => p !== undefined);
      for (const proposal of missing) await offer(proposal, note, true, missing.length > 1, []);
      return true;
    }

    const odd = readings.filter((r) => r.note.includes("but reads as")).length;
    if (odd > 0) {
      say({
        kind: "assistant",
        ephemeral: true,
        text: `${odd} of these name a different account than the ${account} statement they came off. They are marked, and nothing was changed for you.`,
        from: "this device",
      });
    }

    const batch = checked.length + extras.length > 1;
    const made: CardToAsk[] = [];
    for (const proposal of checked) {
      /*
       * A row of a batch is about its own words, not the whole message: the
       * ledger, the owner's lessons and the checks read "Purchased on
       * JOLLIBEE", where the message only said "add these".
       */
      const own = batch && sent.length > 0 && !proposal.said && proposal.draft.description.trim() ? proposal.draft.description.trim() : "";
      /*
       * Its words are the shop's name, not something the owner wrote, so the
       * reading is not checked against them: "7-Eleven-ST4817" is a store
       * code, not a figure of PHP 4,817.00 that the ₱174.00 was misread from.
       */
      const card = await offer(own ? { ...proposal, said: own } : proposal, own || note, true, batch, [], own ? "" : undefined);
      if (card) made.push(card);
    }
    // What the model left out of the message, read here from the owner's own words.
    for (const { line, read } of extras) {
      if (read.readsAsDebt) {
        say(debtCard(read.draft, line).turn);
        continue;
      }
      const card = await offer(
        {
          draft: read.draft,
          confidence: "medium",
          sourceRef: `part of what you said: ${line}`,
          said: line,
          typed: true,
          adjustments: [...read.because, "The model's reading left this one out, so it was read from your words on this device."],
        },
        line,
        false,
        true,
        read.settled,
      );
      if (card) made.push(card);
    }
    /*
     * The questions, one card at a time, for every card that needs
     * something. The owner, 27 September 2026: "it should ask following
     * question like the entry on this have send money to?".
     */
    const matchedAlone = made.map((c) => duplicatesOf(c.draft, transactions).length > 0);
    const matchedTogether = togetherAsOne(made.map((c) => c.draft), transactions, (i) => matchedAlone[i] === true);
    const toAsk = batch
      ? made
          // A row already in the ledger is not asked about: its card says which row it is.
          .filter((_, i) => !matchedAlone[i] && !matchedTogether.has(i))
          .map((c) => (sent.length > 0 && confirmsIncome(c.draft) ? { ...c, confirm: true } : c))
          .filter((c) => cardQuestion(c.draft, reference, 1, 1, c.confirm ? { lines: [] } : undefined) !== null)
      : [];
    if (toAsk.length > 0) {
      say({
        kind: "assistant",
        ephemeral: true,
        text: `${toAsk.length === 1 ? "One card needs" : `${toAsk.length} cards need`} an answer from you: ${toAsk.length === 1 ? "the question is" : "the questions are"} above the box.`,
        from: "this device",
      });
      askFrom(toAsk, 0);
    } else if (batch) {
      /*
       * Name what is actually missing.
       *
       * It said "need a wallet picked" whatever the blank was, so a card
       * waiting for an amount or for what the money was for was reported as
       * waiting for a wallet, and the owner went looking for a picker that
       * was already filled in.
       */
      const missing = checked
        .map((p) => nextQuestion(p.draft, reference)?.blank)
        .filter((b): b is NonNullable<typeof b> => Boolean(b));

      if (missing.length > 0) {
        const WORDS: Record<string, string> = {
          amount: "an amount",
          item: "what it was for",
          fromWallet: "a wallet",
          toWallet: "a wallet",
        };
        const kinds = [...new Set(missing.map((b) => WORDS[b] ?? "something"))];
        const needs =
          kinds.length === 1
            ? kinds[0]
            : `${kinds.slice(0, -1).join(", ")} or ${kinds[kinds.length - 1]}`;

        say({
          kind: "assistant",
          ephemeral: true,
          text: `${missing.length} of them still ${missing.length === 1 ? "needs" : "need"} ${needs}. Fill it in on the card, or say it here.`,
          from: "this device",
        });
      }
    }
    for (const refused of result.refused) {
      say({ kind: "assistant", text: refused.reason, from: "this device" });
    }
    return result.proposals.length > 0;
  };

  /**
   * Where a difference went, in the chat.
   *
   * Screenshots attached are read for two things: the balance on screen,
   * which is what the account really holds, and the history, which is each
   * movement to check against the ledger. Then `investigate` does the work
   * on this device and the answer comes back as sentences with what each
   * finding accounts for, and cards for the ones that can be put right: an
   * entry to add, or rows to open or bin. Nothing is changed until a button
   * is pressed.
   */
  const findDifference = async (note: string, ask: InvestigateAsk): Promise<void> => {
    const sent = files;
    setFiles([]);
    setDraft("");
    say({ kind: "you", text: note, ...(sent.length > 0 ? { shown: sent } : {}) });

    const accounts = [...reference.wallets, ...reference.savings];
    let account = ask.account;
    let actual = ask.actual;
    let readOn = asOf;
    let statement: StatementLine[] = [];

    if (sent.length > 0) {
      const control = new AbortController();
      stopper.current = control;
      setBusy(true);
      const read = await during(
        "Reading what you sent",
        () => extractProposals({ note, attachments: sent, reference, asOf, signal: control.signal, lastUsed }),
        "Still reading it",
      ).finally(() => {
        stopper.current = null;
        setBusy(false);
      });
      const drafts = read.proposals.map((p) => p.draft);
      if (!account) {
        account =
          (sent.length === 1 && sent[0] ? statementAccount(sent[0].name, drafts, accounts) : "") ||
          read.balances?.[0]?.account ||
          "";
      }
      const balance = read.balances?.find((b) => b.account === account);
      if (balance && actual === null) {
        actual = balance.amount;
        readOn = balance.date > asOf ? asOf : balance.date;
      }
      if (account) statement = linesFromDrafts(drafts, account);
      log(
        aiEvent("uploaded", "add", {
          text: note,
          files: sent.map((f) => ({ name: f.name, kind: f.kind === "text" ? "file" : "photo", bytes: f.bytes, details: `${statement.length} movements read for ${account || "no account"}` })),
          model: read.model ?? "",
        }),
      );
      if (read.source === "offline" && read.reason) {
        say({ kind: "assistant", text: `The pictures could not be read: ${read.reason}`, from: "this device", ephemeral: true });
      }
    }

    // History pasted under the question, one movement a line. Never the first
    // line: "my maya on Sep 10 is 30000" is the balance, not a movement.
    if (sent.length === 0 && account) {
      statement = readHistory(note.split(/\r?\n/).slice(1).join("\n"), Number(asOf.slice(0, 4)));
    }
    // Nothing sent and nothing pasted: the picture just read, when it was this account's (`lastRead`).
    const recent = lastRead.current;
    let fromPicture = false;
    if (sent.length === 0 && account && statement.length === 0 && recent && recent.account === account && Date.now() - recent.at < 60 * 60_000) {
      statement = linesFromDrafts(recent.drafts, account);
      fromPicture = statement.length > 0;
    }

    if (!account) {
      const reply = "Which account is it, and what does it really hold right now? For example: my Maya balance is 30,000. A screenshot of the balance works too, with its transaction history if you have it.";
      say({ kind: "assistant", text: reply, from: "this device" });
      log(aiEvent("answered", "add", { text: reply, model: "this device" }));
      return;
    }

    // Read today, the ledger's figure is the sidebar's, entries dated ahead included (`countAhead`).
    const today = readOn === asOf;
    const ledgerThen = walletBalance(transactions.filter((t) => today || t.date <= readOn), account);
    if (actual === null && ask.gap !== null) actual = ledgerThen - ask.gap;
    if (actual === null) {
      const reply = `The ledger says **${account}** holds **${formatMoney(ledgerThen)}**. What does it really hold? Say the figure, or send a screenshot of the balance, and its history if you have it, and I will look for where the difference went.`;
      say({ kind: "assistant", text: reply, from: "this device" });
      log(aiEvent("answered", "add", { text: reply, model: "this device" }));
      return;
    }

    const result = investigate({ transactions, account, actual, asOf: readOn, statement, matchedOn: ask.matchedOn ?? undefined, countAhead: today });
    const interestItem = reference.revenueCategories.find((c) => /interest/i.test(c)) ?? "";
    const words = investigationWords(result);
    const bold = (text: string): string => text.replace(formatMoney(Math.abs(result.gap)), (m) => `**${m}**`);
    const reply = [
      bold(words.headline),
      ...(statement.length > 0
        ? [`Checked ${statement.length} ${statement.length === 1 ? "movement" : "movements"} from ${fromPicture ? "the picture you sent before" : "what you sent"} against the ledger.`]
        : []),
      ...words.lines.map((line) => (line.endsWith(":") ? line : `- ${line}`)),
    ].join("\n");
    say({ kind: "assistant", text: reply, from: "this device" });
    log(aiEvent("answered", "add", { text: `Investigated ${account}: gap ${formatMoney(result.gap)}, found ${formatMoney(result.explained)}.`, model: "this device" }));

    /*
     * What can be put right, as cards. Money nobody wrote down is a card only
     * when nothing in the ledger could be the answer instead: beside two
     * entries that add up to it, a ready-made income card was a guess that
     * would have counted the money twice (3 October 2026, "Random PHP 220.00").
     */
    const ledgerCouldSay = result.possible.some((c) => c.kind === "together" || c.kind === "estimate" || c.kind === "wrong-account" || c.kind === "fee-inside" || c.kind === "ahead");
    const adds = [...result.found, ...result.possible]
      .filter((clue) => !(clue.kind === "unrecorded" && ledgerCouldSay))
      .map((clue) => draftForClue(clue, account, readOn, interestItem))
      .filter((draft): draft is Draft => draft !== null);
    /*
     * Each card is checked against its own line, not the whole message: the
     * message holds the balance, and comparing a ₱500.00 cinema line with
     * "5000" said the card had misread the amount. The wallet is known, so no
     * batch wallet picker either.
     */
    for (const draft of adds) {
      await offer(
        {
          draft,
          confidence: statement.length > 0 ? "high" : "medium",
          sourceRef: statement.length > 0 ? "the history you sent" : "the difference",
          adjustments: ["Found while looking for the difference. Check it before adding."],
        },
        draft.description,
        true,
        false,
      );
    }
    // Each reason a whole sentence, so the card says it as it is rather than "Matched on entered twice".
    const no = (t: Transaction): string => `#${String(t.recordNumber).padStart(4, "0")}`;
    const twins = result.found.flatMap((c) =>
      c.kind === "duplicate"
        ? [{ row: c.row, score: 100, why: [`Looks like ${no(c.twin)} entered a second time.`] }]
        : c.kind === "inside"
          ? [{ row: c.row, score: 100, why: [`Already part of ${no(c.whole)}.`] }]
          : [],
    );
    if (twins.length > 0) say({ kind: "found", action: "bin", candidates: twins, done: [] });
    const seen = new Set<string>();
    const toCheck = [...result.found, ...result.possible]
      .flatMap((c) =>
        c.kind === "amount-differs" || c.kind === "not-on-statement"
          ? [{ row: c.row, score: 90, why: [c.kind === "amount-differs" ? "The statement shows a different figure." : "Not on the statement."] }]
          : c.kind === "estimate"
            ? [{ row: c.row, score: 80, why: [`An estimate of spending not written down: if ${formatMoney(Math.abs(c.explains))} of it was never spent, lower it.`] }]
            : c.kind === "together"
              ? c.rows.map((row) => ({
                  row,
                  score: 50,
                  why: [c.rows.length > 1 ? `With ${c.rows.filter((r) => r.id !== row.id).map(no).join(" and ")}, adds up to the difference. Check it was on this account.` : "Adds up to the difference. Check it was on this account."],
                }))
              : c.kind === "wrong-account"
                ? [{ row: c.row, score: 60, why: [`Filed on ${c.other}. Check it was not this account.`] }]
                : c.kind === "fee-inside"
                  ? c.rows.map((row) => ({ row, score: 85, why: ["The machine's fee is inside this withdrawal's figure. Edit it: the cash in Amount and the rest in Fee."] }))
                  : c.kind === "ahead"
                    ? c.rows.map((row) => ({ row, score: 70, why: ["Dated after today. If it has already happened, edit its date."] }))
                    : [],
      )
      .filter((c) => !seen.has(c.row.id) && Boolean(seen.add(c.row.id)));
    if (toCheck.length > 0) say({ kind: "found", action: "edit", candidates: toCheck, done: [] });
  };

  /** Ask a question about the figures. */
  /**
   * Ask the model, always first.
   *
   * The owner, 28 September 2026, after a budget answered on the device:
   * "this is not what I want I want ai first not system always ai". So the
   * device does the arithmetic and the model gives the answer: `worked` is
   * what the app worked out for this question (a budget, a sum, whether
   * something is affordable), sent above everything else as figures the
   * model must build on, and `fallback` is said only when no model answers.
   */
  /**
   * The charts for what was asked: a budget, a balance or a debt when the
   * hint names one (`chartAsk.ts`), else money in or out over the window,
   * both directions as two charts when both were asked for (rule D3: one
   * chart is one direction). Every figure is added up here.
   */
  const chartsFor = (asked: string, hint: ChartHint | null, pair: ComparedPeriods | null): Chart[] => {
    if (measureOf(hint)) {
      const drawn = buildMeasureChart(asked, hint, { transactions, budgets, reference, debts, asOf });
      return drawn ? [drawn] : [];
    }
    const said = inWords(asked, hint);
    const both = wantsBothDirections(said);
    const income = buildChart(said, transactions, asOf, both ? "revenue" : undefined, pair);
    const spending = both ? buildChart(said, transactions, asOf, "spending", pair) : null;
    return [spending, income].filter((c): c is Chart => c !== null);
  };

  /** A chart said in the conversation, and kept in the record with its figures. */
  const drawChart = (chart: Chart): void => {
    say({ kind: "chart", chart });
    log(aiEvent("answered", "add", { text: `Drew ${chart.title}. ${chartInWords(chart)}`, entry: chart.title }));
  };

  const askQuestion = async (
    question: string,
    echo = true,
    worked: { readonly text: string; readonly fallback?: string } | null = null,
    /**
     * Charts drawn for this question, above the answer. The owner, 4 October
     * 2026: "if the result need to show charts or pie or tend etc show
     * them". The model is handed their figures (`chartsWorked`), so the
     * words and the picture are the same answer.
     */
    drawn: readonly Chart[] = [],
  ): Promise<void> => {
    if (echo) say({ kind: "you", text: question });
    for (const chart of drawn) drawChart(chart);
    if (drawn.length > 0) {
      const shown = chartsWorked(drawn, chartInWords);
      worked = {
        text: worked ? `${worked.text}\n\n${shown}` : shown,
        fallback: worked?.fallback ?? drawn.map(chartReading).filter(Boolean).join(" "),
      };
    }
    const asked = generation.current;
    const control = new AbortController();
    stopper.current = control;

    // The newest turns whole, so a follow-up is sent what it follows (domain/memory.ts).
    const history = chatHistory(turns.filter(isSaid).map((t) => ({ role: t.kind, text: t.text })));
    /*
     * A budget recommended a few messages ago stays in front of the model,
     * so "why 14K" is answered from how 14K was worked out. On 28 September
     * it was answered "I do not have the figures for October".
     */
    const advised = lastAdvice.current;
    const standing =
      !worked && advised && turns.slice(-12).some((t) => t.kind === "you" && t.text === advised.asked)
        ? `The budget recommended earlier in this conversation, as the app worked it out:\n${advised.text}`
        : "";
    const figures = worked?.text ?? standing;
    const earlier = earlierSessions(savedChat.current, [...history.map((h) => h.text.replace(/\.\.\.$/, "")), question]);

    // The part of a chart they tapped, when the question points at it (domain/chartPick.ts).
    const picked = asksAboutPick(question) ? currentPick() : null;
    // What the owner has open, so "what do you think" is about that screen (domain/screenContext.ts).
    const answer = await during(
      "Reading your ledger",
      () =>
        ai.ask("chat", {
          question,
          history,
          earlier,
          // The owner's words and the device's own answers: a model's earlier figure is not a source (useAi.ts).
          trusted: [
            question,
            ...turns.filter(isSaid).filter((t) => t.kind === "you" || t.from === "this device").map((t) => t.text),
          ].join("\n"),
          /*
           * Only when the question points at it.
           *
           * The block tells the model to answer about the screen, so sending
           * it with every question made every answer about the screen: "how
           * much did I spend today" came back describing the empty amount
           * field on the Add form.
           */
          screen: [aboutTheScreen(question) ? screenText(currentScreen()) : "", picked ? pickText(picked) : ""].filter(Boolean).join("\n\n"),
          ...(figures ? { worked: figures } : {}),
          // What it must not forget: what they told it, and this conversation in outline (domain/memory.ts).
          pinned: keepInMind(savedChat.current, turns.filter(isSaid).map((t) => ({ role: t.kind, text: t.text })).concat([{ role: "you" as const, text: question }]), asOf),
          signal: control.signal,
        }),
      "Still waiting on the model",
    );
    if (stopper.current === control) stopper.current = null;
    // Stopped, or the view cleared, while it was on its way: it is not said.
    if (generation.current !== asked) {
      log(aiEvent("answered", "add", { text: `Not shown, stopped before it arrived: ${answer.text.slice(0, 160)}`, model: "this device" }));
      return;
    }

    /**
     * A failed answer says so, and says why underneath.
     *
     * The text is `MODEL_DOWN` when no model answered, and the reason (busy,
     * unreachable, too slow) goes on the line that would otherwise name the
     * model, which is the line read to see who answered.
     */
    const model =
      answer.source === "model" ? modelLabel(answer.model ?? "") || "the provider" : "this device";
    /*
     * No model answered: the app's own working is the answer, and the line
     * under it says why the model is not the one answering.
     */
    const fallback = worked?.fallback ?? (picked ? pickAnswer(picked) : undefined);
    if (answer.source !== "model" && fallback) {
      say({ kind: "assistant", text: fallback, from: `this device, because ${(answer.reason ?? "no model answered").replace(/\.$/, "").replace(/^./, (c) => c.toLowerCase())}` });
      log(aiEvent("answered", "add", { text: fallback, model: "this device" }));
      return;
    }
    const from = answer.source === "model" ? model : (answer.reason ?? model);
    say({ kind: "assistant", text: answer.text, from });
    log(aiEvent("answered", "add", { text: answer.text, model }));
    /*
     * An entry the answer worked out, offered as a card at once.
     *
     * 27 September 2026: the model found ₱6.25 of interest on Maya Bank and
     * answered "I cannot add it from here; press the Add entry button", and
     * "add it" then found nothing. It now ends such an answer with an
     * "Entry:" line (ai.ts), read here by the same rules as a typed one.
     */
    /*
     * Never from a plan. "I will be spending 1000 cash" was answered with an
     * Entry line and a PHP 1,000.00 card for money not yet spent (4 October
     * 2026). It is a decision; it becomes an entry when the money moves.
     */
    if (answer.source === "model" && !isPlan(question)) await offerFromAnswer(answer.text);
  };

  /** The "Entry:" line of an answer, as a card. False when there is none, or it reads as nothing. */
  const offerFromAnswer = async (text: string): Promise<boolean> => {
    const line = entryLineIn(text);
    if (!line) return false;
    const read = readEntry(line, transactions, reference, asOf);
    if (read.draft.amount === null || (!read.worthOffering && !read.readsAsDebt)) return false;
    await offer({ draft: read.draft, confidence: "medium", sourceRef: "answer", adjustments: ["Worked out in the answer above."], said: line }, line);
    return true;
  };

  /**
   * Every message gets a reply, even when the code under it fails.
   *
   * 28 September 2026: "what budget do you recommend for October if I only
   * expect 8000 allowance?" threw while its figures were being put together,
   * the promise was dropped, and the box simply came back empty, five times.
   * A fault now says so, in the conversation and in the record, where the
   * Coder view can find it.
   */
  const send = async (typed?: string, as?: Intent): Promise<void> => {
    try {
      await sendNow(typed, as);
    } catch (error) {
      if (stopper.current) stopper.current = null;
      setBusy(false);
      setStage("");
      const what = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      say({
        kind: "assistant",
        text: "That one could not be answered: the app hit a fault working it out, so nothing was sent and nothing was saved. Ask it another way, and the fault is kept in the Coder view so it can be fixed.",
        from: "this device",
      });
      log(aiEvent("answered", "add", { text: `Fault: ${what}`.slice(0, 400), model: "this device" }));
    }
  };

  const sendNow = async (typed?: string, as?: Intent): Promise<void> => {
    const began = generation.current;
    const note = (typed ?? draft).trim();
    /**
     * The sentence with its command words spelled right, for the rules to
     * read (`domain/typos.ts`). What is shown and stored is always `note`.
     */
    const ruled = withCommandWordsFixed(note);
    /*
     * A long message is read whole by the model; the shortcuts below see only
     * its first line (`isEssay`), so a paragraph about a ₱40,000 arrival is
     * not taken for a balance check or a budget.
     */
    const essay = files.length === 0 && isEssay(note);
    const lead = essay ? (ruled.split(/\n/).find((l) => l.trim()) ?? ruled) : ruled;
    if (busy) return;
    if (!note && files.length === 0) return;
    setStage("");

    /*
     * "Add them", about the entries inside the last question.
     *
     * Read before anything else, because on its own it is two words that
     * mean nothing to any other reader here, and after this point every
     * branch would try to make an entry out of them.
     */
    if (entriesLeftBehind.current && wantsThoseEntries(note)) {
      const message = entriesLeftBehind.current;
      entriesLeftBehind.current = null;
      setDraft("");
      await send(message, "log");
      return;
    }

    /*
     * "Add it", about the entry the last answer worked out ("Entry:" line).
     * Its card is offered with the answer; this brings it back after a
     * discard, or on a device that read the answer before this existed.
     */
    if (files.length === 0 && !as && wantsThoseEntries(note)) {
      const answered = [...turns].reverse().find((t) => t.kind === "assistant" && entryLineIn(t.text));
      if (answered && answered.kind === "assistant") {
        setDraft("");
        say({ kind: "you", text: note });
        log(aiEvent("asked", "add", { text: note }));
        if (await offerFromAnswer(answered.text)) return;
      }
    }

    /*
     * A follow-up that only makes sense with the message before it.
     *
     * The owner, 27 September 2026: "I paid all my balances", then "I mean
     * subscription", answered "I could not find an entry in that". It was
     * read alone. "I mean X" is the last thing they said with X in place of
     * the word that was wrong, and so is the short reply to a question the
     * assistant asked instead of guessing. Not while a card or a question is
     * waiting: "I mean 300" there is a correction to it, handled below.
     */
    const waiting = pending !== null || asking !== null || turns.some((t) => (isOffer(t) || isDebt(t)) && t.state === "open");
    const clarified = clarifying.current;
    clarifying.current = null;
    if (files.length === 0 && !as && !waiting) {
      const meant = meantInstead(note);
      const lastSaid = [...turns].reverse().find((t): t is Said => t.kind === "you")?.text ?? "";
      const reply = note.trim();
      const shortReply = reply.split(/\s+/).length <= 4 && !/\d/.test(reply) && !isQuestion(reply) ? reply : null;
      // A question already goes to the model with the conversation, which reads "I mean" better than a swap of words.
      const previous = clarified ?? (meant && lastSaid && !isQuestion(lastSaid) ? lastSaid : "");
      const word = meant ?? (clarified ? shortReply : null);
      if (previous && word) {
        const both = /^(?:both|all|all of them|lahat|everything)$/i.test(word) ? "bills and subscriptions" : word;
        const again = sayInstead(previous, both, notMeantIn(note));
        setDraft("");
        await send(again);
        return;
      }
    }

    /*
     * An answer to a question about one card of a batch. Read before the
     * router, because "school" or "sent to my friend" means nothing without
     * the question above it; a question or a new entry typed instead is not
     * an answer and goes on as usual (`looksLikeAnswer`).
     */
    if (asking && files.length === 0 && !as && !wantsDiscardOpen(note) && looksLikeAnswer(note, asking.blank)) {
      setBusy(true);
      try {
        if (await during("Checking your answer", () => answerAsked(note), "Still checking it")) return;
      } finally {
        setBusy(false);
      }
    }

    /**
     * A budget, which is changed on the Budget screen and never from here.
     *
     * "add buget same as last month" came back as "Dropped it.": an entry was
     * waiting for its amount and the sentence was taken as giving up on it.
     * The assistant writes entries only, so the answer is where the button
     * is, and the entry being asked about is left waiting, untouched.
     */
    /**
     * ── The model reads it first, before any rule in this file ──────────
     *
     * This used to run below the two gates underneath it, which meant a
     * pattern decided what a sentence was and the model was asked second,
     * about whatever the pattern had left. The owner asked for the other
     * order, in these words: analyse, then hand to the code that does the
     * work, then show the result.
     *
     * So it is asked first, about the message as typed. The rules below
     * are still here and still matter, but they are now a refinement of
     * one answer rather than the first opinion: they run when the model
     * said this is an entry, or when there was no model to ask.
     *
     * That is also why moving it costs nothing in time. It was already on
     * the critical path for every message that reached it; it is the same
     * one call, asked earlier.
     */
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
    /*
     * "Change the title", and then the words.
     *
     * 28 September 2026: a receipt's card had been read with the title "Read
     * it" and discarded, and "Change the title" went to the finder for saved
     * rows, which came back with three entries to correct. It was about the
     * card: the one waiting on a question, the one open, or the one just
     * discarded, which comes back for it. Nothing is guessed. The question is
     * what it should say, and the next message is the title.
     */
    const renameFor = renaming.current;
    renaming.current = null;
    if (
      renameFor &&
      files.length === 0 &&
      !as &&
      !/^\s*\/\//.test(note) &&
      !isQuestion(note) &&
      !wantsDiscardOpen(note) &&
      !SKIP_CARD.test(note) &&
      note.trim().split(/\s+/).length <= 24
    ) {
      const title = titleFrom(note);
      const done = `Title set to "${title}".`;
      if (title && renameFor === "pending" && pending) {
        const renamed = { ...pending.draft, description: title };
        setDraft("");
        say({ kind: "you", text: note });
        setPending({ ...pending, draft: renamed });
        const still = nextQuestion(renamed, reference, pending.settled);
        say({ kind: "assistant", text: still ? `${done} ${still.question}` : done, from: "this device" });
        log(aiEvent("asked", "add", { text: note }));
        log(aiEvent("answered", "add", { text: done, model: "this device" }));
        return;
      }
      if (title && renameFor !== "pending") {
        const index = turns.findIndex((t) => isOffer(t) && t.state === "open" && t.cardId === renameFor.cardId);
        const turn = turns[index];
        if (turn && isOffer(turn)) {
          setDraft("");
          reviseCard(index, turn, { ...(turn.live ?? turn.proposal.draft), description: title }, done, note);
          log(aiEvent("asked", "add", { text: note }));
          log(aiEvent("answered", "add", { text: done, model: "this device" }));
          return;
        }
      }
    }
    if (files.length === 0 && !as && asksToRename(note)) {
      setDraft("");
      say({ kind: "you", text: note });
      log(aiEvent("asked", "add", { text: note }));
      const reads = (d: Draft): string => (d.description.trim() ? ` It reads "${d.description.trim()}" now.` : "");
      let reply = "";
      if (pending) {
        renaming.current = "pending";
        reply = `What should the title say?${reads(pending.draft)}`;
      } else {
        const shown = openCard();
        // The card discarded a moment ago, when none is open: the rename is about it.
        const lastCard = shown
          ? null
          : turns
              .map((t, index) => ({ t, index }))
              .slice(-8)
              .reverse()
              .find(({ t }) => isOffer(t));
        const discarded = lastCard && isOffer(lastCard.t) && lastCard.t.state === "discarded" ? { index: lastCard.index, turn: lastCard.t } : null;
        if (shown) {
          renaming.current = { cardId: shown.turn.cardId };
          reply = `What should the title say?${reads(shown.turn.live ?? shown.turn.proposal.draft)}`;
        } else if (discarded) {
          const back: Offered = { ...discarded.turn, state: "open", live: undefined };
          recordCard(back);
          setTurns((prev) => prev.map((t, i) => (i === discarded.index ? back : t)));
          renaming.current = { cardId: back.cardId };
          reply = `The card you discarded is open again above. What should its title say?${reads(back.proposal.draft)}`;
        } else {
          reply =
            "There is no card open to rename. For a saved entry, name the day, the item or the amount, or give the record number, and I will find it for you to edit.";
        }
      }
      say({ kind: "assistant", text: reply, from: "this device" });
      log(aiEvent("answered", "add", { text: reply, model: "this device" }));
      return;
    }

    /*
     * A reply to the question under a card goes to that card, first.
     *
     * 28 September 2026, a receipt's card asking "What was it for?": "Cash,
     * i purchase it for my room" became a new entry asking how much it was,
     * "Reed defuser wood and santal" was answered by the chat as a question,
     * and "cash" was answered with the balance of the Cash wallet. Each went
     * to the router, which read it without the question beside it. A short
     * reply that is not itself a question is the answer to the one on
     * screen; a whole new entry with its own figure still starts afresh,
     * further down.
     */
    const answersPending =
      pending !== null &&
      files.length === 0 &&
      !as &&
      !wantsDiscardOpen(note) &&
      looksLikeAnswer(note, pending.blank) &&
      !(pending.blank === "amount" && note.trim().split(/\s+/).length >= 4 && readEntry(note, transactions, reference, asOf).draft.flow !== "");
    if (answersPending) {
      setDraft("");
      setBusy(true);
      try {
        await during("Checking your answer", () => answerPending(note), "Still checking it");
      } finally {
        setBusy(false);
      }
      return;
    }

    /*
     * A correction to the entry the question is about, while the question
     * waits: "Its 109", when a receipt read ₱108.00 and asked what it was for.
     * 28 September 2026 it was read as a new entry with no wallet, then by the
     * chat, which printed its own reasoning. Only a reply worded as a
     * correction, and only a change `amend` can name; the question stays.
     */
    if (
      pending !== null &&
      files.length === 0 &&
      !as &&
      !/^\s*\/\//.test(note) &&
      !isQuestion(note) &&
      WORDED_AS_CORRECTION.test(note) &&
      note.trim().split(/\s+/).length <= 10
    ) {
      const change = amend(pending.draft, note, reference, asOf);
      const still = change ? nextQuestion(change.draft, reference, pending.settled) : null;
      if (change && still) {
        setDraft("");
        say({ kind: "you", text: note });
        setPending({ ...pending, draft: change.draft, blank: still.blank });
        say({ kind: "assistant", text: `${change.what} ${still.question}`, from: "this device" });
        log(aiEvent("asked", "add", { text: note }));
        log(aiEvent("answered", "add", { text: change.what, model: "this device" }));
        return;
      }
    }

    /*
     * "read it", "read it again", "look at the receipt": the last picture,
     * read again, with whatever else was said as its context.
     */
    const bareAgain = /^\s*(?:again|try\s+again|read\s+again)\s*[.!]*\s*$/i.test(note);
    const againWasPicture = lastWasPicture.current;
    lastWasPicture.current = false;
    if (
      pending === null &&
      files.length === 0 &&
      !as &&
      asksToReadAgain(note) &&
      (!bareAgain || againWasPicture) &&
      note.trim().split(/\s+/).length <= 14 &&
      lastPictures.current.length > 0
    ) {
      setDraft("");
      /*
       * "You didn't read the other one": only the pictures no card came off,
       * when some did. Every card names the file it was read from.
       */
      const unread = saysOneWasMissed(note)
        ? lastPictures.current.filter((p) => !turns.some((t) => isOffer(t) && t.proposal.sourceRef.includes(p.name)))
        : [];
      const again = unread.length > 0 && unread.length < lastPictures.current.length ? unread : lastPictures.current;
      setBusy(true);
      try {
        await during(
          again.length < lastPictures.current.length ? `Reading ${again.map((p) => p.name).join(" and ")} again` : "Reading the picture again",
          () => readAttached(note, again),
          "Still reading it",
        );
      } finally {
        setBusy(false);
      }
      return;
    }

    let routed: { intent: Routed; target: string; period: string; compare: readonly [string, string] | readonly []; draw: ChartHint | null } | null = null;
    /*
     * Said plainly enough to need no model to sort it, with nothing on
     * screen it could be answering: a plan is a question, and money that has
     * moved, with its figure, is an entry. That sorting round trip was the
     * wait before every answer (4 October 2026, "make the system powerful and
     * instant"). The entry is still read by the model, and the question
     * still answered by one: only the sorting is skipped.
     */
    // `waiting`, above: a question, a card or a debt card still open.
    const sortedAlready = !waiting && (isPlan(note) || plainlyDone(note));
    // A "//" line is a note to the developer: nothing to route, and nothing to wait on a model for.
    if (files.length === 0 && !as && !ai.disabled && !/^\s*\/\//.test(note) && !sortedAlready) {
      setBusy(true);
      try {
        setStage("Reading what you asked");
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
      // Stopped, or the view cleared, while it was being read: nothing more happens.
      if (generation.current !== began) return;
    }

    /**
     * Whether the rules below get a say.
     *
     * A budget instruction and "paid all my bills" both read as entries to
     * the router, which is exactly the case those two rules exist to catch,
     * so they still run then. A message the model read as a delete, a chart
     * or a question is none of their business and they stand down: that is
     * what asking first is for.
     */
    const modelSawEntry = routed === null || routed.intent === "entry";

    /**
     * A chart beside a question answered in words, when one shows the answer
     * better: where the money went, what cost most, how something moved, two
     * periods side by side. What the model said to draw is used for what the
     * words leave open (`chartAsk.ts`). Not the same chart again, and not for
     * a question about the chart already on screen.
     */
    const credits = reference.credits ?? [];
    const besideFor = (question: string, pair: ComparedPeriods | null = null): Chart[] => {
      const recent = turns.slice(-4).filter(isChart).map((t) => t.chart.title);
      const justShown = recent.length > 0;
      const charts = pair
        ? justShown
          ? []
          : [buildChart(question, transactions, asOf, undefined, pair)].filter((c): c is Chart => c !== null)
        : (() => {
            const hint = mergeHint(localHint(question, credits), routed?.draw ?? null, question, credits);
            return chartHelps(question, hint, justShown) ? chartsFor(question, hint, null) : [];
          })();
      return charts.filter((c) => !recent.includes(c.title));
    };

    /**
     * What the assistant can do, and where it stops.
     *
     * Answered on this device, from one list (`assistantScope.ts`), so the
     * answer is the same every time and never promises what is not built.
     */
    // A line starting with "//" is a note, handled further down, and never an instruction.
    const isNoteLine = /^\s*\/\//.test(note);

    if (files.length === 0 && !as && !isNoteLine && wantsCapabilities(note)) {
      setDraft("");
      say({ kind: "you", text: note });
      const reply = capabilitiesAnswer();
      say({ kind: "assistant", text: reply, from: "this device" });
      log(aiEvent("asked", "add", { text: note }));
      log(aiEvent("answered", "add", { text: "Said what the assistant can do.", model: "this device" }));
      return;
    }

    if (files.length === 0 && !as && !isNoteLine && asksSettingsChange(note)) {
      setDraft("");
      say({ kind: "you", text: note });
      say({ kind: "assistant", text: SETTINGS_ARE_YOURS, from: "this device" });
      log(aiEvent("asked", "add", { text: note }));
      log(aiEvent("answered", "add", { text: "Settings are changed on the Settings screen.", model: "this device" }));
      return;
    }

    /**
     * The model answers, with what the app worked out in front of it; the
     * app's own words only when no model does (`askQuestion`).
     */
    const answerWithModel = async (worked: string, fallback: string, drawn: readonly Chart[] = []): Promise<void> => {
      setBusy(true);
      try {
        await askQuestion(note, false, { text: worked, fallback }, drawn);
      } finally {
        setBusy(false);
      }
    };

    /*
     * The recommended budget as a card to apply, right after the answer that
     * recommends it, when the message asked for one to be set: "can you set a
     * plan?" (4 October 2026). The app's own parts, as "set it" would put
     * them; every figure can be changed on the card before Apply.
     */
    const offerAdvisedBudget = (advice: BudgetAdvice, months?: { readonly toMonth?: number | undefined }): void => {
      if (!sink.canBudget) return;
      const spendingAt = advice.fit && !advice.fit.fits ? advice.fit.spending : advice.spending;
      const ask: BudgetAsk = {
        kind: "tracks",
        year: advice.year,
        month: advice.month,
        spending: spendingAt,
        billsSubs: advice.billsSubs,
        scope: "month",
        ...(months?.toMonth && months.toMonth > advice.month ? { toMonth: months.toMonth } : {}),
      };
      const plan = planBudget(ask, budgets, asOf, new Date().toISOString());
      if (plan.outcome.refused || plan.outcome.written.length === 0) return;
      const note = advice.fit
        ? `From the ${formatMoney(advice.fit.income)} ${advice.fit.income === advice.typicalIncome ? "you usually receive" : "you expect"}: ${formatMoney(advice.billsSubs)} for bills and subscriptions, ${formatMoney(spendingAt)} for spending.`
        : undefined;
      say({ kind: "budget", plan, state: "open", ask, ...(note ? { note } : {}) });
      log(aiEvent("proposed", "add", { entry: plan.words, text: note ?? plan.words }));
    };

    /**
     * Questions the app can work figures out for, always answered by the model.
     *
     * The owner, 28 September 2026: "I want ai first not system always ai",
     * and then "make it better ai first allways" after "but based on my
     * current budget and give me realistic costing", asked about eating out,
     * was answered with October's whole budget because it said "realistic"
     * and "budget". The device is not the one to decide what a sentence
     * means. It works out what the question may need, whether something is
     * affordable (`affordAsk.ts`), a budget (`budgetAdvice.ts`), a sum
     * (`spendAsk.ts`), and hands that to the model, which reads the question
     * and answers it. The device's own words are said only when no model
     * answers.
     */
    if (files.length === 0 && !as && !isNoteLine && (!essay || entriesInside(note) < 2)) {
      /** "should I go eat outside today?": a decision about spending, like "can I afford". */
      const SHOULD_I = /\bshould i (?:go|eat|buy|get|order|spend|pay|try|treat|grab|have)\b|\bis it (?:ok|okay|fine|wise) (?:to|if i) (?:buy|eat|spend|get|order|go)\b/i;
      const decides = (t: string): boolean => isAffordQuestion(t) || SHOULD_I.test(t);
      const recentAsked = [...turns].reverse().slice(0, 8).filter((t): t is Said => t.kind === "you").map((t) => t.text);
      const earlierAfford = recentAsked.find((t) => isAffordQuestion(t)) ?? null;
      const decisionBefore = recentAsked.slice(0, 2).find(decides) ?? null;
      // "based on balance not budget", "so is it an option?", "but based on my current budget": the same decision.
      const again =
        !decides(lead) && goesByBalance(lead) && earlierAfford
          ? earlierAfford
          : !decides(lead) && decisionBefore && followsUpDecision(lead)
            ? decisionBefore
            : null;
      const affordish = !essay && (decides(lead) || again !== null);

      const advised = lastAdvice.current;
      const stillHere = advised !== null && turns.slice(-12).some((t) => t.kind === "you" && t.text === advised.asked);
      const income = expectedIncomeIn(ruled);
      const splitAgain = stillHere && asksForTheSplit(ruled) && ruled.split(/\s+/).length <= 16;
      // "what if I get 10000 instead": the same month again, held to the new figure.
      const newIncome =
        stillHere && income !== null && !asksBudgetAdvice(ruled) && ruled.split(/\s+/).length <= 14 && !saysMoneyMoved(ruled) && !/^\s*(?:please\s+)?(?:remember|tandaan|keep in mind|note that|take note|fyi)\b/i.test(ruled);
      const budgetish = !affordish && (asksBudgetAdvice(ruled) || splitAgain || newIncome);
      const spent = !affordish && !budgetish && !essay && !wantsChart(note) ? readSpendAsk(ruled, knownItems, asOf) : null;

      if (affordish || budgetish || spent) {
        setDraft("");
        say({ kind: "you", text: note });
        log(aiEvent("asked", budgetish ? "budget" : "add", { text: note }));

        if (affordish) {
          const asked = readAffordAsk(again ? `${again} ${lead}` : lead, transactions, reference, asOf);
          const reply = affordAnswer(asked, { transactions, reference, budgets, debts, asOf });
          await answerWithModel(
            [
              `Whether they can afford it, as the app reads it: what the spending wallets hold less the bills and debt payments still due, what the thing usually costs going by their own entries, and the budget said apart.${again ? ` This message follows up on "${again}": it is the same decision.` : ""} Use it for the call and for what it would realistically cost; if they ask to go by the budget, give the budget's side too, and then the overall call. Answer what the message actually asks.`,
              reply,
            ].join("\n"),
            reply,
          );
          return;
        }

        if (budgetish) {
          /*
           * Asked to set one, not only for one: "can you set a plan?", "adjust
           * my budget this month". The answer recommends it and the card to
           * apply it comes with the answer, one step rather than "add it".
           */
          const setsIt = !splitAgain && SETS_BUDGET.test(ruled) && !ASKS_ONLY.test(ruled);
          // The month beside the word budget first: a long message names others.
          const named = adviceMonthIn(ruled, asOf) ?? (essay ? null : (() => {
            const span = spanIn(lead, asOf);
            return span && span.anchored !== false ? { year: span.year, month: span.month } : null;
          })());
          const next = nextOf(asOf);
          /*
           * "if I received my salary worth 10k today, how can I budget it": money
           * that arrives now is budgeted from now, in the month running. It was
           * planned for the month after (3 October 2026, a November card).
           */
          const arrivesNow = income !== null && /\b(?:today|now|ngayon|kanina|this month)\b/i.test(ruled);
          const target =
            named ??
            ((splitAgain || newIncome) && advised
              ? { year: advised.advice.year, month: advised.advice.month }
              : arrivesNow
                ? { year: Number(asOf.slice(0, 4)), month: Number(asOf.slice(5, 7)) }
                : { year: next.year, month: next.month });
          const said = income ?? (advised && stillHere && advised.advice.fit ? advised.advice.fit.income : null);
          const keep = savingsGoalIn(ruled) ?? (advised && stillHere && advised.advice.fit ? advised.advice.fit.keep : null);
          const first = budgetAdvice({ transactions, year: target.year, month: target.month, asOf, stopped: settings.stopped ?? [], debts, income: said, keep });
          /*
           * "based on my income and spending" with no figure: held to the
           * income they usually receive, the median month over the same
           * months the spending is read from (4 October 2026).
           */
          const byIncome = said === null && first.typicalIncome > 0 && BY_INCOME.test(ruled);
          const held = byIncome ? first.typicalIncome : said;
          const advice = byIncome ? budgetAdvice({ transactions, year: target.year, month: target.month, asOf, stopped: settings.stopped ?? [], debts, income: held, keep }) : first;
          const text = adviceWords(advice);
          lastAdvice.current = { advice, text, asked: note };
          await answerWithModel(
            [
              `A budget for ${advice.name}, as the app works it out from the ledger: each item's median month over the months it names, the bills and subscriptions still running, one-offs and stopped ones left out${byIncome ? `, held to the income they usually receive, ${formatMoney(advice.typicalIncome)} a month` : held ? ", held to the income they said" : ""}. Its figures are correct: never change or recompute them.`,
              /*
               * 3 October 2026: held to a PHP 10,000.00 salary, the answer
               * recommended the usual month, PHP 15,122.00, "leaving room for
               * the salary and your wallets", and that went on the card.
               */
              held
                ? `It is held to ${byIncome ? "their usual income" : "the income they said"}: the total to recommend is the one in its first sentence, never the usual month's, and money already in their wallets is not part of it. Say what the income covers first (bills, then spending), and what is left to save.`
                : "",
              setsIt ? "A card with these figures is shown under your answer for them to apply: say so in one short sentence, and never say it is set or applied." : "",
              splitAgain
                ? "They are asking for the parts of the budget recommended earlier: give the split, grouped as it is."
                : `If they are asking for a budget, open with "I recommend a budget of" and its total and month, give the split, and explain why in your own words, naming the months it read and what was left out. If the message asks something else, answer that and use this only where it helps.`,
              text,
            ].join("\n"),
            // The card is under the answer already, so the line saying how to get one goes.
            setsIt ? withoutSetIt(text) : text,
          );
          if (setsIt) offerAdvisedBudget(advice);
          return;
        }

        if (spent) {
          const reply = spendAnswer(spent, transactions, asOf);
          // "how much did I spend each month this year": the months drawn as well as summed.
          await answerWithModel(`The sum the message asks about, worked out by the app from the ledger. Answer with it, in your own words:\n${reply}`, reply, besideFor(ruled));
          return;
        }
      }
    }

    /**
     * A budget, set from here.
     *
     * "add buget same as last month" used to be refused with directions to
     * the Budget screen. The owner asked for the assistant to change
     * everything but Settings, so the change is worked out with the Budget
     * screen's own rules and shown on a card to apply.
     */
    const couldBudget = files.length === 0 && !as && !isNoteLine && sink.canBudget;
    // A form of lines ("Bills and subscriptions: 1641", "Spending: 6359") is read whole, not by its first line.
    let budgetAsk = couldBudget ? readBudgetAsk(isBudgetForm(ruled) ? ruled : lead, reference, asOf) : null;
    /** What the card says under its figures: where they came from, when that is worth saying. */
    let budgetNote = "";
    /*
     * "thats budget", straight after a message that was read as an entry:
     * that message was a budget. 28 September 2026: the form above became a
     * PHP 1,641.00 spending entry, "thats budget" asked what September's
     * budget should be, and the figures were typed a third time. The message
     * before is read again as a budget, and the entry card it made is put
     * aside.
     */
    const meantBudget =
      /^\s*(?:no[,.!\s]+|hindi[,.!\s]+)?(?:that'?s|thats|that is|that was|it'?s|its|it is|it was|this is)\s+(?:a\s+|the\s+|my\s+|for\s+(?:the\s+|my\s+)?)?budget\b|^\s*budget\s+(?:yan|iyan|yun|iyon|yon|to|po)\b|^\s*(?:i meant|i mean)\s+(?:a\s+|the\s+|my\s+)?budget\b/i.test(ruled);
    if (!budgetAsk && couldBudget && meantBudget) {
      const before = [...turns].reverse().find((t): t is Said => t.kind === "you");
      const again = before ? readBudgetAsk(`set budget ${before.text}`, reference, asOf) : null;
      if (before && again) {
        budgetAsk = again;
        const fromIt = (t: Turn): boolean => isOffer(t) && t.state === "open" && t.proposal.said !== undefined && t.proposal.said !== "" && before.text.includes(t.proposal.said);
        for (const t of turns) {
          if (!fromIt(t) || !isOffer(t)) continue;
          const d = t.proposal.draft;
          log(aiEvent("rejected", "add", { entry: `${d.date} ${d.flow} ${d.item} ${formatMoney(d.amount ?? 0)}`, text: "It was a budget, not an entry" }));
          recordCard({ ...t, state: "discarded" });
        }
        setTurns((prev) => prev.map((t) => (fromIt(t) && isOffer(t) ? { ...t, state: "discarded" as const } : t)));
      }
    }
    const span = couldBudget ? spanIn(lead, asOf) : null;
    /*
     * The router saying "budget" is not enough for a question. "how about
     * budget last month then upto december" was made a card, refused because
     * August is closed (28 September 2026). A question goes to the model.
     */
    const asksAboutBudget = isQuestion(note) || /^\s*(?:how about|what about|why|what|how|is|are|can|could|should|would)\b/i.test(ruled);
    const saysBudget = couldBudget && (namesBudgetCommand(lead) || (!essay && routed?.intent === "budget" && !asksAboutBudget));

    /**
     * "add that budget", with the figure sitting in the answer above it.
     *
     * `readBudgetAsk` wants a figure in the sentence, and this sentence has
     * none, because it was already said one message ago. That is how anyone
     * would ask, and on 21 September 2026 it produced the worst exchange in
     * the log: no card was made, so the model answered the request itself
     * with "Yes, the entries will be added to your budget", and then "the
     * budget still not change".
     *
     * Only a figure the answer called a budget is taken, never just the
     * first number in it, and the month is carried across when the answer
     * named one and the request did not. Nothing is saved either way: it
     * becomes the same card with the same button as any other budget
     * change, which is what the owner asked for ("the ai can add budget but
     * It need my approval").
     */
    const lastAnswer = (() => {
      const said = [...turns].reverse().find((t) => t.kind === "assistant");
      return said && "text" in said ? said.text : "";
    })();
    /** The most recent answer in the last few turns that recommended a budget, and its figure. */
    const recentProposal = (() => {
      for (const t of [...turns].reverse().slice(0, 12)) {
        if (t.kind !== "assistant" || !("text" in t)) continue;
        const value = proposedBudgetIn(t.text);
        if (value !== null) return { value, text: t.text };
      }
      return null;
    })();
    /** The last budget card, if one is still near: the thing "make it long term" is about. */
    const lastBudgetAt = (() => {
      for (let i = turns.length - 1; i >= Math.max(0, turns.length - 10); i -= 1) {
        const t = turns[i];
        if (t && isBudgeting(t)) return i;
      }
      return -1;
    })();
    const lastBudget = lastBudgetAt >= 0 ? (turns[lastBudgetAt] as Budgeting) : undefined;
    /** A figure of money in the message, leaving out dates and counts of months (budgetAsk.ts). */
    const namesFigure = namesMoneyFigure(ruled);
    /** Money moving, in the owner's words: an entry, never a budget (budgetAsk.ts). */
    const movesMoney = saysMoneyMoved(ruled);
    /** The span a message names, laid over an ask, so "September to December" moves a card rather than making a new one. */
    const over = (ask: BudgetAsk, s: NonNullable<typeof span>): BudgetAsk => {
      const { toMonth: _dropped, ...rest } = ask;
      // "make it long term" says how long, not when it starts: the card keeps its own first month.
      const start = s.anchored === false ? { year: ask.year, month: ask.month } : { year: s.year, month: s.month };
      return { ...rest, ...start, scope: s.scope, ...(s.toMonth && s.toMonth > start.month ? { toMonth: s.toMonth } : {}) } as BudgetAsk;
    };

    /*
     * The answer to "What should the budget be for October?", asked by the
     * branch below. "use the forecast", "use that" or a bare "9000" is that
     * answer, and went to the model instead ("The AI model is not working")
     * because none of them says "budget".
     */
    const asked = budgetQuestion.current;
    budgetQuestion.current = null;
    if (!budgetAsk && couldBudget && asked) {
      const target = span ? { ...span, year: span.anchored === false ? asked.year : span.year, month: span.anchored === false ? asked.month : span.month } : asked;
      const base = { kind: "tracks" as const, year: target.year, month: target.month, scope: target.scope };
      if (/\b(forecast|expected|projection|projected)\b/i.test(ruled)) {
        const f = forecastFor(target.year, target.month) ?? forecastFor(nextOf(asOf).year, nextOf(asOf).month);
        if (f) budgetAsk = over({ ...base, spending: f.spending, billsSubs: f.billsSubs }, { ...target, anchored: true });
      } else if (recentProposal && /\b(that|it|this|recommend\w*|suggest\w*|what you said)\b/i.test(ruled) && !namesFigure) {
        budgetAsk = over({ ...base, spending: recentProposal.value }, { ...target, anchored: true });
      } else if (namesFigure) {
        const read = readBudgetAsk(`set budget ${ruled}`, reference, asOf);
        if (read && read.kind === "tracks") budgetAsk = over({ ...read }, span ? { ...target, anchored: true } : { ...target, anchored: true });
      }
    }

    /*
     * "ok add it", straight after an answer that proposed a budget, is the
     * same request without the word. Only then: a yes after a card or a
     * question is theirs, and nothing here takes it from them.
     */
    const noCardWaiting = !pending && !turns.some((t) => (isOffer(t) || isDebt(t)) && t.state === "open");
    /*
     * Unless the proposal is the last thing said.
     *
     * 26 September 2026, 01:41 and again at 01:50: "ok add it", straight
     * after "PHP 41,694.36 is a recommended budget for next month", did
     * nothing both times, because a Debt card from 01:20 was still open
     * further up. "it" is the last thing said, and a card twenty minutes up
     * the conversation is not that.
     */
    const lastTurn = turns[turns.length - 1];
    const answerIsLast = lastTurn?.kind === "assistant" && "text" in lastTurn && lastTurn.text === lastAnswer;
    const yesToBudget = couldBudget && (noCardWaiting || answerIsLast) && confirmsProposal(ruled) && proposedBudgetIn(lastAnswer) !== null;
    /*
     * "Can you recommend budget?", answered with what to cut and no budget
     * figure, then "Add it" (04:11 that day). There is nothing to add, so it
     * asks for the figure, offering the forecast, rather than saying nothing.
     */
    const askedBefore = [...turns].reverse().find((t) => t.kind === "you");
    const yesAfterBudgetTalk =
      couldBudget &&
      !yesToBudget &&
      answerIsLast &&
      confirmsProposal(ruled) &&
      askedBefore !== undefined &&
      "text" in askedBefore &&
      /\b(budget|buget|budjet|bugdet|limit)\b/i.test(askedBefore.text);

    /*
     * "how about add it to september to december", "make it long term",
     * right after a budget card: the same budget over different months. It
     * went to the entry reader on 26 September 2026 ("No entry matches
     * that"). The card is planned again over the months named, and the old
     * one, if still open, is put aside so only one waits to be applied.
     */
    /*
     * Only when it says to do something. "how about december what budget you
     * proporse?" moved the card above to December (28 September 2026): it
     * asked for a proposal, and a proposal is the model's to give.
     */
    const doesSomething = /\b(add|apply|set|make|use|put|copy|extend|move|change|carry|long[- ]?term|from now on)\b/i.test(ruled) && !asksBudgetAdvice(ruled);
    if (!budgetAsk && couldBudget && noCardWaiting && lastBudget?.ask && span && doesSomething && !namesFigure && !movesMoney && ruled.split(/\s+/).length <= 16) {
      budgetAsk = over(lastBudget.ask, span);
      if (lastBudget.state === "open") decide(lastBudgetAt, "discarded");
    }

    /*
     * "set it" after the device's own recommendation: both parts, as worked
     * out. The figure in the sentence is the total, and setting that as the
     * spending line would count the bills twice.
     */
    const advisedLast = lastAdvice.current;
    const advisedHere = advisedLast !== null && turns.slice(-12).some((t) => t.kind === "you" && t.text === advisedLast.asked);
    if (
      !budgetAsk &&
      couldBudget &&
      advisedLast &&
      advisedHere &&
      recentProposal !== null &&
      !namesFigure &&
      (yesToBudget || saysBudget || confirmsProposal(ruled) || /\b(use|set|apply|add)\b[^.]{0,20}\b(that|it|this|recommend\w*|suggest\w*|what you said)\b/i.test(ruled))
    ) {
      /*
       * The model said the figure; the app knows its parts. The app's own
       * total goes in as its two parts. A different total the model chose
       * keeps the bills as worked out and puts the rest to spending.
       */
      const a = advisedLast.advice;
      const spendingAt = a.fit && !a.fit.fits ? a.fit.spending : a.spending;
      const said = recentProposal.value;
      /*
       * The app's own parts, always: the figure is arithmetic and the model
       * does none. A different total in the answer was put on the card as
       * said, and on 3 October 2026 that was the usual month, PHP 15,122.00,
       * against the PHP 10,000.00 the owner expected. The card says so, and
       * the figures can be changed on it before Apply.
       */
      const parts = { spending: spendingAt, billsSubs: a.billsSubs };
      const ours = spendingAt + a.billsSubs;
      budgetNote = [
        a.fit
          ? `From the ${formatMoney(a.fit.income)} you expect: ${formatMoney(a.billsSubs)} for bills and subscriptions${a.debtDue > 0 ? `, ${formatMoney(a.debtDue)} of debt payments due` : ""}${a.fit.keep > 0 ? `, ${formatMoney(a.fit.keep)} kept to save` : ""}, ${formatMoney(spendingAt)} for spending${a.fit.income - ours - a.debtDue - a.fit.keep > 0 ? `, and ${formatMoney(a.fit.income - ours - a.debtDue - a.fit.keep)} left to save` : ""}${a.fit.short > 0 ? `. Even so it is ${formatMoney(a.fit.short)} short` : ""}.`
          : "",
        said !== ours && said > a.billsSubs ? `The answer above said ${formatMoney(said)}; these are the app's own figures${a.fit ? `, held to the ${formatMoney(a.fit.income)} you expect` : ""}. Change them before you apply if you want another.` : "",
      ]
        .filter(Boolean)
        .join(" ");
      const month = proposedMonthIn(recentProposal.text, asOf) ?? { year: a.year, month: a.month };
      budgetAsk = over(
        { kind: "tracks", year: month.year, month: month.month, ...parts, scope: "month" },
        span ?? { year: month.year, month: month.month, scope: "month", anchored: true },
      );
    }
    if (!budgetAsk && couldBudget && (saysBudget || yesToBudget)) {
      /*
       * "use the forecast", "the recommended one": the figure is the app's own
       * forecast for the month, or the one the answer above recommended.
       */
      const target = span ?? proposedMonthIn(recentProposal?.text ?? lastAnswer, asOf) ?? (() => {
        const next = Number(asOf.slice(5, 7)) === 12 ? { year: Number(asOf.slice(0, 4)) + 1, month: 1 } : { year: Number(asOf.slice(0, 4)), month: Number(asOf.slice(5, 7)) + 1 };
        const now = { year: Number(asOf.slice(0, 4)), month: Number(asOf.slice(5, 7)) };
        return { ...(/\bnext month\b/i.test(recentProposal?.text ?? lastAnswer) || /\bnext month\b/i.test(ruled) ? next : now), scope: "month" as const };
      })();
      const wantsForecast = /\b(forecast|expected|projection|projected)\b/i.test(ruled);
      const proposed = wantsForecast ? null : yesToBudget ? proposedBudgetIn(lastAnswer) : recentProposal?.value ?? null;
      if (wantsForecast) {
        const f = forecastFor(target.year, target.month) ?? forecastFor(nextOf(asOf).year, nextOf(asOf).month);
        if (f) budgetAsk = over({ kind: "tracks", year: target.year, month: target.month, spending: f.spending, billsSubs: f.billsSubs, scope: "month" }, target);
      } else if (proposed !== null && (yesToBudget || /\b(it|that|this|those|recommend\w*|suggest\w*|what you said)\b/i.test(ruled))) {
        budgetAsk = over({ kind: "tracks", year: target.year, month: target.month, spending: proposed, scope: "month" }, target);
      }
    }
    /*
     * A budget request with no figure anywhere reaches the same branch, so
     * it gets the reply below saying what to type, rather than falling
     * through to the model to be answered with a yes it cannot honour.
     */
    if (budgetAsk || saysBudget || yesAfterBudgetTalk || (files.length === 0 && !as && modelSawEntry && isBudgetCommand(ruled))) {
      setDraft("");
      say({ kind: "you", text: note });
      log(aiEvent("asked", "add", { text: note }));
      if (!budgetAsk) {
        /*
         * What to set it to, with the figures that could answer it.
         *
         * "chnage the budget last month i think I changed it or something"
         * got the entry reader and then the model saying it could not change
         * the budget. It asks now, and names the two figures the app has: the
         * last one recommended here and what it forecasts for the month.
         */
        const target = span ?? { year: Number(asOf.slice(0, 4)), month: Number(asOf.slice(5, 7)), scope: "month" as const };
        /*
         * AI first: a budget asked for with no figure gets the app's own
         * recommendation for the month, answered by the model, with the card
         * to apply it under the answer. The owner, 4 October 2026, of the
         * question this used to ask instead: "Ai first. Fix this".
         */
        if (!ai.disabled && !yesAfterBudgetTalk) {
          const advice = budgetAdvice({ transactions, year: target.year, month: target.month, asOf, stopped: settings.stopped ?? [], debts });
          const text = adviceWords(advice);
          lastAdvice.current = { advice, text, asked: note };
          await answerWithModel(
            [
              `A budget for ${advice.name}, as the app works it out from the ledger: each item's median month over the months it names, the bills and subscriptions still running, one-offs and stopped ones left out. Its figures are correct: never change or recompute them.`,
              `They asked for the budget to be set or changed and gave no figure. Open with "I recommend a budget of" and its total and month, give the split, and explain why in your own words. A card with these figures is shown under your answer for them to apply or change: say so in one short sentence, and never say it is set or applied.`,
              text,
            ].join("\n"),
            withoutSetIt(text),
          );
          offerAdvisedBudget(advice, span ?? undefined);
          return;
        }
        budgetQuestion.current = { year: target.year, month: target.month, scope: target.scope, ...(span?.toMonth ? { toMonth: span.toMonth } : {}) };
        /*
         * A month already running has no forecast, only what it has spent so
         * far, so the next month's forecast is offered in its place.
         */
        const own = forecastFor(target.year, target.month);
        const next = nextOf(asOf);
        const f = own ?? forecastFor(next.year, next.month);
        const name = `${MONTH_NAMES[target.month - 1] ?? ""} ${target.year}`;
        const forecastName = own ? name : `${MONTH_NAMES[next.month - 1] ?? ""} ${next.year}, the next month to start,`;
        const reply = [
          `What should the budget be for ${name}${span?.toMonth ? ` to ${MONTH_NAMES[span.toMonth - 1] ?? ""}` : ""}?`,
          recentProposal ? `The last figure recommended here was **${formatMoney(recentProposal.value)}**: say "use that".` : "",
          f ? `The forecast plans ${forecastName} as your usual month: **${formatMoney(f.spending)}** for spending and ${formatMoney(f.billsSubs)} for bills and subscriptions. Say "use the forecast".` : "",
          `Or give a figure and the months: "set October to December to 9000", "limit food to 3000 from now on".`,
          pending ? "The entry I asked about is still waiting for its answer." : "",
        ]
          .filter(Boolean)
          .join(" ");
        say({ kind: "assistant", text: reply, from: "this device", ephemeral: true });
        log(aiEvent("answered", "add", { text: reply, model: "this device" }));
        return;
      }
      const plan = planBudget(budgetAsk, budgets, asOf, new Date().toISOString());
      if (plan.outcome.refused) {
        say({ kind: "assistant", text: `${plan.outcome.refused} Corrections to a closed month are made on the Budget screen, where the reason is kept with them.`, from: "this device" });
        log(aiEvent("answered", "add", { text: plan.outcome.refused, model: "this device" }));
        return;
      }
      if (plan.outcome.written.length === 0) {
        say({ kind: "assistant", text: "Nothing to change: the budget already reads that way.", from: "this device" });
        log(aiEvent("answered", "add", { text: "Budget already set.", model: "this device" }));
        return;
      }
      // The figures are on the card, as a table; said once is enough.
      say({ kind: "assistant", text: "Here is the change. Check the figures on the card, then press Apply.", from: "this device", ephemeral: true });
      say({ kind: "budget", plan, state: "open", ask: budgetAsk, ...(budgetNote ? { note: budgetNote } : {}) });
      log(aiEvent("proposed", "add", { entry: plan.words, text: note }));
      return;
    }

    /**
     * A correction to saved entries: an amount, a wallet, a date, an item.
     *
     * "change the treat yesterday to 1200" or "move all grab rides this month
     * to cash". Worked out and checked as the form would check it, then shown
     * before and after on a card. A request with no change in it that the
     * router called an edit still goes to the finder below, which opens the
     * row in the form.
     */
    /*
     * "should I set my budget to 9000?" was read as editing a saved entry
     * and answered "No saved entry matches that" (28 September 2026). Asking
     * what to do is the model's; only telling it to do something is a card.
     */
    const advising = asksRatherThanTells(ruled);
    const editAsk = files.length === 0 && !as && !isNoteLine && sink.canUpdate && !advising ? readEditAsk(ruled, reference, asOf) : null;
    if (editAsk && (routed === null || routed.intent === "editEntry" || routed.intent === "correction" || routed.intent === "entry" || routed.intent === "question")) {
      const onScreen = turns.some((t) => isOffer(t) && t.state === "open");
      /*
       * "make it 300" with a card open is about the card, not the ledger,
       * whatever the router called it. "change the description to Buy food"
       * was routed as an edit of saved rows with a card on screen, found none,
       * and the card never changed. A saved row is meant when one is named.
       */
      if (!(onScreen && !/#\s*\d|\b(all|every|entry|entries|record|records|saved|yesterday|last)\b/i.test(note))) {
        setDraft("");
        say({ kind: "you", text: note });
        log(aiEvent("asked", "add", { text: note }));
        const plan = planEdit(editAsk, transactions, reference, debts, asOf);
        if (plan.rows.length === 0) {
          const reply =
            plan.refused.length > 0
              ? `Found ${plan.refused.length === 1 ? "the entry" : `${plan.refused.length} entries`}, and could not change ${plan.refused.length === 1 ? "it" : "them"}: ${plan.refused
                  .map((r) => `#${String(r.row.recordNumber).padStart(4, "0")}: ${r.reason}`)
                  .join(" ")}`
              : "No saved entry matches that. Name the day, the item, the amount or the record number.";
          say({ kind: "assistant", text: reply, from: "this device" });
          log(aiEvent("answered", "add", { text: reply, model: "this device" }));
          return;
        }
        say({
          kind: "assistant",
          text: `${plan.rows.length === 1 ? "One entry" : `${plan.rows.length} entries`} to change. ${plan.rows.length === 1 ? "Check it" : "Check each one"}, then apply.${
            plan.refused.length > 0 ? ` ${plan.refused.length} more matched and cannot take the change, listed on the card.` : ""
          }`,
          from: "this device",
          ephemeral: true,
        });
        say({ kind: "change", plan, state: "open" });
        log(aiEvent("proposed", "add", { entry: plan.rows.map(changeWords).join("; "), text: note }));
        return;
      }
    }

    /**
     * "paid all my bills": a card for each bill still open this month.
     *
     * It names no bill and no figure, so it was read as one entry with every
     * blank empty and asked "How much was it?", which has no single answer.
     * The open bills are known, and so is what each cost last time.
     */
    const paidAll = files.length === 0 && !as ? allPaidScope(note) : null;
    if (paidAll && (modelSawEntry || routed?.intent === "chat" || routed?.intent === "question")) {
      setDraft("");
      setPending(null);
      say({ kind: "you", text: note });
      log(aiEvent("asked", "add", { text: note }));
      const due = monthBills(transactions, reference, Number(asOf.slice(0, 4)), Number(asOf.slice(5, 7)), asOf).bills.filter(
        (b) => b.state !== "paid" && b.amount > 0,
      );
      /*
       * "All my balances" names neither list: ask which, with what each one
       * holds, rather than guess. The short reply is read into this message.
       */
      if (paidAll === "unclear") {
        const names = (category: string): string =>
          due.filter((b) => b.category === category).map((b) => b.item).join(", ");
        const owed = debts
          .filter((d) => !d.archived && d.form !== "pass-through")
          .map((d) => ({ name: d.name, left: outstandingOf(transactions, d.id) }))
          .filter((d) => d.left > 0);
        const options = [
          names("Bills") ? `your bills still open (${names("Bills")})` : "",
          names("Subscriptions") ? `your subscriptions still open (${names("Subscriptions")})` : "",
          ...owed.map((d) => `what you owe on ${d.name} (${formatMoney(d.left)})`),
        ].filter(Boolean);
        const reply =
          options.length === 0
            ? "Every bill and subscription this month is already recorded as paid, and nothing is owed on a credit line, so there is nothing to add."
            : `Which ones did you pay: ${options.join("; ")}? Say bills, subscriptions, both${owed[0] ? `, or ${owed[0].name}` : ""}.`;
        if (options.length > 0) clarifying.current = note;
        say({ kind: "assistant", text: reply, from: "this device" });
        log(aiEvent("answered", "add", { text: reply, model: "this device" }));
        return;
      }
      const open = due.filter((b) =>
        paidAll === "both" ? true : paidAll === "bills" ? b.category === "Bills" : b.category === "Subscriptions",
      );
      const which = paidAll === "bills" ? "bill" : paidAll === "subscriptions" ? "subscription" : "bill and subscription";
      const reply =
        open.length === 0
          ? `Every ${which} this month is already recorded as paid, so there is nothing to add.`
          : `${open.length === 1 ? "One is" : `${open.length} are`} still open this month, one card each at what it cost last time. Change an amount before adding it if it was different.`;
      say({ kind: "assistant", text: reply, from: "this device", ephemeral: true });
      for (const bill of open) {
        const start: Draft = { ...emptyDraft(asOf), flow: "Spending", category: bill.category, item: bill.item, amount: bill.amount };
        const { draft: filled, because } = inferFromHistory(start, transactions, reference, bill.item);
        say({
          kind: "proposal",
          proposal: {
            draft: filled,
            confidence: "medium",
            adjustments: [`${bill.item} at its last amount, ${formatMoney(bill.amount)}.`, ...because],
            sourceRef: "this month's open bills",
            said: note,
          },
          state: "open",
          cardId: newCardId(),
        });
      }
      log(aiEvent("answered", "add", { text: reply, model: "this device" }));
      return;
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
     * "my maya balance is 30000, where's the rest?"
     *
     * The owner, 2026-09-17: the account holds a different amount than the
     * ledger says, and they want to know where the difference went, with
     * screenshots of the balance and the history if they have them. Before
     * the entry rules, because "maya 30000" in that sentence is a balance,
     * not a payment.
     */
    /*
     * "Export my data", before anything that reads figures out of a sentence.
     *
     * "Save my september spending as csv" holds a month and a kind of
     * spending, and every reader below would happily make an entry out of it.
     * A request for a file is not a movement of money.
     */
    /*
     * A question about the statement just made, answered from its figures.
     * "What do you think about that statement?" was offered a new statement
     * for 2026 (the owner, 4 October 2026: "Fix the reasoning").
     */
    const aboutAFile = !as && asksAboutAFile(ruled);
    const lastStatement = aboutAFile
      ? [...turns].reverse().find((t): t is Exporting => isExporting(t) && t.ask.kind === "statement")?.ask
      : undefined;
    if (aboutAFile && lastStatement) {
      setDraft("");
      const sheetOf = buildSheet(transactions, sheetRequestOf(lastStatement, asOf), reference, debts);
      await askQuestion(note, true, { text: statementBrief(sheetOf), fallback: statementBrief(sheetOf, true) });
      return;
    }

    const exportAsked = as || aboutAFile ? null : readExportAsk(ruled, asOf) ?? (routed?.intent === "export" ? readExportAsk(`export ${ruled}`, asOf) : null);
    /*
     * A statement is fitted to what is recorded and said to the day, with what
     * is in it: "Can you be specific? Like look it say January" (the owner, 4
     * October 2026, of a statement that began four months before the first
     * entry).
     */
    const offeredSheet = exportAsked?.kind === "statement" ? buildSheet(transactions, sheetRequestOf(exportAsked, asOf), reference, debts) : null;
    const askedToExport = exportAsked && offeredSheet ? withSheet(exportAsked, offeredSheet) : exportAsked;
    if (askedToExport) {
      const words = offeredSheet ? statementWords(offeredSheet, askedToExport.format) : exportWords(askedToExport, asOf);
      // Said and cleared like every other message: it stayed in the box, unsent-looking (28 September 2026).
      setDraft("");
      say({ kind: "you", text: note });
      log(aiEvent("asked", "add", { text: note }));
      say({ kind: "assistant", text: words, from: "this device" });
      say({ kind: "export", ask: askedToExport, state: "open" });
      log(aiEvent("answered", "statements", { text: words, model: "this device" }));
      return;
    }

    const findable = [...reference.wallets, ...reference.savings];
    const askedToFind = as
      ? null
      : readInvestigateAsk(lead, findable, (account) => walletBalance(transactions, account), asOf, lastRead.current?.account) ??
        (!essay && routed?.intent === "investigate"
          ? (readInvestigateAsk(`${note} doesn't match`, findable, (account) => walletBalance(transactions, account), asOf) ?? {
              account: "",
              actual: null,
              gap: null,
            })
          : null);
    if (askedToFind) {
      await findDifference(note, askedToFind);
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
    /**
     * "discard" cancels a question in progress, not only a card.
     *
     * ── The trap this closes ────────────────────────────────────────────
     *
     * A half-read entry lives in `pending`, not as a card, so with a question
     * outstanding there are no open cards and the gate below never fired.
     * "discard" and "nevermind" fell through to the answering path and were
     * read as answers to the question:
     *
     *   13:00:59  discard    "I could not find a figure in that. How much
     *                         was it, in pesos?"
     *   13:01:07  nevermind   the same reply, word for word
     *
     * There is no way out of that loop from the box. The escape has to work
     * wherever it is typed, so it is checked before the answering path and
     * regardless of whether a card exists.
     */
    if (pending && files.length === 0 && !as && wantsDiscardOpen(note)) {
      setPending(null);
      setDraft("");
      say({ kind: "you", text: note });
      say({
        kind: "assistant",
        text: "Dropped it. Nothing was added, so there is nothing to undo.",
        from: "this device",
        ephemeral: true,
      });
      log(aiEvent("cleared", "add", { text: note }));
      return;
    }

    if (openCards.length > 0 && files.length === 0 && !as && wantsDiscardOpen(note)) {
      setDraft("");
      say({ kind: "you", text: note });
      discardEveryOpen(note);
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

    /**
     * "cancel" with nothing open.
     *
     * It went on to the bin search with nothing left to search for and came
     * back "No entry matches that", which reads as the app not listening.
     */
    if (
      !pending &&
      openCards.length === 0 &&
      files.length === 0 &&
      !as &&
      /^(?:please\s+)?(?:cancel|nevermind|never mind|discard|scrap)(?:\s+(?:this|it|that|this one|that one))?[.!]*$/i.test(note.trim())
    ) {
      setDraft("");
      say({ kind: "you", text: note });
      say({
        kind: "assistant",
        text: 'Nothing is open, so nothing changed. To remove a saved entry, name it: "delete the Jollibee on Monday", or "delete the last one".',
        from: "this device",
        ephemeral: true,
      });
      return;
    }

    /**
     * "that last transaction is a mistake", "the input earlier is wrong".
     *
     * Both were answered with nothing. They name no field to change, so the
     * newest entries are shown with both ways to fix them: correct it in the
     * form, or move it to the bin. Nothing moves until a button is pressed.
     */
    /*
     * "find the wrong transactions", "delete those wrong transactions": the
     * rows the app's own checks flag, the Database's "Needs review", each
     * with the check that caught it and a button to correct it or bin it.
     * Never binned as a set: a flagged row is often right and merely odd.
     */
    if (files.length === 0 && !as && !pending && asksForWrongRows(ruled)) {
      const flagged = flaggedRows(transactions);
      setDraft("");
      say({ kind: "you", text: note });
      log(aiEvent("asked", "add", { text: note }));
      if (flagged.length === 0) {
        const reply = "The app's checks find nothing wrong in the ledger: every total adds up, and every row has its wallet, its item and its category. If one entry looks wrong to you, name it and I will find it.";
        say({ kind: "assistant", text: reply, from: "this device" });
        log(aiEvent("answered", "add", { text: reply, model: "this device" }));
        return;
      }
      const reply = `${flagged.length} ${flagged.length === 1 ? "entry is" : "entries are"} flagged by the app's checks, the same list as **Needs review** in the Database. Each says what is wrong with it. **Edit this** corrects it and keeps its record number; **Move to bin** removes it, and the Bin can bring it back.`;
      say({ kind: "assistant", text: reply, from: "this device" });
      say({ kind: "found", action: "edit", alsoBin: true, candidates: flagged.map(({ row, why }, i) => ({ row, score: 100 - i, why: [...why] })), done: [] });
      log(aiEvent("answered", "add", { text: `Listed ${flagged.length} flagged rows. Asked: ${note}`, model: "this device" }));
      return;
    }

    /*
     * The bin, by date: "I think I deleted a wrong entry", "what did I delete
     * last week", and a period said alone right after ("last month?"). It was
     * answered with the newest saved rows, by the rule for "my last entry is
     * wrong", because the sentence says "wrong entry" (domain/deletedAsk.ts).
     */
    const lastYouSaid = [...turns].reverse().find((t): t is Said => t.kind === "you")?.text ?? "";
    const deletedFollowUp = lastDeletedAsk.current !== null && lastYouSaid === lastDeletedAsk.current ? onlyAWindow(note, asOf) : null;
    if (openCards.length === 0 && !pending && files.length === 0 && !as && (deletedFollowUp || asksAboutDeleted(ruled))) {
      const window = deletedFollowUp ?? deletedWindowIn(note, asOf);
      const found = deletedRows(deleted, window);
      setDraft("");
      say({ kind: "you", text: note });
      log(aiEvent("asked", "add", { text: note }));
      const reply = deletedWords(found, deleted.length, window);
      say({ kind: "assistant", text: reply, from: "this device" });
      if (found.length > 0) {
        say({ kind: "found", action: "restore", candidates: found.map((f, i) => ({ row: f.row, score: 100 - i, why: [...f.why] })), done: [] });
      }
      log(aiEvent("answered", "add", { text: `Listed ${found.length} rows from the bin. Asked: ${note}`, model: "this device" }));
      lastDeletedAsk.current = note;
      return;
    }
    lastDeletedAsk.current = null;

    if (openCards.length === 0 && !pending && files.length === 0 && !as && saysLatestIsWrong(ruled)) {
      const newest = [...transactions].sort((x, y) => y.recordNumber - x.recordNumber).slice(0, 3);
      setDraft("");
      say({ kind: "you", text: note });
      if (newest.length === 0) {
        say({ kind: "assistant", text: "The ledger has no entries yet, so there is nothing to edit.", from: "this device" });
        return;
      }
      say({
        kind: "assistant",
        text: "Here are your newest entries. **Edit this** puts one in the form to edit, keeping its record number. **Move to bin** removes it, and the Bin can bring it back.",
        from: "this device",
      });
      say({
        kind: "found",
        action: "edit",
        alsoBin: true,
        candidates: newest.map((row, n) => ({ row, score: 100 - n, why: [n === 0 ? "the newest entry" : "a recent entry"] })),
        done: [],
      });
      log(aiEvent("answered", "add", { text: `Offered the ${newest.length} newest entries to edit. Asked: ${note}`, model: "this device" }));
      return;
    }

    if (openCards.length > 0 && files.length === 0 && !as && wantsDiscardAll(ruled)) {
      setDraft("");
      say({ kind: "you", text: note });
      discardEveryOpen(note);
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
    /**
     * A delete is read here, whatever the router said.
     *
     * ── The three messages this closes ──────────────────────────────────
     *
     *   delete my latest spending thats wrong
     *   delete it
     *   I said delete it now show me more data to delete
     *
     * All three produced nothing at all. Not because the finder failed:
     * `detectRecall` reads the first one correctly and `findRows` finds the
     * row. They never reached it. This was only consulted when the router had
     * given up and answered "question" or "chat", and the router had instead
     * answered "entry", so a message whose first word is "delete" was on its
     * way to becoming a new row.
     *
     * A sentence carrying a delete verb and a target is not ambiguous, and
     * the local rule is exact where the router is guessing. The one thing
     * that outranks it is the sentence reading as an entry on its own, which
     * is checked at the point of use below.
     */
    // "should I delete my netflix?" asks; it is not a delete (`asksRatherThanTells`).
    const localRecall = files.length === 0 && !as && !asksRatherThanTells(ruled) ? detectRecall(ruled) : null;

    const saysAnswer = routed?.intent === "answer";
    const saysCorrection = routed?.intent === "correction";

    /**
     * A whole entry is a new entry, not an answer to "how much was it".
     *
     * The answering path takes over whenever the router could not be reached,
     * which is often, and then everything typed goes into the half-finished
     * row. "I transferred 2000 from maya to gcash" was answered with "That is
     * not one of your accounts. Gcash, Maya, Cash, ..." because the whole
     * sentence had been offered as a wallet name. Both of those wallets are
     * of course accounts, which is what makes that reply so baffling to read.
     *
     * A reply to a question is short and partial: "500", "gcash", "the usual".
     * A sentence that reads as a complete entry on its own, with its flow, its
     * figure and its wallet, is not a reply to anything. It starts a new row
     * and the half-finished one is dropped.
     */
    /**
     * ── The figure is what makes it a new entry ──────────────────────────
     *
     * The owner typed "I earn 1000", was asked what it was for, answered
     * "maya and income from my business", and was then asked how much it was.
     * They had said how much in their first word of it.
     *
     * This gate is why. The reply is six words, names income and names a
     * wallet, so it read as a whole entry, the half finished one was dropped,
     * and the PHP 1,000 went with it. The paragraph above already says what a
     * fresh start needs: its flow, its figure and its wallet. The figure was
     * never actually required, so an answer that happened to be wordy was
     * mistaken for a new row.
     *
     * A reply carrying no figure of its own cannot be a new entry. It is an
     * answer to the question that was asked, which is the far commoner thing
     * to be typing while a question is on screen.
     */
    const afresh =
      pending !== null && files.length === 0 && !as && note.trim().split(/\s+/).length >= 4
        ? readEntry(note, transactions, reference, asOf)
        : null;

    const startsAfresh = afresh !== null && afresh.worthOffering && afresh.draft.amount !== null;

    if (startsAfresh) setPending(null);

    if (
      pending &&
      !startsAfresh &&
      files.length === 0 &&
      !as &&
      !isNoteLine &&
      /*
       * With no router, only a reply that could be an answer. "delete the
       * breakfast I just added" was taken as what the breakfast was for
       * (28 September 2026, model unreachable): an instruction or a question
       * is never the answer to the question on screen.
       */
      (routed === null
        ? localRecall === null && !isQuestion(note) && looksLikeAnswer(note, pending.blank)
        : saysAnswer || saysCorrection)
    ) {
      setDraft("");
      setBusy(true);
      try {
        await during("Checking your answer", () => answerPending(note), "Still checking it");
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
        // The file half has just been answered. What goes to the model is
        // the half about money, or it refuses the file a second time.
        await askQuestion(withoutTheFilePart(note), false);
      } finally {
        setBusy(false);
      }
      return;
    }

    /*
     * "make it blue", "change the colors", with a chart on screen.
     *
     * The colour of a chart is the direction of its money (rule D3), which
     * is what lets a red bar be read without a legend on every screen and in
     * both themes. So the answer says why it stays, and offers what can
     * change instead, rather than a model promising a recolour it cannot do.
     */
    if (files.length === 0 && !as && asksChartColour(ruled) && (turns.some(isChart) || wantsChart(ruled))) {
      setDraft("");
      say({ kind: "you", text: note });
      say({
        kind: "assistant",
        text:
          "Chart colours say which way the money went, so they stay the same everywhere: red is money out, green is money in, grey is a transfer and amber is debt. They follow the light and dark theme on their own. What I can change is the shape and the window: say \"as a line\", \"as a pie\" or \"as bars\", or name a period such as \"this week\" or \"since July\".",
        from: "this device",
      });
      log(aiEvent("answered", "add", { text: `Explained chart colours. Asked: ${note}` }));
      return;
    }

    /*
     * "gas only" straight after a chart narrows that chart, whatever the
     * router made of it: on 27 September 2026 it became an entry card
     * asking how much the gas was.
     */
    const lastShown = [...turns].reverse().find((t) => t.kind !== "you");
    const narrows = files.length === 0 && !as && lastShown !== undefined && isChart(lastShown) && narrowsChart(ruled);
    const followUp = isChartFollowUp(ruled, turns.some(isChart)) || narrows;
    const saysChart = routed?.intent === "chart";

    /**
     * A question about a credit line is never a chart.
     *
     * "check my maya credit draw by draw" was routed to a chart and answered
     * with "There is no spending in that period to draw". It is a request to
     * go through a debt movement by movement, which is prose, and the ledger
     * now sends every one of those movements along with the question.
     *
     * The model routed it, so the model is overruled here rather than argued
     * with, the same way it is for a delete and for a chart follow-up.
     */
    const flat = ` ${note.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
    const aboutADebt = (reference.credits ?? []).some((line) => {
      const name = line.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      return name !== "" && flat.includes(` ${name} `);
    });

    /*
     * A request to be told something is not satisfied by being shown one.
     *
     * "tell me what actually caused the difference rather than just stating
     * the totals" was answered with a bar chart of August (20 September
     * 2026). The router calling it a chart is understandable, since it names
     * a comparison and a grouping; the sentence still says what it wants.
     */
    /*
     * And a question asked as a question, with no word for a chart in it and
     * no chart to follow up, is answered in words: "so since starting I didnt
     * have good budgeting?" was routed to a chart of September (28
     * September 2026).
     */
    const plainQuestion = /\?\s*$/.test(note) && !wantsChart(note) && !followUp && !narrows;
    const wantsWords = asksForProse(note) || plainQuestion;
    /*
     * Except a chart of what is owed: "chart my maya credit" is a picture of
     * the line over time, which the app now draws (`chartAsk.ts`). Going
     * through it draw by draw is still a question.
     */
    const owedChart = measureOf(localHint(ruled, credits)) === "owed";

    if (
      files.length === 0 &&
      !as &&
      (!aboutADebt || owedChart) &&
      !wantsWords &&
      (saysChart ||
        narrows ||
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
      const shownChart = [...turns].reverse().find(isChart)?.chart;
      /*
       * A pie is a split of the whole, so "show me a chart like pie" after a
       * chart of the months is the same window split by item, not the months
       * as slices, unless the new message itself says by month or by day.
       */
      const shown =
        shownChart && asksPie(ruled) && !saysOverTime(ruled)
          ? { ...shownChart, title: shownChart.title.replace(/\bby (?:month|day)\b/i, "by item") }
          : shownChart;
      const namesPeriod = /\b(20\d{2}|january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec|month|year|week|today|yesterday|all|everything|days?|since|quarter|q[1-4])\b/i.test(
        ruled,
      );
      /*
       * A follow-up that names only a new period keeps what the chart was:
       * its grouping and its direction, which are the part of the title
       * before the comma ("Spending by month", then ", 2026"). "show me
       * trend this year" then "2025" drew 2025 by item (28 September 2026).
       */
      const saysGrouping = /\b(?:by|per)\s+(?:items?|months?|days?|weeks?|wallets?|accounts?|categor(?:y|ies)|years?)\b|\b(?:monthly|daily|weekly|yearly|trend|over time|pie|donut|bars?|line)\b/i.test(ruled);
      const namesDirection = /\b(income|incomes|revenue|earn(?:ed|ings|s)?|received|came in|money in|spend(?:ing|s)?|spent|expenses?|money out|went out|cash ?flow|vs|versus)\b/i.test(ruled);
      /*
       * The title carried over keeps its window and grouping, never its
       * direction when the message names one: "show my trend of income"
       * after a spending chart carried "Spending by item" and drew both
       * (28 September 2026).
       */
      /*
       * A comparison's title names both periods; carried as words they read
       * as "compare two months" and drew one bar (3 October 2026). Its own
       * window goes as dates instead, and the earlier one comes along as
       * `pair` below when the follow-up keeps comparing.
       */
      const shownTitle = !shown
        ? ""
        : shown.against?.periods
          ? `${shown.title.split(",")[0] ?? ""}, ${shown.against.periods.now.from} to ${shown.against.periods.now.to}`
          : shown.title;
      /*
       * A new grouping replaces the old one rather than sitting beside it:
       * "by category" after "Spending by wallet" kept wallet, because the
       * title's "by wallet" was read first.
       */
      const namesGrouping = /\b(?:by|per)\s+(?:items?|months?|days?|weeks?|wallets?|accounts?|categor(?:y|ies)|years?)\b|\b(?:monthly|daily|weekly|yearly)\b/i.test(ruled);
      const regrouped = namesGrouping ? shownTitle.replace(/\s+by\s+(?:item|wallet|category|month|day|week|year)\b/i, "") : shownTitle;
      const title = !shown ? "" : namesDirection ? regrouped.replace(/^(?:spending|income)\s+/i, "") : regrouped;
      const carriedTitle = !shown
        ? note
        : !namesPeriod
          ? `${note} ${title}`
          : followUp && !saysGrouping
            ? `${note} ${title.split(",")[0] ?? ""}`
            : note;
      /*
       * And its direction, whatever else changes. "show my trend of income"
       * then "by year" drew spending by year (28 September 2026): the new
       * grouping replaced the title, and with it the word income. Only for a
       * chart drawn in the last few turns, and only when the message names
       * neither direction itself.
       */
      const recentChart = turns.slice(-6).some(isChart);
      const carried =
        shown && recentChart && !namesDirection && carriedTitle === note && chartDirection(shown) === "revenue" ? `${note} income` : carriedTitle;

      /*
       * "chart what I picked" on Insights is the calendar's pick, not this
       * month. Only when the message names no window of its own: "chart
       * this week" means this week wherever it is asked.
       */
      const pick = currentScreen()?.range;
      const onPick =
        pick !== undefined &&
        pointsAtScreen(ruled, turns.some(isChart)) &&
        !namesWindow(ruled.replace(/\b(picked|selected|highlighted|those|these)\s+days?\b/gi, " "));
      const asked = onPick
        ? `${note} ${pick.from === pick.to ? pick.from : `${pick.from} to ${pick.to}`}`
        : /*
           * The router's period only when this message names one, or no chart
           * is on screen to follow. It reads the history too, and handed "pie"
           * and "spending only" the window of the first chart, three charts
           * back (28 September 2026).
           */
          routed?.period && (namesPeriod || !shown)
          ? `${carried} ${routed.period}`
          : carried;
      /*
       * Money in and money out together ("income vs spending", "cash flow")
       * is two charts, each in its own colour, rather than one of them.
       */
      /*
       * Two periods side by side, as the assistant read them: "this month
       * compared to last month" however it is worded (3 October 2026, the
       * owner: "sometimes the grammar will change so identify first"). A
       * follow-up that names no period of its own ("by wallet", "pie") keeps
       * comparing the two on screen.
       */
      const [laterSaid, earlierSaid] = routed?.compare ?? [];
      const saidPair = laterSaid && earlierSaid ? periodsSaid(laterSaid, earlierSaid, asOf) : null;
      // A pie is one period split up, so "pie" after a comparison draws this period alone.
      const pair = saidPair ?? (followUp && !namesPeriod && !asksPie(ruled) ? shown?.against?.periods ?? null : null);
      /*
       * What to draw, read from this message and, for a new request, from
       * what the model said to draw (`chartAsk.ts`). A follow-up keeps what
       * the chart on screen measured: "by day" after a budget chart is the
       * budget by day, not spending.
       */
      const fresh = !followUp && !narrows;
      const keptMeasure: ChartHint | null =
        !fresh && shown?.measure && !namesDirection ? { money: shown.measure, ...(shown.by === "wallet" ? { by: "wallet" as const } : {}) } : null;
      const hint = mergeHint(localHint(ruled, credits) ?? keptMeasure, fresh ? (routed?.draw ?? null) : null, ruled, credits);
      const drawn = chartsFor(asked, hint, measureOf(hint) ? null : pair);
      setDraft("");
      say({ kind: "you", text: note });
      for (const chart of drawn) drawChart(chart);

      const measure = measureOf(hint);
      const both = !measure && wantsBothDirections(inWords(asked, hint));
      if (drawn.length === 0 || (both && drawn.length === 1 && chartDirection(drawn[0] as Chart) === "spending")) {
        say({
          kind: "assistant",
          text:
            drawn.length > 0
              ? "There is no income in that period to draw beside it."
              : measure === "budget"
                ? "There is no spending or budget in that period to draw. Name a month that has started, or the year."
                : measure === "balance"
                  ? "No entry moves that account in that period. Try a wider window, or name the account the way Settings does."
                  : measure === "owed"
                    ? "Nothing has been borrowed on that line yet, so there is nothing owed to draw."
                    : chartTopic(asked, transactions)
                      ? `Nothing in your entries mentions ${chartTopic(asked, transactions).replace(/^./, (c) => c.toUpperCase())}. Say it the way the entry's description does, or name the item instead.`
                      : "There is nothing in that period to draw. Try a wider window, a month with entries in it, or the year.",
          from: "this device",
        });
        log(aiEvent("answered", "add", { text: `No chart drawn: nothing in that period. Asked: ${note}` }));
      }

      /*
       * The chart, and the question as well when the message asks one:
       * "How much did I spend on my trip to Abra? show me a chart" wants the
       * figure said, not only drawn. The model answers from the chart's own
       * figures, so the two agree.
       */
      const asksMore = /\b(?:how much|how many|why|explain|tell me|which|what (?:did|was|is|are|were)|did i|am i|is it|was it|magkano|bakit|ilan)\b/i.test(note);
      if (drawn.length > 0 && asksMore && !ai.disabled) {
        setBusy(true);
        try {
          await askQuestion(note, false, { text: chartsWorked(drawn, chartInWords), fallback: drawn.map(chartReading).filter(Boolean).join(" ") });
        } finally {
          setBusy(false);
        }
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
    /*
     * A correction the card on screen can take is about that card, even when
     * the router calls it an edit of saved rows: the card is what is being
     * looked at. A saved row is meant when one is named.
     */
    const shownCard = openCard();
    // A whole new entry is not a correction to the card above it (`startsNewEntry`).
    const fresh = shownCard !== null && files.length === 0 && !as ? readEntry(note, transactions, reference, asOf) : null;
    const saysNewEntry =
      fresh !== null &&
      (startsNewEntry(note, fresh) ||
        // The router read a new entry ("lunch 150 gcash"), with its own figure, not worded as a correction.
        (routed?.intent === "entry" && /\d/.test(note) && note.trim().split(/\s+/).length >= 3 && !WORDED_AS_CORRECTION.test(note)));
    const cardTakesIt =
      !saysNewEntry &&
      shownCard !== null &&
      files.length === 0 &&
      !as &&
      /*
       * A sentence about deleting or restoring is never an amendment.
       *
       * Live, 20 September 2026: "restore the snack from may 7" was taken as
       * a correction to the card on screen, and "may 7" set its amount to
       * PHP 7.00. The restore was never answered, the card quietly changed,
       * and the only sign of either was a line reading "Amount changed."
       *
       * `amend` reads figures, and it will find one in almost any sentence.
       * What decides this is the verb: a message carrying a delete or restore
       * verb is about a saved row, whatever figures happen to be in it.
       */
      localRecall === null &&
      !/#\s*\d|\b(entry|entries|record|records|saved|yesterday)\b/i.test(note) &&
      amend(shownCard.turn.proposal.draft, note, reference, asOf) !== null;
    const saysRecall =
      !cardTakesIt && !asksRatherThanTells(ruled) && (routed?.intent === "delete" || routed?.intent === "restore" || routed?.intent === "editEntry");
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
            ? localRecall
            : /**
               * The local reading wins unless the sentence is an entry.
               *
               * "I paid 500 for food from gcash" carries no delete verb and
               * never reaches here. "cancel my netflix" carries one and does,
               * which is why an entry outranks it: a sentence that reads as a
               * complete row is a row.
               */
              localRecall && !readEntry(note, transactions, reference, asOf).worthOffering
              ? localRecall
              : null;

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
      /**
       * "latest" anywhere in the phrase, not only as the whole of it.
       *
       * "delete my latest spending thats wrong" came back with five rows
       * from August, matched on the word "spending". The phrase was not
       * exactly "latest", so recency was never used, and "spending" is the
       * name of a flow rather than a description of a row: every spending row
       * in the ledger answers to it.
       */
      /**
       * Tested against what was typed, not against what survived stripping.
       *
       * `recall.phrase` is the message with the instruction words taken out,
       * and "last" is one of those words. So the phrase could never contain
       * it and this could never fire, however it was written: "delete that
       * last" and "undelete the last one" strip to nothing at all and both
       * came back with "no entry matches that". The instruction lives in the
       * original message, so that is what is read.
       */
      const wantsLatest =
        /\b(last|latest|most recent|newest|recent|huli)\b/i.test(note);

      /*
       * "Restore it", about the row this conversation just binned.
       *
       * Before anything is searched for, because there is nothing to search
       * for: the words are "it" or "that", and what they point at is the
       * thing that happened a moment ago in this same thread.
       */
      const justBinned =
        recall.action === "restore" && binnedHere.current.length > 0 && !wantsLatest
          ? deleted.filter((row) => binnedHere.current.includes(row.id))
          : [];
      const pointsAtWhatHappened = justBinned.length > 0 && recall.phrase.trim().length <= 3;

      const candidates = pointsAtWhatHappened
        ? justBinned.slice(0, 1).map((row) => ({ row, score: 100, why: ["the one you just binned"] }))
        : wantsLatest
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
        /**
         * Recorded, because looking and finding nothing is an answer.
         *
         * Coderview lists a message with no card and no answer under "Said,
         * and nothing happened", which is meant to be the list of real
         * failures. Every correct refusal landed in it, because this reply
         * was never logged, and the list filled with searches that had worked
         * exactly as intended. Deliberately finding nothing is not the same
         * as doing nothing.
         */
        log(
          aiEvent("answered", "add", {
            text: `Searched and found nothing for "${recall.phrase}".`,
            model: "this device",
          }),
        );
        return;
      }

      log(
        aiEvent("answered", "add", {
          text: `Found ${candidates.length} row${candidates.length === 1 ? "" : "s"} to ${recall.action === "restore" ? "restore" : "bin"}.`,
          model: "this device",
        }),
      );
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
    if (files.length === 0 && !as && !saysNewEntry && detectIntent(note) === "ask") {
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
          /*
           * Written, so a refresh brings back the card as corrected. "Change
           * all waller to maya only" changed five cards on screen and none in
           * the record, and the next load showed them without a wallet.
           */
          for (const c of changed) {
            recordCard({
              ...c.turn,
              proposal: { ...c.turn.proposal, draft: c.change.draft, adjustments: [...c.turn.proposal.adjustments, c.change.what] },
            });
          }
          /*
           * Each field that moved, with its own values, as the single card's
           * correction below writes it. "several" with a date and a wallet
           * joined into one string recorded eight changes on 26 September
           * 2026 whose before and after read the same. Wallets and items are
           * learned when the card is saved (`learnFrom`).
           */
          for (const c of changed) {
            const was = c.turn.proposal.draft;
            const now = c.change.draft;
            const entry = `${now.date} ${now.flow} ${now.item}`;
            if (was.date !== now.date) log(aiEvent("edited", "add", { field: "date", proposed: was.date, corrected: now.date, entry }));
            if (was.amount !== now.amount) {
              log(aiEvent("edited", "add", { field: "amount", proposed: formatMoney(was.amount ?? 0), corrected: formatMoney(now.amount ?? 0), entry }));
            }
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

      /*
       * The newest card first, then the ones above it.
       *
       * "Fix the entry its not subscription" on 26 September 2026 had two
       * cards open: the purchase, filed as a subscription, and the refund
       * under it. Only the newest was tried, a refund cannot stop being a
       * subscription, and nothing happened. A correction goes to the newest
       * card it can apply to, so "make it 300" still means the one in front
       * of you and a correction only one card fits finds that card.
       */
      const card = (() => {
        const open = turns.flatMap((t, index) => (isOffer(t) && t.state === "open" ? [{ index, turn: t }] : [])).reverse();
        for (const c of open) {
          const found = amend(c.turn.proposal.draft, note, reference, asOf);
          if (found) return { ...c, change: found };
        }
        return null;
      })();
      if (card) {
        const change = card.change;
        setDraft("");
        // Written, like the cards above, so the correction survives a refresh.
        recordCard({
          ...card.turn,
          proposal: { ...card.turn.proposal, draft: change.draft, adjustments: [...card.turn.proposal.adjustments, change.what] },
        });
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
        // The item and the wallets are learned when the card is saved (`learnFrom`), so only a saved correction teaches.
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
    /*
     * And with no model at all, the same. "6 pesos unknown spending cash" has
     * no verb, so the word rules called it a question, and the question path
     * had nothing to answer with but "The AI model is not working" (28
     * September 2026, with the model unreachable). The entry reader can read
     * it on its own, so it gets the sentence.
     */
    /*
     * "I said 250 not 450", with no card on screen for it to correct, puts
     * right what the last answer understood: the conversation goes on, and
     * no row is read from it (4 October 2026, a PHP 250.00 card "said not").
     */
    const correctsAnswer = files.length === 0 && !as && !pending && shownCard === null && correctsWhatWasSaid(ruled);
    const readsAsEntry =
      (modelGaveUp || routed === null) &&
      files.length === 0 &&
      !as &&
      !isQuestion(note) &&
      !correctsAnswer &&
      readEntry(note, transactions, reference, asOf).worthOffering;

    /*
     * "remember that my allowance is 8000 a month" is said to the assistant,
     * not money moving: it became an income card (28 September 2026). The
     * model acknowledges it, and `keepInMind` carries it from then on.
     */
    const tellsToRemember = /^\s*(?:please\s+|pls\s+|ok(?:ay)?\s+)?(?:remember|tandaan|keep in mind|note that|take note|fyi|for your info(?:rmation)?)\b/i.test(ruled);
    const job =
      as ??
      (files.length > 0
        ? "log"
        : tellsToRemember || correctsAnswer
          ? "ask"
          : /**
           * Advice outranks a sentence that also reads as an entry.
           *
           * "should I go to mcdonalds today spend 30k?" has a verb, a figure
           * and something bought, so it reads as a PHP 30,000 entry, and this
           * check used to come first. Nobody asks "should I" about money that
           * has already moved. The scoreboard in `domain/eval` found three of
           * these, the same class of fault that once filed a question about
           * tuition as two PHP 20,000 rows.
           */
          readsAsEntry && !isAdvice(note)
          ? "log"
          : /**
             * ── A question is never filed, whatever the router says ───────
             *
             * "I have 20000 saved and tuition is 18000 next month, what
             * should I do" became two ledger entries, Spending School PHP
             * 20,000.00 and Spending Parking PHP 20,000.00. Neither happened.
             * It is a question about a decision, and being asked for advice
             * is a feature rather than a thing to file.
             *
             * The router is a model and it answered "entry", and its answer
             * won outright: `isQuestion` sat in the branch below and was
             * never reached, because that branch only runs when the router
             * could not be reached at all.
             *
             * So a plain question is decided here, above the router. It is
             * narrow on purpose: the local reader has already been asked and
             * did not see an entry, which is what `readsAsEntry` above means.
             * A sentence that reads as both, "I paid 500 for food, which
             * wallet should I use", is an entry and never reaches this line.
             */
            isQuestion(note)
            ? "ask"
            : routed
              ? routed.intent === "question" || routed.intent === "chat"
                ? "ask"
                : "log"
              : detectIntent(note));

    setDraft("");
    setBusy(true);
    try {
      if (job === "ask") {
        /*
         * Two periods set against each other, asked in words: both, the same
         * days of each, worked out here (`comparisonWorked`). The router names
         * the periods however the question is put; the device's own reading
         * is the fallback.
         */
        const [laterSaid, earlierSaid] = routed?.compare ?? [];
        const pair = (laterSaid && earlierSaid ? periodsSaid(laterSaid, earlierSaid, asOf) : null) ?? comparedPeriods(ruled, asOf);
        const compared = pair ? comparisonWorked(ruled, transactions, pair) : "";
        /*
         * A plan said by the week or the day ("250 per week ... would that
         * work?"), and a correction of one ("I said 250 not 450"): the app's
         * own arithmetic against what is left of the spending budget, so the
         * model chooses the reading and works out nothing (`planRate.ts`).
         */
        const saidBefore = [...turns].reverse().filter((t): t is Said => t.kind === "you").slice(0, 3).map((t) => t.text);
        const plan = compared ? "" : planWorked(ruled, { transactions, budgets, asOf, ...(correctsAnswer || saidBefore.length > 0 ? { before: correctsAnswer ? saidBefore : [] } : {}) });
        await askQuestion(
          note,
          true,
          compared
            ? { text: `Two periods side by side, worked out by the app from the ledger. Answer with these figures:\n${compared}`, fallback: compared }
            : plan
              ? {
                  text: correctsAnswer ? `They are correcting a figure your last answer took. Answer again with the figure they say.\n${plan}` : plan,
                  // With no model, the app's own lines, without the one addressed to the model.
                  fallback: plan.split("\n").slice(1).join(" "),
                }
              : correctsAnswer
                ? { text: "They are correcting what your last answer took them to mean. Answer the same question again with what they say now, and never treat it as a new entry." }
                : null,
          besideFor(ruled, pair),
        );

        /*
         * A message can be both, and the entries in it must not be lost.
         *
         * Live, 20 September 2026: thirty purchases in Taglish and then
         * "pakisagot din: magkano lahat ng ginastos ko". It ends in a
         * question, so it was answered, and the thirty entries were dropped
         * without a word. A question mark at the end is not a reason to throw
         * away what someone typed.
         *
         * Offered rather than read straight away: an answer and a screenful
         * of cards at once is its own kind of mess, and the offer costs one
         * word. `wantsThoseEntries` takes it from there.
         */
        const alsoEntries = entriesInside(note);
        if (alsoEntries >= 2) {
          entriesLeftBehind.current = note;
          say({
            kind: "assistant",
            ephemeral: true,
            text: `That message has ${alsoEntries} entries in it as well. Say "add them" and I will read them out; nothing is saved until you press the button on each card.`,
            from: "this device",
          });
        }
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

        /**
         * A question about borrowing is a question, not a borrowing.
         *
         * "if I loan 1 billion for treat is it good??" contains "loan", so
         * this gate matched and put a debt card on screen asking which credit
         * line a hypothetical billion pesos belongs to. Nobody borrowed
         * anything. They asked whether they should, which is advice, which is
         * the thing the assistant is meant to be good at.
         *
         * Checked here as well as in the routing below, because this gate
         * runs first and returns: by the time the router's answer is looked
         * at, the card is already up.
         */
        /*
         * Part someone else's money and part the owner's, in one transfer, is
         * two entries: the model is taught to split it (ai.ts), and this card
         * would have filed the lot as theirs. See `splitsWhose`.
         */
        if (local.readsAsDebt && !severalParts && !isQuestion(note) && !splitsWhose(note) && !essay) {
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
          // A payment of what the line owes, filled in as what was borrowed plus its interest and fees.
          const card = debtCard(asAmountAndFees(local.draft, transactions), note);
          const intro = debtCardIntro(
            card.turn.draft,
            local.interestUnstated ?? false,
            debts,
            local.passThrough,
            card.turn.draft.debtId ? owedParts(transactions, card.turn.draft.debtId, asOf) : undefined,
          );
          say({
            kind: "assistant",
            text:
              card.notes.length > 0
                ? intro.replace(/Check the card, then add it\.$/, `${card.notes.join(" ")} Check the card, then add it.`)
                : intro,
            from: "this device",
            ephemeral: true,
          });
          log(
            aiEvent("proposed", "add", {
              entry: `${local.draft.date} Debt ${formatMoney(local.draft.amount ?? 0)}`,
              text: note,
            }),
          );
          say(card.turn);
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
        if (ai.disabled && local.worthOffering && !severalParts && !isAdvice(note)) {
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
        const said = totalsIn(note).item;
        const each = lines.map((line) => fileAsSaid(readEntry(line, transactions, reference, asOf), said));

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
          const total = totalWords(readTotals(note), formatMoney);
          if (total) say({ kind: "assistant", ephemeral: true, text: `${usable.length} entries. ${total}`, from: "this device" });
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
              say(debtCard(r.draft, lines[i] ?? "").turn);
              continue;
            }
            if (!r.worthOffering) continue;
            await offer(
              {
                draft: r.draft,
                confidence: "high",
                sourceRef: `part ${i + 1}: ${lines[i] ?? ""}`,
                typed: true,
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
                typed: true,
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

  /** The answers to tap under the question an entry is waiting on (`pendingChoices`). */
  const pendingOptions = useMemo(
    () => (pending ? pendingChoices(pending.draft, pending.blank, reference, transactions) : []),
    [pending, reference, transactions],
  );

  /** Cards still waiting on a decision. */
  const open = turns.filter((t): t is Offered => isOffer(t) && t.state === "open");
  const openCount = open.length;

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
    /** Open cards off a picture with no match of their own, for the check below. */
    const unmatched: number[] = [];
    turns.forEach((t, i) => {
      if (!isOffer(t) || t.state !== "open") return;
      const offPicture = readOffPicture(t.proposal);
      const matches = duplicatesOf(t.proposal.draft, transactions, { typed: !offPicture });
      if (matches.length > 0) found.set(i, matches);
      else if (offPicture) unmatched.push(i);
    });
    /*
     * Cards that are one row here together: three load purchases the owner
     * logged as one ₱408.00 row, offered and added again one by one on 2
     * October 2026 (`togetherAsOne`).
     */
    const drafts = unmatched.map((i) => (turns[i] as Offered).proposal.draft);
    for (const [k, match] of togetherAsOne(drafts, transactions)) {
      const at = unmatched[k];
      if (at !== undefined) found.set(at, [match]);
    }
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

  const { repeatOfCard, repeatTwinAt } = useMemo(() => {
    const indexes: number[] = [];
    turns.forEach((t, i) => {
      if (isOffer(t) && t.state === "open") indexes.push(i);
    });
    const drafts = indexes.map((i) => (turns[i] as Offered).proposal.draft);
    const byTurn = new Map<number, Draft>();
    const twinAt = new Map<number, number>();
    for (const [later, earlier] of repeatsWithin(drafts)) {
      const at = indexes[later];
      const twin = drafts[earlier];
      const twinIndex = indexes[earlier];
      if (at !== undefined && twin) byTurn.set(at, twin);
      if (at !== undefined && twinIndex !== undefined) twinAt.set(at, twinIndex);
    }
    return { repeatOfCard: byTurn, repeatTwinAt: twinAt };
  }, [turns]);

  /**
   * Why Add all leaves a card for the owner, or null when it takes it.
   *
   * 27 September 2026: a Maya history of 29 cards was added with one press
   * of Add all, and 13 of them were already in the ledger, 6 were the
   * stitched screenshot repeating itself, and 8 were still waiting on a
   * question. Maya went from PHP 369.96 to minus PHP 3,311.55. Each of those
   * cards said so on its face; Add all did not read it. Now a card already in
   * the ledger, a repeat of a card above it, or a card with a question still
   * open is left for its own buttons. A card with extra zeros never was.
   */
  const heldBack = (t: Offered, i: number): Exclude<Standing, "ready"> | null => {
    // A copy first: whatever else is wrong with it, the answer is the same (skip it or add it anyway).
    if (alreadyInLedger.has(i)) return "ledger";
    if (repeatOfCard.has(i)) return "repeat";
    if (nextQuestion(t.proposal.draft, reference) !== null) return "question";
    const c = sink.check(t.proposal.draft);
    if (!c.ok || c.unusual !== undefined) return "check";
    return null;
  };

  /**
   * Where each open card stands, and its number in the list.
   *
   * 27 September 2026, the owner, of "Add the 2 ready", "Discard the 4
   * copies" and "Discard all 7": "they are so misleading fix it make it
   * connect". The bar counted cards the owner could not find: which two were
   * ready, which four were copies of what. Every open card now carries its
   * number and its standing, in the bar's own words, and the bar names the
   * cards each button acts on.
   */
  const openIndexes: number[] = [];
  turns.forEach((t, i) => {
    if (isOffer(t) && t.state === "open") openIndexes.push(i);
  });
  const standing = new Map<number, Standing>();
  for (const i of openIndexes) standing.set(i, heldBack(turns[i] as Offered, i) ?? "ready");
  const placeOf = new Map(openIndexes.map((i, k) => [i, k + 1]));
  const groups = STANDING_ORDER.map((key) => ({ key, cards: openIndexes.filter((i) => standing.get(i) === key) })).filter((g) => g.cards.length > 0);
  const readyCount = groups.find((g) => g.key === "ready")?.cards.length ?? 0;

  /** The number of the card the question bar is asking about, in the same count as the cards and the batch bar. */
  const askedPlace = openCount > 1 && askedCard ? placeOf.get(turns.findIndex((t) => isOffer(t) && t.cardId === askedCard)) : undefined;

  /**
   * The batch bar on a phone: one line until it is opened.
   *
   * Opened, it listed every group with its own 44px button, and with a
   * question under the thread that left the cards a strip about a hundred
   * pixels tall between the two (owner, 28 September 2026, a screenshot of
   * seven cards: "this is too much in phone, fix it"). Closed, it says how
   * many cards, what they are in a few words, and the one button most
   * wanted, adding the ready ones. A computer has the room and keeps it open.
   */
  const [barOpen, setBarOpen] = useState(false);
  const barFull = wide || barOpen;

  /** Bring a card into view and put the focus on it, so the bar's "card 4" is one tap from card 4. */
  const jumpTo = (index: number): void => {
    const thread = threadRef.current;
    const el = cardElements.current.get(index);
    if (!thread || !el) return;
    thread.scrollTop = Math.max(0, thread.scrollTop + topWithin(el, thread) - 8);
    el.focus({ preventScroll: true });
    // On a phone the bar folds again, so the card it went to has the room.
    if (!wide) setBarOpen(false);
  };

  /** Close the given cards without adding them: the copies, when the owner says skip them. */
  const skipCards = (indexes: readonly number[]): void => {
    const skipped = new Set(indexes);
    turns.forEach((t, i) => {
      if (!skipped.has(i) || !isOffer(t) || t.state !== "open") return;
      const closed = closedCard(t);
      if (closed) recordCard(closed);
    });
    setTurns((prev) => prev.map((t, i) => (skipped.has(i) && isOffer(t) && t.state === "open" ? closedCard(t) ?? t : t)));
  };

  /**
   * Add every card that would save, and leave the rest showing.
   *
   * One pass over the list rather than one setState per card, so eight rows
   * are one render and one batch of writes rather than eight of each.
   */
  /*
   * Each card the way its own Add to ledger button does it: what is on the
   * card (an edit made on it included), logged as accepted, learned from,
   * and written down as added.
   *
   * It only changed the screen. The rows were saved and the cards were not
   * recorded, so after a reload they came back open: on 2 October 2026 two
   * Maya Bank interest cards added this way at 05:08 were back ten minutes
   * later, were discarded, and stayed in the ledger as #3869 and #3870; the
   * two added by hand in between were warned as copies of them. It also
   * saved the card as first read, so a figure corrected on the card was lost.
   */
  const addReady = (): void => {
    // Each card keeps the number its own row was given. Reading the next one
    // afterwards showed every card in the batch the same figure.
    const given = new Map<number, Offered>();
    turns.forEach((t, i) => {
      if (!isOffer(t) || t.state !== "open" || standing.get(i) !== "ready") return;
      const draft = t.live ?? t.proposal.draft;
      log(
        aiEvent("accepted", "add", {
          entry: `${draft.date} ${draft.flow} ${draft.item} ${formatMoney(draft.amount ?? 0)}`,
          text: "Added with the batch's Add ready",
        }),
      );
      learnFrom(t, draft);
      const number = sink.add(draft, {
        actor: "ai",
        via: t.proposal.sourceRef.toLowerCase().includes("image") ? "ai_image" : "ai_chat",
      });
      const added: Offered = {
        ...t,
        state: "added",
        ...(number === null || number === undefined ? {} : { recordNumber: number }),
      };
      recordCard(added);
      given.set(i, added);
    });
    setTurns((prev) => prev.map((t, i) => (given.has(i) && isOffer(t) ? (given.get(i) ?? t) : t)));
  };

  const discardOpen = (): void => {
    discardEveryOpen();
  };

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
        /*
         * The files, and the items as files: an Android keyboard pasting a
         * screenshot often leaves `files` empty and puts it in `items`
         * (4 October 2026, "allow copy paste ... I screenshot then I can
         * attach it directly").
         */
        const fromItems = [...e.clipboardData.items]
          .filter((i) => i.kind === "file" && i.type.startsWith("image/"))
          .map((i) => i.getAsFile())
          .filter((f): f is File => f !== null);
        const pasted = e.clipboardData.files.length > 0 ? [...e.clipboardData.files] : fromItems;
        if (pasted.length === 0) return;
        // Let a pasted screenshot in without also pasting its filename.
        e.preventDefault();
        void attach(pasted.map((f, i) => (f.name && f.name !== "image.png" ? f : new File([f], `Pasted picture ${i + 1}.${f.type.split("/")[1] === "jpeg" ? "jpg" : (f.type.split("/")[1] ?? "png")}`, { type: f.type }))));
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
        <div className={wide ? "fms-batchbar fms-batchbar--wide" : barOpen ? "fms-batchbar is-open" : "fms-batchbar is-folded"}>
          <div className="fms-batchbar-head">
            {wide ? (
              <span className="t-body-strong">{openCount} cards to check</span>
            ) : (
              <button
                type="button"
                className="fms-batchbar-toggle"
                aria-expanded={barOpen}
                onClick={() => setBarOpen((o) => !o)}
              >
                <span className="fms-batchbar-count">
                  <span className="t-body-strong">{openCount} cards to check</span>
                  <span className="t-micro fms-batchbar-brief">
                    {groups.map((g) => `${g.cards.length} ${STANDING_SHORT[g.key]}`).join(" · ")}
                  </span>
                </span>
                <span aria-hidden className="fms-batchbar-chev">
                  <Icon name="chevronDown" size={18} />
                </span>
              </button>
            )}
            {/*
              Throwing them all away is a quiet button, not a link, and it
              says how many it throws away: every open card, the ready ones
              included. Folded on a phone, the button beside the count is the
              ready ones instead, the thing most often wanted.
            */}
            {barFull ? (
              <Button size="sm" tone="danger" disabled={busy} onClick={discardOpen}>
                {`Discard all ${openCount}`}
              </Button>
            ) : readyCount > 0 ? (
              <Button size="sm" variant="primary" disabled={busy} onClick={addReady}>
                {readyCount > 1 ? `Add ${readyCount} ready` : "Add the ready one"}
              </Button>
            ) : null}
          </div>
          {barFull && (
          <div className="fms-batchgroups">
          {groups.map((g) => {
            const places = g.cards.map((i) => placeOf.get(i) ?? 0);
            const many = g.cards.length > 1;
            const action =
              g.key === "ready"
                ? { label: many ? `Add these ${g.cards.length}` : "Add it", press: addReady, primary: true }
                : g.key === "ledger" || g.key === "repeat"
                  ? { label: many ? `Skip these ${g.cards.length}` : "Skip it", press: () => skipCards(g.cards), primary: false }
                  : { label: `Go to card ${places[0]}`, press: () => jumpTo(g.cards[0]!), primary: false };
            return (
              <div key={g.key} className="fms-batchset">
                <div className="fms-batchgroup">
                  <button type="button" className="fms-batchgroup-what" onClick={() => jumpTo(g.cards[0]!)} title="Show the first of these">
                    <span className="t-caption fms-batchgroup-label">{STANDING_WORDS[g.key]}</span>
                    <span className="t-micro fms-batchgroup-cards">{cardsWord(places)}</span>
                  </button>
                  <Button size="sm" {...(action.primary ? { variant: "primary" as const } : {})} disabled={busy} onClick={action.press}>
                    {action.label}
                  </Button>
                </div>
                {/*
                  On a computer, each card in the group as a row: its number,
                  day, words, kind and amount, and for a copy the row it
                  repeats. A row shows its card.
                */}
                {wide && (
                  <ul className="fms-batchrows">
                    {g.cards.map((i) => {
                      const t = turns[i] as Offered;
                      const d = t.live ?? t.proposal.draft;
                      const match = alreadyInLedger.get(i)?.[0];
                      const kind = d.flow || "Spending";
                      const tone = kind === "Revenue" ? "revenue" : kind === "Transfer" ? "transfer" : kind === "Debt" ? "debt" : "spending";
                      return (
                        <li key={i}>
                          <button type="button" className="fms-batchrow" onClick={() => jumpTo(i)}>
                            <span className="t-micro fms-batchrow-n">{placeOf.get(i)}</span>
                            <span className="t-micro fms-batchrow-date">{shortDay(d.date)}</span>
                            <span className="t-caption fms-batchrow-what">
                              {d.description || d.item || kind}
                              {match && <span className="fms-batchrow-match"> = #{String(match.row.recordNumber).padStart(4, "0")}</span>}
                            </span>
                            <span className={`fms-proposalkind fms-proposalkind--${tone} fms-batchrow-kind`}>{d.behalf ? "On behalf" : kind}</span>
                            {d.amount === null ? (
                              <span className="t-caption" style={{ color: "var(--over)" }}>
                                No amount
                              </span>
                            ) : (
                              <Money value={d.amount} size="s" className="fms-batchrow-money" />
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
          </div>
          )}
        </div>
      )}

      <div className="fms-thread" ref={threadRef} onScroll={noteScroll}>
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

        {turns.map((raw, i) => {
          const turn = current(raw);
          return isChanging(turn) ? (
            <ChangeCard
              key={i}
              turn={turn}
              onApply={() => {
                sink.update(turn.plan.rows.map((r) => r.after), { actor: "ai", via: "ai_chat" });
                const done = `Changed ${turn.plan.rows
                  .map((r) => `#${String(r.before.recordNumber).padStart(4, "0")} ${changeWords(r)}`)
                  .join("; ")}.`;
                log(aiEvent("accepted", "add", { entry: done }));
                decide(i, "applied");
                say({ kind: "assistant", text: done, from: "this device" });
              }}
              onDiscard={() => decide(i, "discarded")}
              onOpen={(row) => sink.use(transactionToDraft(row))}
            />
          ) : isBudgeting(turn) ? (
            <BudgetCard
              key={i}
              turn={turn}
              onApply={() => {
                sink.budget(turn.plan.year, turn.plan.outcome.plan, turn.plan.changes);
                log(aiEvent("accepted", "add", { entry: turn.plan.words }));
                decide(i, "applied");
                say({ kind: "assistant", text: `Budget set: ${budgetBlocks(turn.plan).map((b) => b.label).join(", ") || turn.plan.words}. The Budget screen shows it now.`, from: "this device" });
              }}
              onDiscard={() => decide(i, "discarded")}
              onEdit={
                turn.ask
                  ? (figures) => {
                      const ask = editedAsk(turn.ask!, figures);
                      const plan = planBudget(ask, budgets, asOf, new Date().toISOString());
                      if (plan.outcome.refused) return plan.outcome.refused;
                      if (plan.outcome.written.length === 0) return "The budget already reads that way, so there is nothing to apply. Give other figures, or discard the card.";
                      const { note: _was, ...rest } = turn;
                      const changed: Budgeting = { ...rest, plan, ask, edited: true, note: "Your figures, changed on the card." };
                      setTurns((prev) => prev.map((t, j) => (j === i ? changed : t)));
                      recordCard(changed);
                      log(aiEvent("edited", "add", { field: "budget", entry: plan.words }));
                      return null;
                    }
                  : undefined
              }
            />
          ) : isExporting(turn) ? (
            <ExportCard
              key={i}
              turn={turn}
              onSave={() => {
                sink.exportFile(turn.ask);
                log(aiEvent("accepted", "statements", { entry: turn.ask.said }));
                decide(i, "applied");
              }}
              onDiscard={() => decide(i, "discarded")}
            />
          ) : isDebt(turn) ? (
            <DebtCard
              key={i}
              turn={turn}
              debts={debts}
              wallets={[...reference.wallets, ...reference.savings]}
              reference={reference}
              transactions={transactions}
              sink={sink}
              hostRef={(el) => keepCard(i, el)}
              onSettle={(final) => {
                hold(i);
                // Recorded here, outside the updater, because an updater must
                // be pure and React may run it more than once.
                recordCard({ ...turn, draft: final ?? turn.draft, state: "settled" });
                setTurns((prev) =>
                  prev.map((t, j) =>
                    j === i && isDebt(t) ? { ...t, draft: final ?? t.draft, state: "settled" } : t,
                  ),
                );
              }}
              onChange={(draft) =>
                setTurns((prev) => prev.map((t, j) => (j === i && isDebt(t) ? { ...t, draft } : t)))
              }
              onNewPerson={(name) =>
                setTurns((prev) =>
                  prev.map((t, j) => (j === i && isDebt(t) ? { ...t, newPerson: name.trim() ? name : undefined } : t)),
                )
              }
            />
          ) : isChart(turn) ? (
            <ChartView key={i} chart={turn.chart} />
          ) : isFound(turn) ? (
            <FoundList
              key={i}
              found={turn}
              onAct={(id, how) => {
                if (how === "bin") {
                  binnedHere.current = [id, ...binnedHere.current];
                  sink.bin(id);
                } else if (turn.action === "edit") {
                  const row = transactions.find((t) => t.id === id);
                  if (row) sink.use(transactionToDraft(row));
                } else if (turn.action === "bin") {
                  binnedHere.current = [id, ...binnedHere.current];
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
                binnedHere.current = [...ids, ...binnedHere.current];
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
              wide={wide}
              place={
                openCount > 1 && standing.has(i)
                  ? { at: placeOf.get(i) ?? 0, of: openCount, standing: standing.get(i)!, twin: placeOf.get(repeatTwinAt.get(i) ?? -1) }
                  : undefined
              }
              recordNumber={
                turn.recordNumber ?? predictedNumber.get(i) ?? sink.nextRecordNumber
              }
              onChange={(draft) => replaceProposal(i, { ...turn.proposal, draft })}
              onChangeAll={
                turns.some((t, j) => j !== i && isOffer(t) && t.state === "open") ? (draft) => applyToAll(draft) : undefined
              }
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
                // What is on the card, which is what the form holds if it is
                // following it. Adding the original here would save something
                // other than the figures being looked at.
                learnFrom(turn, turn.live ?? turn.proposal.draft);
                const given = sink.add(turn.live ?? turn.proposal.draft, {
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
          );
        })}

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
              {stage || (attached ? "Reading the picture" : intent === "log" ? "Reading" : "Thinking")}
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
      {previewing?.dataUrl &&
        /*
         * On the page itself, not inside the chat. Drawn inside it, "fixed"
         * was measured from the chat panel rather than the screen, and on a
         * phone the picture ran off the right edge with its caption over the
         * composer (26 September 2026). A bar with the name and the way out,
         * then a frame the picture is fitted inside, whatever its shape.
         */
        createPortal(
          <div
            className="fms-lightbox"
            role="dialog"
            aria-modal="true"
            aria-label={previewing.name}
            onClick={() => setPreviewing(null)}
          >
            <div className="fms-lightboxbar" onClick={(e) => e.stopPropagation()}>
              <p className="fms-lightboxname">
                <span className="t-body-strong">{previewing.name}</span>
                <span className="t-micro">{formatBytes(previewing.bytes)}. This picture is not saved anywhere.</span>
              </p>
              <button
                type="button"
                className="fms-lightboxclose"
                aria-label="Close"
                onClick={() => setPreviewing(null)}
              >
                <Icon name="close" size={22} />
              </button>
            </div>
            <div className="fms-lightboxframe">
              <img src={previewing.dataUrl} alt={previewing.name} onClick={(e) => e.stopPropagation()} />
            </div>
          </div>,
          document.body,
        )}

      {/*
        * The question about a card, where the thumb and the eye already are.
        * Twenty four cards push the question itself far down the thread; the
        * card it is about is scrolled into view above, and the question stays
        * here with the two answers that need no typing.
        */}
      {asking && !pending && (
        <div className="fms-askq" role="status" aria-live="polite">
          <div className="fms-askq-head">
            <span className="t-label" style={{ color: "var(--ink-2)" }}>
              {asking.count ? `Question ${asking.count}` : "One question"}
              {askedPlace ? `, about card ${askedPlace}` : ""}
            </span>
            <span className="fms-askq-skip">
              <button type="button" className="t-caption fms-linkbtn" disabled={busy} onClick={() => void send("skip")}>
                Skip
              </button>
              <button type="button" className="t-caption fms-linkbtn" disabled={busy} onClick={() => void send("stop")}>
                Stop asking
              </button>
            </span>
          </div>
          <p className="t-body-strong fms-askq-text">{asking.text}</p>
          {asking.choices.length > 0 && (
            <div className="fms-askq-choices" role="group" aria-label="Answers">
              {asking.choices.map((choice) => (
                <button key={choice} type="button" className="fms-choice t-body" disabled={busy} onClick={() => void send(choice)}>
                  {choice}
                </button>
              ))}
            </div>
          )}
          {/* The box under it already says "Your answer, or skip"; a phone has no room to say it twice. */}
          <span className="t-caption fms-askq-hint" style={{ color: "var(--ink-3)" }}>
            Or type the answer below.
          </span>
        </div>
      )}

      {pending && pendingOptions.length > 0 && (
        <div className="fms-askq-choices fms-pending-choices" role="group" aria-label="Answers">
          {pendingOptions.map((choice) => (
            <button key={choice} type="button" className="fms-choice t-body" disabled={busy} onClick={() => void send(choice)}>
              {choice}
            </button>
          ))}
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
        /*
         * Pressing Send or Stop keeps the focus in the field.
         *
         * On a phone the navigation hides while a field has focus, and the
         * keyboard takes the bottom of the screen. Pressing Send moved the
         * focus to the button first: the field lost it, the navigation came
         * back, the keyboard went down, the page jumped, and the tap landed
         * where the button had been. "I cannot click the send button in ai
         * when I am using keyboard", 26 September 2026. Kept in the field,
         * nothing moves, the tap lands, and the keyboard stays up for the
         * next message, as in any chat.
         */
        onMouseDown={(e) => {
          // Every button sits inside the box now: none of them takes the focus from the words.
          if ((e.target as HTMLElement).closest("button")) e.preventDefault();
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
        {/*
          The camera, on a phone only.

          "in phone only add access to camera like direct to take picture in
          ai" (owner, 26 September 2026). `capture` opens the camera itself
          rather than the file picker, so a receipt is one tap and one shot
          from being read. A computer has no camera worth pointing at a
          receipt, so the button is not drawn there (layout.css).
        */}
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(e) => {
            void attach(e.target.files);
            e.target.value = "";
          }}
        />
        {/*
          One field on a phone, the way a phone's chat apps draw it: the text,
          then attach and the camera inside the same rounded box, and Send
          beside it. Three separate round buttons left the text so narrow that
          "Ask, or type an entry" wrapped onto two lines and the composer read
          as zoomed in (owner, 26 September 2026). On a computer the box is
          not drawn and the pieces sit in a row as before (layout.css).
        */}
        {/*
          One rounded box, the way the phone's own chat apps draw one: the
          words across the whole width on top, so "Ask, or type an entry"
          fits on one line, and under them attach, the camera and Send. The
          owner, 4 October 2026, beside the Claude app: "Fix the chat area
          ui ... I dont want that paste icon thats just clutter". A copied
          screenshot is pasted from the keyboard's own Paste, which the box
          is built to take (`PlainBox`).
        */}
        <div className="fms-askfield">
          {/*
            Several entries fit in one message. Enter sends and Shift plus
            Enter starts a line, which is what every chat does. It grows to a
            few lines and then scrolls, so a long paste cannot push the
            composer over the conversation.
          */}
          <PlainBox
            className="t-caption fms-askinput"
            value={draft}
            onChange={setDraft}
            onEnter={() => void send()}
            placeholder={
              asking && !pending
                ? "Your answer, or skip"
                : pending
                ? pending.blank === "amount"
                  ? "How much?"
                  : "Your answer"
                : attached
                  ? "Add a note"
                  : "Ask, or type an entry"
            }
            label={attached ? "A note about the attached files" : "Ask a question, or type an entry"}
            disabled={busy}
          />
          <div className="fms-asktools">
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
            <button
              type="button"
              className="fms-attach fms-askcamera"
              aria-label="Take a photo"
              title="Take a photo"
              disabled={busy || files.length >= limits.maxCount}
              onClick={() => cameraRef.current?.click()}
            >
              <Icon name="camera" size={22} />
            </button>
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
          </div>
        </div>
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
            /*
             * What is still open is thrown away first, in the record. The
             * mark is per device, so a card left open behind it came back on
             * the phone after being cleared on the laptop, and after a
             * refresh wherever the mark was lost (26 September 2026).
             */
            discardEveryOpen("Clear this view");
            forgetConversation();
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
/**
 * A blank the card already names in its "Still needs" line, said again in
 * red underneath: "Still needs one thing: the wallet it went to" and then
 * "Pick the wallet the money lands in." (owner, 27 September 2026: "fix the
 * ui its ugly"). The line says it once, and the question above the box asks.
 */
const RESTATES_BLANK: ReadonlySet<string> = new Set([
  "Pick the wallet the money lands in.",
  "Pick the wallet the money leaves.",
  "Pick a date.",
]);

/** One labelled field on a card, on a computer's screen. `money` renders as money (rule D4). */
interface Detail {
  readonly label: string;
  readonly value: string;
  readonly money?: number;
  readonly missing?: boolean;
  readonly full?: boolean;
}

/** Where an open card stands: what the batch bar groups it under, in the same words on the card. */
type Standing = "ready" | "question" | "check" | "ledger" | "repeat";
const STANDING_ORDER: readonly Standing[] = ["ready", "question", "check", "ledger", "repeat"];
const STANDING_WORDS: Readonly<Record<Standing, string>> = {
  ready: "Ready to add",
  question: "Needs your answer",
  check: "Needs a fix on the card",
  ledger: "Already in your ledger",
  repeat: "Same as a card above",
};

/** The same, in a few words, for the folded bar on a phone: "1 ready · 4 already in". */
const STANDING_SHORT: Readonly<Record<Standing, string>> = {
  ready: "ready",
  question: "to answer",
  check: "to fix",
  ledger: "already in",
  repeat: "repeated",
};

/** "Sep 26": the day of a row in the batch bar's list, where the year is the same for all of them. */
function shortDay(date: string): string {
  const month = Number(date.slice(5, 7));
  return `${(MONTH_NAMES[month - 1] ?? "").slice(0, 3)} ${Number(date.slice(8, 10))}`;
}

/** "card 4", "cards 1 and 2", "cards 3, 5, 6 and 7", and past six "cards 1, 2, 3, 4, 5 and 9 more". */
function cardsWord(places: readonly number[]): string {
  if (places.length === 1) return `card ${places[0]}`;
  if (places.length > 6) return `cards ${places.slice(0, 5).join(", ")} and ${places.length - 5} more`;
  return `cards ${places.slice(0, -1).join(", ")} and ${places[places.length - 1]}`;
}

function ProposalCard({
  offered,
  sink,
  reference,
  hostRef,
  alreadyInLedger,
  repeatOfCard,
  place,
  wide = false,
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
  /** Its number among the open cards, and where it stands, in the batch bar's words. Absent for a card on its own. */
  place?: { readonly at: number; readonly of: number; readonly standing: Standing; readonly twin?: number | undefined } | undefined;
  /** A computer's screen: every field labelled, and a copy set beside the row it repeats. */
  wide?: boolean;
  onChange: (draft: Draft) => void;
  /** Absent when this is the only open card, so there is nothing to apply it to. */
  onChangeAll?: ((draft: Draft) => void) | undefined;
  onAdd: () => void;
  onUse: () => void;
  onDiscard: () => void;
}) {
  const { proposal, state } = offered;
  /**
   * What is on the card: the form while it is following it, and otherwise
   * what was read. Everything below reads this one binding, so the fields,
   * the checks, the duplicate warning and the figure on the button cannot
   * disagree with each other.
   */
  const draft = offered.live ?? proposal.draft;
  /** The form has been changed since this was read, so there is an undo to offer. */
  const changedInForm =
    offered.live !== undefined &&
    JSON.stringify(offered.live) !== JSON.stringify(proposal.draft);
  const check = sink.check(draft);

  /**
   * Extra zeros take a second tap.
   *
   * The Add form asks before saving an amount far larger than anything of its
   * kind. A card saved it on the first tap with the warning printed above it,
   * which is all it took for PHP 1,000,000.00 to land in the income line. The
   * first tap now only says the figure was read; the second adds it.
   */
  const [sure, setSure] = useState(false);
  /** A card already in the ledger shows as one line until the owner asks to see all of it. */
  const [unfolded, setUnfolded] = useState(false);
  const cardTotal = (draft.amount ?? 0) + draft.fee;
  const askFirst = check.unusual !== undefined && !sure;
  const addLabel = askFirst
    ? `Check ${formatMoney(cardTotal)} first`
    : check.unusual !== undefined
      ? `Yes, add ${formatMoney(cardTotal)}`
      : "Add to ledger";
  const pressAdd = (): void => {
    if (askFirst) setSure(true);
    else onAdd();
  };
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
    // What it was, not only that it went (domain/discarded.ts).
    const gone = discardedWords(draft);
    return (
      <div ref={hostRef} className="fms-turn fms-discarded">
        <span className="t-caption">
          <span className="t-body-strong">Discarded, not added:</span> {gone.what}
        </span>
        {gone.detail && <span className="t-micro">{gone.detail}</span>}
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
  // Empty, or a kind on none of their lists (a card kept from before 3 October 2026): picked from theirs.
  const needsItem = itemChoices.length > 0 && (draft.item.trim() === "" || !itemOnList(draft, reference));

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
  /*
   * How sure the reading is, in words that fit where it came from. "Hard to
   * read" was printed on a card for the typed words "6 peosos unknown
   * spending" (owner, 28 September 2026: "whats the 'Hard to read' in
   * there??"). A picture can be hard to read; a sentence can only leave the
   * reading unsure. Nothing is said when it is sure.
   */
  const fromPicture = readOffPicture(proposal);
  const confidence =
    proposal.confidence === "high"
      ? "clear"
      : proposal.confidence === "medium"
        ? fromPicture ? "mostly clear in the picture" : "fairly sure"
        : fromPicture ? "hard to make out in the picture" : "unsure, check it";

  /** The summary's words: which kind, what it was, and the facts worth a glance. */
  const flowTone = flow === "Revenue" ? "revenue" : flow === "Transfer" ? "transfer" : flow === "Debt" ? "debt" : "spending";
  const kindWord = draft.behalf ? "On behalf" : flow;
  const listed = draft.category === "Bills" || draft.category === "Subscriptions" ? `${draft.category === "Bills" ? "Bill" : "Subscription"}: ` : "";
  const what =
    flow === "Transfer"
      ? `${draft.fromWallet || "?"} to ${moneySend ? "someone else" : draft.toWallet || "?"}`
      : flow === "Debt"
        ? draft.item || "Debt"
        : draft.item.trim()
          ? `${listed}${draft.item}`
          : flow === "Revenue"
            ? "What was it?"
            : "What was it for?";
  const whatMissing = (flow === "Spending" || flow === "Revenue") && !draft.item.trim();
  const walletShown = flow === "Revenue" ? draft.toWallet : flow === "Transfer" ? "" : draft.fromWallet;
  const meta = [
    flow === "Transfer" ? "" : walletShown ? `${flow === "Revenue" ? "Into" : "From"} ${walletShown}` : "No wallet yet",
    formatMedium(draft.date),
    draft.fee > 0 ? `${formatMoney(draft.fee)} fee` : "",
    state === "added" ? `Added as #${String(recordNumber).padStart(4, "0")}` : state === "used" ? "In the form" : "",
    !settled && confidence !== "clear" ? confidence : "",
  ].filter(Boolean);
  /** The wallet read is in doubt: a statement's own account, or a name that is not one of yours. */
  const walletDoubt = proposal.adjustments.some((a) => /reads as|not one of your accounts|which wallet|statement/i.test(a));

  /**
   * Every field worth reading, labelled, for a screen with room for them.
   * The phone shows the same facts as one line under the headline.
   */
  const pad = (n: number): string => `#${String(n).padStart(4, "0")}`;
  const details: readonly Detail[] = [
    { label: "Date", value: formatMedium(draft.date) },
    { label: "Status", value: draft.status || "Not set" },
    ...(flow === "Transfer"
      ? [
          { label: "From", value: draft.fromWallet || "Not picked", missing: !draft.fromWallet },
          { label: "To", value: moneySend ? "Someone else" : draft.toWallet || "Not picked", missing: !moneySend && !draft.toWallet },
        ]
      : flow === "Debt"
        ? [
            { label: draft.behalf ? "For" : "Line", value: draft.item || "Not picked", missing: !draft.item && !draft.debtId },
            { label: "Movement", value: draft.debtEffect ? effectLabel(draft.debtEffect) : "Not said", missing: !draft.debtEffect },
            ...(draft.fromWallet ? [{ label: "From", value: draft.fromWallet }] : []),
            ...(draft.toWallet ? [{ label: "Into", value: draft.toWallet }] : []),
          ]
        : [
            { label: flow === "Revenue" ? "Into" : "From", value: walletShown || "Not picked", missing: !walletShown },
            { label: "Category", value: draft.category || flow },
            { label: "Item", value: draft.item.trim() || "Not picked", missing: !draft.item.trim() },
          ]),
    { label: "Fee", value: "", money: draft.fee },
    ...(draft.fee > 0 && draft.amount !== null ? [{ label: "Total", value: "", money: draft.amount + draft.fee }] : []),
    { label: state === "added" ? "Added as" : "Saves as", value: state === "used" ? "In the form" : pad(recordNumber) },
    ...(!settled && confidence !== "clear" ? [{ label: "Check", value: confidence }] : []),
    ...(draft.description.trim() ? [{ label: "Description", value: draft.description, full: true }] : []),
    ...(draft.notes ? [{ label: "Notes", value: draft.notes, full: true }] : []),
  ];
  const detailGrid = (
    <dl className="fms-pdetails">
      {details.map((d) => (
        <div key={d.label} className={d.full ? "fms-pdetail fms-pdetail--full" : "fms-pdetail"}>
          <dt className="t-micro">{d.label}</dt>
          <dd className="t-caption" style={d.missing ? { color: "var(--over)" } : undefined}>
            {d.money !== undefined ? <Money value={d.money} size="s" /> : d.value}
          </dd>
        </div>
      ))}
    </dl>
  );

  /** Its number and standing, in the batch bar's words, so "cards 3, 5 and 6" in the bar is these cards. */
  const placeLine = place ? (
    <p className="t-micro fms-cardplace">
      <span className="t-body-strong">
        Card {place.at} of {place.of}
      </span>
      {" · "}
      {place.standing === "repeat" && place.twin ? `Same as card ${place.twin}` : STANDING_WORDS[place.standing]}
    </p>
  ) : null;

  const summaryTop = (
    <div className="fms-proposalsum-top">
      <span className={`fms-proposalkind fms-proposalkind--${flowTone}`}>{kindWord}</span>
      <span className="t-body-strong fms-proposalsum-what" style={whatMissing ? { color: "var(--over)" } : undefined}>
        {what}
      </span>
      {draft.amount === null ? (
        <span className="t-body-strong" style={{ color: "var(--over)" }}>
          No amount
        </span>
      ) : (
        <span className="t-body-strong fms-proposalmoney">{formatMoney(draft.amount)}</span>
      )}
    </div>
  );

  /*
   * Already got this one: one line, not a new entry.
   *
   * The owner, 27 September 2026, of a Maya history where four of seven rows
   * were already saved: "it cant recognized the data that allready added. it
   * just give me the entry". Each of those was a full card with a warning at
   * the bottom, the same as a new one. Now it says which row it is, first,
   * and the card behind it is one tap away. Nothing is decided for the
   * owner: "Add anyway" is right there for the second coffee of the day.
   */
  const copyOf = alreadyInLedger[0];
  if (!settled && !unfolded && (copyOf || repeatOfCard)) {
    const number = (n: number): string => `#${String(n).padStart(4, "0")}`;
    const where = (from: string, to: string): string => (from && to ? `${from} to ${to}` : to ? `into ${to}` : from ? `out of ${from}` : "");
    const line = copyOf
      ? `${copyOf.certainty === "same" ? "Saved as" : "Looks like"} ${number(copyOf.row.recordNumber)}, ${formatMedium(copyOf.row.date)}: ${[
          copyOf.row.item || copyOf.row.type,
          copyOf.row.description.trim().toLowerCase() === (copyOf.row.item || copyOf.row.type).toLowerCase() ? "" : copyOf.row.description,
          where(copyOf.row.fromWallet, copyOf.row.toWallet),
        ]
          .filter(Boolean)
          .join(", ")}.${alreadyInLedger.length > 1 ? ` Also like ${alreadyInLedger.slice(1).map((d) => number(d.row.recordNumber)).join(" and ")}.` : ""}`
      : `A card above already says this${place?.twin ? ` (card ${place.twin})` : ""}: the same day, amount and kind.`;
    const otherKind = copyOf && copyOf.row.type !== flow;
    /*
     * On a computer, this card and the row it repeats side by side, field by
     * field, with what differs marked: which of them is right is then a
     * glance, not a sentence to unpick.
     */
    const theirs = copyOf
      ? { title: `${number(copyOf.row.recordNumber)} in your ledger`, date: copyOf.row.date, kind: copyOf.row.type, item: copyOf.row.item, from: copyOf.row.fromWallet, to: copyOf.row.toWallet, amount: copyOf.row.amount, fee: copyOf.row.fee, description: copyOf.row.description }
      : repeatOfCard
        ? { title: place?.twin ? `Card ${place.twin}` : "The card above", date: repeatOfCard.date, kind: repeatOfCard.flow || "Spending", item: repeatOfCard.item, from: repeatOfCard.fromWallet, to: repeatOfCard.toWallet, amount: repeatOfCard.amount ?? 0, fee: repeatOfCard.fee, description: repeatOfCard.description }
        : null;
    const kindOfRow = (kind: string, item: string): string => (item ? `${kind}, ${item}` : kind);
    const compare = theirs
      ? [
          { label: "Date", mine: formatMedium(draft.date), other: formatMedium(theirs.date) },
          { label: "Kind", mine: kindOfRow(flow, draft.item), other: kindOfRow(theirs.kind, theirs.item) },
          { label: "Wallet", mine: where(draft.fromWallet, moneySend ? "someone else" : draft.toWallet) || "Not picked", other: where(theirs.from, theirs.to) || "None" },
          { label: "Amount", mine: formatMoney(draft.amount ?? 0), other: formatMoney(theirs.amount), money: [draft.amount ?? 0, theirs.amount] as const },
          { label: "Fee", mine: formatMoney(draft.fee), other: formatMoney(theirs.fee), money: [draft.fee, theirs.fee] as const },
          { label: "Description", mine: draft.description || "None", other: theirs.description || "None" },
        ]
      : [];
    const differing = compare.filter((r) => r.mine.toLowerCase() !== r.other.toLowerCase());
    const splitMatch = Boolean(copyOf?.also?.length);
    return (
      <div ref={hostRef} tabIndex={-1} className="fms-proposal fms-proposal--copy">
        {placeLine ?? <p className="t-micro fms-cardplace">{copyOf ? "Already in your ledger" : "Same as a card above"}</p>}
        <div className="fms-proposalsum">
          {summaryTop}
          {!wide && <p className="t-caption fms-proposalsum-meta">{[formatMedium(draft.date), draft.description].filter(Boolean).join(" · ")}</p>}
        </div>
        {/*
          Only what differs. With every field side by side, a receipt sent
          twice showed "Reed diffuser" beside "reed diffuser" and read as the
          description written twice (28 September 2026). When nothing
          differs, one line says so; a line matched by two rows names both.
        */}
        {wide && theirs && !splitMatch && differing.length > 0 ? (
          <table className="fms-cmp">
            <thead>
              <tr>
                <th scope="col" className="t-micro">
                  <span className="sr-only">Field</span>
                </th>
                <th scope="col" className="t-micro">
                  This card
                </th>
                <th scope="col" className="t-micro">
                  {theirs.title}
                </th>
              </tr>
            </thead>
            <tbody>
              {differing.map((r) => {
                return (
                  <tr key={r.label} className="fms-cmp-diff">
                    <th scope="row" className="t-micro">
                      {r.label}
                      <span className="fms-cmp-flag">differs</span>
                    </th>
                    <td className="t-caption">{r.money ? <Money value={r.money[0]} size="s" /> : r.mine}</td>
                    <td className="t-caption">{r.money ? <Money value={r.money[1]} size="s" /> : r.other}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="t-caption fms-copyline">
            {splitMatch && copyOf
              ? `${duplicateHeadline(copyOf)} ${copyOf.evidence[0] ?? ""}`
              : theirs && differing.length === 0
                ? `${line} Everything on this card matches it.`
                : line}
          </p>
        )}
        {wide && theirs && !splitMatch && differing.length > 0 && differing.length < compare.length && (
          <p className="t-micro fms-proposalnote">The {compare.length - differing.length === 1 ? "other field matches" : `other ${compare.length - differing.length} fields match`}.</p>
        )}
        {otherKind && !splitMatch && (
          <p className="t-micro fms-proposalnote">
            It is filed there as {copyOf.row.type}
            {copyOf.row.item ? `, ${copyOf.row.item}` : ""}, and this reads as {flow}. If the kind there is wrong, open {number(copyOf.row.recordNumber)} in the Database and fix it there.
          </p>
        )}
        <div className="fms-proposalactions">
          <Button size="sm" onClick={onDiscard}>
            Skip it
          </Button>
          <Button size="sm" disabled={!check.ok} onClick={pressAdd}>
            {check.ok ? "Add anyway" : "Add anyway (fix it first)"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setUnfolded(true)}>
            Show the card
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div ref={hostRef} tabIndex={-1} className={settled ? "fms-proposal fms-proposal--settled" : "fms-proposal"}>
      {!settled && placeLine}
      {/*
        What it is, in three lines: the kind, what it was and the amount;
        the description; the wallet, the day and anything unusual.

        It was ten labelled fields in a grid (record number, type, date, from
        wallet, category, item, amount, fee, description, status), a phone
        screen for one entry, and the owner said it was too crowded to read
        on a phone (27 September 2026). The names are the form's and the
        database's; only the ones that say something are shown.
      */}
      <div className="fms-proposalsum">
        {summaryTop}
        {wide ? (
          detailGrid
        ) : (
          <>
            {draft.description.trim() && <p className="t-caption fms-proposalsum-desc">{draft.description}</p>}
            <p className="t-caption fms-proposalsum-meta">{meta.join(" · ")}</p>
            {draft.notes && <p className="t-caption fms-proposalsum-desc">{draft.notes}</p>}
          </>
        )}
      </div>

      {!settled && flow !== "Transfer" && (walletDoubt || !draft[walletField]) && (
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
          {draft[walletField] && onChangeAll && (
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
            value={itemChoices.includes(draft.item) ? draft.item : ""}
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

      {/*
        Only while it is open. A saved card is checked against a ledger that
        now holds its own row, so "This puts Maya at ... Save anyway?" read
        as saving it a second time (4 October 2026, the phone scenario).
      */}
      {!settled && check.problems.filter((p) => !RESTATES_BLANK.has(p)).map((p) => (
        <p key={p} className="t-micro fms-proposalnote fms-proposalnote--stop">
          {p}
        </p>
      ))}
      {!settled && check.warnings.map((w) => (
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
          {/*
            Three identical rows are one warning, not three.

            The reasons are printed once per group rather than once per row:
            when the matched rows are identical, so are their reasons, and
            the card was repeating five lines three times over. See
            `groupDuplicates`.
          */}
          {groupDuplicates(alreadyInLedger).map((group) => (
            <div key={group.rows.map((d) => d.row.id).join()}>
              <p className="t-micro fms-dupehead">{group.headline}</p>
              <p className="t-micro fms-dupeline">
                {group.rows[0]!.row.date} {group.rows[0]!.row.item || group.rows[0]!.row.type}
                {group.rows[0]!.row.description ? `, ${group.rows[0]!.row.description}` : ""}
              </p>
              <ul className="fms-dupewhy">
                {group.evidence.map((line) => (
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
              : changedInForm
                ? "Following the form beside this, which no longer matches what I read. Put the original back to undo what changed there."
                : "Following the form beside this: whatever you change there shows here. Check it and press Save transaction."}
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
                {changedInForm ? "Put the original back" : "Put back in the form"}
              </Button>
              <Button size="sm" variant="primary" disabled={!check.ok} onClick={pressAdd}>
                {addLabel}
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
            <Button size="sm" variant="primary" disabled={!check.ok} onClick={pressAdd}>
              {addLabel}
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
/** Saved entries about to change, each shown before and after. */
function ChangeCard({
  turn,
  onApply,
  onDiscard,
  onOpen,
}: {
  turn: Changing;
  onApply: () => void;
  onDiscard: () => void;
  onOpen: (row: Transaction) => void;
}) {
  const { plan, state } = turn;
  const number = (t: Transaction): string => `#${String(t.recordNumber).padStart(4, "0")}`;
  return (
    <div className="fms-proposal">
      <div className="fms-proposalhead">
        <span className="t-label" style={{ color: "var(--ink-2)" }}>
          {plan.rows.length === 1 ? "Change one entry" : `Change ${plan.rows.length} entries`}
        </span>
        <span className="t-micro" style={{ color: "var(--ink-3)" }}>
          {state === "applied" ? "changed" : state === "discarded" ? "left as it was" : "nothing is changed yet"}
        </span>
      </div>
      <ul className="fms-changelist">
        {plan.rows.map((r) => (
          <li key={r.before.id} className="fms-changerow">
            <span className="t-body-strong">
              {number(r.before)} {r.before.item || r.before.description || r.before.type}
            </span>
            <span className="t-caption" style={{ color: "var(--ink-2)" }}>
              {changeWords(r)}
            </span>
            {state === "open" && plan.rows.length === 1 && (
              <button type="button" className="t-micro fms-linkish" onClick={() => onOpen(r.after)}>
                Open in the form instead
              </button>
            )}
          </li>
        ))}
        {plan.refused.map((r) => (
          <li key={`x${r.row.id}`} className="fms-changerow">
            <span className="t-body" style={{ color: "var(--ink-2)" }}>
              {number(r.row)} {r.row.item || r.row.description || r.row.type}
            </span>
            <span className="t-caption" style={{ color: "var(--warn)" }}>
              {r.reason}
            </span>
          </li>
        ))}
      </ul>
      {state === "open" && (
        <div className="fms-proposalactions">
          <Button size="sm" variant="primary" onClick={onApply}>
            {plan.rows.length === 1 ? "Apply the change" : `Apply ${plan.rows.length} changes`}
          </Button>
          <Button size="sm" onClick={onDiscard}>
            Discard
          </Button>
        </div>
      )}
      <p className="t-micro fms-proposalfrom">
        A change keeps each entry's record number and goes in the activity trail. Undo is on the notice that appears when it is applied.
      </p>
    </div>
  );
}

/** A budget about to change. */
/**
 * A file, offered rather than written.
 *
 * The same shape as every other card here: it says what the file will be and
 * waits. Nothing is downloaded until the button is pressed, because a file
 * appearing in the downloads folder because of a sentence is a surprise, and
 * this one holds the owner's whole financial history.
 */
function ExportCard({ turn, onSave, onDiscard }: { turn: Exporting; onSave: () => void; onDiscard: () => void }) {
  const { ask, state } = turn;
  const what =
    ask.kind === "backup" ? "Backup file" : ask.kind === "csv" ? "Spreadsheet of everything" : "Statement";

  return (
    <div className="fms-proposal">
      <div className="fms-proposalhead">
        <span className="t-label" style={{ color: "var(--ink-2)" }}>
          {what}
        </span>
        <span className="t-micro" style={{ color: "var(--ink-3)" }}>
          {state === "applied" ? "saved to this device" : state === "discarded" ? "not saved" : "nothing is saved yet"}
        </span>
      </div>
      {ask.summary && (
        <p className="t-body" style={{ margin: 0 }}>
          {ask.summary}
        </p>
      )}
      <p className="t-caption" style={{ margin: 0, color: "var(--ink-2)" }}>
        It goes to this device's downloads and nowhere else.
      </p>
      {state === "open" && (
        <div className="fms-proposalactions">
          <Button size="sm" variant="primary" onClick={onSave}>
            Save the file
          </Button>
          <Button size="sm" onClick={onDiscard}>
            Not now
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * One block of a budget change: a month, or several changed the same way.
 *
 * The card was a sentence, "November 2026: ₱12,750.00 for spending and
 * ₱1,522.00 for bills and subscriptions, was ₱0.00 and ₱0.00", and the owner
 * said it was confusing (28 September 2026). It is a table now: each part,
 * what it is and what it becomes, the total, and the difference.
 */
interface BudgetBlock {
  readonly label: string;
  readonly rows: readonly { readonly name: string; readonly was: Centavos; readonly now: Centavos }[];
  readonly total?: { readonly was: Centavos; readonly now: Centavos };
}

function budgetBlocks(plan: BudgetPlan): BudgetBlock[] {
  const { written, revisions } = plan.outcome;
  const shown: { month: number; key: string; block: Omit<BudgetBlock, "label"> }[] = [];
  revisions.forEach((r, i) => {
    const month = written[i];
    if (month === undefined) return;
    const block: Omit<BudgetBlock, "label"> =
      r.what === "limit"
        ? { rows: [{ name: `${r.name ?? "Limit"} limit`, was: r.wasLimit ?? 0, now: r.limit ?? 0 }] }
        : {
            rows: [
              { name: "Spending", was: r.wasSpending ?? 0, now: r.spending ?? 0 },
              { name: "Bills and subscriptions", was: r.wasBillsSubs ?? 0, now: r.billsSubs ?? 0 },
            ],
            total: { was: (r.wasSpending ?? 0) + (r.wasBillsSubs ?? 0), now: (r.spending ?? 0) + (r.billsSubs ?? 0) },
          };
    shown.push({ month, key: JSON.stringify(block), block });
  });
  // Months in a row that change the same way are one block: "October to December 2026, each month".
  const blocks: BudgetBlock[] = [];
  for (let i = 0; i < shown.length; ) {
    let j = i;
    while (j + 1 < shown.length && shown[j + 1]?.key === shown[i]?.key && (shown[j + 1]?.month ?? 0) === (shown[j]?.month ?? 0) + 1) j += 1;
    const first = shown[i];
    const last = shown[j];
    if (!first || !last) break;
    const label =
      first.month === last.month
        ? `${MONTH_NAMES[first.month - 1] ?? ""} ${plan.year}`
        : `${MONTH_NAMES[first.month - 1] ?? ""} to ${MONTH_NAMES[last.month - 1] ?? ""} ${plan.year}, each month`;
    blocks.push({ label, ...first.block });
    i = j + 1;
  }
  return blocks;
}

function BudgetCard({
  turn,
  onApply,
  onDiscard,
  onEdit,
}: {
  turn: Budgeting;
  onApply: () => void;
  onDiscard: () => void;
  /** Plan the card again with these figures; the reason when it cannot be, or null. */
  onEdit?: ((figures: CardFigures) => string | null) | undefined;
}) {
  const { plan, state } = turn;
  const blocks = budgetBlocks(plan);
  const skipped = plan.outcome.skipped;

  /*
   * The figures, changed on the card before Apply (3 October 2026: "make
   * sure it's editable too"). Every month on the card takes them, and the
   * table shows the change again before anything is set.
   */
  const isLimit = turn.ask?.kind === "limit";
  const first = blocks[0];
  const nowOf = (name: string): Centavos => first?.rows.find((r) => r.name === name)?.now ?? 0;
  const [editing, setEditing] = useState(false);
  const [spending, setSpending] = useState<Centavos | null>(null);
  const [billsSubs, setBillsSubs] = useState<Centavos | null>(null);
  const [limit, setLimit] = useState<Centavos | null>(null);
  const [problem, setProblem] = useState("");
  const months = plan.outcome.written.length;

  const begin = (): void => {
    setSpending(nowOf("Spending"));
    setBillsSubs(nowOf("Bills and subscriptions"));
    setLimit(first?.rows[0]?.now ?? 0);
    setProblem("");
    setEditing(true);
  };
  const update = (): void => {
    if (!onEdit) return;
    const figures: CardFigures = isLimit ? { limit: limit ?? 0 } : { spending: spending ?? 0, billsSubs: billsSubs ?? 0 };
    const why = onEdit(figures);
    if (why) {
      setProblem(why);
      return;
    }
    setEditing(false);
  };

  return (
    <div className="fms-proposal">
      <div className="fms-proposalhead">
        <span className="t-label" style={{ color: "var(--ink-2)" }}>
          Budget change
        </span>
        <span className="t-micro" style={{ color: "var(--ink-3)" }}>
          {state === "applied" ? "set" : state === "discarded" ? "left as it was" : "nothing is changed yet"}
        </span>
      </div>
      {blocks.length === 0 ? (
        // A card stored before the table, or one with nothing to change: its words.
        <p className="t-body" style={{ margin: 0 }}>
          {plan.words}
        </p>
      ) : (
        blocks.map((b) => (
          <div key={b.label} className="fms-budgettable" role="group" aria-label={`Budget for ${b.label}`}>
            <div className="fms-budgettable-row fms-budgettable-head">
              <span className="t-body" style={{ fontWeight: 600 }}>
                {b.label}
              </span>
              <span className="t-micro">
                Now
              </span>
              <span className="t-micro">
                {state === "applied" ? "Set to" : "New"}
              </span>
            </div>
            {b.rows.map((r) => (
              <div key={r.name} className="fms-budgettable-row">
                <span className="t-caption" style={{ color: "var(--ink-2)" }}>
                  {r.name}
                </span>
                <Money value={r.was} size="s" tone="var(--ink-3)" />
                <Money value={r.now} size="s" tone={r.now === r.was ? "var(--ink-2)" : "var(--ink)"} />
              </div>
            ))}
            {b.total && (
              <div className="fms-budgettable-row fms-budgettable-total">
                <span className="t-caption" style={{ fontWeight: 600 }}>
                  Total
                </span>
                <Money value={b.total.was} size="s" tone="var(--ink-3)" />
                <Money value={b.total.now} size="s" />
              </div>
            )}
            {b.total && b.total.now !== b.total.was && (
              <p className="t-micro fms-budgettable-diff">
                {b.total.now > b.total.was ? "Up" : "Down"} <Money value={Math.abs(b.total.now - b.total.was)} size="s" tone="var(--ink-2)" />
                {b.label.endsWith("each month") ? " a month" : ""}
              </p>
            )}
          </div>
        ))
      )}
      {skipped.length > 0 && (
        <p className="t-micro fms-proposalnote fms-proposalnote--warn">
          Left as it was, already over: {skipped.map((m) => `${MONTH_NAMES[m - 1] ?? ""} ${plan.year}`).join(", ")}.
        </p>
      )}
      {plan.outcome.refused && <p className="t-micro fms-proposalnote fms-proposalnote--warn">{plan.outcome.refused}</p>}
      {turn.note && !editing && <p className="t-micro fms-proposalnote">{turn.note}</p>}
      {state === "open" && editing && (
        <div className="fms-budgetedit" role="group" aria-label="Change the figures">
          {isLimit && turn.ask?.kind === "limit" ? (
            <FormField label={`${turn.ask.name} limit, a month`}>
              <AmountInput value={limit} onChange={setLimit} ariaLabel={`${turn.ask.name} limit`} />
            </FormField>
          ) : (
            <>
              <FormField label="Spending, a month">
                <AmountInput value={spending} onChange={setSpending} ariaLabel="Spending budget" />
              </FormField>
              <FormField label="Bills and subscriptions, a month">
                <AmountInput value={billsSubs} onChange={setBillsSubs} ariaLabel="Bills and subscriptions budget" />
              </FormField>
              <p className="t-micro fms-budgetedit-total">
                Total <Money value={(spending ?? 0) + (billsSubs ?? 0)} size="s" />
                {months > 1 ? ", on every month on this card" : ""}
              </p>
            </>
          )}
          {problem && <p className="t-micro fms-proposalnote fms-proposalnote--stop">{problem}</p>}
          <div className="fms-proposalactions">
            <Button size="sm" variant="primary" onClick={update}>
              Update the card
            </Button>
            <Button size="sm" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {state === "open" && !editing && (
        <div className="fms-proposalactions">
          <Button size="sm" variant="primary" onClick={onApply}>
            Apply
          </Button>
          {onEdit && blocks.length > 0 && (
            <Button size="sm" onClick={begin}>
              Change the figures
            </Button>
          )}
          <Button size="sm" onClick={onDiscard}>
            Discard
          </Button>
        </div>
      )}
    </div>
  );
}

function FoundList({
  found,
  onAct,
  onActAll,
}: {
  found: Found;
  onAct: (id: string, how?: "bin") => void;
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
            {/* A check's own sentence is shown as it is; a matched word gets "Matched on". */}
            <p className="t-micro fms-proposalnote">
              {why.some((w) => w.includes(" ") && /[.]$/.test(w))
                ? why.join(" ")
                : `Matched on ${why.map((w) => w.replace(/\.+$/, "")).join(", ")}.`}
            </p>
            {settled ? (
              <p className="t-micro fms-proposalfrom">
                {found.alsoBin
                  ? "Done. A corrected entry keeps its number, and a binned one can be restored from the Bin screen."
                  : action === "edit"
                  ? "Loaded into the form beside this. Change it and press Save transaction."
                  : action === "bin"
                    ? "Moved to the bin. It is restorable from the Bin screen."
                    : "Restored. It is back in the Database."}
              </p>
            ) : sweep ? null : found.alsoBin ? (
              <div className="fms-proposalactions">
                <Button size="sm" onClick={() => onAct(row.id)}>
                  {verb}
                </Button>
                <Button size="sm" variant="danger" onClick={() => onAct(row.id, "bin")}>
                  Move to bin
                </Button>
              </div>
            ) : (
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
/**
 * The category palette, by rank.
 *
 * Style guide 3.9: category colours are assigned by rank and fixed, so the
 * largest kind keeps its colour across every chart and every render. The
 * palette runs greens, then ambers, then greys, which is deliberate and is
 * why there is no red in it: red means money going out (rule D3), so a red
 * bar would read as a direction rather than as the eighth largest item.
 *
 * Length still carries the comparison. Colour only tells one row from
 * another, which is what a legend would otherwise have to do.
 */
/**
 * A chart's colour is the colour of its money (rule D3).
 *
 * Every chart was drawn in the brand green, so a chart of spending looked
 * like good news. Spending is red and income is green, the same as on every
 * other screen, and the rows step lighter from the largest so they stay
 * apart without borrowing a colour that means something else.
 */
const toneOf = (chart: Chart): string => `var(--flow-${flowOf(chart)})`;

/**
 * The flow a chart's colour comes from (rule D3). A balance is money held,
 * neither gain nor loss, so it takes the grey a transfer has; what is owed
 * is a liability, so it takes the amber debt has everywhere else.
 */
function flowOf(chart: Chart): "revenue" | "spending" | "transfer" | "debt" {
  if (chart.measure === "balance") return "transfer";
  if (chart.measure === "owed") return "debt";
  return chartDirection(chart) === "revenue" ? "revenue" : "spending";
}

/** A level is read at the end of a period; a day is read on it. */
const levelWhen = (chart: Chart, label: string): string => (chart.by === "day" ? `on ${label}` : chart.by === "wallet" ? "today" : `at the end of ${label}`);

/**
 * How strongly a row is drawn, when the chart is months.
 *
 * A month above the average is the point of that chart, so those are full
 * strength and the rest are quieter. A ranking uses colour for this instead
 * (`rampFor`), because fading a bar to a third of itself over a dark track
 * turns it grey, which is the colour of a transfer.
 */
const monthStrength = (value: number, average: number): number => (value > average ? 1 : 0.55);

/**
 * The figures for whichever part is being pointed at.
 *
 * A chart says the shape and hides the arithmetic: a bar three quarters
 * along is "about three quarters of something". This says the rest of it,
 * in one line that is always there, so the reading never depends on
 * hovering and never moves the layout when you do.
 *
 * The share is of the total, not of the largest. The bar length is already
 * of the largest, and printing that number beside it would be the same
 * fact twice while the more useful one went unsaid.
 */
function ChartRead({ chart, at }: { chart: Chart; at: number | null }) {
  const row = at === null ? undefined : chart.rows[at];

  if (!row) {
    return (
      <p className="t-micro fms-chartread fms-chartread--idle">
        Point at any part of it, or tap, for its own figures.
      </p>
    );
  }

  const share = chart.total > 0 ? Math.round((row.value / chart.total) * 100) : 0;

  if (chart.measure === "budget") {
    const budget = row.previous ?? 0;
    const gap = budget - row.value;
    return (
      <p className="t-micro fms-chartread">
        <span className="fms-chartread-label">{row.label}</span>
        <span className="fms-proposalmoney fms-chartread-money">{chartLabel(row.value)}</span>
        <span className="fms-chartread-of">
          {chart.by === "day"
            ? budget > 0
              ? `spent by then, against a steady pace of ${chartLabel(budget)}`
              : "spent by then"
            : budget > 0
              ? `of ${chartLabel(budget)}, ${gap >= 0 ? `${chartLabel(gap)} left` : `${chartLabel(-gap)} over`}`
              : "with no budget set"}
        </span>
      </p>
    );
  }

  if (chart.measure === "balance" || chart.measure === "owed") {
    return (
      <p className="t-micro fms-chartread">
        <span className="fms-chartread-label">{row.label}</span>
        <span className="fms-proposalmoney fms-chartread-money">{chartLabel(row.value)}</span>
        <span className="fms-chartread-of">
          {chart.measure === "owed" ? "owed" : "held"} {levelWhen(chart, row.label)}
          {chart.by === "wallet" && chart.total > 0 && row.value > 0 ? `, ${share}% of what these accounts hold` : ""}
        </span>
      </p>
    );
  }

  if (chart.against) {
    const was = row.previous ?? 0;
    const moved = row.value - was;
    return (
      <p className="t-micro fms-chartread">
        <span className="fms-chartread-label">{row.label}</span>
        <span className="fms-proposalmoney fms-chartread-money">{chartLabel(row.value)}</span>
        <span className="fms-chartread-of">
          {moved === 0
            ? `the same as ${chart.against.name}`
            : `${chartLabel(Math.abs(moved))} ${moved > 0 ? "more" : "less"} than ${chart.against.name}, ${was === 0 ? "which had none" : `which was ${chartLabel(was)}`}`}
        </span>
      </p>
    );
  }

  return (
    <p className="t-micro fms-chartread">
      <span className="fms-chartread-label">{row.label}</span>
      <span className="fms-proposalmoney fms-chartread-money">{chartLabel(row.value)}</span>
      <span className="fms-chartread-of">
        {share}% of the total, {row.count} {row.count === 1 ? "entry" : "entries"}
      </span>
    </p>
  );
}

function ChartView({ chart }: { chart: Chart }) {
  /**
   * Which part is being read, shared by every shape.
   *
   * Hover sets it and tapping pins it, because a phone has no hover and the
   * owner asked to be able to tap a chart and see the figure. Pinned means
   * pinned: tapping the same part again lets it go.
   */
  const [at, setAt] = useState<number | null>(null);
  const [pinned, setPinned] = useState(false);

  const point = (i: number): void => {
    if (!pinned) setAt(i);
  };
  const pin = (i: number): void => {
    if (pinned && at === i) {
      setPinned(false);
      setAt(null);
      clearPick(chart.title);
      return;
    }
    setPinned(true);
    setAt(i);
    // What "that" means in the next question (features/chartPick.ts).
    const row = chart.rows[i];
    if (row) {
      const whole = chart.rows.reduce((sum, r) => sum + r.value, 0);
      notePick({
        chart: chart.title,
        part: row.label,
        lines: [
          `${row.label}: ${formatMoney(row.value)}${row.count > 0 ? `, ${row.count} ${row.count === 1 ? "entry" : "entries"}` : ""}`,
          ...(whole > 0 && chart.kind === "pie" ? [`${Math.round((row.value / whole) * 100)}% of the ${formatMoney(whole)} the chart shows`] : []),
        ],
      });
    }
  };
  const leave = (): void => {
    if (!pinned) setAt(null);
  };

  return (
    <div className="fms-proposal">
      <div className="fms-proposalhead">
        <span className="t-label" style={{ color: "var(--ink-2)" }}>
          {chart.title}
        </span>
        <span className="t-micro fms-proposalmoney" style={{ color: "var(--ink-3)" }}>
          {(chart.measure === "balance" || chart.measure === "owed") && chart.by !== "wallet" ? `Now ${chartLabel(chart.total)}` : chartLabel(chart.total)}
        </span>
      </div>

      {/* What the chart says, in a sentence worked out from its own rows (`chartAsk.ts`). */}
      {chartReading(chart) && <p className="t-caption fms-chartsays">{chartReading(chart)}</p>}

      {chart.against && (
        <p className="t-micro fms-chartkey">
          <span className="fms-chartkey-entry">
            <span className="fms-chartkey-swatch" style={{ background: toneOf(chart) }} aria-hidden />
            {chart.against.now}: <span className="fms-proposalmoney">{chartLabel(chart.total)}</span>
          </span>
          <span className="fms-chartkey-entry">
            <span className="fms-chartkey-swatch fms-chartkey-swatch--before" aria-hidden />
            {chart.measure === "budget" ? "Budget" : chart.against.name}: <span className="fms-proposalmoney">{chartLabel(chart.against.total)}</span>
          </span>
        </p>
      )}
      {chart.kind === "pie" ? (
        <PieView chart={chart} at={at} point={point} pin={pin} leave={leave} />
      ) : chart.kind === "line" ? (
        <LineView chart={chart} at={at} point={point} pin={pin} leave={leave} />
      ) : (
        <div className="fms-chartrows" onMouseLeave={leave}>
          {chart.rows.map((r, i) => {
            /*
             * Months are a series, so their order is the calendar's and rank
             * means nothing. A month above the average is drawn at full
             * strength: for spending that is the red that needs looking at.
             */
            const average = chart.total / Math.max(chart.rows.length, 1);
            // Days are a series too: shaded by rank they would read as a ranking.
            const months = overTime(chart.by);
            // Against a budget, full colour is a month over it; otherwise a period above the average.
            const strength =
              chart.measure === "budget" ? ((r.previous ?? 0) > 0 && r.value > (r.previous ?? 0) ? 1 : 0.55) : months ? monthStrength(r.value, average) : 1;
            // Two periods side by side: one ink for now, so rank does not read as a third thing.
            const colour = months || chart.against
              ? toneOf(chart)
              : rampFor(flowOf(chart), i, chart.rows.length);
            return (
            <button
              key={r.label}
              type="button"
              className={chart.against ? "fms-chartrow fms-chartrow--compare" : "fms-chartrow"}
              aria-pressed={pinned && at === i}
              onMouseEnter={() => point(i)}
              onFocus={() => point(i)}
              onBlur={leave}
              onClick={() => pin(i)}
            >
              <span className="fms-chartlabel t-micro">{r.label}</span>
              <span className="fms-charttrack">
                {/* Width carries the comparison; the colour says which way the money went. */}
                <span
                  className="fms-chartbar"
                  style={{
                    width: r.value === 0 ? 0 : `${Math.max(r.share * 100, 1.5)}%`,
                    background: colour,
                    opacity: at === null || at === i ? strength : strength * 0.6,
                  }}
                />
              </span>
              {chart.against && (
                /* The earlier period, under it in grey: neither gain nor loss, only what it was. */
                <span className="fms-charttrack fms-charttrack--before">
                  <span className="fms-chartbar fms-chartbar--before" style={{ width: !r.previous ? 0 : `${Math.max((r.previousShare ?? 0) * 100, 1.5)}%` }} />
                </span>
              )}
              <span className="t-micro fms-chartvalue fms-proposalmoney">
                {chartLabel(r.value)}
                {chart.against && (
                  <span className="fms-chartbefore">
                    {chart.measure === "budget" ? (r.previous ? ` of ${chartLabel(r.previous)}` : " no budget") : ` was ${chartLabel(r.previous ?? 0)}`}
                  </span>
                )}
              </span>
            </button>
            );
          })}
        </div>
      )}

      <ChartRead chart={chart} at={at} />

      <p className="t-micro fms-proposalfrom">
        {chart.measure === "budget"
          ? "Spending as the budget counts it: spending, bills, subscriptions, fees and interest. Worked out on this device."
          : chart.measure === "balance"
            ? "Balances worked out on this device, from your entries, the same way every screen does."
            : chart.measure === "owed"
              ? "What is owed: borrowed and charges added, less what was paid and written off. Interest paid is not owed. Worked out on this device."
              : chart.othersCount > 0
                ? `The ${chart.rows.length} largest, with ${chart.othersCount} smaller left off. Totals worked out on this device.`
                : "Totals worked out on this device, from your entries."}
        {chart.kind === "bars" && chart.measure === "budget"
          ? " Full colour marks the months over their budget."
          : chart.kind === "bars" && overTime(chart.by)
          ? ` Full colour marks the ${chart.by === "day" ? "days" : chart.by === "week" ? "weeks" : chart.by === "year" ? "years" : "months"} above the average of ${chartLabel(Math.round(chart.total / Math.max(chart.rows.length, 1)))}.`
          : ""}
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
function PieView({
  chart,
  at,
  point,
  pin,
  leave,
}: {
  chart: Chart;
  at: number | null;
  point: (i: number) => void;
  pin: (i: number) => void;
  leave: () => void;
}) {
  /*
   * Room in the hole for the total: at 132 the figure ran over the ring
   * (owner, 27 September 2026: "fix pie layout and ui its ugly"). A thin gap
   * of the card's own colour between slices, so neighbours of one hue read
   * as two.
   */
  const size = 160;
  const radius = 64;
  const centre = size / 2;
  const circumference = 2 * Math.PI * radius;
  const GAP = chart.rows.length > 1 ? 1.5 : 0;

  let offset = 0;
  const slices = chart.rows.map((r, i) => {
    const fraction = chart.total > 0 ? r.value / chart.total : 0;
    const slice = {
      label: r.label,
      value: r.value,
      dash: Math.max(0, fraction * circumference - GAP),
      offset,
      // Largest strongest, then stepping toward grey, in the colour of the
      // money (`rampFor`). Fading one hue over a dark background turned the
      // small slices the colour of a transfer.
      colour: rampFor(flowOf(chart), i, chart.rows.length),
      percent: Math.round(fraction * 100),
    };
    offset += fraction * circumference;
    return slice;
  });

  return (
    <div className="fms-pie" onMouseLeave={leave}>
      <svg viewBox={`0 0 ${size} ${size}`} className="fms-piesvg" role="img" aria-label={chart.title}>
        {/* Rotated so the first slice starts at the top, where reading starts. */}
        <g transform={`rotate(-90 ${centre} ${centre})`}>
          {slices.map((s, i) => (
            <circle
              key={s.label}
              cx={centre}
              cy={centre}
              r={radius}
              fill="none"
              stroke={s.colour}
              strokeOpacity={at === null || at === i ? 1 : 0.55}
              strokeWidth={at === i ? 22 : 18}
              strokeDasharray={`${s.dash} ${circumference - s.dash}`}
              strokeDashoffset={-s.offset}
              onMouseEnter={() => point(i)}
              onClick={() => pin(i)}
              style={{ cursor: "pointer" }}
            />
          ))}
        </g>
        {/* The slice being read, or the total: whole pesos past ten thousand, so the figure fits the hole. */}
        <text x={centre} y={centre + 1} className="fms-pietotal" textAnchor="middle">
          {pieFigure(at !== null ? (slices[at]?.value ?? chart.total) : chart.total)}
        </text>
        <text x={centre} y={centre + 17} className="fms-pieunit" textAnchor="middle">
          {at !== null ? `${slices[at]?.percent ?? 0}% of the total` : "PHP in total"}
        </text>
      </svg>

<ul className="fms-pielegend">
        {slices.map((s, i) => (
          <li key={s.label}>
            <button
              type="button"
              className="t-micro fms-legendrow"
              aria-pressed={at === i}
              onMouseEnter={() => point(i)}
              onFocus={() => point(i)}
              onBlur={leave}
              onClick={() => pin(i)}
            >
              <span className="fms-pieswatch" style={{ background: s.colour }} aria-hidden />
              <span className="fms-pielabel">{s.label}</span>
              <span className="fms-piefigure fms-proposalmoney">
                {s.percent}% · {chartLabel(s.value)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A month label, shortened when the year goes without saying: "January 2026" to "Jan". */
function shortLabel(label: string, sameYear: boolean): string {
  if (!sameYear) return label;
  const m = /^([A-Za-z]{3})[a-z]*\s+\d{4}$/.exec(label);
  return m?.[1] ?? label;
}

/** A figure for the middle of a donut: centavos below ten thousand pesos, whole pesos above. */
function pieFigure(centavos: number): string {
  const text = chartLabel(centavos).replace("PHP ", "");
  return centavos >= 1_000_000 ? text.replace(/\.\d{2}$/, "") : text;
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
function LineView({
  chart,
  at,
  point,
  pin,
  leave,
}: {
  chart: Chart;
  at: number | null;
  point: (i: number) => void;
  pin: (i: number) => void;
  leave: () => void;
}) {
  const width = 260;
  const height = 110;
  const pad = 6;
  const top = pad;
  const bottom = height - pad;

  /*
   * The axis runs from zero, or from below it when a balance went under:
   * a line that starts at its own lowest point makes a quiet month look like
   * a collapse. The budget's steady pace, when there is one, is on the same
   * scale, so where the two lines cross is where the month went over.
   */
  const pace = chart.measure === "budget" ? chart.rows.map((r) => r.previous ?? 0) : [];
  const highest = Math.max(...chart.rows.map((r) => r.value), ...pace, 1);
  const lowest = Math.min(0, ...chart.rows.map((r) => r.value));
  const yOf = (value: number): number => bottom - ((value - lowest) / (highest - lowest)) * (bottom - top);

  /**
   * One month is drawn in the middle, not in the corner.
   *
   * The step was zero for a single row, so the only point landed hard against
   * the left edge with a polygon of no width behind it: a stray dot in the
   * corner of an empty box, which is what the owner was looking at when they
   * said the trend was broken. A series of one has no slope to show, so it is
   * placed where a reading is, and the figure beside it does the talking.
   */
  const single = chart.rows.length < 2;
  const step = single ? 0 : (width - pad * 2) / (chart.rows.length - 1);

  const points = chart.rows.map((r, i) => ({
    label: r.label,
    value: r.value,
    count: r.count,
    x: single ? width / 2 : pad + i * step,
    y: yOf(r.value),
  }));
  const paceLine = pace.some((v) => v > 0) ? points.map((p, i) => `${p.x.toFixed(1)},${yOf(pace[i] ?? 0).toFixed(1)}`).join(" ") : "";
  const zeroY = yOf(0);

  const line = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  // "January 2026" to "Jan" when every point is in one year: the title already says which.
  const years = new Set(points.map((p) => /\b(\d{4})$/.exec(p.label)?.[1] ?? ""));
  const sameYear = years.size === 1 && !years.has("");
  const firstX = points[0]?.x ?? pad;
  const lastX = points[points.length - 1]?.x ?? width - pad;
  const area = `${firstX.toFixed(1)},${zeroY.toFixed(1)} ${line} ${lastX.toFixed(1)},${zeroY.toFixed(1)}`;

  /*
   * Which points get a line in the list. A flow lists every period with
   * money in it. A level lists where it changed, with the first and the
   * last, or thirty days of one balance read as thirty rows of the same
   * figure. Spending against the budget lists the days that had some.
   */
  const level = chart.measure === "balance" || chart.measure === "owed";
  const listed = (i: number): boolean => {
    const r = chart.rows[i];
    if (!r) return false;
    if (level) return i === 0 || i === chart.rows.length - 1 || r.value !== chart.rows[i - 1]?.value;
    if (chart.measure === "budget") return r.count > 0 || i === chart.rows.length - 1;
    return r.value !== 0;
  };

  /** Half a step either side, so the whole width of the chart is pointable. */
  const grab = single ? width / 2 : step / 2;

  return (
    <div className="fms-line" onMouseLeave={leave}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="fms-linesvg"
        role="img"
        aria-label={chart.title}
      >
        {single ? null : <polygon points={area} className="fms-linefill" style={{ fill: toneOf(chart) }} />}
        {/* Zero, drawn only when the line goes under it. */}
        {lowest < 0 ? <line x1={pad} y1={zeroY} x2={width - pad} y2={zeroY} className="fms-linezero" /> : null}
        {/* The steady pace to the budget: a guide, in the quiet ink, dashed. */}
        {paceLine && !single ? <polyline points={paceLine} className="fms-linepace" /> : null}
        {single ? null : <polyline points={line} className="fms-linestroke" style={{ stroke: toneOf(chart) }} />}

        {/* The one being read, marked down the full height so it is findable. */}
        {at !== null && points[at] ? (
          <line
            x1={points[at]?.x ?? 0}
            y1={top}
            x2={points[at]?.x ?? 0}
            y2={bottom}
            className="fms-lineat"
          />
        ) : null}

        {points.map((p, i) => (
          <circle
            key={p.label}
            cx={p.x}
            cy={p.y}
            r={at === i ? 4 : 2.5}
            className="fms-linedot"
            style={{ fill: toneOf(chart) }}
          />
        ))}

        {/*
          The part you actually point at.

          A 2.5px dot is not a target on a phone, and the owner asked to be
          able to tap the chart. Each band is the full height of the drawing
          and half a step wide, so anywhere above a month reads that month.
        */}
        {points.map((p, i) => (
          <rect
            key={`${p.label}-hit`}
            x={p.x - grab}
            y={0}
            width={grab * 2}
            height={height}
            fill="transparent"
            style={{ cursor: "pointer" }}
            onMouseEnter={() => point(i)}
            onClick={() => pin(i)}
          />
        ))}
      </svg>

      {/*
        The figures, because a line says the shape and not the numbers.
        A quiet day is on the line at zero and left out of the list, or a
        month of days reads as thirty rows of PHP 0.00.
      */}
      <ul className="fms-linelegend">
        {points.map((p, i) => (!listed(i) ? null : (
          <li key={p.label}>
            <button
              type="button"
              className="t-micro fms-legendrow"
              aria-pressed={at === i}
              onMouseEnter={() => point(i)}
              onFocus={() => point(i)}
              onBlur={leave}
              onClick={() => pin(i)}
            >
              <span className="fms-pielabel" title={p.label}>{shortLabel(p.label, sameYear)}</span>
              <span className="fms-piefigure fms-proposalmoney">{chartLabel(p.value)}</span>
            </button>
          </li>
        )))}
      </ul>
    </div>
  );
}

/**
 * The same movement, for a debt owed the other way.
 *
 * "Paid" picked from the sentence and then a debt chosen that is money lent
 * to someone left the card on an effect that debt cannot take, with a
 * refusal and no way to see why. A payment on money you are owed is them
 * paying you back, and borrowing is lending.
 */
function effectFor(effect: DebtEffect | undefined, kind: Debt["kind"]): DebtEffect | undefined {
  if (!effect) return undefined;
  if (effectsFor(kind).includes(effect)) return effect;
  const mirrored: Partial<Record<DebtEffect, DebtEffect>> =
    kind === "receivable" ? { repay: "collect", draw: "lend" } : { collect: "repay", lend: "draw" };
  return mirrored[effect];
}

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
  wallets,
  reference,
  transactions,
  sink,
  hostRef,
  onSettle,
  onChange,
  onNewPerson,
}: {
  turn: DebtChoice;
  debts: readonly Debt[];
  wallets: readonly string[];
  reference: ReferenceLists;
  /** The ledger, so a movement already in it says so before it is added twice. */
  transactions: readonly Transaction[];
  sink: ProposalSink;
  /** So the panel can measure this card and hold it still when it changes. */
  hostRef: (el: HTMLDivElement | null) => void;
  /** Done, with the entry as it was saved when it differs from the card. */
  onSettle: (final?: Draft) => void;
  onChange: (draft: Draft) => void;
  /** A name typed for someone not on the list, added with the entry. */
  onNewPerson: (name: string) => void;
}) {
  const { draft, state } = turn;
  const behalf = draft.behalf;
  const live = debts.filter((d) => !d.archived);
  const direction = debtWalletDirection(draft.debtEffect);
  // The wallet on the side this movement uses: a borrowing's "from" is never shown as where it lands.
  const named = direction === "in" ? draft.toWallet : direction === "out" ? draft.fromWallet : draft.fromWallet || draft.toWallet;
  const chosen = debts.find((d) => d.id === draft.debtId);
  /*
   * Money lent is owed to you, so before a person is picked the choices are
   * the ones for money owed to you. They read Borrowed and Paid, with nothing
   * chosen, on "I lent 500 to Juan".
   */
  const toYou = behalf ? behalf === "owed" : draft.debtEffect === "lend" || draft.debtEffect === "collect";
  const kind: Debt["kind"] = chosen?.kind ?? (toYou ? "receivable" : "payable");
  const effects = choicesFor(kind, draft.debtEffect, chosen?.form ?? (turn.newPerson ? "informal" : undefined));

  /*
   * Someone new is added in the same tap as the entry, as the form does.
   * The card had a button with their name on it to press first, and the
   * owner asked for names to stay off buttons.
   */
  const NEW = "new-person";
  const person = !draft.debtId && turn.newPerson && sink.canAddDebt ? personDebt(turn.newPerson, draft, debts, wallets[0] ?? "") : null;
  const ready: Draft = person ? { ...draft, debtId: person.id } : draft;
  const check = sink.check(ready, person ? [person] : undefined);
  /*
   * The same ₱2,000.00 borrowing on Maya Credit was entered on 18 September
   * and again on the 19th, and the debt card said nothing: only entry cards
   * looked for their twin in the ledger. The same debt and movement, amount
   * and nearby date is the same row.
   */
  const twins = ready.debtId
    ? duplicatesOf(ready, transactions).filter((m) => m.row.debtId === ready.debtId && m.row.debtEffect === ready.debtEffect)
    : [];
  const borrowing = !behalf && draft.debtEffect === "draw" && chosen?.form !== "pass-through";
  const paying = !behalf && draft.debtEffect === "repay" && chosen?.form !== "pass-through";
  const parts = paying && draft.debtId ? owedParts(transactions, draft.debtId, draft.date) : null;


  /*
   * The wallet a line uses, when nothing was said: Maya for Maya Credit.
   * The card left "Paid from" on Pick one, in red, for a payment whose line
   * only ever moves money through one wallet (27 September 2026).
   */
  const lineWallet = chosen?.wallet && wallets.includes(chosen.wallet) ? chosen.wallet : "";
  useEffect(() => {
    if (state !== "open" || !lineWallet || direction === "none" || named) return;
    onChange(direction === "in" ? { ...draft, toWallet: lineWallet, fromWallet: "" } : { ...draft, fromWallet: lineWallet, toWallet: "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.debtId, direction, lineWallet, state]);

  /** Who can be picked: people on this side for On behalf; banks, credit lines and loans otherwise. */
  const options = live.filter(
    (d) =>
      d.id === draft.debtId ||
      (behalf
        ? d.form === "pass-through" && d.kind === (behalf === "owed" ? "receivable" : "payable")
        : d.form !== "pass-through" && (!toYou || d.kind === "receivable")),
  );

  const chooseSide = (side: BehalfSide, effect: DebtEffect): void => {
    const moved = behalf !== side;
    onChange(
      withDebtEffect(
        { ...draft, behalf: side, debtId: moved ? undefined : draft.debtId, item: effect === "writeoff" ? draft.item : "", category: "" },
        effect,
      ),
    );
  };

  if (state === "settled") {
    return (
      <div ref={hostRef} className="fms-turn t-micro" style={{ color: "var(--ink-3)" }}>
        Added{behalf ? `, ${ON_BEHALF.toLowerCase()}` : ""}: {debts.find((d) => d.id === draft.debtId)?.name ?? "the movement"}
        {draft.debtEffect ? `, ${effectInline(draft.debtEffect, debts.find((d) => d.id === draft.debtId))}` : ""}, {formatMoney(draft.amount ?? 0)}
        {draft.debtEffect === "draw" && (draft.charges ?? 0) > 0 ? `, ${formatMoney(draft.charges ?? 0)} in fees added` : ""}
        {draft.debtEffect === "repay" && (draft.interest ?? 0) > 0 ? `, ${formatMoney(draft.interest ?? 0)} of it interest` : ""}. It
        is in the Database and in the activity trail.
      </div>
    );
  }

  const left = (ready.debtId ? 0 : 1) + (draft.debtEffect ? 0 : 1) + (behalf === "held" && draft.debtEffect === "writeoff" && !draft.item ? 1 : 0);

  return (
    <div ref={hostRef} className="fms-proposal">
      <div className="fms-proposalhead">
        <span className="t-label" style={{ color: "var(--ink-2)" }}>
          {behalf ? ON_BEHALF : "Debt movement"}
        </span>
        <span className="t-micro" style={{ color: "var(--ink-3)" }}>
          {left === 0 ? "check, then add" : left === 1 ? "one thing to pick" : `${left} things to pick`}
        </span>
      </div>

      <dl className="fms-proposalfields">
        <Field label="Date" value={draft.date} mono />
      </dl>

      {/*
        What happened first on someone's behalf: both sides in view, because
        the wrong side moves a balance the wrong way.
      */}
      {behalf ? (
        <div className="fms-debteffects">
          <span className="t-micro fms-pfieldlabel">What happened</span>
          {(["owed", "held"] as const).map((side) => {
            const shape = { kind: side === "owed" ? ("receivable" as const) : ("payable" as const), form: "pass-through" as const };
            return (
              <div key={side} className="fms-behalf-side">
                <span className="t-micro fms-behalf-label">{BEHALF_SIDE_LABEL[side]}</span>
                <div className="fms-choicerow" role="radiogroup" aria-label={BEHALF_SIDE_LABEL[side]}>
                  {BEHALF_EFFECTS[side].map((effect) => (
                    <button
                      key={effect}
                      type="button"
                      role="radio"
                      aria-checked={behalf === side && draft.debtEffect === effect}
                      className={
                        behalf === side && draft.debtEffect === effect
                          ? "fms-choice fms-choice--debt t-body-strong"
                          : "fms-choice fms-choice--debt t-body"
                      }
                      onClick={() => chooseSide(side, effect)}
                    >
                      {effectLabel(effect, shape)}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
          {draft.debtEffect && (
            <p className="t-micro fms-proposalnote">
              {effectMeaning(draft.debtEffect, { kind: behalf === "owed" ? "receivable" : "payable", form: "pass-through" })}
            </p>
          )}
        </div>
      ) : null}

      {/*
        The amount and the wallet are changed here, not only in the form.

        A figure filled from what is due, or read off a sentence, is the part
        most likely to need one number changed, and sending the whole entry to
        the form for that was the long way round.
      */}
      <div className="fms-debtpick">
        <label className="t-micro fms-pfieldlabel" htmlFor={`debt-amount-${turn.cardId}`}>
          Amount
        </label>
        <AmountInput
          id={`debt-amount-${turn.cardId}`}
          value={draft.amount}
          onChange={(v) => onChange({ ...draft, amount: v })}
          ariaLabel="Amount"
        />
      </div>

      {direction !== "none" && (
        <div className="fms-debtpick">
          <label className="t-micro fms-pfieldlabel" htmlFor={`debt-wallet-${turn.cardId}`}>
            {direction === "in" ? "Lands in" : "Paid from"}
          </label>
          <select
            id={`debt-wallet-${turn.cardId}`}
            className="t-caption fms-proposalselect"
            value={named}
            onChange={(e) =>
              onChange(
                direction === "in"
                  ? { ...draft, toWallet: e.target.value, fromWallet: "" }
                  : { ...draft, fromWallet: e.target.value, toWallet: "" },
              )
            }
          >
            <option value="">Pick one</option>
            {wallets.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
          {state === "open" && named !== "" && named === lineWallet && (
            <span className="t-micro" style={{ color: "var(--ink-3)" }}>
              The wallet {chosen?.name} uses. Change it if the money {direction === "in" ? "went" : "came from"} somewhere else.
            </span>
          )}
        </div>
      )}

      <div className="fms-debtpick">
        <label className="t-micro fms-pfieldlabel" htmlFor={`debt-line-${turn.cardId}`}>
          {behalf
            ? behalf === "owed"
              ? "On whose behalf"
              : "Whose money"
            : toYou || turn.newPerson
              ? "Who it is"
              : live.some((d) => d.counterpartyType === "person")
                ? "Which debt or person"
                : "Which credit line"}
        </label>
        <select
          id={`debt-line-${turn.cardId}`}
          className="t-caption fms-proposalselect"
          value={draft.debtId ?? (person ? NEW : "")}
          onChange={(e) => {
            if (e.target.value === NEW) {
              onChange({ ...draft, debtId: undefined });
              return;
            }
            const debt = live.find((d) => d.id === e.target.value);
            const effect = debt ? effectFor(draft.debtEffect, debt.kind) : draft.debtEffect;
            const next = {
              ...draft,
              debtId: e.target.value || undefined,
              ...(debt?.form === "pass-through" ? { behalf: debt.kind === "receivable" ? ("owed" as const) : ("held" as const) } : {}),
            };
            onChange(effect && effect !== draft.debtEffect ? withDebtEffect(next, effect) : next);
          }}
        >
          <option value="">Pick one</option>
          {person && <option value={NEW}>{person.name} (new, added with this entry)</option>}
          {options.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        {/* Someone not on the list: typed here, and added in the same tap as the entry. */}
        {!draft.debtId && sink.canAddDebt && (behalf || toYou || turn.newPerson) && (
          <input
            type="text"
            className="t-caption fms-proposalselect"
            value={turn.newPerson ?? ""}
            maxLength={60}
            placeholder="Or type a new name"
            aria-label="A new name"
            onChange={(e) => onNewPerson(e.target.value)}
          />
        )}
      </div>

      {behalf && draft.debtEffect === "writeoff" && (
        <div className="fms-debtpick">
          <label className="t-micro fms-pfieldlabel" htmlFor={`debt-item-${turn.cardId}`}>
            {behalf === "owed" ? "What it bought" : "Counts as income from"}
          </label>
          <select
            id={`debt-item-${turn.cardId}`}
            className="t-caption fms-proposalselect"
            value={draft.item}
            onChange={(e) => onChange({ ...draft, item: e.target.value })}
          >
            {/* Written off with no kind is money given away: Money Send (`kinds.ts`). */}
            <option value="">{behalf === "owed" ? "Money given (Money Send)" : "Pick one"}</option>
            {(behalf === "owed" ? reference.spendingTypes.map((t) => t.name) : reference.revenueCategories).map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
      )}

      {!behalf && (
        <div className="fms-debteffects">
          <span className="t-micro fms-pfieldlabel">What it does</span>
          {/*
            The form's own choice control, in the debt colour.

            It was four buttons with the chosen one filled in brand green,
            which is the colour this app spends on income (rule D3).
          */}
          <div className="fms-choicerow" role="radiogroup" aria-label="What this debt movement does">
            {effects.map((effect) => (
              <button
                key={effect}
                type="button"
                role="radio"
                aria-checked={draft.debtEffect === effect}
                className={
                  draft.debtEffect === effect
                    ? "fms-choice fms-choice--debt t-body-strong"
                    : "fms-choice fms-choice--debt t-body"
                }
                onClick={() => onChange(withDebtEffect(draft, effect))}
              >
                {effectLabel(effect, chosen)}
              </button>
            ))}
          </div>
        </div>
      )}

      {borrowing && (
        <div className="fms-debtpick">
          <label className="t-micro fms-pfieldlabel" htmlFor={`debt-charges-${turn.cardId}`}>
            Fees added
          </label>
          <div className="fms-debtinterest">
            <AmountInput
              id={`debt-charges-${turn.cardId}`}
              value={draft.charges ?? null}
              onChange={(v) => onChange({ ...draft, charges: v })}
              ariaLabel="Fees added to what you owe"
            />
            <span className="t-micro" style={{ color: "var(--ink-3)" }}>
              {(draft.charges ?? 0) > 0 && draft.amount !== null
                ? `${formatMoney(draft.amount + (draft.charges ?? 0))} added to what you owe, ${formatMoney(draft.charges ?? 0)} of it fees.`
                : "Service fee, tax or interest the lender added. Blank if none."}
            </span>
          </div>
        </div>
      )}

      {paying && (
        <div className="fms-debtpick">
          <label className="t-micro fms-pfieldlabel" htmlFor={`debt-interest-${turn.cardId}`}>
            {parts && parts.fees > 0 ? "Interest and fees" : "Interest included"}
          </label>
          <div className="fms-debtinterest">
            <AmountInput
              id={`debt-interest-${turn.cardId}`}
              value={draft.interest ?? null}
              onChange={(v) => onChange({ ...draft, interest: v })}
              ariaLabel="Interest included in the payment"
            />
            <span className="t-micro" style={{ color: "var(--ink-3)" }}>
              {check.feesPaid && parts
                ? `One payment of ${formatMoney(check.feesPaid.total)}: ${formatMoney(check.feesPaid.total - check.feesPaid.fees)} off what you borrowed and ${formatMoney(check.feesPaid.fees)} of the interest and fees ${chosen?.counterparty || chosen?.name || "the lender"} already added, counted once. ${check.feesPaid.total >= parts.owed ? `${chosen?.name ?? "It"} is cleared.` : `${formatMoney(parts.owed - check.feesPaid.total)} still owed after it.`}`
                : check.split && check.split.interest > 0 && check.split.principal > 0
                  ? `${formatMoney(check.split.principal)} off the balance, ${formatMoney(check.split.interest)} interest.`
                  : parts && parts.fees > 0
                    ? `${chosen?.counterparty || chosen?.name || "The lender"} added ${formatMoney(parts.fees)} when you borrowed. Put it here, and what you borrowed (${formatMoney(parts.borrowed)}) as the amount.`
                    : "From the bill or the app. Blank if none."}
            </span>
          </div>
          {parts && parts.fees > 0 && !check.feesPaid && !(draft.interest === parts.fees && draft.amount === parts.borrowed) && (
            <button type="button" className="t-micro fms-linkish" onClick={() => onChange({ ...draft, amount: parts.borrowed, interest: parts.fees })}>
              Fill in {formatMoney(parts.borrowed)} + {formatMoney(parts.fees)}
            </button>
          )}
          {/*
            Exactly what is owed, with interest as well: the interest was most
            likely on top. See `interestOnTop` for the payment that left PHP
            500.00 owed on a credit line the owner had just paid off.
          */}
          {(() => {
            const total = draft.debtId && !check.feesPaid ? interestOnTop(draft.amount, outstandingOf(transactions, draft.debtId), draft.interest) : null;
            return total ? (
              <p className="t-micro fms-proposalnote">
                {formatMoney(draft.amount ?? 0)} is everything owed, so {formatMoney(draft.interest ?? 0)} would stay owed. If the interest was on top, you paid {formatMoney(total)}.{" "}
                <button type="button" className="t-micro fms-linkish" onClick={() => onChange({ ...draft, amount: total })}>
                  Make it {formatMoney(total)}
                </button>
              </p>
            ) : null;
          })()}
        </div>
      )}

      {/*
        The fee the app charged to send it, from the owner's own money: on a
        payment, on money lent or advanced, on someone's money passed on.
        Their transfer fee, never interest and never the other person's.
      */}
      {(draft.debtEffect === "repay" || draft.debtEffect === "lend") && (
        <div className="fms-debtpick">
          <label className="t-micro fms-pfieldlabel" htmlFor={`debt-fee-${turn.cardId}`}>
            Fee
          </label>
          <div className="fms-debtinterest">
            <AmountInput
              id={`debt-fee-${turn.cardId}`}
              value={draft.fee > 0 ? draft.fee : null}
              onChange={(v) => onChange({ ...draft, fee: v ?? 0 })}
              ariaLabel="Fee paid to send it"
            />
            <span className="t-micro" style={{ color: "var(--ink-3)" }}>
              {draft.fee > 0 && draft.amount !== null
                ? `${formatMoney(draft.amount + draft.fee)} leaves ${draft.fromWallet || "the wallet"}, ${formatMoney(draft.fee)} of it your transfer fee.`
                : "Paid from your own money to send it. Blank if none."}
            </span>
          </div>
        </div>
      )}

      {/* Only while open: a saved card is checked against a ledger that holds its own rows. */}
      {state === "open" && check.problems.map((p) => (
        <p key={p} className="t-micro fms-proposalnote fms-proposalnote--stop">
          {p}
        </p>
      ))}
      {state === "open" && check.warnings.map((w) => (
        <p key={w} className="t-micro fms-proposalnote fms-proposalnote--warn">
          {w}
        </p>
      ))}
      {state === "open" && twins[0] && (
        <p className="t-micro fms-proposalnote fms-proposalnote--warn">
          {duplicateHeadline(twins[0])} Add it only if it is a second, separate one.
        </p>
      )}

      <div className="fms-proposalactions">
        <Button
          size="sm"
          variant="primary"
          disabled={!check.ok}
          onClick={() => {
            // Someone new first, then the row that names them.
            if (person) sink.addDebt(person);
            sink.add(ready, { actor: "ai", via: "ai_chat" });
            onSettle(ready);
          }}
        >
          Add to ledger
        </Button>
        <Button size="sm" onClick={() => sink.use(draft)}>
          Open in the form
        </Button>
        <Button size="sm" onClick={() => onSettle()}>
          Discard
        </Button>
      </div>

      <p className="t-micro fms-proposalfrom">
        {behalf
          ? "On someone's behalf is never income or spending, until it is written off (spending) or retained (income). Check who it is and what happened before adding."
          : draft.debtId && draft.debtEffect
            ? toYou
              ? "Who it is and what it does were read from your words. Check both before adding: lending read as paid back would say they owe you less."
              : "The line and what it does were read from your words. Check both before adding: reading either wrong turns borrowing into income."
            : "Who it is with and what it does are the two things nobody should guess at with money that is owed, so they are picked unless your words said them plainly."}
      </p>
    </div>
  );
}

/** The account most of a picture's rows moved, when most of them agree, or "". */
function mostMoved(drafts: readonly Draft[]): string {
  const count = new Map<string, number>();
  for (const d of drafts) {
    const wallet = (d.flow === "Revenue" ? d.toWallet : d.fromWallet || d.toWallet).trim();
    if (wallet) count.set(wallet, (count.get(wallet) ?? 0) + 1);
  }
  const [best, n] = [...count].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
  return n * 2 > drafts.length ? best : "";
}
