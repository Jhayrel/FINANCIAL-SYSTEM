/**
 * The chat's + on a phone: pictures or files, picked before the phone is
 * asked (owner, 27 October 2026: "before i can see screenshots and photos
 * etc. Make it work photos and files").
 *
 * One file field that took both made Android offer its camera beside the
 * gallery and the files, the camera button twice over, so + was cut to PDFs
 * and the screenshots went missing from it. Two fields, one for each, give
 * the phone's photo picker for the one and its files for the other, and the
 * camera stays on its own button. Closed by a choice, a tap outside or
 * Escape, as the Planner's More menu is.
 */
import { useEffect, useRef } from "react";

import { Icon, type IconName } from "./Icon";

export interface AttachChoice {
  readonly label: string;
  readonly icon: IconName;
  readonly run: () => void;
}

export function AttachMenu({ open, onClose, choices }: { open: boolean; onClose: () => void; choices: readonly AttachChoice[] }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent): void => {
      // The + itself toggles the menu: a tap on it is not a tap outside.
      const target = e.target as HTMLElement;
      if (box.current && !box.current.contains(target) && !target.closest("[data-attach-toggle]")) onClose();
    };
    const key = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", key, true);
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fms-attachmenu" role="menu" aria-label="Attach" ref={box}>
      {choices.map((c) => (
        <button
          key={c.label}
          type="button"
          role="menuitem"
          className="fms-actionrow"
          onClick={() => {
            onClose();
            c.run();
          }}
        >
          <Icon name={c.icon} size={20} />
          <span className="t-body">{c.label}</span>
        </button>
      ))}
    </div>
  );
}
