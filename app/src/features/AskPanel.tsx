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

import { useEffect, useId, useRef, useState } from "react";

import { Button } from "../components/primitives";
import { amend, applyReply, matchItem, nextQuestion, type Blank } from "../domain/capture";
import { readEntry } from "../domain/readEntry";
import { readRich } from "../domain/richText";
import { inferFromHistory } from "../domain/infer";
import { itemsFor } from "../domain/entry";
import { detectIntent, isQuestion, type Intent } from "../domain/intent";
import { modelLabel } from "../domain/modelName";
import { formatMoney } from "../domain/money";
import { classifyItem, extractProposals } from "../data/aiClient";
import { chatStore } from "../data/chatStore";
import { said } from "../domain/chat";
import { formatBytes, readFiles, totalBytes, type Attachment } from "../data/attachments";
import { useAi } from "./useAi";
import type { Draft } from "../domain/entry";
import type { Proposal } from "../domain/proposal";
import type { Provenance } from "../domain/activity";
import { imageLimits, type AppSettings } from "../domain/settings";
import type { Budgets, ReferenceLists, Transaction } from "../domain/types";

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
  readonly add: (draft: Draft, by?: Provenance) => void;
  /** The number this entry would take, shown before it is saved. */
  readonly nextRecordNumber: number;
}

interface Said {
  readonly kind: "you" | "assistant";
  readonly text: string;
  /** Assistant turns: which model, or that this device wrote it. */
  readonly from?: string;
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
}

type Turn = Said | Offered;

const isOffer = (t: Turn): t is Offered => t.kind === "proposal";

/**
 * How much of the thread goes back with each question.
 *
 * Enough to follow a pronoun, not so much that a long session quietly grows
 * every request until it hits the token limit.
 */
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
}: {
  settings: AppSettings;
  transactions: readonly Transaction[];
  budgets: Budgets;
  reference: ReferenceLists;
  asOf: string;
  sink: ProposalSink;
  /** Signed in, so the conversation has somewhere to live. Null in local mode. */
  uid: string | null;
  /**
   * The last row the form saved.
   *
   * A card sent to the form with "Edit first" stayed reading "In the form"
   * even after you pressed Save there, so the two halves of one entry
   * disagreed about what had happened to it.
   */
  lastSaved: { draft: Draft; at: number } | null;
}) {
  const ai = useAi({ settings, transactions, budgets, reference, feature: "insightSummary", asOf });

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

  // A new message is only useful if you can see it.
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
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
  const say = (turn: Turn): void => {
    setTurns((prev) => [...prev, turn]);
    if (isOffer(turn)) return;
    void chatStore(uid)
      .record(said(turn.kind, turn.text, turn.from))
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
    chatStore(uid)
      .recent()
      .then((history) => {
        if (!live || history.length === 0) return;
        setTurns((prev) =>
          prev.length > 0
            ? prev
            : history.map((m) => ({
                kind: m.role,
                text: m.text,
                ...(m.from ? { from: m.from } : {}),
              })),
        );
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [uid]);

  const settle = (index: number, state: Offered["state"]): void =>
    setTurns((prev) =>
      prev.map((t, i) => (i === index && isOffer(t) ? { ...t, state } : t)),
    );

  /** The card a correction would apply to: the last one still open. */
  const openCard = (): { index: number; turn: Offered } | null => {
    for (let i = turns.length - 1; i >= 0; i--) {
      const turn = turns[i];
      if (turn && isOffer(turn) && turn.state === "open") return { index: i, turn };
    }
    return null;
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
        const wants = draft.flow === "Revenue" ? "toWallet" : "fromWallet";
        if (draft[wants]) return t;
        const value = source[wants];
        if (!value) return t;
        return { ...t, proposal: { ...t.proposal, draft: { ...draft, [wants]: value } } };
      }),
    );

  /** From Settings, clamped there, so a typo cannot ask for a hundred. */
  const limits = imageLimits(settings.ai);

  const attach = async (picked: ArrayLike<File> | null): Promise<void> => {
    if (!picked || picked.length === 0) return;
    const { attachments, rejected } = await readFiles(Array.from(picked), files.length, limits);
    if (attachments.length > 0) setFiles((prev) => [...prev, ...attachments]);
    for (const r of rejected) {
      say({ kind: "assistant", text: `${r.name}: ${r.reason}`, from: "this device" });
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
    // History first. Asking a question the ledger already answers is the
    // assistant failing to read its own data. `readEntry` has already done
    // this pass, so it says so rather than having it run twice.
    const { draft, because } = useHistory
      ? inferFromHistory(proposal.draft, transactions, reference, hint)
      : { draft: proposal.draft, because: [] as string[] };
    const filled: Proposal = {
      ...proposal,
      draft,
      adjustments: [...proposal.adjustments, ...because],
    };

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
      !matchItem(ready.draft.item, itemFlow, ready.draft.category, reference).matched
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
      say({ kind: "proposal", proposal: ready, state: "open" });
      return;
    }
    setPending({ draft: ready.draft, blank: asked.blank, settled });
    say({ kind: "assistant", text: asked.question, from: "this device" });
  };

  /** An answer to the question the assistant just asked. */
  const answerPending = async (reply: string): Promise<void> => {
    if (!pending) return;
    say({ kind: "you", text: reply });

    const filled = applyReply(pending.draft, pending.blank, reply, reference);
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
      say({ kind: "assistant", text: asked.question, from: "this device" });
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
      const local = matchItem(reply, complete.flow, complete.category, reference);
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
        replyFlow === "" ? null : matchItem(complete.item, replyFlow, complete.category, reference);
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
        adjustments: because,
      },
      state: "open",
    });
  };

  /** Read the attached files into proposals. Returns false when there were none. */
  const readAttached = async (note: string): Promise<boolean> => {
    const sent = files;
    setFiles([]);
    // Only once: if this falls through to the question path, that path must
    // not echo the same message a second time.
    if (sent.length > 0 || note) {
      say({
        kind: "you",
        text: [note, sent.map((f) => f.name).join(", ")].filter(Boolean).join(" · "),
      });
    }

    const result = await extractProposals({ note, attachments: sent, reference, asOf });

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

    if (result.proposals.length > 0) {
      say({
        kind: "assistant",
        text:
          result.proposals.length === 1
            ? "One entry. Check it, then add it."
            : `${result.proposals.length} entries. Check each one, then add it.`,
        from: modelLabel(result.model ?? "") || "the provider",
      });
    }

    const batch = result.proposals.length > 1;
    for (const proposal of result.proposals) await offer(proposal, note, true, batch);
    if (batch) {
      const blanks = result.proposals.filter(
        (p) => nextQuestion(p.draft, reference) !== null,
      ).length;
      if (blanks > 0) {
        say({
          kind: "assistant",
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

    const history = turns
      .filter((t): t is Said => !isOffer(t))
      .slice(-HISTORY_TURNS)
      .map((t) => ({ role: t.kind as "you" | "assistant", text: t.text }));

    const answer = await ai.ask("chat", { question, history });

    say({
      kind: "assistant",
      text: answer.text,
      from:
        answer.source === "model"
          ? modelLabel(answer.model ?? "") || "the provider"
          : "this device",
    });
  };

  const send = async (typed?: string, as?: Intent): Promise<void> => {
    const note = (typed ?? draft).trim();
    if (busy) return;
    if (!note && files.length === 0) return;

    // A starter button is always a question, whatever the box happens to say.
    /**
     * While a question is outstanding, what you type is the answer to it. An
     * attachment overrides that: a picture is a new thing to read, not a
     * reply, so the half-finished row is dropped rather than confused with it.
     */
    if (pending && files.length === 0 && !as) {
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
    const job = as ?? (files.length > 0 || !isQuestion(note) ? "log" : detectIntent(note));

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
      const lines = note
        .split(String.fromCharCode(10))
        .map((l) => l.trim())
        .filter(Boolean);

      if (files.length === 0 && lines.length > 1) {
        const each = lines.map((line) => readEntry(line, transactions, reference, asOf));
        if (each.every((r) => r.worthOffering)) {
          say({ kind: "you", text: note });
          for (const [i, r] of each.entries()) {
            await offer(
              {
                draft: r.draft,
                confidence: "high",
                sourceRef: `line ${i + 1}: ${lines[i] ?? ""}`,
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
        if (local.readsAsDebt) {
          say({ kind: "you", text: note });
          // Open the form on Debt with what the sentence did give up, so the
          // only things left are the two nobody should guess.
          sink.use(local.draft);
          const knows = [
            local.draft.amount !== null ? "the amount" : "",
            local.draft.fromWallet ? `the wallet (${local.draft.fromWallet})` : "",
            "the date",
          ].filter(Boolean);
          say({
            kind: "assistant",
            text: `That reads as debt, so it goes through the form: which credit line it belongs to, and whether it is a draw, a repayment, interest or a write-off, are not things to guess at with borrowed money. I have opened Debt beside this with ${knows.join(", ")} filled in. Pick the debt and the effect, then save.`,
            from: "this device",
          });
          return;
        }

        if (local.worthOffering) {
          say({ kind: "you", text: note });
          await offer(
            {
              draft: local.draft,
              confidence: "high",
              sourceRef: "what you told me",
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
      if (!found && files.length === 0 && note) await askQuestion(note, false);
    } finally {
      setBusy(false);
    }
  };

  /** Cards still waiting on a decision, and how many of those could save. */
  const open = turns.filter((t): t is Offered => isOffer(t) && t.state === "open");
  const openCount = open.length;
  const readyCount = open.filter((t) => sink.check(t.proposal.draft).ok).length;

  /**
   * Add every card that would save, and leave the rest showing.
   *
   * One pass over the list rather than one setState per card, so eight rows
   * are one render and one batch of writes rather than eight of each.
   */
  const addReady = (): void => {
    const added: number[] = [];
    turns.forEach((t, i) => {
      if (isOffer(t) && t.state === "open" && sink.check(t.proposal.draft).ok) {
        sink.add(t.proposal.draft, {
          actor: "ai",
          via: t.proposal.sourceRef.toLowerCase().includes("image") ? "ai_image" : "ai_chat",
        });
        added.push(i);
      }
    });
    setTurns((prev) =>
      prev.map((t, i) => (added.includes(i) && isOffer(t) ? { ...t, state: "added" } : t)),
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
          isOffer(turn) ? (
            <ProposalCard
              key={i}
              offered={turn}
              sink={sink}
              reference={reference}
              onChange={(draft) => replaceProposal(i, { ...turn.proposal, draft })}
              onChangeAll={(draft) => applyToAll(draft)}
              onAdd={() => {
                sink.add(turn.proposal.draft, {
                  actor: "ai",
                  // A picture and a sentence are different enough to tell
                  // apart when reading the trail back.
                  via: turn.proposal.sourceRef.toLowerCase().includes("image")
                    ? "ai_image"
                    : "ai_chat",
                });
                settle(i, "added");
              }}
              onUse={() => {
                sink.use(turn.proposal.draft);
                settle(i, "used");
              }}
              onDiscard={() => settle(i, "discarded")}
            />
          ) : (
            <div key={i} className={turn.kind === "you" ? "fms-turn fms-turn--you" : "fms-turn"}>
              {turn.kind === "assistant" ? (
                <Rich text={turn.text} />
              ) : (
                <p className="t-caption" style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                  {turn.text}
                </p>
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
          <p className="t-caption" style={{ margin: 0, color: "var(--ink-3)" }} role="status">
            {intent === "log" ? "Reading" : "Thinking"}
          </p>
        )}
      </div>

      {attached && (
        <div className="fms-askfiles">
          {files.map((f) => (
            <span key={f.id} className="fms-filechip t-micro">
              {f.kind === "image" && f.dataUrl && (
                <img src={f.dataUrl} alt="" className="fms-filethumb" />
              )}
              <span className="fms-filename">{f.name}</span>
              <button
                type="button"
                aria-label={`Remove ${f.name}`}
                className="fms-fileclose"
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
        <Button
          size="sm"
          variant="primary"
          type="submit"
          disabled={busy || (!draft.trim() && !attached)}
        >
          {attached ? "Read" : pending ? "Answer" : intent === "log" ? "Log" : "Send"}
        </Button>
      </form>

      {turns.length > 0 && (
        <button type="button" className="t-micro fms-linkish" onClick={() => setTurns([])}>
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
  onChange,
  onChangeAll,
  onAdd,
  onUse,
  onDiscard,
}: {
  offered: Offered;
  sink: ProposalSink;
  reference: ReferenceLists;
  onChange: (draft: Draft) => void;
  onChangeAll: (draft: Draft) => void;
  onAdd: () => void;
  onUse: () => void;
  onDiscard: () => void;
}) {
  const { proposal, state } = offered;
  const { draft } = proposal;
  const check = sink.check(draft);
  // Stable and unique per card, so the label points at its own select.
  const pickerId = useId();

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
      <div className="fms-turn t-micro" style={{ color: "var(--ink-3)" }}>
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
  const confidence =
    proposal.confidence === "high"
      ? "clear"
      : proposal.confidence === "medium"
        ? "fairly clear"
        : "hard to read";

  return (
    <div className={settled ? "fms-proposal fms-proposal--settled" : "fms-proposal"}>
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
        <Field label="Record number" value={String(sink.nextRecordNumber).padStart(4, "0")} mono />
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
