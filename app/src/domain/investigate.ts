/**
 * Where did the difference go.
 *
 * ── The question ──────────────────────────────────────────────────────────
 *
 * The owner, 2026-09-17: "My balance in my bank account is 30000, where's the
 * rest? In my tracking system it's 50000, where's the 20?" And the answer
 * they wanted: "I found your 20k. It is scattered across 4 transactions: 5k
 * was the cinema, 15k was travel."
 *
 * ── How it looks ──────────────────────────────────────────────────────────
 *
 * The gap is what the ledger says minus what the account really holds. Every
 * clue explains part of it, in centavos, with a sign, so clues add up and the
 * total can be checked against the gap exactly. Nothing here rounds.
 *
 * With the account's own history (a statement, a screenshot of the
 * transaction list, a pasted list), the evidence is direct:
 *
 *   missing           on the statement, not in the ledger
 *   not on statement  in the ledger for that period, not on the statement
 *   amount differs    the same movement, recorded at a different figure
 *   duplicate         recorded twice, once on the statement
 *
 * Without it, the ledger alone still says a good deal:
 *
 *   duplicate         two rows that are the same movement
 *   together          a handful of recent rows that add up to the gap exactly,
 *                     offered as a possibility and never as a finding
 *   cash              for cash, which has no statement, how many days of
 *                     unrecorded spending the gap is at the recent rate
 *
 * ── What it never does ────────────────────────────────────────────────────
 *
 * Change anything. Integrity checks report and never auto-correct
 * (CLAUDE.md). Every clue is offered with the action that would fix it, and
 * nothing happens until the owner presses it.
 *
 * No service is called and nothing leaves the device. Reading a screenshot is
 * the chat's job; this takes the lines it read.
 */

import { addDays, daysBetween, formatMedium } from "./dates";
import { draftToTransactions, emptyDraft, type Draft } from "./entry";
import { formatMoney, type Centavos } from "./money";
import type { IsoDate, Transaction } from "./types";

/** One line of an account's own history, as it moved that account. */
export interface StatementLine {
  readonly date: IsoDate;
  /** Signed: money in is positive, money out negative. */
  readonly amount: Centavos;
  readonly description: string;
}

export type Clue =
  | { readonly kind: "missing"; readonly line: StatementLine; readonly explains: Centavos }
  | { readonly kind: "not-on-statement"; readonly row: Transaction; readonly explains: Centavos }
  | {
      readonly kind: "amount-differs";
      readonly row: Transaction;
      readonly line: StatementLine;
      readonly explains: Centavos;
    }
  | { readonly kind: "duplicate"; readonly row: Transaction; readonly twin: Transaction; readonly explains: Centavos }
  | { readonly kind: "together"; readonly rows: readonly Transaction[]; readonly explains: Centavos }
  | { readonly kind: "cash"; readonly perDay: Centavos; readonly days: number; readonly explains: Centavos };

export interface Investigation {
  readonly account: string;
  readonly asOf: IsoDate;
  /** What the ledger says the account holds on `asOf`. */
  readonly recorded: Centavos;
  /** What the account really holds, as the owner or the statement says. */
  readonly actual: Centavos;
  /** recorded − actual. Positive: the ledger shows more money than there is. */
  readonly gap: Centavos;
  /** Clues with evidence behind them. They add up. */
  readonly found: readonly Clue[];
  /** Possibilities with no evidence: each could be the whole answer, and they overlap. */
  readonly possible: readonly Clue[];
  /** The part of the gap the found clues account for. */
  readonly explained: Centavos;
  /** What is still unaccounted for. */
  readonly unexplained: Centavos;
  /** The period the statement covered, when there was one. */
  readonly covered?: { readonly from: IsoDate; readonly to: IsoDate } | undefined;
}

/** What one row did to one account, by the same terms `walletBalance` uses. */
export function movedOn(t: Transaction, account: string): Centavos {
  let delta = 0;
  if (t.type === "Revenue" && t.fromWallet === account) delta += t.total;
  if (t.toWallet === account) delta += t.amount;
  if (t.fromWallet === account && t.type !== "Revenue") delta -= t.total;
  return delta;
}

const words = (text: string): Set<string> =>
  new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2),
  );

/** How much two descriptions share, 0 to 1. */
function likeness(a: string, b: string): number {
  const left = words(a);
  const right = words(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const w of left) if (right.has(w)) shared += 1;
  return shared / Math.min(left.size, right.size);
}

const describe = (t: Transaction): string => [t.item, t.description, t.notes].filter(Boolean).join(" ");

/**
 * Figures a slip of the finger apart: one digit too many or too few, or two
 * digits the wrong way round. ₱1,500.00 typed as ₱15,000.00, or ₱540 as ₱450.
 */
export function looksMistyped(a: Centavos, b: Centavos): boolean {
  const x = Math.abs(a);
  const y = Math.abs(b);
  if (x === 0 || y === 0 || x === y) return false;
  if (x === y * 10 || y === x * 10) return true;
  const dx = String(x);
  const dy = String(y);
  return dx.length === dy.length && [...dx].sort().join("") === [...dy].sort().join("");
}

/**
 * Several rows whose effects add up to exactly `target`.
 *
 * Smallest sets first, so a single row that explains it all is offered before
 * four that happen to. Bounded on purpose: past four rows, a sum matching is
 * more likely coincidence than cause.
 */
export function rowsAddingTo(
  rows: readonly { readonly row: Transaction; readonly value: Centavos }[],
  target: Centavos,
  most = 3,
  /** The largest set worth offering. */
  largest = 4,
): Transaction[][] {
  if (target === 0) return [];
  const out: Transaction[][] = [];
  const pick = rows.slice(0, 48);
  const add = (set: number[]): boolean => {
    out.push(set.map((i) => pick[i]!.row));
    return out.length >= most;
  };

  for (let i = 0; i < pick.length; i += 1) {
    if (pick[i]!.value === target && add([i])) return out;
  }

  if (largest < 2) return out;
  const pairs = new Map<number, [number, number][]>();
  for (let i = 0; i < pick.length; i += 1) {
    for (let j = i + 1; j < pick.length; j += 1) {
      const sum = pick[i]!.value + pick[j]!.value;
      if (sum === target && add([i, j])) return out;
      const list = pairs.get(sum) ?? [];
      list.push([i, j]);
      pairs.set(sum, list);
    }
  }

  if (largest < 3) return out;
  for (let k = 0; k < pick.length; k += 1) {
    for (const [i, j] of pairs.get(target - pick[k]!.value) ?? []) {
      if (k > j && add([i, j, k])) return out;
    }
  }

  if (largest < 4) return out;
  for (const [sum, list] of pairs) {
    for (const [i, j] of list) {
      for (const [k, l] of pairs.get(target - sum) ?? []) {
        if (k > j && add([i, j, k, l])) return out;
      }
    }
  }
  return out;
}

/** Two rows on one account that are the same movement entered twice. */
function twins(rows: readonly Transaction[], account: string): { row: Transaction; twin: Transaction }[] {
  const out: { row: Transaction; twin: Transaction }[] = [];
  const used = new Set<string>();
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.recordNumber - b.recordNumber);
  for (let i = 0; i < sorted.length; i += 1) {
    const a = sorted[i]!;
    if (used.has(a.id)) continue;
    for (let j = i + 1; j < sorted.length; j += 1) {
      const b = sorted[j]!;
      if (daysBetween(a.date, b.date) > 1) break;
      if (used.has(b.id) || movedOn(a, account) !== movedOn(b, account)) continue;
      const sameThing = a.item.trim().toLowerCase() === b.item.trim().toLowerCase() && likeness(describe(a), describe(b)) >= 0.5;
      const sameWords = describe(a).trim().toLowerCase() === describe(b).trim().toLowerCase();
      if (sameThing || sameWords) {
        out.push({ row: b, twin: a });
        used.add(a.id);
        used.add(b.id);
        break;
      }
    }
  }
  return out;
}

export interface InvestigateInput {
  readonly transactions: readonly Transaction[];
  readonly account: string;
  /** What the account really holds. */
  readonly actual: Centavos;
  /** The day that balance was read. Rows after it are left out. */
  readonly asOf: IsoDate;
  /** The account's own history, when there is one. */
  readonly statement?: readonly StatementLine[] | undefined;
  /** How far back to look without a statement. */
  readonly lookBackDays?: number | undefined;
}

export function investigate(input: InvestigateInput): Investigation {
  const { transactions, account, actual, asOf } = input;
  const onAccount = transactions.filter((t) => t.date <= asOf && movedOn(t, account) !== 0);
  const recorded = onAccount.reduce((sum, t) => sum + movedOn(t, account), 0);
  const gap = recorded - actual;

  const found: Clue[] = [];
  const possible: Clue[] = [];
  const statement = [...(input.statement ?? [])].filter((l) => l.amount !== 0 && l.date <= asOf);
  let covered: Investigation["covered"];

  if (statement.length > 0) {
    const from = statement.reduce((m, l) => (l.date < m ? l.date : m), statement[0]!.date);
    const to = statement.reduce((m, l) => (l.date > m ? l.date : m), statement[0]!.date);
    covered = { from, to };
    const inWindow = onAccount.filter((t) => t.date >= from && t.date <= to);

    const lines = statement.map((line, index) => ({ line, index }));
    const unmatchedLines = new Set(lines.map((l) => l.index));
    const unmatchedRows = new Set(inWindow.map((t) => t.id));

    // Pass 1: the same figure, the closest date, the likeliest words.
    for (const { line, index } of lines) {
      let best: { row: Transaction; score: number } | null = null;
      for (const row of inWindow) {
        if (!unmatchedRows.has(row.id) || movedOn(row, account) !== line.amount) continue;
        const apart = Math.abs(daysBetween(row.date, line.date));
        if (apart > 3) continue;
        const score = apart * 10 - likeness(describe(row), line.description) * 5;
        if (!best || score < best.score) best = { row, score };
      }
      if (best) {
        unmatchedRows.delete(best.row.id);
        unmatchedLines.delete(index);
      }
    }

    // Pass 2: a transfer and its fee listed as two lines on the same day.
    for (const row of inWindow) {
      if (!unmatchedRows.has(row.id)) continue;
      const open = lines.filter((l) => unmatchedLines.has(l.index) && Math.abs(daysBetween(row.date, l.line.date)) <= 1);
      search: for (let i = 0; i < open.length; i += 1) {
        for (let j = i + 1; j < open.length; j += 1) {
          if (open[i]!.line.amount + open[j]!.line.amount === movedOn(row, account)) {
            unmatchedRows.delete(row.id);
            unmatchedLines.delete(open[i]!.index);
            unmatchedLines.delete(open[j]!.index);
            break search;
          }
        }
      }
    }

    // Pass 3: the same movement at a different figure.
    for (const { line, index } of lines) {
      if (!unmatchedLines.has(index)) continue;
      let best: { row: Transaction; score: number } | null = null;
      for (const row of inWindow) {
        if (!unmatchedRows.has(row.id)) continue;
        const delta = movedOn(row, account);
        if (Math.sign(delta) !== Math.sign(line.amount)) continue;
        const apart = Math.abs(daysBetween(row.date, line.date));
        if (apart > 2) continue;
        const alike = likeness(describe(row), line.description);
        const typo = looksMistyped(delta, line.amount);
        if (alike < 0.5 && !typo) continue;
        const score = apart * 10 - alike * 5 - (typo ? 8 : 0);
        if (!best || score < best.score) best = { row, score };
      }
      if (best) {
        unmatchedRows.delete(best.row.id);
        unmatchedLines.delete(index);
        found.push({ kind: "amount-differs", row: best.row, line, explains: movedOn(best.row, account) - line.amount });
      }
    }

    // What is left over on either side.
    const leftRows = inWindow.filter((t) => unmatchedRows.has(t.id));
    const doubled = twins(inWindow, account).filter((p) => unmatchedRows.has(p.row.id) && !unmatchedRows.has(p.twin.id));
    const doubledIds = new Set(doubled.map((p) => p.row.id));
    for (const p of doubled) found.push({ kind: "duplicate", row: p.row, twin: p.twin, explains: movedOn(p.row, account) });
    for (const row of leftRows) {
      if (!doubledIds.has(row.id)) found.push({ kind: "not-on-statement", row, explains: movedOn(row, account) });
    }
    for (const { line, index } of lines) {
      if (unmatchedLines.has(index)) found.push({ kind: "missing", line, explains: -line.amount });
    }
  } else {
    // Without a statement: rows entered twice are evidence enough on their own.
    const since = addDays(asOf, -(input.lookBackDays ?? 90));
    const recent = onAccount.filter((t) => t.date >= since);
    for (const p of twins(recent, account)) {
      found.push({ kind: "duplicate", row: p.row, twin: p.twin, explains: movedOn(p.row, account) });
    }
  }

  const explained = found.reduce((sum, c) => sum + c.explains, 0);
  const unexplained = gap - explained;

  /*
   * What is left, as possibilities: one recent row, or two, that add up to
   * exactly what is unaccounted for. With a statement, only rows from before
   * it can be the cause, because inside its period every row was checked.
   *
   * Only rows that moved money the way the gap points. A recorded income that
   * never arrived makes the ledger too high; a recorded spending that never
   * happened makes it too low. Mixing the two, or offering three and four
   * rows at a time, found coincidences in any real ledger: tried on 440 rows,
   * it offered three different sets of three for ₱1,100.00, none of them the
   * answer.
   */
  if (unexplained !== 0) {
    const since = addDays(asOf, -(input.lookBackDays ?? 60));
    const pool = onAccount
      .filter((t) => t.date >= since && (!covered || t.date < covered.from))
      .map((row) => ({ row, value: movedOn(row, account) }))
      .filter((r) => Math.sign(r.value) === Math.sign(unexplained))
      .sort((a, b) => b.row.date.localeCompare(a.row.date) || Math.abs(b.value) - Math.abs(a.value));
    for (const rows of rowsAddingTo(pool, unexplained, 2, 2)) {
      possible.push({ kind: "together", rows, explains: unexplained });
    }

    /*
     * Cash keeps no statement. If there is less cash than recorded, the likely
     * reason is spending nobody wrote down, and the recent rate says how much
     * of that it would take.
     */
    // The word on its own: Gcash is an e-wallet with a statement, not cash.
    if (/(^|[^a-z])cash([^a-z]|$)/i.test(account) && unexplained > 0) {
      const monthAgo = addDays(asOf, -30);
      const spent = onAccount
        .filter((t) => t.date > monthAgo && t.type === "Spending")
        .reduce((sum, t) => sum - movedOn(t, account), 0);
      const perDay = Math.round(spent / 30);
      if (perDay > 0) {
        possible.push({ kind: "cash", perDay, days: Math.max(1, Math.round(unexplained / perDay)), explains: unexplained });
      }
    }
  }

  return { account, asOf, recorded, actual, gap, found, possible, explained, unexplained, covered };
}

// ── In words ───────────────────────────────────────────────────────────────

const row = (t: Transaction): string =>
  `#${String(t.recordNumber).padStart(4, "0")} ${t.item || t.description || t.type} on ${formatMedium(t.date)}`;

/** One clue, said the way the owner would say it. */
export function clueWords(clue: Clue): string {
  switch (clue.kind) {
    case "missing":
      return clue.line.amount < 0
        ? `${formatMoney(-clue.line.amount)} went out on ${formatMedium(clue.line.date)} (${clue.line.description || "no description"}) and is not in the ledger.`
        : `${formatMoney(clue.line.amount)} came in on ${formatMedium(clue.line.date)} (${clue.line.description || "no description"}) and is not in the ledger. If it was money for someone else, record it as received for them.`;
    case "not-on-statement":
      return `${row(clue.row)} is in the ledger as ${formatMoney(Math.abs(clue.explains))} ${
        clue.explains > 0 ? "in" : "out"
      }, and the statement does not show it. It may be on another account, or it never happened.`;
    case "amount-differs":
      return `${row(clue.row)} is recorded as ${formatMoney(Math.abs(clue.explains + clue.line.amount))} and the statement says ${formatMoney(
        Math.abs(clue.line.amount),
      )}.`;
    case "duplicate":
      return `${row(clue.row)} looks like ${row(clue.twin)} entered a second time, ${formatMoney(Math.abs(clue.explains))}.`;
    case "together":
      return `${clue.rows.length === 1 ? "One entry" : `${clue.rows.length} entries`} add up to exactly ${formatMoney(
        Math.abs(clue.explains),
      )}: ${clue.rows.map(row).join("; ")}. If ${clue.rows.length === 1 ? "it was" : "they were"} never on this account, that is the difference.`;
    case "cash":
      return `Cash has no statement. At your recent rate of ${formatMoney(clue.perDay)} a day, ${formatMoney(clue.explains)} is about ${clue.days} ${
        clue.days === 1 ? "day" : "days"
      } of spending that was not written down.`;
  }
}

/** The whole answer, as a headline and a list. */
export function investigationWords(result: Investigation): {
  readonly headline: string;
  readonly lines: readonly string[];
  /** The sentence about what is still unaccounted for, when something is. */
  readonly rest: string | null;
} {
  const { account, recorded, actual, gap, found, possible, explained, unexplained, covered } = result;
  if (gap === 0) {
    return {
      headline: `${account} matches: the ledger and the account both hold ${formatMoney(actual)}.`,
      lines: found.length > 0 ? found.map(clueWords) : [],
      rest: null,
    };
  }

  const headline = `The ledger says ${account} holds ${formatMoney(recorded)} and it really holds ${formatMoney(actual)}: ${formatMoney(
    Math.abs(gap),
  )} ${gap > 0 ? "more is recorded than is there" : "more is there than is recorded"}.`;

  const lines: string[] = [];
  let rest: string | null = null;
  if (found.length > 0) {
    lines.push(
      unexplained === 0
        ? `Found all ${formatMoney(Math.abs(gap))}, in ${found.length} ${found.length === 1 ? "place" : "places"}:`
        : `Found ${formatMoney(Math.abs(explained))} of it, in ${found.length} ${found.length === 1 ? "place" : "places"}:`,
    );
    lines.push(...found.map(clueWords));
  }
  if (unexplained !== 0) {
    if (possible.length > 0) {
      rest = `${found.length > 0 ? "The other" : "The whole"} ${formatMoney(Math.abs(unexplained))} could be:`;
      lines.push(rest);
      lines.push(...possible.map(clueWords));
    } else {
      rest = covered
        ? `${formatMoney(Math.abs(unexplained))} is from before ${formatMedium(covered.from)}. Send an older part of the history to find it.`
        : `${formatMoney(Math.abs(unexplained))} has no match in the ledger alone. Send the account's transaction history, as screenshots or pasted lines, and each movement is checked against the ledger.`;
      lines.push(rest);
    }
  }
  return { headline, lines, rest };
}

// ── Putting it right ───────────────────────────────────────────────────────

/** The entry a finding would add, for the Add form or a card to check before it is saved. */
export function draftForClue(clue: Clue, account: string, asOf: IsoDate): Draft | null {
  if (clue.kind === "missing") {
    const out = clue.line.amount < 0;
    return {
      ...emptyDraft(clue.line.date),
      flow: out ? "Spending" : "Revenue",
      category: out ? "Spending" : "Revenue",
      fromWallet: out ? account : "",
      toWallet: out ? "" : account,
      amount: Math.abs(clue.line.amount),
      description: clue.line.description,
      status: out ? "Paid" : "Received",
    };
  }
  if (clue.kind === "cash") {
    return {
      ...emptyDraft(asOf),
      flow: "Spending",
      category: "Spending",
      fromWallet: account,
      amount: clue.explains,
      description: "Cash spending not written down at the time",
      status: "Paid",
    };
  }
  return null;
}

/**
 * Rows read off a screenshot, as lines of that account's history.
 *
 * Each row is built the way it would be saved, then measured on the account
 * the way the balance is, so a transfer with a fee reads as the whole amount
 * leaving, and a charge added to a credit line moves no wallet at all.
 */
export function linesFromDrafts(drafts: readonly Draft[], account: string): StatementLine[] {
  const out: StatementLine[] = [];
  for (const draft of drafts) {
    if (draft.amount === null) continue;
    const rows = draftToTransactions(draft, 0, "statement-line");
    const amount = rows.reduce((sum, t) => sum + movedOn(t, account), 0);
    if (amount !== 0) {
      out.push({ date: draft.date, amount, description: draft.description || draft.item || draft.flow });
    }
  }
  return out;
}

// ── Reading pasted history ─────────────────────────────────────────────────

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * Lines of history as they are copied out of a banking app or typed:
 *
 *   2026-09-03  Cinema  -5,000.00
 *   Sep 3 Cinema 5000 out
 *   09/05/2026 Received from client +12,500
 *
 * A figure with no sign, and no word saying which way it went, is read as
 * money out, which is what most history lists hold. Lines with no figure or
 * no date are skipped rather than guessed.
 */
export function readHistory(text: string, year: number): StatementLine[] {
  const out: StatementLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const lineText = raw.trim();
    if (!lineText) continue;

    let date: IsoDate | null = null;
    let rest = lineText;
    const iso = /\b(20\d{2})-(\d{2})-(\d{2})\b/.exec(rest);
    const slashed = /\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/.exec(rest);
    const named = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:,?\s+(20\d{2}))?\b/i.exec(rest);
    if (iso) {
      date = `${iso[1]}-${iso[2]}-${iso[3]}`;
      rest = rest.replace(iso[0], " ");
    } else if (slashed) {
      date = `${slashed[3]}-${slashed[1]!.padStart(2, "0")}-${slashed[2]!.padStart(2, "0")}`;
      rest = rest.replace(slashed[0], " ");
    } else if (named) {
      const month = MONTHS.indexOf(named[1]!.slice(0, 3).toLowerCase()) + 1;
      date = `${named[3] ?? year}-${String(month).padStart(2, "0")}-${named[2]!.padStart(2, "0")}`;
      rest = rest.replace(named[0], " ");
    }
    if (!date) continue;

    const figures = [...rest.matchAll(/([+-]|−)?\s*(?:₱|php\s*)?(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/gi)];
    const last = figures.at(-1);
    if (!last?.[2]) continue;
    const [pesos, cents = ""] = last[2].replace(/,/g, "").split(".");
    const centavos = Number(pesos) * 100 + Number((cents + "00").slice(0, 2));
    if (!Number.isFinite(centavos) || centavos === 0) continue;

    const description = rest.replace(last[0], " ").replace(/\s+/g, " ").trim();
    const incoming =
      last[1] === "+" || (!last[1] && /\b(received|receive|cash in|cash-in|deposit|deposited|credited|refund|refunded|salary|income|incoming)\b/i.test(description));
    out.push({ date, amount: incoming ? centavos : -centavos, description });
  }
  return out;
}
