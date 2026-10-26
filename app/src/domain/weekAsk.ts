/**
 * "How was my week?", "weekly review", "review last week", answered by the
 * app (26 October 2026: "I want it to do more").
 *
 * A week is Monday to Sunday, as everything else counts it (`charts.ts`,
 * `windowOf`). This week runs to today and is set against the same days of
 * the week before; last week is set against the whole week before it. What
 * was spent is `costOf`, the figure every total uses.
 */
import { addDays, dayInWords, dayOfWeek } from "./dates";
import type { Centavos } from "./money";
import { costOf } from "./totals";
import type { IsoDate, Transaction } from "./types";

export interface WeekAsk {
  readonly last: boolean;
}

const ASKS =
  /\bhow\s+(?:was|is|did|has)\s+(?:my\s+|this\s+|the\s+|last\s+)?week\b|\bweek(?:ly)?\s+(?:review|summary|recap|report|check-?in)\b|\b(?:review|recap|summari[sz]e)\s+(?:my\s+|this\s+|the\s+|last\s+)?week\b|\b(?:this|last)\s+week'?s?\s+(?:review|summary|recap|report)\b/i;

export function readWeekAsk(text: string): WeekAsk | null {
  const t = text.trim();
  if (!ASKS.test(t) || /\b(?:chart|graph|pie|bars?|trend|draw|plot)\b/i.test(t)) return null;
  return { last: /\b(?:last|previous|past)\s+week\b/i.test(t) };
}

interface Span {
  readonly from: IsoDate;
  readonly to: IsoDate;
}

export function weekAnswer(ask: WeekAsk, transactions: readonly Transaction[], asOf: IsoDate, money: (c: Centavos) => string): string {
  const monday = addDays(asOf, -((dayOfWeek(asOf) + 6) % 7));
  const now: Span = ask.last ? { from: addDays(monday, -7), to: addDays(monday, -1) } : { from: monday, to: asOf };
  const days = (now.to > now.from ? Math.round((Date.parse(now.to) - Date.parse(now.from)) / 86_400_000) : 0) + 1;
  const before: Span = { from: addDays(now.from, -7), to: addDays(now.to, -7) };

  const inSpan = (s: Span) => transactions.filter((t) => t.date >= s.from && t.date <= s.to);
  const spent = (rows: readonly Transaction[]) => rows.reduce((sum, t) => sum + costOf(t), 0);
  const rows = inSpan(now);
  const out = spent(rows);
  const was = spent(inSpan(before));
  const came = rows.filter((t) => t.type === "Revenue").reduce((s, t) => s + t.amount, 0);

  const name = ask.last ? "Last week" : days === 1 ? "This week so far (today)" : `This week so far (${days} days)`;
  const lines: string[] = [
    `**${name}: ${money(out)} spent**, ${money(Math.floor(out / days))} a day${came > 0 ? `, and ${money(came)} came in` : ""}.`,
    was === out
      ? `The same as ${ask.last ? "the week before" : "the same days last week"}.`
      : `${money(Math.abs(out - was))} ${out > was ? "more" : "less"} than ${ask.last ? "the week before" : "the same days last week"} (${money(was)}).`,
  ];

  // Where it went: the three biggest kinds, then the single biggest entry.
  const byItem = new Map<string, Centavos>();
  for (const t of rows) {
    const c = costOf(t);
    if (c <= 0) continue;
    const k = t.item.trim() || (t.type === "Transfer" ? "Transfers and fees" : t.type);
    byItem.set(k, (byItem.get(k) ?? 0) + c);
  }
  const top = [...byItem].sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (top.length > 0) lines.push(`Most of it: ${top.map(([k, c]) => `${k} ${money(c)}`).join(", ")}.`);
  const biggest = rows.filter((t) => costOf(t) > 0).sort((a, b) => costOf(b) - costOf(a))[0];
  if (biggest) {
    lines.push(
      `The biggest single entry: #${String(biggest.recordNumber).padStart(4, "0")}, ${biggest.item || biggest.type}${biggest.description.trim() && biggest.description.trim().toLowerCase() !== biggest.item.trim().toLowerCase() ? ` (${biggest.description.trim().slice(0, 40)})` : ""}, ${money(costOf(biggest))} on ${dayInWords(biggest.date)}.`,
    );
  }
  // The quietest and the busiest day, when there is more than one.
  if (days > 1) {
    const perDay = new Map<IsoDate, Centavos>();
    for (let d = now.from; d <= now.to; d = addDays(d, 1)) perDay.set(d, 0);
    for (const t of rows) perDay.set(t.date, (perDay.get(t.date) ?? 0) + costOf(t));
    const sorted = [...perDay].sort((a, b) => b[1] - a[1]);
    const nothing = [...perDay].filter(([, c]) => c === 0).length;
    const busiest = sorted[0];
    if (busiest && busiest[1] > 0) lines.push(`Busiest day: ${dayInWords(busiest[0])}, ${money(busiest[1])}.${nothing > 0 ? ` ${nothing} ${nothing === 1 ? "day" : "days"} with nothing spent.` : ""}`);
  }
  return lines.join("\n");
}
