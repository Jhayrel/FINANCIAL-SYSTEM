/**
 * The papers the owner has taught, and what each one taught.
 *
 * ── Where the examples come from ──────────────────────────────────────────
 *
 *   - "train", "don't add", "for training" with pictures: each picture's
 *     card has Teach in place of Add to ledger, with the kind of paper on
 *     it to change. Teach keeps the example; nothing goes into the ledger.
 *   - Every picture card the owner adds teaches too: the paper, as read,
 *     filed the way they saved it.
 *
 * ── Where they are kept ───────────────────────────────────────────────────
 *
 * In the owner's own database, in the assistant's record (`users/{uid}/ai`),
 * as an "accepted" event with the field "paper": the reading in `text` and
 * what it taught in `entry`. That record is append only and private to the
 * owner, and its rules already allow exactly this shape, so nothing has to
 * be deployed. Never in the code: the owner's papers name them, their family
 * and their accounts. Long runs of digits (account and reference numbers)
 * are masked before anything is kept.
 *
 * ── What they are used for ────────────────────────────────────────────────
 *
 *   - Training the kind of paper (`paperKind.ts`), counted three times over
 *     the starter examples, because these are the papers this ledger sees.
 *   - The nearest one taught, when a new picture reads like it: its filing
 *     (kind, item, account, who it was for) and the model is shown it.
 */

import { aiEvent, type AiEvent } from "./aiLog";
import type { Draft } from "./entry";
import type { Centavos } from "./money";
import { PAPER_KINDS, paperTokens, trainPapers, type PaperExample, type PaperKind, type PaperModel } from "./paperKind";
import { PAPER_SEED } from "./paperSeed";

export interface TaughtPaper {
  readonly at: string;
  readonly kind: PaperKind;
  /** What the phone read off it, numbers masked. */
  readonly text: string;
  /** Whether it recorded a payment: a bill taught as unpaid says no. */
  readonly paid: boolean;
  readonly amount: Centavos | null;
  readonly flow: string;
  readonly category: string;
  readonly item: string;
  readonly fromWallet: string;
  readonly toWallet: string;
  /** The debt or On behalf line it was filed against, by its id, when it was. */
  readonly person: string;
  readonly description: string;
}

/** The field that marks an example among the assistant's events. */
export const PAPER_FIELD = "paper";

const MAX_TEXT = 1800;

/** Account, reference and card numbers masked: they teach nothing and they are private. */
export function maskNumbers(text: string): string {
  return text.replace(/\d[\d\s-]{6,}\d/g, (run) => (run.replace(/\D/g, "").length >= 7 ? "#######" : run));
}

const clean = (v: string): string => v.replace(/[;=|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);

/** As an event for the assistant's record. */
export function paperEvent(paper: Omit<TaughtPaper, "at">): AiEvent {
  const entry = [
    `kind=${paper.kind}`,
    `paid=${paper.paid ? 1 : 0}`,
    `amount=${paper.amount ?? ""}`,
    `flow=${clean(paper.flow)}`,
    `category=${clean(paper.category)}`,
    `item=${clean(paper.item)}`,
    `from=${clean(paper.fromWallet)}`,
    `to=${clean(paper.toWallet)}`,
    `person=${clean(paper.person)}`,
    `about=${clean(paper.description)}`,
  ].join(";");
  return aiEvent("accepted", "add", { field: PAPER_FIELD, text: maskNumbers(paper.text).slice(0, MAX_TEXT), entry: entry.slice(0, 300) });
}

/** The examples among the assistant's events, oldest first. */
export function papersFrom(events: readonly AiEvent[]): TaughtPaper[] {
  const out: TaughtPaper[] = [];
  for (const e of events) {
    if (e.field !== PAPER_FIELD || !e.text || !e.entry) continue;
    const fields = new Map(e.entry.split(";").map((pair) => {
      const at = pair.indexOf("=");
      return [pair.slice(0, at), pair.slice(at + 1)] as const;
    }));
    const kind = fields.get("kind") as PaperKind | undefined;
    if (!kind || !PAPER_KINDS.includes(kind)) continue;
    const amount = Number(fields.get("amount"));
    out.push({
      at: e.at,
      kind,
      text: e.text,
      paid: fields.get("paid") !== "0",
      amount: fields.get("amount") && Number.isFinite(amount) ? amount : null,
      flow: fields.get("flow") ?? "",
      category: fields.get("category") ?? "",
      item: fields.get("item") ?? "",
      fromWallet: fields.get("from") ?? "",
      toWallet: fields.get("to") ?? "",
      person: fields.get("person") ?? "",
      description: fields.get("about") ?? "",
    });
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

/** As training for the kind of paper: the owner's own count three times. */
export function asExamples(papers: readonly TaughtPaper[]): PaperExample[] {
  return papers.map((p) => ({ text: p.text, kind: p.kind, weight: 3 }));
}

/**
 * How alike two papers read: the words they share over the words either
 * has (each word once). The same shop's receipt, or the same company's
 * bill, shares its heading, its labels and its footer, which is most of it.
 */
export function likeness(a: string, b: string): number {
  const x = new Set(paperTokens(a).filter((t) => !t.includes(" ")));
  const y = new Set(paperTokens(b).filter((t) => !t.includes(" ")));
  if (x.size === 0 || y.size === 0) return 0;
  let both = 0;
  for (const t of x) if (y.has(t)) both += 1;
  return both / (x.size + y.size - both);
}

/** The taught paper most like this one, when one is like it enough to go by. */
export function nearestTaught(text: string, papers: readonly TaughtPaper[], least = 0.35): { readonly paper: TaughtPaper; readonly likeness: number } | null {
  let best: { paper: TaughtPaper; likeness: number } | null = null;
  // The newest of two equally alike wins: the owner's latest word on it.
  for (const paper of papers) {
    const l = likeness(text, paper.text);
    if (l >= least && (!best || l >= best.likeness)) best = { paper, likeness: l };
  }
  return best;
}

/** The example taught from a card: the paper as read, filed as the owner left it. */
export function taughtFromCard(kind: PaperKind, text: string, draft: Draft, paid: boolean): Omit<TaughtPaper, "at"> {
  return {
    kind,
    text,
    paid,
    amount: draft.amount,
    flow: draft.flow,
    category: draft.category,
    item: draft.item,
    fromWallet: draft.fromWallet,
    toWallet: draft.toWallet,
    person: draft.debtId ?? "",
    description: draft.description,
  };
}

/** What the model is shown about the nearest example, beside the reading. */
export function taughtNote(near: { readonly paper: TaughtPaper; readonly likeness: number }): string {
  const p = near.paper;
  const filed = [
    p.flow ? `flow ${p.flow}` : "",
    p.category ? `category ${p.category}` : "",
    p.item ? `item ${p.item}` : "",
    p.fromWallet ? `fromWallet ${p.fromWallet}` : "",
    p.toWallet ? `toWallet ${p.toWallet}` : "",
  ].filter(Boolean);
  const how = near.likeness >= 0.6 ? "reads very like" : "reads like";
  return [
    `This paper ${how} one the owner taught (${Math.round(near.likeness * 100)}% of the words in common): ${p.kind === "receipt" ? "a receipt" : `a ${p.kind}`}, ${p.paid ? "paid" : "not paid, so it made no entry"}${p.description ? `, "${p.description}"` : ""}.`,
    p.paid && filed.length > 0 ? `They filed it as ${filed.join(", ")}. File this one the same way unless what is printed or what they said says otherwise.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** The trained reader: the starter examples and the owner's own, and the owner's to compare against. */
export interface PaperTraining {
  readonly model: PaperModel;
  readonly taught: readonly TaughtPaper[];
}

let starter: PaperTraining | null = null;

/**
 * Trained on the starter set and what the owner taught. The starter set
 * alone is trained once; with what they taught, every time it is asked for,
 * which is a few milliseconds and once per change (the chat holds it).
 */
export function trainingFrom(taught: readonly TaughtPaper[] = []): PaperTraining {
  if (taught.length === 0) {
    starter ??= { model: trainPapers(PAPER_SEED), taught: [] };
    return starter;
  }
  return { model: trainPapers([...PAPER_SEED, ...asExamples(taught)]), taught };
}

/**
 * Pictures sent to teach rather than to add: "Training receipts. Dont add
 * this just train" (the owner, 4 October 2026), "train", "for training",
 * "don't save".
 */
export function wantsTraining(note: string): boolean {
  return /\b(?:train(?:ing)?|teach(?:ing)?|practi[cs]e|for (?:learning|training)|(?:don'?t|dont|do not|wag|huwag)\s+(?:add|save|record|i-?add|isave))\b/i.test(note);
}
