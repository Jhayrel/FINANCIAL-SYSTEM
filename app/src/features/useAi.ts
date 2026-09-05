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

import { useCallback, useEffect, useMemo, useState } from "react";

import { askAi, type AiAnswer, type AiTask } from "../data/aiClient";
import { buildContext, contextToText } from "../domain/aiContext";
import { buildChatContext } from "../domain/aiChatContext";
import { cacheKey, readCache, writeCache } from "../domain/aiCache";
import { offlineAnswer } from "../domain/aiOffline";
import { today } from "../domain/dates";
import type { AppSettings } from "../domain/settings";
import type { Budgets, ReferenceLists, Transaction } from "../domain/types";

export interface UseAiInput {
  readonly settings: AppSettings;
  readonly transactions: readonly Transaction[];
  readonly budgets: Budgets;
  /**
   * The app's own reference lists, passed in rather than rebuilt here.
   *
   * Deriving them a second time drifted immediately: this module's first
   * version forgot the archived filter, so the AI would have described
   * accounts every other screen hides.
   */
  readonly reference: ReferenceLists;
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
  /**
   * Ask and get the answer back, rather than storing it in the hook.
   *
   * `run` owns a single current answer, which is right for a panel that
   * shows one summary. A conversation keeps its own thread, so it needs the
   * answer returned to it instead.
   */
  readonly ask: (
    task: AiTask,
    options?: { question?: string; history?: readonly { role: "you" | "assistant"; text: string }[] },
  ) => Promise<AiAnswer>;
  readonly clear: () => void;
}

export function useAi({
  settings,
  transactions,
  budgets,
  reference,
  feature,
  asOf,
}: UseAiInput): UseAi {
  const [answer, setAnswer] = useState<AiAnswer | null>(null);
  const [loading, setLoading] = useState(false);

  const ai = settings.ai;
  /**
   * Off means off, but a feature nobody has an opinion about is on.
   *
   * `chat` and `capture` were added after these settings shipped, so a
   * document written before them has neither key. Reading `undefined` as
   * "off" switched the conversation off for anyone who had ever saved
   * settings, which is everyone.
   */
  const disabled = !ai.enabled || ai.features[feature] === false;

  const context = useMemo(
    () =>
      buildContext({
        transactions,
        accounts: settings.accounts,
        budgets,
        credits: settings.credits,
        reference,
        lowBalanceThreshold: settings.lowBalanceThreshold,
        asOf: asOf ?? today(),
      }),
    [transactions, budgets, settings, reference, asOf],
  );

  /**
   * The key for this exact question.
   *
   * A hash of the text that would be sent, plus the task and tone, so a new
   * transaction invalidates it and opening the screen again does not.
   */
  const keyFor = useCallback(
    (task: AiTask): string => cacheKey(task, ai.tone, contextToText(context)),
    [context, ai.tone],
  );

  /**
   * Show the last answer for these exact figures, if there is one.
   *
   * Without this a reload showed an empty panel and the only way back was to
   * spend another call on a question already answered. Clearing it when the
   * figures change is automatic, since the figures are in the key.
   */
  useEffect(() => {
    const cached = readCache(keyFor("summary"));
    setAnswer(
      cached
        ? {
            text: cached.text,
            source: cached.source,
            ...(cached.model ? { model: cached.model } : {}),
            ...(cached.reason ? { reason: cached.reason } : {}),
            at: cached.at,
          }
        : null,
    );
  }, [keyFor]);

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
        const fresh = await askAi({ context, task, tone: ai.tone });
        setAnswer(fresh);

        /**
         * Only a real answer is worth keeping. An offline one is written
         * here anyway rather than recomputed, because it took the same
         * figures and would say the same thing.
         */
        writeCache(keyFor(task), {
          text: fresh.text,
          source: fresh.source,
          model: fresh.model,
          reason: fresh.reason,
        });
      } finally {
        setLoading(false);
      }
    },
    [context, disabled, ai.enabled, ai.tone, keyFor],
  );

  const ask = useCallback(
    async (
      task: AiTask,
      options: { question?: string; history?: readonly { role: "you" | "assistant"; text: string }[] } = {},
    ): Promise<AiAnswer> => {
      // Switched off means nothing is sent, not that nothing comes back.
      if (disabled) {
        return {
          text: offlineAnswer(context, task),
          source: "offline",
          reason: ai.enabled
            ? "This surface is switched off in Settings, so the figures were not sent."
            : "AI is switched off, so nothing was sent anywhere.",
        };
      }

      /**
       * The chat gets the ledger, everything else gets the snapshot.
       *
       * A conversation runs aground on figures-only context almost at once:
       * "how many times did I spend" and "what happened in May" are both
       * unanswerable from totals, and the model correctly says so, which
       * reads as the model being useless. `buildChatContext` sends the rows
       * and pre-computes every total, so it can answer without doing sums.
       */
      const chatText =
        task === "chat"
          ? buildChatContext({
              snapshot: context,
              transactions,
              asOf: asOf ?? today(),
              question: options.question ?? "",
              // Without these the assistant knows what is owed and nothing
              // about how it got there, which is every question anyone asks
              // about a credit line.
              credits: settings.credits,
            }).text
          : undefined;

      return askAi({
        context,
        task,
        tone: ai.tone,
        ...(chatText ? { contextText: chatText } : {}),
        ...(options.question ? { question: options.question } : {}),
        ...(options.history ? { history: options.history } : {}),
      });
    },
    [context, disabled, ai.enabled, ai.tone, transactions, asOf],
  );

  const clear = useCallback(() => setAnswer(null), []);

  return { answer, loading, disabled, run, ask, clear };
}
