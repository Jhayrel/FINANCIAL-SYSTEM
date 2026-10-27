/**
 * What is said back to a Planner card still waiting in the chat.
 *
 * The owner, 27 October 2026, with a card for a PHP 10,000.00 trip open:
 * "Before adding that what do you think?" was answered with where the month's
 * spending went, and a second card for the same trip; "Its not safe spend"
 * was answered with today's safe to spend, and the card still read "Counted
 * in December 2026". Both were about the card. One is a question about it,
 * answered here from the figures; the other changes it.
 *
 * Nothing here saves anything: a change makes the card again, and the card
 * is pressed as before.
 */
import { MONTH_NAMES } from "./dates";
import { formatMoney, type Centavos } from "./money";
import { dueFor, NO_DATE, planKinds, whenOf, type DueKind, type PlanInput } from "./planner";
import { NO_DAY, sumIn, whenFor } from "./plannerAsk";
import type { IsoDate, ReferenceLists } from "./types";

/** "What do you think?", "is it okay?", "any advice before I add it?": an opinion on the plan on the card. */
export function asksPlanOpinion(text: string): boolean {
  const t = text.trim();
  if (!t || t.split(/\s+/).length > 20) return false;
  return /\b(?:what\s+(?:do|would)\s+you\s+(?:think|say|suggest|recommend)|what'?s\s+your\s+(?:take|opinion|advice|thoughts?)|your\s+(?:opinion|take|advice|suggestion|thoughts?)|any\s+(?:advice|suggestions?|tips?)|thoughts\s*\?|is\s+(?:it|this|that)\s+(?:ok(?:ay)?|good|wise|fine|smart|realistic|doable|possible|a\s+good\s+idea|worth\s+it|too\s+much)|should\s+i\s+(?:add|do|plan|push|go|continue|proceed|save)\b|can\s+i\s+(?:afford|do)\s+(?:it|this|that)|kaya\s+(?:ko\s+)?ba|ok(?:ay)?\s+lang\s+ba|ano\s+(?:sa\s+tingin|masasabi)\s+mo|before\s+(?:adding|i\s+add|saving))/i.test(t);
}

export interface PlanCardChange {
  readonly input: PlanInput;
  /** What changed, in a few words each: "not counted in safe to spend". */
  readonly changed: readonly string[];
  /** Asked for, and already so: said back rather than changed. */
  readonly already: readonly string[];
}

const NOT_COUNTED =
  /\b(?:not|don'?t|do\s+not|never|no|wag|huwag)\b[^.?!]{0,24}\b(?:safe(?:\s+to)?\s+spend|count(?:ed|ing)?|set\s+aside|reserved?)\b|\b(?:leave|keep|take)\s+it\s+out\s+of\s+(?:the\s+)?safe(?:\s+to)?\s+spend\b/i;
const COUNTED = /\b(?:count|include)\s+it\b|\bset\s+(?:it\s+)?aside\b|\bput\s+it\s+in\s+safe(?:\s+to)?\s+spend\b/i;
const WANT = /\b(?:it'?s|its|it\s+is|this\s+is|mark\s+it(?:\s+as)?|make\s+it)\s+(?:a\s+|just\s+a\s+|only\s+a\s+)?want\b|\bnot\s+a\s+need\b/i;
const NEED = /\b(?:it'?s|its|it\s+is|this\s+is|mark\s+it(?:\s+as)?|make\s+it)\s+(?:a\s+)?need\b|\bnot\s+a\s+want\b/i;
const MONTHS = String.raw`(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)`;

/** An amount said as a change: "make it 8k", "8000 instead", "just 8000", "lower it to 7500". */
function amountIn(text: string): Centavos | null {
  const said =
    /\b(?:make|change|set|lower|raise|put|update|increase|decrease|reduce|bring|cut)\s+(?:it|the\s+amount|amount|the\s+budget)?\s*(?:down|up)?\s*(?:to|into|at|as)?\s*(?:₱|php\s*)?\d/i.test(text) ||
    /(?:₱|php\s*)?\d[\d,]*(?:\.\d+)?\s*k?\s+(?:instead|only|lang|na\s+lang)\b/i.test(text) ||
    /^(?:just|only|actually|maybe|around|about)?\s*(?:₱|php\s*)?\d[\d,]*(?:\.\d+)?\s*k?\s*(?:pesos?)?\s*$/i.test(text) ||
    /\bamount\b[^.?!]{0,12}\d/i.test(text);
  if (!said) return null;
  // Days and years are not the amount: "make it 8k on dec 20".
  const bare = text.replace(new RegExp(String.raw`\b${MONTHS}\.?\s+\d{1,2}(?:st|nd|rd|th)?\b|\b\d{1,2}(?:st|nd|rd|th)\b|\b20\d{2}\b`, "gi"), " ");
  const amount = sumIn(bare);
  return amount !== null && amount > 0 ? amount : null;
}

/** A change to the plan on the card, said in words. Null when the message changes nothing on it. */
export function readPlanCardChange(
  text: string,
  input: PlanInput,
  ctx: { readonly reference: Pick<ReferenceLists, "wallets" | "savings" | "spendingTypes" | "bills" | "subscriptions" | "stopped">; readonly asOf: IsoDate },
): PlanCardChange | null {
  const t = text.trim().replace(/\s+/g, " ");
  if (!t || t.split(" ").length > 18) return null;
  // A question is asked, not applied, unless it asks for the change: "can you make it 8k?".
  if (/\?\s*$/.test(t) && !/^(?:can|could|pls|please)\s+(?:you\s+)?(?:make|change|set|move|lower|raise|put|call|rename|count|include)\b/i.test(t)) return null;

  let next: PlanInput = { ...input };
  const changed: string[] = [];
  const already: string[] = [];

  if (NOT_COUNTED.test(t)) {
    if (input.setAside) {
      next = { ...next, setAside: false };
      changed.push("not counted in safe to spend");
    } else already.push("It is not counted in safe to spend already.");
  } else if (COUNTED.test(t)) {
    if (!input.setAside) {
      next = { ...next, setAside: true };
      changed.push("counted in safe to spend");
    } else already.push("It is counted in safe to spend already.");
  }

  if (WANT.test(t)) {
    if (input.need) {
      next = { ...next, need: false };
      changed.push("a want");
    } else already.push("It is marked a want already.");
  } else if (NEED.test(t)) {
    if (!input.need) {
      next = { ...next, need: true };
      changed.push("a need");
    } else already.push("It is marked a need already.");
  }

  const amount = amountIn(t);
  if (amount !== null && amount !== input.amount) {
    next = { ...next, amount };
    changed.push(`amount ${formatMoney(amount)}`);
  }

  // When: a day, a month, a year, or no date at all.
  if (NO_DAY.test(t) || /\b(?:remove|clear|no)\s+(?:the\s+)?date\b/i.test(t)) {
    if (input.due !== NO_DATE) {
      next = { ...next, due: NO_DATE, dueKind: "none" };
      changed.push("no date yet");
    }
  } else {
    const when = /\b(?:on|by|in|for|to|until|before|move|date|sa)\b|\b20\d{2}\b/i.test(t) ? whenFor(t, ctx.asOf) : null;
    if (when && when.due >= ctx.asOf) {
      const kind: DueKind = when.kind;
      const due = dueFor(kind, when.due);
      if (due !== input.due || kind !== (input.dueKind ?? "day")) {
        next = { ...next, due, dueKind: kind };
        changed.push(whenOf({ due, dueKind: kind }).replace(/^S/, "s"));
      }
    }
  }

  const named = /\b(?:call|name|rename|title)\s+it\s+(?:to\s+|as\s+)?["'“]?(.{2,60}?)["'”]?\s*[.!]?$/i.exec(t);
  if (named?.[1]) {
    const title = named[1].trim().replace(/^./, (c) => c.toUpperCase());
    if (title && title !== input.title) {
      next = { ...next, title };
      changed.push(`called "${title}"`);
    }
  }

  const accounts = [...ctx.reference.wallets, ...ctx.reference.savings];
  const from = /\b(?:from|using|via|pay\s+(?:it\s+)?(?:from|with|using))\s+(?:my\s+)?([a-z][\w ().-]{1,40}?)\s*[.!]?$/i.exec(t);
  const wallet = from?.[1] ? accounts.find((a) => a.toLowerCase() === from[1]!.trim().toLowerCase()) ?? accounts.find((a) => a.toLowerCase().startsWith(from[1]!.trim().toLowerCase())) : undefined;
  if (wallet && wallet !== input.wallet) {
    next = { ...next, wallet };
    changed.push(`paid from ${wallet}`);
  }

  const kinds = planKinds(ctx.reference).options;
  const kindSaid =
    /\b(?:kind|category|type)\s*(?:is|to|:|as)?\s+(.{2,40}?)\s*[.!]?$/i.exec(t) ??
    /\b(?:file|put)\s+it\s+(?:as|under|in)\s+(.{2,40}?)\s*[.!]?$/i.exec(t) ??
    /^(?:it'?s|its|it\s+is)\s+(?:a\s+|for\s+)?(.{2,40}?)\s*[.!]?$/i.exec(t);
  const kind = kindSaid?.[1] ? kinds.find((k) => k.toLowerCase() === kindSaid[1]!.trim().toLowerCase()) : undefined;
  if (kind && kind !== input.item) {
    next = { ...next, item: kind };
    changed.push(`kind ${kind}`);
  }

  if (changed.length === 0 && already.length === 0) return null;
  return { input: next, changed, already };
}

/** The figures an opinion is worked from, gathered by the chat (budgetAdvice, the month's brief). */
export interface PlanOpinionFacts {
  readonly asOf: IsoDate;
  /**
   * The plan's month as "how much do I need" works it out: a usual month,
   * the other plans in it, and what usually comes in. Null with no date, too
   * far ahead, or no income to go by.
   */
  readonly month: { readonly name: string; readonly usual: Centavos; readonly others: Centavos; readonly income: Centavos } | null;
  /** Safe to spend until this month ends: the spending wallets less what is still due. */
  readonly freeNow: Centavos | null;
  /** What the savings accounts hold. */
  readonly savings: Centavos;
}

/** Whole months from this month to the plan's, at least one. */
function monthsTo(asOf: IsoDate, due: IsoDate): number {
  return Math.max(1, (Number(due.slice(0, 4)) - Number(asOf.slice(0, 4))) * 12 + (Number(due.slice(5, 7)) - Number(asOf.slice(5, 7))));
}

/** Rounded down to the hundred, for a figure to aim at rather than to pay. */
const hundred = (c: Centavos): Centavos => Math.floor(c / 10_000) * 10_000;

/** An opinion on the plan on the card, from the figures: how its month looks with it, how to get ready, and a suggestion. */
export function planOpinion(plan: PlanInput, f: PlanOpinionFacts): string {
  const amount = plan.amount ?? 0;
  const when = plan.due === NO_DATE ? "with no date yet" : whenOf({ due: plan.due, dueKind: plan.dueKind }).replace(/^S/, "s");
  const lines: string[] = [`**${plan.title}, ${formatMoney(amount)}, ${when}.** Here is how it looks before you add it.`];
  const monthName = plan.due === NO_DATE ? "" : (MONTH_NAMES[Number(plan.due.slice(5, 7)) - 1] ?? "that month");
  const thisMonth = plan.due !== NO_DATE && plan.due.slice(0, 7) === f.asOf.slice(0, 7);
  const months = plan.due === NO_DATE ? 0 : monthsTo(f.asOf, plan.due);
  const perMonth = months >= 2 ? Math.ceil(amount / months) : amount;

  let gap: Centavos | null = null;
  let spare: Centavos | null = null;
  if (f.month) {
    const need = f.month.usual + f.month.others + amount;
    gap = f.month.income - need;
    spare = f.month.income - f.month.usual - f.month.others;
    lines.push(
      `- ${f.month.name}: a usual month costs ${formatMoney(f.month.usual)}${f.month.others > 0 ? ` and its other plans ${formatMoney(f.month.others)}` : ""}. With this it comes to ${formatMoney(need)}, against about ${formatMoney(f.month.income)} that usually comes in: ${gap >= 0 ? `${formatMoney(gap)} to spare` : `${formatMoney(-gap)} short`}.`,
    );
  }
  if (thisMonth && f.freeNow !== null) {
    lines.push(`- It is due this month. Safe to spend until the month ends is ${formatMoney(Math.max(0, f.freeNow))}${f.freeNow < amount ? `, ${formatMoney(amount - Math.max(0, f.freeNow))} less than this` : ""}.`);
  } else if (months >= 2) {
    lines.push(`- To have it ready by ${monthName}, set aside about ${formatMoney(perMonth)} a month for the next ${months} months.`);
  } else if (months === 1) {
    lines.push(`- It is next month, so it comes out of next month's money or your savings.`);
  }
  if (f.savings > 0) lines.push(`- Your savings hold ${formatMoney(f.savings)}${f.savings >= amount ? ", enough to cover it without touching the monthly money" : ""}.`);
  lines.push(plan.need ? "- It is marked a need." : "- It is a want, so it is the first thing to move or cut if money gets short.");
  if (plan.due !== NO_DATE) {
    lines.push(
      plan.setAside
        ? `- As it is, it is counted in ${monthName}'s safe to spend: from the 1st, ${formatMoney(amount)} is held back before your daily figure is worked out. If you will pay it from savings, say "don't count it".`
        : "- It is not counted in safe to spend, so your daily figure will not hold money back for it.",
    );
  }

  let suggestion: string;
  if (plan.due === NO_DATE) suggestion = "Add it with no date for now, and give it a month once you know, so it is counted there.";
  else if (gap !== null && gap < 0 && spare !== null && spare > 0)
    suggestion = `A usual ${monthName} cannot cover it alone. Add it, and either set aside ${formatMoney(perMonth)} a month from now, lower it to about ${formatMoney(hundred(spare))}, which a usual ${monthName} can spare, or move it to a later month.`;
  else if (gap !== null && gap < 0)
    suggestion = `A usual ${monthName} has nothing to spare, so add it only if you set aside ${formatMoney(perMonth)} a month from now or pay it from savings.`;
  else if (gap !== null) suggestion = `It fits a usual ${monthName}. Add it when you are ready.`;
  else suggestion = months >= 2 ? `Add it, and set aside about ${formatMoney(perMonth)} a month so it is ready.` : "Add it if the money above covers it.";
  lines.push(`My suggestion: ${suggestion} Nothing is saved until you press Add to the planner.`);
  return lines.join("\n");
}
