/**
 * "Open the budget", "take me to the debt screen", "go to needs review":
 * a screen, opened from the chat.
 *
 * The owner, 26 October 2026: "look at all the features of my system and
 * make sure ai can do it all". Every screen was a tap away and none was a
 * sentence away: "open the budget" was answered with the month's figures.
 * Opening a screen changes nothing, so it is done at once rather than put on
 * a card. Settings stays the owner's to change (owner, 17 September 2026), so
 * a request to change a setting gets the right tab of Settings, opened by a
 * button, rather than the change.
 */

export type GoScreen = "dashboard" | "add" | "database" | "debt" | "insights" | "budget" | "planner" | "statements" | "bin" | "activity" | "settings";

export type SettingsTab = "accounts" | "goals" | "credit" | "categories" | "alerts" | "ai" | "appearance" | "data";

export interface GoPlace {
  readonly screen: GoScreen;
  /** Settings only: the tab to open on. */
  readonly tab?: SettingsTab;
  /** Database only: the Needs review list rather than every entry. */
  readonly review?: boolean;
  /** Insights only: the month to open on, "2026-09". */
  readonly month?: string;
  /** What it is called, for "Opened Budget." and "Open Budget". */
  readonly label: string;
}

const TAB_LABEL: Readonly<Record<SettingsTab, string>> = {
  accounts: "Accounts",
  goals: "Goals",
  credit: "Credit and loans",
  categories: "Categories",
  alerts: "Alerts",
  ai: "AI",
  appearance: "Appearance",
  data: "Data",
};

/** The words for each Settings tab, the tab's own name first. */
const TAB_WORDS: readonly (readonly [SettingsTab, RegExp])[] = [
  ["accounts", /\b(?:accounts?|wallets?|savings accounts?)\b/i],
  ["goals", /\bgoals?\b/i],
  ["credit", /\b(?:credit and loans|credit lines?|loan accounts?)\b/i],
  ["categories", /\b(?:categor(?:y|ies)|spending types?|kinds? of (?:spending|income)|bills?|subscriptions?)\b/i],
  ["alerts", /\b(?:alerts?|low balance(?: warning| alert)?)\b/i],
  ["ai", /\b(?:ai(?: settings| assistant)?|provider|model|api key)\b/i],
  ["appearance", /\b(?:appearance|theme|dark mode|light mode)\b/i],
  ["data", /\b(?:data|backups?|restore from a backup|sign out|log ?out|firebase|sync)\b/i],
];

/** The screens and what they are called, longest names first so "debt screen" is not read as "debt". */
const SCREENS: readonly (readonly [RegExp, Omit<GoPlace, "label"> & { readonly label: string }])[] = [
  [/needs?[-\s]review|(?:the\s+)?review list|flagged(?:\s+(?:rows|entries|list))?|(?:the\s+)?checks?/i, { screen: "database", review: true, label: "Needs review" }],
  [/dashboard|home(?:\s+screen)?|main(?:\s+screen)?|front page/i, { screen: "dashboard", label: "Dashboard" }],
  [/add(?:\s+(?:form|screen|page))?|(?:the\s+)?(?:entry|add)\s+form|new entry/i, { screen: "add", label: "Add" }],
  [/database|ledger|(?:all\s+)?(?:my\s+)?(?:entries|records|transactions)(?:\s+list)?/i, { screen: "database", label: "Database" }],
  [/debts?|credit|loans?|debt\s+screen/i, { screen: "debt", label: "Debt" }],
  [/insights?|charts?|graphs?/i, { screen: "insights", label: "Insights" }],
  [/planner|(?:my\s+)?plans|planned(?:\s+spending)?/i, { screen: "planner", label: "Planner" }],
  [/budgets?|(?:the\s+)?plan/i, { screen: "budget", label: "Budget" }],
  [/statements?/i, { screen: "statements", label: "Statements" }],
  [/(?:recycle\s+)?bin|trash|deleted(?:\s+(?:entries|rows|items|list))?/i, { screen: "bin", label: "Bin" }],
  [/activity(?:\s+(?:trail|log))?|(?:the\s+)?trail|change\s+log|(?:the\s+)?history of changes/i, { screen: "activity", label: "Activity" }],
  [/settings?|preferences/i, { screen: "settings", label: "Settings" }],
];

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

const VERB = String.raw`(?:open|go\s+(?:back\s+)?to|take\s+me\s+(?:back\s+)?to|bring\s+me\s+to|navigate\s+to|switch\s+to|jump\s+to|show\s+me\s+the|show\s+the|punta\s+(?:sa|tayo\s+sa)|buksan(?:\s+ang)?|pakita\s+ang)`;
const POLITE = String.raw`(?:(?:please|pls|plz|can\s+you|could\s+you|kindly|ok(?:ay)?|sige)[\s,]+)*`;
const TAIL = String.raw`(?:\s+(?:screen|page|tab|section|view))?(?:\s+(?:please|pls|plz|for me|now|po))*`;

/**
 * The place a short request to open a screen names, or null.
 *
 * The whole message has to be the request: "open" inside a longer sentence
 * ("I opened a new account", "show me the bin" asks for the rows, which the
 * bin finder answers) is never read as one. "Show me the X" opens only with
 * "screen", "page" or "tab" after it.
 */
export function readGoAsk(text: string, asOf: string): GoPlace | null {
  const t = text.trim().replace(/[.!?]+$/, "");
  if (!t || t.split(/\s+/).length > 10 || /\d{3,}/.test(t.replace(/\b20\d{2}\b/, ""))) return null;
  // "Go home", "back to home": the Dashboard. It was read as a Globe at Home Wifi bill (26 October 2026).
  if (new RegExp(`^${POLITE}(?:go\\s+(?:back\\s+)?home|back\\s+(?:to\\s+)?(?:the\\s+)?home(?:\\s+screen)?|home(?:\\s+screen)?)(?:\\s+(?:please|pls|po|now))*$`, "i").test(t)) {
    return { screen: "dashboard", label: "Dashboard" };
  }
  const m = new RegExp(`^${POLITE}${VERB}\\s+(?:the\\s+|my\\s+|ang\\s+)?(.+?)${TAIL}$`, "i").exec(t);
  if (!m?.[1]) return null;
  let target = m[1].trim();
  const showVerb = /^\s*(?:\S+[\s,]+)*?show\b/i.test(t) || /\bpakita\b/i.test(t);
  if (showVerb && !/\b(?:screen|page|tab|section|view)\b/i.test(t)) return null;

  // "insights for september", "insights for september 2025"
  let month: string | undefined;
  const forMonth = /\s+(?:for|in|on)\s+([a-z]+)(?:\s+(20\d{2}))?$/i.exec(target);
  if (forMonth) {
    const i = MONTHS.findIndex((n) => n.startsWith((forMonth[1] ?? "").toLowerCase().slice(0, 3)) && (forMonth[1] ?? "").length >= 3);
    if (i >= 0) {
      const year = forMonth[2] ? Number(forMonth[2]) : Number(asOf.slice(0, 4)) - (i + 1 > Number(asOf.slice(5, 7)) ? 1 : 0);
      month = `${year}-${String(i + 1).padStart(2, "0")}`;
      target = target.slice(0, forMonth.index).trim();
    }
  }

  // Settings and a tab, either way round: "settings categories", "the categories in settings", "alerts settings".
  const settingsTab = /\bsettings?\b/i.test(target)
    ? (TAB_WORDS.find(([, words]) => words.test(target.replace(/\bsettings?\b/gi, " ")))?.[0] ?? null)
    : null;
  if (/\bsettings?\b/i.test(target)) {
    const rest = target.replace(/\b(?:in|on|under|of|the|my)\b|\bsettings?\b/gi, " ").trim();
    if (rest && !settingsTab) return null;
    return settingsTab ? { screen: "settings", tab: settingsTab, label: `Settings, ${TAB_LABEL[settingsTab]}` } : { screen: "settings", label: "Settings" };
  }

  const clean = target.replace(/\s+(?:screen|page|tab|section|view)$/i, "").trim();
  for (const [words, place] of SCREENS) {
    if (new RegExp(`^(?:${words.source})$`, "i").test(clean)) {
      return { ...place, ...(place.screen === "insights" && month ? { month, label: `Insights, ${MONTHS[Number(month.slice(5)) - 1]?.replace(/^./, (c) => c.toUpperCase()) ?? ""} ${month.slice(0, 4)}` } : {}) };
    }
  }
  // A Settings tab named alone: "open categories", "go to my accounts", "open alerts".
  const alone = TAB_WORDS.find(([tab, words]) => tab !== "data" && tab !== "ai" && new RegExp(`^(?:${words.source})$`, "i").test(clean));
  if (alone) return { screen: "settings", tab: alone[0], label: `Settings, ${TAB_LABEL[alone[0]]}` };
  return null;
}

/** The tab of Settings a request to change a setting is about, for the button under the answer. */
export function settingsPlaceFor(text: string): GoPlace {
  const tab = TAB_WORDS.find(([, words]) => words.test(text))?.[0];
  // "Stop my electric bill" is on Categories, beside the bill.
  const stop = /\b(?:stop|stopped|resume|start again)\b/i.test(text) ? "categories" : undefined;
  const found = stop ?? tab;
  return found ? { screen: "settings", tab: found, label: `Settings, ${TAB_LABEL[found]}` } : { screen: "settings", label: "Settings" };
}

/**
 * "Stop my electric bill", "I no longer pay netflix", "resume spotify": a
 * bill or subscription marked as stopped or started again, which Settings,
 * Categories does. Read here so it is never taken for an entry with no
 * amount ("How much was it?", 26 October 2026).
 */
export function asksToStopBill(text: string, names: readonly string[]): string | null {
  const t = text.trim();
  if (/\d/.test(t) || t.split(/\s+/).length > 12) return null;
  if (!/\b(?:stop|stopped|cancel(?:led)?|unsubscribe(?:d)?|no longer pay|don'?t pay|quit|resume|start again|restart)\b/i.test(t)) return null;
  const lower = t.toLowerCase();
  return (
    [...names]
      .filter((n) => n.trim().length > 2)
      .sort((a, b) => b.length - a.length)
      .find((n) => {
        const full = n.trim().toLowerCase();
        const first = full.split(/\s+/)[0] ?? full;
        return lower.includes(full) || (first.length >= 4 && new RegExp(`\\b${first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(lower));
      }) ?? null
  );
}

/** "Sign out", "log me out": Settings, Data, where Sign out is. */
export function asksToSignOut(text: string): boolean {
  return /^\s*(?:(?:please|pls|can you|could you)\s+)?(?:sign|log)\s*(?:me\s+)?out(?:\s+(?:of\s+)?(?:the\s+app|this device|here|now|please))*[.!?]*\s*$/i.test(text);
}
