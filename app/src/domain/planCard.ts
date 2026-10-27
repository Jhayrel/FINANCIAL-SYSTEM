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
  return /\b(?:good\s+idea|worth\s+it|should\s+i\s+(?:buy|get|order|book|purchase)|what\s+(?:do|would)\s+you\s+(?:think|say|suggest|recommend)|what'?s\s+your\s+(?:take|opinion|advice|thoughts?)|your\s+(?:opinion|take|advice|suggestion|thoughts?)|any\s+(?:advice|suggestions?|tips?)|thoughts\s*\?|is\s+(?:it|this|that)\s+(?:ok(?:ay)?|good|wise|fine|smart|realistic|doable|possible|a\s+good\s+idea|worth\s+it|too\s+much)|should\s+i\s+(?:add|do|plan|push|go|continue|proceed|save)\b|can\s+i\s+(?:afford|do)\s+(?:it|this|that)|kaya\s+(?:ko\s+)?ba|ok(?:ay)?\s+lang\s+ba|ano\s+(?:sa\s+tingin|masasabi)\s+mo|before\s+(?:adding|i\s+add|saving))/i.test(t);
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

/**
 * A price said on its own, however unsure: "but i thinks thats around
 * 100k?", "Probably 100k i think", "siguro 90k", "100k?". The question mark
 * there is a guess, not a question: it went to the model unworked and came
 * back with figures the app had not worked out (owner, 27 October 2026).
 */
export function priceSaid(text: string): Centavos | null {
  const rest = text
    .toLowerCase()
    .replace(/[?.!,]/g, " ")
    .replace(/\b(?:but|and|so|ok(?:ay)?|hmm+|well|wait|no|yes|yeah|i\s+think(?:s)?|i\s+guess|i\s+believe|i\s+heard|i\s+saw|maybe|probably|likely|siguro|mga|around|about|roughly|approximately|approx|like|just|only|actually|it'?s|its|it\s+is|it\s+will\s+be|it\s+costs?|that'?s|thats|that\s+is|that\s+will\s+be|the\s+price\s+is|price\s+is|cost\s+is|costs?|is|will\s+be|lang|po|daw|raw|ata|yata|or\s+so|more\s+or\s+less|na\s+lang|na|pesos?|php|₱)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return /^₱?\s*\d[\d,]*(?:\.\d+)?\s*k?$/.test(rest) ? sumIn(rest) : null;
}

/** "add it", "yes add it", "save it", "go ahead": the card above, pressed by saying so. */
export const addsTheCard = (text: string): boolean =>
  /^\s*(?:(?:yes|yep|yeah|sure|ok(?:ay)?|sige|go|alright|oo)[\s,.!]*)?(?:(?:please|pls|can\s+you|could\s+you|kindly|pakisuyo)\s+)?(?:(?:add|save|put|keep|plan|ilagay|i-?add|isave)\s+(?:it|that|this|na)\b|go\s+ahead|do\s+it|confirm(?:ed)?|add\s+to\s+(?:the\s+|my\s+)?planner)/i.test(text) && text.trim().split(/\s+/).length <= 16;

/** An amount said as a change: "make it 8k", "8000 instead", "just 8000", "lower it to 7500". */
function amountIn(text: string): Centavos | null {
  const guessed = priceSaid(text);
  if (guessed !== null && guessed > 0) return guessed;
  const said =
    /\b(?:make|change|set|lower|raise|put|update|increase|decrease|reduce|bring|cut)\s+(?:it|the\s+amount|amount|the\s+budget)?\s*(?:down|up)?\s*(?:to|into|at|as)?\s*(?:₱|php\s*)?\d/i.test(text) ||
    /(?:₱|php\s*)?\d[\d,]*(?:\.\d+)?\s*k?\s+(?:instead|only|lang|na\s+lang)\b/i.test(text) ||
    // "Probably 100k i think", "its around 95k": the price said as a guess is still the price (27 October 2026; it was read as an entry with no wallet).
    /^(?:(?:it'?s|its|it\s+is|it\s+will\s+be|it\s+costs?|that'?s|the\s+price\s+is|price\s+is|cost\s+is)\s+)?(?:just|only|actually|maybe|probably|likely|around|about|roughly|approximately|approx\.?|siguro|mga|like)?\s*(?:₱|php\s*)?\d[\d,]*(?:\.\d+)?\s*k?\s*(?:pesos?|php)?\s*(?:i\s+think|i\s+guess|i\s+believe|siguro|lang|po|or\s+so|more\s+or\s+less|na\s+lang|ata|yata)?\s*[.!]?\s*$/i.test(text) ||
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
  } else if (amount !== null) {
    // The same price again ("Probably 100k i think"): said back, never a second card (27 October 2026).
    already.push(`It is ${formatMoney(amount)} on the card already.`);
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

/**
 * An opinion on a plan, from the figures: how its month looks with it, how
 * to get ready, and a suggestion. The plan on a card, before it is added; or,
 * with `saved`, one on the Planner already ("what do you think of my tuition
 * plan?", 27 October 2026 sweep), worked from what is left of it.
 */
export function planOpinion(plan: PlanInput, f: PlanOpinionFacts, saved?: { readonly paid: Centavos; readonly left: Centavos }, opts: { readonly readAs?: string } = {}): string {
  const amount = saved ? saved.left : (plan.amount ?? 0);
  const when = plan.due === NO_DATE ? "with no date yet" : whenOf({ due: plan.due, dueKind: plan.dueKind }).replace(/^S/, "s");
  const late = plan.due !== NO_DATE && plan.due < f.asOf;
  const lines: string[] = [
    ...(opts.readAs ? [opts.readAs] : []),
    saved
      ? `**${plan.title}, ${formatMoney(plan.amount ?? 0)}, ${when}.**${saved.paid > 0 ? ` ${formatMoney(saved.paid)} is paid, ${formatMoney(saved.left)} left.` : ""} Here is how it looks.`
      : `**${plan.title}, ${formatMoney(amount)}, ${when}.** Here is how it looks before you add it.`,
  ];
  const monthName = plan.due === NO_DATE ? "" : (MONTH_NAMES[Number((late ? f.asOf : plan.due).slice(5, 7)) - 1] ?? "that month");
  // A day already gone is paid out of this month's money, if at all.
  const thisMonth = plan.due !== NO_DATE && (plan.due.slice(0, 7) === f.asOf.slice(0, 7) || late);
  const months = plan.due === NO_DATE || late ? 0 : monthsTo(f.asOf, plan.due);
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
    lines.push(`- ${late ? "Its day has passed, so it is overdue" : "It is due this month"}. Safe to spend until the month ends is ${formatMoney(Math.max(0, f.freeNow))}${f.freeNow < amount ? `, ${formatMoney(amount - Math.max(0, f.freeNow))} less than this` : ""}.`);
  } else if (months >= 2) {
    lines.push(`- To have it ready by ${monthName}, set aside about ${formatMoney(perMonth)} a month for the next ${months} months.`);
  } else if (months === 1) {
    lines.push(`- It is next month, so it comes out of next month's money or your savings.`);
  }
  if (f.savings > 0) lines.push(`- Your savings hold ${formatMoney(f.savings)}${f.savings >= amount ? ", enough to cover it without touching the monthly money" : ""}.`);
  // Unsaved, the need was read, not said: say so, so it can be put right.
  lines.push(plan.need ? (saved ? "- It is marked a need." : '- It reads as a need; say "it\'s a want" if it is not.') : "- It is a want, so it is the first thing to move or cut if money gets short.");
  if (plan.due !== NO_DATE) {
    lines.push(
      plan.setAside
        ? thisMonth
          ? `- As it is, it is counted in safe to spend: ${formatMoney(amount)} is held back now, until it is paid. If you will pay it from savings, say "don't count it".`
          : `- As it is, it is counted in ${monthName}'s safe to spend: from the 1st, ${formatMoney(amount)} is held back before your daily figure is worked out. If you will pay it from savings, say "don't count it".`
        : "- It is not counted in safe to spend, so your daily figure will not hold money back for it.",
    );
  }

  /*
   * What-ifs, worked through before the suggestion: paid from savings, saved
   * up first, and the one thing most likely to go wrong (owner, 27 October
   * 2026: "use what ifs etc overthink everything"; a pre-mortem, as the
   * reasoning references put it: assume it went wrong, and say why).
   */
  const ifs: string[] = [];
  if (f.savings > 0 && amount > 0) ifs.push(f.savings >= amount ? `Paid from savings: covered, and ${formatMoney(f.savings - amount)} stays saved.` : `Paid from savings: they cover ${formatMoney(f.savings)}, so ${formatMoney(amount - f.savings)} would still have to come from the month.`);
  if (spare !== null && amount > 0) {
    if (spare >= 10_000) {
      const n = Math.ceil(amount / spare);
      const at = Number(f.asOf.slice(0, 4)) * 12 + Number(f.asOf.slice(5, 7)) - 1 + n;
      ifs.push(`Saved up first: a usual month spares about ${formatMoney(hundred(spare))}, so about ${n} ${n === 1 ? "month" : "months"} of that, ready around ${MONTH_NAMES[at % 12]} ${Math.floor(at / 12)}.`);
    } else ifs.push(`Saved up first: a usual month spends ${formatMoney(Math.max(0, -spare))} more than comes in, so nothing builds up until that changes.`);
  }
  if (gap !== null) ifs.push(gap < 0 ? `The main risk: ${monthName} is ${formatMoney(-gap)} short with it, so anything unexpected that month would come out of savings or borrowing.` : `The main risk: it takes ${formatMoney(amount)} of what a usual ${monthName} spares, leaving ${formatMoney(gap)} for anything unexpected.`);
  if (ifs.length > 0) lines.push(`What-ifs:\n${ifs.map((x) => `- ${x}`).join("\n")}`);

  /*
   * What to do about it, by what it is. A need is paid whatever happens, so
   * the room comes from the wants and the savings, never from lowering it
   * ("lower tuition to PHP 3,000.00" was suggested, 27 October 2026 sweep).
   * Setting aside "a month" is said only with two months or more to go.
   */
  const ways: string[] = [];
  if (months >= 2) ways.push(`set aside ${formatMoney(perMonth)} a month from now`);
  if (f.savings > 0) ways.push(f.savings >= amount ? "pay it from your savings" : `pay part from your savings (${formatMoney(f.savings)})`);
  if (plan.need) ways.push(`spend less on wants in ${monthName}`);
  else {
    if (spare !== null && spare > 0) ways.push(`lower it to about ${formatMoney(hundred(spare))}, which a usual ${monthName} can spare`);
    ways.push("move it to a later month");
  }
  const either = (list: readonly string[]): string => (list.length <= 1 ? (list[0] ?? "") : `${list.slice(0, -1).join(", ")} or ${list[list.length - 1]}`);
  let suggestion: string;
  const add = saved ? "keep it" : "add it";
  if (plan.due === NO_DATE) suggestion = saved ? "Give it a month once you know, so it is counted there." : "Add it with no date for now, and give it a month once you know, so it is counted there.";
  else if (gap !== null && gap < 0) suggestion = `a usual ${monthName} cannot cover it alone. ${add.replace(/^./, (c) => c.toUpperCase())}, and ${either(ways)}.`;
  else if (gap !== null) suggestion = saved ? `it fits a usual ${monthName}. Keep it as it is.` : `it fits a usual ${monthName}. Add it when you are ready.`;
  else suggestion = months >= 2 ? `${add}, and set aside about ${formatMoney(perMonth)} a month so it is ready.` : thisMonth && f.freeNow !== null && f.freeNow < amount ? `this month's money does not cover it. ${either(ways.length > 0 ? ways : ["move it to a later month"]).replace(/^./, (c) => c.toUpperCase())}.` : `${add} if the money above covers it.`;
  const close = saved
    ? `To change it, say so ("move the ${plan.title.toLowerCase()} plan to ${(MONTH_NAMES[plan.due === NO_DATE ? 11 : Number((late ? f.asOf : plan.due).slice(5, 7)) % 12] ?? "December").toLowerCase()}", "make the ${plan.title.toLowerCase()} plan ${Math.max(100, Math.round((plan.amount ?? 0) / 100 / 1.25 / 100) * 100)}") or open it on the Planner.`
    : "Nothing is saved until you press Add to the planner.";
  lines.push(`My suggestion: ${suggestion.replace(/^./, (c) => c.toUpperCase())} ${close}`);
  return lines.join("\n");
}

/**
 * An opinion asked before the price is known: "I plan next month to get
 * iphone 18 pro max what do you think?". It is a question, so it is answered:
 * how much the month can take on top of what it already has, what is held,
 * and what to do. The price is asked for only as the way to add it, if they
 * want to (owner, 27 October 2026: "I am asking a question, I said the ai
 * knows if I am asking or adding"; it was answered "To say whether November
 * can cover it, I need the amount first").
 *
 * With no month to go by (no date), `f.month` may be a usual month read for
 * next month, and is said as a usual month.
 */
export function wishOpinion(plan: PlanInput, f: PlanOpinionFacts, hint = "", opts: { readonly readAs?: string } = {}): string {
  const undated = plan.due === NO_DATE;
  const when = undated ? "with no date yet" : whenOf({ due: plan.due, dueKind: plan.dueKind }).replace(/^S/, "s");
  const thisMonth = !undated && plan.due.slice(0, 7) <= f.asOf.slice(0, 7);
  const monthName = undated ? "a usual month" : (MONTH_NAMES[Number(plan.due.slice(5, 7)) - 1] ?? "that month");
  const lines: string[] = [...(opts.readAs ? [opts.readAs] : []), `**${plan.title}, ${when}.** You did not say the price, so here is what ${thisMonth ? "this month" : monthName} can take.`];

  let spare: Centavos | null = null;
  if (f.month && !thisMonth) {
    spare = f.month.income - f.month.usual - f.month.others;
    lines.push(
      `- ${undated ? `A usual month (going by ${f.month.name})` : f.month.name}: it costs ${formatMoney(f.month.usual)}${f.month.others > 0 ? ` and ${undated ? "the plans already in it" : "its other plans"} ${formatMoney(f.month.others)}` : ""}, against about ${formatMoney(f.month.income)} that usually comes in: ${spare >= 0 ? `about ${formatMoney(spare)} to spare` : `already ${formatMoney(-spare)} short before this`}.`,
    );
  }
  const free = f.freeNow === null ? null : Math.max(0, f.freeNow);
  if (thisMonth && free !== null) lines.push(`- Safe to spend until the month ends is ${formatMoney(free)}.`);
  if (f.savings > 0) lines.push(`- Your savings hold ${formatMoney(f.savings)}.`);
  if (hint) lines.push(`- ${hint}`);
  lines.push(plan.need ? '- It reads as a need; say "it\'s a want" if it is not.' : "- It is a want, so it can wait for a month that has room.");

  // Less than PHP 100.00 spare is no room: "up to about PHP 0.00" was said (27 October 2026 sweep).
  const roomLeft = thisMonth ? free : spare;
  const room = roomLeft !== null && roomLeft < 10_000 ? 0 : roomLeft;
  const savingsToo = f.savings > 0 ? ` With your savings too, about ${formatMoney((room !== null && room > 0 ? hundred(room) : 0) + f.savings)}.` : "";
  let view: string;
  if (room === null) view = `without a price or a month I cannot say more than the money above. Saving up for it first, a part each month, is the safe way for anything large.`;
  else if (room <= 0) view = `${thisMonth ? "this month" : monthName === "a usual month" ? "a usual month" : `a usual ${monthName}`} has no room for it.${savingsToo} ${plan.need ? "As a need, pay it from savings or cut wants that month." : "As a want, it is better to wait, or save up for it first and buy it once the money is there."}`;
  else view = `up to about ${formatMoney(hundred(room))}, ${thisMonth ? "this month's money" : monthName === "a usual month" ? "a usual month" : `a usual ${monthName}`} can pay for it.${savingsToo} If it costs more than that, ${plan.need ? "the rest has to come from savings or from wants cut that month" : "save up for it first, a part each month, rather than paying it all at once"}.`;
  lines.push(`My view: ${view.replace(/^./, (c) => c.toUpperCase())}`);
  lines.push("If you want it on the Planner, tell me the price and I will check it against the month and give you a card to add. Nothing is added otherwise.");
  return lines.join("\n");
}
