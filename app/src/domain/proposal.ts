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

import { namesPerson } from "./behalfFor";
import { makeDebtId } from "./debt";
import { parseAmount, type Centavos } from "./money";
import type { Draft, Flow } from "./entry";
import { emptyDraft, itemsFor } from "./entry";
import { accountFor, type InterestCredit } from "./interestCredit";
import { cashWallet, type Withdrawal } from "./withdrawal";
import type { CardSlip } from "./cardSlip";
import { fitItem } from "./onList";
import { rowDatesIn } from "./ocrText";
import type { ReceiptCheck } from "./receipt";
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
  /**
   * Read from words the owner typed, not off a picture. Cards made from one
   * typed message with several entries carry no `said` of their own, and
   * were taken for a picture's: labelled "hard to make out in the picture"
   * and checked for repeats over a picture's wider window, so ₱300.00 for
   * an honorarium was "Already in your ledger" as a ₱300.00 of gas two days
   * earlier (29 September 2026).
   */
  readonly typed?: boolean;
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

  /*
   * Another currency is not pesos. A receipt in US dollars ($154.06, 21
   * September 2026) was booked as PHP 154.06, and a peso figure for it is
   * only on the owner's statement, never on the receipt. The amount is left
   * for them to give, with the foreign figure named, so the card asks.
   */
  const foreign = /(?:US\$|\$|USD|€|EUR|£|GBP|¥|JPY|SGD|S\$|AUD|A\$|CAD|HKD|₩|KRW)/i.exec(`${str(value["amountText"])} ${str(value["currency"])}`);
  if (foreign && !/₱|PHP|pesos?/i.test(str(value["amountText"]))) {
    adjustments.push(
      `The amount is in another currency (${str(value["amountText"]) || foreign[0]}). Say what it cost in pesos: the figure on your bank or wallet statement.`,
    );
    amount = null;
    confidenceCap = "low";
  }

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
  /*
   * A transfer to a place that is not one of the owner's accounts left
   * them: "to PNB (business)" on 27 September 2026, after PNB became the
   * business's bank, was asked "which one did it go into?" with a list of
   * the owner's own accounts, none of them right. Named by the model, or in
   * its description as "to <somewhere>", it is money sent to someone else.
   */
  const outsideName =
    flow === "Transfer" && !toWallet
      ? str(value["toWallet"]) || (/\bto\s+([a-z][\w .&()'-]{1,40})/i.exec(str(value["description"]))?.[1]?.trim() ?? "")
      : "";
  const leftAccounts = outsideName !== "" && !matchExact(outsideName, accounts) && !accounts.some((a) => outsideName.toLowerCase().startsWith(a.toLowerCase()));
  if (flow !== "Spending" && !toWallet && str(value["toWallet"]) && !leftAccounts) {
    adjustments.push(
      `"${str(value["toWallet"])}" is not one of your accounts, so the destination is left for you to pick.`,
    );
  } else if (leftAccounts) {
    adjustments.push(`${outsideName} is not one of your accounts, so this left them: money sent to someone else.`);
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

  /*
   * A category's name given as the item: "Subscriptions" for Microsoft 365
   * (27 September 2026), saved as a Spending item called Subscriptions. The
   * name says the category; the item is the one on that list the words
   * name, or left for the owner.
   */
  const categoryNamed = /^(bills?|subscriptions?)$/i.exec(str(value["item"]).trim());
  const byName = categoryNamed && flow === "Spending" ? (/^bill/i.test(categoryNamed[1] ?? "") ? "Bills" : "Subscriptions") : null;
  const category = filed ?? byName ?? readCategory(flow, str(value["category"]));
  if (byName) {
    const words = str(value["description"]).toLowerCase();
    const list = byName === "Bills" ? reference.bills : reference.subscriptions;
    const named = list.find((name) => name.toLowerCase().split(/\s+/).filter((w) => w.length > 2).some((w) => words.includes(w)));
    value = { ...value, item: named ?? "" };
  }
  if (/^(spending|revenue|income|transfer)$/i.test(str(value["item"]).trim())) value = { ...value, item: "" };

  /*
   * The item as the model wrote it, on the list's own spelling when it is
   * there. One that is not is put back on the list, or left for the owner,
   * once every reading is in (`fitItem` in `readProposals`).
   */
  const rawItem = str(value["item"]);
  const known = itemsFor(flow, category, reference);
  const item = matchExact(rawItem, known) || rawItem;

  const status =
    (matchExact(str(value["status"]), [...STATUSES]) as TransactionStatus) ||
    DEFAULT_STATUS[flow];

  let draft: Draft = {
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
    ...(leftAccounts ? { sentOut: true } : {}),
  };
  if (leftAccounts && !draft.description) draft = { ...draft, description: `To ${outsideName}` };

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
  /*
   * The person as the model wrote them, or as they are called: "Tita" for
   * the owner's "Tita Joan's money" (27 September 2026), which matched
   * nothing and would have made a second entry for the same aunt.
   */
  const person =
    matchExact(str(value["debt"]), [...(reference.credits ?? [])]) ||
    (str(value["debt"]) ? ((reference.onBehalf ?? []).find((p) => namesPerson(str(value["debt"]), p.name))?.name ?? "") : "");
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
  // A fee the owner paid to send it: theirs, on the row that moved the money out.
  const sendFee = readMoney(value["feePesos"]) ?? 0;
  const withWallet: Draft = said
    ? said.effect === "lend" || said.effect === "repay"
      ? { ...base, debtEffect: said.effect, fromWallet: wallet, fee: sendFee > 0 ? sendFee : 0 }
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
    // The fee the sending app charged, paid on top from the same wallet: the owner's transfer fee, not interest.
    const sendFee = readMoney(value["feePesos"]) ?? 0;
    return {
      draft: { ...base, debtEffect: "repay", fromWallet: wallet, status: "Paid", fee: sendFee > 0 ? sendFee : 0 },
      confidence,
      sourceRef,
      adjustments,
    };
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
    // A transfer, or money sent for a debt or for someone: each can carry the fee it cost to send.
    const sends = (x: Draft): boolean =>
      x.flow === "Transfer" || (x.flow === "Debt" && (x.debtEffect === "repay" || x.debtEffect === "lend"));
    const open = out.filter((t) => t !== fee && sends(t.draft) && t.draft.fee === 0 && t.draft.date === d.date);
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
              adjustments: [
                ...t.adjustments,
                `${pesos(added)} fee on this ${
                  t.draft.flow === "Debt" ? "payment" : /withdraw/i.test(t.draft.description) || t.draft.status === "Withdrawn" ? "withdrawal" : "transfer"
                }, from the same message.`,
              ],
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
  const checked = checkCardSlips(checkWithdrawal(checkInterest(
    checkReceipts(
      datesFromHeadings(checkAgainstReadings(proposals, context.readings ?? []), context.readings ?? [], context.readingDays ?? [], asOf),
      context.receipts ?? [],
      reference.wallets,
      asOf,
    ),
    context.interest ?? [],
    reference,
    asOf,
  ), context.withdrawals ?? [], reference, asOf), context.cardSlips ?? [], reference, asOf);
  const filed = onCreditLine(checked, context.note ?? "", reference);
  const folded = pairBorrowings(foldTransferFees(foldCharges(notIncomeKinds(filed, reference))));
  return { proposals: onTheirLists(folded, context.note ?? "", reference), refused, balances };
}

/**
 * Every item put back on the owner's lists, or left for them (`onList.ts`).
 *
 * The owner's words count only when the message made one card: "lunch 100
 * and travel 50" names Travel, and that is the fare's kind, not the lunch's.
 */
function onTheirLists(proposals: readonly Proposal[], note: string, reference: ReferenceLists): Proposal[] {
  const kinds = proposals.filter((p) => p.draft.flow === "Spending" || p.draft.flow === "Revenue").length;
  const said = kinds === 1 ? note : "";
  return proposals.map((p) => {
    const fitted = fitItem(p.draft, said, reference);
    if (!fitted.note) return fitted.draft === p.draft ? p : { ...p, draft: fitted.draft };
    return { ...p, draft: fitted.draft, adjustments: [...p.adjustments, fitted.note] };
  });
}

/**
 * A credit line or a person's name is never a kind of income.
 *
 * 27 September 2026: a mother's ₱40,000 came back as Revenue with the item
 * "Maya Credit". Borrowed money is not income and the mother is not a line
 * of credit; the item is cleared so the card asks what it was.
 */
function notIncomeKinds(proposals: readonly Proposal[], reference: ReferenceLists): Proposal[] {
  const names = new Set((reference.credits ?? []).map((c) => c.trim().toLowerCase()));
  return proposals.map((p) =>
    p.draft.flow === "Revenue" && names.has(p.draft.item.trim().toLowerCase())
      ? {
          ...p,
          draft: { ...p.draft, item: "" },
          confidence: "low",
          adjustments: [...p.adjustments, `${p.draft.item} is a credit line or a person, not a kind of income, so say what this was.`],
        }
      : p,
  );
}

/**
 * An interest credit's card, held to the credit's own arithmetic.
 *
 * The model is told what the figures are (`interestCredit.ts`), and this
 * makes sure: the rows it made from the earned figure, the tax or the net
 * become one Revenue of the net, item Bank interest, into the savings
 * account the screen named. Each change is said on the card.
 */
export function checkInterest(
  proposals: readonly Proposal[],
  credits: readonly InterestCredit[],
  reference: ReferenceLists,
  asOf: IsoDate,
): Proposal[] {
  let out = [...proposals];
  for (const c of credits) {
    const printed = new Set([c.net, c.gross, c.tax].filter((x): x is Centavos => x !== undefined));
    const related = out.filter((p) => p.draft.amount !== null && printed.has(p.draft.amount) && p.draft.flow !== "Transfer" && p.draft.flow !== "Debt");
    const base = related.find((p) => p.draft.flow === "Revenue" && p.draft.amount === c.net) ?? related.find((p) => p.draft.flow === "Revenue") ?? related[0];
    const item = base && /interest/i.test(base.draft.item) ? base.draft.item : reference.revenueCategories.find((n) => /interest/i.test(n)) ?? base?.draft.item ?? "";
    const into = accountFor(c, reference.savings);
    const notes: string[] = [];
    if (base && base.draft.amount !== c.net) notes.push(`Read as ${pesos(base.draft.amount ?? 0)}; what arrived is ${pesos(c.net)} (${c.evidence.join("; ")}).`);
    const folded = related.filter((p) => p !== base);
    if (folded.length > 0) notes.push(`Left out ${folded.map((p) => pesos(p.draft.amount ?? 0)).join(" and ")}: the interest before tax and the tax are parts of this one credit.`);
    if (into && base?.draft.toWallet !== into) notes.push(`Into ${into}, the account the screen calls "${c.account || "savings"}".`);
    if (!base) notes.push(`Read on this device: ${c.evidence.join("; ")}.`);
    const start = base?.draft ?? emptyDraft(c.date ?? asOf);
    const kept: Proposal = {
      ...(base ?? { sourceRef: "the interest screen", confidence: "medium" as const }),
      draft: {
        ...start,
        flow: "Revenue",
        category: "Revenue",
        item,
        amount: c.net,
        fromWallet: "",
        toWallet: into || start.toWallet,
        date: c.date ?? start.date,
        description: start.description.trim() || `Interest from ${c.bank ?? "the bank"}${c.tax ? `, after ${pesos(c.tax)} tax` : ""}`,
      },
      confidence: c.confidence === "high" ? (base?.confidence ?? "high") : "medium",
      adjustments: [...(base?.adjustments ?? []), ...notes],
    };
    const at = base ? out.indexOf(base) : out.length;
    out = out.filter((p) => !related.includes(p));
    out.splice(Math.min(at, out.length), 0, kept);
  }
  return out;
}

/**
 * An ATM slip's card, held to the slip's own figures (`withdrawal.ts`).
 *
 * The model is told what the figures are, and this makes sure: whatever it
 * made of the amount, the fee, what left the account or the balance after
 * becomes one Transfer into the cash wallet, the cash as the amount and the
 * ATM's charge as the fee. A Debt made of "Visa Credit" is put right the
 * same way. Which account it came out of is the ledger's to say, after this
 * (`withdrawalSource`); the model's choice is kept only when it is one of
 * the owner's accounts.
 */
export function checkWithdrawal(
  proposals: readonly Proposal[],
  slips: readonly Withdrawal[],
  reference: ReferenceLists,
  asOf: IsoDate,
): Proposal[] {
  let out = [...proposals];
  const cash = cashWallet(reference.wallets);
  const accounts = new Set([...reference.wallets, ...reference.savings]);
  for (const w of slips) {
    const printed = new Set([w.cash, w.printed, w.debit, w.fee, ...(w.balanceAfter !== undefined ? [w.balanceAfter] : [])].filter((x) => x > 0));
    const related = out.filter((p) => p.draft.amount !== null && printed.has(p.draft.amount));
    const base =
      related.find((p) => p.draft.flow === "Transfer" && p.draft.amount === w.cash) ??
      related.find((p) => p.draft.amount === w.cash || p.draft.amount === w.printed || p.draft.amount === w.debit);
    const notes: string[] = [];
    if (!base || base.draft.flow !== "Transfer") notes.push(`A cash withdrawal is money moved into ${cash || "your cash"}, so it is a transfer${base?.draft.flow === "Debt" ? ", not borrowing: the card's label is not a credit line" : ""}.`);
    if (base && base.draft.amount !== w.cash) notes.push(`Read as ${pesos(base.draft.amount ?? 0)}; ${w.evidence.join("; ")}.`);
    const folded = related.filter((p) => p !== base);
    const feeRow = w.fee > 0 && folded.some((p) => p.draft.amount === w.fee);
    const others = folded.filter((p) => !(w.fee > 0 && p.draft.amount === w.fee));
    if (feeRow) notes.push(`The ${pesos(w.fee)} row is this withdrawal's ATM fee, so it is the card's fee now: the only part that is spending.`);
    else if (w.fee > 0 && base?.draft.fee !== w.fee) notes.push(`The ${pesos(w.fee)} ATM fee is the card's fee: the only part that is spending.`);
    if (others.length > 0) notes.push(`Left out ${others.map((p) => pesos(p.draft.amount ?? 0)).join(" and ")}: ${others.some((p) => p.draft.amount === w.balanceAfter) ? "the balance after it is not a movement" : "it is this same withdrawal"}.`);
    if (!base) notes.push(`Read on this device: ${w.evidence.join("; ")}.`);
    const from = base && accounts.has(base.draft.fromWallet) && base.draft.fromWallet !== cash ? base.draft.fromWallet : "";
    const start = emptyDraft(w.date ?? base?.draft.date ?? asOf);
    const kept: Proposal = {
      ...(base ?? { sourceRef: "the ATM slip", confidence: "medium" as const }),
      draft: {
        ...start,
        flow: "Transfer",
        category: "Transfer",
        amount: w.cash,
        fee: w.fee,
        fromWallet: from,
        toWallet: cash,
        date: w.date ?? base?.draft.date ?? asOf,
        description: `Withdrawal from ${w.place || w.bank || "an ATM"}`,
        notes: w.time ?? base?.draft.notes ?? "",
        status: base?.draft.status ?? start.status,
      },
      confidence: w.confidence === "high" ? (base?.confidence === "low" ? "medium" : base?.confidence ?? "high") : "medium",
      adjustments: [...(base?.adjustments ?? []), ...notes],
    };
    const at = base ? out.indexOf(base) : out.length;
    out = out.filter((p) => !related.includes(p));
    out.splice(Math.min(at, out.length), 0, kept);
  }
  return out;
}

/**
 * A card slip's payment, held to the slip (`cardSlip.ts`).
 *
 * One payment is one entry. The model may make a card of the slip and
 * another of the shop's receipt for the same ₱2,082.00, or read "Visa
 * Credit" as borrowing and make the purchase twice, a draw beside it. So
 * the cards for the slip's amount become one Spending: the one that names
 * what was bought, dated by the slip, and every borrowing made of the same
 * figure is dropped. Which account paid is filled after this, from where
 * the owner's card payments come from.
 */
export function checkCardSlips(
  proposals: readonly Proposal[],
  slips: readonly CardSlip[],
  reference: ReferenceLists,
  asOf: IsoDate,
): Proposal[] {
  let out = [...proposals];
  for (const slip of slips) {
    if (slip.kind !== "sale") continue;
    const related = out.filter((p) => p.draft.amount === slip.amount);
    const borrowed = related.filter((p) => p.draft.flow === "Debt");
    const spent = related.filter((p) => p.draft.flow === "Spending");
    const others = related.filter((p) => p.draft.flow !== "Debt" && p.draft.flow !== "Spending");
    const notes: string[] = [];
    if (borrowed.length > 0) notes.push(`A card payment, not borrowing: "Credit Card" and "Visa Credit" on a terminal's slip are printed for nearly every card.`);
    if (spent.length > 1) notes.push(`The card slip and the receipt are the same ${pesos(slip.amount)} payment${slip.approval ? ` (approval code ${slip.approval})` : ""}, so one entry.`);
    const base =
      [...spent].sort((a, b) => Number(Boolean(b.draft.item)) - Number(Boolean(a.draft.item)) || b.draft.description.length - a.draft.description.length)[0] ??
      others[0];
    const start = base?.draft ?? emptyDraft(slip.date ?? asOf);
    const accounts = new Set([...reference.wallets, ...reference.savings]);
    const kept: Proposal = {
      ...(base ?? { sourceRef: "the card slip", confidence: "medium" as const }),
      draft: {
        ...emptyDraft(slip.date ?? start.date ?? asOf),
        flow: "Spending",
        category: start.flow === "Spending" && start.category ? start.category : "Spending",
        item: start.flow === "Spending" ? start.item : "",
        description: start.description.trim() || (slip.merchant ? `Card payment at ${slip.merchant}` : "Card payment"),
        amount: slip.amount,
        fee: 0,
        fromWallet: accounts.has(start.fromWallet) ? start.fromWallet : "",
        date: slip.date ?? start.date ?? asOf,
        notes: slip.time ?? start.notes ?? "",
        status: "Paid",
      },
      confidence: base?.confidence ?? "medium",
      // Run again across requests, so a note already said is not said twice.
      adjustments: [...new Set([...(base?.adjustments ?? []), ...notes, ...(base ? [] : [`Read on this device from the card slip${slip.merchant ? ` at ${slip.merchant}` : ""}.`])])],
    };
    const at = base ? out.indexOf(base) : out.length;
    const drop = new Set([...borrowed, ...spent, ...(base && others.includes(base) ? [base] : [])]);
    // The purchase a "bought on credit" reading paired with its borrowing is the same money again.
    out = out.filter((p) => !drop.has(p));
    out.splice(Math.min(at, out.length), 0, kept);
  }
  return out;
}

export interface ReadContext {
  readonly note?: string;
  /** Card terminal slips in those pictures (`domain/cardSlip.ts`). */
  readonly cardSlips?: readonly CardSlip[];
  /** ATM withdrawal slips in those pictures, checked by their own figures (`domain/withdrawal.ts`). */
  readonly withdrawals?: readonly Withdrawal[];
  /** Interest credits in those pictures, checked by their arithmetic (`domain/interestCredit.ts`). */
  readonly interest?: readonly InterestCredit[];
  /** The text the device read off the pictures, both readings of each. */
  readonly readings?: readonly string[];
  /** Receipts in those pictures, checked by their arithmetic (`domain/receipt.ts`). */
  readonly receipts?: readonly ReceiptCheck[];
  /** The day each reading's picture was taken, in the same order as `readings`. */
  readonly readingDays?: readonly string[];
}

/**
 * A receipt's card, held to the receipt's own arithmetic.
 *
 * The model is told the total the device worked out (`receiptNote`), and
 * this is the check that it listened. 28 September 2026: a receipt for
 * 109.00 paid with 200.00 in cash. The figures a model lands on instead are
 * always the same few: the cash handed over, the change, or the VATable
 * sales and the VAT as two rows. Each is one the receipt printed as
 * something other than what was spent, so a card showing one of them is
 * moved to the total, and says so. A card already on the total is left as
 * the model read it; only the tax parts and the cash beside it go.
 *
 * Only a receipt whose checks agreed (confidence medium or high) moves a
 * card, and only when the card's figure is one that receipt printed.
 */
export function checkReceipts(
  proposals: readonly Proposal[],
  receipts: readonly ReceiptCheck[],
  wallets: readonly string[],
  asOf: IsoDate,
): Proposal[] {
  let out = [...proposals];
  for (const r of receipts) {
    if (r.confidence === "low") continue;
    const wrong = new Set(r.notTheTotal);
    const paidFor = (p: Proposal): boolean => p.draft.flow !== "Revenue" && p.draft.flow !== "Transfer";
    const why = (amount: Centavos): string =>
      amount === r.tendered
        ? "the money handed over"
        : amount === r.change
          ? "the change"
          : amount === r.vat
            ? "the VAT"
            : amount === r.vatable
              ? "the VATable sales"
              : "a part of the total";

    let kept = out.find((p) => paidFor(p) && p.draft.amount === r.total);
    if (!kept) {
      const off = out.filter((p) => paidFor(p) && p.draft.amount !== null && wrong.has(p.draft.amount));
      const first = off[0];
      if (!first || first.draft.amount === null) continue;
      const moved: Proposal = {
        ...first,
        draft: { ...first.draft, amount: r.total },
        confidence: first.confidence === "high" ? "medium" : first.confidence,
        adjustments: [
          ...first.adjustments,
          `Read as ${pesos(first.draft.amount)}, which is ${why(first.draft.amount)}. The receipt's total is ${pesos(r.total)} (${r.evidence.join("; ")}), so that is used.`,
        ],
      };
      out = out.map((p) => (p === first ? moved : p));
      kept = moved;
    }

    // The rest of the same receipt's printed parts, on the same day, are the total again in pieces.
    const day = kept.draft.date;
    const parts = out.filter(
      (p) => p !== kept && paidFor(p) && p.draft.date === day && p.draft.amount !== null && wrong.has(p.draft.amount),
    );
    let fixed: Proposal = parts.length === 0 ? kept : {
      ...kept,
      adjustments: [
        ...kept.adjustments,
        ...parts.map((p) => `Left out ${pesos(p.draft.amount ?? 0)}, ${why(p.draft.amount ?? 0)}: it is part of this receipt, not a second purchase.`),
      ],
    };

    // How it was paid, and when, as printed, where the model left them open.
    const wallet = r.paidWith && r.paidWith !== "card" ? wallets.find((w) => w.trim().toLowerCase() === r.paidWith) ?? "" : "";
    if (wallet && !fixed.draft.fromWallet && fixed.draft.flow !== "Debt") {
      fixed = { ...fixed, draft: { ...fixed.draft, fromWallet: wallet }, adjustments: [...fixed.adjustments, `Paid from ${wallet}, as the receipt shows.`] };
    }
    if (r.date && !r.dateAmbiguous && fixed.draft.date === asOf && r.date !== asOf) {
      fixed = { ...fixed, draft: { ...fixed.draft, date: r.date }, adjustments: [...fixed.adjustments, `Dated ${r.date}, as printed on the receipt.`] };
    }

    const gone = new Set(parts);
    const before = kept;
    out = out.filter((p) => !gone.has(p)).map((p) => (p === before ? fixed : p));
  }
  return out;
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

/**
 * A history list's rows, dated by the heading above each one (`rowDatesIn`).
 *
 * The model is shown the headings and still dated each group by the heading
 * below it (28 September 2026). The device reads the same text in order, so
 * a row's figure finds its heading without any judgment. Applied only where
 * both readings of a picture agree on the day, and only to a day that is not
 * after today; the card says what changed.
 */
export function datesFromHeadings(
  proposals: readonly Proposal[],
  readings: readonly string[],
  days: readonly string[],
  asOf: IsoDate,
): Proposal[] {
  if (readings.length === 0) return [...proposals];
  // Every figure's days, in order, from each reading; a picture's two readings must agree.
  const perReading = readings.map((text, i) => rowDatesIn(text, days[i] || asOf));
  const byAmount = new Map<number, string[]>();
  const disputed = new Set<number>();
  for (let i = 0; i < perReading.length; i += 2) {
    const a = perReading[i] ?? [];
    const b = perReading[i + 1] ?? [];
    const fuller = b.filter((r) => r.date).length > a.filter((r) => r.date).length ? b : a;
    const other = fuller === a ? b : a;
    for (const row of fuller) {
      if (!row.date) continue;
      const same = other.filter((r) => r.amount === row.amount);
      const elsewhere = same.filter((r) => r.date);
      /*
       * Only a disagreement when the other reading has no undated row of that
       * figure left to be this one: one reading lost "Today", the other read
       * "36 mins ago", and the two ₱100.00 rows (today's and yesterday's)
       * were called a dispute and neither was dated (3 October 2026).
       */
      if (elsewhere.length > 0 && elsewhere.length === same.length && !elsewhere.some((r) => r.date === row.date)) disputed.add(row.amount);
      byAmount.set(row.amount, [...(byAmount.get(row.amount) ?? []), row.date]);
    }
  }
  const used = new Map<number, number>();
  return proposals.map((p) => {
    const amount = p.draft.amount;
    if (amount === null || disputed.has(amount)) return p;
    // The same figure under several headings is taken in order, one row each.
    const dates = byAmount.get(amount) ?? byAmount.get(amount + p.draft.fee) ?? [];
    const key = byAmount.has(amount) ? amount : amount + p.draft.fee;
    const k = used.get(key) ?? 0;
    const date = dates[k];
    used.set(key, k + 1);
    if (!date || date === p.draft.date || date > asOf) return p;
    return {
      ...p,
      draft: { ...p.draft, date },
      adjustments: [...p.adjustments, `Dated ${date} by the heading above it in the picture; it was read as ${p.draft.date}.`],
    };
  });
}

/**
 * One borrowing, seen from both ends.
 *
 * 27 September 2026: the owner sent Maya Credit's screen and Maya's own
 * history together. Each PHP 2,000.00 borrowing is on both: "Transferred
 * money to My Wallet" on the credit line, "Received money from Maya Credit"
 * in the wallet. The first became the borrowing; the second, its name not
 * legible, became PHP 2,000.00 of income ("Reimbursed from work", "Cash
 * back"). The money arrived once. Money in to the wallet a draw lands in,
 * for the draw's amount, within a day of it, is that draw, and only the
 * draw is kept. One draw takes one such row, the nearest in date.
 */
export function pairBorrowings(proposals: readonly Proposal[]): Proposal[] {
  const out = [...proposals];
  const days = (a: string, b: string): number => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
  for (const draw of proposals) {
    const d = draw.draft;
    if (d.flow !== "Debt" || d.debtEffect !== "draw" || d.amount === null || !d.toWallet) continue;
    const twins = out
      .filter((p) => {
        const t = p.draft;
        const intoSame = t.toWallet === d.toWallet;
        const moneyIn = t.flow === "Revenue" || (t.flow === "Transfer" && !t.fromWallet);
        return p !== draw && moneyIn && intoSame && t.amount === d.amount && days(t.date, d.date) <= 1;
      })
      .sort((a, b) => days(a.draft.date, d.date) - days(b.draft.date, d.date));
    const twin = twins[0];
    if (!twin) continue;
    out.splice(out.indexOf(twin), 1);
    const at = out.indexOf(draw);
    out[at] = {
      ...draw,
      adjustments: [
        ...draw.adjustments,
        `Also in ${d.toWallet}'s own history as money received (${twin.draft.description || "no name read"}): the same ${pesos(d.amount)}, booked once, as borrowing.`,
      ],
    };
  }
  return out;
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
