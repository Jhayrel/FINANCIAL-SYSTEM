/**
 * Settings persistence.
 *
 * One interface, two implementations. Today the browser store keeps your
 * settings across refreshes; Phase 5 adds the Firestore one and swaps a single
 * line in `App.tsx`. Nothing above this file changes.
 */

import {
  assertNoSecrets,
  defaultSettings,
  normaliseSettings,
  type AppSettings,
} from "../domain/settings";

export interface SettingsStore {
  readonly name: string;
  load(): Promise<AppSettings>;
  save(settings: AppSettings): Promise<void>;
  /** Notifies on changes from elsewhere (another tab, another device). */
  subscribe?(onChange: (settings: AppSettings) => void): () => void;
}

const STORAGE_KEY = "fms.settings";

/**
 * Browser-local store.
 *
 * Survives refreshes but lives on one device. `subscribe` picks up edits made
 * in another tab, which is the only cross-context sync a local store can
 * honestly offer.
 */
export function browserSettingsStore(): SettingsStore {
  return {
    name: "This browser",

    async load() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? normaliseSettings(JSON.parse(raw)) : defaultSettings();
      } catch {
        // Blocked storage, private mode, or corrupt JSON, start clean rather
        // than leaving the app unusable.
        return defaultSettings();
      }
    },

    async save(settings) {
      assertNoSecrets(settings);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      } catch {
        // Quota or private mode. The in-memory state is still correct, so the
        // session works; it just will not survive a refresh.
      }
    },

    subscribe(onChange) {
      const handler = (e: StorageEvent): void => {
        if (e.key !== STORAGE_KEY || !e.newValue) return;
        try {
          onChange(normaliseSettings(JSON.parse(e.newValue)));
        } catch {
          // Ignore a malformed write from another tab.
        }
      };

      window.addEventListener("storage", handler);
      return () => window.removeEventListener("storage", handler);
    },
  };
}

/**
 * The Firestore implementation lives in `firestoreLedger.ts`, next to the
 * ledger it shares a database with. Import it from there:
 *
 *   import { firestoreSettingsStore } from "./firestoreLedger";
 */
