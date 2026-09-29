/**
 * An ATM cash withdrawal receipt, read and checked on the device.
 *
 * ── The receipt this exists for ────────────────────────────────────────────
 *
 * The owner, 29 September 2026, with a China Bank Savings slip: "CASH
 * WITHDRAWAL 1,000.00", "CURRENT BALANCE 2,934.79", "APPLICATION LABEL Visa
 * Credit" and "*AN ATM FEE OF 16.00 IS ALREADY INCLUDED IN THE TRANSACTION
 * AMOUNT". "it should know the withdraw amount and fee and wallet comes from
 * and since it's physical withdraw means cash".
 *
 * A withdrawal is money moving between two of the owner's own pockets: out
 * of the account the card belongs to, into Cash. So it is one Transfer, the
 * amount the machine gave as the amount and the ATM's charge as the fee,
 * which is the only part that is spending (CLAUDE.md, transfers). That is
 * how the ledger already files them: "withdraw 2000", ₱2,000.00 with a
 * ₱15.00 fee, from Maya to Cash.
 *
 * ── Which figure is the cash ───────────────────────────────────────────────
 *
 * "Already included in the transaction amount" reads as though the ₱1,000.00
 * holds the fee, but a machine gives whole hundreds and cannot give ₱984.00.
 * The ledger settles it: ₱516.00 left Maya at this same St. Louis machine on
 * 24 September, ₱500.00 and its ₱16.00 fee. So the cash is whichever of the
 * printed figure, or the printed figure less the fee, is whole hundreds, and
 * what left the account is the cash and the fee together.
 *
 * ── Never a credit card ────────────────────────────────────────────────────
 *
 * "Visa Credit" is the name the card's chip gives itself, not borrowing: a
 * slip that prints the account's balance after it came out of a deposit
 * account. Taking cash on a credit line is a Debt, and a slip that names one
 * of the owner's credit lines is left to those rules.
 */

import type { Centavos } from "./money";
import type { IsoDate, Transaction } from "./types";

export interface Withdrawal {
  /** What the machine gave. */
  readonly cash: Centavos;
  /** The ATM's charge. */
  readonly fee: Centavos;
  /** What left the account: the cash and the fee. */
  readonly debit: Centavos;
  /** The figure the slip printed as the amount. */
  readonly printed: Centavos;
  /** The account's balance after it, as the slip prints it. */
  readonly balanceAfter?: Centavos;
  readonly date?: IsoDate;
  readonly time?: string;
  /** Where the machine is, as printed ("CBS ST LOUIS LA"). */
  readonly place: string;
  readonly bank?: string;
  /** The card's network ("Visa"), which says nothing about whose account. */
  readonly network?: string;
  /** The chip's own name for the card ("Visa Credit"), printed on the slip. */
  readonly label?: string;
  readonly confidence: "high" | "medium";
  readonly evidence: readonly string[];
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Figures with centavos: "1,000.00", "PHP 16.00", "₱2,934.79". A slip always prints two places. */
function figures(line: string): Centavos[] {
  const out: Centavos[] = [];
  for (const m of line.matchAll(/(?<![\d.])(?:₱|php|p)?\s?(\d{1,3}(?:,\d{3})+|\d+)\.(\d{2})(?![\d])/gi)) {
    out.push(Number((m[1] ?? "0").replace(/,/g, "")) * 100 + Number(m[2] ?? "0"));
  }
  return out;
}

const peso = (c: Centavos): string => `PHP ${(Math.floor(c / 100)).toLocaleString("en-US")}.${String(c % 100).padStart(2, "0")}`;

function dateIn(text: string): IsoDate | undefined {
  const pad = (n: number): string => String(n).padStart(2, "0");
  // "29SEP2026", "29 SEP 2026", "29-Sep-2026"
  const dayFirst = /\b(\d{1,2})[\s-]?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?[\s,-]?(20\d{2})\b/i.exec(text);
  if (dayFirst) {
    const m = MONTHS.indexOf((dayFirst[2] ?? "").toLowerCase()) + 1;
    return `${dayFirst[3]}-${pad(m)}-${pad(Number(dayFirst[1]))}`;
  }
  // "SEP 29, 2026"
  const monthFirst = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s?(\d{1,2}),?\s?(20\d{2})\b/i.exec(text);
  if (monthFirst) {
    const m = MONTHS.indexOf((monthFirst[1] ?? "").toLowerCase()) + 1;
    return `${monthFirst[3]}-${pad(m)}-${pad(Number(monthFirst[2]))}`;
  }
  // "2026-09-29"
  const iso = /\b(20\d{2})-(\d{2})-(\d{2})\b/.exec(text);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // "09/29/26" or "09/29/2026": a Philippine machine prints the month first.
  const slash = /\b(\d{2})\/(\d{2})\/(\d{2}|20\d{2})\b/.exec(text);
  if (slash) {
    const [mm, dd, yy] = [Number(slash[1]), Number(slash[2]), slash[3] ?? ""];
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) return `${yy.length === 2 ? `20${yy}` : yy}-${pad(mm)}-${pad(dd)}`;
  }
  return undefined;
}

const BANKS: readonly [RegExp, string][] = [
  [/china\s*bank\s*savings|\bcbs\b/i, "China Bank Savings"],
  [/china\s*bank/i, "China Bank"],
  [/\bbdo\b/i, "BDO"],
  [/\bbpi\b/i, "BPI"],
  [/metrobank/i, "Metrobank"],
  [/land\s*bank/i, "Landbank"],
  [/\bpnb\b|philippine national bank/i, "PNB"],
  [/security\s*bank/i, "Security Bank"],
  [/\brcbc\b/i, "RCBC"],
  [/union\s*bank/i, "UnionBank"],
  [/east\s*west/i, "EastWest"],
  [/\bps\s*bank\b/i, "PSBank"],
  [/\bmaya\b/i, "Maya"],
];

/**
 * A cash withdrawal in what the device read off a picture, or null.
 *
 * Only a slip: a withdrawal, a machine's marks (trace, terminal, card, ATM),
 * and few figures. A wallet's history with "Withdrawal from ..." among forty
 * rows is a list, and the list rules read it.
 */
export function readWithdrawal(readings: readonly string[]): Withdrawal | null {
  for (const text of readings) {
    if (!text.trim()) continue;
    if (!/\bwithdraw(?:al|n|ing)?\b|\bw\/d\b/i.test(text)) continue;
    if (!/\b(?:atm|trace|stan|terminal|term id|card|application|location|seq(?:uence)?|ref(?:erence)?\s*(?:no|number)|approval)\b/i.test(text)) continue;
    // A deposit, a cash in or a transfer slip says so.
    if (/\b(?:deposit|cash[\s-]?in|fund transfer|bills? payment)\b/i.test(text) && !/cash withdrawal/i.test(text)) continue;
    const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    if (lines.flatMap(figures).length > 8) continue;

    // ── The printed amount ───────────────────────────────────────────────
    const onWithdrawal = lines.find((l) => /withdraw/i.test(l) && figures(l).length > 0);
    const amountAt = lines.findIndex((l) => /\bamount\b/i.test(l) && !/fee/i.test(l));
    const printed =
      (onWithdrawal ? figures(onWithdrawal)[0] : undefined) ??
      (amountAt >= 0 ? (figures(lines[amountAt] ?? "")[0] ?? figures(lines[amountAt + 1] ?? "")[0]) : undefined);
    if (printed === undefined || printed <= 0) continue;

    // ── The fee ───────────────────────────────────────────────────────────
    const feeMatch =
      /\bfee\b[^\d\n]{0,20}?(?:₱|php|p)?\s?(\d{1,3}(?:,\d{3})*|\d+)\.(\d{2})/i.exec(text) ??
      /(?:₱|php|p)?\s?(\d{1,3}(?:,\d{3})*|\d+)\.(\d{2})\s*(?:atm\s*|service\s*|convenience\s*)?fee\b/i.exec(text);
    const fee = feeMatch ? Number((feeMatch[1] ?? "0").replace(/,/g, "")) * 100 + Number(feeMatch[2] ?? "0") : 0;

    // ── Which figure the machine gave ─────────────────────────────────────
    const evidence: string[] = [];
    let cash = printed;
    let confidence: "high" | "medium" = "high";
    if (fee > 0 && printed % 10_000 !== 0 && (printed - fee) % 10_000 === 0) {
      cash = printed - fee;
      evidence.push(`${peso(printed)} printed less the ${peso(fee)} ATM fee is the ${peso(cash)} the machine gave`);
    } else if (printed % 10_000 === 0) {
      evidence.push(`${peso(cash)} is what the machine gave, in whole hundreds`);
      if (fee > 0) evidence.push(`the ${peso(fee)} ATM fee came out of the account on top of it, ${peso(cash + fee)} in all`);
    } else {
      confidence = "medium";
      evidence.push(`${peso(printed)} printed as the amount`);
      if (fee > 0) evidence.push(`and a ${peso(fee)} ATM fee`);
    }

    // ── The balance after it ──────────────────────────────────────────────
    const balanceAt = lines.findIndex((l) => /balance|\b(?:avail(?:able)?\s*)?bal\b/i.test(l));
    const balanceFigures = balanceAt >= 0 ? [...figures(lines[balanceAt] ?? ""), ...figures(lines[balanceAt + 1] ?? "")] : [];
    // "CURRENT BALANCE  AVAILABLE BALANCE" over two figures: the available one is what can be spent, and is last.
    const balanceAfter = balanceFigures.length > 0 ? balanceFigures[balanceFigures.length - 1] : undefined;

    // ── When, where, which bank ───────────────────────────────────────────
    const date = dateIn(text);
    const time = /\b(\d{1,2}:\d{2})(?::\d{2})?\b/.exec(text)?.[1];
    const timeLine = lines.find((l) => /\d{1,2}:\d{2}/.test(l)) ?? "";
    const locationAt = lines.findIndex((l) => /\blocation\b|\bbranch\b|\bterminal\b/i.test(l));
    const afterTime = timeLine.replace(/^.*?\d{1,2}:\d{2}(?::\d{2})?\s*/, "").trim();
    const place = (afterTime && /[a-z]{2}/i.test(afterTime) ? afterTime : locationAt >= 0 ? (lines[locationAt] ?? "").replace(/.*\b(?:location|branch|terminal)\b[:\s]*/i, "") : "")
      .replace(/[^A-Za-z0-9 .'-]/g, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    const bank = BANKS.find(([p]) => p.test(text))?.[1];
    const network = /\bvisa\b/i.test(text) ? "Visa" : /master\s?card/i.test(text) ? "Mastercard" : /bancnet/i.test(text) ? "BancNet" : undefined;
    const label = /application\s*label[:\s]+([A-Za-z][A-Za-z ]{2,30})/i.exec(text)?.[1]?.trim();

    return {
      cash,
      fee,
      debit: cash + fee,
      printed,
      ...(balanceAfter !== undefined ? { balanceAfter } : {}),
      ...(date ? { date } : {}),
      ...(time ? { time } : {}),
      place,
      ...(bank ? { bank } : {}),
      ...(network ? { network } : {}),
      ...(label ? { label } : {}),
      confidence,
      evidence,
    };
  }
  return null;
}

/** The owner's cash wallet: the one called Cash, or the first whose name says cash. */
export function cashWallet(wallets: readonly string[]): string {
  return wallets.find((w) => /^cash$/i.test(w.trim())) ?? wallets.find((w) => /\bcash\b/i.test(w) && !/extra|reserve|hidden/i.test(w)) ?? "";
}

export interface WithdrawalSource {
  readonly account: string;
  /** Said on the card: how the account was worked out. */
  readonly how: string;
  /** How far the ledger's balance after this would be from the slip's, when the slip printed one. */
  readonly off?: Centavos;
}

/**
 * The account the money came out of.
 *
 * First by the balance the slip prints: the account whose balance, less
 * what left it, is exactly that. Then by where the owner's own withdrawals
 * have come from: the account most of them used, the ones at the same
 * machine counting first. Otherwise nothing, and the card asks.
 */
export function withdrawalSource(
  w: Withdrawal,
  balances: ReadonlyMap<string, Centavos>,
  transactions: readonly Transaction[],
  accounts: readonly string[],
  cash: string,
): WithdrawalSource | null {
  const candidates = accounts.filter((a) => a && a !== cash);
  const money = (c: Centavos): string => peso(Math.abs(c));

  if (w.balanceAfter !== undefined) {
    const exact = candidates.filter((a) => (balances.get(a) ?? 0) - w.debit === w.balanceAfter);
    if (exact.length === 1 && exact[0]) {
      return { account: exact[0], how: `${exact[0]}: its balance less ${money(w.debit)} is the ${money(w.balanceAfter)} the slip prints`, off: 0 };
    }
  }

  // Where the owner's withdrawals have come from, newest first; the same machine counts three times.
  const placeWords = w.place.toLowerCase().split(/[^a-z]+/).filter((x) => x.length > 3 && !/^(cash|atm|bank|savings)$/.test(x));
  const tally = new Map<string, number>();
  const recent = [...transactions]
    .filter((t) => t.type === "Transfer" && t.toWallet === cash && candidates.includes(t.fromWallet) && /withdr|atm/i.test(`${t.description} ${t.notes}`))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 20);
  for (const t of recent) {
    const here = placeWords.some((word) => t.description.toLowerCase().replace(/[^a-z]+/g, " ").includes(word));
    tally.set(t.fromWallet, (tally.get(t.fromWallet) ?? 0) + (here ? 3 : 1));
  }
  const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1]);
  const top = ranked[0];
  if (!top || (ranked[1] && ranked[1][1] * 2 > top[1])) return null;
  const account = top[0];
  const sameMachine = recent.find((t) => t.fromWallet === account && placeWords.some((word) => t.description.toLowerCase().replace(/[^a-z]+/g, " ").includes(word)));
  const why = sameMachine
    ? `${account}: your withdrawal at this machine on ${sameMachine.date} came from it`
    : `${account}: your recent withdrawals came from it`;
  if (w.balanceAfter === undefined) return { account, how: why };
  const after = (balances.get(account) ?? 0) - w.debit;
  const off = w.balanceAfter - after;
  // A few pesos off is the ledger missing a small row; much more is a sign it is another account.
  const small = Math.abs(off) <= 10_000;
  return {
    account,
    how:
      off === 0
        ? `${why}, and its balance after this matches the slip`
        : small
          ? `${why}. The slip says ${money(w.balanceAfter)} is left; the ledger would have ${money(after)}, ${money(off)} ${off > 0 ? "less" : "more"}, so something small is ${off > 0 ? "missing from" : "extra in"} the ledger`
          : `${why}, but the slip says ${money(w.balanceAfter)} is left and ${account} would have ${money(after)}: check that it is the right account`,
    off,
  };
}

/** What the model is told, beside the text read off the slip. */
export function withdrawalNote(w: Withdrawal, cash: string): string {
  return [
    `This is an ATM cash withdrawal slip, checked on this device: ${w.evidence.join("; ")}.`,
    `It is one proposal: flow Transfer, amountPesos ${w.cash / 100}, feePesos ${w.fee / 100}, toWallet ${cash || "their cash wallet"}, fromWallet the account the card belongs to (empty if you cannot tell from their list)${w.date ? `, dated ${w.date}` : ""}, description Withdrawal from ${w.place || w.bank || "the ATM"}.`,
    `${w.balanceAfter !== undefined ? `${peso(w.balanceAfter)} is that account's balance after it, not a row. ` : ""}${w.label ? `"${w.label}" is the card's chip label, not borrowing: never a Debt. ` : ""}The fee is never a row of its own.`,
  ].join(" ");
}

/** Every slip among what was read, once each: a picture is read two ways and each way may find it. */
export function slipsIn(readings: readonly string[]): Withdrawal[] {
  const out: Withdrawal[] = [];
  for (const r of readings) {
    const w = readWithdrawal([r]);
    if (w && !out.some((o) => o.cash === w.cash && o.fee === w.fee && o.date === w.date && o.balanceAfter === w.balanceAfter)) out.push(w);
  }
  return out;
}

/**
 * What a withdrawal's one figure is made of, when a history shows only what
 * left the account: the cash in whole hundreds, and the rest the fee, when
 * the rest is what a machine charges (₱30.00 or less). "Withdrawal from
 * TANQUI SFLU -1,018.00" is ₱1,000.00 of cash and an ₱18.00 fee; saved whole,
 * it put ₱18.00 into Cash that never arrived. Null when the figure is whole
 * hundreds already, or too small to be cash from a machine.
 */
export function cashAndFee(total: Centavos): { cash: Centavos; fee: Centavos } | null {
  const rest = total % 10_000;
  if (total < 10_000 || rest === 0 || rest > 3_000) return null;
  return { cash: total - rest, fee: rest };
}
