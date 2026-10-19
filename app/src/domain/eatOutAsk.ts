/**
 * "Should I eat outside tomorrow?", answered by the app from the day's figure
 * and what a meal usually costs the owner.
 *
 * 19 October 2026: the model answered from a figure in an earlier answer,
 * PHP 51.97, a day's figure that was no longer true. The figure check let it
 * through because the earlier answer held it. The day's figures change every
 * day, so the comparison is made here, from today's, as `dayFit.ts` does.
 */
import type { EverydayPrice } from "./dayFit";
import type { Centavos } from "./money";

export interface EatOutAsk {
  readonly when: "today" | "tomorrow";
}

const ASKS =
  /\b(?:should|can|could|shall|may|pwede|puwede|kaya|is it (?:ok|okay|fine|wise|good)|ok(?:ay)? (?:lang )?ba)\b[^?.!]*\b(?:eat(?:ing)? (?:out|outside)|dine out|dining out|eat at (?:a )?(?:restaurant|resto|fast ?food|mall)|kumain sa labas|kain sa labas|order (?:food|delivery)|grab ?food|food ?panda)\b/i;

/** A question about eating out, with no figure of its own (a figure is an afford question). */
export function readEatOutAsk(text: string): EatOutAsk | null {
  const t = text.trim();
  if (!ASKS.test(t) || /\d/.test(t)) return null;
  return { when: /\b(?:tomorrow|tommorrow|tomorow|tmrw|tmr|bukas)\b/i.test(t) ? "tomorrow" : "today" };
}

/** The everyday item a meal out is, by the owner's own names: eating out first, then food. */
export function mealPrice(prices: readonly EverydayPrice[]): EverydayPrice | null {
  return (
    prices.find((p) => /\b(?:eat(?:ing)? ?out|dine|dining|restaurant|resto|fast ?food)\b/i.test(p.name)) ??
    prices.find((p) => /\b(?:food|meals?|lunch|dinner|ulam|kain|pagkain)\b/i.test(p.name)) ??
    null
  );
}

export function eatOutAnswer(
  ask: EatOutAsk,
  day: { readonly today: Centavos; readonly after: Centavos; readonly daysLeft: number },
  meal: EverydayPrice | null,
  money: (c: Centavos) => string,
): string {
  const tomorrow = ask.when === "tomorrow";
  if (tomorrow && day.daysLeft <= 1) {
    return "Tomorrow is in next month, and what is safe then depends on the money that comes in. Today's figure is the last one this month.";
  }
  const figure = tomorrow ? day.after : day.today;
  const named = tomorrow ? `Tomorrow you can spend **${money(figure)}**` : `Today you can still spend **${money(figure)}**`;
  if (!meal) {
    return `${named}. Your entries have no usual price for a meal yet, so keep a meal out to that figure.`;
  }
  const usual = `A meal usually costs you ${money(meal.usual)} going by ${meal.name} (${meal.count} times in 60 days${meal.low === meal.high ? "" : `, ${money(meal.low)} to ${money(meal.high)}`})`;
  if (figure <= 0) {
    return `${tomorrow ? "Tomorrow's" : "Today's"} figure is used up, so no: eating out would come out of the days after it. ${usual}.`;
  }
  if (meal.usual <= figure) {
    return `${named}. ${usual}: yes, it fits, with ${money(figure - meal.usual)} left for the rest of the day.`;
  }
  return `${named}. ${usual}: not on that figure, it is ${money(meal.usual - figure)} more. A meal at home, or one under ${money(figure)}, keeps the day on its figure.`;
}
