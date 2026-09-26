/**
 * A sheet that rises from the bottom of a phone (style guide §3.11).
 *
 * ── Why it exists ─────────────────────────────────────────────────────────
 *
 * The owner, 26 September 2026: the phone should not be "a scaled down
 * version of the pc version". Every Database row on a phone carried two text
 * links under it, Correct and Move to bin, which is a desktop table's row
 * actions laid out in a list. A phone list is tapped: the row opens what can
 * be done with it, from the bottom of the screen where the thumb already is.
 *
 * Portalled to the body, because a card is a size container, and a size
 * container is the containing block for anything fixed inside it: a sheet
 * rendered in place would be pinned to the card, not to the screen.
 *
 * Escape and a tap outside close it, focus stays inside while it is open and
 * goes back to whatever opened it afterwards, as the dialog's does.
 */

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { Icon } from "./Icon";

export function Sheet({
  title,
  subtitle,
  onClose,
  children,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children?: ReactNode;
  /** Along the bottom, the main one last so it sits under the right thumb. */
  actions?: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        close.current();
        return;
      }
      if (e.key !== "Tab" || !panel.current) return;
      const focusable = panel.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    panel.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      returnTo?.focus();
    };
  }, []);

  return createPortal(
    <>
      <div className="fms-scrim fms-scrim--sheet" aria-hidden onClick={() => close.current()} />
      <div ref={panel} className="fms-rowsheet" role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : undefined} tabIndex={-1}>
        <div className="fms-sheethandle" aria-hidden />
        <div className="fms-rowsheet-head">
          <div className="fms-rowsheet-titles">
            <h2 className="t-display-m" style={{ margin: 0 }}>
              {title}
            </h2>
            {subtitle && <p className="t-caption fms-rowsheet-sub">{subtitle}</p>}
          </div>
          <button type="button" className="fms-rowsheet-close" aria-label="Close" onClick={() => close.current()}>
            <Icon name="close" size={20} />
          </button>
        </div>
        {children && <div className="fms-rowsheet-body">{children}</div>}
        {actions && <div className="fms-rowsheet-actions">{actions}</div>}
      </div>
    </>,
    document.body,
  );
}
