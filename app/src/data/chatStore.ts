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

import { collection, doc, getDocs, limit, orderBy, query, setDoc } from "firebase/firestore";

import { firestore } from "./firebase";
import { byOldest, type ChatMessage } from "../domain/chat";

/**
 * How much comes back on open.
 *
 * Enough to pick up where you left off, not so much that opening the screen
 * reads a year of conversation. The rest stays in the database.
 */
const PAGE = 60;

const path = (uid: string): string => `users/${uid}/chat`;

/** A session's messages when there is nowhere to write them. */
const memory: ChatMessage[] = [];

export interface ChatStore {
  record(message: ChatMessage): Promise<void>;
  recent(): Promise<ChatMessage[]>;
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
  };
}
