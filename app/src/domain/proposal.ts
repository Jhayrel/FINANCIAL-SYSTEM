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
  /**
   * The sentence that produced this, when there was one.
   *
   * The key a correction is learned under. Correcting a card teaches
   * something about the words that produced it, not about the field value it
   * happened to guess: keying on the guess taught "gas is Food" after one
   * correction, which would have turned every future Gas entry into Food.
   */
  readonly said?: string;
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
export function readMoney(value: unknown): ReturnType<typeof parseAmount> {
  if (typeof value === "number") return parseAmount(value);
  if (typeof value !== "string") return null;
  return parseAmount(value.trim().replace(/^php\s*/i, ""));
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Only for saying which two figures disagreed. Display, not arithmetic. */
const pesos = (centavos: number): string =>
  `PHP ${(centavos / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Exact, then case-insensitive. Never closer than that.
 *
 * "cash" should find "Cash", because that is the same word typed carelessly.
 * "Cash Card" should not find "Cash", because those are two accounts and only
 * the owner knows which one they meant.
 */
export function matchExact(candidate: string, allowed: readonly string[]): string {
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
  let flow = readFlow(rawFlow);

  /**
   * A subscription is not a transfer, whatever the model said.
   *
   * "I paid my spotify from gcash" came back as a Transfer with Spotify as
   * its item and no destination, so the card asked which wallet the money
   * landed in, refused to save without one, and could not fill the amount
   * either: `inferFromHistory` only fills a fixed cost for Bills and
   * Subscriptions, and this was neither.
   *
   * Every one of those is downstream of one wrong word. Spotify is on the
   * owner's own subscription list, and a name on that list is a thing you
   * pay, never a wallet you move money into. Their Netflix, Google Drive,
   * Microsoft Office 365, Globe at Home Wifi and Dito Prepaid are the same.
   *
   * Corrected, and said out loud, because a silent reclassification is how
   * a wrong rule survives.
   */
  const named = str(value["item"]) || str(value["description"]);
  const paidThing = [...reference.subscriptions, ...reference.bills].find(
    (name) => name.trim() !== "" && named.toLowerCase().includes(name.toLowerCase()),
  );
  if (flow === "Transfer" && paidThing) {
    flow = "Spending";
    adjustments.push(
      `${paidThing} is one of your subscriptions or bills, so this is spending rather than a transfer.`,
    );
  }

  if (!flow) {
    /**
     * A model that has understood nothing copies the shape back verbatim,
     * placeholders and all, which produced the memorable refusal `Not a kind
     * of transaction this ledger has: "Spending or Revenue or Transfer"`.
     * That is not a row with a bad field, it is no row at all, and quoting
     * this app's own prompt back at the owner explains nothing.
     */
    if (/ or /i.test(rawFlow) || !rawFlow) {
      return { sourceRef, reason: "Nothing in that looked like a transaction." };
    }
    return {
      sourceRef,
      reason: /debt|loan|credit/i.test(rawFlow)
        ? "That reads as debt. A debt row needs the credit line and whether it is a draw, a repayment, interest or a write-off, so it has to be typed into the form."
        : `That was not spending, income or a transfer, so there is nowhere to put it.`,
    };
  }

  /**
   * The amount, checked against itself.
   *
   * The model is asked for two things: the figure as a number, and the
   * characters it actually read off the picture. A model that transcribes
   * "1,234.56" and then writes 123.456 has made the one mistake that matters
   * most here, and it is invisible unless the two are compared.
   *
   * When they disagree the printed characters win, because they are closer to
   * the source than the model's arithmetic, and the row drops to low
   * confidence with both figures named so the owner can look at the picture
   * and settle it.
   */
  let amount = readMoney(value["amountPesos"]);
  const printed = readMoney(value["amountText"]);
  let confidenceCap: Confidence | null = null;

  if (printed !== null && printed > 0 && amount !== null && printed !== amount) {
    adjustments.push(
      `It typed ${pesos(amount)} but read "${str(value["amountText"])}" off the page. Using ${pesos(printed)}. Check the picture.`,
    );
    amount = printed;
    confidenceCap = "low";
  }
  if (amount === null && printed !== null) amount = printed;

  /**
   * A missing amount used to end here.
   *
   * It should not: "I paid my load today" is a real entry with one detail
   * left out, and refusing it wastes everything the model did read. It comes
   * through with a null amount instead, and `domain/capture.ts` turns that
   * into a question. The Add button stays disabled either way, because
   * `checkDraft` requires an amount over zero.
   *
   * ── Zero is the same thing said differently ─────────────────────────────
   *
   * A zero still ended here, and that threw away the case this app is best
   * at. "I paid my spotify from gcash" names no figure, so the model sends
   * back a zero, and the whole proposal was refused: item, wallet, flow and
   * date discarded along with it. The owner asked three times across two
   * sessions and wrote "it should now the amount access the database". It
   * should, and it can: there are nine Spotify rows at PHP 85.00, one a
   * month, and `inferFromHistory` fills exactly this case. It never got the
   * chance, because the refusal happened first.
   *
   * No transaction is worth zero pesos, so a zero is never a reading. It is
   * the model saying it does not know, which is what null already means.
   */
  if (amount !== null && amount <= 0) {
    amount = null;
    adjustments.push("No amount was in that, so it is filled from your own entries or left for you.");
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

  /**
   * A named subscription or bill files itself.
   *
   * The category is what unlocks the fixed-cost lookup: `inferFromHistory`
   * fills an amount from the last three payments for Bills and Subscriptions
   * and for nothing else. So reading Spotify as plain Spending leaves the
   * amount blank even though nine identical rows are sitting in the ledger.
   */
  const filed: TransactionCategory | null =
    flow === "Spending" && paidThing
      ? reference.subscriptions.includes(paidThing)
        ? "Subscriptions"
        : "Bills"
      : null;

  const category = filed ?? readCategory(flow, str(value["category"]));

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
    amount: amount ?? null,
    fee,
    notes: "",
    status,
  };

  return {
    draft,
    confidence: confidenceCap ?? readConfidence(str(value["confidence"])),
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
