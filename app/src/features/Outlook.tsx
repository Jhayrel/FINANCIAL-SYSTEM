/**
 * The months ahead, on the Budget screen: the realistic basis for a budget.
 *
 * The forecast table it replaces had five columns and a paragraph of basis
 * on every row, and a figure made from three months and a trend. This reads
 * the owner's usual month (`domain/outlook.ts`) and shows, for each month
 * ahead, what it usually costs, what the budget set for it says, and a
 * button to use the usual month as that budget. One line says how it was
 * worked out, once, under the table.
 *
 * ── A lot of data ─────────────────────────────────────────────────────────
 *
 * Three months show; the rest of the next twelve are one click away and
 * are only worked out when asked for. Every figure is the ledger's own, so a
 * long history makes the usual month better, not the table longer.
 *
 * ── With and without the model ────────────────────────────────────────────
 *
 * Under the table, what it means in words: the device's own, always. With
 * AI on, "Explain with AI" asks the model to say the same thing from the
 * same figures, and its words are kept only when every figure in them is
 * one of those (`spendNote.ts`, `onlyTheirFigures`).
 */

import { useMemo, useState } from "react";

import { useConfirm } from "../components/Confirm";
import { Button, Card, Money } from "../components/primitives";
import { explainOutlook } from "../data/aiClient";
import { MONTH_NAMES } from "../domain/dates";
import type { Debt } from "../domain/debt";
import { formatMoney, type Centavos } from "../domain/money";
import { basisWords, outlookAhead, outlookFacts, outlookWords, steadyWords, type MonthOutlook } from "../domain/outlook";
import type { Budgets, IsoDate, Transaction } from "../domain/types";

const SHOWN = 3;
const MOST = 12;

export function Outlook({
  transactions,
  budgets,
  asOf,
  debts,
  stopped,
  ai,
  onUse,
}: {
  transactions: readonly Transaction[];
  budgets: Budgets;
  asOf: IsoDate;
  debts: readonly Debt[];
  stopped: readonly { readonly name: string; readonly since: IsoDate }[];
  /** The model, when AI is on and allowed here. */
  ai?: { readonly provider?: string; readonly model?: string } | undefined;
  /** Set a month's budget to its usual month; says what it did. */
  onUse: (o: MonthOutlook) => { readonly text: string; readonly over: boolean };
}) {
  const [all, setAll] = useState(false);
  // The model's words, kept with the facts they were made from: once a budget changes, they are old.
  const [explained, setExplained] = useState<{ text: string; model: string; facts: string } | null>(null);
  const [asking, setAsking] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; over: boolean } | null>(null);
  const { confirm, dialog } = useConfirm();

  // The rest of the year is worked out only when asked for.
  const list = useMemo(
    () => outlookAhead(transactions, budgets, asOf, all ? MOST : SHOWN, { stopped, debts }),
    [transactions, budgets, asOf, all, stopped, debts],
  );
  const first = list[0];
  if (!first || first.read.length === 0) return null;

  const words = outlookWords(list.slice(0, SHOWN), formatMoney);
  const facts = outlookFacts(list.slice(0, SHOWN), formatMoney);
  const factsKey = facts.join("\n");
  const worded = explained && explained.facts === factsKey ? explained : null;
  const explain = async (): Promise<void> => {
    setAsking(true);
    setFailed(null);
    const got = await explainOutlook(facts, words, ai ?? {});
    setAsking(false);
    if (got) setExplained({ ...got, facts: factsKey });
    else setFailed(factsKey);
  };
  const use = async (o: MonthOutlook): Promise<void> => {
    const ok = await confirm({
      title: `Set ${o.name}'s budget to ${formatMoney(o.total)}?`,
      body: `${formatMoney(o.spending)} for spending and ${formatMoney(o.billsSubs)} for bills and subscriptions, a usual month for you${
        o.budget.total > 0 ? `, in place of the ${formatMoney(o.budget.total)} set now` : ""
      }. Limits for kinds of spending are kept, and the change can be undone from the month's planner.`,
      confirmLabel: "Set the budget",
      tone: "normal",
    });
    if (ok) setNote(onUse(o));
  };
  const monthName = (o: MonthOutlook): string =>
    `${MONTH_NAMES[o.month - 1] ?? ""}${o.year !== Number(asOf.slice(0, 4)) ? ` ${o.year}` : ""}`;

  return (
    <Card title="Forecast" subtitle="Your usual month, for planning the months ahead" padded={false}>
      <div className="fms-outlook-stats">
        <Stat label="You usually spend" value={first.total} />
        <Stat label="You usually earn" value={first.income} />
        <Stat label={first.left >= 0 ? "Left over" : "Short"} value={Math.abs(first.left)} tone={first.left >= 0 ? undefined : "var(--over)"} />
      </div>

      <div className="fms-rtable-wrap">
        <table className="fms-rtable fms-outlook">
          <thead>
            <tr>
              <th className="t-th">Month</th>
              <th className="t-th fms-rnum">Spending</th>
              <th className="t-th fms-rnum">Bills</th>
              <th className="t-th fms-rnum">Usual month</th>
              <th className="t-th fms-rnum">Budget set</th>
              <th className="t-th" aria-label="Use as budget" />
            </tr>
          </thead>
          <tbody>
            {list.map((o) => {
              const same = o.budget.spending === o.spending && o.budget.billsSubs === o.billsSubs;
              return (
                <tr key={`${o.year}-${o.month}`}>
                  <td className="t-body fms-rhead">
                    {monthName(o)}
                    {o.seasonal.map((s) => (
                      <div key={s.item} className="t-micro" style={{ color: "var(--warn)" }}>
                        Last year: {s.item} {formatMoney(s.lastYear)}
                      </div>
                    ))}
                  </td>
                  <td className="fms-rnum" data-label="Spending">
                    <Money value={o.spending} size="s" />
                    {o.withExtras > o.spending && (
                      <div className="t-micro" style={{ color: "var(--ink-3)" }}>
                        {formatMoney(o.withExtras)} with one-offs
                      </div>
                    )}
                  </td>
                  <td className="fms-rnum" data-label="Bills">
                    <Money value={o.billsSubs} size="s" />
                  </td>
                  <td className="fms-rnum" data-label="Usual month">
                    <Money value={o.total} size="s" />
                    {o.debtDue > 0 && (
                      <div className="t-micro" style={{ color: "var(--ink-3)" }}>
                        and {formatMoney(o.debtDue)} of debt due
                      </div>
                    )}
                  </td>
                  <td className="fms-rnum" data-label="Budget set">
                    {o.budget.total > 0 ? <Money value={o.budget.total} size="s" /> : <span className="t-caption" style={{ color: "var(--ink-3)" }}>Not set</span>}
                    <Gap budget={o.budget.total} usual={o.total} />
                  </td>
                  <td className="fms-outlook-use">
                    {same ? (
                      <span className="t-micro" style={{ color: "var(--ink-3)" }}>
                        Already set
                      </span>
                    ) : (
                      <Button size="sm" onClick={() => void use(o)}>
                        Use as budget
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="fms-outlook-foot">
        {note && (
          <p className="t-caption" role="status" style={{ margin: 0, color: note.over ? "var(--over)" : "var(--ink-2)" }}>
            {note.text}
          </p>
        )}
        <button type="button" className="t-caption fms-linkbtn" onClick={() => setAll((v) => !v)}>
          {all ? `Show the next ${SHOWN} months` : `Show the next ${MOST} months`}
        </button>
        <p className="t-micro" style={{ margin: 0, color: "var(--ink-3)" }}>
          {basisWords(first)} {steadyWords(first.steadiness)}
        </p>

        <div className="fms-outlook-words">
          <div className="t-label" style={{ color: "var(--ink-2)" }}>
            What this means
          </div>
          <p className="t-body" style={{ margin: 0 }}>
            {worded?.text ?? words}
          </p>
          <div className="fms-outlook-by">
            <span className="t-micro" style={{ color: "var(--ink-3)" }}>
              {worded ? `Explained by ${worded.model || "the model"}, from the figures above` : "Worked out on this device"}
              {!worded && failed === factsKey ? ". The model gave no answer that keeps to these figures, so these are the app's own words." : ""}
            </span>
            {ai && !worded && (
              <Button size="sm" loading={asking} onClick={() => void explain()}>
                Explain with AI
              </Button>
            )}
          </div>
        </div>
      </div>
      {dialog}
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: Centavos; tone?: string | undefined }) {
  return (
    <div className="fms-outlook-stat">
      <span className="t-micro" style={{ color: "var(--ink-3)" }}>
        {label}
      </span>
      <Money value={value} size="m" {...(tone ? { tone } : {})} />
    </div>
  );
}

/** How the budget set compares with the usual month, in a few words. */
function Gap({ budget, usual }: { budget: Centavos; usual: Centavos }) {
  if (budget <= 0) return null;
  if (budget >= usual) {
    return (
      <div className="t-micro" style={{ color: "var(--ink-3)" }}>
        covers a usual month
      </div>
    );
  }
  return (
    <div className="t-micro" style={{ color: "var(--warn)" }}>
      {formatMoney(usual - budget)} under a usual month
    </div>
  );
}
