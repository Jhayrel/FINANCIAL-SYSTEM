/**
 * Confirmation dialog.
 *
 * Settings edits are not free: changing an account's type moves it between
 * sections, renaming rewrites every historical row that mentions it, and
 * removing a spending type unclassifies the rows that used it. A stray click
 * on a dropdown should not do any of that silently.
 *
 * Usage:
 *
 *   const { confirm, dialog } = useConfirm();
 *   ...
 *   if (await confirm({ title: "Rename?", body: "…" })) doIt();
 *   ...
 *   return <>{dialog}{rest}</>;
 *
 * The promise resolves false on cancel, Escape, or a click on the backdrop,
 * every escape hatch means "no".
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "./primitives";

export interface ConfirmRequest {
  readonly title: string;
  /** What actually happens. Say the consequence, not "this cannot be undone". */
  readonly body?: ReactNode;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  readonly tone?: "normal" | "danger";
}

interface Pending extends ConfirmRequest {
  readonly resolve: (ok: boolean) => void;
}

export function useConfirm(): {
  confirm: (req: ConfirmRequest) => Promise<boolean>;
  dialog: ReactNode;
} {
  const [pending, setPending] = useState<Pending | null>(null);

  const confirm = useCallback(
    (req: ConfirmRequest) =>
      new Promise<boolean>((resolve) => {
        setPending({ ...req, resolve });
      }),
    [],
  );

  const settle = useCallback((ok: boolean) => {
    setPending((p) => {
      p?.resolve(ok);
      return null;
    });
  }, []);

  return {
    confirm,
    dialog: pending ? <ConfirmDialog request={pending} onSettle={settle} /> : null,
  };
}

function ConfirmDialog({
  request,
  onSettle,
}: {
  request: ConfirmRequest;
  onSettle: (ok: boolean) => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const confirmButton = useRef<HTMLDivElement>(null);

  // Escape always cancels. Tab is kept inside the panel so a keyboard user
  // cannot end up operating the page behind the dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        onSettle(false);
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
    confirmButton.current?.querySelector("button")?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onSettle]);

  return (
    <div
      className="fms-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onSettle(false);
      }}
    >
      <div
        ref={panel}
        className="fms-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="fms-confirm-title"
      >
        <h2 id="fms-confirm-title" className="t-display-m" style={{ margin: 0 }}>
          {request.title}
        </h2>

        {request.body && (
          <div className="t-body" style={{ color: "var(--ink-2)" }}>
            {request.body}
          </div>
        )}

        <div className="fms-dialog-actions">
          <Button onClick={() => onSettle(false)}>{request.cancelLabel ?? "Cancel"}</Button>
          <span ref={confirmButton}>
            <Button
              variant={request.tone === "danger" ? "danger" : "primary"}
              onClick={() => onSettle(true)}
            >
              {request.confirmLabel ?? "OK"}
            </Button>
          </span>
        </div>
      </div>
    </div>
  );
}
