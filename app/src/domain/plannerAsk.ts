/**
 * The Planner from the chat: "plan tuition 9000 on nov 15", "what's
 * planned?", "move the tuition plan to nov 30", "I paid the haircut plan",
 * "skip the trip plan", "remove the gym plan", "put back the trip plan".
 *
 * The owner, 26 October 2026: "Make sure ai can do it all too any type of
 * edit edit add etc". Every one names the Planner or a plan in so many
 * words, so "I plan to spend 1000 on dinner tonight" and "I plan to spend
 * 3000 on a trip next month, what budget should I set?" stay the questions
 * they are (`plannedSpend.ts`). Each change is a card to press.
 */
import { addDays, dayOfWeek, formatMedium, lastOfMonth, MONTH_NAMES } from "./dates";
import { formatMoney, parseAmount, withoutYears, type Centavos } from "./money";
import { byWhen, dueFor, kindFromHistory, NO_DATE, planKinds, whenOf, type DueKind, type Plan, type PlanInput, type PlannedMonth, type PlanView } from "./planner";
import type { IsoDate, ReferenceLists, Transaction } from "./types";

export type PlannerAsk =
  | { readonly kind: "list" }
  /** "If I pay the tuition plan today, will I be short?": what paying it would do, nothing saved. */
  | { readonly kind: "payIf"; readonly plan: Plan; readonly wallet: string }
  /** Skip, move or pay a plan already paid, skipped or removed: said, with how to open it again. */
  | { readonly kind: "closed"; readonly plan: Plan }
  /** "What do you think of my tuition plan?", "can I afford the gifts plan?": an opinion on a plan on the Planner. */
  | { readonly kind: "opinion"; readonly plan: Plan }
  /** "How much is planned this month?", "what's planned for November?": one month's plans against its budget. */
  | { readonly kind: "month"; readonly year: number; readonly month: number }
  | { readonly kind: "add"; readonly input: PlanInput }
  /** "plan rent 3500 every month": a payment every month is a bill, not a plan (27 October 2026 sweep). */
  | { readonly kind: "recurring"; readonly title: string; readonly amount: Centavos }
  /** "How much should I save a month for the gifts plan?": worked out from the plan (27 October 2026 sweep). */
  | { readonly kind: "saveFor"; readonly plan: Plan }
  | { readonly kind: "move"; readonly plan: Plan; readonly to: IsoDate; readonly toKind: DueKind }
  | { readonly kind: "amount"; readonly plan: Plan; readonly amount: Centavos }
  | { readonly kind: "skip"; readonly plan: Plan }
  | { readonly kind: "remove"; readonly plan: Plan }
  | { readonly kind: "restore"; readonly plan: Plan }
  | { readonly kind: "pay"; readonly plan: Plan; readonly amount: Centavos | null; readonly wallet: string }
  /** Anything else about it: its name, kind, wallet, need or want, safe to spend, goal or note. */
  | { readonly kind: "edit"; readonly plan: Plan; readonly input: PlanInput; readonly changes: readonly { readonly label: string; readonly before: string; readonly after: string }[] }
  /** It names a plan that is not there. */
  | { readonly kind: "none"; readonly said: string };

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_RE = String.raw`(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)`;

/** A day said: "nov 15", "november 15 2026", "the 30th", "next month", "by december", "in 2 weeks". */
export function dayIn(text: string, asOf: IsoDate): IsoDate | null {
  const t = text.toLowerCase();
  const y = Number(asOf.slice(0, 4));
  const m = Number(asOf.slice(5, 7));
  const iso = /\b(20\d{2})-(\d{2})-(\d{2})\b/.exec(t);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const named = new RegExp(String.raw`\b${MONTH_RE}\.?(?:\s+(\d{1,2})(?:st|nd|rd|th)?)?(?:,?\s+(20\d{2}))?\b`).exec(t);
  if (named && !/^may$/.test(named[1] ?? "") || (named && /\b(?:in|by|on|for|until|till|this|next)\s+may\b/.test(t))) {
    const month = MONTHS.indexOf((named[1] ?? "").slice(0, 3)) + 1;
    let year = named[3] ? Number(named[3]) : y;
    if (!named[3] && month < m) year += 1;
    const day = named[2] ? Math.min(Number(named[2]), 31) : null;
    const date = day ? `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` : lastOfMonth(year, month);
    return date;
  }
  if (/\bnext\s+month\b/.test(t)) return m === 12 ? lastOfMonth(y + 1, 1) : lastOfMonth(y, m + 1);
  if (/\bend of (?:the |this )?month\b/.test(t)) return lastOfMonth(y, m);
  if (/\btomorrow\b/.test(t)) return addDays(asOf, 1);
  // A day gone, read as gone, so the card can say so rather than file it with no date (27 October 2026).
  if (/\b(?:the\s+day\s+before\s+yesterday)\b/.test(t)) return addDays(asOf, -2);
  if (/\b(?:yesterday|kahapon)\b/.test(t)) return addDays(asOf, -1);
  if (/\blast\s+week\b/.test(t)) return addDays(asOf, -7);
  if (/\bnext\s+week\b/.test(t)) return addDays(asOf, 7);
  const span = /\bin\s+(\d{1,2}|a|one|two|three)\s+(days?|weeks?|months?)\b/.exec(t);
  if (span) {
    const n = /^\d+$/.test(span[1] ?? "") ? Number(span[1]) : ({ a: 1, one: 1, two: 2, three: 3 } as Record<string, number>)[span[1] ?? ""] ?? 1;
    return (span[2] ?? "").startsWith("day") ? addDays(asOf, n) : (span[2] ?? "").startsWith("week") ? addDays(asOf, n * 7) : addDays(asOf, n * 30);
  }
  const nth = /\bthe\s+(\d{1,2})(?:st|nd|rd|th)\b/.exec(t);
  if (nth) {
    const day = Number(nth[1]);
    const here = `${asOf.slice(0, 7)}-${String(day).padStart(2, "0")}`;
    return here >= asOf ? here : m === 12 ? `${y + 1}-01-${String(day).padStart(2, "0")}` : `${y}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  return null;
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** The day it is for, when one is said; null when none is. */
export function dayFor(text: string, asOf: IsoDate): IsoDate | null {
  const t = text.toLowerCase();
  const said = dayIn(t, asOf);
  if (said) return said;
  const y = Number(asOf.slice(0, 4));
  const wd = /\b(?:this\s+|next\s+|on\s+|sa\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/.exec(t);
  if (wd) {
    const want = WEEKDAYS.indexOf(wd[1] ?? "");
    const now = dayOfWeek(asOf);
    let ahead = (want - now + 7) % 7;
    if (ahead === 0) ahead = 7;
    return addDays(asOf, ahead);
  }
  if (/\bthis\s+weekend\b/.test(t)) return addDays(asOf, Math.max(1, (6 - dayOfWeek(asOf) + 7) % 7 || 7));
  if (/\bthis\s+week\b/.test(t)) return addDays(asOf, (7 - dayOfWeek(asOf)) % 7 || 7);
  if (/\bthis\s+month\b/.test(t)) return lastOfMonth(y, Number(asOf.slice(5, 7)));
  if (/\bnext\s+year\b/.test(t)) return `${y + 1}-12-31`;
  const year = /\b(?:in|by|for|on|this|sa|of)\s+(20\d{2})\b/.exec(t);
  if (year && Number(year[1]) >= y) return `${year[1]}-12-31`;
  if (/\b(?:christmas|pasko)\b/.test(t)) return `${asOf.slice(5) > "12-25" ? y + 1 : y}-12-25`;
  if (/\bnew\s+year\b/.test(t)) return `${y}-12-31`;
  return null;
}

/**
 * The day said and how much of it: a day ("nov 15", "tomorrow", "friday",
 * "the 30th"), a month ("next month", "in december", "in 2 months"), or a
 * year ("next year", "in 2027"). Null when nothing is said. The owner, 27
 * October 2026: "WHAT IF I DONT HAVE A DAY SPECIFICS YET LIKE NO DATE LIKE NO
 * IDEA WHEN": a month said is a month, not its last day passed off as the
 * day they chose.
 */
export function whenFor(text: string, asOf: IsoDate): { readonly due: IsoDate; readonly kind: DueKind } | null {
  const t = text.toLowerCase();
  if (NO_DAY.test(t) && !new RegExp(String.raw`\b${MONTH_RE}\b|\bnext\s+month\b|\bthis\s+month\b|\b20\d{2}\b`).test(withoutDays(t))) return null;
  const due = dayFor(t, asOf);
  if (due === null) return null;
  const dayish =
    /\b20\d{2}-\d{2}-\d{2}\b|\b(?:tomorrow|bukas|today|tonight|yesterday|kahapon|last\s+week|next\s+week|this\s+week(?:end)?|christmas|pasko|new\s+year|end\s+of\s+(?:the\s+|this\s+)?month)\b|\bin\s+(?:\d{1,2}|a|one|two|three)\s+(?:days?|weeks?)\b|\bthe\s+\d{1,2}(?:st|nd|rd|th)\b|\b(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/.test(t) ||
    new RegExp(String.raw`\b${MONTH_RE}\.?\s+\d{1,2}(?:st|nd|rd|th)?\b(?!\d)`).test(t);
  // A day said but "not sure of the exact day": the month, not the day.
  if (dayish && !NO_DAY.test(t)) return { due, kind: "day" };
  if (!new RegExp(String.raw`\b${MONTH_RE}\b|\bnext\s+month\b|\bthis\s+month\b|\bin\s+\w+\s+months?\b`).test(t) && /\b(?:next\s+year|20\d{2})\b/.test(t)) return { due: dueFor("year", due), kind: "year" };
  return { due: dueFor("month", due), kind: "month" };
}

/** "No idea when", "the date is unknown", "not sure when", "no date yet", "someday". */
export const NO_DAY =
  /\b(?:date|day|when)\b[^.?!]{0,20}\b(?:unknown|not\s+(?:sure|known|yet|set|final)|tba|tbd|undecided|walang\s+petsa|di\s+pa\s+alam|hindi\s+pa\s+alam)\b|\bnot\s+sure\s+(?:when|what\s+day|of\s+the\s+date)\b|\bno\s+(?:exact\s+)?(?:date|day)(?:\s+yet)?\b|\bno\s+idea\s+(?:when|yet)\b|\bdon'?t\s+know\s+when\b|\bsomeday\b|\bsome\s+day\b|\bundated\b|\banytime\b|\bkahit\s+kailan\b/i;

const NO_DAY_G = new RegExp(NO_DAY.source, "gi");
const withoutDays = (t: string): string => t.replace(NO_DAY_G, " ");

/** A sum said: "9000", "9k", "PHP 9,000". */
export function sumIn(text: string): Centavos | null {
  const m = /(?:₱|php\s*)?(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)\s*(k)?\b(?!\s*(?:st|nd|rd|th|days?|weeks?|months?|%))/i.exec(withoutYears(text).replace(new RegExp(String.raw`\b${MONTH_RE}\.?\s+\d{1,2}(?:st|nd|rd|th)?\b`, "gi"), " "));
  if (!m?.[1]) return null;
  const base = parseAmount(m[1]);
  return base === null || base <= 0 ? null : m[2] ? base * 1000 : base;
}

/** The plan a sentence names, by the words of its title; the state asked about first. */
export function planNamed(text: string, plans: readonly Plan[], prefer: readonly Plan["status"][]): Plan | null {
  const lower = ` ${text.toLowerCase().replace(/[^a-z0-9\s]/g, " ")} `;
  const scored = plans
    .map((p) => {
      const words = p.title.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
      const hits = words.filter((w) => lower.includes(` ${w} `) || lower.includes(` ${w}s `)).length;
      return { p, hits, all: words.length > 0 && hits === words.length };
    })
    .filter((s) => s.hits > 0)
    .sort((a, b) => Number(b.all) - Number(a.all) || b.hits - a.hits || prefer.indexOf(a.p.status) - prefer.indexOf(b.p.status) || b.p.due.localeCompare(a.p.due));
  const preferred = scored.find((s) => prefer.includes(s.p.status));
  return (preferred ?? scored[0])?.p ?? null;
}

/*
 * The Planner or a plan by name: "the tuition plan", "my plans", "planned".
 * Not "I plan to pay my registration on the 30th", which is a plan being
 * made (planIntent.ts) and was answered "No plan by that name is on the
 * Planner" (27 October 2026).
 */
const PLANNER = /\b(?:planner|plans|planned)\b|(?<!\b(?:i|we|they|you|to|also|still|really|will|i'?ll|we'?ll)\s)\bplan\b/i;
const QUESTIONISH = /\?\s*$|^\s*(?:what|how|can|could|should|would|will|is|am|do|does)\b/i;

const esc = (v: string): string => v.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A change to a plan other than its date, amount or payment: "rename the
 * trip plan to Baguio trip", "the trip plan is a want", "don't count the
 * trip plan in safe to spend", "the trip plan is Travel", "change the
 * tuition plan to gcash", "note on the trip plan: bring a jacket", "save for
 * the phone plan in Phone fund". Every field the Planner's Edit form has
 * (owner, 26 October 2026: "any type of edit").
 */
function editIn(
  t: string,
  plan: Plan,
  reference: ReferenceLists,
  goals: readonly { readonly id: string; readonly name: string }[],
): { readonly input: PlanInput; readonly changes: { label: string; before: string; after: string }[] } | null {
  const input: { -readonly [K in keyof PlanInput]: PlanInput[K] } = { title: plan.title, amount: plan.amount, due: plan.due, dueKind: plan.dueKind ?? "day", item: plan.item, wallet: plan.wallet, goalId: plan.goalId, need: plan.need, setAside: plan.setAside, notes: plan.notes };
  const changes: { label: string; before: string; after: string }[] = [];
  const counted = (b: boolean): string => (b ? "Counted in its month" : "Not counted");
  const titleWords = new Set(plan.title.toLowerCase().split(/[^a-z0-9]+/));

  const renamed = /\b(?:rename|re-name|call)\b[^.?!]*?\b(?:to|as)\s+["']?(.+?)["']?\s*[.!]?\s*$/i.exec(t);
  if (renamed?.[1] && /\b(?:rename|re-name)\b|\bcall\s+(?:it|the\s+\w+(?:\s+\w+)?\s+plan)\b/i.test(t)) {
    const title = renamed[1].trim().replace(/^./, (c) => c.toUpperCase()).slice(0, 80);
    if (title && title !== plan.title) {
      changes.push({ label: "Name", before: plan.title, after: title });
      input.title = title;
    }
  }
  const nw = /\b(?:is|as|it'?s|mark\w*(?:\s+it)?|make\s+it|change\s+it\s+to|just)\s+(?:a\s+|only\s+a\s+)?(want|need)\b/i.exec(t);
  if (nw && (nw[1]?.toLowerCase() === "need") !== plan.need) {
    input.need = nw[1]?.toLowerCase() === "need";
    changes.push({ label: "Need or want", before: plan.need ? "A need" : "A want", after: input.need ? "A need" : "A want" });
  }
  const off = /\b(?:don'?t|do\s+not|stop|no\s+longer|never)\s+count(?:ing)?\b|\bnot\s+(?:be\s+)?counted\b|\b(?:take|leave)\b[^.?!]{0,30}\bout\s+of\s+safe\s+to\s+spend\b/i.test(t);
  const on = !off && /\b(?:count|set\s+aside)\b[^.?!]{0,40}\b(?:in|from)\s+safe\s+to\s+spend\b|\bcount\s+it\b/i.test(t);
  if ((off && plan.setAside) || (on && !plan.setAside && !plan.goalId)) {
    input.setAside = on;
    changes.push({ label: "Safe to spend", before: counted(plan.setAside), after: counted(on) });
  }
  const kind = planKinds(reference).options.find((k) => k.toLowerCase() !== plan.item.toLowerCase() && !titleWords.has(k.toLowerCase()) && new RegExp(`\\b${esc(k)}\\b`, "i").test(t));
  if (kind && /\b(?:kind|is|as|under|file\w*|categor\w*|put\s+it\s+(?:in|under)|type)\b/i.test(t)) {
    changes.push({ label: "Kind", before: plan.item || "Not said", after: kind });
    input.item = kind;
  }
  const goal = goals.find((g) => new RegExp(`\\b${esc(g.name)}\\b`, "i").test(t));
  if (goal && goal.id !== plan.goalId && /\b(?:link|save|saving|connect|goal|in|into|from)\b/i.test(t)) {
    changes.push({ label: "Goal", before: plan.goalId ? "Another goal" : "Not saved in a goal", after: goal.name });
    input.goalId = goal.id;
    input.wallet = goal.name;
    input.setAside = false;
  } else {
    const wallet = [...reference.wallets, ...reference.savings].find((w) => w.toLowerCase() !== plan.wallet.toLowerCase() && new RegExp(`\\b${esc(w)}\\b`, "i").test(t));
    if (wallet && /\b(?:change|switch|use|set|take\s+it\s+from|come\s+from|pay\s+(?:it\s+)?with|from)\b/i.test(t) && !/\b(?:paid|i\s+pay|settle|already)\b/i.test(t)) {
      changes.push({ label: "Pay from", before: plan.wallet || "Not decided", after: wallet });
      input.wallet = wallet;
    }
  }
  // "The trip plan has no date yet", "no idea when for the phone plan": the date taken away.
  if (NO_DAY.test(t) && plan.due !== NO_DATE) {
    changes.push({ label: "Pay by", before: whenOf(plan), after: "No date yet" });
    input.due = NO_DATE;
    input.dueKind = "none";
  }
  const note = /\bnotes?\b[^:]{0,40}:\s*(.+)$/i.exec(t) ?? /\b(?:add|put|write)\s+(?:a\s+)?note\b[^.?!]*?\b(?:saying|that)\s+(.+)$/i.exec(t);
  if (note?.[1]) {
    const notes = note[1].trim().slice(0, 300);
    changes.push({ label: "Notes", before: plan.notes || "None", after: notes });
    input.notes = notes;
  }
  return changes.length > 0 ? { input, changes } : null;
}

export function readPlannerAsk(
  text: string,
  context: {
    readonly plans: readonly Plan[];
    readonly reference: ReferenceLists;
    readonly transactions: readonly Transaction[];
    readonly asOf: IsoDate;
    /** Goal accounts, for "save for the phone plan in Phone fund". */
    readonly goals?: readonly { readonly id: string; readonly name: string }[] | undefined;
  },
): PlannerAsk | null {
  const t = text.trim();
  if (!t || t.split(/\s+/).length > 30) return null;
  const { plans, reference, transactions, asOf } = context;

  /*
   * One month's plans: "how much is planned this month?", "what's planned
   * for November?". It was answered with the month's summary (27 October
   * 2026 sweep), with nothing about the plans.
   */
  {
    const named = MONTH_NAMES.findIndex((m) => new RegExp(`\\b${m.slice(0, 3)}(?:${m.slice(3)})?\\b`, "i").test(t));
    const aboutMonth = /\b(?:this|next|ngayong|sa\s+susunod\s+na)\s+(?:month|buwan)\b/i.test(t) || named >= 0;
    const asksHowMuch = /\b(?:how\s+much|magkano|total|what(?:'s|\s+is|\s+are)?)\b[^.?!]{0,30}\b(?:planned|plans?)\b/i.test(t) || /\b(?:planned|plans?)\b[^.?!]{0,12}\b(?:for|in|this|next)\b/i.test(t);
    if (aboutMonth && asksHowMuch && !/\b(?:add|move|skip|remove|delete|pay|paid|plan\s+(?:a|an|my|the)?\s*\w+\s+\d)\b/i.test(t) && !/\d{3,}/.test(t)) {
      const y = Number(asOf.slice(0, 4));
      const m = Number(asOf.slice(5, 7));
      if (named >= 0) {
        const month = named + 1;
        return { kind: "month", year: month < m ? y + 1 : y, month };
      }
      return /\bnext\b|susunod/i.test(t) ? { kind: "month", year: m === 12 ? y + 1 : y, month: m === 12 ? 1 : m + 1 } : { kind: "month", year: y, month: m };
    }
  }

  // "What's planned?", "show my planner", "what plans are due this week?"
  if (/\b(?:what(?:'s| is| do i have)?|show|list|any|see|check)\b[^.?!]{0,30}\b(?:planned|planner|plans)\b/i.test(t) && !/\b(?:add|move|skip|remove|delete|pay|paid)\b/i.test(t)) {
    return { kind: "list" };
  }

  // Adding: "plan tuition 9000 on nov 15", "add a new phone 25k by march 2027 to my planner".
  const adds =
    /^\s*(?:please\s+|pls\s+)?(?:plan|schedule)\s+(?!to\b)/i.test(t) ||
    // "add christmas party contribution 300 dec 18 as a plan": the whole thing, not just "Christmas".
    /^\s*(?:please\s+|pls\s+)?(?:add|put|save)\s+(?!it\b|that\b|this\b|them\b).+\b(?:as\s+a\s+plan|to\s+(?:my|the)\s+plans)\b/i.test(t) ||
    /\b(?:to|in|into|on)\s+(?:my|the)\s+planner\b|\badd\s+(?:a\s+)?(?:new\s+)?plan\b|\bnew\s+plan\b|^\s*remind\s+me\s+to\s+pay\b/i.test(t);
  if (adds && !QUESTIONISH.test(t)) {
    const amount = sumIn(t);
    // The day, month or year said; with none, no date (counted nowhere until it has one). "Today" is today.
    const today = /\b(?:today|tonight|ngayon)\b/i.test(t) ? { due: asOf, kind: "day" as const } : null;
    const when = today ?? whenFor(t, asOf);
    const due = when?.due ?? NO_DATE;
    const monthly = /\b(?:every|each|per|a)\s+month\b|\bmonthly\b|\bkada\s+buwan\b|\bbuwan[- ]buwan\b/i.test(t);
    const wallet = [...reference.wallets, ...reference.savings].find((w) => new RegExp(`\\b(?:from|using|with|via)\\s+${w.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(t)) ?? "";
    const title = t
      .replace(/^\s*(?:please\s+|pls\s+)?(?:plan|schedule|add|put|remind\s+me\s+to\s+pay)\s+/i, "")
      .replace(/\b(?:to|in|into|on)\s+(?:my|the)\s+planner\b/gi, " ")
      .replace(/\b(?:a\s+)?(?:new\s+)?plan\s+(?:for\s+)?/gi, " ")
      .replace(/(?:₱|php\s*)?\d[\d,]*(?:\.\d{1,2})?\s*k?\b/gi, " ")
      .replace(new RegExp(String.raw`\b(?:on|by|for|in|until|before|this|next)?\s*${MONTH_RE}\.?(?:\s+\d{1,2}(?:st|nd|rd|th)?)?(?:,?\s+20\d{2})?\b`, "gi"), " ")
      .replace(/\b(?:by|on|for|in|due|before)?\s*(?:next\s+(?:month|week|year)|this\s+(?:month|year)|end of (?:the |this )?month|tomorrow|(?:the\s+day\s+before\s+)?yesterday|kahapon|last\s+week|in\s+\w+\s+(?:days?|weeks?|months?)|in\s+20\d{2})\b/gi, " ")
      .replace(NO_DAY_G, " ")
      .replace(/\b(?:from|using|with|via)\s+\S+/gi, " ")
      .replace(/\b(?:as\s+a\s+plan|to\s+(?:my|the)\s+plans)\b/gi, " ")
      .replace(/\b(?:today|tonight|ngayon|(?:every|each|per)\s+month|monthly|kada\s+buwan|buwan[- ]buwan)\b/gi, " ")
      .replace(/\b(?:pesos?|php|worth|to pay|due)\b/gi, " ")
      .replace(/[,.:;!]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      /*
       * Small words only where they hang off an end: "birthday gift for
       * mama" keeps its "for" (it read "Birthday gift mama"), "for the trip"
       * loses it.
       */
      .replace(/^(?:(?:for|by|on|the|my|a|an|of|pay|in)\s+)+/i, "")
      .replace(/(?:\s+(?:for|by|on|the|my|a|an|of|in|and|to))+$/i, "")
      .trim();
    if (amount === null || !title) return null;
    if (monthly) return { kind: "recurring", title: title.replace(/^./, (c) => c.toUpperCase()), amount };
    const kinds = planKinds(reference).options;
    const name = title.replace(/^./, (c) => c.toUpperCase());
    const recurring = [...reference.bills, ...reference.subscriptions].some((b) => b.toLowerCase() === (kindFromHistory(name, transactions, kinds) ?? "").toLowerCase());
    return {
      kind: "add",
      input: { title: name, amount, due, dueKind: when?.kind ?? "none", item: kindFromHistory(name, transactions, kinds) ?? "", wallet, need: !/\b(?:want|treat|gadget|trip|vacation|concert)\b/i.test(t), setAside: !recurring, notes: "" },
    };
  }

  /*
   * "The tuition is 9500 now": a price changed, said of an open plan by its
   * name without the word "plan". It was read as a PHP 9,500.00 School entry
   * (27 October 2026 sweep). Only with "now" or "costs", and only when what
   * is named is that plan's whole name, so "tuition 9500" stays an entry.
   */
  const priced = /^\s*(?:the\s+|my\s+)?([a-z][a-z0-9 '-]{1,40}?)\s+(?:is\s+now|now\s+costs?|costs?\s+now|is|costs?|will\s+cost)\s+(?:now\s+)?(?:₱|php\s*|p\s*)?[\d,.]+\s*k?\s*(?:now|na)?\s*[.!]?\s*$/i.exec(t);
  if (priced?.[1] && /\b(?:now|na|costs?)\b/i.test(t)) {
    const subject = priced[1].toLowerCase().replace(/\s+plan$/, "").trim();
    const plan = plans.find((p) => p.status === "open" && p.title.toLowerCase().trim() === subject);
    const amount = sumIn(t);
    if (plan && amount !== null && amount > 0 && amount !== plan.amount) return { kind: "amount", plan, amount };
  }

  if (!PLANNER.test(t)) return null;
  const open = plans.filter((p) => p.status === "open");

  if (/\b(?:how\s+much|magkano)\b[^.?!]*\b(?:save|set\s+aside|put\s+aside|keep|ipon|itabi)\b/i.test(t)) {
    const plan = planNamed(t, open, ["open"]);
    if (plan) return { kind: "saveFor", plan };
  }

  /*
   * An opinion on a plan already on the Planner (27 October 2026 sweep:
   * "what do you think of my tuition plan?" fell to the month's summary, and
   * "can i afford the christmas gifts plan?" was answered with today's money).
   */
  if (/\b(?:what\s+(?:do|would)\s+you\s+(?:think|say|suggest|recommend)|what'?s\s+your\s+(?:take|opinion|advice|thoughts?)|your\s+(?:opinion|take|advice|thoughts?)|any\s+(?:advice|suggestions?|tips?)|can\s+i\s+(?:afford|make|manage|pay\s+for)|kaya\s+(?:ko\s+)?ba|ok(?:ay)?\s+lang\s+ba|ano\s+(?:sa\s+tingin|masasabi)\s+mo|is\s+(?:the|my)\b[^.?!]{1,40}\bplan\s+(?:ok(?:ay)?|good|realistic|doable|possible|too\s+much|affordable))\b/i.test(t)) {
    const plan = planNamed(t, open, ["open"]);
    if (plan) return { kind: "opinion", plan };
  }

  // A field other than the date, the amount or a payment ("the trip plan is a want", "don't count the trip plan").
  if (!/\b(?:put\s+back|restore|bring\s+back|reopen|paid|move|extend|postpone)\b|\b(?:put|bring)\b[^.?!]{0,40}?\bback\b/i.test(t)) {
    const plan = planNamed(t, open, ["open"]);
    const edit = plan ? editIn(t, plan, reference, context.goals ?? []) : null;
    if (plan && edit) return { kind: "edit", plan, input: edit.input, changes: edit.changes };
  }

  // "Put the concert plan back" as well as "put back the concert plan".
  if (/\b(?:put\s+back|restore|bring\s+back|un-?skip|reopen)\b|\b(?:put|bring)\b[^.?!]{0,40}?\bback\b/i.test(t)) {
    const plan = planNamed(t, plans, ["removed", "skipped", "done"]);
    return plan ? { kind: "restore", plan } : { kind: "none", said: t };
  }
  if (/\b(?:remove|delete|take\s+off|drop)\b/i.test(t)) {
    const plan = planNamed(t, plans, ["open", "skipped", "done"]);
    return plan ? { kind: "remove", plan } : { kind: "none", said: t };
  }
  if (/\b(?:skip|cancel|won'?t|not\s+(?:going|buying|paying)|no\s+longer|call\s+off)\b/i.test(t)) {
    const plan = planNamed(t, open, ["open"]);
    return plan ? { kind: "skip", plan } : closedNamed(t, plans);
  }
  if (/\b(?:move|extend|push|postpone|resched\w*|delay|change\s+the\s+date|later\s+to)\b/i.test(t)) {
    const plan = planNamed(t, open, ["open"]);
    // "Move the trip plan to december" is a month; "... to no date yet" takes the date away.
    const when = NO_DAY.test(t) ? null : whenFor(t, asOf);
    if (plan && NO_DAY.test(t)) return { kind: "move", plan, to: NO_DATE, toKind: "none" };
    return plan && when ? { kind: "move", plan, to: when.due, toKind: when.kind } : plan ? null : closedNamed(t, plans);
  }
  /*
   * A question about paying, not a payment: "if i pay the tuition plan today
   * will i be short" was offered as a Pay card (27 October 2026 sweep).
   */
  if (/\bpay\b/i.test(t) && /^\s*(?:if|what\s+if|kung|suppose)\b|\b(?:will|would|can|could|should)\s+i\b|\bam\s+i\b|\b(?:enough|short|kulang|kaya)\b|\?\s*$/i.test(t) && !/\b(?:i|we)\s+(?:already\s+)?paid\b/i.test(t)) {
    const plan = planNamed(t, open, ["open"]);
    if (plan) {
      const wallet = [...reference.wallets, ...reference.savings].find((w) => new RegExp(`\\b${w.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(t)) ?? "";
      return { kind: "payIf", plan, wallet };
    }
  }
  if (/\b(?:paid|pay|settle|mark\b[^.?!]{0,30}\bpaid)\b/i.test(t)) {
    const plan = planNamed(t, open, ["open"]);
    if (!plan) return closedNamed(t, plans);
    const wallet = [...reference.wallets, ...reference.savings].find((w) => new RegExp(`\\b${w.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(t)) ?? "";
    return { kind: "pay", plan, amount: sumIn(t), wallet };
  }
  if (/\b(?:is\s+now|now|costs?|price|change|make|set|update|raise|lower|increase|reduce|bump|actually)\b/i.test(t)) {
    const plan = planNamed(t, open, ["open"]);
    const amount = sumIn(t);
    return plan && amount !== null && amount !== plan.amount ? { kind: "amount", plan, amount } : null;
  }
  return null;
}

/*
 * "Skip the concert plan" when it is skipped already: "No plan by that name"
 * was wrong (27 October 2026 sweep). A closed plan by its whole name is said
 * as it is.
 */
function closedNamed(t: string, plans: readonly Plan[]): PlannerAsk {
  const plan = planNamed(t, plans.filter((p) => p.status !== "open"), ["skipped", "done", "removed"]);
  const words = plan?.title.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3) ?? [];
  const lower = ` ${t.toLowerCase().replace(/[^a-z0-9\s]/g, " ")} `;
  return plan && words.some((w) => lower.includes(` ${w} `)) ? { kind: "closed", plan } : { kind: "none", said: t };
}

/** What a closed plan is, and how to open it again. */
export function closedPlanWords(plan: Plan): string {
  const state = plan.status === "done" ? "paid" : plan.status;
  const on = plan.closedOn ? ` on ${formatMedium(plan.closedOn)}` : "";
  return `"${plan.title}" is ${state} already${on}${plan.reason ? ` (${plan.reason})` : ""}, so there is nothing to ${plan.status === "done" ? "pay" : "skip or move"}. To open it again, say "put the ${plan.title.toLowerCase()} plan back"${plan.status === "done" ? ', or "plan it again" on its sheet for a new one' : ""}.`;
}

/**
 * One month's plans still to pay (`plannedForBudget`, the figure the Budget
 * screen shows), which of them safe to spend holds money back for, and what
 * the month's budget has left for them.
 */
export function plannedMonthWords(
  planned: PlannedMonth,
  input: {
    readonly name: string;
    readonly asOf: IsoDate;
    /** Left of the month's spending budget; null when none is set. */
    readonly spendingLeft: Centavos | null;
    /** How far the money lets the spending budget rise, for the month running; null otherwise. */
    readonly room?: Centavos | null | undefined;
  },
): string {
  const { name, asOf } = input;
  if (planned.views.length === 0) return `Nothing is planned in ${name} that is still to pay. Say "plan tuition 9000 on nov 15" to add one, or open the Planner.`;
  const lines = planned.views.slice(0, 12).map((v) => {
    const notes = [
      v.plan.due < asOf ? "overdue" : "",
      v.paid > 0 ? `${formatMoney(v.paid)} paid` : "",
      v.plan.goalId ? "from its goal" : !v.plan.setAside ? "not in safe to spend" : "",
    ].filter(Boolean);
    return `- ${v.plan.title}: ${formatMoney(v.left)}, ${whenOf(v.plan).replace(/^S/, "s")}${notes.length > 0 ? ` (${notes.join(", ")})` : ""}`;
  });
  const setAside = planned.views.filter((v) => v.plan.setAside && !v.plan.goalId && v.plan.due.slice(0, 7) <= asOf.slice(0, 7)).reduce((s, v) => s + v.left, 0);
  const out = [
    `**${formatMoney(planned.total)} is planned in ${name} and not paid yet**, ${planned.views.length === 1 ? "one plan" : `${planned.views.length} plans`}${planned.billsSubs > 0 ? `, ${formatMoney(planned.billsSubs)} of it under bills and subscriptions` : ""}:`,
    ...lines,
  ];
  if (setAside > 0 && setAside < planned.total) out.push(`Safe to spend holds back ${formatMoney(setAside)} of it; the rest is not set aside.`);
  else if (setAside > 0) out.push("Safe to spend holds back all of it until it is paid.");
  if (planned.spending > 0) {
    const left = input.spendingLeft;
    if (left === null) out.push(`${name} has no spending budget yet: "Usual + plans" on the Budget screen sets one with these in it.`);
    else if (left >= planned.spending) out.push(`The spending budget has ${formatMoney(left)} left; after these, ${formatMoney(left - planned.spending)} is free for the rest.`);
    else {
      const short = planned.spending - Math.max(0, left);
      const room = input.room ?? null;
      out.push(
        room !== null && room < short
          ? `They need ${formatMoney(short)} more than the spending budget has left, and your money ${room > 0 ? `lets it rise by only ${formatMoney(room)}` : "does not let it rise"}: move a plan to a later month, or skip one.`
          : `They need ${formatMoney(short)} more than the spending budget has left: raise it on the Budget screen, or move a plan to another month.`,
      );
    }
  }
  return out.join("\n");
}

/** "What's planned?": the open plans, overdue first, each with its state. */
export function plansWords(views: readonly PlanView[], setAside: Centavos): string {
  const open = views.filter((v) => v.state !== "paid" && v.state !== "skipped" && v.state !== "removed").sort((a, b) => a.plan.due.localeCompare(b.plan.due));
  if (open.length === 0) return 'Nothing is planned. Say "plan tuition 9000 by November 15" and it goes on the Planner, or open the Planner to add one.';
  const total = open.reduce((s, v) => s + v.left, 0);
  const lines = open.slice(0, 12).map((v) => {
    const more = [
      v.words === whenOf(v.plan) || v.words === "No date yet" ? "" : v.words,
      v.counts ? "set aside" : "",
      v.goal && !v.goal.missing ? `${v.goal.name} holds ${formatMoney(v.goal.holds)}` : "",
    ].filter(Boolean).join(", ");
    return `- ${v.plan.title}: ${formatMoney(v.left)} ${byWhen(v.plan)}.${more ? ` ${more.charAt(0).toUpperCase()}${more.slice(1)}.` : ""}`;
  });
  return [
    `**${open.length} ${open.length === 1 ? "plan" : "plans"} open, ${formatMoney(total)} still to pay.**${setAside > 0 ? ` ${formatMoney(setAside)} of it is set aside from this month's safe to spend.` : ""}`,
    ...lines,
    open.length > 12 ? `And ${open.length - 12} more on the Planner.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** "November 15, 2026" with how far off it is. */
export function dueWords(due: IsoDate, asOf: IsoDate): string {
  const month = MONTH_NAMES[Number(due.slice(5, 7)) - 1] ?? "";
  return `${month} ${Number(due.slice(8, 10))}, ${due.slice(0, 4)}${due < asOf ? " (already passed)" : ""}`;
}
