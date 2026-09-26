/**
 * Writing and reading the conversation.
 *
 * Mirrors `activityStore` deliberately: same shape, same failure posture, same
 * in-memory fallback when there is no session. Two stores that behave the same
 * way are one thing to understand rather than two.
 *
 * A failed write is swallowed for the same reason it is there: the answer is
 * already on screen, and telling someone their question failed because a
 * record of it failed would be reporting the wrong problem.
 */

import { collection, doc, getDocs, getDocsFromCache, limit, orderBy, query, setDoc } from "firebase/firestore";

import { firestore } from "./firebase";
import { byOldest, type ChatMessage } from "../domain/chat";

/**
 * How much comes back on open.
 *
 * Enough to pick up where you left off, not so much that opening the screen
 * reads a year of conversation. The rest stays in the database.
 *
 * ── Why 60 was not enough ─────────────────────────────────────────────────
 *
 * A card writes a message when it appears and another every time it
 * changes, so one entry offered, corrected and added is three or four
 * messages, and a statement read into eight cards is thirty. Sixty messages
 * was often a dozen turns, and everything older than that was simply not on
 * screen after a refresh: the owner's "some part is disappearing", 26
 * September 2026. One person's conversation at this size is a few hundred
 * small documents, which is a trivial read.
 */
const PAGE = 400;

const path = (uid: string): string => `users/${uid}/chat`;

/** A session's messages when there is nowhere to write them. */
const memory: ChatMessage[] = [];

export interface ChatStore {
  record(message: ChatMessage): Promise<void>;
  recent(): Promise<ChatMessage[]>;
  /**
   * What this device already holds, without asking the server. Empty when
   * nothing is cached. Shown first, so the thread is there the moment the
   * screen opens; `recent` then brings anything newer.
   */
  cached(): Promise<ChatMessage[]>;
}

export function chatStore(uid: string | null): ChatStore {
  if (!uid) {
    return {
      async record(message) {
        memory.push(message);
        if (memory.length > PAGE) memory.splice(0, memory.length - PAGE);
      },
      async recent() {
        return [...memory].sort(byOldest);
      },
      async cached() {
        return [...memory].sort(byOldest);
      },
    };
  }

  const db = firestore();

  return {
    async record(message) {
      if (!db) return;
      const { id, ...fields } = message;
      // Firestore rejects undefined, and `from` is genuinely absent on your
      // own messages rather than empty.
      const document = Object.fromEntries(
        Object.entries(fields).filter(([, v]) => v !== undefined),
      );
      await setDoc(doc(collection(db, path(uid)), id), document);
    },

    async recent() {
      if (!db) return [];
      // Newest first from the database, because that is what an index can do
      // cheaply, then flipped: a conversation reads oldest first.
      const snapshot = await getDocs(
        query(collection(db, path(uid)), orderBy("at", "desc"), limit(PAGE)),
      );
      return snapshot.docs
        .map((d) => ({ id: d.id, ...d.data() }) as ChatMessage)
        .sort(byOldest);
    },

    async cached() {
      if (!db) return [];
      try {
        const snapshot = await getDocsFromCache(
          query(collection(db, path(uid)), orderBy("at", "desc"), limit(PAGE)),
        );
        return snapshot.docs
          .map((d) => ({ id: d.id, ...d.data() }) as ChatMessage)
          .sort(byOldest);
      } catch {
        return [];
      }
    },
  };
}
