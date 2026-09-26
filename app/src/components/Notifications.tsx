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
import { useBackToClose } from "../data/backButton";
import { worstLevel, type Alert as Finding, type AlertArea, type AlertLevel } from "../domain/alerts";
import type { SyncNotice } from "../domain/syncState";

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
  status = null,
  onOpenChange,
}: {
  alerts: readonly Finding[];
  /** Go where the finding can be dealt with. */
  onOpen: (finding: Finding) => void;
  /** Under the list, such as the assistant's summary of it. */
  footer?: ReactNode;
  /**
   * Saving: offline, slow, or refused (domain/syncState.ts).
   *
   * The same notice that floats in the corner. On 26 September 2026 it
   * floated over this list and hid its first line, so while the list is open
   * the corner stays clear and the notice is read here instead. Closing it in
   * the corner does not lose it: it stays here until it is put right.
   */
  status?: SyncNotice | null;
  /** Told when the list opens and closes, so the corner can make way. */
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);
  // Back closes the list rather than leaving the app.
  useBackToClose(open, () => setOpen(false));
  const [seen, setSeen] = useState<ReadonlySet<string>>(readSeen);
  const box = useRef<HTMLDivElement>(null);

  const unseen = alerts.filter((a) => !seen.has(a.id));
  // A problem with saving counts until it is put right, seen or not.
  const worst = worstLevel(status && status.level !== "info" ? [...unseen, { level: status.level }] : unseen);
  const count = unseen.length + (status && status.level !== "info" ? 1 : 0);

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
        {count > 0 && worst && (
          <span aria-hidden className="t-micro fms-notify-count" style={{ background: `var(--${worst})` }}>
            {count > 9 ? "9+" : count}
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

          {status && (
            <div className="fms-notify-status" role="status">
              <span aria-hidden className="fms-notify-glyph" style={{ color: `var(--${status.level === "info" ? "ink-3" : status.level})` }}>
                <Icon name={GLYPH[status.level]} size={18} />
              </span>
              <span className="fms-notify-text">
                <span className="t-body-strong">{status.title}</span>
                <span className="t-caption" style={{ color: "var(--ink-2)" }}>
                  {status.detail}
                </span>
              </span>
            </div>
          )}

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
