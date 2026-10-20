/**
 * "How much have I earned since the beginning of this database?", "how much
 * I earned since 2022?", "all income, not only Framelink": worked out here,
 * not by the model.
 *
 * 13 October 2026: the first was answered with one business's income,
 * carried over from the question before; "No framelink media, like all
 * incoming in the system" was answered by taking the business's all-time
 * total from this year's income. The figure is the same true income the
 * Insights screen shows (`incomeQuality`): borrowing, opening balances and
 * money moved between your own accounts are left out, and said so.
 */
import { incomeQuality, type Debt } from "./debt";
import { formatMedium } from "./dates";
import { formatMoney, type Centavos } from "./money";
import type { IsoDate, Transaction } from "./types";

export interface EarnAsk {
  readonly from: IsoDate | null;
  /** One source only, as the ledger names it. */
  readonly only: string | null;
  /** A source left out: "not Framelink", "except Allowance". */
  readonly except: string | null;
}

const ASKS = /\b(?:how much|magkano|total|what(?:'s| is| was)?|all)\b[^?.!]*\b(?:earn(?:ed|t|ings?)?|income|incoming|received|came in|made|kinita|kumita|revenue)\b|\b(?:all|total)\s+(?:my\s+)?(?:income|incoming|earnings|revenue)\b/i;
const NOT_THIS = /\b(?:can|could|will|should|would|budget|need|if i|what if|plan|expect\w*|left|spend|spent|spending|this (?:week|month)|last (?:week|month)|today|yesterday)\b/i;
const EVER = /\b(?:since (?:the )?(?:beginning|start)|from the (?:beginning|start)|ever|all[- ]time|whole (?:database|ledger|record|system|time)|entire (?:database|ledger|record|system)|in the (?:database|system|ledger)|overall|so far in total)\b/i;

export function readEarnAsk(said: string, sources: readonly string[], asOf: IsoDate): EarnAsk | null {
  const text = said.trim();
  if (!ASKS.test(text) || NOT_THIS.test(text)) return null;
  const since = /\bsince\s+(20\d{2})\b|\bfrom\s+(20\d{2})\b/i.exec(text);
  const year = since ? Number(since[1] ?? since[2]) : null;
  if (year === null && !EVER.test(text)) return null;
  if (year !== null && year > Number(asOf.slice(0, 4))) return null;
  const named = (k: string): RegExp => new RegExp(`\\b${k.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  const firstWord = (k: string): RegExp => new RegExp(`\\b${(k.trim().split(/\s+/)[0] ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  const source = [...sources]
    .filter((k) => k.trim().length >= 3)
    .sort((a, b) => b.length - a.length)
    .find((k) => named(k).test(text) || (k.trim().split(/\s+/)[0]?.length ?? 0) >= 4 && firstWord(k).test(text));
  const before = source ? text.slice(0, text.search(firstWord(source))) : "";
  /*
   * "No framelink media like all incoming in the system" is "no, not just
   * Framelink: all of it", after an answer about Framelink alone. A bare
   * leading "no" with "all" after the name is that correction, never an
   * exclusion (20 October 2026 replay of 13 October).
   */
  const correctsToAll = source !== undefined && /^\s*no\b[,.!]?\s*$/i.test(before) && /\b(?:all|every\w*|lahat|whole|total)\b/i.test(text.slice(before.length));
  if (correctsToAll) return { from: year !== null ? `${year}-01-01` : null, only: null, except: null };
  const excluded = source && new RegExp(String.raw`\b(?:no|not|except|excluding|without|other than|apart from|besides|hindi)\b[^.?!]{0,24}$`, "i").test(before);
  return { from: year !== null ? `${year}-01-01` : null, only: source && !excluded ? source : null, except: source && excluded ? source : null };
}

export function earnAnswer(ask: EarnAsk, transactions: readonly Transaction[], debts: readonly Debt[], asOf: IsoDate): string {
  const live = transactions.filter((t) => !(t as Transaction & { deletedAt?: string }).deletedAt && t.date <= asOf);
  const first = live.reduce<IsoDate | null>((at, t) => (at === null || t.date < at ? t.date : at), null);
  const from = ask.from ?? first ?? asOf;
  const same = (t: Transaction, k: string): boolean => t.item.trim().toLowerCase() === k.trim().toLowerCase();
  const rows = live.filter((t) => t.date >= from && (!ask.only || same(t, ask.only)) && (!ask.except || !same(t, ask.except)));
  const q = incomeQuality(rows, debts, { start: from, end: asOf });
  const money = (c: Centavos): string => `PHP ${formatMoney(c).replace(/^[−-]?₱/, "")}`;

  // By source, the same rows the true income counts.
  const left = new Set(["cash on hand", "transfer of balance"]);
  const counted = rows.filter((t) => t.type === "Revenue" && t.category !== "Opening" && !left.has(t.item.trim().toLowerCase()));
  const by = new Map<string, Centavos>();
  for (const t of counted) by.set(t.item.trim() || "No item", (by.get(t.item.trim() || "No item") ?? 0) + t.total);
  const ranked = [...by.entries()].sort((a, b) => b[1] - a[1]);
  const what = ask.only ? ` from ${ask.only}` : ask.except ? ` leaving out ${ask.except}` : "";
  const out = [
    `You received **${money(q.trueIncome)}**${what} from ${formatMedium(from)} to ${formatMedium(asOf)}, over ${counted.length} ${counted.length === 1 ? "entry" : "entries"}.`,
  ];
  if (!ask.only && ranked.length > 1) {
    out.push(`By source: ${ranked.slice(0, 6).map(([k, v]) => `${k} ${money(v)} (${q.trueIncome > 0 ? Math.round((v * 100) / q.trueIncome) : 0}%)`).join(", ")}${ranked.length > 6 ? `, and ${ranked.length - 6} more` : ""}.`);
  }
  const outside = q.cashIn - q.trueIncome;
  if (outside > 0) out.push(`Left out as not earned: ${money(outside)} of borrowing, opening balances and money moved between your own accounts.`);
  if (q.borrowed > 0 && !ask.only) out.push(`Borrowed in the same time: ${money(q.borrowed)}, which is not income.`);
  return out.join(" ");
}
