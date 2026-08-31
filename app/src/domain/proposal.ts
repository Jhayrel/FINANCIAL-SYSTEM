/**
 * Turning what a model read into something the ledger will accept.
 *
 * ── The one rule ──────────────────────────────────────────────────────────
 *
 * This never invents. A wallet name that is not in the owner's list becomes
 * blank, not the closest-looking one, because a fuzzy wallet match is exactly
 * how money lands in the wrong pocket and stays there. Every departure from
 * what the model said is recorded in `adjustments`, so the card can say what
 * it changed instead of quietly changing it.
 *
 * ── What comes out ────────────────────────────────────────────────────────
 *
 * A `Draft`, the same shape the form produces. It is not a saved row and it is
 * not validated here: `checkDraft` does that, identically to a typed entry,
 * and the Add button stays disabled while it reports an error. This module's
 * only job is the translation.
 *
 * ── What is deliberately not supported ────────────────────────────────────
 *
 * Debt. A debt row needs a specific credit line and an effect (draw, repay,
 * interest, write-off), and getting either wrong misfiles borrowing as
 * spending. A receipt does not carry that, so a proposal claiming Debt is
 * refused with a reason rather than guessed at.
 */

import { parseAmount } from "./money";
import type { Draft, Flow } from "./entry";
import { itemsFor } from "./entry";
import type { IsoDate, ReferenceLists, TransactionCategory, TransactionStatus } from "./types";

export type Confidence = "high" | "medium" | "low";

export interface Proposal {
  /** Ready for `checkDraft`, exactly as a typed entry would be. */
  readonly draft: Draft;
  readonly confidence: Confidence;
  /** Which image or line this came from, so a shaky row is easy to check. */
  readonly sourceRef: string;
  /** What this module changed to make it fit, in the owner's words. */
  readonly adjustments: readonly string[];
}

export interface Refused {
  /** Enough to recognise the row in the picture. */
  readonly sourceRef: string;
  readonly reason: string;
}

export interface ProposalRead {
  readonly proposals: readonly Proposal[];
  readonly refused: readonly Refused[];
}

/** A model can be asked for many rows; a screenshot usually holds several. */
const MAX_PROPOSALS = 20;

const FLOWS: readonly Flow[] = ["Spending", "Revenue", "Transfer"];

const STATUSES: readonly TransactionStatus[] = [
  "Done",
  "Paid",
  "Transferred",
  "Withdrawn",
  "Received",
];

/** What each flow books as, when the model offers nothing usable. */
const DEFAULT_STATUS: Record<Flow, TransactionStatus> = {
  Spending: "Paid",
  Revenue: "Done",
  Transfer: "Transferred",
  Debt: "",
  Opening: "",
};

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/**
 * An amount, however the model chose to write it.
 *
 * `parseAmount` is the one place pesos become centavos and it stays exactly as
 * it is: the parity tests depend on it. It does not accept a "PHP" prefix
 * though, and a model told the currency is Philippine Pesos writes one about
 * half the time, so the word is removed here, before the boundary. Only a
 * leading currency word: nothing that could be part of a figure is touched.
 */
function readMoney(value: unknown): ReturnType<typeof parseAmount> {
  if (typeof value === "number") return parseAmount(value);
  if (typeof value !== "string") return null;
  return parseAmount(value.trim().replace(/^php\s*/i, ""));
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Exact, then case-insensitive. Never closer than that.
 *
 * "cash" should find "Cash", because that is the same word typed carelessly.
 * "Cash Card" should not find "Cash", because those are two accounts and only
 * the owner knows which one they meant.
 */
function matchExact(candidate: string, allowed: readonly string[]): string {
  const want = candidate.trim();
  if (!want) return "";
  const exact = allowed.find((a) => a === want);
  if (exact) return exact;
  const lower = want.toLowerCase();
  return allowed.find((a) => a.trim().toLowerCase() === lower) ?? "";
}

function readFlow(value: string): Flow | null {
  const lower = value.toLowerCase();
  return FLOWS.find((f) => f.toLowerCase() === lower) ?? null;
}

function readConfidence(value: string): Confidence {
  const lower = value.toLowerCase();
  // An unrecognised confidence is the weakest, never the strongest. A missing
  // field means the model did not tell us it was sure.
  return lower === "high" || lower === "medium" ? lower : "low";
}

/**
 * The category, constrained by the flow.
 *
 * Only Spending has a choice to make. Revenue and Transfer each have exactly
 * one category, so whatever the model said is discarded without comment.
 */
function readCategory(flow: Flow, given: string): TransactionCategory {
  if (flow === "Revenue") return "Revenue";
  if (flow === "Transfer") return "Transfer";
  const match = matchExact(given, ["Spending", "Bills", "Subscriptions"]);
  return (match || "Spending") as TransactionCategory;
}

function readOne(
  value: Record<string, unknown>,
  reference: ReferenceLists,
  asOf: IsoDate,
): Proposal | Refused {
  const sourceRef = str(value["sourceRef"]) || "this message";
  const adjustments: string[] = [];

  const rawFlow = str(value["flow"]);
  const flow = readFlow(rawFlow);
  if (!flow) {
    return {
      sourceRef,
      reason: /debt|loan|credit/i.test(rawFlow)
        ? "Reads as debt. A debt row needs the credit line and whether it is a draw, a repayment, interest or a write-off, so type this one into the form."
        : `Not a kind of transaction this ledger has: "${rawFlow || "none given"}".`,
    };
  }

  const amount = readMoney(value["amountPesos"]);
  if (amount === null || amount <= 0) {
    return { sourceRef, reason: "No amount could be read from this one." };
  }

  const fee = readMoney(value["feePesos"]) ?? 0;

  let date = str(value["date"]);
  if (!ISO.test(date)) {
    if (date) adjustments.push(`Could not read the date "${date}", so it is set to today.`);
    date = asOf;
  }

  // Both lists, because a transfer can land in savings and a purchase can be
  // paid from one. Which of the two it is stays the owner's business.
  const accounts = [...reference.wallets, ...reference.savings];

  const fromWallet = flow === "Revenue" ? "" : matchExact(str(value["fromWallet"]), accounts);
  if (flow !== "Revenue" && !fromWallet && str(value["fromWallet"])) {
    adjustments.push(
      `"${str(value["fromWallet"])}" is not one of your accounts, so the wallet is left for you to pick.`,
    );
  }

  const toWallet =
    flow === "Spending" ? "" : matchExact(str(value["toWallet"]), accounts);
  if (flow !== "Spending" && !toWallet && str(value["toWallet"])) {
    adjustments.push(
      `"${str(value["toWallet"])}" is not one of your accounts, so the destination is left for you to pick.`,
    );
  }

  const category = readCategory(flow, str(value["category"]));

  /**
   * An item that is not on the list is kept, not dropped.
   *
   * `checkDraft` does not require the item to be a known one, and a receipt
   * naming something new is how a new item gets added in the first place. It
   * is flagged so the owner can see it is new rather than a typo.
   */
  const rawItem = str(value["item"]);
  const known = itemsFor(flow, category, reference);
  const item = matchExact(rawItem, known) || rawItem;
  if (rawItem && !matchExact(rawItem, known)) {
    adjustments.push(`"${rawItem}" is not on your list yet.`);
  }

  const status =
    (matchExact(str(value["status"]), [...STATUSES]) as TransactionStatus) ||
    DEFAULT_STATUS[flow];

  const draft: Draft = {
    flow,
    date,
    fromWallet,
    toWallet,
    category,
    item,
    description: str(value["description"]),
    amount,
    fee,
    notes: "",
    status,
  };

  return {
    draft,
    confidence: readConfidence(str(value["confidence"])),
    sourceRef,
    adjustments,
  };
}

const isRefused = (v: Proposal | Refused): v is Refused => "reason" in v;

/**
 * Read whatever came back into proposals and refusals.
 *
 * Accepts either `{ proposals: [...] }` or a bare array, because a model asked
 * for the first will sometimes send the second and the difference is not worth
 * a retry.
 */
export function readProposals(
  value: unknown,
  reference: ReferenceLists,
  asOf: IsoDate,
): ProposalRead {
  const list = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { proposals?: unknown }).proposals)
      ? ((value as { proposals: unknown[] }).proposals)
      : [];

  const proposals: Proposal[] = [];
  const refused: Refused[] = [];

  for (const entry of list.slice(0, MAX_PROPOSALS)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const read = readOne(entry as Record<string, unknown>, reference, asOf);
    if (isRefused(read)) refused.push(read);
    else proposals.push(read);
  }

  return { proposals, refused };
}
