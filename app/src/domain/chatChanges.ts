/**
 * Changing saved entries from the chat.
 *
 * The owner, 2026-09-17: the assistant should be able to add, move, delete,
 * edit and change things everywhere in the app except Settings. Adding,
 * binning and restoring already worked. This is editing and moving:
 *
 *   "change the treat yesterday to 1200"            the amount
 *   "move my spotify from gcash to maya"            the wallet
 *   "move all grab rides this month to cash"        the wallet, on every one
 *   "change the date of #0440 to aug 27"            the date
 *   "change the unknown on aug 28 to food"          the item
 *
 * Nothing is changed here. This finds the rows, works out what each would
 * become, checks the result the way the form checks a correction, and hands
 * back a before and an after for the owner to apply or throw away.
 */

import { partOf } from "./debt";
import { checkDraft, debtWalletDirection, transactionToDraft } from "./entry";
import type { Debt } from "./debt";
import { formatMoney, type Centavos } from "./money";
import { findRows } from "./recall";
import type { IsoDate, ReferenceLists, Transaction, TransactionCategory } from "./types";

export interface EntryChange {
  readonly amount?: Centavos | undefined;
  /** A wallet swapped: `from` limits it to the side that held that wallet. */
  readonly wallet?: { readonly from?: string | undefined; readonly to: string } | undefined;
  readonly date?: IsoDate | undefined;
  readonly item?: string | undefined;
}

export interface EditAsk {
  /** What the rows are, in the owner's words, with the change taken out. */
  readonly target: string;
  /** "all", "every": every matching row rather than the one meant. */
  readonly all: boolean;
  readonly change: EntryChange;
}

export interface ChangedRow {
  readonly before: Transaction;
  readonly after: Transaction;
}

export interface EditPlan {
  readonly rows: readonly ChangedRow[];
  /** Rows that matched but could not take the change, and why. */
  readonly refused: readonly { readonly row: Transaction; readonly reason: string }[];
}

const VERB = /\b(change|edit|update|correct|fix|move|switch|set|make|palitan|baguhin|ilipat|itama)\b/i;
const EXISTING =
  /(#\s*\d{1,5}|\b(entry|entries|record|row|rows|transaction|transactions|payment|payments|all|every|last|latest|yesterday|today|the \w+ on|my \w+ (payment|bill|subscription))\b)/i;

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function dayWord(text: string, asOf: IsoDate): { day: IsoDate; match: string } | null {
  const iso = /\b(20\d{2}-\d{2}-\d{2})\b/.exec(text);
  if (iso?.[1]) return { day: iso[1], match: iso[0] };
  const named = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})\b/i.exec(text);
  if (named?.[1] && named[2]) {
    const month = MONTHS.indexOf(named[1].slice(0, 3).toLowerCase()) + 1;
    return { day: `${asOf.slice(0, 4)}-${String(month).padStart(2, "0")}-${named[2].padStart(2, "0")}`, match: named[0] };
  }
  const shift = (days: number): IsoDate => {
    const at = new Date(`${asOf}T00:00:00Z`);
    at.setUTCDate(at.getUTCDate() + days);
    return at.toISOString().slice(0, 10);
  };
  if (/\byesterday\b/i.test(text)) return { day: shift(-1), match: "yesterday" };
  if (/\btoday\b/i.test(text)) return { day: asOf, match: "today" };
  return null;
}

const money = (raw: string): Centavos | null => {
  const [pesos = "", cents = ""] = raw.replace(/[₱,\s]/g, "").replace(/^php/i, "").split(".");
  if (!/^\d+$/.test(pesos)) return null;
  return Number(pesos) * 100 + Number((cents + "00").slice(0, 2));
};

function nameIn(text: string, names: readonly string[]): string {
  const flat = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  for (const name of [...names].sort((a, b) => b.length - a.length)) {
    const needle = name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (needle && flat.includes(` ${needle} `)) return name;
  }
  return "";
}

/**
 * Read a request to change saved entries, or return null.
 *
 * A sentence that describes new money moving is not an edit: "move 500 from
 * gcash to maya" is a transfer to record, and it names a figure and two
 * wallets and nothing already saved. An edit names something already there:
 * a record number, "all", "last", "yesterday", "the grab ride on aug 3".
 */
export function readEditAsk(text: string, reference: ReferenceLists, asOf: IsoDate): EditAsk | null {
  if (!VERB.test(text)) return null;
  const accounts = [...reference.wallets, ...reference.savings];
  const items = [...reference.spendingTypes.map((t) => t.name), ...reference.bills, ...reference.subscriptions, ...reference.revenueCategories];

  let rest = ` ${text} `;
  const change: { -readonly [K in keyof EntryChange]: EntryChange[K] } = {};

  // A wallet: "from gcash to maya", or "to maya" after move or switch.
  const fromTo = new RegExp(String.raw`\bfrom\s+(.+?)\s+(?:to|into|in)\s+(.+?)(?=$|[,.]|\s+(?:instead|and|on|for|this|last)\b)`, "i").exec(rest);
  if (fromTo?.[1] && fromTo[2]) {
    const from = nameIn(fromTo[1], accounts);
    const to = nameIn(fromTo[2], accounts);
    if (to) {
      change.wallet = { from: from || undefined, to };
      rest = rest.replace(fromTo[0], " ");
    }
  }
  if (!change.wallet && /\b(move|switch|ilipat)\b/i.test(text)) {
    const onto = new RegExp(String.raw`\b(?:to|into|sa)\s+(.+?)(?=$|[,.]|\s+(?:instead|and|on|for|this|last)\b)`, "i").exec(rest);
    const to = onto?.[1] ? nameIn(onto[1], accounts) : "";
    if (onto && to) {
      change.wallet = { to };
      rest = rest.replace(onto[0], " ");
    }
  }

  // A date: "the date ... to aug 27", "to yesterday".
  const dateTo = /\b(?:date\b.*?\bto|\bto)\s+((?:20\d{2}-\d{2}-\d{2})|(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2})|yesterday|today)\b/i.exec(rest);
  if (dateTo?.[1] && /\bdate\b/i.test(text)) {
    const day = dayWord(dateTo[1], asOf);
    if (day) {
      change.date = day.day;
      rest = rest.replace(dateTo[0], " ");
    }
  }

  // An amount: "to 1,200", "should be 1200", "make it 1200", "1200 instead".
  const amountTo =
    /\b(?:to|should be|make it|it was|was actually|instead of \S+ it'?s|amount to)\s+((?:₱|php\s*)?\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|(?:₱|php\s*)?\d+(?:\.\d{1,2})?)\b/i.exec(rest) ??
    /\b((?:₱|php\s*)?\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|(?:₱|php\s*)?\d+(?:\.\d{1,2})?)\s+instead\b/i.exec(rest);
  if (amountTo?.[1]) {
    const value = money(amountTo[1]);
    if (value !== null && value > 0) {
      change.amount = value;
      rest = rest.replace(amountTo[0], " ");
    }
  }

  // An item: "to food", a name from their own lists.
  if (!change.wallet && change.amount === undefined && !change.date) {
    const itemTo = /\b(?:to|as|into)\s+(.+?)(?=$|[,.])/i.exec(rest);
    const item = itemTo?.[1] ? nameIn(itemTo[1], items) : "";
    if (itemTo && item) {
      change.item = item;
      rest = rest.replace(itemTo[0], " ");
    }
  }

  if (!change.wallet && change.amount === undefined && !change.date && !change.item) return null;

  const target = rest
    .replace(VERB, " ")
    .replace(/\b(the|my|please|entry|entries|record|row|rows|transaction|transactions|wallet|amount|date|of|it|all|every|them|those|that|this one)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  // "move 500 from gcash to maya" names new money, not a saved entry.
  if (change.wallet && !EXISTING.test(text) && /\d/.test(target) && !/#/.test(target)) return null;

  return { target, all: /\b(all|every|each)\b/i.test(text), change };
}

/** Which side of a row a wallet sits on, for the flow it is. */
function walletSide(row: Transaction, from: string | undefined): "fromWallet" | "toWallet" | null {
  if (from) {
    if (row.fromWallet === from) return "fromWallet";
    if (row.toWallet === from) return "toWallet";
    return null;
  }
  if (row.type === "Revenue") return "toWallet";
  if (row.type === "Debt") return debtWalletDirection(row.debtEffect) === "in" ? "toWallet" : row.fromWallet ? "fromWallet" : null;
  return "fromWallet";
}

/** One row with the change applied, or why it cannot take it. */
export function changeRow(
  row: Transaction,
  change: EntryChange,
  transactions: readonly Transaction[],
  reference: ReferenceLists,
  debts: readonly Debt[],
): Transaction | { readonly reason: string } {
  let after: Transaction = row;

  if (change.amount !== undefined) {
    if (partOf(row, transactions)) {
      return { reason: "It was saved with its interest or fees linked, so change its amount in the form, where both parts show." };
    }
    after = { ...after, amount: change.amount, total: change.amount + after.fee };
  }
  if (change.wallet) {
    const side = walletSide(row, change.wallet.from);
    if (!side) return { reason: `It does not move money through ${change.wallet.from ?? "a wallet"}.` };
    after = { ...after, [side]: change.wallet.to };
  }
  if (change.date) after = { ...after, date: change.date };
  if (change.item) {
    if (row.type !== "Spending" && row.type !== "Revenue") return { reason: "Only spending and income carry an item." };
    const category: TransactionCategory =
      row.type === "Revenue"
        ? "Revenue"
        : reference.bills.includes(change.item)
          ? "Bills"
          : reference.subscriptions.includes(change.item)
            ? "Subscriptions"
            : "Spending";
    after = { ...after, item: change.item, category };
  }

  if (
    after.amount === row.amount &&
    after.fromWallet === row.fromWallet &&
    after.toWallet === row.toWallet &&
    after.date === row.date &&
    after.item === row.item
  ) {
    return { reason: "It already reads that way." };
  }

  // Checked the way the form checks a correction.
  const others = transactions.filter((t) => t.id !== row.id);
  const check = checkDraft(transactionToDraft(after), others, reference, debts, after.date);
  if (!check.ok) return { reason: check.errors.map((e) => e.message).join(" ") };
  return after;
}

/** The rows a request means, with each one's change worked out. */
export function planEdit(
  ask: EditAsk,
  transactions: readonly Transaction[],
  reference: ReferenceLists,
  debts: readonly Debt[],
  asOf: IsoDate,
): EditPlan {
  let pool: readonly Transaction[] = transactions;
  // "this month", "last month": a window, not a word to match.
  const month = /\b(this|last)\s+month\b/i.exec(ask.target);
  let phrase = ask.target;
  if (month?.[1]) {
    const at = new Date(`${asOf.slice(0, 7)}-01T00:00:00Z`);
    if (month[1].toLowerCase() === "last") at.setUTCMonth(at.getUTCMonth() - 1);
    const key = at.toISOString().slice(0, 7);
    pool = transactions.filter((t) => t.date.startsWith(key));
    phrase = phrase.replace(month[0], " ");
  }
  if (ask.change.wallet?.from) pool = pool.filter((t) => t.fromWallet === ask.change.wallet?.from || t.toWallet === ask.change.wallet?.from);
  // "on aug 28" as a date the finder reads, rather than the words "aug" and "28".
  const named = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b/i.exec(phrase);
  if (named) {
    const day = dayWord(named[0], asOf);
    if (day) phrase = phrase.replace(named[0], ` ${day.day} `).replace(/\bon\b/gi, " ");
  }

  const wantsLatest = /\b(last|latest|most recent|newest)\b/i.test(phrase);
  const found = wantsLatest
    ? [...pool].sort((a, b) => b.recordNumber - a.recordNumber).slice(0, 1)
    : findRows(phrase.replace(/\b(last|latest)\b/gi, " "), pool, asOf, ask.all ? 200 : 5).map((c) => c.row);
  const chosen = ask.all ? found : found.slice(0, 1);

  const rows: ChangedRow[] = [];
  const refused: { row: Transaction; reason: string }[] = [];
  for (const row of chosen) {
    const result = changeRow(row, ask.change, transactions, reference, debts);
    if ("reason" in result) refused.push({ row, reason: result.reason });
    else rows.push({ before: row, after: result });
  }
  return { rows, refused };
}

/** What a change does to one row, in words: "₱1,100.00 to ₱1,200.00". */
export function changeWords({ before, after }: ChangedRow): string {
  const parts: string[] = [];
  if (before.amount !== after.amount) parts.push(`${formatMoney(before.amount)} to ${formatMoney(after.amount)}`);
  if (before.fromWallet !== after.fromWallet) parts.push(`from ${before.fromWallet || "no wallet"} to ${after.fromWallet || "no wallet"}`);
  if (before.toWallet !== after.toWallet) parts.push(`into ${after.toWallet || "no wallet"} instead of ${before.toWallet || "no wallet"}`);
  if (before.date !== after.date) parts.push(`dated ${after.date} instead of ${before.date}`);
  if (before.item !== after.item) parts.push(`${before.item || "no item"} to ${after.item}`);
  return parts.join(", ");
}
