/**
 * Select.
 *
 * A listbox, not a native `<select>`.
 *
 * The native control's popup is drawn by the operating system, so it cannot be
 * styled: `text-align` on an `<option>` is ignored, the menu inherits the
 * closed control's alignment, and the colours are the platform's rather than
 * the app's. None of that is fixable from CSS, so this replaces it.
 *
 * The trigger and the menu are both left-aligned, which is what the field
 * beside them does and what a dropdown is expected to do.
 *
 * What that buys, beyond the alignment:
 *   - the menu is painted with the app's own tokens, so it matches in dark mode
 *   - it is rendered in a portal, so it is not clipped by the settings panel's
 *     own scroll container
 *   - long lists scroll instead of running off the screen
 *
 * What it costs: the keyboard and screen-reader behaviour that came free with
 * the native element has to be written out. It is written out below, following
 * the ARIA listbox pattern.
 */

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";

const CONTROL_HEIGHT = 44;
/** Roughly seven rows before it scrolls. */
const MAX_MENU_HEIGHT = 264;
/** Wide enough for the longest account name, narrow enough to stay a menu. */
const MAX_MENU_WIDTH = 420;
/** Breathing room kept between the menu and the edge of the screen. */
const EDGE = 8;

export function Select({
  value,
  onChange,
  options,
  placeholder,
  invalid,
  disabled,
  id,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
  placeholder?: string | undefined;
  invalid?: boolean | undefined;
  disabled?: boolean | undefined;
  id?: string | undefined;
  ariaLabel?: string | undefined;
}) {
  const listId = useId();
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [box, setBox] = useState<CSSProperties | null>(null);

  const items = placeholder ? ["", ...options] : [...options];
  const selectedIndex = Math.max(0, items.indexOf(value));

  const place = useCallback(() => {
    const el = button.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    const height = Math.min(MAX_MENU_HEIGHT, items.length * 40 + 8);
    // Flip upward when there is not room underneath, so the menu is never
    // half off the bottom of a phone screen.
    const flip = below < height + 8 && r.top > below;

    setBox({
      position: "fixed",
      left: r.left,
      // The trigger is a floor, not a ceiling. A narrow Type column should not
      // wrap "Maya Bank (Personal savings)" onto two lines; the menu grows to
      // fit its longest option instead. `width: max-content` in the CSS does
      // the growing, capped so it cannot run off a phone screen.
      minWidth: r.width,
      maxWidth: Math.min(MAX_MENU_WIDTH, window.innerWidth - EDGE * 2),
      ...(flip ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
      maxHeight: Math.min(MAX_MENU_HEIGHT, flip ? r.top - 12 : below - 12),
    });
  }, [items.length]);

  useLayoutEffect(() => {
    if (!open) return;
    place();
  }, [open, place]);

  // Second pass. The menu's real width is only known once it has rendered at
  // its content size, so nudge it back on screen if growing pushed it off the
  // right edge. Anchored left normally; right-aligned when that is what fits.
  useLayoutEffect(() => {
    if (!open || !box) return;
    const el = menu.current;
    const anchor = button.current;
    if (!el || !anchor) return;

    const m = el.getBoundingClientRect();
    const a = anchor.getBoundingClientRect();
    const overflow = m.right - (window.innerWidth - EDGE);
    if (overflow <= 0) return;

    const shifted = Math.max(EDGE, Math.min(a.left, a.right - m.width));
    if (Math.abs(shifted - (box.left as number)) < 1) return;
    setBox((b) => (b ? { ...b, left: shifted } : b));
  }, [open, box]);

  useEffect(() => {
    if (!open) return;

    const onPointer = (e: MouseEvent): void => {
      const t = e.target as Node;
      if (!button.current?.contains(t) && !menu.current?.contains(t)) setOpen(false);
    };
    // Scrolling an ancestor moves the anchor, and tracking that continuously
    // costs more than it is worth, so the menu closes. Scrolling INSIDE the
    // menu is not that, and closing on it made the list impossible to scroll.
    const onScroll = (e: Event): void => {
      if (menu.current?.contains(e.target as Node)) return;
      setOpen(false);
    };

    document.addEventListener("mousedown", onPointer);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({
      block: "nearest",
    });
  }, [open, active]);

  const commit = (i: number): void => {
    const picked = items[i];
    if (picked !== undefined) onChange(picked);
    setOpen(false);
    button.current?.focus();
  };

  const openAt = (i: number): void => {
    if (disabled) return;
    setActive(i);
    setOpen(true);
  };

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (disabled) return;

    if (!open) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        openAt(selectedIndex);
      }
      return;
    }

    switch (e.key) {
      case "Escape":
        e.preventDefault();
        setOpen(false);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        commit(active);
        break;
      case "ArrowDown":
        e.preventDefault();
        setActive((i) => Math.min(items.length - 1, i + 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActive((i) => Math.max(0, i - 1));
        break;
      case "Home":
        e.preventDefault();
        setActive(0);
        break;
      case "End":
        e.preventDefault();
        setActive(items.length - 1);
        break;
      case "Tab":
        setOpen(false);
        break;
      default: {
        // Typeahead, the one native behaviour people miss most.
        if (e.key.length !== 1) return;
        const from = active + 1;
        const order = [...items.slice(from), ...items.slice(0, from)];
        const hit = order.findIndex((o) => o.toLowerCase().startsWith(e.key.toLowerCase()));
        if (hit >= 0) setActive((from + hit) % items.length);
      }
    }
  };

  const label = value || placeholder || "";

  return (
    <>
      <button
        id={id}
        ref={button}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? listId : undefined}
        aria-invalid={invalid || undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openAt(selectedIndex))}
        onKeyDown={onKeyDown}
        className={`t-body fms-select${invalid ? " fms-select--invalid" : ""}`}
        style={{ height: CONTROL_HEIGHT }}
      >
        <span className={`fms-select-value${value ? "" : " fms-select-placeholder"}`}>{label}</span>
        <span aria-hidden className="fms-select-chevron">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path
              d="M3 4.5 6 7.5 9 4.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>

      {open &&
        box &&
        createPortal(
          <div
            ref={menu}
            id={listId}
            role="listbox"
            aria-label={ariaLabel}
            className="fms-menu"
            style={box}
            onKeyDown={onKeyDown}
            tabIndex={-1}
          >
            {items.map((o, i) => (
              <div
                key={o || "__placeholder"}
                role="option"
                aria-selected={o === value}
                data-active={i === active}
                className="fms-menu-item"
                onMouseEnter={() => setActive(i)}
                onClick={() => commit(i)}
              >
                <span className={o ? undefined : "fms-select-placeholder"}>{o || placeholder}</span>
                {o === value && (
                  <span aria-hidden className="fms-menu-tick">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path
                        d="M2.5 6.2 4.8 8.5 9.5 3.8"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                )}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
