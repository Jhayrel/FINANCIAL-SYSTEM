/**
 * Noticing that a newer version of the app has been published.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * The app is one page that never reloads itself. Every push deploys, and a
 * tab opened before it keeps running the bundle it loaded, for days if the
 * tab stays open. On 2026-09-15 the owner reported the phone bar, the Add
 * form and the Activity filters as broken hours after all three had been
 * fixed and deployed: the tab had simply never fetched them, and nothing on
 * screen could say so.
 *
 * So now and then the page asks the server which bundle it would serve, and
 * compares that with the one it is running. Only the hashed file name is
 * compared. Nothing is sent.
 */

import { useEffect, useState } from "react";

/** The hashed entry script a built index.html points at, or null. */
export function bundleOf(html: string): string | null {
  const match = /\/assets\/index-[A-Za-z0-9_-]+\.js/.exec(html);
  return match ? match[0] : null;
}

/** The entry script this page is running. Null on the dev server. */
function runningBundle(): string | null {
  const script = document.querySelector<HTMLScriptElement>(
    'script[type="module"][src*="/assets/index-"]',
  );
  if (!script) return null;
  try {
    return new URL(script.src).pathname;
  } catch {
    return null;
  }
}

/** Often enough to catch a deploy during a session, rare enough to cost nothing. */
const EVERY = 5 * 60 * 1000;

/**
 * Away long enough that coming back is starting again.
 *
 * 27 September 2026, 06:04: the owner's phone was still running the bundle
 * from before a phone layout fix, in a tab left open overnight, and the fix
 * looked like it had not worked. A notice asking to reload is easy to miss
 * on a phone. Coming back to the app after a minute away, with nothing in
 * progress, the new version is simply loaded.
 */
const AWAY_MS = 60 * 1000;

/** Things in progress that a reload would lose: pictures attached, an answer on its way. */
const holds = new Set<string>();

export function holdUpdates(key: string, on: boolean): void {
  if (on) holds.add(key);
  else holds.delete(key);
}

/** Whether coming back to the tab should load the new version now. */
export function reloadOnReturn(awayMs: number, held: number): boolean {
  return awayMs >= AWAY_MS && held === 0;
}

export function useUpdateAvailable(): boolean {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    const running = runningBundle();
    if (!running) return;
    let stopped = false;
    let newer = false;

    const check = async (): Promise<void> => {
      if (stopped || document.visibilityState === "hidden") return;
      try {
        const res = await fetch(`/?fresh=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) return;
        const served = bundleOf(await res.text());
        if (!stopped && served && served !== running) {
          newer = true;
          setAvailable(true);
        }
      } catch {
        // Offline. The next check tries again.
      }
    };

    // Coming back to the tab is exactly when a stale bundle gets used.
    let hiddenAt = 0;
    const onReturn = (): void => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      const away = hiddenAt ? Date.now() - hiddenAt : 0;
      hiddenAt = 0;
      void check().then(() => {
        if (!stopped && newer && reloadOnReturn(away, holds.size)) window.location.reload();
      });
    };

    const timer = window.setInterval(() => void check(), EVERY);
    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("focus", onReturn);
    void check();

    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("focus", onReturn);
    };
  }, []);

  return available;
}
