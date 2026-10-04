/**
 * An e-wallet's own confirmation screen, read and checked on the device.
 *
 * ── The receipt this exists for ────────────────────────────────────────────
 *
 * The owner, 4 October 2026, with a GCash receipt: a masked name, a masked
 * +63 number, "Sent via GCash", "Amount 99.00", "Total Amount Sent ₱99.00",
 * a reference number with the date and time beside it, and a carbon banner,
 * "279g (gCO2e)". "Make sure it knows this type of receipt etc. More
 * powerful".
 *
 * Read on the device, the screen has one figure that is money and four that
 * look like it: the reference number, the phone number (whose "+" the
 * device reads as a peso sign, "₱63 O......" and four digits), the carbon
 * figure ("2799") and the date. Money on these screens is always printed
 * with two decimal places, so only those count, and the rest are named to
 * the model as not money.
 *
 * ── What each kind is in this ledger ───────────────────────────────────────
 *
 *   send       money to a person: a Transfer with no destination, which the
 *              ledger books as money gone (Money Send, CLAUDE.md "Transfers
 *              are derived"). "Send to my classmate", PHP 100.00 from Gcash,
 *              is how the owner has filed one. Spending instead only when
 *              what they said names what it paid for.
 *   bank       to a bank by InstaPay or PESONet: a Transfer, to their own
 *              account when it is one, else money gone; the transfer fee is
 *              the fee.
 *   bills      a biller: Spending, their bill of that name when they have one.
 *   load       mobile load: Spending.
 *   pay        a shop by QR or in the app: Spending, by what the shop sells.
 *   received   money in: never spending. Who sent it says what it is.
 *
 * Every figure, the date and the wallet are set from the screen after the
 * model reads it (`checkWalletReceipts` in `proposal.ts`), and with no model
 * at all the card comes from this alone.
 */

import { BANKS, dateIn } from "./withdrawal";
import type { Centavos } from "./money";
import type { IsoDate, ReferenceLists } from "./types";

export type WalletReceiptKind = "send" | "bank" | "bills" | "load" | "pay" | "received";

export interface WalletReceipt {
  /** The e-wallet whose screen it is, as it names itself ("GCash"), or empty when it does not. */
  readonly app: string;
  readonly kind: WalletReceiptKind;
  /** What reached the other side. */
  readonly amount: Centavos;
  /** What the wallet charged on top: a transfer or convenience fee. */
  readonly fee: Centavos;
  /** What left the wallet: the amount and the fee. */
  readonly total: Centavos;
  readonly date?: IsoDate | undefined;
  /** As printed: "1:30 PM". */
  readonly time?: string | undefined;
  /** The reference number, as printed. */
  readonly ref?: string | undefined;
  /** Who or what it went to (a name, a biller, a shop, a bank), or came from, as printed. */
  readonly party?: string | undefined;
  readonly confidence: "high" | "medium";
  /** How the figures were worked out, in words. */
  readonly evidence: readonly string[];
  /** Printed numbers that are not money, said so, and the figures a misreading of them would give. */
  readonly notMoney: readonly string[];
  readonly notMoneyFigures: readonly Centavos[];
}

const APPS: readonly [RegExp, string][] = [
  [/\bg\s?-?cash\b/i, "GCash"],
  [/\bpay\s?maya\b|\bmaya\b/i, "Maya"],
  [/\bgo\s?tyme\b/i, "GoTyme"],
  [/\bshopee\s?pay\b/i, "ShopeePay"],
  [/\bgrab\s?pay\b/i, "GrabPay"],
  [/\bcoins\.?ph\b/i, "Coins.ph"],
];

/* In this order: a bank transfer also says "sent", and a bill also says "paid". */
const KINDS: readonly [WalletReceiptKind, RegExp][] = [
  ["received", /\b(?:you(?:'ve| have)? received|received (?:money |php |₱)?from|money received|incoming (?:money|transfer)|cash received)\b/i],
  ["bills", /\b(?:bills? ?pay(?:ment)?|pay ?bills|biller)\b/i],
  ["load", /\b(?:buy ?load|load (?:purchase|successful|amount|sent)|regular load|prepaid load|e-?load)\b/i],
  ["bank", /\b(?:insta ?pay|peso ?net|bank transfer|send to bank|transfer to bank|bank name|account number|acct\.? ?no)\b/i],
  ["send", /\b(?:sent via|total amount sent|express send|amount sent|you(?:'ve| have)? sent|sent money|send money|money sent|successfully sent|sent to)\b/i],
  ["pay", /\b(?:pay ?qr|qr ?ph|scan to pay|merchant|paid to|paid via|you paid|payment successful|payment to)\b/i],
];

/** Not an e-wallet's screen: a shop's tape, a card terminal, an ATM. */
const ELSEWHERE = /\b(?:vat(?:able)?|tin\b|cashier|change\b|tendered|approval code|appr\.? ?code|terminal id|atm|withdrawal)\b/i;

/** A line whose digits are not money: a reference, a phone number, a carbon figure, a balance. */
const NOT_MONEY_LINE = /\bref(?:erence)?\b|\btrans(?:action)? ?(?:id|no)\b|\+\s?63|₱\s?63\s?[9o0]|\b09\d{2}\b|\bg?co2e?\b|\bgco|carbon|\bbalance\b|\bavailable\b/i;

/** The carbon figure GCash prints: "279g (gCO2e)", read on the device as "2799 (gcoze)". */
const CARBON = /\bg?co2e?\b|\bgco|\d\s?g\s?\(/i;

/** Figures with centavos: "99.00", "₱1,015.00", "PHP 15.00". These screens always print two places. */
function figures(line: string): Centavos[] {
  const out: Centavos[] = [];
  for (const m of line.matchAll(/(?<![\d.,])(?:₱|php|p)?\s?(\d{1,3}(?:,\d{3})+|\d+)\.(\d{2})(?![\d])/gi)) {
    out.push(Number((m[1] ?? "0").replace(/,/g, "")) * 100 + Number(m[2] ?? "0"));
  }
  return out;
}

const peso = (c: Centavos): string => `PHP ${Math.floor(c / 100).toLocaleString("en-US")}.${String(c % 100).padStart(2, "0")}`;

/** "Fee Free", "No fee": a fee printed as nothing. */
const FREE = /\b(?:fee|charge)\b[^\n\d]{0,12}\b(?:free|none|waived|no charge)\b|\bno (?:transfer )?fee\b|\bfree of charge\b/i;

/** The figure on a labelled line, or on the line below it when the photo moved it there. */
function labelled(lines: readonly string[], label: RegExp, not?: RegExp): Centavos | undefined {
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (!label.test(line) || (not && not.test(line)) || NOT_MONEY_LINE.test(line)) continue;
    const here = figures(line)[0];
    if (here !== undefined) return here;
    const below = lines[i + 1] ?? "";
    if (/^\s*(?:₱|php|p)?\s?[\d,]+\.\d{2}\s*$/i.test(below)) return figures(below)[0];
  }
  return undefined;
}

function partyIn(lines: readonly string[], kind: WalletReceiptKind, text: string): string | undefined {
  const tidy = (s: string): string =>
    s
      .replace(/(?:₱|php)\s?[\d,]+\.\d{2}.*$/i, "")
      .replace(/\+?\s?63\s?[9o0][\d•·●*.\s-]*$/i, "")
      .replace(/[|]/g, "")
      .replace(/\s{2,}/g, " ")
      .trim()
      .slice(0, 40);
  const ok = (s: string): boolean => /[a-z]{2}/i.test(s) && !/\b(?:gcash|maya|amount|total|fee|ref|via|successful)\b/i.test(s);
  const patterns =
    kind === "received"
      ? [/\b(?:received (?:money )?from|from)\s*[:-]?\s+(.+)$/im, /^\s*sender\s*[:-]?\s+(.+)$/im]
      : [
          /\b(?:sent to|paid to|transferred to|transfer to|send to)\s*[:-]?\s*(.+)$/im,
          /^\s*(?:to|recipient|account name|biller(?: name)?|merchant(?: name)?)\s*[:-]?\s+(.+)$/im,
        ];
  for (const p of patterns) {
    const said = tidy(p.exec(text)?.[1] ?? "");
    if (said && ok(said)) return said;
  }
  if (kind === "bank") {
    const bank = BANKS.find(([p]) => p.test(text))?.[1];
    if (bank) return bank;
  }
  // GCash prints the name masked above the number: "JU••••O DE•A C.".
  const masked = lines.find((l) => /[•·●*]/.test(l) && /[a-z]{2}/i.test(l) && !/\d{3}/.test(l));
  if (masked && ok(tidy(masked))) return tidy(masked);
  // A biller or a shop printed alone in capitals under the heading.
  if (kind === "bills" || kind === "pay" || kind === "load") {
    const named = lines.find(
      (l) => /^[A-Z0-9][A-Z0-9 &'.,-]{2,40}$/.test(l.trim()) && /[A-Z]{3}/.test(l) && !/\b(?:AMOUNT|TOTAL|FEE|REF|PAID|PAYMENT|BILLS?|LOAD|VIA|GCASH|MAYA|SUCCESSFUL|QR|ACCOUNT|DATE|NUMBER)\b/.test(l),
    );
    if (named) return named.trim();
  }
  return undefined;
}

/** One reading, with how many printed figures agreed on it. */
function readOne(text: string): { readonly receipt: WalletReceipt; readonly agreed: number } | null {
  if (!text.trim()) return null;
  const kind = KINDS.find(([, p]) => p.test(text))?.[0];
  if (!kind) return null;
  if (ELSEWHERE.test(text)) return null;
  // "...your new balance is PHP 950.00. Ref. No. ..." is three sentences on one line.
  const lines = text
    .split(/\n+|(?<=\.)\s+(?=[A-Z][a-z])/)
    .map((l) => l.trim())
    .filter(Boolean);
  const money = lines.filter((l) => !NOT_MONEY_LINE.test(l)).flatMap(figures);
  // A history list has a figure on every row: that is for the list rules.
  if (money.length === 0 || money.length > 6) return null;

  const total = labelled(lines, /\btotal\b/i);
  const amount =
    labelled(lines, /\b(?:amount(?: sent| paid| transferred)?|you sent|sent|you paid|you received|load amount|principal)\b/i, /\btotal\b|\bfee\b/i) ??
    // "you sent PHP 100.00 to": the figure inside the sentence.
    (kind === "send" || kind === "received" ? figures(lines.find((l) => /\b(?:sent|received)\b/i.test(l) && figures(l).length === 1) ?? "")[0] : undefined);
  const free = FREE.test(text);
  const printedFee = free ? 0 : labelled(lines, /\b(?:fee|charge)s?\b/i, /\btotal\b/i);

  const evidence: string[] = [];
  let confidence: WalletReceipt["confidence"] = "high";
  let amt: Centavos;
  let fee: Centavos;
  if (amount !== undefined && total !== undefined) {
    amt = amount;
    fee = printedFee ?? Math.max(0, total - amount);
    if (amount + fee !== total) {
      confidence = "medium";
      evidence.push(`${peso(amount)} printed as the amount and ${peso(total)} as the total, which do not add up with the fee`);
    } else {
      evidence.push(fee > 0 ? `${peso(amount)} and a ${peso(fee)} fee make the ${peso(total)} total` : `${peso(total)} printed as the total and as the amount, so no fee`);
    }
  } else if (total !== undefined) {
    fee = printedFee ?? 0;
    amt = total - fee;
    evidence.push(fee > 0 ? `${peso(total)} total less the ${peso(fee)} fee is ${peso(amt)}` : `${peso(total)} printed as the total${free ? ", fee free" : ""}`);
  } else if (amount !== undefined) {
    amt = amount;
    fee = printedFee ?? 0;
    evidence.push(`${peso(amount)} printed as the amount${fee > 0 ? `, and a ${peso(fee)} fee` : free ? ", fee free" : ""}`);
    if (printedFee === undefined && !free) confidence = "medium";
  } else {
    // "Sent money / ₱500.00 / to JUAN D.": one figure on the screen, and it is the money.
    const distinct = [...new Set(money.filter((c) => c > 0 && c !== printedFee))];
    if (distinct.length !== 1) return null;
    amt = distinct[0] as Centavos;
    fee = printedFee ?? 0;
    confidence = "medium";
    evidence.push(`${peso(amt)}, the only amount on the screen`);
  }
  if (amt <= 0 || fee < 0) return null;

  const app = APPS.find(([p]) => p.test(text))?.[1] ?? "";
  const dashed = /\b(\d{1,2})-(\d{1,2})-(20\d{2})\b/.exec(text);
  const date =
    dateIn(text) ??
    (dashed && Number(dashed[1]) <= 12 ? `${dashed[3]}-${String(dashed[1]).padStart(2, "0")}-${String(dashed[2]).padStart(2, "0")}` : undefined);
  const timeMatch = /\b(\d{1,2}:\d{2})(?::\d{2})?\s?([ap]\.?\s?m\.?)?/i.exec(text);
  const time = timeMatch ? `${timeMatch[1]}${timeMatch[2] ? ` ${timeMatch[2].replace(/[.\s]/g, "").toUpperCase()}` : ""}` : undefined;
  const ref = /\b(?:ref(?:erence)?|trans(?:action)?)\b\.?\s*(?:no\.?|number|id|#)?\s*[:.]?\s*([0-9][0-9A-Z -]{4,26}[0-9A-Z])/i.exec(text)?.[1]?.replace(/\s+[A-Z][a-z].*$/, "").trim();
  const party = partyIn(lines, kind, text);

  // ── What looks like money and is not ──────────────────────────────────
  const notMoney: string[] = [];
  const notMoneyFigures = new Set<Centavos>();
  const digitsOf = (s: string): void => {
    for (const d of s.match(/\d{2,}/g) ?? []) notMoneyFigures.add(Number(d) * 100);
  };
  if (ref) {
    notMoney.push(`the reference number ${ref}`);
    digitsOf(ref);
  }
  const phone = lines.find((l) => /\+\s?63|₱\s?63\s?[9o0]|\b09\d{2}\b/i.test(l));
  if (phone) {
    notMoney.push(`"${phone.slice(0, 30)}", the phone number`);
    digitsOf(phone);
  }
  const carbon = lines.find((l) => CARBON.test(l) && /\d/.test(l) && !figures(l).length);
  if (carbon) {
    notMoney.push(`the carbon figure ("${carbon.slice(0, 24)}")`);
    digitsOf(carbon);
    // "279g" read as "2799": the unit taken for a digit.
    for (const d of carbon.match(/\d{3,}/g) ?? []) notMoneyFigures.add(Math.floor(Number(d) / 10) * 100);
  }
  const balanceLine = lines.find((l) => /\bbalance\b/i.test(l) && figures(l).length > 0);
  if (balanceLine) {
    notMoney.push(`the balance (${peso(figures(balanceLine)[0] ?? 0)}), which is what is left, not a movement`);
    for (const f of figures(balanceLine)) notMoneyFigures.add(f);
  }
  if (date) {
    const [y, m, d] = date.split("-");
    notMoneyFigures.add(Number(y) * 100);
    notMoneyFigures.add(Number(d) * 100);
    notMoneyFigures.add(Number(m) * 100);
  }
  for (const real of [amt, fee, amt + fee]) notMoneyFigures.delete(real);

  const agreed = (amount !== undefined ? 1 : 0) + (total !== undefined ? 1 : 0) + (confidence === "high" ? 1 : 0);
  const receipt: WalletReceipt = {
    app,
    kind,
    amount: amt,
    fee,
    total: amt + fee,
    ...(date ? { date } : {}),
    ...(time ? { time } : {}),
    ...(ref ? { ref } : {}),
    ...(party ? { party } : {}),
    confidence,
    evidence,
    notMoney,
    notMoneyFigures: [...notMoneyFigures].filter((c) => c > 0),
  };
  return { receipt, agreed };
}

/**
 * An e-wallet's confirmation in what the device read off a picture, or null.
 *
 * Both readings of the picture are tried and joined: one may hold the
 * figure beside "Amount" and the other the masked name. The one with more
 * agreeing figures wins; the other fills what it is missing.
 */
export function readWalletReceipt(readings: readonly string[]): WalletReceipt | null {
  const read = readings.map(readOne).filter((r): r is NonNullable<ReturnType<typeof readOne>> => r !== null);
  if (read.length === 0) return null;
  const ranked = [...read].sort((a, b) => b.agreed - a.agreed);
  const best = (ranked[0] as (typeof ranked)[number]).receipt;
  const other = ranked.slice(1).map((r) => r.receipt).find((r) => r.total === best.total);
  if (!other) return best;
  return {
    ...best,
    app: best.app || other.app,
    date: best.date ?? other.date,
    time: best.time ?? other.time,
    ref: best.ref ?? other.ref,
    party: best.party ?? other.party,
    notMoney: [...new Set([...best.notMoney, ...other.notMoney])],
    notMoneyFigures: [...new Set([...best.notMoneyFigures, ...other.notMoneyFigures])],
  };
}

/** Every confirmation among what was read, once each: a picture is read two ways. */
export function walletReceiptsIn(readings: readonly string[]): WalletReceipt[] {
  const out: WalletReceipt[] = [];
  for (let i = 0; i < readings.length; i += 2) {
    const r = readWalletReceipt([readings[i] ?? "", readings[i + 1] ?? ""]);
    if (r && !out.some((o) => o.total === r.total && o.date === r.date && o.ref === r.ref)) out.push(r);
  }
  return out;
}

/** The owner's account for the app that printed it: Gcash for GCash, Maya (never Maya Bank) for Maya. */
export function walletFor(app: string, reference: Pick<ReferenceLists, "wallets" | "savings">): string {
  if (!app) return "";
  const flat = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const want = flat(app);
  return (
    reference.wallets.find((w) => flat(w) === want) ??
    reference.savings.find((w) => flat(w) === want) ??
    reference.wallets.find((w) => flat(w).startsWith(want)) ??
    ""
  );
}

/** What the card says it was, when the model wrote nothing better. */
export function describe(r: WalletReceipt): string {
  const via = r.app ? ` via ${r.app}` : "";
  switch (r.kind) {
    case "send":
      return r.party ? `Sent to ${r.party}` : `Sent${via}`;
    case "bank":
      return r.party ? `Sent to ${r.party}${via}` : `Bank transfer${via}`;
    case "bills":
      return r.party ? `${r.party} bill${via}` : `Bill paid${via}`;
    case "load":
      return `Load${via}`;
    case "pay":
      return r.party ? `Paid to ${r.party}` : `Paid${via}`;
    case "received":
      return r.party ? `From ${r.party}` : `Received${via}`;
  }
}

/** The owner's bill the biller is: "GLOBE TELECOM" is Globe at Home Wifi when that is their only Globe bill. */
export function billFor(party: string, bills: readonly string[]): string {
  const flat = (v: string): string => ` ${v.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
  const said = flat(party);
  const fits = bills.filter((b) => {
    const first = flat(b).trim().split(" ")[0] ?? "";
    return first.length >= 3 && said.includes(` ${first} `);
  });
  return fits.length === 1 ? (fits[0] ?? "") : "";
}

const KIND_WORDS: Record<WalletReceiptKind, string> = {
  send: "money sent to a person",
  bank: "a transfer to a bank",
  bills: "a bill payment",
  load: "a load purchase",
  pay: "a payment to a shop",
  received: "money received",
};

/** What the model is told, beside the text read off the screen. */
export function walletReceiptNote(r: WalletReceipt, wallet: string): string {
  const where = wallet || (r.app ? `their ${r.app} wallet` : "the wallet this screen is from");
  const on = r.date ? `, dated ${r.date}${r.time ? ` at ${r.time}` : ""}` : "";
  const to = r.party ? ` ${r.kind === "received" ? "from" : "to"} ${r.party}` : "";
  const what: Record<WalletReceiptKind, string> = {
    send: `flow Transfer with toWallet empty (it left their accounts), fromWallet ${where}, amountPesos ${r.amount / 100}, feePesos ${r.fee / 100}${on}, description ${describe(r)}. Only when what they said names what it paid for, flow Spending with that item instead; when the name is their own, a Transfer to that account`,
    bank: `flow Transfer, fromWallet ${where}, toWallet the account it reached when it is one of theirs, else empty, amountPesos ${r.amount / 100}, feePesos ${r.fee / 100}${on}`,
    bills: `flow Spending, the bill on their list that the biller is (category Bills), fromWallet ${where}, amountPesos ${r.amount / 100}, feePesos ${r.fee / 100}${on}`,
    load: `flow Spending, their item for load, fromWallet ${where}, amountPesos ${r.amount / 100}${on}`,
    pay: `flow Spending, the item by what the shop sells, fromWallet ${where}, amountPesos ${r.amount / 100}, feePesos ${r.fee / 100}${on}, description ${describe(r)}`,
    received: `money into toWallet ${where}, amountPesos ${r.amount / 100}${on}: never Spending. From their own name it is a Transfer from that account; from a credit line it is borrowing; from anyone else Revenue with item empty, so they are asked`,
  };
  return [
    `This is ${r.app ? `a ${r.app}` : "an e-wallet"} confirmation of ${KIND_WORDS[r.kind]}${to}, checked on this device: ${r.evidence.join("; ")}.`,
    `It is one proposal: ${what[r.kind]}.`,
    r.notMoney.length > 0 ? `Not amounts, never rows: ${r.notMoney.join("; ")}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}
