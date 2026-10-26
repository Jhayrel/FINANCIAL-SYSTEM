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
import { addDays, dayOfWeek, lastOfMonth, MONTH_NAMES } from "./dates";
import { formatMoney, parseAmount, withoutYears, type Centavos } from "./money";
import { byWhen, dueFor, kindFromHistory, NO_DATE, planKinds, whenOf, type DueKind, type Plan, type PlanInput, type PlanView } from "./planner";
import type { IsoDate, ReferenceLists, Transaction } from "./types";

export type PlannerAsk =
  | { readonly kind: "list" }
  | { readonly kind: "add"; readonly input: PlanInput }
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
    /\b20\d{2}-\d{2}-\d{2}\b|\b(?:tomorrow|bukas|today|tonight|next\s+week|this\s+week(?:end)?|christmas|pasko|new\s+year|end\s+of\s+(?:the\s+|this\s+)?month)\b|\bin\s+(?:\d{1,2}|a|one|two|three)\s+(?:days?|weeks?)\b|\bthe\s+\d{1,2}(?:st|nd|rd|th)\b|\b(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/.test(t) ||
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

  // "What's planned?", "show my planner", "what plans are due this week?"
  if (/\b(?:what(?:'s| is| do i have)?|show|list|any|see|check)\b[^.?!]{0,30}\b(?:planned|planner|plans)\b/i.test(t) && !/\b(?:add|move|skip|remove|delete|pay|paid)\b/i.test(t)) {
    return { kind: "list" };
  }

  // Adding: "plan tuition 9000 on nov 15", "add a new phone 25k by march 2027 to my planner".
  const adds =
    /^\s*(?:please\s+|pls\s+)?(?:plan|schedule)\s+(?!to\b)/i.test(t) ||
    /\b(?:to|in|into|on)\s+(?:my|the)\s+planner\b|\badd\s+(?:a\s+)?(?:new\s+)?plan\b|\bnew\s+plan\b|^\s*remind\s+me\s+to\s+pay\b/i.test(t);
  if (adds && !QUESTIONISH.test(t)) {
    const amount = sumIn(t);
    // The day, month or year said; with none, no date (counted nowhere until it has one).
    const when = whenFor(t, asOf);
    const due = when?.due ?? NO_DATE;
    const wallet = [...reference.wallets, ...reference.savings].find((w) => new RegExp(`\\b(?:from|using|with|via)\\s+${w.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(t)) ?? "";
    const title = t
      .replace(/^\s*(?:please\s+|pls\s+)?(?:plan|schedule|add|put|remind\s+me\s+to\s+pay)\s+/i, "")
      .replace(/\b(?:to|in|into|on)\s+(?:my|the)\s+planner\b/gi, " ")
      .replace(/\b(?:a\s+)?(?:new\s+)?plan\s+(?:for\s+)?/gi, " ")
      .replace(/(?:₱|php\s*)?\d[\d,]*(?:\.\d{1,2})?\s*k?\b/gi, " ")
      .replace(new RegExp(String.raw`\b(?:on|by|for|in|until|before|this|next)?\s*${MONTH_RE}\.?(?:\s+\d{1,2}(?:st|nd|rd|th)?)?(?:,?\s+20\d{2})?\b`, "gi"), " ")
      .replace(/\b(?:by|on|for|in|due|before)?\s*(?:next\s+(?:month|week|year)|this\s+(?:month|year)|end of (?:the |this )?month|tomorrow|in\s+\w+\s+(?:days?|weeks?|months?)|in\s+20\d{2})\b/gi, " ")
      .replace(NO_DAY_G, " ")
      .replace(/\b(?:from|using|with|via)\s+\S+/gi, " ")
      .replace(/\b(?:pesos?|php|worth|of|to pay|pay|for|by|on|due|the|my|a|an)\b/gi, " ")
      .replace(/[,.:;!]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (amount === null || !title) return null;
    const kinds = planKinds(reference).options;
    const name = title.replace(/^./, (c) => c.toUpperCase());
    const recurring = [...reference.bills, ...reference.subscriptions].some((b) => b.toLowerCase() === (kindFromHistory(name, transactions, kinds) ?? "").toLowerCase());
    return {
      kind: "add",
      input: { title: name, amount, due, dueKind: when?.kind ?? "none", item: kindFromHistory(name, transactions, kinds) ?? "", wallet, need: !/\b(?:want|treat|gadget|trip|vacation|concert)\b/i.test(t), setAside: !recurring, notes: "" },
    };
  }

  if (!PLANNER.test(t)) return null;
  const open = plans.filter((p) => p.status === "open");

  // A field other than the date, the amount or a payment ("the trip plan is a want", "don't count the trip plan").
  if (!/\b(?:put\s+back|restore|bring\s+back|reopen|paid|move|extend|postpone)\b/i.test(t)) {
    const plan = planNamed(t, open, ["open"]);
    const edit = plan ? editIn(t, plan, reference, context.goals ?? []) : null;
    if (plan && edit) return { kind: "edit", plan, input: edit.input, changes: edit.changes };
  }

  if (/\b(?:put\s+back|restore|bring\s+back|un-?skip|reopen)\b/i.test(t)) {
    const plan = planNamed(t, plans, ["removed", "skipped", "done"]);
    return plan ? { kind: "restore", plan } : { kind: "none", said: t };
  }
  if (/\b(?:remove|delete|take\s+off|drop)\b/i.test(t)) {
    const plan = planNamed(t, plans, ["open", "skipped", "done"]);
    return plan ? { kind: "remove", plan } : { kind: "none", said: t };
  }
  if (/\b(?:skip|cancel|won'?t|not\s+(?:going|buying|paying)|no\s+longer|call\s+off)\b/i.test(t)) {
    const plan = planNamed(t, open, ["open"]);
    return plan ? { kind: "skip", plan } : { kind: "none", said: t };
  }
  if (/\b(?:move|extend|push|postpone|resched\w*|delay|change\s+the\s+date|later\s+to)\b/i.test(t)) {
    const plan = planNamed(t, open, ["open"]);
    // "Move the trip plan to december" is a month; "... to no date yet" takes the date away.
    const when = NO_DAY.test(t) ? null : whenFor(t, asOf);
    if (plan && NO_DAY.test(t)) return { kind: "move", plan, to: NO_DATE, toKind: "none" };
    return plan && when ? { kind: "move", plan, to: when.due, toKind: when.kind } : plan ? null : { kind: "none", said: t };
  }
  if (/\b(?:paid|pay|settle|mark\b[^.?!]{0,30}\bpaid)\b/i.test(t)) {
    const plan = planNamed(t, open, ["open"]);
    if (!plan) return { kind: "none", said: t };
    const wallet = [...reference.wallets, ...reference.savings].find((w) => new RegExp(`\\b${w.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(t)) ?? "";
    return { kind: "pay", plan, amount: sumIn(t), wallet };
  }
  if (/\b(?:is\s+now|now|costs?|price|change|make\s+it|actually)\b/i.test(t)) {
    const plan = planNamed(t, open, ["open"]);
    const amount = sumIn(t);
    return plan && amount !== null && amount !== plan.amount ? { kind: "amount", plan, amount } : null;
  }
  return null;
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
