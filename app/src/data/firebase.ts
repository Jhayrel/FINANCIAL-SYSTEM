/**
 * Firebase bootstrap.
 *
 * Everything here is optional at runtime. With no configuration from either
 * source (a fresh clone, a test run, a preview build), `isConfigured()` returns
 * false and the app keeps using the browser store. Nothing throws, and no
 * network call is made.
 *
 * Where the configuration comes from is `firebaseConfig.ts`'s problem, not
 * this file's.
 *
 * ── What is safe to put in these variables ────────────────────────────────
 * All of it. The Firebase web `apiKey` is a public project identifier, not a
 * secret: it identifies which project a request is for, and every request is
 * still checked against the security rules and the signed-in user. Hiding it
 * would buy nothing. See CLAUDE.md §2.
 *
 * The AI provider key is a different thing entirely and must never appear
 * here, or anywhere else the browser can read.
 */

import { initializeApp, type FirebaseApp } from "firebase/app";
import { readConfig, readOwnerUid, type ConfigSource } from "./firebaseConfig";
import {
  browserLocalPersistence,
  getAuth,
  setPersistence,
  type Auth,
} from "firebase/auth";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentSingleTabManager,
  type Firestore,
} from "firebase/firestore";

let app: FirebaseApp | null = null;
let db: Firestore | null = null;
let auth: Auth | null = null;

/** True when a project is configured, from either source. Never throws. */
export function isConfigured(): boolean {
  return readConfig().config !== null;
}

/** Where the configuration came from, for the Settings screen. */
export function configSource(): ConfigSource {
  return readConfig().source;
}

/** The owner's uid, mirrored from the security rules. */
export function ownerUid(): string | null {
  return readOwnerUid();
}

function ensureApp(): FirebaseApp {
  const { config } = readConfig();
  if (!config) throw new Error("Firebase is not configured. See docs/06-FIREBASE.md.");
  app ??= initializeApp(config);
  return app;
}

export function firestore(): Firestore {
  if (!db) {
    // The offline cache is what makes this usable on a phone with patchy
    // signal: reads come from disk, writes queue and replay. Single-tab is
    // correct here: one user, one device at a time.
    db = initializeFirestore(ensureApp(), {
      localCache: persistentLocalCache({ tabManager: persistentSingleTabManager({}) }),
    });
  }
  return db;
}

export function authClient(): Auth {
  if (!auth) {
    auth = getAuth(ensureApp());
    // Stay signed in across refreshes. Without this every reload bounces you
    // to the Google prompt, which on a phone is unusable.
    void setPersistence(auth, browserLocalPersistence);
  }
  return auth;
}
