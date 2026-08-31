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
      },
      async recent() {
        return [...memory].sort(byNewest);
      },
    };
  }

  const db = firestore();

  return {
    async record(event) {
      if (!db) return;
      const { id, ...fields } = event;
      const document = Object.fromEntries(
        Object.entries(fields).filter(([, v]) => v !== undefined),
      );
      await setDoc(doc(collection(db, path(uid)), id), document);
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
