/**
 * Whether an AI surface exists at all.
 *
 * Off means gone, not greyed out. On 2026-09-15 the owner asked that turning
 * AI off in Settings removes every assistant surface: the chat beside the Add
 * form, the floating chat on a computer, the AI tab on a phone, and the AI
 * cards on the Dashboard and Insights. Those used to stay on screen and answer
 * from this device, which read as though the AI were still on.
 *
 * A surface nobody has switched either way counts as on, the same reading
 * `useAi` makes: `chat` and `capture` were added after settings shipped, and
 * reading their absence as "off" switched the chat off for everyone.
 */

import type { AiSettings } from "./settings";

export type AiSurface = keyof AiSettings["features"];

export function aiSurfaceOn(ai: AiSettings, surface: AiSurface): boolean {
  return ai.enabled && ai.features[surface] !== false;
}
