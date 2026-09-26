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
 * ── Debt, from a credit line's own statement ──────────────────────────────
 *
 * A receipt does not say which credit line or what a movement did, so a row
 * that merely looks like debt from a receipt still gets its debt card, where
 * both are picked. A credit line's own transaction list does say both, in so
 * many words ("Transferred money to My Wallet", "Fee applied: Service Fee",
 * "Paid amount due"), so those rows come through as debt movements with the
 * line and the effect filled in, for the owner to check on the card.
 *
 * ── Balances ──────────────────────────────────────────────────────────────
 *
 * A screenshot of an account's balance is not a transaction. It is what the
 * account really holds, which is what the investigation (`investigate.ts`)
 * compares the ledger with, so it is returned beside the rows, never as one.
 */

import { makeDebtId } from "./debt";
import { parseAmount, type Centavos } from "./money";
import type { Draft, Flow } from "./entry";
import { itemsFor } from "./entry";
import { nearestName } from "./nearly";
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

/** An account's balance, read off a screenshot. */
export interface ReadBalance {
  readonly account: string;
  readonly amount: Centavos;
  readonly date: IsoDate;
  readonly sourceRef: string;
}

export interface ProposalRead {
  readonly proposals: readonly Proposal[];
  readonly refused: readonly Refused[];
  readonly balances: readonly ReadBalance[];
}

/** A model can be asked for many rows; a screenshot usually holds several. */
// A week of a savings account's interest is fourteen lines on one screen.
const MAX_PROPOSALS = 40;

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
): Proposal | Proposal[] | Refused {
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

  /**
   * Money sent through a transfer service is a transfer, not a purchase.
   *
   * "I sent 130 via instapay from maya" came back as Spending, and the owner
   * wrote "wrong this should be transfer not spending transer to someone
   * else". They are right twice over: InstaPay and PESONet move money between
   * accounts, and this ledger cares about the difference, because a transfer
   * out books the whole amount as spending only when it left the accounts,
   * while a purchase books it always and against an item that does not exist
   * here.
   *
   * Named services only. "Sent" on its own is far too broad: paying a shop is
   * sending money to them and is an ordinary purchase.
   */
  const sentThrough = /\b(instapay|pesonet|remittance|padala|send money|money send|wire transfer)\b/i;
  if (flow === "Spending" && sentThrough.test(named)) {
    flow = "Transfer";
    adjustments.push(
      "Sent through a transfer service, so this is a transfer rather than a purchase.",
    );
  }

  if (!flow && /^debt$/i.test(rawFlow)) {
    return readDebt(value, reference, asOf, sourceRef);
  }

  // On someone's behalf: a debt movement on a person, with the side it is on.
  if (!flow && /^on ?behalf$/i.test(rawFlow)) {
    return readBehalfRow(value, reference, asOf, sourceRef);
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
    /**
     * Nearly right is worse than plainly wrong.
     *
     * "This is not on your list yet" is correct and useless when the name is
     * "Foood": it reads as an invitation to add a second item, and then every
     * food total is split between two spellings and neither is right. So when
     * it is one letter from something already on the list, the note says
     * which one and why it matters.
     */
    const near = nearestName(rawItem, known);
    adjustments.push(near ? near.note : `"${rawItem}" is not on your list yet.`);
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

const isRefused = (v: Proposal | Refused | Proposal[]): v is Refused => !Array.isArray(v) && "reason" in v;

/** On behalf, as the model names it, and what it is here. */
const BEHALF_WORDS: Readonly<Record<string, { side: "owed" | "held"; effect: NonNullable<Draft["debtEffect"]> }>> = {
  advance: { side: "owed", effect: "lend" },
  reimbursed: { side: "owed", effect: "collect" },
  writeoff: { side: "owed", effect: "writeoff" },
  "write off": { side: "owed", effect: "writeoff" },
  held: { side: "held", effect: "draw" },
  released: { side: "held", effect: "repay" },
  retained: { side: "held", effect: "writeoff" },
};

function readBehalfRow(
  value: Record<string, unknown>,
  reference: ReferenceLists,
  asOf: IsoDate,
  sourceRef: string,
): Proposal | Refused {
  const said = BEHALF_WORDS[str(value["debtEffect"]).toLowerCase()];
  const amount = readMoney(value["amountText"]) ?? readMoney(value["amountPesos"]);
  if (amount === null || amount <= 0) {
    return { sourceRef, reason: "An entry on someone's behalf with no amount in it could not be read." };
  }
  let date = str(value["date"]);
  if (!ISO.test(date)) date = asOf;
  const accounts = [...reference.wallets, ...reference.savings];
  const wallet = matchExact(str(value["fromWallet"]), accounts) || matchExact(str(value["toWallet"]), accounts);
  const person = matchExact(str(value["debt"]), [...(reference.credits ?? [])]);
  const base: Draft = {
    flow: "Debt",
    date,
    fromWallet: "",
    toWallet: "",
    category: "",
    item: "",
    description: str(value["description"]),
    amount,
    fee: 0,
    notes: "",
    status: "",
    ...(said ? { behalf: said.side } : { behalf: "owed" as const }),
    ...(person ? { debtId: makeDebtId(person) } : {}),
  };
  const withWallet: Draft = said
    ? said.effect === "lend" || said.effect === "repay"
      ? { ...base, debtEffect: said.effect, fromWallet: wallet }
      : said.effect === "writeoff"
        ? { ...base, debtEffect: said.effect }
        : { ...base, debtEffect: said.effect, toWallet: wallet }
    : base;
  return {
    draft: withWallet,
    confidence: readConfidence(str(value["confidence"])),
    sourceRef,
    adjustments: str(value["debt"]) && !person ? [`${str(value["debt"])} is not on your list yet. The card keeps the name, and adding it saves them.`] : [],
  };
}

/** What a credit statement calls each movement, and what it is here. */
const DEBT_EFFECTS: Readonly<Record<string, NonNullable<Draft["debtEffect"]> | "bought">> = {
  borrowed: "draw",
  draw: "draw",
  charge: "charge",
  fee: "charge",
  paid: "repay",
  repay: "repay",
  payment: "repay",
  waived: "writeoff",
  bought: "bought",
  purchase: "bought",
};

/**
 * A movement off a credit line's own statement.
 *
 * "Purchased via Maya Credit" is two things at once: borrowing, and spending
 * on what was bought. It comes back as both, a borrowing into the wallet the
 * statement is for and the purchase out of it, so the debt rises and the
 * spending is filed under its item, and the wallet ends where it started.
 */
function readDebt(
  value: Record<string, unknown>,
  reference: ReferenceLists,
  asOf: IsoDate,
  sourceRef: string,
): Proposal | Proposal[] | Refused {
  const adjustments: string[] = [];
  const credit = matchExact(str(value["debt"]), [...(reference.credits ?? [])]);
  if (str(value["debt"]) && !credit) {
    adjustments.push(`"${str(value["debt"])}" is not one of your credit lines, so pick which one on the card.`);
  }
  const said = DEBT_EFFECTS[str(value["debtEffect"]).toLowerCase()];
  const amount = readMoney(value["amountText"]) ?? readMoney(value["amountPesos"]);
  if (amount === null || amount <= 0) {
    return { sourceRef, reason: "A debt movement with no amount in it could not be read." };
  }

  let date = str(value["date"]);
  if (!ISO.test(date)) date = asOf;
  const accounts = [...reference.wallets, ...reference.savings];
  const wallet = matchExact(str(value["toWallet"]), accounts) || matchExact(str(value["fromWallet"]), accounts);
  const time = str(value["time"]);

  const base: Draft = {
    flow: "Debt",
    date,
    fromWallet: "",
    toWallet: "",
    category: "",
    item: credit,
    description: str(value["description"]),
    amount,
    fee: 0,
    notes: time ? `at ${time}` : "",
    status: "",
    ...(credit ? { debtId: makeDebtId(credit) } : {}),
  };
  const confidence = readConfidence(str(value["confidence"]));

  if (said === "draw") {
    return { draft: { ...base, debtEffect: "draw", toWallet: wallet, status: "Received" }, confidence, sourceRef, adjustments };
  }
  if (said === "charge") {
    return { draft: { ...base, debtEffect: "charge" }, confidence, sourceRef, adjustments };
  }
  if (said === "repay") {
    return { draft: { ...base, debtEffect: "repay", fromWallet: wallet, status: "Paid" }, confidence, sourceRef, adjustments };
  }
  if (said === "writeoff") {
    return { draft: { ...base, debtEffect: "writeoff" }, confidence, sourceRef, adjustments };
  }
  if (said === "bought") {
    const rawItem = str(value["item"]);
    const known = itemsFor("Spending", "Spending", reference);
    return [
      {
        draft: { ...base, debtEffect: "draw", toWallet: wallet, status: "Received", description: base.description || "Bought on credit" },
        confidence,
        sourceRef,
        adjustments: [...adjustments, "Bought on credit: the borrowing, and beside it the purchase it paid for."],
      },
      {
        draft: {
          flow: "Spending",
          date,
          fromWallet: wallet,
          toWallet: "",
          category: "Spending",
          item: matchExact(rawItem, known) || rawItem,
          description: str(value["description"]),
          amount,
          fee: 0,
          notes: "",
          status: "Paid",
        },
        confidence,
        sourceRef,
        adjustments: ["The purchase paid for with the borrowing beside it."],
      },
    ];
  }
  // A debt row whose effect the statement did not say: its card asks.
  return { draft: { ...base, fromWallet: wallet }, confidence: "low", sourceRef, adjustments };
}

/**
 * Fees folded into the borrowing they were charged on.
 *
 * A credit statement lists a draw and then its service fee and stamp tax as
 * separate lines at the same minute. Three cards for one borrowing is the
 * noise the owner asked to be rid of, so the charges go into the draw's
 * `charges`, where the card shows them and saves them linked. Only when it
 * is certain which draw they belong to: the same line, the same day, and the
 * same time, or the only draw that day when no time was read.
 */
export function foldCharges(proposals: readonly Proposal[]): Proposal[] {
  const out = [...proposals];
  /*
   * The time on the clock face: a model writes 07:57 PM as 19:57 on one row
   * and 07:57 on the next, and those are the same minute.
   */
  const at = (p: Proposal): string => {
    const t = /(\d{1,2}):(\d{2})/.exec(p.draft.notes);
    return t ? `${Number(t[1]) % 12}:${t[2]}` : "";
  };
  const draws = (p: Proposal) =>
    out.filter(
      (d) =>
        d.draft.flow === "Debt" &&
        d.draft.debtEffect === "draw" &&
        d.draft.debtId !== undefined &&
        d.draft.debtId === p.draft.debtId &&
        d.draft.date === p.draft.date,
    );

  for (const charge of proposals) {
    if (charge.draft.flow !== "Debt" || charge.draft.debtEffect !== "charge" || !charge.draft.debtId) continue;
    const sameDay = draws(charge);
    const timed = at(charge) ? sameDay.filter((d) => at(d) === at(charge)) : [];
    const untimed = sameDay.length === 1 && (!at(charge) || !at(sameDay[0]!)) ? sameDay[0] : undefined;
    const target = timed.length === 1 ? timed[0] : untimed;
    if (!target) continue;
    const index = out.indexOf(target);
    const added = charge.draft.amount ?? 0;
    out[index] = {
      ...target,
      draft: { ...target.draft, charges: (target.draft.charges ?? 0) + added },
      // A fee whose amount had to be put right makes the whole borrowing one to check.
      confidence: charge.confidence === "low" ? "low" : target.confidence,
      adjustments: [
        ...target.adjustments,
        `${pesos(added)} of fees${charge.draft.description ? ` (${charge.draft.description})` : ""} charged on the same borrowing, added to it.`,
        ...charge.adjustments.filter((a) => a.startsWith("Read as")),
      ],
    };
    out.splice(out.indexOf(charge), 1);
  }
  return out;
}

/**
 * A fee said with a withdrawal or a transfer is that transfer's fee.
 *
 * "I received 2000 from maya credit and I withdraw 1000 and 18 fee" came back
 * as a ₱18.00 charge on Maya Credit beside a fee-less withdrawal. Saved, it
 * would have raised what is owed to Maya Credit by ₱18.00 and left the
 * withdrawal costing nothing. A lender's own fees are named as such (service
 * fee, stamp tax, interest, penalty); a plain fee with a withdrawal or a
 * transfer in the same breath belongs to it, when there is exactly one
 * fee-less transfer that day to give it to.
 */
export function foldTransferFees(proposals: readonly Proposal[]): Proposal[] {
  let out = [...proposals];
  const LENDER_FEE = /\b(service|dst|stamp|documentary|interest|penalty|late|processing|finance charge)\b/i;
  for (const fee of proposals) {
    const d = fee.draft;
    const words = `${d.item} ${d.description}`;
    const isFee =
      d.amount !== null &&
      ((d.flow === "Debt" && (d.debtEffect === "charge" || d.debtEffect === "fee") && /\bfee\b/i.test(words) && !LENDER_FEE.test(words)) ||
        (d.flow === "Spending" && /\b(transaction|withdraw\w*|transfer|atm|cash ?out) fee\b/i.test(words)));
    if (!isFee) continue;
    const open = out.filter((t) => t.draft.flow === "Transfer" && t.draft.fee === 0 && t.draft.date === d.date);
    const target = open.length === 1 ? open[0] : undefined;
    if (!target) continue;
    const added = d.amount ?? 0;
    out = out
      .filter((t) => t !== fee)
      .map((t) =>
        t === target
          ? {
              ...t,
              draft: { ...t.draft, fee: added },
              adjustments: [...t.adjustments, `${pesos(added)} fee on this ${/withdraw/i.test(t.draft.description) || t.draft.status === "Withdrawn" ? "withdrawal" : "transfer"}, from the same message.`],
            }
          : t,
      );
  }
  return out;
}

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
  /** What the owner said, and what the device read off the pictures, for the checks after the model. */
  context: ReadContext = {},
): ProposalRead {
  const list = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { proposals?: unknown }).proposals)
      ? ((value as { proposals: unknown[] }).proposals)
      : [];

  const proposals: Proposal[] = [];
  const refused: Refused[] = [];
  const balances: ReadBalance[] = [];
  const accounts = [...reference.wallets, ...reference.savings];

  for (const entry of list.slice(0, MAX_PROPOSALS)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const value = entry as Record<string, unknown>;

    // A balance shown on screen: what the account holds, not a movement.
    if (/^balance$/i.test(str(value["flow"]))) {
      const amount = readMoney(value["amountText"]) ?? readMoney(value["amountPesos"]);
      const account = matchExact(str(value["fromWallet"]) || str(value["toWallet"]), accounts);
      const date = str(value["date"]);
      if (amount !== null && account) {
        balances.push({ account, amount, date: ISO.test(date) ? date : asOf, sourceRef: str(value["sourceRef"]) || "a screenshot" });
      }
      continue;
    }

    const read = readOne(value, reference, asOf);
    if (Array.isArray(read)) proposals.push(...read);
    else if (isRefused(read)) refused.push(read);
    else proposals.push(read);
  }

  /*
   * The system's check, after the model's reading: amounts against the
   * text the device read, then a credit line's own screen filed on that
   * line, then fees folded into what they were charged on.
   */
  const checked = checkAgainstReadings(proposals, context.readings ?? []);
  const filed = onCreditLine(checked, context.note ?? "", reference);
  return { proposals: foldTransferFees(foldCharges(filed)), refused, balances };
}

export interface ReadContext {
  readonly note?: string;
  /** The text the device read off the pictures, both readings of each. */
  readonly readings?: readonly string[];
}

/** Every amount printed with its two decimals in the readings, in centavos. */
function amountsIn(readings: readonly string[]): Set<number> {
  const found = new Set<number>();
  for (const text of readings) {
    for (const m of text.matchAll(/\d{1,3}(?:,\d{3})+\.\d{2}|\d+\.\d{2}/g)) {
      const [pesos = "0", cents = "0"] = m[0].replace(/,/g, "").split(".");
      found.add(Number(pesos) * 100 + Number(cents));
    }
  }
  return found;
}

/**
 * An amount the picture does not show, put right from what it does show.
 *
 * 26 September 2026: a Maya credit screen's "DST -₱1.23" came back as a
 * ₱123.00 charge. The point was lost in one reading, and the model trusted
 * that one. Money on these screens always has its two decimals, so an amount
 * that appears nowhere in the readings, whose digits are exactly those of one
 * that does, is that one. Only when there is exactly one such figure, and the
 * card says so and drops to low confidence, so the owner looks.
 */
export function checkAgainstReadings(proposals: readonly Proposal[], readings: readonly string[]): Proposal[] {
  if (readings.length === 0) return [...proposals];
  const shown = amountsIn(readings);
  if (shown.size === 0) return [...proposals];
  return proposals.map((p) => {
    const amount = p.draft.amount;
    if (amount === null || shown.has(amount)) return p;
    const digits = String(amount % 100 === 0 ? amount / 100 : amount);
    const matches = [...shown].filter((v) => v !== amount && String(v) === digits);
    if (matches.length !== 1) return p;
    const right = matches[0]!;
    return {
      ...p,
      draft: { ...p.draft, amount: right },
      confidence: "low",
      adjustments: [...p.adjustments, `Read as ${pesos(amount)}, but the picture shows ${pesos(right)}. Using ${pesos(right)}: check it.`],
    };
  });
}

/** A lender's own fee, by the names these screens use. */
const LENDER_FEE_WORDS = /\b(service fee|dst|documentary|stamp|interest|penalty|late fee|processing fee|finance charge|fee applied)\b/i;

/**
 * A credit line's own screen, filed on that line.
 *
 * 26 September 2026, "Maya credit" with a screenshot of Maya Credit's
 * transactions: "Transferred money to My Wallet -₱2,000.00" came back as a
 * transfer out of Maya to nowhere, and a fee with no credit line, so nothing
 * could fold and the owner got six cards and two that could not be saved.
 * On that screen the money going to "My Wallet" is borrowing into the
 * wallet, and every fee is the lender's charge on it.
 *
 * Only when the line is certain: named in what the owner said, or the only
 * line any of the rows is on.
 */
export function onCreditLine(proposals: readonly Proposal[], note: string, reference: ReferenceLists): Proposal[] {
  const credits = reference.credits ?? [];
  if (credits.length === 0) return [...proposals];
  const escape = (x: string): string => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const named = credits.filter((c) => new RegExp(`\\b${escape(c)}\\b`, "i").test(note));
  const onRows = [...new Set(proposals.filter((p) => p.draft.flow === "Debt" && p.draft.item && credits.includes(p.draft.item)).map((p) => p.draft.item))];
  const line = named.length === 1 ? named[0]! : named.length === 0 && onRows.length === 1 ? onRows[0]! : "";
  if (!line) return [...proposals];

  const accounts = [...reference.wallets, ...reference.savings];
  // "Maya Credit" lends into "Maya": the longest account named inside the line's own name.
  const home = [...accounts].sort((a, b) => b.length - a.length).find((a) => new RegExp(`\\b${escape(a)}\\b`, "i").test(line)) ?? "";
  const debtId = makeDebtId(line);
  const timeOf = (p: Proposal): string => {
    if (p.draft.notes.startsWith("at ")) return p.draft.notes;
    const t = /\b(\d{1,2}:\d{2})\b/.exec(`${p.sourceRef} ${p.draft.description}`);
    return t ? `at ${t[1]!.padStart(5, "0")}` : p.draft.notes;
  };

  return proposals.map((p) => {
    const d = p.draft;
    const words = `${d.item} ${d.description} ${p.sourceRef}`;

    if (d.flow === "Transfer" && /\bmy wallet\b|transferred money|cash ?out|borrow/i.test(words) && (!d.toWallet || d.toWallet === home || d.toWallet === d.fromWallet)) {
      const into = home || d.fromWallet;
      return {
        ...p,
        draft: { ...d, flow: "Debt", debtEffect: "draw", debtId, item: line, fromWallet: "", toWallet: into, category: "", status: "Received", fee: 0, notes: timeOf(p) },
        adjustments: [...p.adjustments, `On ${line}'s own screen, money sent to your wallet is borrowing: into ${into || "your wallet"}, owed to ${line}.`],
      };
    }

    if ((d.flow === "Spending" || (d.flow === "Debt" && !d.debtId)) && LENDER_FEE_WORDS.test(words)) {
      return {
        ...p,
        draft: { ...d, flow: "Debt", debtEffect: "charge", debtId, item: line, fromWallet: "", toWallet: "", category: "", status: "", fee: 0, notes: timeOf(p) },
        adjustments: d.flow === "Spending" ? [...p.adjustments, `A fee on ${line}'s screen is the lender's charge, added to what you owe.`] : p.adjustments,
      };
    }

    if (d.flow === "Debt" && !d.debtId) {
      const lands = d.debtEffect === "draw" && !d.toWallet && home ? { toWallet: home } : {};
      return { ...p, draft: { ...d, debtId, item: line, notes: timeOf(p), ...lands } };
    }

    /*
     * A borrowing on the line with nowhere to land: "My Wallet" is not one of
     * the owner's account names, so it read as blank and the card said "Pick
     * the wallet the money lands in" (27 September 2026). On the line's own
     * screen it is the line's wallet.
     */
    if (d.flow === "Debt" && d.debtEffect === "draw" && d.debtId === debtId && !d.toWallet && home) {
      return {
        ...p,
        draft: { ...d, toWallet: home },
        adjustments: [...p.adjustments, `"My Wallet" on ${line}'s screen is ${home}.`],
      };
    }
    return p;
  });
}
