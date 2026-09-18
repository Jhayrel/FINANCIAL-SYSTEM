/**
 * What the assistant can do, and the one place it does not reach.
 *
 * The owner, 2026-09-17: "add, move, delete, edit, change, etc. ... it can do
 * everything, not in Settings, it's restricted." And, in the same message:
 * "What can my AI do?" This answers the question in the chat the same way
 * it is answered here, and draws the line at Settings in one place.
 */

/** "what can you do", "what can my ai do", "help". */
export function wantsCapabilities(text: string): boolean {
  return /\b(what (can|could) (you|my ai|the ai|the assistant|this ai) do|what are you able to do|what can i ask( you)?|how (do|can) i use (you|the ai|the assistant|this chat)|what do you do|your (features|capabilities)|help me use (you|the ai))\b/i.test(
    text,
  ) || /^\s*(help|\?)\s*$/i.test(text);
}

/**
 * A request to change Settings: accounts, categories, credit lines, alerts,
 * the theme, the AI's own switches and model. Changing entries, budgets and
 * the category of one entry is not a setting.
 */
export function asksSettingsChange(text: string): boolean {
  if (/\b(settings?|dark mode|light mode|theme)\b/i.test(text) && /\b(change|set|switch|turn|make|update|enable|disable|open)\b/i.test(text)) {
    return true;
  }
  return /\b(add|create|rename|archive|remove|delete)\s+(a\s+|an\s+|the\s+|my\s+|new\s+)*(account|wallet|savings account|category|spending type|bill|subscription|credit line|loan account|goal)\b/i.test(text)
    || /\b(change|switch|set)\s+(the\s+|my\s+)?(ai\s+)?(provider|model|api key|low balance (alert|warning)|alert threshold)\b/i.test(text);
}

export const SETTINGS_ARE_YOURS =
  "Settings are yours to change: accounts, categories, bills and subscriptions, credit lines, alerts, the theme and the AI itself. Open Settings for those. Everything else I can do from here: add, correct, move, bin and restore entries, set budgets and limits, and find where a difference went.";

/** The answer to "what can you do", with the one restriction said plainly. */
export function capabilitiesAnswer(): string {
  return [
    "Here is what I can do. Nothing is added, changed or deleted until you press the button on its card.",
    "- **Add entries** from a sentence, a receipt, a screenshot or a pasted list: spending, income, transfers, money sent to someone, and debt (borrowing with its fees, charges the lender added, payments with interest inside).",
    "- **Correct and move entries**: \"change the treat yesterday to 1200\", \"move my spotify from gcash to maya\", \"move all grab rides this month to cash\".",
    "- **Bin and restore**: \"delete the food I paid yesterday\", \"restore my deleted entry\", \"delete everything entered by ai\".",
    "- **Budgets and limits**: \"set my budget to 8000\", \"limit food to 3000 for the rest of the year\", \"same budget as last month\".",
    "- **Find a difference**: \"my maya balance is 30000, where's the rest?\", with screenshots of the balance and the history, or the history pasted underneath.",
    "- **Answer questions and advise** from your own figures, and **draw charts**: \"how did august compare with july\", \"chart my food this month\".",
    "- **On behalf of someone**, apart from debt: an advance for a friend who pays you back, money sent that your mother repays, money you hold for someone. Reimbursed, released, a write off (it becomes spending) or retained (it becomes income): \"I paid Carlo's food 180 cash, he will pay me back\", \"Carlo will not pay, write it off\".",
    "- **Debt** is banks, credit lines and loans, yours or with a person: \"I borrowed 1000 from kuya\", \"I lent 500 to Juan\", \"I paid my credit\".",
    "**Settings stay yours**: accounts, categories, credit lines, alerts, the theme and the AI's own switches are changed on the Settings screen, not by me.",
  ].join("\n");
}
