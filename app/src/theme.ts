/**
 * Theme control.
 *
 * All dark values live in one `.theme-dark` block in tokens.css. This module
 * is the only thing that decides whether that class is on <html>. There is no
 * `prefers-color-scheme` block in CSS, so the two can never disagree, the
 * drift between duplicated dark blocks is what shipped unreadable flagged
 * rows in the previous build (spec 6.3).
 */

export type ThemePreference = "light" | "dark" | "system";

const STORAGE_KEY = "fms.theme";
const DARK_CLASS = "theme-dark";

const media = (): MediaQueryList | null =>
  typeof window === "undefined" ? null : window.matchMedia("(prefers-color-scheme: dark)");

/** The stored preference, or "system" when absent or unreadable. */
export function getPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
  } catch {
    // Private mode, blocked storage: fall through to the system default.
  }
  return "system";
}

/** Whether the given preference resolves to dark right now. */
export function resolvesToDark(preference: ThemePreference): boolean {
  if (preference === "dark") return true;
  if (preference === "light") return false;
  return media()?.matches ?? false;
}

/** Apply a preference to <html> and remember it. */
export function setPreference(preference: ThemePreference): void {
  try {
    if (preference === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // Not fatal: the class still gets applied for this session.
  }
  apply(preference);
}

/** Toggle between light and dark, leaving "system" behind. */
export function toggleTheme(): ThemePreference {
  const next: ThemePreference = resolvesToDark(getPreference()) ? "light" : "dark";
  setPreference(next);
  return next;
}

function apply(preference: ThemePreference): void {
  const root = document.documentElement;
  root.classList.toggle(DARK_CLASS, resolvesToDark(preference));
}

/**
 * Initialise, and keep following the OS while the preference is "system".
 * Returns an unsubscribe function.
 */
export function initTheme(): () => void {
  apply(getPreference());

  const mq = media();
  if (!mq) return () => {};

  const onChange = (): void => {
    if (getPreference() === "system") apply("system");
  };

  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
