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
import { Rich } from "../components/Rich";
import { AmountInput, Field } from "../components/forms";
import { Select } from "../components/Select";
import { useConfirm } from "../components/Confirm";
import { accountGroups, type Account } from "../domain/accounts";
import { walletBalance } from "../domain/balances";
import type { Draft } from "../domain/entry";
import { formatMedium, getYear } from "../domain/dates";
import {
  choicesForClue,
  clueWords,
  investigate,
  investigationWords,
  readHistory,
  type Clue,
  investigationForModel,
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
  accounts: settingsAccounts = [],
  asOf,
  onAdd,
  onEditRow,
  onBin,
  onAsk,
}: {
  transactions: readonly Transaction[];
  reference: ReferenceLists;
  /** Settings' accounts, so the list sits under the same headings as there. */
  accounts?: readonly Account[];
  asOf: IsoDate;
  /** The Add form with this entry filled in, to check and save. */
  onAdd: (draft: Draft) => void;
  /** A saved row into the Add form, to correct it. */
  onEditRow: (row: Transaction) => void;
  /** A row to the bin, which can be restored. */
  onBin: (id: string) => void;
  /**
   * Hand the finished finding to the assistant, and get its reading back.
   *
   * Absent when the AI is off, and the panel simply does not offer it then.
   */
  onAsk?: ((finding: string) => Promise<string>) | undefined;
}) {
  const grouped = useMemo(
    () => accountGroups([...reference.wallets, ...reference.savings], settingsAccounts, reference),
    [reference, settingsAccounts],
  );
  const accounts = grouped.options;
  const [aiAnswer, setAiAnswer] = useState("");
  const [asking, setAsking] = useState(false);
  const [asked, setAsked] = useState<Asked>(
    () =>
      kept && accounts.includes(kept.account)
        ? kept
        : { account: accounts[0] ?? "", actual: null, date: asOf, matchedOn: "", history: "", ran: false },
  );
  const { account, actual, date, matchedOn, history, ran } = asked;
  const { confirm, dialog } = useConfirm();
  /** The two optional fields, folded until wanted; open whenever either holds something. */
  const [more, setMore] = useState<boolean | null>(null);
  const moreOpen = more ?? (Boolean(matchedOn) || Boolean(history.trim()));

  // Kept whenever it changes, so leaving for the Add form and coming back finds it again.
  useEffect(() => {
    kept = asked;
  }, [asked]);

  /** Any change to the question puts the answer away until Find it is pressed again. */
  const change = (next: Partial<Asked>): void => {
    setAsked((prev) => ({ ...prev, ...next, ran: next.ran ?? false }));
  };

  // Read today, the ledger's figure is the sidebar's: entries dated ahead count (`countAhead`).
  const today = date === asOf;
  const upToDate = useMemo(() => transactions.filter((t) => today || t.date <= date), [transactions, date, today]);
  const recordedNow = account ? walletBalance(upToDate, account) : 0;
  const lines = useMemo(() => readHistory(history, getYear(date)), [history, date]);
  const interestItem = reference.revenueCategories.find((c) => /interest/i.test(c)) ?? "";

  // Worked out from the ledger as it is now, so a finding that has been put right drops out.
  const result = useMemo(
    () =>
      ran && account && actual !== null
        ? investigate({ transactions, account, actual, asOf: date, statement: lines, matchedOn: matchedOn || undefined, countAhead: today })
        : null,
    [ran, account, actual, date, lines, matchedOn, transactions, today],
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

  /**
   * Both ways of dealing with a row the investigation named.
   *
   * Every finding that points at one record used to offer exactly one thing
   * to do with it: "Edit #0432", or for a duplicate, "Move to the bin".
   * Which one you were given depended on what the investigation thought was
   * wrong, not on what you wanted to do about it, and the owner asked for
   * both on 21 September 2026: "add an option where I can delete it here or
   * edit".
   *
   * The correction opens the row in the Add form, so nothing is changed
   * without being looked at. The bin asks first and is restorable, matching
   * every other delete in the app.
   */
  /*
   * Every way to act on a finding is a button that looks like one: outlined,
   * the same size, side by side. 6 October 2026, the owner, over "Open #3893"
   * drawn as bare text beside three outlined buttons: "add button then make
   * it clean". Binning is outlined in red, as Remove is in Settings.
   */
  const rowActions = (row: Transaction) => (
    <span className="fms-findrow-actions">
      <Button size="sm" onClick={() => onEditRow(row)}>
        Edit {number(row)}
      </Button>
      <Button size="sm" variant="danger" onClick={() => void bin(row)}>
        Move to the bin
      </Button>
    </span>
  );

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
      case "duplicate":
      case "inside":
      case "amount-differs":
      case "not-on-statement":
        return rowActions(clue.row);
      case "estimate":
        // A guess the owner made: corrected, never binned from here.
        return (
          <span className="fms-findrow-actions">
            <Button size="sm" onClick={() => onEditRow(clue.row)}>
              Edit {number(clue.row)}
            </Button>
          </span>
        );
      case "together": {
        /*
         * One entry that adds up to the difference: Edit it (another account,
         * another amount) or bin it if it never happened. Several: each one
         * to look at, never binned together from here.
         */
        const only = clue.rows.length === 1 ? clue.rows[0] : undefined;
        return only ? (
          rowActions(only)
        ) : (
          <span className="fms-findrow-actions">
            {clue.rows.map((r) => (
              <Button key={r.id} size="sm" onClick={() => onEditRow(r)}>
                Edit {number(r)}
              </Button>
            ))}
          </span>
        );
      }
      case "fee-inside":
      case "ahead":
        // The owner's entries: opened to edit, never changed from here.
        return (
          <span className="fms-findrow-actions">
            {clue.rows.map((r) => (
              <Button key={r.id} size="sm" onClick={() => onEditRow(r)}>
                Edit {number(r)}
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
      subtitle="An account holds a different amount than the ledger says? This finds where the difference went."
    >
      {dialog}
      <div className="fms-find">
        {/*
          One row, the three things always asked: which account, what it
          really holds, and on which day (owner, 27 September 2026: "clean the
          UI of the Find a difference"). The two that only narrow the search
          are folded under it until wanted, and open by themselves when
          either already has something in it.
        */}
        <div className="fms-find-form">
          <div className="fms-find-row">
            <Field label="Account">
              <Select
                value={account}
                onChange={(v) => change({ account: v })}
                options={accounts}
                groups={grouped.groups}
                // What each held on the day asked about, the same figure as the line under the fields.
                details={Object.fromEntries(accounts.map((a) => [a, formatMoney(walletBalance(upToDate, a))]))}
                ariaLabel="Which account"
              />
            </Field>
            <Field label="It really holds">
              <AmountInput value={actual} onChange={(v) => change({ actual: v })} ariaLabel="What the account really holds" />
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
            <div className="fms-find-go">
              <Button variant="primary" onClick={run} disabled={!account || actual === null}>
                Find it
              </Button>
              <Button variant="ghost" onClick={clear} disabled={actual === null && !history && !matchedOn && date === asOf}>
                Clear
              </Button>
            </div>
          </div>

          <p className="t-caption fms-find-says">
            The ledger says <strong>{formatMoney(recordedNow)}</strong> for {account || "this account"} on that day
            {actual !== null && actual !== recordedNow
              ? `: ${formatMoney(Math.abs(recordedNow - actual))} ${recordedNow > actual ? "more" : "less"} than it really holds.`
              : actual !== null
                ? ", the same as it really holds."
                : "."}
          </p>

          <button
            type="button"
            className="t-caption fms-linkbtn fms-find-toggle"
            aria-expanded={moreOpen}
            onClick={() => setMore(!moreOpen)}
          >
            {moreOpen ? "Hide the last day it matched and its history" : "Narrow it: the last day it matched, or paste its history"}
            {!moreOpen && (matchedOn || history.trim()) ? " (filled in)" : ""}
          </button>

          {moreOpen && (
            <div className="fms-find-more">
              <Field
                label="Last matched on"
                optional
                help={
                  matchedOn
                    ? "Only what was recorded after that day is searched."
                    : "The last day the account and the ledger agreed, if you know it."
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
                    : "Copied from the bank or wallet app, one movement a line. Screenshots go to the chat instead."
                }
              >
                <textarea
                  value={history}
                  onChange={(e) => change({ history: e.target.value })}
                  rows={3}
                  spellCheck={false}
                  placeholder={"Sep 3  Cinema  -5,000\nSep 6  Travel booking  15,000\nSep 7  Received from client  +12,500"}
                  className="t-body fms-paste"
                />
              </Field>
            </div>
          )}
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
              {/*
                In words, not signs. "Difference −PHP 340.00" in red, with
                more cash in hand than recorded, read as money lost (3
                October 2026). Which way it goes is the label; the figure is
                how much.
              */}
              <div>
                <span className="t-label">
                  {result.gap === 0 ? "Difference" : result.gap < 0 ? "More than recorded" : "Less than recorded"}
                </span>
                <Money value={Math.abs(result.gap)} size="m" tone={result.gap === 0 ? "var(--ok)" : "var(--ink)"} />
              </div>
              <div>
                <span className="t-label">{result.overshoot ? "Worth checking" : "Found so far"}</span>
                <Money value={Math.abs(result.explained)} size="m" tone={result.unexplained === 0 && result.gap !== 0 ? "var(--ok)" : "var(--ink)"} />
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
                      <Money value={Math.abs(clue.explains)} size="s" tone="var(--ink)" />
                      {actionFor(clue)}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {result.aside.length > 0 && (
              <>
                <p className="t-caption" style={{ margin: 0, color: "var(--ink-2)" }}>
                  Also in the ledger and not in the history you gave, though the difference does not need{" "}
                  {result.aside.length === 1 ? "it, so it is" : "them, so they are"} most likely before or after what it shows:
                </p>
                <ul className="fms-findlist">
                  {result.aside.map((clue, i) => (
                    <li key={`a${i}`} className="fms-findrow fms-findrow--maybe">
                      <span className="t-body">{"row" in clue ? `#${String(clue.row.recordNumber).padStart(4, "0")} ${clue.row.item || clue.row.description || clue.row.type} on ${formatMedium(clue.row.date)}` : clueWords(clue)}</span>
                      <span className="fms-findrow-end">
                        <Money value={Math.abs(clue.explains)} size="s" tone="var(--ink)" />
                        {actionFor(clue)}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
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
                        clue.kind === "unrecorded" || clue.kind === "together" || clue.kind === "estimate" || clue.kind === "fee-inside" || clue.kind === "ahead"
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

            {/*
              The assistant reads the finding, and never works it out.

              The arithmetic above is exact and a model would only make it
              worse. What it is good at is the part this screen cannot do:
              which of five candidate rows is the likely one given what the
              owner actually does, and what to check first when nothing
              matched at all. So it is handed the finished result.
            */}
            {onAsk && result.gap !== 0 && (
              <div className="fms-find-ask">
                {aiAnswer ? (
                  // Through `Rich`, so the bold and the bullets the model
                  // writes arrive as bold and bullets rather than asterisks.
                  <Rich text={aiAnswer} size="t-body" />
                ) : (
                  <span className="t-caption" style={{ color: "var(--ink-3)" }}>
                    The figures above are already worked out. The assistant can say which of them to check first.
                  </span>
                )}
                <Button
                  size="sm"
                  loading={asking}
                  onClick={() => {
                    setAsking(true);
                    setAiAnswer("");
                    void onAsk(investigationForModel(result))
                      .then((text) => setAiAnswer(text))
                      .finally(() => setAsking(false));
                  }}
                >
                  {aiAnswer ? "Ask again" : "Ask the assistant"}
                </Button>
              </div>
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
