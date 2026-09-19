/**
 * Find a difference: Insights, and the chat.
 *
 * The owner types what an account really holds, and optionally pastes its
 * history, and this says where the difference between that and the ledger
 * went (`domain/investigate.ts`). Each finding carries the one action that
 * would put it right, and nothing moves until that is pressed.
 *
 * Screenshots are read in the chat, where the model is: "my maya is 30000,
 * where is the rest?" with the balance and the history attached runs the
 * same investigation and answers in the conversation.
 *
 * ── Why the answer survives leaving the screen ────────────────────────────
 *
 * "Add it" opens the Add form, which unmounts this card. Four missing lines
 * meant typing the figures in four times. What was asked is kept for the
 * session, and the answer is worked out again from the ledger as it is now,
 * so a finding that has been added simply is not there when you come back,
 * and the difference shrinks by what it accounted for.
 */

import { useEffect, useMemo, useState } from "react";

import { Button, Card, Money } from "../components/primitives";
import { AmountInput, Field } from "../components/forms";
import { Select } from "../components/Select";
import { useConfirm } from "../components/Confirm";
import { walletBalance } from "../domain/balances";
import type { Draft } from "../domain/entry";
import { getYear } from "../domain/dates";
import {
  choicesForClue,
  clueWords,
  investigate,
  investigationWords,
  readHistory,
  type Clue,
} from "../domain/investigate";
import { formatMoney, type Centavos } from "../domain/money";
import type { IsoDate, ReferenceLists, Transaction } from "../domain/types";

const number = (t: Transaction): string => `#${String(t.recordNumber).padStart(4, "0")}`;

interface Asked {
  readonly account: string;
  readonly actual: Centavos | null;
  readonly date: IsoDate;
  readonly matchedOn: IsoDate | "";
  readonly history: string;
  readonly ran: boolean;
}

/** What was last asked, for this session only: never stored, gone on a reload. */
let kept: Asked | null = null;

export function Investigate({
  transactions,
  reference,
  asOf,
  onAdd,
  onEditRow,
  onBin,
}: {
  transactions: readonly Transaction[];
  reference: ReferenceLists;
  asOf: IsoDate;
  /** The Add form with this entry filled in, to check and save. */
  onAdd: (draft: Draft) => void;
  /** A saved row into the Add form, to correct it. */
  onEditRow: (row: Transaction) => void;
  /** A row to the bin, which can be restored. */
  onBin: (id: string) => void;
}) {
  const accounts = useMemo(() => [...reference.wallets, ...reference.savings], [reference]);
  const [asked, setAsked] = useState<Asked>(
    () =>
      kept && accounts.includes(kept.account)
        ? kept
        : { account: accounts[0] ?? "", actual: null, date: asOf, matchedOn: "", history: "", ran: false },
  );
  const { account, actual, date, matchedOn, history, ran } = asked;
  const { confirm, dialog } = useConfirm();

  // Kept whenever it changes, so leaving for the Add form and coming back finds it again.
  useEffect(() => {
    kept = asked;
  }, [asked]);

  /** Any change to the question puts the answer away until Find it is pressed again. */
  const change = (next: Partial<Asked>): void => {
    setAsked((prev) => ({ ...prev, ...next, ran: next.ran ?? false }));
  };

  const recordedNow = account ? walletBalance(transactions.filter((t) => t.date <= date), account) : 0;
  const lines = useMemo(() => readHistory(history, getYear(date)), [history, date]);
  const interestItem = reference.revenueCategories.find((c) => /interest/i.test(c)) ?? "";

  // Worked out from the ledger as it is now, so a finding that has been put right drops out.
  const result = useMemo(
    () =>
      ran && account && actual !== null
        ? investigate({ transactions, account, actual, asOf: date, statement: lines, matchedOn: matchedOn || undefined })
        : null,
    [ran, account, actual, date, lines, matchedOn, transactions],
  );

  const run = (): void => {
    if (!account || actual === null) return;
    change({ ran: true });
  };

  /** Empty the question, keeping the account chosen. */
  const clear = (): void => {
    change({ actual: null, date: asOf, matchedOn: "", history: "", ran: false });
  };

  const bin = async (row: Transaction): Promise<void> => {
    const ok = await confirm({
      title: `Move ${number(row)} to the bin?`,
      body: `${row.item || row.description || row.type}, ${formatMoney(row.total)} on ${row.date}. It can be restored from the bin.`,
      confirmLabel: "Move to bin",
      tone: "danger",
    });
    if (ok) onBin(row.id);
  };

  const actionFor = (clue: Clue) => {
    const choices = result ? choicesForClue(clue, result.account, result.asOf, interestItem) : [];
    switch (clue.kind) {
      case "missing":
      case "cash":
      case "unrecorded":
        return choices.length > 0 ? (
          <span className="fms-findrow-actions">
            {choices.map((c) => (
              <Button key={c.label} size="sm" onClick={() => onAdd(c.draft)}>
                {c.label}
              </Button>
            ))}
          </span>
        ) : null;
      case "wrong-account":
        return (
          <Button size="sm" onClick={() => onEditRow(clue.row)}>
            Correct {number(clue.row)}
          </Button>
        );
      case "duplicate":
        return (
          <Button size="sm" onClick={() => void bin(clue.row)}>
            Move {number(clue.row)} to the bin
          </Button>
        );
      case "amount-differs":
      case "not-on-statement":
        return (
          <Button size="sm" onClick={() => onEditRow(clue.row)}>
            Correct {number(clue.row)}
          </Button>
        );
      case "together":
        return (
          <span className="fms-findrow-actions">
            {clue.rows.map((r) => (
              <Button key={r.id} size="sm" variant="ghost" onClick={() => onEditRow(r)}>
                Open {number(r)}
              </Button>
            ))}
          </span>
        );
    }
  };

  const summary = result ? investigationWords(result) : null;

  return (
    <Card
      title="Find a difference"
      subtitle="When an account holds a different amount than the ledger says, this finds where it went"
    >
      {dialog}
      <div className="fms-find">
        <div className="fms-find-form">
          <Field label="Account">
            <Select
              value={account}
              onChange={(v) => change({ account: v })}
              options={accounts}
              details={Object.fromEntries(accounts.map((a) => [a, formatMoney(walletBalance(transactions, a))]))}
              ariaLabel="Which account"
            />
          </Field>
          <Field label="It really holds" help={`The ledger says ${formatMoney(recordedNow)} on that day.`}>
            <AmountInput
              value={actual}
              onChange={(v) => change({ actual: v })}
              ariaLabel="What the account really holds"
            />
          </Field>
          <Field label="On">
            <input
              type="date"
              value={date}
              max={asOf}
              onChange={(e) => change({ date: e.target.value || asOf })}
              aria-label="The day the balance was read"
              className="t-body fms-control"
            />
          </Field>
          <Field
            label="Last matched on"
            optional
            help={
              matchedOn
                ? "Only what was recorded after that day is searched, however many entries came before."
                : "The last day the account and the ledger agreed, if you know it. It narrows the search to what came after."
            }
          >
            <input
              type="date"
              value={matchedOn}
              max={date}
              onChange={(e) => change({ matchedOn: e.target.value })}
              aria-label="The last day the balance matched"
              className="t-body fms-control"
            />
          </Field>
          <Field
            label="Its history"
            optional
            help={
              history.trim()
                ? `${lines.length} ${lines.length === 1 ? "line" : "lines"} read. Lines without a date or a figure are skipped.`
                : "Copy the transaction list from the bank or wallet app, one movement a line. For screenshots, send them to the chat instead."
            }
          >
            <textarea
              value={history}
              onChange={(e) => change({ history: e.target.value })}
              rows={4}
              spellCheck={false}
              placeholder={"Sep 3  Cinema  -5,000\nSep 6  Travel booking  15,000\nSep 7  Received from client  +12,500"}
              className="t-body fms-paste"
            />
          </Field>
          <div className="fms-find-go">
            <Button variant="primary" onClick={run} disabled={!account || actual === null}>
              Find it
            </Button>
            <Button onClick={clear} disabled={actual === null && !history && !matchedOn && date === asOf}>
              Clear
            </Button>
          </div>
        </div>

        {result && summary && (
          <div className="fms-find-result" aria-live="polite">
            <div className="fms-find-figs">
              <div>
                <span className="t-label">Ledger says</span>
                <Money value={result.recorded} size="m" />
              </div>
              <div>
                <span className="t-label">Really holds</span>
                <Money value={result.actual} size="m" />
              </div>
              <div>
                <span className="t-label">Difference</span>
                <Money value={result.gap} size="m" signed tone={result.gap === 0 ? "var(--ok)" : undefined} />
              </div>
              <div>
                <span className="t-label">{result.overshoot ? "Worth checking" : "Found"}</span>
                <Money value={result.explained} size="m" signed tone={result.unexplained === 0 && result.gap !== 0 ? "var(--ok)" : undefined} />
              </div>
            </div>

            <p className="t-body-strong" style={{ margin: 0 }}>
              {summary.headline}
            </p>
            {summary.since && (
              <p className="t-caption" style={{ margin: 0, color: "var(--ink-2)" }}>
                {summary.since}
              </p>
            )}

            {result.found.length > 0 && (
              <ul className="fms-findlist">
                {result.found.map((clue, i) => (
                  <li key={`f${i}`} className={clue.kind === "missing" && clue.line.amount > 0 ? "fms-findrow fms-findrow--stack" : "fms-findrow"}>
                    <span className="t-body">{clueWords(clue)}</span>
                    <span className="fms-findrow-end">
                      <Money value={clue.explains} size="s" signed />
                      {actionFor(clue)}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {result.unexplained !== 0 && !result.overshoot && (
              <>
                <p className="t-caption" style={{ margin: 0, color: "var(--ink-2)" }}>
                  {summary.rest}
                </p>
                {result.possible.length > 0 && (
                  <ul className="fms-findlist">
                    {result.possible.map((clue, i) => (
                      <li
                      key={`p${i}`}
                      className={
                        clue.kind === "unrecorded" || clue.kind === "together"
                          ? "fms-findrow fms-findrow--maybe fms-findrow--stack"
                          : "fms-findrow fms-findrow--maybe"
                      }
                    >
                        <span className="t-body">{clueWords(clue)}</span>
                        <span className="fms-findrow-end">{actionFor(clue)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}

            {/* Finished: the answer is put away and the question emptied for the next one. */}
            <div className="fms-find-done">
              <span className="t-caption" style={{ color: "var(--ink-3)" }}>
                {result.gap === 0
                  ? "Nothing left to find."
                  : "Each button opens the entry to check before it is saved. Come back here and the difference is worked out again."}
              </span>
              <Button variant="secondary" onClick={clear}>
                Done
              </Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
