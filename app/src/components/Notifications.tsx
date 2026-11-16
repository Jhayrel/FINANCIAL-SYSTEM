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
import { prunedHidden, sayingOf, splitHidden, type Hidden } from "../domain/bellTarget";
import type { SyncNotice } from "../domain/syncState";

const SEEN_KEY = "fms.notify.seen";
const HIDDEN_KEY = "fms.notify.hidden";

function readHidden(): Hidden {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(HIDDEN_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === "string"));
  } catch {
    return {};
  }
}

function writeHidden(hidden: Hidden): void {
  try {
    window.localStorage.setItem(HIDDEN_KEY, JSON.stringify(hidden));
  } catch {
    // A private window: nothing is hidden next time.
  }
}

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
  planner: "Open the Planner",
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
  settled = true,
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
  /**
   * False while the ledger is still arriving. The list is empty then, and
   * opening it must not record "nothing seen" over what was seen before.
   */
  settled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);
  // Back closes the list rather than leaving the app.
  useBackToClose(open, () => setOpen(false));
  const [seen, setSeen] = useState<ReadonlySet<string>>(readSeen);
  const box = useRef<HTMLDivElement>(null);
  /*
   * Findings put away (owner, 14 November 2026: "it just show the same thing
   * everytime"). One hidden stays out of the list and the count until what
   * it says changes; "Show hidden" lists them, each with Show again. Kept in
   * this browser, as which were seen is.
   */
  const [hidden, setHidden] = useState<Hidden>(readHidden);
  const [showAway, setShowAway] = useState(false);
  const every = alerts;
  const { shown, away } = splitHidden(every, hidden);
  const hide = (a: Finding): void => {
    const next = { ...prunedHidden(every, hidden), [a.id]: sayingOf(a) };
    setHidden(next);
    writeHidden(next);
  };
  const unhide = (a: Finding): void => {
    const next = Object.fromEntries(Object.entries(hidden).filter(([id]) => id !== a.id));
    setHidden(next);
    writeHidden(next);
  };

  const unseen = shown.filter((a) => !seen.has(a.id));
  // A problem with saving counts until it is put right, seen or not.
  const worst = worstLevel(status && status.level !== "info" ? [...unseen, { level: status.level }] : unseen);
  const count = unseen.length + (status && status.level !== "info" ? 1 : 0);

  // Opening the list is looking at it. Only the findings there now are kept.
  useEffect(() => {
    if (!open || !settled) return;
    const ids = alerts.map((a) => a.id);
    setSeen(new Set(ids));
    writeSeen(ids);
    // What is hidden and gone, or changed, is forgotten here too.
    setHidden((h) => {
      const kept = prunedHidden(alerts, h);
      if (Object.keys(kept).length !== Object.keys(h).length) writeHidden(kept);
      return Object.keys(kept).length === Object.keys(h).length ? h : kept;
    });
  }, [open, alerts, settled]);

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
    shown.length === 0
      ? "Nothing needs attention"
      : `${shown.length} thing${shown.length === 1 ? "" : "s"} need${shown.length === 1 ? "s" : ""} attention${
          unseen.length > 0 ? `, ${unseen.length} new` : ""
        }`;
  const goWords = (a: Finding): string =>
    a.id.startsWith("bills-lapsed") || a.id.startsWith("bills-overdue") ? "Open Settings, Categories" : a.id.startsWith("debt-below-zero") ? "Open the Dashboard" : a.query ? "Show the rows" : GO[a.area];

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
            <span className="fms-notify-headtext">
              <span className="t-body-strong">What needs attention</span>
              {shown.length > 0 && (
                <span className="t-caption" style={{ color: "var(--ink-3)" }}>
                  {shown.length}, worst first
                </span>
              )}
            </span>
            <button type="button" className="t-caption fms-notify-close" onClick={() => setOpen(false)}>
              Close
            </button>
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

          {shown.length === 0 ? (
            <p className="t-caption fms-notify-empty">
              {away.length > 0
                ? "Nothing new. What you hid comes back here when its figures change."
                : "Nothing right now. Bills, budgets, balances and debts are checked every time the ledger changes, and anything worth a look shows here."}
            </p>
          ) : (
            <ul className="fms-notify-list">
              {shown.map((a) => (
                <li key={a.id} className="fms-notify-row">
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
                    </span>
                  </button>
                  {/*
                    Where it goes and Hide on one line under the words. Hide was a
                    column of its own the height of the finding, with a rule down
                    it, which took the width the words needed on a phone (owner,
                    16 November 2026: "this is bad ui").
                  */}
                  <div className="fms-notify-acts">
                    <button
                      type="button"
                      className="t-caption fms-notify-go"
                      onClick={() => {
                        setOpen(false);
                        onOpen(a);
                      }}
                    >
                      {goWords(a)}, and see where
                    </button>
                    <button type="button" className="t-caption fms-notify-hide" onClick={() => hide(a)} aria-label={`Hide "${a.title}" until it changes`}>
                      Hide
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {away.length > 0 && (
            <div className="fms-notify-away">
              <button type="button" className="t-micro fms-notify-awaytoggle" aria-expanded={showAway} onClick={() => setShowAway((v) => !v)}>
                {showAway ? "Close the hidden ones" : `${away.length} hidden until ${away.length === 1 ? "it changes" : "they change"}: show`}
              </button>
              {showAway && (
                <ul className="fms-notify-list">
                  {away.map((a) => (
                    <li key={a.id} className="fms-notify-row">
                      <span className="fms-notify-item fms-notify-item--away">
                        <span className="fms-notify-text">
                          <span className="t-body-strong">{a.title}</span>
                          <span className="t-caption" style={{ color: "var(--ink-2)" }}>
                            {a.detail}
                          </span>
                        </span>
                      </span>
                      <div className="fms-notify-acts">
                        <span />
                        <button type="button" className="t-caption fms-notify-hide" onClick={() => unhide(a)} aria-label={`Show "${a.title}" again`}>
                          Show again
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {footer}
        </div>
      )}
    </div>
  );
}
