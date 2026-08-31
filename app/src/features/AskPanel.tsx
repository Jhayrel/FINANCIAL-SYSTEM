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

import { useEffect, useRef, useState } from "react";

import { Button } from "../components/primitives";
import { applyReply, nextQuestion, type Blank } from "../domain/capture";
import { detectIntent, type Intent } from "../domain/intent";
import { modelLabel } from "../domain/modelName";
import { formatMoney } from "../domain/money";
import { extractProposals } from "../data/aiClient";
import { formatBytes, readFiles, totalBytes, LIMITS, type Attachment } from "../data/attachments";
import { useAi } from "./useAi";
import type { Draft } from "../domain/entry";
import type { Proposal } from "../domain/proposal";
import type { AppSettings } from "../domain/settings";
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
  /** Save it, through the same path a typed entry takes. */
  readonly add: (draft: Draft) => void;
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
}: {
  settings: AppSettings;
  transactions: readonly Transaction[];
  budgets: Budgets;
  reference: ReferenceLists;
  asOf: string;
  sink: ProposalSink;
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
  const [pending, setPending] = useState<{ draft: Draft; blank: Blank } | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLInputElement>(null);

  // A new message is only useful if you can see it.
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, busy]);

  const say = (turn: Turn): void => setTurns((prev) => [...prev, turn]);

  const settle = (index: number, state: Offered["state"]): void =>
    setTurns((prev) =>
      prev.map((t, i) => (i === index && isOffer(t) ? { ...t, state } : t)),
    );

  const attach = async (picked: FileList | null): Promise<void> => {
    if (!picked || picked.length === 0) return;
    const { attachments, rejected } = await readFiles([...picked], files.length);
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
  const offer = (proposal: Proposal): void => {
    const asked = nextQuestion(proposal.draft, reference);
    if (!asked) {
      say({ kind: "proposal", proposal, state: "open" });
      return;
    }
    setPending({ draft: proposal.draft, blank: asked.blank });
    say({ kind: "assistant", text: asked.question, from: "this device" });
  };

  /** An answer to the question the assistant just asked. */
  const answerPending = (reply: string): void => {
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

    const asked = nextQuestion(filled, reference);
    if (asked) {
      setPending({ draft: filled, blank: asked.blank });
      say({ kind: "assistant", text: asked.question, from: "this device" });
      return;
    }

    setPending(null);
    say({
      kind: "proposal",
      proposal: { draft: filled, confidence: "high", sourceRef: "what you told me", adjustments: [] },
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

    for (const proposal of result.proposals) offer(proposal);
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
      answerPending(note);
      return;
    }
    if (files.length > 0) setPending(null);

    const job = as ?? (files.length > 0 ? "log" : detectIntent(note));

    setDraft("");
    setBusy(true);
    try {
      if (job === "ask") {
        await askQuestion(note);
        return;
      }

      /**
       * Read it as an entry, and answer it as a question if there was no
       * entry in it after all.
       *
       * This is what replaced the chip. "I paid Maya 500" and "I paid too
       * much for Maya" are one word apart, and a guess that costs a wrong
       * answer is worse than one that quietly tries the other job. It only
       * runs for typed text: an attachment was unambiguous.
       */
      const found = await readAttached(note);
      if (!found && files.length === 0 && note) await askQuestion(note, false);
    } finally {
      setBusy(false);
    }
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
    <aside className="fms-panel fms-ask" data-thinking={busy ? "true" : undefined}>
      <div className="fms-askhead">
        <div className="t-label" style={{ color: "var(--ink-2)" }}>
          Ask
        </div>
        <p className="t-caption" style={{ margin: "2px 0 0", color: "var(--ink-3)" }}>
          Reads your figures and your receipts. It proposes; you save.
        </p>
      </div>

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
              onAdd={() => {
                sink.add(turn.proposal.draft);
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
              <p className="t-caption" style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                {turn.text}
              </p>
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
            {files.length} of {LIMITS.maxCount}, {formatBytes(weight)}
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
          disabled={busy || files.length >= LIMITS.maxCount}
          onClick={() => pickerRef.current?.click()}
        >
          +
        </button>
        <input
          className="t-caption fms-askinput"
          value={draft}
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
          Clear conversation
        </button>
      )}
    </aside>
  );
}

/**
 * One proposed row, with everything that would stop it being saved.
 *
 * The check is the form's own, run on every render, so the Add button reflects
 * the ledger as it stands rather than as it stood when the model answered.
 */
function ProposalCard({
  offered,
  sink,
  onAdd,
  onUse,
  onDiscard,
}: {
  offered: Offered;
  sink: ProposalSink;
  onAdd: () => void;
  onUse: () => void;
  onDiscard: () => void;
}) {
  const { proposal, state } = offered;
  const { draft } = proposal;
  const check = sink.check(draft);

  if (state !== "open") {
    return (
      <div className="fms-turn t-micro" style={{ color: "var(--ink-3)" }}>
        {state === "added"
          ? `Added: ${draft.item || draft.description || "entry"}, ${formatMoney(draft.amount ?? 0)}.`
          : state === "used"
            ? "Put in the form. Check it and press Save transaction."
            : "Discarded."}
      </div>
    );
  }

  return (
    <div className="fms-proposal">
      <div className="fms-proposalhead">
        <span className="t-label" style={{ color: "var(--ink-2)" }}>
          {draft.flow}
        </span>
        <span className="t-micro" style={{ color: "var(--ink-3)" }}>
          {proposal.confidence === "high" ? "clear" : proposal.confidence === "medium" ? "fairly clear" : "hard to read"}
        </span>
      </div>

      <dl className="fms-proposalfields">
        <Field label="Date" value={draft.date} />
        {draft.fromWallet !== "" || draft.flow !== "Revenue" ? (
          <Field label="From" value={draft.fromWallet} missing={!draft.fromWallet} />
        ) : null}
        {draft.flow !== "Spending" && (
          <Field label="To" value={draft.toWallet} missing={!draft.toWallet} />
        )}
        <Field label="Item" value={draft.item} missing={!draft.item} />
        <Field label="Amount" value={formatMoney(draft.amount ?? 0)} mono />
        {draft.fee > 0 && <Field label="Fee" value={formatMoney(draft.fee)} mono />}
        {draft.description && <Field label="Note" value={draft.description} />}
      </dl>

      {proposal.adjustments.map((a) => (
        <p key={a} className="t-micro fms-proposalnote">
          {a}
        </p>
      ))}
      {check.problems.map((p) => (
        <p key={p} className="t-micro fms-proposalnote fms-proposalnote--stop">
          {p}
        </p>
      ))}
      {check.warnings.map((w) => (
        <p key={w} className="t-micro fms-proposalnote">
          {w}
        </p>
      ))}

      <div className="fms-proposalactions">
        <Button size="sm" variant="primary" disabled={!check.ok} onClick={onAdd}>
          Add
        </Button>
        <Button size="sm" onClick={onUse}>
          Edit first
        </Button>
        <Button size="sm" onClick={onDiscard}>
          Discard
        </Button>
      </div>
      <p className="t-micro" style={{ margin: 0, color: "var(--ink-3)" }}>
        From {proposal.sourceRef}
      </p>
    </div>
  );
}

function Field({
  label,
  value,
  missing,
  mono,
}: {
  label: string;
  value: string;
  missing?: boolean;
  mono?: boolean;
}) {
  return (
    <>
      <dt className="t-micro" style={{ color: "var(--ink-3)" }}>
        {label}
      </dt>
      <dd
        className={mono ? "t-micro fms-proposalmoney" : "t-micro"}
        style={{ margin: 0, color: missing ? "var(--over)" : "var(--ink)" }}
      >
        {value || "you pick"}
      </dd>
    </>
  );
}
