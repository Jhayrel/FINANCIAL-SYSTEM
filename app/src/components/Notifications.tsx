/**
 * What needs attention, behind a bell in the top bar.
 *
 * ── Why it moved here ─────────────────────────────────────────────────────
 *
 * Every finding was a coloured box stacked down the middle of the Dashboard:
 * seven of them on 2026-09-15, pushing the month's figures below the fold, and
 * visible nowhere else. The owner asked for a notification area at the top
 * right, which is where people look for one. It is on every screen now, so a
 * bill going late is seen from the Budget screen too.
 *
 * The count is of findings not yet looked at, so it goes quiet once the list
 * has been opened and speaks again when something new turns up. Which ones
 * were seen is kept in this browser only: it is a convenience, not a record.
 * The list itself always shows every finding, seen or not.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";

import { Icon, type IconName } from "./Icon";
import { worstLevel, type Alert as Finding, type AlertArea, type AlertLevel } from "../domain/alerts";

const SEEN_KEY = "fms.notify.seen";

const GLYPH: Record<AlertLevel, IconName> = { over: "statusOver", warn: "statusWarn", info: "statusInfo" };

/** What tapping a finding does, said on the finding. */
const GO: Record<AlertArea, string> = {
  budget: "Open Budget",
  wallet: "Show its rows",
  bills: "Record it on Add",
  debt: "Open Debt",
  goals: "Open Settings",
  settings: "Open Settings",
  pattern: "Open Insights",
  review: "Review in the Database",
};

function readSeen(): ReadonlySet<string> {
  try {
    const raw = window.localStorage.getItem(SEEN_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

function writeSeen(ids: readonly string[]): void {
  try {
    window.localStorage.setItem(SEEN_KEY, JSON.stringify(ids));
  } catch {
    // A private window: the count simply comes back next time.
  }
}

export function Notifications({
  alerts,
  onOpen,
  footer,
}: {
  alerts: readonly Finding[];
  /** Go where the finding can be dealt with. */
  onOpen: (finding: Finding) => void;
  /** Under the list, such as the assistant's summary of it. */
  footer?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState<ReadonlySet<string>>(readSeen);
  const box = useRef<HTMLDivElement>(null);

  const unseen = alerts.filter((a) => !seen.has(a.id));
  const worst = worstLevel(unseen);

  // Opening the list is looking at it. Only the findings there now are kept.
  useEffect(() => {
    if (!open) return;
    const ids = alerts.map((a) => a.id);
    setSeen(new Set(ids));
    writeSeen(ids);
  }, [open, alerts]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    const onPointer = (e: PointerEvent): void => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  const label =
    alerts.length === 0
      ? "Nothing needs attention"
      : `${alerts.length} thing${alerts.length === 1 ? "" : "s"} need${alerts.length === 1 ? "s" : ""} attention${
          unseen.length > 0 ? `, ${unseen.length} new` : ""
        }`;

  return (
    <div className="fms-notify" ref={box}>
      <button
        type="button"
        className="fms-topbar-action fms-notify-btn"
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="bell" size={22} />
        {unseen.length > 0 && worst && (
          <span aria-hidden className="t-micro fms-notify-count" style={{ background: `var(--${worst})` }}>
            {unseen.length > 9 ? "9+" : unseen.length}
          </span>
        )}
      </button>

      {open && (
        <div className="fms-notify-panel" role="dialog" aria-label="What needs attention">
          <div className="fms-notify-head">
            <span className="t-body-strong">What needs attention</span>
            {alerts.length > 0 && (
              <span className="t-caption" style={{ color: "var(--ink-3)" }}>
                {alerts.length}, worst first
              </span>
            )}
          </div>

          {alerts.length === 0 ? (
            <p className="t-caption fms-notify-empty">
              Nothing right now. Bills, budgets, balances and debts are checked every time the ledger
              changes, and anything worth a look shows here.
            </p>
          ) : (
            <ul className="fms-notify-list">
              {alerts.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    className="fms-notify-item"
                    onClick={() => {
                      setOpen(false);
                      onOpen(a);
                    }}
                  >
                    <span aria-hidden className="fms-notify-glyph" style={{ color: `var(--${a.level})` }}>
                      <Icon name={GLYPH[a.level]} size={18} />
                    </span>
                    <span className="fms-notify-text">
                      <span className="t-body-strong">
                        {a.title}
                        {!seen.has(a.id) && <span className="t-micro fms-notify-new"> new</span>}
                      </span>
                      <span className="t-caption" style={{ color: "var(--ink-2)" }}>
                        {a.detail}
                      </span>
                      <span className="t-micro fms-notify-go">{a.area === "review" && a.query ? "Show the rows" : GO[a.area]}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {footer}
        </div>
      )}
    </div>
  );
}
