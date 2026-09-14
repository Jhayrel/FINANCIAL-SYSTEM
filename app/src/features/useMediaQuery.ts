/**
 * Whether a media query matches, kept current.
 *
 * For the decisions CSS cannot make, because they change what is rendered
 * rather than how it looks. A phone has no chat beside the Add form and an AI
 * tab instead, and mounting both and hiding one with CSS would run two
 * conversations against one record.
 */

import { useEffect, useState } from "react";

const supported = (): boolean =>
  typeof window !== "undefined" && typeof window.matchMedia === "function";

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => supported() && window.matchMedia(query).matches);

  useEffect(() => {
    if (!supported()) return;
    const list = window.matchMedia(query);
    const update = (): void => setMatches(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);

  return matches;
}
