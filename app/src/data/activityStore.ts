/**
 * Writing and reading the activity log.
 *
 * ── Why this is its own file ──────────────────────────────────────────────
 *
 * `firestoreLedger` is the only writer of money. Keeping the audit trail out
 * of it means the two cannot be confused, and means the audit write can fail
 * without taking a ledger write with it.
 *
 * ── Why a failed write is swallowed ───────────────────────────────────────
 *
 * The alternative is worse. If the audit write throws and that reaches the
 * caller, saving a transaction reports an error for a row that saved fine,
 * and the owner is told their money did not record when it did. So the ledger
 * write is the one that owns the outcome, and a failed event is reported
 * through the sync banner like any other background problem.
 *
 * The direction to fail in is the one where the ledger is right, because the
 * ledger is the thing that has to be right.
 *
 * ── Local mode ────────────────────────────────────────────────────────────
 *
 * Without a signed-in owner there is no Firestore, and the log lives in
 * memory for the session. That keeps the screen working in the local harness
 * and in the fixture, where there is nothing to write to.
 */

import { collection, doc, getDocs, limit, orderBy, query, setDoc } from "firebase/firestore";

import { firestore } from "./firebase";
import { byNewest, type ActivityEvent } from "../domain/activity";

/** Enough to scroll through without paging, small enough to read in one go. */
const PAGE = 300;

const path = (uid: string): string => `users/${uid}/activity`;

/**
 * A session's events when there is nowhere to write them.
 *
 * Deliberately not persisted: a local-mode audit trail that survived a reload
 * would look like the real thing without being backed by the append-only rule
 * that makes the real thing trustworthy.
 */
const memory: ActivityEvent[] = [];

export interface ActivityStore {
  record(event: ActivityEvent): Promise<void>;
  recent(): Promise<ActivityEvent[]>;
}

export function activityStore(uid: string | null): ActivityStore {
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
      // Undefined is rejected by Firestore, and the optional fields on an
      // event are genuinely absent rather than empty.
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
      return snapshot.docs
        .map((d) => ({ id: d.id, ...d.data() }) as ActivityEvent)
        .sort(byNewest);
    },
  };
}
