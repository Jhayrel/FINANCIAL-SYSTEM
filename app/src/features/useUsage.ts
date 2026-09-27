/**
 * Today's Firestore use on this device, kept current (`data/usage.ts`).
 *
 * Re-read on every count, and on focus and every minute, so a day that
 * turns over at midnight Pacific while the app is open starts again at zero.
 */

import { useEffect, useState } from "react";

import { onUsage, usageToday, type Usage } from "../data/usage";

export function useUsage(): Usage {
  const [usage, setUsage] = useState<Usage>(() => usageToday());
  useEffect(() => {
    const again = (): void => setUsage(usageToday());
    const stop = onUsage(setUsage);
    const timer = window.setInterval(again, 60_000);
    window.addEventListener("focus", again);
    return () => {
      stop();
      window.clearInterval(timer);
      window.removeEventListener("focus", again);
    };
  }, []);
  return usage;
}
