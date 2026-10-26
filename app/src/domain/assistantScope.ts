/**
 * What the assistant can do, and the one place it does not reach.
 *
 * The owner, 2026-09-17: "add, move, delete, edit, change, etc. ... it can do
 * everything, not in Settings, it's restricted." And, in the same message:
 * "What can my AI do?" This answers the question in the chat the same way
 * it is answered here, and draws the line at Settings in one place.
 */

import { isQuestion } from "./intent";
import { asksSafeToSpend } from "./safeAsk";

/** "what can you do", "what can my ai do", "help". */
export function wantsCapabilities(text: string): boolean {
  return /\b(what (can|could) (you|my ai|the ai|the assistant|this ai) do|what are you able to do|what can i ask( you)?|how (do|can|should) i use (you|the ai|the assistant|this chat|this system|the system|this app|the app)|how to use (this|the) (system|app|ai|chat)|how does (this|the) (app|system) work|paano gamitin|what do you do|your (features|capabilities)|help me use (you|the ai))\b/i.test(
    text,
  ) || /^\s*(help|\?)\s*$/i.test(text);
}

/**
 * "WHAT KIND OF TABLE CAN MY SYSTEM PROVIDE LIKE CHARTS, TRENDS ETC??", 6
 * October 2026: it named a chart and a trend, so it was drawn, as October's
 * spending by day. It asks what can be drawn, not for one drawing.
 */
const WHAT_KINDS =
  /\bwhat\s+(?:kinds?|types?|sorts?)\s+of\s+(?:tables?|charts?|graphs?|trends?|reports?|visuals?|statements?|files?|pies?)\b|\bwhat\s+(?:tables?|charts?|graphs?|reports?|visuals?|statements?)\s+(?:can|could|do|does|will)\s+(?:you|it|my|the|this|i)\b|\b(?:which|anong|ano\s+(?:ang\s+)?mga)\s+(?:tables?|charts?|graphs?|reports?)\s+(?:can|could|ang|pwede|kaya)\b/i;

export function asksWhatChartsExist(text: string): boolean {
  const t = text.trim();
  return t.split(/\s+/).length <= 24 && WHAT_KINDS.test(t);
}

/** What the app draws and makes, with a way to ask for each in plain words. */
export function chartsAnswer(): string {
  return [
    "Here is what I can draw or make for you. Ask in your own words, for any day, week, month, range or year.",
    "- **Where the money went**: by item, category or wallet, as bars or a pie. \"where did my money go this month\", \"pie of september by wallet\".",
    "- **Trends over time**: by day, week, month or year, as a line. \"trend of my food since march\", \"daily spending this week\", \"income by month this year\".",
    "- **Two periods side by side**: \"this month compared to last month\", \"august vs july\".",
    "- **Budget against what was spent**: month by month, or one month day by day against a steady pace. \"budget vs actual this year\".",
    "- **Balances**: each account now, or one over time. \"how much is in each account\", \"chart my maya balance\".",
    "- **What is owed**: a credit line or loan over time. \"chart my maya credit\".",
    "- **A trip or a place**, found in your descriptions: \"spending on my abra trip\".",
    "- **Tables as files**: a statement as a PDF (account, wallet, income, expenses, debt) over any span, a spreadsheet of entries, or a full backup. \"account statement for september\", \"export october as a spreadsheet\".",
    "Each chart comes with a sentence saying what it shows: the biggest part, the high and low, and how two periods differ.",
  ].join("\n");
}

/**
 * A request to change Settings: accounts, categories, credit lines, alerts,
 * the theme, the AI's own switches and model. Changing entries, budgets and
 * the category of one entry is not a setting.
 */
export function asksSettingsChange(text: string): boolean {
  /*
   * A sum with the bills taken out, or a question, is never a change to
   * Settings. 5 and 6 October 2026: "What is my safe spending? ... remove the
   * subscription and bills" and "You need to remove the subscription and bill
   * to the equation" were both told "Settings are yours to change", three
   * times. "How do I add a bill?" goes to the model, which knows where
   * Settings is and says so.
   */
  if (asksSafeToSpend(text) || isQuestion(text)) return false;
  if (/\b(settings?|dark mode|light mode|theme)\b/i.test(text) && /\b(change|set|switch|turn|make|update|enable|disable|open)\b/i.test(text)) {
    return true;
  }
  return /\b(add|create|open|rename|archive|remove|delete)\s+(a\s+|an\s+|the\s+|my\s+|new\s+)*(account|wallet|savings account|category|spending type|bill|subscription|credit line|loan account|goal)\b/i.test(text)
    || /\b(change|switch|set)\s+(the\s+|my\s+)?(ai\s+)?(provider|model|api key|low balance (alert|warning)|alert threshold)\b/i.test(text);
}

export const SETTINGS_ARE_YOURS =
  "Settings are yours to change: accounts, categories, bills and subscriptions, a credit line's rate, alerts, the theme and the AI itself. The button below opens the right tab. Everything else I can do from here: add, edit, move, bin and restore entries, set budgets and limits, a credit line's limit and due day, find where a difference went, and hand you a backup or a spreadsheet.";

/** The answer to "what can you do", with the one restriction said plainly. */
export function capabilitiesAnswer(): string {
  return [
    "Here is what I can do. Nothing is added, changed or deleted until you press the button on its card.",
    "- **Add entries** from a sentence, a receipt, a screenshot or a pasted list: spending, income, transfers, money sent to someone, and debt (borrowing with its fees, charges the lender added, payments with interest inside).",
    "- **Edit and move entries**: \"change the treat yesterday to 1200\", \"move my spotify from gcash to maya\", \"move all grab rides this month to cash\".",
    "- **Bin and restore**: \"delete the food I paid yesterday\", \"restore my deleted entry\", \"delete everything entered by ai\".",
    "- **Budgets and limits**, for one month or many: \"set my budget to 8000\", \"set october to december to 9000\", \"for the next 3 months\", \"limit food to 3000 from now on\", \"same budget as last month\", \"use the forecast\". After a budget card, \"make it september to december\" moves it.",
    "- **Find a difference**: \"my maya balance is 30000, where's the rest?\", with screenshots of the balance and the history, or the history pasted underneath.",
    "- **Answer questions and advise** from your own figures, including what if: \"what if I buy a 25k phone\", \"how much did I spend from sep 1 to 15\".",
    "- **Draw charts** over any window, as bars, a pie or a line: \"chart today\", \"this week's trend\", \"last 10 days\", \"since august\", \"sep 1 to sep 15\", \"this quarter\", \"daily spending in august\", \"income vs spending this year\". Also spending against the budget (\"budget vs actual this year\"), balances (\"chart my maya balance\", \"how much is in each account\") and what is owed (\"chart my maya credit\"). A question that a chart answers better (\"where did my money go this month?\", \"is my food going up?\") gets one beside the answer.",
    "- **On behalf of someone**, apart from debt: an advance for a friend who pays you back, money sent that your mother repays, money you hold for someone. Paid for them, paid you back, let it go (it becomes spending); received for them, given to them, kept as yours (it becomes income): \"I paid Carlo's food 180 cash, he will pay me back\", \"Carlo will not pay, write it off\". A line paid past zero or with a little left is cleared in one step: \"clear Carlo\", \"keep the 1 peso from Carlo\".",
    "- **Debt** is banks, credit lines and loans, yours or with a person: \"I borrowed 1000 from kuya\", \"I lent 500 to Juan\", \"I paid my credit\".",
    "- **Give you a file**: \"export everything\", \"make me a backup\", \"export september as a spreadsheet\", \"download my debt statement\". It goes to this device and nowhere else.",
    "- **Budget from your money**: \"set November to 14000\" (the whole month, bills inside it), \"set November spending to 12000 and bills to 2000\", \"base my budget on my 10k income, save 20%\", \"lower my budget to my money\".",
    "- **Find and total**: \"search Framelink\", \"how much have I earned since 2022\", \"bills only statement for October\", \"518 is what's left of my cash, all on travel\".",
    "- **Summaries your way**: ask for a summary or the details and it is written; say pie, bars or trend and it is drawn.",
    "- **Bills due**: \"what bills are due?\", \"anything to pay this week?\", \"did I pay Globe this month?\", each with its date and amount.",
    "- **Savings goals**: \"I want to save 5000 by December\", \"how long to save 10k?\": what it takes a day, a week and a month, against what your last three months kept.",
    "- **Your week**: \"how was my week?\", \"review last week\": what went out, against the week before, where it went and the busiest day.",
    "- **The last time**: \"how much did I pay for gas last time?\", \"when did I last buy Jollibee?\", \"how much do I usually pay for load?\"",
    "- **Days and dates**: \"what did I buy last friday?\", \"gas 200 2 days ago\", \"food 150 noong lunes\": the day is read from your words.",
    "- **Open any screen**: \"open the budget\", \"go to needs review\", \"open insights for september\", \"open settings categories\".",
    "- **Needs review, one entry at a time**: \"what's wrong with #3831?\" says what the check found and both ways out; \"keep #3831 as it is\" marks it checked and moves no money.",
    "- **Credit lines**: \"set my Maya Credit limit to 15000\", \"Maya Credit is due on the 5th\", \"the billing day is the 6th\", \"how much is left on my limit?\"",
    "- **What changed, and undo**: \"what did I change today?\", \"what did the AI add this week?\", and \"undo that\" for the last thing done here. A list from the bin has **Restore all**.",
    "- **The Planner**, for spending ahead: \"plan tuition 9000 by nov 15\", \"I'm planning a trip to Baguio on Dec 20, around 5000\", \"we're planning a party for mama on nov 20, 2500\", \"add it as a plan\" after a question, \"what is planned?\", \"move the tuition plan to nov 30\", \"the tuition plan is now 9500\", \"I paid the tuition plan from maya\", \"skip the tuition plan\", \"remove the tuition plan\", \"put back the tuition plan\". Said with no amount, I ask for it and show what it cost before. A plan counts in safe to spend in its month until it is paid.",
    "- **A plan for today is today's money**: \"I plan to buy food at the mall today\" or \"my plan tonight is dinner out\" gets today's breakdown (what it usually costs you, today's figure, what it leaves), never a plan or an entry.",
    "**The screens**: Dashboard (today and the month), Add (a new entry), Database (every entry, search and edit), Debt, Insights (charts over any window), Budget, Statements (PDF and spreadsheet), Planner (spending ahead), Bin, Activity (what changed) and Settings.",
    "**Settings stay yours**: accounts, categories, a credit line's rate, alerts, the theme and the AI's own switches are changed on the Settings screen, not by me. Ask for one and I open the right tab.",
  ].join("\n");
}
