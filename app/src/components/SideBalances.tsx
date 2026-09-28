/**
 * The balances in the sidebar, on a computer.
 *
 * ── Staying tidy as accounts are added ────────────────────────────────────
 *
 * The owner, 28 September 2026, once it was there: "make sure the space dont
 * get cluttered or messy when I added more bank". A list that grows by one
 * line per account, with long names wrapping to two, becomes a wall. So:
 *
 *   - A name stays on one line and is cut with an ellipsis; the whole name
 *     shows on hover. The "low" tag is never the part that is cut.
 *   - Each group's heading carries the group's total, and folds the group
 *     away with one click. What was folded is remembered on this device.
 *   - A group shows four accounts, the largest first (Spending keeps the
 *     order Settings gives it), and the rest behind "Show 3 more".
 *   - Accounts at nothing, outside Spending, are one quiet line.
 *
 * Nothing here is stored in the database: which groups are folded is a
 * preference of this screen, like "Clear this view".
 */

import { useState, type ReactNode } from "react";

import { Money } from "./primitives";

export interface SideAccount {
  readonly name: string;
  readonly balance: number;
}

export interface SideOwed {
  readonly id: string;
  readonly name: string;
  readonly receivable: boolean;
  readonly amount: number;
}

/** Accounts shown in a group before "Show N more". */
const VISIBLE = 4;
const FOLDED_KEY = "fms.side.folded";
const OPENED_KEY = "fms.side.opened";

function readSet(key: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(key);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

function writeSet(key: string, value: ReadonlySet<string>): void {
  try {
    window.localStorage.setItem(key, JSON.stringify([...value]));
  } catch {
    // A private window or blocked storage: it simply is not remembered.
  }
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg aria-hidden width="12" height="12" viewBox="0 0 12 12" fill="none" className="fms-sidechev" style={{ transform: open ? "rotate(90deg)" : undefined }}>
      <path d="M4.5 2.5 8 6l-3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Row({ name, balance, low, note, tone }: { name: string; balance: number; low?: boolean; note?: string; tone?: string | undefined }) {
  return (
    <div className="fms-siderow">
      <span className="t-caption fms-sidename" title={name}>
        <span className="fms-sidename-text">{name}</span>
        {note && <span className="fms-sidename-note">{note}</span>}
        {low && <span className="t-micro fms-sidelow">low</span>}
      </span>
      <Money value={balance} size="s" tone={tone ?? (balance < 0 ? "var(--over)" : balance === 0 ? "var(--ink-3)" : undefined)} />
    </div>
  );
}

export function SideBalances({
  usable,
  groups,
  owed,
  spendingHeading,
  lowThreshold,
}: {
  usable: number;
  groups: readonly (readonly [string, readonly SideAccount[]])[];
  owed: readonly SideOwed[];
  /** The heading the spending wallets come under, which keep their order and are never folded into "empty". */
  spendingHeading: string;
  /** Centavos; a spending wallet under it is tagged low. */
  lowThreshold: number;
}) {
  const [folded, setFolded] = useState<Set<string>>(() => readSet(FOLDED_KEY));
  const [opened, setOpened] = useState<Set<string>>(() => readSet(OPENED_KEY));

  const toggle = (set: Set<string>, key: string, store: string, apply: (next: Set<string>) => void): void => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    writeSet(store, next);
    apply(next);
  };

  const group = (heading: string, total: number | null, count: number, body: ReactNode) => {
    const isFolded = folded.has(heading);
    return (
      <div key={heading} className="fms-sidegroup">
        <button
          type="button"
          className="fms-sidegroup-head"
          aria-expanded={!isFolded}
          onClick={() => toggle(folded, heading, FOLDED_KEY, setFolded)}
          title={isFolded ? `Show ${heading.toLowerCase()}` : `Fold ${heading.toLowerCase()} away`}
        >
          <Chevron open={!isFolded} />
          <span className="t-micro fms-sidegroup-name">{heading}</span>
          {isFolded && <span className="t-micro fms-sidegroup-count">{count}</span>}
          {total !== null && <Money value={total} size="s" tone="var(--ink-3)" />}
        </button>
        {!isFolded && body}
      </div>
    );
  };

  return (
    <section className="fms-sidewallets" aria-label="Balances">
      <div className="fms-sideusable">
        <span className="t-label" style={{ color: "var(--ink-2)" }}>
          Usable now
        </span>
        <Money value={usable} size="m" tone={usable < 0 ? "var(--over)" : undefined} />
      </div>

      {groups.map(([heading, list]) => {
        const spending = heading === spendingHeading;
        const full = spending ? [...list] : list.filter((w) => w.balance !== 0).sort((a, b) => b.balance - a.balance);
        const empty = spending ? [] : list.filter((w) => w.balance === 0);
        const showAll = opened.has(heading);
        const isLow = (w: SideAccount): boolean => spending && (w.balance < 0 || (lowThreshold > 0 && w.balance < lowThreshold));
        /*
         * The spending wallets are the ones used every day, so more of them
         * show, and one that is low or below nothing always shows: a warning
         * behind "Show 1 more" is not a warning.
         */
        const room = spending ? VISIBLE + 2 : VISIBLE;
        const shown = showAll ? full : full.filter((w, i) => i < room || isLow(w));
        const hidden = full.length - shown.length;
        const total = list.reduce((sum, w) => sum + w.balance, 0);
        return group(
          heading,
          // Spending's total is "Usable now", just above.
          spending ? null : total,
          list.length,
          <>
            {shown.map((w) => (
              <Row key={w.name} name={w.name} balance={w.balance} low={isLow(w) && w.balance >= 0} />
            ))}
            {(hidden > 0 || (showAll && full.length > room)) && (
              <button type="button" className="t-micro fms-sidemore" onClick={() => toggle(opened, heading, OPENED_KEY, setOpened)}>
                {showAll ? "Show fewer" : `Show ${hidden} more`}
              </button>
            )}
            {empty.length > 0 && (
              <div className="fms-siderow" title={empty.map((w) => w.name).join(", ")}>
                <span className="t-caption fms-sidename" style={{ color: "var(--ink-3)" }}>
                  <span className="fms-sidename-text">
                    {empty.length === 1 ? empty[0]?.name : full.length === 0 ? `${empty.length} accounts, all empty` : `${empty.length} more, empty`}
                  </span>
                </span>
                <Money value={0} size="s" tone="var(--ink-3)" />
              </div>
            )}
          </>,
        );
      })}

      {owed.length > 0 &&
        group(
          "Owed",
          null,
          owed.length,
          owed.map((d) => (
            <Row key={d.id} name={d.name} balance={d.amount} {...(d.receivable ? { note: "to you" } : {})} tone={d.receivable ? undefined : "var(--flow-debt-text)"} />
          )),
        )}
    </section>
  );
}
