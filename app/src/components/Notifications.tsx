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
import { mustStay, newFirst, prunedHidden, sayingOf, splitHidden, type Hidden } from "../domain/bellTarget";
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
  wallet: "Open the entries",
  bills: "Record it",
  debt: "Open Debt",
  goals: "Open Settings",
  settings: "Open Settings",
  pattern: "Open Insights",
  review: "Open Needs review",
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

  /*
   * The count is what the list holds and has not been looked at. A saving
   * notice counts only when a save failed: "Offline, 1 change waiting" came
   * and went with the connection, and the bell said 1 over a list with
   * nothing new in it (owner, 17 November 2026: "the bell icon say 1 but if
   * I click it nothing"). Waiting and slow saves stay in the corner notice.
   */
  const failed = status && status.level === "over" ? status : null;
  const unseen = shown.filter((a) => !seen.has(a.id));
  const worst = worstLevel(failed ? [...unseen, { level: failed.level }] : unseen);
  const count = unseen.length + (failed ? 1 : 0);
  const ordered = newFirst(shown, seen);
  const clearable = shown.filter((a) => !mustStay(a));
  // "Clear all", undone with one tap: what was cleared and when.
  const [undo, setUndo] = useState<Hidden | null>(null);
  const clearAll = (): void => {
    if (clearable.length === 0) return;
    setUndo(hidden);
    const next = { ...prunedHidden(every, hidden), ...Object.fromEntries(clearable.map((a) => [a.id, sayingOf(a)])) };
    setHidden(next);
    writeHidden(next);
  };
  const undoClear = (): void => {
    if (!undo) return;
    setHidden(undo);
    writeHidden(undo);
    setUndo(null);
  };

  // Opening the list is looking at it. Only the findings there now are kept.
  // Read from the list as it opened, so the new ones stay marked while it is open.
  const [openedSeen, setOpenedSeen] = useState<ReadonlySet<string>>(seen);
  useEffect(() => {
    if (!open || !settled) return;
    setOpenedSeen(seen);
    const ids = alerts.map((a) => a.id);
    setSeen(new Set(ids));
    writeSeen(ids);
    // What is hidden and gone, or changed, is forgotten here too.
    setHidden((h) => {
      const kept = prunedHidden(alerts, h);
      if (Object.keys(kept).length !== Object.keys(h).length) writeHidden(kept);
      return Object.keys(kept).length === Object.keys(h).length ? h : kept;
    });
    // Once for each opening: what was seen before it is what marks the new ones.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, settled]);
  useEffect(() => {
    if (!open) setUndo(null);
  }, [open]);
  const listed = open ? newFirst(shown, openedSeen) : ordered;
  const isNew = (a: Finding): boolean => !(open ? openedSeen : seen).has(a.id);
  const newCount = listed.filter(isNew).length;

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
      ? "Notifications: nothing needs attention"
      : `Notifications: ${shown.length}${count > 0 ? `, ${count} new` : ""}`;
  const goWords = (a: Finding): string =>
    a.id.startsWith("bills-lapsed") || a.id.startsWith("bills-overdue") ? "Open Settings" : a.id.startsWith("debt-below-zero") ? "Open the Dashboard" : a.query ? "Open the entries" : GO[a.area];

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
        <div className="fms-notify-panel" role="dialog" aria-label="Notifications">
          <div className="fms-notify-head">
            <span className="fms-notify-headtext">
              <span className="t-body-strong">Notifications</span>
              {newCount > 0 && (
                <span className="t-micro fms-notify-newcount">{newCount} new</span>
              )}
            </span>
            <span className="fms-notify-headacts">
              {clearable.length > 0 && (
                <button type="button" className="t-caption fms-notify-close" onClick={clearAll}>
                  Clear all
                </button>
              )}
              <button type="button" className="t-caption fms-notify-close" onClick={() => setOpen(false)} aria-label="Close notifications">
                Close
              </button>
            </span>
          </div>

          {undo && (
            <div className="fms-notify-undo t-caption" role="status">
              <span>Cleared. They come back if their figures change.</span>
              <button type="button" className="t-caption fms-notify-close" onClick={undoClear}>
                Undo
              </button>
            </div>
          )}

          {failed && (
            <div className="fms-notify-status" role="status">
              <span aria-hidden className="fms-notify-glyph" style={{ color: `var(--${failed.level})` }}>
                <Icon name={GLYPH[failed.level]} size={18} />
              </span>
              <span className="fms-notify-text">
                <span className="t-body-strong">{failed.title}</span>
                <span className="t-caption fms-notify-detail">{failed.detail}</span>
              </span>
            </div>
          )}

          {listed.length === 0 ? (
            <p className="t-caption fms-notify-empty">
              {away.length > 0 ? "All clear. Cleared items come back here if their figures change." : "All clear. Bills, budgets, balances and debts are checked each time the ledger changes."}
            </p>
          ) : (
            <ul className="fms-notify-list">
              {/*
                Short and alike: the title, two lines of the detail, then Open
                and Clear. Long paragraphs per item made the list a page to
                read (owner, 17 November 2026: "its ugly make it cleaner ui").
                One that must stay says so where Clear would be.
              */}
              {listed.map((a) => (
                <li key={a.id} className={isNew(a) ? "fms-notify-row fms-notify-row--new" : "fms-notify-row"}>
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
                        {isNew(a) && <span className="fms-notify-dot" aria-label="new" />}
                      </span>
                      <span className="t-caption fms-notify-detail">{a.detail}</span>
                    </span>
                  </button>
                  <div className="fms-notify-acts">
                    <button
                      type="button"
                      className="t-caption fms-notify-go"
                      onClick={() => {
                        setOpen(false);
                        onOpen(a);
                      }}
                    >
                      {goWords(a)}
                    </button>
                    {mustStay(a) ? (
                      <span className="t-micro fms-notify-stays">Stays until dealt with</span>
                    ) : (
                      <button type="button" className="t-caption fms-notify-hide" onClick={() => hide(a)} aria-label={`Clear "${a.title}"`}>
                        Clear
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {away.length > 0 && (
            <div className="fms-notify-away">
              <button type="button" className="t-caption fms-notify-awaytoggle" aria-expanded={showAway} onClick={() => setShowAway((v) => !v)}>
                {showAway ? "Hide cleared" : `${away.length} cleared`}
              </button>
              {showAway && (
                <ul className="fms-notify-list">
                  {away.map((a) => (
                    <li key={a.id} className="fms-notify-row">
                      <span className="fms-notify-item fms-notify-item--away">
                        <span className="fms-notify-text">
                          <span className="t-body-strong">{a.title}</span>
                          <span className="t-caption fms-notify-detail">{a.detail}</span>
                        </span>
                      </span>
                      <div className="fms-notify-acts">
                        <span />
                        <button type="button" className="t-caption fms-notify-hide" onClick={() => unhide(a)} aria-label={`Bring back "${a.title}"`}>
                          Bring back
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
