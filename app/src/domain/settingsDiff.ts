/**
 * The sections of settings that changed.
 *
 * Settings were saved as one document. With the phone and the laptop both
 * open, renaming an account on one while changing the low balance warning on
 * the other wrote the second device's whole copy, old account name and all,
 * over the first device's change. Saving only the sections that changed lets
 * edits to different sections on two devices both survive. Two devices
 * changing the same section at the same moment still keep the later one.
 *
 * Compared as JSON, so a section rebuilt with the same content is not a change.
 */

import type { AppSettings } from "./settings";

export function changedSections(before: AppSettings, after: AppSettings): Partial<AppSettings> {
  const out: Partial<Record<keyof AppSettings, unknown>> = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]) as Set<keyof AppSettings>;
  for (const key of keys) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) out[key] = after[key];
  }
  return out as Partial<AppSettings>;
}
