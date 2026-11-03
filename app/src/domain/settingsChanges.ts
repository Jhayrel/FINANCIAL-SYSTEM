/**
 * What changed in Settings, in words, for the Activity trail.
 *
 * The owner, 27 October 2026: "//fix the activity it doesnt recognized edits
 * happening in settings". Activity heard entries, budgets and plans; an
 * account renamed, a goal's target moved, a bill dropped, a debt's due day
 * changed or the AI switched off left no trace. Each area is compared here,
 * before and after, and said as one short line per change: what it was and
 * what it is now. The owner's own details are said elsewhere by which parts
 * changed, never what they now say (`ownerChanges`), and plans have their own
 * events, so neither is repeated here.
 *
 * Pure, so it is tested without a screen. (`settingsDiff.ts` is another
 * thing: which sections to save, as JSON, for two devices.)
 */
import type { Account } from "./accounts";
import { formatMedium } from "./dates";
import type { Debt } from "./debt";
import { formatMoney } from "./money";
import type { AppSettings } from "./settings";
import type { SpendingType } from "./types";

export interface SettingsChange {
  /** Which part of Settings: Accounts, Goals, Categories, Debts, AI, Alerts, Display. */
  readonly area: string;
  /** One line a person can read. */
  readonly line: string;
}

const money = (c: number | undefined): string => formatMoney(c ?? 0);
const day = (d: string | undefined): string => (!d || d >= "9000" ? "no deadline" : formatMedium(d));
const quote = (s: string): string => `"${s}"`;

const KIND_WORDS: Record<string, string> = { spending: "a spending wallet", savings: "a savings account", reserve: "a reserve", goal: "a goal" };

function accountChanges(before: readonly Account[], after: readonly Account[]): SettingsChange[] {
  const out: SettingsChange[] = [];
  const was = new Map(before.map((a) => [a.id, a]));
  const now = new Map(after.map((a) => [a.id, a]));
  const parentName = (id: string | undefined, list: readonly Account[]): string => list.find((a) => a.id === id)?.name ?? "none";
  for (const a of after) {
    const b = was.get(a.id);
    const area = a.kind === "goal" ? "Goals" : "Accounts";
    if (!b) {
      out.push({
        area,
        line:
          a.kind === "goal"
            ? `Added the goal ${quote(a.name)} inside ${parentName(a.parentId, after)}, aiming for ${money(a.target)} by ${day(a.deadline)}`
            : `Added ${quote(a.name)} as ${KIND_WORDS[a.kind] ?? a.kind}`,
      });
      continue;
    }
    if (b.name !== a.name) out.push({ area, line: `Renamed ${quote(b.name)} to ${quote(a.name)}` });
    if (b.kind !== a.kind) out.push({ area, line: `${quote(a.name)} is now ${KIND_WORDS[a.kind] ?? a.kind}, was ${KIND_WORDS[b.kind] ?? b.kind}` });
    if (b.archived !== a.archived) out.push({ area, line: a.archived ? `Closed ${quote(a.name)}` : `Opened ${quote(a.name)} again` });
    if (a.kind === "goal" || b.kind === "goal") {
      if ((b.target ?? 0) !== (a.target ?? 0)) out.push({ area, line: `${quote(a.name)} target ${money(b.target)} to ${money(a.target)}` });
      if ((b.deadline ?? "") !== (a.deadline ?? "")) out.push({ area, line: `${quote(a.name)} deadline ${day(b.deadline)} to ${day(a.deadline)}` });
      if ((b.parentId ?? "") !== (a.parentId ?? "")) out.push({ area, line: `${quote(a.name)} moved from inside ${parentName(b.parentId, before)} to inside ${parentName(a.parentId, after)}` });
    }
    if ((b.channel ?? "bank") !== (a.channel ?? "bank")) out.push({ area, line: `${quote(a.name)} is now ${a.channel === "cash" ? "cash in hand" : "an account"}` });
  }
  for (const b of before) if (!now.has(b.id)) out.push({ area: b.kind === "goal" ? "Goals" : "Accounts", line: `Removed ${quote(b.name)}` });
  return out;
}

function listChanges(area: string, what: string, before: readonly string[], after: readonly string[]): SettingsChange[] {
  const lower = (s: string): string => s.trim().toLowerCase();
  const was = new Set(before.map(lower));
  const now = new Set(after.map(lower));
  const added = after.filter((x) => !was.has(lower(x)));
  const removed = before.filter((x) => !now.has(lower(x)));
  const out: SettingsChange[] = [];
  if (added.length > 0) out.push({ area, line: `Added to ${what}: ${added.join(", ")}` });
  if (removed.length > 0) out.push({ area, line: `Taken off ${what}: ${removed.join(", ")}` });
  return out;
}

const NECESSITY: Record<string, string> = { essential: "a need", discretionary: "a want", emergency: "an emergency" };

function kindChanges(before: readonly SpendingType[], after: readonly SpendingType[]): SettingsChange[] {
  const out = listChanges("Categories", "kinds of spending", before.map((t) => t.name), after.map((t) => t.name));
  const was = new Map(before.map((t) => [t.name.trim().toLowerCase(), t]));
  for (const t of after) {
    const b = was.get(t.name.trim().toLowerCase());
    if (!b) continue;
    if ((b.necessity ?? "") !== (t.necessity ?? "")) out.push({ area: "Categories", line: `${quote(t.name)} is now ${t.necessity ? NECESSITY[t.necessity] ?? t.necessity : "unmarked"}, was ${b.necessity ? NECESSITY[b.necessity] ?? b.necessity : "unmarked"}` });
    if (b.remark.trim() !== t.remark.trim()) out.push({ area: "Categories", line: `${quote(t.name)} note changed` });
  }
  return out;
}

function debtChanges(before: readonly Debt[], after: readonly Debt[]): SettingsChange[] {
  const out: SettingsChange[] = [];
  const was = new Map(before.map((d) => [d.id, d]));
  const now = new Set(after.map((d) => d.id));
  for (const d of after) {
    const b = was.get(d.id);
    if (!b) {
      out.push({ area: "Debts", line: `Added the debt line ${quote(d.name)}` });
      continue;
    }
    const said: string[] = [];
    if (b.name !== d.name) said.push(`renamed from ${quote(b.name)}`);
    if ((b.creditLimit ?? 0) !== (d.creditLimit ?? 0)) said.push(`limit ${money(b.creditLimit)} to ${money(d.creditLimit)}`);
    if ((b.dueDay ?? 0) !== (d.dueDay ?? 0)) said.push(`due day ${b.dueDay ?? "none"} to ${d.dueDay ?? "none"}`);
    if ((b.billingDay ?? 0) !== (d.billingDay ?? 0)) said.push(`billing day ${b.billingDay ?? "none"} to ${d.billingDay ?? "none"}`);
    if ((b.dueDate ?? "") !== (d.dueDate ?? "")) said.push(`due date ${b.dueDate ? formatMedium(b.dueDate) : "none"} to ${d.dueDate ? formatMedium(d.dueDate) : "none"}`);
    if (b.interestRate !== d.interestRate || b.interestType !== d.interestType) said.push(`interest ${b.interestRate}% ${b.interestType} to ${d.interestRate}% ${d.interestType}`);
    if (b.wallet !== d.wallet) said.push(`account ${b.wallet || "none"} to ${d.wallet || "none"}`);
    if (b.counterparty !== d.counterparty) said.push(`who ${b.counterparty || "none"} to ${d.counterparty || "none"}`);
    if (Boolean(b.archived) !== Boolean(d.archived)) said.push(d.archived ? "closed" : "opened again");
    if (said.length > 0) out.push({ area: "Debts", line: `${quote(d.name)}: ${said.join(", ")}` });
  }
  for (const b of before) if (!now.has(b.id)) out.push({ area: "Debts", line: `Removed the debt line ${quote(b.name)}` });
  return out;
}

function aiChanges(before: AppSettings["ai"], after: AppSettings["ai"]): SettingsChange[] {
  const out: SettingsChange[] = [];
  if (before.enabled !== after.enabled) out.push({ area: "AI", line: after.enabled ? "Turned the AI on" : "Turned the AI off" });
  if (before.provider !== after.provider) out.push({ area: "AI", line: `Provider ${before.provider} to ${after.provider}` });
  if (before.model !== after.model) out.push({ area: "AI", line: `Model ${before.model || "automatic"} to ${after.model || "automatic"}` });
  if (before.tone !== after.tone) out.push({ area: "AI", line: `Answers ${before.tone} to ${after.tone}` });
  const names: Record<string, string> = { chat: "the chat", capture: "reading pictures", notes: "spending notes", alerts: "alerts", insightSummary: "the Insights summary", descriptions: "descriptions", forecast: "the forecast" };
  const was = before.features as Record<string, boolean | undefined>;
  const now = after.features as Record<string, boolean | undefined>;
  for (const key of new Set([...Object.keys(was), ...Object.keys(now)])) {
    const a = was[key] !== false;
    const b = now[key] !== false;
    if (a !== b) out.push({ area: "AI", line: `${b ? "Allowed" : "Stopped"} the AI for ${names[key] ?? key}` });
  }
  return out;
}

/** Every change from one Settings to the next, plans and the owner's details left to their own events. */
export function settingsChanges(before: AppSettings, after: AppSettings, renamedKinds: readonly (readonly [string, string])[] = []): SettingsChange[] {
  const stoppedNames = (s: AppSettings): string[] => s.stopped.map((x) => x.name);
  return [
    ...accountChanges(before.accounts, after.accounts),
    ...listChanges("Categories", "bills", before.bills, after.bills),
    ...listChanges("Categories", "subscriptions", before.subscriptions, after.subscriptions),
    ...listChanges("Categories", "kinds of income", before.revenueCategories, after.revenueCategories),
    // A kind renamed has its own event ("Renamed the kind ..."); here it would read as one taken off and one added.
    ...kindChanges(
      before.spendingTypes.filter((t) => !renamedKinds.some(([from]) => from.trim().toLowerCase() === t.name.trim().toLowerCase())),
      after.spendingTypes.filter((t) => !renamedKinds.some(([, to]) => to.trim().toLowerCase() === t.name.trim().toLowerCase())),
    ),
    ...listChanges("Categories", "stopped bills and subscriptions", stoppedNames(before), stoppedNames(after)),
    ...debtChanges(before.credits, after.credits),
    ...aiChanges(before.ai, after.ai),
    ...(before.lowBalanceThreshold !== after.lowBalanceThreshold
      ? [{ area: "Alerts", line: `Low balance warning ${money(before.lowBalanceThreshold)} to ${money(after.lowBalanceThreshold)}` }]
      : []),
    ...((before.budgetNotes ?? true) !== (after.budgetNotes ?? true)
      ? [{ area: "Alerts", line: `${after.budgetNotes === false ? "Stopped" : "Turned on"} the note after spending is saved` }]
      : []),
    ...(before.theme !== after.theme ? [{ area: "Display", line: `Theme ${before.theme} to ${after.theme}` }] : []),
  ];
}

/**
 * One Activity summary for a save: where it was made, the areas, and the
 * first few changes in full. A debt's limit set on the Debt screen, a debt
 * line added from the Add form or the chat, a line opened again by a new
 * entry: each is a change to Settings made somewhere else, and each was
 * missing from Activity (3 November 2026).
 */
export function settingsChangesSummary(changes: readonly SettingsChange[], where = "in Settings"): string {
  const areas = [...new Set(changes.map((c) => c.area))];
  const shown = changes.slice(0, 3).map((c) => c.line);
  return `Changed ${where}, ${areas.join(", ")}: ${shown.join("; ")}${changes.length > 3 ? `; and ${changes.length - 3} more` : ""}`;
}
