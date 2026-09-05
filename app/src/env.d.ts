/// <reference types="vite/client" />

/**
 * Build-time configuration.
 *
 * Every one of these is embedded in the bundle and therefore public. Nothing
 * secret may be added here: see CLAUDE.md §2. The AI provider key lives in a
 * Cloudflare environment secret and is read by a server function, never by
 * this bundle.
 *
 * All are optional: with none of them set, the app runs on browser storage.
 */
interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET?: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
  readonly VITE_OWNER_UID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/**
 * Which commit this bundle was built from, and when.
 *
 * Replaced at build time by Vite (`define` in vite.config.ts), so it is a
 * fact about the running bundle rather than something read at runtime and
 * possibly stale. Coderview prints both, so an export answers "is the fix
 * actually deployed" without guessing.
 *
 * "unknown" when the build had neither a Pages commit nor a git checkout.
 */
declare const __BUILD_COMMIT__: string;
declare const __BUILD_AT__: string;
