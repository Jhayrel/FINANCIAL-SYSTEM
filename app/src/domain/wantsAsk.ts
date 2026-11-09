/**
 * "My bad spending", "unnecessary expenses", "my wants": the kinds of
 * spending the owner marked Discretionary in Settings, never all of it.
 *
 * The owner, 9 November 2026: "Can you show me a trend of my bad spending"
 * drew every peso spent, day by day. The app already knows which kinds are
 * wants (each kind of spending is marked Essential, Discretionary or
 * Emergency), so a chart of bad spending is a chart of those kinds, said as
 * "Wants", with the kinds named under it.
 */
import type { Chart, ChartRow } from "./charts";
import { formatMoney, type Centavos } from "./money";
import { costOf } from "./totals";
import type { IsoDate, Necessity, SpendingType, Transaction } from "./types";

const WANTS =
  /\b(?:bad|unnecessary|needless|wasteful|wasted|impulse|impulsive|non-?essential|discretionary|luxury|luxuries|frivolous|optional|extra)\s+(?:spending|spendings|expenses?|purchases?|spend|buys?|buying|gastos|stuff|things|habits?)\b|\b(?:spending|spent|spend)\s+on\s+(?:my\s+)?(?:wants|luxuries|non-?essentials)\b|\bmy\s+wants\b|\bwants\s+(?:spending|only|trend|chart)\b|\bluho\b|\bgastos\s+na\s+(?:hindi\s+kailangan|walang\s+kwenta)\b/i;
const NEEDS =
  /\b(?:good|necessary|needed|essential|important|basic)\s+(?:spending|spendings|expenses?|purchases?|spend|gastos)\b|\b(?:spending|spent|spend)\s+on\s+(?:my\s+)?(?:needs|essentials|necessities)\b|\bmy\s+needs\b|\bneeds\s+(?:spending|only|trend|chart)\b/i;

/** Which marked kinds the words are about, if they ask about wants or needs. */
export function necessityAsked(text: string): { readonly necessity: Necessity; readonly label: string; readonly phrase: RegExp } | null {
  if (WANTS.test(text)) return { necessity: "discretionary", label: "Wants", phrase: WANTS };
  if (NEEDS.test(text)) return { necessity: "essential", label: "Needs", phrase: NEEDS };
  return null;
}

/**
 * The question with the phrase put as the owner's own kinds, for the chart
 * readers to narrow to ("Treat and Fun and Travel spending"), and the kinds.
 * Null when the words ask about neither, or nothing is marked that way.
 */
export function asKinds(text: string, types: readonly Pick<SpendingType, "name" | "necessity">[]): { readonly text: string; readonly kinds: readonly string[]; readonly label: string; readonly unmarked: number } | null {
  const asked = necessityAsked(text);
  if (!asked) return null;
  const kinds = types.filter((t) => t.necessity === asked.necessity).map((t) => t.name);
  const unmarked = types.filter((t) => !t.necessity).length;
  if (kinds.length === 0) return { text, kinds, label: asked.label, unmarked };
  const said = kinds.length === 1 ? `${kinds[0]} spending` : `${kinds.join(" and ")} spending`;
  return { text: text.replace(asked.phrase, said), kinds, label: asked.label, unmarked };
}

/** Under the chart: which kinds it counts, so the owner can see what "bad" was taken to mean. */
export function kindsNote(label: string, kinds: readonly string[], unmarked: number): string {
  const mark = label === "Wants" ? "Discretionary" : "Essential";
  return `${label}: the kinds marked ${mark} in Settings, Categories (${kinds.join(", ")}).${unmarked > 0 ? ` ${unmarked} ${unmarked === 1 ? "kind is" : "kinds are"} not marked either way and left out.` : ""}`;
}

/** Wants and needs both: "wants vs needs", "needs and wants", "split my spending into needs and wants". */
export const asksBoth = (text: string): boolean => /\bwants?\b/i.test(text) && /\bneeds?\b/i.test(text) && !/\bi\s+(?:want|need)\b/i.test(text);

export interface NecessitySplit {
  readonly needs: Centavos;
  readonly wants: Centavos;
  readonly emergency: Centavos;
  readonly unmarked: Centavos;
  /** Each kind with what it came to and its mark, largest first. */
  readonly kinds: readonly { readonly name: string; readonly amount: Centavos; readonly necessity: Necessity | null }[];
}

/**
 * Day-to-day spending in a window by the owner's marks, the way the health
 * check reads it (`health.ts`): only rows filed as Spending, so bills and
 * subscriptions stay apart, and a kind with no mark said as not marked.
 */
export function necessitySplit(rows: readonly Transaction[], from: IsoDate, to: IsoDate, types: readonly Pick<SpendingType, "name" | "necessity">[]): NecessitySplit {
  const mark = new Map(types.map((t) => [t.name.trim().toLowerCase(), t.necessity ?? null] as const));
  const byKind = new Map<string, { amount: Centavos; necessity: Necessity | null }>();
  for (const t of rows) {
    if (t.date < from || t.date > to || (t as Transaction & { deletedAt?: string }).deletedAt || t.type !== "Spending" || t.category !== "Spending") continue;
    const cost = Math.max(0, costOf(t));
    if (cost === 0) continue;
    const name = t.item.trim() || "No kind";
    const was = byKind.get(name);
    byKind.set(name, { amount: (was?.amount ?? 0) + cost, necessity: mark.get(name.toLowerCase()) ?? null });
  }
  const kinds = [...byKind.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.amount - a.amount);
  const sum = (n: Necessity | null): Centavos => kinds.filter((k) => k.necessity === n).reduce((s, k) => s + k.amount, 0);
  return { needs: sum("essential"), wants: sum("discretionary"), emergency: sum("emergency"), unmarked: sum(null), kinds };
}

/** Needs, wants, emergencies and not marked, as one picture of the whole. */
export function buildNecessityChart(split: NecessitySplit, windowName: string, pie = false): Chart | null {
  const parts: [string, Centavos][] = ([["Needs", split.needs], ["Wants", split.wants], ["Emergencies", split.emergency], ["Not marked", split.unmarked]] as [string, Centavos][]).filter(([, v]) => v > 0);
  if (parts.length === 0) return null;
  const top = Math.max(...parts.map(([, v]) => v), 1);
  const rows: ChartRow[] = parts.map(([label, value]) => ({ label, value, share: value / top, count: split.kinds.filter((k) => (label === "Needs" ? k.necessity === "essential" : label === "Wants" ? k.necessity === "discretionary" : label === "Emergencies" ? k.necessity === "emergency" : k.necessity === null)).length }));
  return {
    title: `Needs and wants, ${windowName}`,
    by: "item",
    kind: pie ? "pie" : "bars",
    rows,
    total: parts.reduce((s, [, v]) => s + v, 0),
    othersCount: 0,
    direction: "spending",
    scope: "By the marks on each kind of spending in Settings, Categories. Bills and subscriptions are apart.",
  };
}

/** The split in words: each side, its share, and its largest kinds. */
export function necessityWords(split: NecessitySplit, windowName: string): string {
  const total = split.needs + split.wants + split.emergency + split.unmarked;
  if (total === 0) return `Nothing was spent day to day in ${windowName}.`;
  const pct = (v: Centavos): string => `${Math.round((v * 100) / total)}%`;
  const top = (n: Necessity | null): string =>
    split.kinds
      .filter((k) => k.necessity === n)
      .slice(0, 3)
      .map((k) => `${k.name} ${formatMoney(k.amount)}`)
      .join(", ");
  const out = [`**Day-to-day spending in ${windowName}: ${formatMoney(total)}.**`];
  if (split.needs > 0) out.push(`- Needs: ${formatMoney(split.needs)}, ${pct(split.needs)} (${top("essential")})`);
  if (split.wants > 0) out.push(`- Wants: ${formatMoney(split.wants)}, ${pct(split.wants)} (${top("discretionary")})`);
  if (split.emergency > 0) out.push(`- Emergencies: ${formatMoney(split.emergency)}, ${pct(split.emergency)} (${top("emergency")})`);
  if (split.unmarked > 0) out.push(`- Not marked either way: ${formatMoney(split.unmarked)} (${top(null)}). Mark them in Settings, Categories and they are counted.`);
  out.push("Bills and subscriptions are apart, as on the Dashboard's health check.");
  return out.join("\n");
}
