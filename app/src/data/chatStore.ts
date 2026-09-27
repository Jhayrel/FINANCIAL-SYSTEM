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

import { collection, doc, getDocs, getDocsFromCache, limit, onSnapshot, orderBy, query, setDoc, where } from "firebase/firestore";

import { firestore } from "./firebase";
import { countReads, noteError } from "./usage";
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

/** Messages this page wrote, so the live listener can tell another device's from its own. */
const writtenHere = new Set<string>();

/*
 * Read from the server once a session, not every time a panel opens.
 *
 * Each chat panel read the last 400 messages when it mounted, and its live
 * listener read the same 400 again, so opening Add or the assistant cost
 * 800 reads every time, and the free allowance is 50,000 a day (the owner
 * reached 48,000 on 28 September 2026). The first read of a session goes to
 * the server; after that the copy on the device is read, which is free, and
 * the listener brings only messages newer than the session.
 */
const readThisSession = new Set<string>();
/** Five minutes back, for a device whose clock runs behind. */
const SESSION_FROM = new Date(Date.now() - 5 * 60 * 1000).toISOString();

export interface ChatStore {
  record(message: ChatMessage): Promise<void>;
  recent(): Promise<ChatMessage[]>;
  /**
   * What this device already holds, without asking the server. Empty when
   * nothing is cached. Shown first, so the thread is there the moment the
   * screen opens; `recent` then brings anything newer.
   */
  cached(): Promise<ChatMessage[]>;
  /**
   * The conversation as it changes on another device: the phone sees what
   * was said on the PC as it is said (the owner, 27 September 2026: "sync it
   * live to my phone and it should work live and fast"). Called with the
   * whole recent conversation whenever a message this page did not write
   * arrives from the server. Returns the way to stop listening.
   */
  watch(onRemote: (all: ChatMessage[]) => void): () => void;
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
      watch() {
        return () => {};
      },
    };
  }

  const db = firestore();

  return {
    async record(message) {
      if (!db) return;
      const { id, ...fields } = message;
      writtenHere.add(id);
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
      const newest = query(collection(db, path(uid)), orderBy("at", "desc"), limit(PAGE));
      if (readThisSession.has(uid)) {
        try {
          const cached = await getDocsFromCache(newest);
          if (cached.size > 0) return cached.docs.map((d) => ({ id: d.id, ...d.data() }) as ChatMessage).sort(byOldest);
        } catch {
          // Nothing cached after all: ask the server below.
        }
      }
      try {
        const snapshot = await getDocs(newest);
        if (!snapshot.metadata.fromCache) {
          countReads(snapshot.size);
          readThisSession.add(uid);
        }
        return snapshot.docs
          .map((d) => ({ id: d.id, ...d.data() }) as ChatMessage)
          .sort(byOldest);
      } catch (e) {
        noteError(e, "reads");
        throw e;
      }
    },

    watch(onRemote) {
      if (!db) return () => {};
      /*
       * The first answer from the server is what `recent` already showed;
       * after that, a message added that this page did not write is another
       * device's, and the conversation is handed over whole.
       */
      /*
       * Only what is said from now on: the conversation up to now is what
       * `recent` read. A message another device adds lands in the copy on
       * this device, and the whole recent conversation is then read from
       * that copy, which is free.
       */
      let first = true;
      return onSnapshot(
        query(collection(db, path(uid)), where("at", ">", SESSION_FROM), orderBy("at", "asc")),
        (snapshot) => {
          if (snapshot.metadata.fromCache) return;
          countReads(first ? snapshot.size : snapshot.docChanges().length);
          first = false;
          const remote = snapshot
            .docChanges()
            .some((c) => c.type === "added" && !writtenHere.has(c.doc.id) && !c.doc.metadata.hasPendingWrites);
          if (!remote) return;
          void getDocsFromCache(query(collection(db, path(uid)), orderBy("at", "desc"), limit(PAGE)))
            .then((all) => onRemote(all.docs.map((d) => ({ id: d.id, ...d.data() }) as ChatMessage).sort(byOldest)))
            .catch(() => {});
        },
        (e) => noteError(e, "reads"),
      );
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
