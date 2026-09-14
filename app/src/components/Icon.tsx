/**
 * Icons: style guide §2.6.
 *
 * One set, outline, 1.5px stroke, drawn on a 24px grid and scaled to the size
 * asked for. Drawn here rather than pulled from a package, so there is no
 * dependency to vet, and every stroke is `currentColor`, so an icon takes the
 * colour of the label beside it in both themes.
 *
 * ── Why these replaced the text glyphs ────────────────────────────────────
 *
 * The navigation used characters: ◧ ☰ ◈ ▤ ⌫ ⚙. They are not one set. Each is
 * drawn by whichever installed font has it, so they came out at different
 * sizes and weights side by side, and on some phones ⚙ is drawn as a colour
 * emoji, which the style guide bans outright. An SVG is the same shape on
 * every screen.
 *
 * Every icon is decorative (`aria-hidden`). A control that shows one with no
 * words beside it carries its own `aria-label`.
 */

import type { ReactNode } from "react";

export type IconName =
  | "dashboard"
  | "add"
  | "ledger"
  | "debt"
  | "insights"
  | "budget"
  | "statements"
  | "bin"
  | "activity"
  | "settings"
  | "more"
  | "edit"
  | "close"
  | "search";

const SHAPES: Record<IconName, ReactNode> = {
  dashboard: (
    <>
      <rect x="3.75" y="3.75" width="6.5" height="8.5" rx="1.5" />
      <rect x="13.75" y="3.75" width="6.5" height="5" rx="1.5" />
      <rect x="3.75" y="15.75" width="6.5" height="4.5" rx="1.5" />
      <rect x="13.75" y="12.25" width="6.5" height="8" rx="1.5" />
    </>
  ),
  add: <path d="M12 5v14M5 12h14" />,
  ledger: (
    <>
      <path d="M9 6.5h11M9 12h11M9 17.5h11" />
      <path d="M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01" strokeWidth={2.5} />
    </>
  ),
  // The half filled circle is the Debt flow's own glyph, so the screen and the
  // flow tile read as the same thing.
  debt: (
    <>
      <circle cx="12" cy="12" r="8.25" />
      <path d="M12 3.75a8.25 8.25 0 0 1 0 16.5z" fill="currentColor" stroke="none" />
    </>
  ),
  insights: (
    <>
      <path d="M3.75 16.5l5.25-5.25 3.75 3.75 7.5-7.5" />
      <path d="M15 7.5h5.25v5.25" />
    </>
  ),
  budget: (
    <>
      <circle cx="12" cy="12" r="8.25" />
      <path d="M12 3.75V12h8.25" />
    </>
  ),
  statements: (
    <>
      <path d="M14.25 3.75H7.5A1.5 1.5 0 0 0 6 5.25v13.5a1.5 1.5 0 0 0 1.5 1.5h9a1.5 1.5 0 0 0 1.5-1.5V7.5z" />
      <path d="M14.25 3.75V7.5H18M9 12h6M9 15.75h6" />
    </>
  ),
  bin: (
    <path d="M4.5 6.75h15M9.75 6.75V4.5h4.5v2.25M6.75 6.75l.75 12.75a1.5 1.5 0 0 0 1.5 1.5h6a1.5 1.5 0 0 0 1.5-1.5l.75-12.75M10.25 10.5v6M13.75 10.5v6" />
  ),
  activity: (
    <>
      <circle cx="12" cy="12" r="8.25" />
      <path d="M12 7.5V12l3 1.75" />
    </>
  ),
  settings: (
    <>
      <path d="M4.5 7.5h8.25M16.5 7.5h3M4.5 16.5h3M11.25 16.5h8.25" />
      <circle cx="14.625" cy="7.5" r="1.875" />
      <circle cx="9.375" cy="16.5" r="1.875" />
    </>
  ),
  more: (
    <>
      <circle cx="6" cy="12" r="1.25" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.25" fill="currentColor" stroke="none" />
      <circle cx="18" cy="12" r="1.25" fill="currentColor" stroke="none" />
    </>
  ),
  edit: (
    <>
      <path d="M4.5 19.5l.9-3.6L15.6 5.7a1.91 1.91 0 0 1 2.7 2.7L8.1 18.6z" />
      <path d="M13.8 7.5l2.7 2.7" />
    </>
  ),
  close: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  search: (
    <>
      <circle cx="10.75" cy="10.75" r="6" />
      <path d="M15.25 15.25l4.5 4.5" />
    </>
  ),
};

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="fms-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
    >
      {SHAPES[name]}
    </svg>
  );
}
