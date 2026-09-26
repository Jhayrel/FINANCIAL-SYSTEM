/**
 * The phone's Back button, inside the app.
 *
 * The owner, 27 September 2026: "when I click back button it closes the whole
 * app". Every screen change replaced the page in place, so the browser's
 * history held one entry and Back left the site. Now each screen visited is
 * an entry, and so is each overlay while it is open: Back closes the menu,
 * the list or the picture on top first, then steps back through the screens,
 * and leaves the app only from the first one.
 *
 * One `popstate` listener for the whole app, so an overlay and the screens
 * never both answer the same press.
 */

import { useEffect, useRef } from "react";

interface Overlay {
  readonly token: string;
  readonly close: () => void;
}

/** Open overlays, newest last: Back closes the last. */
const overlays: Overlay[] = [];
/** Backs this module started itself, to take an overlay's entry away quietly. */
let ignoring = 0;
/** A screen to record once those have happened, so it is not undone by them. */
let queued: string | null = null;
let onScreen: ((screen: string) => void) | null = null;
let installed = false;

type Entry = { readonly fms?: string; readonly overlay?: string } | null;
const current = (): Entry => (typeof window === "undefined" ? null : (window.history.state as Entry));

function install(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("popstate", (e) => {
    if (ignoring > 0) {
      ignoring -= 1;
      if (ignoring === 0 && queued) {
        const next = queued;
        queued = null;
        push(next);
      }
      return;
    }
    const top = overlays.pop();
    if (top) {
      top.close();
      return;
    }
    const screen = (e.state as Entry)?.fms;
    if (screen && onScreen) onScreen(screen);
  });
}

function push(screen: string): void {
  if (ignoring > 0) {
    queued = screen;
    return;
  }
  const state = current();
  if (!state?.fms) window.history.replaceState({ fms: screen }, "");
  else if (state.fms !== screen || state.overlay) window.history.pushState({ fms: screen }, "");
}

/**
 * Screens as history: record each one shown, and go to the one Back lands on.
 *
 * `show` is how the app changes screen; it is called for Back only, and the
 * screen it shows is not recorded again.
 */
export function useScreenHistory(screen: string, show: (screen: string) => void): void {
  const showRef = useRef(show);
  showRef.current = show;
  const cameBack = useRef(false);

  useEffect(() => {
    install();
    onScreen = (s) => {
      cameBack.current = true;
      showRef.current(s);
    };
    return () => {
      onScreen = null;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (cameBack.current) {
      cameBack.current = false;
      return;
    }
    push(screen);
  }, [screen]);
}

/**
 * An overlay Back can close: a menu, a list, a picture, a sheet.
 *
 * While `open`, it holds a history entry; Back takes the entry and calls
 * `close`. Closed any other way (its own X, a tap outside), the entry is
 * taken back off so the next Back does what it looks like it should.
 */
export function useBackToClose(open: boolean, close: () => void): void {
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    install();
    const token = Math.random().toString(36).slice(2);
    const entry: Overlay = { token, close: () => closeRef.current() };
    overlays.push(entry);
    window.history.pushState({ ...(current() ?? {}), overlay: token }, "");

    return () => {
      const at = overlays.indexOf(entry);
      if (at === -1) return; // Back closed it: its entry is already gone.
      overlays.splice(at, 1);
      if (current()?.overlay === token) {
        ignoring += 1;
        window.history.back();
      }
    };
  }, [open]);
}
