/**
 * Every document of a log, newest first, read a page at a time.
 *
 * A backup took each log's `recent()`, the newest 300 to 400 documents, so
 * every backup since the logs began was missing their older history: the 1
 * November 2026 backup's activity trail started on 26 September, five weeks
 * after the app did (3 November 2026 review). A backup is the whole system
 * (docs/08-YEARS-AND-BACKUP.md, Y2), its records of what happened included.
 *
 * Read only for a backup, which the owner asks for: one read per document,
 * the same as opening each log screen enough times to see it all.
 */
import { collection, getDocs, limit, orderBy, query, startAfter, type DocumentData, type Firestore, type Query, type QueryDocumentSnapshot, type QuerySnapshot } from "firebase/firestore";

/** Enough per page to be few round trips; well under what one read may return. */
const PAGE = 1000;
/** A ceiling, so a log grown past anything expected cannot hold a backup open for ever. */
const MOST = 100_000;

export async function readAllNewestFirst(db: Firestore, path: string): Promise<{ readonly id: string; readonly data: DocumentData }[]> {
  const out: { id: string; data: DocumentData }[] = [];
  let last: QueryDocumentSnapshot | null = null;
  for (;;) {
    const page: Query = last
      ? query(collection(db, path), orderBy("at", "desc"), startAfter(last), limit(PAGE))
      : query(collection(db, path), orderBy("at", "desc"), limit(PAGE));
    const snapshot: QuerySnapshot = await getDocs(page);
    for (const d of snapshot.docs) out.push({ id: d.id, data: d.data() });
    if (snapshot.docs.length < PAGE || out.length >= MOST) return out;
    last = snapshot.docs[snapshot.docs.length - 1] ?? null;
    if (!last) return out;
  }
}
