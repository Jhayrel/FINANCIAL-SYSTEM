/**
 * Where the Firebase configuration comes from.
 *
 * Two sources, checked in order:
 *
 *   1. `VITE_FIREBASE_*` build variables. This is what the deployed site uses,
 *      set in Cloudflare, and what a fresh clone should use.
 *   2. A config pasted into Settings and kept in this browser. This exists so
 *      connecting does not require editing a file and restarting a dev server.
 *
 * ── Why pasting it into the app is safe ───────────────────────────────────
 *
 * Every value here is public. The Firebase web `apiKey` is a project
 * identifier, not a credential: it says which project a request belongs to,
 * and the request is still checked against the security rules and the
 * signed-in uid. It appears in the JavaScript bundle of every Firebase web app
 * ever shipped. See CLAUDE.md §2.
 *
 * The AI provider key is the opposite of this and must never be stored
 * anywhere the browser can read. `assertNoSecrets` guards that separately.
 */

export interface FirebaseConfig {
  readonly apiKey: string;
  readonly authDomain: string;
  readonly projectId: string;
  readonly storageBucket: string;
  readonly messagingSenderId: string;
  readonly appId: string;
}

export type ConfigSource = "environment" | "browser" | "none";

const STORAGE_KEY = "fms.firebase";
const OWNER_KEY = "fms.owner";

const FIELDS: (keyof FirebaseConfig)[] = [
  "apiKey",
  "authDomain",
  "projectId",
  "storageBucket",
  "messagingSenderId",
  "appId",
];

function fromEnvironment(): FirebaseConfig | null {
  const e = import.meta.env;
  const cfg = {
    apiKey: e.VITE_FIREBASE_API_KEY,
    authDomain: e.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: e.VITE_FIREBASE_PROJECT_ID,
    storageBucket: e.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: e.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: e.VITE_FIREBASE_APP_ID,
  };
  // All or nothing. A half-filled config fails deep inside the SDK with a
  // message that explains nothing.
  return FIELDS.every((f) => typeof cfg[f] === "string" && cfg[f]!.length > 0)
    ? (cfg as FirebaseConfig)
    : null;
}

function fromBrowser(): FirebaseConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FirebaseConfig>;
    return FIELDS.every((f) => typeof parsed[f] === "string" && parsed[f]!.length > 0)
      ? (parsed as FirebaseConfig)
      : null;
  } catch {
    return null;
  }
}

export function readConfig(): { config: FirebaseConfig | null; source: ConfigSource } {
  const env = fromEnvironment();
  if (env) return { config: env, source: "environment" };

  const browser = fromBrowser();
  if (browser) return { config: browser, source: "browser" };

  return { config: null, source: "none" };
}

export function saveConfig(config: FirebaseConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export function clearConfig(): void {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(OWNER_KEY);
}

/** The owner's uid: from the build variable, or from what was pasted here. */
export function readOwnerUid(): string | null {
  const fromEnv = import.meta.env.VITE_OWNER_UID;
  if (typeof fromEnv === "string" && fromEnv.length > 0) return fromEnv;
  try {
    return localStorage.getItem(OWNER_KEY) || null;
  } catch {
    return null;
  }
}

export function saveOwnerUid(uid: string): void {
  localStorage.setItem(OWNER_KEY, uid.trim());
}

/**
 * Accept what the Firebase console actually gives you.
 *
 * The console shows a JavaScript snippet, not JSON: unquoted keys, trailing
 * commas, a `const firebaseConfig =` in front. Asking someone to reformat that
 * by hand is asking them to make a typo, so this takes the snippet as-is.
 */
export function parseConfig(input: string): { config?: FirebaseConfig; error?: string } {
  const text = input.trim();
  if (!text) return { error: "Paste the config from the Firebase console first." };

  // Grab each field by name, so anything wrapped around them is irrelevant.
  const found: Record<string, string> = {};
  for (const field of FIELDS) {
    const match = new RegExp(`["']?${field}["']?\\s*:\\s*["']([^"']+)["']`).exec(text);
    if (match?.[1]) found[field] = match[1];
  }

  const missing = FIELDS.filter((f) => !found[f]);
  if (missing.length === FIELDS.length) {
    return {
      error:
        "That does not look like a Firebase config. Copy the whole block from Project settings, Your apps, SDK setup and configuration.",
    };
  }
  if (missing.length > 0) {
    return { error: `Missing from the config: ${missing.join(", ")}.` };
  }

  return { config: found as unknown as FirebaseConfig };
}
