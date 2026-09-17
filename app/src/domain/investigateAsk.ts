/**
 * Recognising a request to find a difference, in the owner's own words.
 *
 *   "my maya balance is 30000, where's the rest?"
 *   "maya app says 30,000 but here it says 50,000"
 *   "I counted my cash, I only have 2000"
 *   "where did my 20k in gcash go"
 *   "hindi match ang gcash, 4500 sa app"
 *
 * What it gives back is the account, and either what the account really
 * holds or how much is missing, whichever the sentence said. A sentence that
 * names neither an account nor a mismatch is left alone: "where did I spend
 * the most" is a question about spending, not an investigation.
 */

import { addDays } from "./dates";
import type { Centavos } from "./money";
import type { IsoDate } from "./types";

export interface InvestigateAsk {
  /** The account named, or empty when the sentence named none. */
  readonly account: string;
  /** What the account really holds, when the sentence said. */
  readonly actual: Centavos | null;
  /** How much is missing, when that is what the sentence said instead. */
  readonly gap: Centavos | null;
  /** The last day it matched, when the sentence said: "yesterday it matched". */
  readonly matchedOn?: IsoDate | null | undefined;
}

const MONTH_INDEX = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Dates and percentages, which are not money: "100% match 2 days ago", "on sep 15". */
const NOT_MONEY =
  /\b\d+(?:\.\d+)?\s*%|\b\d+\s+days?\s+ago\b|\b20\d{2}-\d{2}-\d{2}\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?\b(?!\s*(?:k|,\d{3}))/gi;

/** The day it last matched, when the sentence says one. */
export function matchedOnIn(text: string, asOf: IsoDate): IsoDate | null {
  if (!/\b(match|matched|matches|matching|agreed|same|correct|right|balanced|tugma|tama)\b/i.test(text)) return null;
  if (/\b(yesterday|kahapon|last night)\b/i.test(text)) return addDays(asOf, -1);
  const ago = /\b(\d+)\s+days?\s+ago\b/i.exec(text);
  if (ago?.[1]) return addDays(asOf, -Number(ago[1]));
  if (/\blast week\b/i.test(text)) return addDays(asOf, -7);
  if (/\b(this morning|earlier today)\b/i.test(text)) return addDays(asOf, -1);
  const iso = /\b(20\d{2}-\d{2}-\d{2})\b/.exec(text);
  if (iso?.[1] && iso[1] < asOf) return iso[1];
  const named = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})\b/i.exec(text);
  if (named?.[1] && named[2]) {
    const month = MONTH_INDEX.indexOf(named[1].slice(0, 3).toLowerCase()) + 1;
    const day = `${asOf.slice(0, 4)}-${String(month).padStart(2, "0")}-${named[2].padStart(2, "0")}`;
    if (day < asOf) return day;
  }
  return null;
}

/** Words that say the figures do not agree, or ask to check them. */
const MISMATCH =
  /\b(extra money|more money than|have extra|has extra|got extra|more than (?:the |my )?(?:system|app|ledger|tracker)|less than (?:the |my )?(?:system|app|ledger|tracker)|where('?s| is| are| did| does| do)? (the )?(rest|remaining|difference|missing|balance|it go|they go|my money)|where did (my|the|it)|where('?s| is) my|missing|nawawala|nasaan|doesn'?t match|don'?t match|not match(ing)?|hindi (match|tugma)|mismatch|discrepanc\w*|reconcile|reconciliation|investigate|investigation|find (the|my) (difference|missing)|balance is (off|wrong|different)|off by|wrong balance|unaccounted|lost money|check my balance|different (from|than) (the )?(app|bank|system))\b/i;

/** Words saying a figure is what the account really holds. */
const REAL = /\b(balance|really|actual|actually|only have|i have|counted|count|in my (bank|account|wallet)|bank says|app says|sa app|on the app|in the app|left|remaining|holds|has)\b/i;

/** Words saying a figure is what this app shows. */
const HERE =
  /\b(here|this app|the system|my system|tracking|tracker|ledger|database|in the system|it says here|you say|you show|app shows here)\b/i;

const MONTH = /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b/i;

const FIGURE = /(?:₱|php\s*)?(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)\s*(k|m)?\b/gi;

function figuresIn(text: string): { value: Centavos; index: number }[] {
  const out: { value: Centavos; index: number }[] = [];
  for (const m of text.matchAll(FIGURE)) {
    const raw = m[1];
    if (!raw) continue;
    // A year beside a month, or after "in" or "since", is a date, not money.
    const before = text.slice(Math.max(0, (m.index ?? 0) - 12), m.index ?? 0);
    const dated = MONTH.test(text) || /\b(in|since|year|of)\s*$/i.test(before);
    if (/^(19|20)\d{2}$/.test(raw) && dated && !m[0].includes("₱") && !/php/i.test(m[0]) && !m[2]) continue;
    const [pesos = "0", cents = ""] = raw.replace(/,/g, "").split(".");
    let value = Number(pesos) * 100 + Number((cents + "00").slice(0, 2));
    if (m[2]?.toLowerCase() === "k") value *= 1_000;
    if (m[2]?.toLowerCase() === "m") value *= 1_000_000;
    if (value > 0) out.push({ value, index: m.index ?? 0 });
  }
  return out;
}

/** The account a sentence names: the longest name first, whole words only. */
function accountIn(text: string, accounts: readonly string[]): string {
  const flat = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  for (const name of [...accounts].sort((a, b) => b.length - a.length)) {
    const needle = name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (needle && flat.includes(` ${needle} `)) return name;
  }
  return "";
}

/**
 * Read it, or return null when it is not a request to find a difference.
 *
 * `recorded` is what the ledger says each account holds, so that when a
 * sentence quotes both figures the one that matches the ledger is taken as
 * the ledger's and the other as the account's.
 */
export function readInvestigateAsk(
  said: string,
  accounts: readonly string[],
  recorded: (account: string) => Centavos,
  asOf?: IsoDate,
): InvestigateAsk | null {
  const text = said;
  const matchedOn = asOf ? matchedOnIn(said, asOf) : null;
  const account = accountIn(text, accounts);
  const figures = figuresIn(text.replace(NOT_MONEY, (m) => " ".repeat(m.length)));
  const mismatch = MISMATCH.test(text);
  const counted = /\b(counted|count|bilang|binilang)\b/i.test(text) && account !== "";
  // "maya app says 30,000 but here it says 50,000": two figures set against each other.
  const contrasted = account !== "" && figures.length >= 2 && HERE.test(text) && /\b(app|bank|says|shows|balance|only|but)\b/i.test(text);

  if (!mismatch && !counted && !contrasted) return null;
  // "where did I spend the most" names no account and no figure: not this.
  if (!account && figures.length === 0 && !/\b(reconcile|investigate|mismatch|discrepanc\w*|doesn'?t match|hindi match)\b/i.test(text)) {
    return null;
  }

  if (figures.length === 0) return { account, actual: null, gap: null, ...(matchedOn ? { matchedOn } : {}) };

  if (figures.length >= 2 && account) {
    const ledger = recorded(account);
    // The figure that is the ledger's own, to the peso, is not the one the account holds.
    const ledgerFigure = figures.find((f) => Math.abs(f.value - ledger) <= 100);
    // Failing that, the one said to be this app's: "here it says 50,000", read before the figure only.
    const hereFigure = ledgerFigure ?? figures.find((f) => HERE.test(text.slice(Math.max(0, f.index - 30), f.index)));
    const actual = (hereFigure ? figures.find((f) => f !== hereFigure) : undefined) ?? figures[0]!;
    return { account, actual: actual.value, gap: null, ...(matchedOn ? { matchedOn } : {}) };
  }

  const only = figures[0]!;
  const around = text.slice(Math.max(0, only.index - 40), only.index + 30);
  // "where did my 20k go": the figure is what is missing, not what is there.
  if (/\bwhere\b/i.test(text) && !REAL.test(around) && account) {
    return { account, actual: null, gap: only.value, ...(matchedOn ? { matchedOn } : {}) };
  }
  if (/\bwhere did (my|the) \S+ (go|went)|\bmissing\b|nawawala/i.test(text) && !REAL.test(around)) {
    return { account, actual: null, gap: only.value, ...(matchedOn ? { matchedOn } : {}) };
  }
  return { account, actual: only.value, gap: null, ...(matchedOn ? { matchedOn } : {}) };
}
