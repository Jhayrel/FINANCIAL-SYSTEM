/**
 * Cleaning up settings that were carried over from the Excel.
 *
 * Filtering the lists when they are first built is not enough. Once settings
 * have been saved, that initial build never runs again, so an obsolete entry
 * survives every reload and keeps offering itself in the entry form. This runs
 * on load, every load, and is the reason the cleanup actually sticks.
 *
 * ── What comes out, and why each one is a mistake waiting to happen ───────
 *
 *   "Transfer of balance"   The Excel's way of starting a year. Picking it
 *                           books money you already had as income. The Add
 *                           screen has an Opening flow instead.
 *
 *   A credit line's name    "Maya Credit" was both a revenue category and a
 *   in bills or revenue     bill. That is how PHP 5,450.00 of borrowing became
 *                           income and a PHP 2,688.79 repayment became a bill.
 *                           The debt module owns it now.
 *
 *   "Money Send",           Worked out from where the money went, never picked.
 *   "Transaction Fee"       Offering them invites a choice that does nothing.
 *
 *   Blanks and duplicates   A category that differs only by case or by a
 *                           trailing space is a second bucket the totals will
 *                           split across.
 *
 * Nothing here touches a transaction. Removing a category never changes what
 * a historical row says, and never changes a balance. It only changes what the
 * entry form offers next time.
 */

import type { Debt } from "./debt";
import type { AppSettings } from "./settings";
import type { SpendingType } from "./types";

/** The revenue category the Excel used to carry a year forward. */
export const OBSOLETE_CATEGORIES = ["transfer of balance"];

/** Spending types the app derives. See `domain/transfers.ts`. */
export const DERIVED_SPENDING_TYPES = ["money send", "transaction fee"];

export interface Removal {
  readonly list: string;
  readonly value: string;
  readonly why: string;
}

export interface CleanupReport {
  readonly settings: AppSettings;
  readonly removals: readonly Removal[];
  readonly changed: boolean;
}

const key = (s: string): string => s.trim().toLowerCase();

/**
 * Work out what should come out, and hand back both the result and the reasons.
 *
 * The reasons are the point. A cleanup that silently deletes six things the
 * owner spent a year typing is indistinguishable from a bug.
 */
export function cleanSettings(settings: AppSettings): CleanupReport {
  const removals: Removal[] = [];
  const creditNames = new Set(settings.credits.map((c: Debt) => key(c.name)));

  const cleanStrings = (list: string, values: readonly string[]): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];

    for (const raw of values) {
      const value = raw.trim();
      const k = key(value);

      if (value === "") {
        removals.push({ list, value: raw, why: "Blank entry." });
        continue;
      }
      if (seen.has(k)) {
        removals.push({ list, value, why: "Already in the list." });
        continue;
      }
      if (OBSOLETE_CATEGORIES.includes(k)) {
        removals.push({
          list,
          value,
          why: "Starting balances have their own flow now. This one books them as income.",
        });
        continue;
      }
      if (creditNames.has(k)) {
        removals.push({
          list,
          value,
          why: "This is a credit line. Keeping it here turns borrowing into income, or a repayment into a bill.",
        });
        continue;
      }

      seen.add(k);
      out.push(value);
    }
    return out;
  };

  const cleanTypes = (values: readonly SpendingType[]): SpendingType[] => {
    const seen = new Set<string>();
    const out: SpendingType[] = [];

    for (const t of values) {
      const name = t.name.trim();
      const k = key(name);

      if (name === "") {
        removals.push({ list: "Spending types", value: t.name, why: "Blank entry." });
        continue;
      }
      if (seen.has(k)) {
        removals.push({ list: "Spending types", value: name, why: "Already in the list." });
        continue;
      }
      if (DERIVED_SPENDING_TYPES.includes(k)) {
        removals.push({
          list: "Spending types",
          value: name,
          why: "Worked out from where the money went. It is never picked by hand.",
        });
        continue;
      }

      seen.add(k);
      out.push({ ...t, name, remark: t.remark.trim() });
    }
    return out;
  };

  const cleaned: AppSettings = {
    ...settings,
    bills: cleanStrings("Bills", settings.bills),
    subscriptions: cleanStrings("Subscriptions", settings.subscriptions),
    revenueCategories: cleanStrings("Revenue categories", settings.revenueCategories),
    spendingTypes: cleanTypes(settings.spendingTypes),
  };

  return { settings: cleaned, removals, changed: removals.length > 0 };
}

/**
 * The same thing, for use on every load.
 *
 * Discards the reasons. `App.tsx` calls this so an obsolete entry cannot
 * survive a reload; the Settings screen calls `cleanSettings` when it wants to
 * show the owner what would go.
 */
export function cleanedSettings(settings: AppSettings): AppSettings {
  return cleanSettings(settings).settings;
}
