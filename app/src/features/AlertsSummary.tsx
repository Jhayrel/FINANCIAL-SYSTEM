/**
 * The findings in one paragraph, under the list in the notification panel.
 *
 * Moved from the Dashboard with the findings themselves. It asks once, when
 * asked, and only while AI and this surface are on (domain/aiSurface.ts): the
 * list above it is the real content, this only reads it back as prose.
 */

import { AiAnswerView } from "../components/AiAnswer";
import { Button } from "../components/primitives";
import type { AppSettings } from "../domain/settings";
import type { Budgets, ReferenceLists, Transaction } from "../domain/types";
import { useAi } from "./useAi";

export function AlertsSummary({
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
  const ai = useAi({ settings, transactions, budgets, reference, feature: "alerts", asOf });
  return (
    <div className="fms-notify-ai">
      {ai.answer && <AiAnswerView answer={ai.answer} />}
      <Button size="sm" loading={ai.loading} onClick={() => void ai.run("alerts")}>
        {ai.answer ? "Say it again" : "Sum it up in a paragraph"}
      </Button>
    </div>
  );
}
