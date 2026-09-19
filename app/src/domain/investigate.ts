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
 *   wrong account     a row filed on another account for exactly the gap
 *   unrecorded        money that came in or went out and was never written
 *                     down: interest, a refund, someone paying you back, a fee
 *
 * ── When it last matched ──────────────────────────────────────────────────
 *
 * "Yesterday it matched to the peso, today the bank has more." The owner
 * knows the day it was last right, and that one fact rules out every row
 * before it. Given that day, only what moved after it is searched, however
 * many hundreds of rows came before.
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
  | { readonly kind: "cash"; readonly perDay: Centavos; readonly days: number; readonly explains: Centavos }
  | { readonly kind: "wrong-account"; readonly row: Transaction; readonly other: string; readonly explains: Centavos }
  | { readonly kind: "unrecorded"; readonly direction: "in" | "out"; readonly explains: Centavos };

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
  /**
   * The findings add up to more than the difference, or point the other way.
   *
   * Rows entered twice are worth putting right whatever the balance says, so
   * they are still listed. What cannot be done is arithmetic on the rest:
   * "the other ₱8,915.00 could be" was printed against a ₱500.00 difference.
   */
  readonly overshoot: boolean;
  /** The period the statement covered, when there was one. */
  readonly covered?: { readonly from: IsoDate; readonly to: IsoDate } | undefined;
  /** The last day the account and the ledger agreed, when the owner said. */
  readonly since?: IsoDate | undefined;
  /** What the ledger recorded on the account after that day. */
  readonly movedSince?: { readonly count: number; readonly into: Centavos; readonly outOf: Centavos } | undefined;
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
  /**
   * The last day the account and the ledger agreed. Everything on or before
   * it is taken as right, so only what came after is searched.
   */
  readonly matchedOn?: IsoDate | undefined;
}

export function investigate(input: InvestigateInput): Investigation {
  const { transactions, account, actual, asOf } = input;
  const since = input.matchedOn && input.matchedOn < asOf ? input.matchedOn : undefined;
  /** Inside the search: after the day it last matched, or within the look-back. */
  const searched = (t: Transaction, days: number): boolean => (since ? t.date > since : t.date >= addDays(asOf, -days));
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
    const recent = onAccount.filter((t) => searched(t, input.lookBackDays ?? 90));
    for (const p of twins(recent, account)) {
      found.push({ kind: "duplicate", row: p.row, twin: p.twin, explains: movedOn(p.row, account) });
    }
  }

  const explained = found.reduce((sum, c) => sum + c.explains, 0);
  const unexplained = gap - explained;
  const isCash = /(^|[^a-z])cash([^a-z]|$)/i.test(account);

  /*
   * More found than there is to find. Every possibility below is worked out
   * from the remainder, and a remainder larger than the difference itself is
   * not a remainder: it means some of the findings are wrong, or the
   * difference has more than one cause pulling both ways.
   */
  const overshoot = gap !== 0 && explained !== 0 && (Math.sign(explained) !== Math.sign(gap) || Math.abs(explained) > Math.abs(gap));

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
  if (unexplained !== 0 && !overshoot) {
    const pool = onAccount
      .filter((t) => searched(t, input.lookBackDays ?? 60) && (!covered || t.date < covered.from))
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
    if (isCash && unexplained > 0) {
      const monthAgo = addDays(asOf, -30);
      const spent = onAccount
        .filter((t) => t.date > monthAgo && t.type === "Spending")
        .reduce((sum, t) => sum - movedOn(t, account), 0);
      const perDay = Math.round(spent / 30);
      if (perDay > 0) {
        possible.push({ kind: "cash", perDay, days: Math.max(1, Math.round(unexplained / perDay)), explains: unexplained });
      }
    }

    /*
     * Filed on the wrong account. Buried in hundreds of rows, an entry saved
     * against Gcash that really moved Maya is invisible from Maya's side. A
     * row on another account for exactly what is unaccounted for, moving the
     * way the gap points, is offered to be opened and corrected.
     *
     * Too much recorded here: something left this account and was filed as
     * leaving another. Too little: something arrived here and was filed as
     * arriving somewhere else.
     */
    const elsewhere = transactions
      .filter((t) => t.date <= asOf && searched(t, input.lookBackDays ?? 60) && movedOn(t, account) === 0)
      .sort((a, b) => b.date.localeCompare(a.date));
    let wrong = 0;
    for (const t of elsewhere) {
      if (wrong >= 3) break;
      for (const other of new Set([t.fromWallet, t.toWallet])) {
        if (!other || other === account || movedOn(t, other) !== -unexplained) continue;
        possible.push({ kind: "wrong-account", row: t, other, explains: unexplained });
        wrong += 1;
        break;
      }
    }

    // Money nobody wrote down, which is the answer whenever nothing recorded is.
    if (!(isCash && unexplained > 0)) {
      possible.push({ kind: "unrecorded", direction: unexplained < 0 ? "in" : "out", explains: unexplained });
    }
  }

  const movedSince = since
    ? onAccount
        .filter((t) => t.date > since)
        .reduce(
          (m, t) => {
            const v = movedOn(t, account);
            return { count: m.count + 1, into: m.into + Math.max(0, v), outOf: m.outOf + Math.max(0, -v) };
          },
          { count: 0, into: 0, outOf: 0 },
        )
    : undefined;

  return { account, asOf, recorded, actual, gap, found, possible, explained, unexplained, overshoot, covered, since, movedSince };
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
    case "wrong-account":
      return `${row(clue.row)} is filed on ${clue.other}, for exactly ${formatMoney(Math.abs(clue.explains))}. If it really ${
        clue.explains > 0 ? "came out of" : "went into"
      } this account, that is the difference.`;
    case "unrecorded":
      return clue.direction === "in"
        ? `${formatMoney(Math.abs(clue.explains))} came in that the ledger does not have: bank interest, a refund or cashback, or someone sending or paying you back. Add it as what it was.`
        : `${formatMoney(Math.abs(clue.explains))} went out that the ledger does not have: a fee, a purchase or a transfer not written down. Add it as what it was.`;
  }
}

/** The whole answer, as a headline and a list. */
export function investigationWords(result: Investigation): {
  readonly headline: string;
  readonly lines: readonly string[];
  /** The sentence about what is still unaccounted for, when something is. */
  readonly rest: string | null;
  /** What was searched, when the owner gave the day it last matched. */
  readonly since: string | null;
} {
  const { account, recorded, actual, gap, found, possible, explained, unexplained, overshoot, covered, since, movedSince } = result;
  if (gap === 0) {
    return {
      headline: `${account} matches: the ledger and the account both hold ${formatMoney(actual)}.`,
      lines: found.length > 0 ? found.map(clueWords) : [],
      rest: null,
      since: null,
    };
  }

  const headline = `The ledger says ${account} holds ${formatMoney(recorded)} and it really holds ${formatMoney(actual)}: ${formatMoney(
    Math.abs(gap),
  )} ${gap > 0 ? "more is recorded than is there" : "more is there than is recorded"}.`;

  const lines: string[] = [];
  let rest: string | null = null;
  let searched: string | null = null;
  if (since && movedSince) {
    searched =
      movedSince.count === 0
        ? `Nothing is recorded on ${account} since ${formatMedium(since)}, when it last matched, so the whole difference arrived or left since then without being written down.`
        : `Since ${formatMedium(since)}, when it last matched, ${movedSince.count} ${movedSince.count === 1 ? "movement is" : "movements are"} recorded on ${account}: ${formatMoney(movedSince.into)} in and ${formatMoney(movedSince.outOf)} out. Only those were searched.`;
    lines.push(searched);
  }
  if (found.length > 0) {
    lines.push(
      overshoot
        ? `${found.length} ${found.length === 1 ? "row is" : "rows are"} worth looking at, ${formatMoney(Math.abs(explained))} between them, which is more than the difference. Put right the ones that are wrong and the difference is worked out again:`
        : unexplained === 0
          ? `Found all ${formatMoney(Math.abs(gap))}, in ${found.length} ${found.length === 1 ? "place" : "places"}:`
          : `Found ${formatMoney(Math.abs(explained))} of it, in ${found.length} ${found.length === 1 ? "place" : "places"}:`,
    );
    lines.push(...found.map(clueWords));
  }
  if (unexplained !== 0 && !overshoot) {
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
  return { headline, lines, rest, since: searched };
}

// ── Putting it right ───────────────────────────────────────────────────────

/**
 * The ways to record money nobody wrote down, each as an entry to check.
 *
 * More money than recorded is interest, income, or a loan coming back; less
 * is spending. The owner picks which it was, since the balance alone cannot
 * say.
 */
export function choicesForClue(
  clue: Clue,
  account: string,
  asOf: IsoDate,
  interestItem = "",
): { readonly label: string; readonly draft: Draft }[] {
  if (clue.kind !== "unrecorded") {
    const draft = draftForClue(clue, account, asOf, interestItem);
    return draft ? [{ label: "Add it", draft }] : [];
  }
  const amount = Math.abs(clue.explains);
  if (clue.direction === "out") {
    return [
      {
        label: "Add as spending",
        draft: { ...emptyDraft(asOf), flow: "Spending", category: "Spending", fromWallet: account, amount, description: "Spent, not written down at the time", status: "Paid" },
      },
    ];
  }
  const income = (item: string, description: string): Draft => ({
    ...emptyDraft(asOf),
    flow: "Revenue",
    category: "Revenue",
    toWallet: account,
    item,
    amount,
    description,
    status: "Received",
  });
  return [
    ...(interestItem ? [{ label: "Add as interest", draft: income(interestItem, "Interest earned") }] : []),
    { label: "Add as income", draft: income("", "Came in, not written down at the time") },
    {
      label: "Someone paid me back",
      draft: { ...emptyDraft(asOf), flow: "Debt", debtEffect: "collect", toWallet: account, amount },
    },
  ];
}

/** The entry a finding would add, for the Add form or a card to check before it is saved. */
export function draftForClue(clue: Clue, account: string, asOf: IsoDate, interestItem = ""): Draft | null {
  if (clue.kind === "unrecorded") {
    const choices = choicesForClue(clue, account, asOf, interestItem);
    // Small sums arriving on their own are nearly always interest; anything larger is left for the owner to name.
    const pick = clue.direction === "in" && interestItem && Math.abs(clue.explains) <= 10000 ? choices[0] : choices.find((c) => c.label !== "Add as interest");
    return pick?.draft ?? null;
  }
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
