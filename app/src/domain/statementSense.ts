/**
 * What a wallet's own history says about each row, read by the device after
 * the model has had its turn.
 *
 * ── The day this answers ──────────────────────────────────────────────────
 *
 * 27 September 2026. The owner sent their Maya history for the day and three
 * of its rows came back wrong, each in a way the ledger could have caught:
 *
 *   - "Received money from" their own name, ₱9,980.00: the GCash to Maya
 *     transfer they had just logged, read as income and asked "What was it?".
 *   - "Bills Payment for Maya Bank", ₱4,302.06: exactly what Maya Credit was
 *     owed, to the centavo, read as a withdrawal to Cash.
 *   - "Withdrawal from" a store, ₱1,518.00: cash taken out at a partner store,
 *     read as a purchase of food.
 *
 * The owner: "it cant recognized the transfer from gcash earlier, it doenst
 * recognized the debt being paid". Each fix here is a fact the device holds
 * and the model does not: the owner's name, what each credit line is owed,
 * and how the owner has filed the same words before.
 *
 * Every change says so on its card, in words, and nothing is saved until the
 * owner presses the button. Pure, so every rule is tested without a model.
 */

import { outstandingOf, type Debt } from "./debt";
import type { Draft } from "./entry";
import { formatMoney } from "./money";
import { DATE_LINE, ROW_AMOUNT } from "./ocrText";
import type { Proposal } from "./proposal";
import type { ReferenceLists, Transaction } from "./types";

/** One row of a statement as the device read it: its words and its figure. */
export interface StatementRow {
  readonly words: string;
  readonly amount: number;
}

const FIGURE = /[-+−]?\s*₱?\s*\d[\d,]*\.\d{2}(?!\d)/g;

/**
 * The rows in what the device read off a picture: every line since the last
 * figure is one row's words, closed by its figure. Date lines only say where
 * rows sit, and times say when, so neither is part of what a row is.
 */
export function rowsOfReadings(readings: readonly string[]): StatementRow[] {
  const rows: StatementRow[] = [];
  for (const text of readings) {
    let words: string[] = [];
    for (const line of text.split("\n")) {
      if (DATE_LINE.test(line) && !ROW_AMOUNT.test(line)) {
        words = [];
        continue;
      }
      const figure = ROW_AMOUNT.exec(line);
      const said = line.replace(FIGURE, " ").replace(/\b\d{1,2}:\d{2}\s*(?:[ap]\.?m\.?)?/gi, " ").replace(/\s+/g, " ").trim();
      if (said) words.push(said);
      if (!figure) continue;
      const [pesos = "0", cents = "0"] = figure[0].replace(/,/g, "").split(".");
      rows.push({ words: words.join(" ").trim(), amount: Number(pesos) * 100 + Number(cents) });
      words = [];
    }
  }
  return rows;
}

/** A statement's label for a row: "Received money from", "Withdrawal from", and the rest. */
const LABEL = /\b(received\s+(?:money\s+)?from|transfer(?:red)?\s+(?:money\s+)?from|cash\s*in\s+from|sent\s+(?:money\s+)?to|transfer(?:red)?\s+(?:money\s+)?to|bills?\s*payment\s+(?:for|to)|payment\s+(?:for|to)|paid\s+to|withdrawal\s+(?:from|at)|cash\s*out\s+(?:from|at)|purchase(?:d)?\s+(?:at|on|from))\b/i;

/**
 * The row's own words, when the picture shows one row at this figure, or
 * every row at it says the same. A figure shown by two different rows is
 * not evidence about either, so it gives nothing.
 */
export function wordsFor(amount: number | null, rows: readonly StatementRow[]): string {
  if (amount === null) return "";
  const at = [...new Set(rows.filter((r) => r.amount === amount && r.words).map((r) => labelled(r.words)))];
  if (at.length <= 1) return at[0] ?? "";
  // Two readings of one row can differ by a letter; they still agree on what kind of row it is.
  const kinds = new Set(at.map((w) => LABEL.exec(w)?.[1]?.toLowerCase().replace(/\s+/g, " ") ?? ""));
  return kinds.size === 1 && !kinds.has("") ? at[0]! : "";
}

/** From the statement's label on, which drops a stray header or a status word read above it. */
function labelled(words: string): string {
  const m = LABEL.exec(words);
  return m ? words.slice(m.index).trim() : words;
}

const clean = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Edits between two words (Levenshtein), for names a reader got a letter or two wrong. */
function editsBetween(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    let last = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const kept = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, last + (a[i - 1] === b[j - 1] ? 0 : 1));
      last = kept;
    }
  }
  return row[b.length]!;
}

/**
 * A name that is the owner's own, as a statement prints it.
 *
 * Their first name and their surname both have to be there, each allowed a
 * letter or two misread (a reader often takes one letter for another, or adds one).
 * A surname alone is not enough: family members share it, and money from a
 * parent is income, not a transfer between the owner's own accounts.
 */
export function isOwnName(said: string, ownNames: readonly string[]): boolean {
  const heard = clean(said).split(" ").filter((w) => w.length >= 2);
  if (heard.length < 2) return false;
  return ownNames.some((name) => {
    const parts = clean(name).split(" ").filter((w) => w.length >= 2);
    if (parts.length < 2) return false;
    const first = parts[0]!;
    const last = parts[parts.length - 1]!;
    const near = (want: string): boolean => heard.some((w) => editsBetween(w, want) <= Math.floor(want.length / 3));
    return near(first) && near(last);
  });
}

/** The name after a statement's label: "JUAN DELA CRUZ" in "Received money from JUAN DELA CRUZ". */
function nameAfter(words: string, label: RegExp): string {
  const m = label.exec(words);
  return m ? words.slice(m.index + m[0].length).trim() : "";
}

const MONEY_FROM = /\b(?:received\s+(?:money\s+)?from|transfer(?:red)?\s+(?:money\s+)?from|cash\s*in\s+from)\s+/i;
const MONEY_TO = /\b(?:sent\s+(?:money\s+)?to|transfer(?:red)?\s+(?:money\s+)?to)\s+/i;
// "Paid to" is how a wallet prints a payment at a store's QR code, so only a bill payment names a lender.
const PAID_TO = /\b(?:bills?\s*payment|payment)\s+(?:for|to)\s+/i;
const WITHDRAWAL = /^\s*(?:cash\s*)?(?:withdrawal|withdraw|cash\s*out)\b/i;

/** The first word that names something, for matching a payee to a lender: "maya" in "Maya Bank". */
const headWord = (s: string): string => clean(s).split(" ").find((w) => w.length >= 3 && !["the", "bank", "credit", "loan"].includes(w)) ?? "";

/** Money out of a wallet, from the row's own point of view. */
const outOf = (d: Draft, account: string): string =>
  d.flow === "Revenue" || (d.flow === "Debt" && d.debtEffect !== "repay" && d.debtEffect !== "lend") ? "" : d.fromWallet || account;

/** Money into a wallet, from the row's own point of view. */
const into = (d: Draft, account: string): string =>
  d.flow === "Spending" || (d.flow === "Debt" && d.debtEffect !== "draw" && d.debtEffect !== "collect") ? "" : d.toWallet || account;

/** What a line is owed on a day, counting only its rows up to that day. */
function owedOn(transactions: readonly Transaction[], debtId: string, date: string): number {
  return outstandingOf(
    transactions.filter((t) => t.date <= date),
    debtId,
  );
}

/**
 * How the owner has filed "Withdrawal from ..." before: as cash taken out
 * (a transfer to Cash) or as spending. Their own history decides, and no
 * history at all reads it as cash, which is what the words say.
 */
function withdrawalsAreCash(transactions: readonly Transaction[]): boolean {
  let cash = 0;
  let spent = 0;
  for (const t of transactions) {
    if (!WITHDRAWAL.test(t.description)) continue;
    if (t.type === "Transfer" && t.toWallet.trim()) cash += 1;
    else if (t.type === "Spending") spent += 1;
  }
  return cash >= spent;
}

export interface SenseContext {
  /** The account the statement is for, when it is known. */
  readonly account: string;
  /** What the device read off the pictures. */
  readonly readings?: readonly string[];
  /** The owner's own name, as their bank prints it. */
  readonly ownNames: readonly string[];
  readonly debts: readonly Debt[];
  readonly transactions: readonly Transaction[];
  readonly reference: ReferenceLists;
}

/**
 * Each row, put right where the statement's words and the ledger agree on
 * what it is. A row the rules do not touch comes back exactly as it went in.
 */
export function senseStatementRows(proposals: readonly Proposal[], ctx: SenseContext): Proposal[] {
  const rows = rowsOfReadings(ctx.readings ?? []);
  const cash = ctx.reference.wallets.find((w) => /^cash$/i.test(w.trim())) ?? "";
  const cashOut = withdrawalsAreCash(ctx.transactions);
  const lines = ctx.debts.filter(
    (d) => !d.archived && d.form !== "pass-through" && d.kind === "payable" && d.counterpartyType !== "person",
  );

  return proposals.map((p) => {
    const d = p.draft;
    const shown = wordsFor(d.amount, rows);
    const words = shown || d.description;
    if (!words || d.amount === null) return p;
    // The statement's own words go on the card, over the model's retelling of them.
    const note = (draft: Draft, why: string): Proposal => ({
      ...p,
      draft: { ...draft, description: shown || d.description },
      adjustments: [...p.adjustments, why],
    });

    // Money from their own name: a move between their own accounts, never income.
    const fromName = nameAfter(words, MONEY_FROM);
    const landed = into(d, ctx.account);
    if (fromName && landed && d.flow !== "Transfer" && isOwnName(fromName, ctx.ownNames)) {
      const paired = sentFrom(ctx.transactions, landed, d.amount, d.date);
      return note(
        { ...d, flow: "Transfer", category: "Transfer", item: "", fromWallet: paired, toWallet: landed, status: "Transferred", sentOut: false, debtId: undefined, debtEffect: undefined },
        `From ${fromName}, which is your own name: money moved from another of your accounts into ${landed}, not income.${paired ? ` It matches what left ${paired}.` : ""}`,
      );
    }

    // Money to their own name: still theirs, in another pocket.
    const toName = nameAfter(words, MONEY_TO);
    const left = outOf(d, ctx.account);
    if (toName && left && d.flow !== "Transfer" && isOwnName(toName, ctx.ownNames)) {
      return note(
        { ...d, flow: "Transfer", category: "Transfer", item: "", fromWallet: left, toWallet: "", status: "Transferred", sentOut: false, debtId: undefined, debtEffect: undefined },
        `To ${toName}, which is your own name: money moved to another of your accounts, not spending.`,
      );
    }

    // A payment to a lender the owner owes: a payment on that line, not spending or a withdrawal.
    if (left && !(d.flow === "Debt" && d.debtEffect === "repay")) {
      const payee = nameAfter(words, PAID_TO);
      const line = lines.find((l) => {
        const owed = owedOn(ctx.transactions, l.id, d.date);
        if (owed <= 0 || d.amount! > owed) return false;
        const names = [headWord(l.name), headWord(l.counterparty)].filter(Boolean);
        if (payee) return names.includes(headWord(payee));
        // No "payment to" in the words: only the whole balance, to the centavo, with the lender named.
        return d.amount === owed && names.some((n) => clean(words).split(" ").includes(n));
      });
      if (line) {
        const owed = owedOn(ctx.transactions, line.id, d.date);
        return note(
          { ...d, flow: "Debt", debtEffect: "repay", debtId: line.id, item: line.name, category: "", fromWallet: left, toWallet: "", status: "Paid", sentOut: undefined, behalf: undefined },
          d.amount === owed
            ? `${formatMoney(d.amount)} is exactly what ${line.name} was owed on that day: a payment on it, from ${left}, not ${d.flow === "Transfer" ? "a withdrawal" : "spending"}.`
            : `Paid to ${payee || line.counterparty}, the lender on ${line.name}, which was owed ${formatMoney(owed)}: a payment on it, from ${left}.`,
        );
      }
    }

    // Cash taken out at a store or a machine: a transfer to Cash, the way the owner files them.
    if (WITHDRAWAL.test(words) && cash && cashOut && left && left !== cash && (d.flow === "Spending" || (d.flow === "Transfer" && !d.toWallet && !d.sentOut))) {
      return note(
        { ...d, flow: "Transfer", category: "Transfer", item: "", fromWallet: left, toWallet: cash, status: "Withdrawn", sentOut: false },
        `The statement says "${words}": cash taken out, so a transfer from ${left} to ${cash}, the way your other withdrawals are filed.`,
      );
    }

    return p;
  });
}

/**
 * The account the same money left, when the ledger already has it: a
 * transfer into this account for the same figure (with or without its fee),
 * within two days.
 */
function sentFrom(transactions: readonly Transaction[], landed: string, amount: number, date: string): string {
  const days = (a: string, b: string): number => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
  const match = transactions.find(
    (t) =>
      t.type === "Transfer" &&
      t.fromWallet.trim() !== "" &&
      t.fromWallet !== landed &&
      t.toWallet === landed &&
      (t.amount === amount || t.amount + t.fee === amount) &&
      days(t.date, date) <= 2,
  );
  return match?.fromWallet ?? "";
}

/**
 * Names the owner has already filed as their own: money "from" a name,
 * booked as a transfer between two of their accounts. Answering "my own"
 * once teaches the name for every statement after it.
 */
export function ownNamesIn(transactions: readonly Transaction[]): string[] {
  const names = new Set<string>();
  for (const t of transactions) {
    if (t.type !== "Transfer" || !t.fromWallet.trim() || !t.toWallet.trim()) continue;
    const said = nameAfter(t.description, MONEY_FROM);
    if (clean(said).split(" ").filter((w) => w.length >= 2).length >= 2) names.add(said);
  }
  return [...names];
}
