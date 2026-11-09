/**
 * Three questions that pick one thing out (9 November 2026 sweep): the
 * biggest spending day, the most expensive purchase, and which of two kinds
 * took more. Each drew spending by kind, went to the model with nothing
 * worked out, or answered about an earlier chart.
 */
import { formatMedium } from "./dates";
import { formatMoney } from "./money";
import { costOf } from "./totals";
import type { IsoDate, Transaction } from "./types";

/** "biggest spending day", "which date did I spend the most", "worst day". */
export const asksBiggestDay = (text: string): boolean =>
  /\b(?:biggest|highest|largest|worst|most\s+expensive|heaviest)\s+(?:spending\s+)?(?:day|date)\b|\b(?:which|what)\s+date\b[^?]{0,30}\b(?:spen[dt]|most)\b/i.test(text);

/** "most expensive purchase", "biggest thing I bought", "largest transaction". */
export const asksDearest = (text: string): boolean =>
  /\b(?:most\s+expensive|priciest|biggest|largest|highest|costliest)\s+(?:single\s+)?(?:purchase|buy|thing|item\s+i\s+bought|entry|transaction|expense\s+entry|spend)\b|\bbiggest\s+thing\s+i\s+(?:bought|paid)\b/i.test(text);

/** Two of the owner's own kinds set against each other: "more on food or treats", "food vs treat". */
export function eitherAsked(text: string, kinds: readonly string[]): [string, string] | null {
  if (!/\b(?:or|vs\.?|versus|than|compared?\s+(?:to|with))\b/i.test(text) || !/\b(?:more|less|most|bigger|higher|which|compare|vs|versus)\b/i.test(text)) return null;
  const lower = text.toLowerCase();
  // In the order they were said: "more on food or treats" is Food, then Treat.
  const said = [...kinds]
    .filter((k) => k.trim().length >= 3)
    .map((k) => {
      const word = k.trim().toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return { k, at: lower.search(new RegExp(`(?<![a-z0-9])${word}(?:s|es)?(?![a-z0-9])`)) };
    })
    .filter((x) => x.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((x) => x.k);
  const two = [...new Set(said)].slice(0, 2);
  return two.length === 2 ? [two[0]!, two[1]!] : null;
}

export function eitherWords(pair: readonly [string, string], rows: readonly Transaction[], w: { readonly from: IsoDate; readonly to: IsoDate; readonly name: string }): string {
  const on = (kind: string): { amount: number; entries: number } => {
    const hit = rows.filter((t) => t.date >= w.from && t.date <= w.to && !(t as Transaction & { deletedAt?: string }).deletedAt && t.item.trim().toLowerCase() === kind.toLowerCase() && costOf(t) > 0);
    return { amount: hit.reduce((s, t) => s + costOf(t), 0), entries: new Set(hit.map((t) => t.coveredBy ?? t.id)).size };
  };
  const [a, b] = pair.map((k) => ({ kind: k, ...on(k) })) as [{ kind: string; amount: number; entries: number }, { kind: string; amount: number; entries: number }];
  const [more, less] = a.amount >= b.amount ? [a, b] : [b, a];
  const line = (x: typeof a): string => `${x.kind} ${formatMoney(x.amount)} over ${x.entries} ${x.entries === 1 ? "entry" : "entries"}`;
  if (more.amount === 0) return `Nothing was spent on ${a.kind} or ${b.kind} in ${w.name}.`;
  if (more.amount === less.amount) return `The same on both in ${w.name}: ${line(a)}, ${line(b)}.`;
  return `**More on ${more.kind} in ${w.name}: ${formatMoney(more.amount - less.amount)} more.** ${line(more)}; ${line(less)}.`;
}

/** The largest entries in a window, three at most, each as the owner saved it. */
export function dearestWords(rows: readonly Transaction[], w: { readonly from: IsoDate; readonly to: IsoDate; readonly name: string }): string {
  const entries = new Map<string, { cost: number; t: Transaction }>();
  for (const t of rows) {
    if (t.date < w.from || t.date > w.to || (t as Transaction & { deletedAt?: string }).deletedAt || t.type !== "Spending") continue;
    const key = t.coveredBy ?? t.id;
    const was = entries.get(key);
    entries.set(key, { cost: (was?.cost ?? 0) + Math.max(0, costOf(t)), t: was?.t ?? t });
  }
  const top = [...entries.values()].filter((e) => e.cost > 0).sort((a, b) => b.cost - a.cost).slice(0, 3);
  if (top.length === 0) return `Nothing was spent in ${w.name}.`;
  const say = (e: (typeof top)[number]): string => `#${String(e.t.recordNumber).padStart(4, "0")} ${e.t.item || e.t.category}${e.t.description ? `, ${e.t.description}` : ""}: ${formatMoney(e.cost)} on ${formatMedium(e.t.date)}`;
  const [first, ...rest] = top;
  return [`**The most expensive in ${w.name}: ${say(first!)}.**`, ...(rest.length > 0 ? [`Then ${rest.map(say).join("; ")}.`] : [])].join(" ");
}
