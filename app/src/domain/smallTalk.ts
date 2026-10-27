/**
 * A greeting, a thanks, a bare figure, a sum: answered here, before anything
 * else reads the message.
 *
 * The 27 October 2026 sweep: "hello", "thanks", "100" and "what's 2+2" were
 * each answered with the month's summary, prefixed "I need the AI model to
 * understand that question". None of them needs a model, and a summary is
 * not an answer to any of them.
 */
import { formatMoney, parseAmount, type Centavos } from "./money";

export type SmallTalk =
  | { readonly kind: "hello" }
  | { readonly kind: "thanks" }
  | { readonly kind: "figure"; readonly amount: Centavos }
  | { readonly kind: "sum"; readonly terms: readonly Centavos[]; readonly signs: readonly (1 | -1)[] };

const HELLO = /^\s*(?:hi|hello|hey|hiya|yo|good\s+(?:morning|afternoon|evening|day)|kumusta|kamusta|musta|uy|oy)\b[\s!.,?]*(?:there)?[\s!.,?]*$/i;
// Only thanks: "ok" and "sige" answer a card, and are left to what reads cards.
const THANKS = /^\s*(?:ok(?:ay)?\s+)?(?:thanks|thank\s+you|thank\s+u|thx|ty|tysm|salamat|maraming\s+salamat)\b[\s!.,]*(?:po|so\s+much|a\s+lot)?[\s!.,]*$/i;

export function readSmallTalk(text: string): SmallTalk | null {
  const t = text.trim();
  if (!t) return null;
  if (HELLO.test(t)) return { kind: "hello" };
  if (THANKS.test(t)) return { kind: "thanks" };
  // "100", "₱250", "1.5k": a figure with nothing to say what it was.
  const bare = /^\s*(?:₱|php\s*)?(\d[\d,]*(?:\.\d{1,2})?)\s*(k)?\s*$/i.exec(t);
  if (bare?.[1]) {
    const base = parseAmount(bare[1]);
    if (base !== null && base > 0) return { kind: "figure", amount: bare[2] ? base * 1000 : base };
  }
  // "what's 150+80", "2+2", "500 - 120 + 35": adding and taking away, to the centavo.
  const sum = /^\s*(?:what'?s|what\s+is|how\s+much\s+is|compute|calculate|magkano\s+ang)?\s*((?:₱|php\s*)?\d[\d,]*(?:\.\d{1,2})?(?:\s*[+-]\s*(?:₱|php\s*)?\d[\d,]*(?:\.\d{1,2})?)+)\s*[?=]*\s*$/i.exec(t);
  if (sum?.[1]) {
    const parts = sum[1].replace(/₱|php/gi, "").split(/\s*([+-])\s*/);
    const terms: Centavos[] = [];
    const signs: (1 | -1)[] = [];
    for (let i = 0; i < parts.length; i += 2) {
      const v = parseAmount(parts[i] ?? "");
      if (v === null) return null;
      terms.push(v);
      signs.push(i === 0 || parts[i - 1] === "+" ? 1 : -1);
    }
    return terms.length >= 2 ? { kind: "sum", terms, signs } : null;
  }
  return null;
}

export function smallTalkAnswer(s: SmallTalk, name = ""): string {
  if (s.kind === "hello")
    return `Hello${name ? `, ${name}` : ""}. Tell me what you spent, like "lunch 150 cash", or ask about your money, like "how much can I spend today?" or "what's planned this month?".`;
  if (s.kind === "thanks") return "You're welcome.";
  if (s.kind === "figure")
    return `${formatMoney(s.amount)} for what? Say what it was and where it came from, like "lunch ${formatMoney(s.amount, { symbol: false }).replace(/\.00$/, "")} cash", and I make the card.`;
  const total = s.terms.reduce((acc, v, i) => acc + v * (s.signs[i] ?? 1), 0);
  const shown = s.terms.map((v, i) => `${i === 0 ? "" : s.signs[i] === 1 ? " + " : " − "}${formatMoney(v, { symbol: false })}`).join("");
  return `${shown} = **${total < 0 ? "−" : ""}${formatMoney(Math.abs(total), { symbol: false })}**`;
}
