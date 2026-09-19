/**
 * Whether a message says when, in any of the ways the owner says it.
 *
 * On 2026-09-18 the owner typed a borrowing, a withdrawal and a treat with no
 * day in it, the app told the model "Today is 2026-09-18", and every card came
 * back dated the 17th. They were saved that way. A message that names no day
 * is today's, and that is not something to leave to a model: the cards read
 * from such a message are dated today here, after the model has answered.
 */

const WHEN = new RegExp(
  [
    String.raw`\b(today|tonight|yesterday|tomorrow|kahapon|kanina|ngayon|kagabi|mamaya|bukas|kamakalawa)\b`,
    String.raw`\b(last|this|next)\s+(night|week|month|year|morning|afternoon|evening|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b`,
    String.raw`\b(\d+|a|an|one|two|three|four|five|six|seven)\s+(days?|weeks?|months?)\s+ago\b`,
    String.raw`\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)\b`,
    String.raw`\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(st|nd|rd|th)?\b`,
    String.raw`\b\d{1,2}(st|nd|rd|th)?\s+(of\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b`,
    String.raw`\b\d{1,2}[/-]\d{1,2}([/-]\d{2,4})?\b`,
    String.raw`\b20\d{2}-\d{2}-\d{2}\b`,
    String.raw`\b(noong|nung)\s+\w+`,
  ].join("|"),
  "i",
);

/** True when the message names a day, relative or not. */
export function saysWhen(text: string): boolean {
  return WHEN.test(text);
}
