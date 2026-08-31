/**
 * Writing and reading what the assistant did.
 *
 * The third store, and deliberately the same shape as the other two: append
 * only, a failure that cannot reach the caller, and an in-memory fallback
 * when there is no session. Three stores behaving identically are one thing
 * to understand.
 *
 * Nothing here holds a picture. `domain/aiLog.ts` writes a description of a
 * file and never its bytes, so this collection stays small enough to read
 * whole.
 */

import { collection, doc, getDocs, limit, orderBy, query, setDoc } from "firebase/firestore";

import { firestore } from "./firebase";
import { byNewest, type AiEvent } from "../domain/aiLog";

/** Enough to learn from and to scan. The rest stays in the database. */
const PAGE = 400;

const path = (uid: string): string => `users/${uid}/ai`;

const memory: AiEvent[] = [];

/**
 * Whether the last write actually landed, and why it did not.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * Every caller writes this log the same way: `record(event).catch(() => {})`.
 * That is deliberate and stays. A ledger write that succeeded must not report
 * an error because its audit entry did not, or the owner is told their money
 * did not save when it did.
 *
 * But swallowed silently, the whole thing became unanswerable. "Is the
 * assistant saving to the database?" had no way to be checked from inside the
 * app: a denied write and a successful one looked identical, and the panel
 * that shows the history reads from the same store, so it showed the same
 * numbers either way.
 *
 * So the failure is still swallowed, and now it is also recorded. Settings
 * asks `aiLogHealth()` and says so on screen. Nothing here throws.
 */
let lastFailure: string | null = null;
let writes = 0;
let failures = 0;

export interface AiLogHealth {
  /** Where the writes are going. */
  readonly target: "firestore" | "this browser only";
  readonly writes: number;
  readonly failures: number;
  /** The most recent failure, in words worth showing. */
  readonly lastFailure: string | null;
}

export function aiLogHealth(uid: string | null): AiLogHealth {
  return {
    target: uid ? "firestore" : "this browser only",
    writes,
    failures,
    lastFailure,
  };
}

/** Denied is the one worth naming: it has a fix, and the fix is one command. */
const explain = (e: unknown): string => {
  const why = e instanceof Error ? e.message : String(e);
  return /permission|insufficient/i.test(why)
    ? "Denied by the database rules. They are not deployed yet: npx firebase deploy --only firestore:rules"
    : why;
};

export interface AiLogStore {
  record(event: AiEvent): Promise<void>;
  recent(): Promise<AiEvent[]>;
}

export function aiLogStore(uid: string | null): AiLogStore {
  if (!uid) {
    return {
      async record(event) {
        memory.unshift(event);
        memory.splice(PAGE);
        writes += 1;
      },
      async recent() {
        return [...memory].sort(byNewest);
      },
    };
  }

  const db = firestore();

  return {
    async record(event) {
      if (!db) {
        failures += 1;
        lastFailure = "Firebase is not configured in this build.";
        return;
      }
      const { id, ...fields } = event;
      const document = Object.fromEntries(
        Object.entries(fields).filter(([, v]) => v !== undefined),
      );
      try {
        await setDoc(doc(collection(db, path(uid)), id), document);
        writes += 1;
        lastFailure = null;
      } catch (e) {
        /**
         * Recorded, then rethrown.
         *
         * The caller still swallows it, which is right: an audit entry that
         * did not save must not make a saved transaction look unsaved. This
         * only makes sure the failure is knowable afterwards instead of
         * vanishing between the two.
         */
        failures += 1;
        lastFailure = explain(e);
        throw e;
      }
    },

    async recent() {
      if (!db) return [];
      const snapshot = await getDocs(
        query(collection(db, path(uid)), orderBy("at", "desc"), limit(PAGE)),
      );
      return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as AiEvent).sort(byNewest);
    },
  };
}
