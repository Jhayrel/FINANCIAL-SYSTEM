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
 */

import { useMemo, useState } from "react";

import { Button, Card, Money } from "../components/primitives";
import { AmountInput, Field } from "../components/forms";
import { Select } from "../components/Select";
import { useConfirm } from "../components/Confirm";
import { walletBalance } from "../domain/balances";
import type { Draft } from "../domain/entry";
import { getYear } from "../domain/dates";
import {
  clueWords,
  draftForClue,
  investigate,
  investigationWords,
  readHistory,
  type Clue,
  type Investigation,
} from "../domain/investigate";
import { formatMoney, type Centavos } from "../domain/money";
import type { IsoDate, ReferenceLists, Transaction } from "../domain/types";

const number = (t: Transaction): string => `#${String(t.recordNumber).padStart(4, "0")}`;

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
  const [account, setAccount] = useState(accounts[0] ?? "");
  const [actual, setActual] = useState<Centavos | null>(null);
  const [date, setDate] = useState<IsoDate>(asOf);
  const [history, setHistory] = useState("");
  const [result, setResult] = useState<Investigation | null>(null);
  const { confirm, dialog } = useConfirm();

  const recordedNow = account ? walletBalance(transactions.filter((t) => t.date <= date), account) : 0;
  const lines = useMemo(() => readHistory(history, getYear(date)), [history, date]);

  const run = (): void => {
    if (!account || actual === null) return;
    setResult(investigate({ transactions, account, actual, asOf: date, statement: lines }));
  };

  const bin = async (row: Transaction): Promise<void> => {
    const ok = await confirm({
      title: `Move ${number(row)} to the bin?`,
      body: `${row.item || row.description || row.type}, ${formatMoney(row.total)} on ${row.date}. It can be restored from the bin.`,
      confirmLabel: "Move to bin",
      tone: "danger",
    });
    if (ok) {
      onBin(row.id);
      setResult(null);
    }
  };

  const actionFor = (clue: Clue) => {
    const draft = result ? draftForClue(clue, result.account, result.asOf) : null;
    switch (clue.kind) {
      case "missing":
      case "cash":
        return draft ? (
          <Button size="sm" onClick={() => onAdd(draft)}>
            Add it
          </Button>
        ) : null;
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
              onChange={(v) => {
                setAccount(v);
                setResult(null);
              }}
              options={accounts}
              details={Object.fromEntries(accounts.map((a) => [a, formatMoney(walletBalance(transactions, a))]))}
              ariaLabel="Which account"
            />
          </Field>
          <Field label="It really holds" help={`The ledger says ${formatMoney(recordedNow)} on that day.`}>
            <AmountInput
              value={actual}
              onChange={(v) => {
                setActual(v);
                setResult(null);
              }}
              ariaLabel="What the account really holds"
            />
          </Field>
          <Field label="On">
            <input
              type="date"
              value={date}
              max={asOf}
              onChange={(e) => {
                setDate(e.target.value || asOf);
                setResult(null);
              }}
              aria-label="The day the balance was read"
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
              onChange={(e) => {
                setHistory(e.target.value);
                setResult(null);
              }}
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
                <span className="t-label">Found</span>
                <Money value={result.explained} size="m" signed tone={result.unexplained === 0 && result.gap !== 0 ? "var(--ok)" : undefined} />
              </div>
            </div>

            <p className="t-body-strong" style={{ margin: 0 }}>
              {summary.headline}
            </p>

            {result.found.length > 0 && (
              <ul className="fms-findlist">
                {result.found.map((clue, i) => (
                  <li key={`f${i}`} className="fms-findrow">
                    <span className="t-body">{clueWords(clue)}</span>
                    <span className="fms-findrow-end">
                      <Money value={clue.explains} size="s" signed />
                      {actionFor(clue)}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {result.unexplained !== 0 && (
              <>
                <p className="t-caption" style={{ margin: 0, color: "var(--ink-2)" }}>
                  {summary.rest}
                </p>
                {result.possible.length > 0 && (
                  <ul className="fms-findlist">
                    {result.possible.map((clue, i) => (
                      <li key={`p${i}`} className="fms-findrow fms-findrow--maybe">
                        <span className="t-body">{clueWords(clue)}</span>
                        <span className="fms-findrow-end">{actionFor(clue)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
