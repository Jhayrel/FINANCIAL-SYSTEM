/**
 * What Settings say, and every change to a budget, in words for the model.
 *
 * The owner, 12 October 2026: "make the AI know everything, even the
 * settings", and "make sure the AI and system can read the history of budget
 * changes, like it will know how many times I changed the budget". The model
 * had the figures the settings produce and none of the settings themselves,
 * and only the newest budget change.
 */

import { formatMedium, MONTH_NAMES, localDay } from "./dates";
import { formatMoney, type Centavos } from "./money";
import type { AppSettings } from "./settings";
import type { Budgets, IsoDate } from "./types";

const money = (c: Centavos | undefined): string => (c === undefined ? "none" : formatMoney(c));
const list = (names: readonly string[]): string => (names.length > 0 ? names.join(", ") : "none");
const NEED: Record<string, string> = { essential: "need", emergency: "emergency", discretionary: "want" };

/** One line per part of Settings. Never a key or a secret: the settings hold none. */
export function settingsWords(s: AppSettings): string[] {
  const open = s.accounts.filter((a) => !a.archived && a.name.trim());
  const shut = s.accounts.filter((a) => a.archived && a.name.trim());
  const parentOf = (id?: string): string => s.accounts.find((a) => a.id === id)?.name ?? "";
  const out: string[] = [
    `Accounts: ${list(open.map((a) => `${a.name} (${a.kind}${a.kind === "goal" && a.parentId ? ` in ${parentOf(a.parentId)}` : ""}${a.target ? `, target ${formatMoney(a.target)}` : ""})`))}.${shut.length > 0 ? ` Archived: ${list(shut.map((a) => a.name))}.` : ""}`,
    `Kinds of spending: ${list(s.spendingTypes.map((t) => { const notes = [t.necessity ? (NEED[t.necessity] ?? t.necessity) : "", t.remark && t.remark.trim().toLowerCase() !== t.name.trim().toLowerCase() ? t.remark.trim() : ""].filter(Boolean); return notes.length > 0 ? `${t.name} (${notes.join(", ")})` : t.name; }))}.`,
    `Bills: ${list(s.bills)}. Subscriptions: ${list(s.subscriptions)}.`,
    `Kinds of income: ${list(s.revenueCategories)}.`,
  ];
  if (s.stopped.length > 0) out.push(`Stopped, so never set aside: ${list(s.stopped.map((x) => `${x.name} since ${formatMedium(x.since)}`))}.`);
  const lines = s.credits.filter((d) => !d.archived);
  if (lines.length > 0) {
    out.push(
      `Debt and On behalf lines: ${lines
        .map((d) => {
          const parts = [
            d.form === "pass-through" ? `on behalf, ${d.kind === "payable" ? "held for" : "paid for"} ${d.counterparty || d.name}` : `${d.kind === "payable" ? "borrowed from" : "lent to"} ${d.counterparty || d.name}`,
            d.creditLimit ? `limit ${formatMoney(d.creditLimit)}` : "",
            d.dueDay ? `due day ${d.dueDay}` : "",
            d.billingDay ? `billing day ${d.billingDay}` : "",
            d.interestType !== "none" && d.interestRate > 0 ? `interest ${d.interestRate}% (${d.interestType})` : "",
            d.wallet ? `through ${d.wallet}` : "",
          ].filter(Boolean);
          return `${d.name} (${parts.join(", ")})`;
        })
        .join("; ")}.`,
    );
  }
  // Closed lines are named as closed, so "my PNB loan" is known to be paid off rather than unknown (12 October 2026 audit, A7).
  const closed = s.credits.filter((d) => d.archived);
  if (closed.length > 0) out.push(`Closed debt lines, kept for their history: ${list(closed.map((d) => d.name))}.`);
  const off = Object.entries(s.ai.features).filter(([, on]) => on === false).map(([k]) => k);
  out.push(
    `Low balance warning below ${formatMoney(s.lowBalanceThreshold)}. Notes after saving: ${s.budgetNotes === false ? "off" : "on"}. Theme: ${s.theme}. AI: ${s.ai.enabled ? "on" : "off"}${s.ai.model ? `, model ${s.ai.model}` : ""}, tone ${s.ai.tone}${off.length > 0 ? `, switched off: ${off.join(", ")}` : ""}.`,
  );
  return out;
}

/**
 * Every change to a budget or a limit this year and last, counted per month,
 * the newest twelve said in full. "The new budget" is the newest one.
 */
export function budgetChangeWords(budgets: Budgets, asOf: IsoDate): string[] {
  const year = Number(asOf.slice(0, 4));
  const changes: { month: string; at: string; words: string }[] = [];
  const counts: string[] = [];
  for (const y of [year - 1, year]) {
    const revisions = budgets[String(y)]?.revisions ?? {};
    for (const [m, list] of Object.entries(revisions).sort((a, b) => Number(a[0]) - Number(b[0]))) {
      if (list.length === 0) continue;
      const name = `${MONTH_NAMES[Number(m) - 1] ?? m} ${y}`;
      const limits = list.filter((r) => r.what === "limit").length;
      /*
       * What is in force now, beside the count: "the final spending limit
       * matches the safe figure of PHP 25,403.56" was said of a month whose
       * budget had since gone back to PHP 26,000.00 (13 October 2026).
       */
      const nowSpending = budgets[String(y)]?.spending?.[Number(m) - 1] ?? 0;
      const nowBills = budgets[String(y)]?.billsSubs?.[Number(m) - 1] ?? 0;
      counts.push(`${name}: ${list.length} ${list.length === 1 ? "change" : "changes"}${limits > 0 ? ` (${limits} to limits)` : ""}, now ${money(nowSpending)} spending and ${money(nowBills)} bills and subscriptions`);
      for (const r of list) {
        // The owner's own day and time, as the Budget screen shows them: never UTC (12 October 2026 audit).
        const day = localDay(r.at);
        const when = new Date(r.at);
        const time = Number.isNaN(when.getTime()) ? "" : when.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
        const words =
          r.what === "limit"
            ? `limit on ${r.name ?? "a kind"} ${money(r.wasLimit)} to ${r.limit ? money(r.limit) : "removed"}`
            : `spending ${money(r.wasSpending)} to ${money(r.spending)}, bills and subscriptions ${money(r.wasBillsSubs)} to ${money(r.billsSubs)}`;
        changes.push({ month: name, at: r.at, words: `${formatMedium(day)}${time ? ` ${time}` : ""}, ${name}: ${words}${r.when === "closed" ? ` (a correction after the month closed${r.reason ? `: ${r.reason}` : ""})` : r.when === "grace" ? " (just after the month ended)" : r.reason ? ` (${r.reason})` : ""}.` });
      }
    }
  }
  if (changes.length === 0) return ["No budget or limit has been changed in the app this year or last."];
  const newest = [...changes].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, 12);
  return [`${changes.length} changes in all. By month: ${counts.join("; ")}.`, "The newest first:", ...newest.map((c) => `- ${c.words}`)];
}

/** "how many times did I change my budget", "when did I change the food limit", "budget history". */
export function asksBudgetHistory(text: string): boolean {
  return (
    /\b(?:budget|budgets|limit|limits)\b/i.test(text) &&
    /\b(?:how many times|how often|when did i|did i (?:ever )?change|have i (?:ever )?changed|what did i change|history|changes|changed|change log|revisions?|before|previous|old|used to be|ilang beses|binago)\b/i.test(text) &&
    !/^\s*(?:change|set|update|make|raise|lower|increase|decrease|reduce|add|remove)\b/i.test(text)
  );
}

