/**
 * The assistant, beside the entry form.
 *
 * ── What it does, and the one thing it will never do ──────────────────────
 *
 * It reads and it answers. It has no path to the database: the only writer in
 * this app is `handleSave`, which runs when a person presses a button on a
 * form. Nothing here can add, change or remove a row, and that is a property
 * of the wiring rather than a promise in a prompt.
 *
 * Everything else it inherits from the existing AI layer, which is the reason
 * this file is short. `useAi` builds the context, which is figures rather than
 * rows, so no description or note leaves the device. `askAi` verifies the
 * owner, walks the model chain, strips Markdown, and falls back to an answer
 * written on this device when there is no key or every free model is busy. The
 * answer says which of those it was.
 *
 * ── Why a panel and not a floating bubble ─────────────────────────────────
 *
 * It sits next to the form because the questions worth asking while entering
 * a transaction are about the transaction being entered: whether there is
 * room in the budget, what this usually costs, whether the wallet can take it.
 * A bubble in the corner is for support chat, which this is not.
 */

import { useState } from "react";

import { Button } from "../components/primitives";
import { AiAnswerView } from "../components/AiAnswer";
import { useAi } from "./useAi";
import type { AppSettings } from "../domain/settings";
import type { Budgets, ReferenceLists, Transaction } from "../domain/types";

/**
 * Openers, because a blank box invites nothing.
 *
 * Each is a question the figures can actually answer, which matters more than
 * it sounds: an assistant that confidently answers something it cannot see is
 * worse than one that offers three things it can.
 */
const STARTERS = [
  "How is this month going?",
  "What stands out in my spending?",
  "What needs attention?",
] as const;

export function AskPanel({
  settings,
  transactions,
  budgets,
  reference,
  asOf,
}: {
  settings: AppSettings;
  transactions: readonly Transaction[];
  budgets: Budgets;
  reference: ReferenceLists;
  asOf: string;
}) {
  const ai = useAi({
    settings,
    transactions,
    budgets,
    reference,
    feature: "insightSummary",
    asOf,
  });

  const [asked, setAsked] = useState<string | null>(null);

  const ask = (question: string, task: "summary" | "patterns" | "alerts"): void => {
    setAsked(question);
    void ai.run(task);
  };

  return (
    <aside
      className="fms-panel fms-ask"
      /*
       * The halo says "this is the AI part" without a badge or an icon. It
       * breathes only while a request is in flight, and not at all under
       * reduced motion, which rule D9 asks for.
       */
      data-thinking={ai.loading ? "true" : undefined}
    >
      <div className="t-label" style={{ color: "var(--ink-2)" }}>
        Ask
      </div>
      <p className="t-caption" style={{ margin: "2px 0 0", color: "var(--ink-3)" }}>
        Reads your figures. It cannot change anything.
      </p>

      <div className="fms-askbody">
        {ai.answer ? (
          <div>
            {asked && (
              <p className="t-caption" style={{ margin: "0 0 var(--space-2)", color: "var(--ink-3)" }}>
                {asked}
              </p>
            )}
            <AiAnswerView answer={ai.answer} />
          </div>
        ) : (
          <p className="t-caption" style={{ margin: 0, color: "var(--ink-3)" }}>
            {ai.disabled
              ? "The model is switched off in Settings, so answers are written on this device from the same figures."
              : "Ask something about the month while you type."}
          </p>
        )}
      </div>

      <div className="fms-askactions">
        {STARTERS.map((question, i) => (
          <Button
            key={question}
            size="sm"
            loading={ai.loading && asked === question}
            onClick={() => ask(question, i === 0 ? "summary" : i === 1 ? "patterns" : "alerts")}
          >
            {question}
          </Button>
        ))}
        {ai.answer && (
          <Button size="sm" variant="ghost" onClick={() => { ai.clear(); setAsked(null); }}>
            Clear
          </Button>
        )}
      </div>
    </aside>
  );
}
