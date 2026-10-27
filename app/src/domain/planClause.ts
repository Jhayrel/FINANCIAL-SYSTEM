/**
 * An entry and a plan in one message: "I bought shoes 2500 and I plan to buy
 * a bag next month 1500". The first part happened, the second has not. Read
 * whole, the entry was described "shoes plan bag next" and the plan was lost
 * (27 October 2026 sweep).
 *
 * Only a plan clause after the money moved is split off, joined by "and",
 * "then", "but" or their Filipino, with a person saying what they will do.
 */
const DONE = /\b(?:spent|paid|bought|purchased|got|received|recieved|sent|nagbayad|binili|bumili|nabili|ginastos|nagastos)\b/i;
const JOIN =
  /[\s,.;]+(?:and|then|but|tapos|pero|at)\s+(?=(?:i|we)\s*(?:'m|'re|'ll|\s+am|\s+are|\s+will|\s+plan|\s+want|\s+need|\s+intend|\s+wanna|\s+have\s+to)\b|(?:also\s+)?(?:balak|plano|gusto)\s+(?:ko|kong|namin)\b|(?:next|this)\s+(?:week|month)\s+(?:i|we)\b)/i;

/** The part that happened and the plan said after it; null when the message is not both. */
export function splitPlanClause(text: string): { readonly done: string; readonly plan: string } | null {
  const m = JOIN.exec(text);
  if (!m || m.index === 0) return null;
  const done = text.slice(0, m.index).trim();
  const plan = text.slice(m.index + m[0].length).trim();
  // "balak kong bumili" is to buy, not bought.
  const planned = plan.replace(/\b(?:balak|plano|gusto)\s+(?:ko|kong|namin|naming)\s+(?:na\s+)?bumili\b/gi, " ");
  if (!DONE.test(done) || !/\d/.test(done) || DONE.test(planned) || plan.split(/\s+/).length < 3) return null;
  return { done, plan };
}

/** The message without a plan said after an entry: what the entry reader reads. */
export const withoutPlanClause = (text: string): string => splitPlanClause(text)?.done ?? text;
