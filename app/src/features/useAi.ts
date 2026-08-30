/**
 * One way for the app to ask the AI anything.
 *
 * Every surface that wants a sentence goes through this, so there is a single
 * place where the context is assembled and a single place to look when asking
 * what leaves the device. Building the context at each call site would mean
 * auditing each call site.
 *
 * Two rules it enforces for its callers:
 *
 *   - Nothing is sent while AI is switched off, or while the specific feature
 *     is switched off. The offline answer is used instead, so the panel still
 *     says something useful rather than going blank.
 *   - The context is memoised on the ledger, not rebuilt per keystroke. It
 *     walks 441 rows.
 */

import { useCallback, useMemo, useState } from "react";

import { askAi, type AiAnswer, type AiTask } from "../data/aiClient";
import { buildContext } from "../domain/aiContext";
import { offlineAnswer } from "../domain/aiOffline";
import { today } from "../domain/dates";
import type { AppSettings } from "../domain/settings";
import type { Budgets, Transaction } from "../domain/types";

export interface UseAiInput {
  readonly settings: AppSettings;
  readonly transactions: readonly Transaction[];
  readonly budgets: Budgets;
  /** Which toggle in Settings governs this surface. */
  readonly feature: keyof AppSettings["ai"]["features"];
  /**
   * Which date the summary is about. Defaults to today.
   *
   * Insights can be looking at March while today is August, and a summary of
   * the wrong month is worse than none: every figure in it is real, so there
   * is nothing to notice.
   */
  readonly asOf?: string;
}

export interface UseAi {
  readonly answer: AiAnswer | null;
  readonly loading: boolean;
  /** True when the model is switched off for this surface, so the UI can say so. */
  readonly disabled: boolean;
  readonly run: (task: AiTask) => Promise<void>;
  readonly clear: () => void;
}

export function useAi({ settings, transactions, budgets, feature, asOf }: UseAiInput): UseAi {
  const [answer, setAnswer] = useState<AiAnswer | null>(null);
  const [loading, setLoading] = useState(false);

  const ai = settings.ai;
  const disabled = !ai.enabled || !ai.features[feature];

  const context = useMemo(
    () =>
      buildContext({
        transactions,
        accounts: settings.accounts,
        budgets,
        credits: settings.credits,
        reference: {
          wallets: settings.accounts.filter((a) => a.kind === "spending").map((a) => a.name),
          savings: settings.accounts.filter((a) => a.kind !== "spending").map((a) => a.name),
          bills: settings.bills,
          subscriptions: settings.subscriptions,
          revenueCategories: settings.revenueCategories,
          spendingTypes: settings.spendingTypes,
        },
        lowBalanceThreshold: settings.lowBalanceThreshold,
        asOf: asOf ?? today(),
      }),
    [transactions, budgets, settings, asOf],
  );

  const run = useCallback(
    async (task: AiTask): Promise<void> => {
      // Switched off means nothing is sent, not that nothing is shown.
      if (disabled) {
        setAnswer({
          text: offlineAnswer(context, task),
          source: "offline",
          reason: ai.enabled
            ? "This surface is switched off in Settings, so the figures were not sent."
            : "AI is switched off, so nothing was sent anywhere.",
        });
        return;
      }

      setLoading(true);
      try {
        setAnswer(await askAi({ context, task, tone: ai.tone }));
      } finally {
        setLoading(false);
      }
    },
    [context, disabled, ai.enabled, ai.tone],
  );

  const clear = useCallback(() => setAnswer(null), []);

  return { answer, loading, disabled, run, clear };
}
