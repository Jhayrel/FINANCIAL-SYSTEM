/**
 * Firestore ledger.
 *
 * Layout: everything under one user document, so the security rules can be a
 * single `isOwner(uid)` check and nothing is shared by construction:
 *
 *   users/{uid}/transactions/{id}   one row per ledger entry
 *   users/{uid}/meta/settings       accounts, goals, categories, AI, theme
 *   users/{uid}/budgets/{year}      twelve amounts per track
 *
 * Credit lines and loans are NOT a collection. They live inside the settings
 * document as `settings.credits`, because the app always reads the whole short
 * list at once.
 *
 * ── Deletion ──────────────────────────────────────────────────────────────
 * There is no delete. Binning a transaction writes `deletedAt`; restoring
 * clears it. The rules deny `delete` outright, so a bug here cannot lose a
 * money record even if it tries (CLAUDE.md §4).
 *
 * ── Money ─────────────────────────────────────────────────────────────────
 * Integer centavos, stored as Firestore numbers. A double holds every integer
 * up to 2^53 exactly; ₱90 trillion in centavos is nowhere near that, so there
 * is no precision risk. The rules reject a non-integer, so a float can never
 * settle into the database even from a hand edit in the console.
 */

import {
  collection,
  deleteField,
  doc,
  getDoc,
  getDocFromCache,
  onSnapshot,
  setDoc,
  writeBatch,
  type DocumentData,
  type Firestore,
  type QueryDocumentSnapshot,
} from "firebase/firestore";

import { firestore } from "./firebase";
import { assertNoSecrets, normaliseSettings, type AppSettings } from "../domain/settings";
import type { SettingsStore } from "./settingsStore";
import type {
  Budgets,
  BudgetYear,
  DeletedTransaction,
  MonthlyAmounts,
  Transaction,
} from "../domain/types";

/**
 * Rows the database refused, after everything it would take was saved.
 *
 * A refused row fails the whole batch it is written in, so one row the rules
 * do not know took its neighbours with it. The batch is retried a row at a
 * time and only the refused ones come back here, for the app to keep and
 * offer again (`domain/unsaved.ts`).
 */
export class RowsNotSaved extends Error {
  constructor(
    readonly rows: readonly Transaction[],
    reason: string,
  ) {
    super(reason);
    this.name = "RowsNotSaved";
  }
}

const reasonOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// ── Paths ──────────────────────────────────────────────────────────────────

const userRoot = (uid: string): string => `users/${uid}`;

const txCollection = (db: Firestore, uid: string) =>
  collection(db, `${userRoot(uid)}/transactions`);

const settingsDoc = (db: Firestore, uid: string) =>
  doc(db, `${userRoot(uid)}/meta/settings`);

const budgetDoc = (db: Firestore, uid: string, year: string) =>
  doc(db, `${userRoot(uid)}/budgets/${year}`);

// ── Serialisation ──────────────────────────────────────────────────────────

/**
 * Firestore rejects `undefined`. The domain uses optional fields, so they are
 * dropped rather than written as null: an absent field and a null field would
 * otherwise mean the same thing in two different ways.
 */
export function toDocument(t: Transaction, deletedAt?: string): DocumentData {
  const d: DocumentData = {
    recordNumber: t.recordNumber,
    date: t.date,
    type: t.type,
    fromWallet: t.fromWallet,
    toWallet: t.toWallet,
    category: t.category,
    item: t.item,
    description: t.description,
    amount: t.amount,
    fee: t.fee,
    total: t.total,
    notes: t.notes,
    status: t.status,
  };
  if (t.debtId !== undefined) d.debtId = t.debtId;
  if (t.debtEffect !== undefined) d.debtEffect = t.debtEffect;
  if (t.partOf !== undefined) d.partOf = t.partOf;
  if (t.reviewed !== undefined) d.reviewed = t.reviewed;
  /*
   * Who filled the row in. It was stamped on every save and never written,
   * so after a refresh every row read as typed: the Database lost its AI
   * marks, and a correction to a row the assistant entered taught it nothing,
   * because `manualCorrections` only learns from rows marked "ai".
   */
  /*
   * Only the two values the field and the rules take. A row carrying anything
   * else ("owner", from the bug that refused every hand-typed row, or a bad
   * import) is written without it rather than refused whole: the provenance
   * is worth less than the money record.
   */
  if (t.entrySource === "manual" || t.entrySource === "ai") d.entrySource = t.entrySource;
  if (deletedAt !== undefined) d.deletedAt = deletedAt;
  return d;
}

function fromDocument(snap: QueryDocumentSnapshot<DocumentData>): Transaction & {
  deletedAt?: string;
  discardedAt?: string;
} {
  const d = snap.data();
  return {
    id: snap.id,
    recordNumber: Number(d.recordNumber ?? 0),
    date: String(d.date ?? ""),
    type: d.type,
    fromWallet: String(d.fromWallet ?? ""),
    toWallet: String(d.toWallet ?? ""),
    category: d.category ?? "",
    item: String(d.item ?? ""),
    description: String(d.description ?? ""),
    amount: Number(d.amount ?? 0),
    fee: Number(d.fee ?? 0),
    total: Number(d.total ?? 0),
    notes: String(d.notes ?? ""),
    status: d.status ?? "",
    ...(d.debtId !== undefined ? { debtId: String(d.debtId) } : {}),
    ...(d.debtEffect !== undefined ? { debtEffect: d.debtEffect } : {}),
    ...(typeof d.partOf === "string" && d.partOf.length > 0 ? { partOf: d.partOf } : {}),
    ...(d.reviewed !== undefined ? { reviewed: Boolean(d.reviewed) } : {}),
    ...(d.entrySource === "ai" || d.entrySource === "manual" ? { entrySource: d.entrySource } : {}),
    ...(typeof d.deletedAt === "string" && d.deletedAt.length > 0
      ? { deletedAt: d.deletedAt }
      : {}),
    ...(typeof d.discardedAt === "string" && d.discardedAt.length > 0
      ? { discardedAt: d.discardedAt }
      : {}),
  };
}

// ── Ledger ─────────────────────────────────────────────────────────────────

export interface LedgerSnapshot {
  readonly transactions: readonly Transaction[];
  readonly deleted: readonly DeletedTransaction[];
}

export interface LedgerStore {
  /**
   * Live subscription. Fires immediately with what the offline cache holds,
   * then again on every change: including ones made on another device.
   */
  subscribe(onChange: (snap: LedgerSnapshot) => void, onError: (e: Error) => void): () => void;
  save(t: Transaction): Promise<void>;
  /** Soft delete. The row stays; `deletedAt` moves it to the Bin. */
  bin(id: string, at: string): Promise<void>;
  restore(id: string): Promise<void>;
  /** One atomic write for a whole-ledger rewrite (a rename, a migration). */
  saveMany(transactions: readonly Transaction[]): Promise<void>;
  /**
   * Start clean from a file (`planStartClean`): write its rows as live, its
   * bin as binned, and mark every other document `discardedAt`. Nothing is
   * deleted; the rules refuse that. Resolves with how many documents the
   * rules would not let this mark, which stay where they were.
   */
  startClean(
    live: readonly Transaction[],
    binned: readonly DeletedTransaction[],
    discard: readonly string[],
    at: string,
    onProgress?: (done: number, total: number) => void,
  ): Promise<{ readonly notDiscarded: number }>;
}

export function firestoreLedger(uid: string): LedgerStore {
  const db = firestore();

  return {
    subscribe(onChange, onError) {
      return onSnapshot(
        txCollection(db, uid),
        (qs) => {
          const live: Transaction[] = [];
          const binned: DeletedTransaction[] = [];

          for (const snap of qs.docs) {
            const row = fromDocument(snap);
            // Set aside by starting clean: kept in the database, shown nowhere.
            if (row.discardedAt) continue;
            if (row.deletedAt) {
              const { discardedAt: _gone, ...rest } = row;
              binned.push({ ...rest, deletedAt: row.deletedAt });
            } else {
              const { deletedAt: _drop, discardedAt: _gone, ...rest } = row;
              live.push(rest);
            }
          }

          // The ledger is displayed and totalled in date order everywhere, so
          // sort once here rather than at each of the dozen call sites.
          live.sort(byDateThenRecord);
          binned.sort(byDateThenRecord);
          onChange({ transactions: live, deleted: binned });
        },
        (e) => onError(e as Error),
      );
    },

    async save(t) {
      try {
        await setDoc(doc(txCollection(db, uid), t.id), toDocument(t), { merge: true });
      } catch (e) {
        throw new RowsNotSaved([t], reasonOf(e));
      }
    },

    async bin(id, at) {
      await setDoc(doc(txCollection(db, uid), id), { deletedAt: at }, { merge: true });
    },

    async restore(id) {
      // deleteField, not an empty string: the rules read "deletedAt present"
      // as binned, and "" would still be present.
      await setDoc(doc(txCollection(db, uid), id), { deletedAt: deleteField() }, { merge: true });
    },

    async saveMany(transactions) {
      // Firestore caps a batch at 500 writes. A rename touching 440 rows fits
      // in one; the chunking is here so it still works when it does not.
      const refused: Transaction[] = [];
      let reason = "";
      for (let i = 0; i < transactions.length; i += 450) {
        const chunk = transactions.slice(i, i + 450);
        const batch = writeBatch(db);
        for (const t of chunk) {
          batch.set(doc(txCollection(db, uid), t.id), toDocument(t), { merge: true });
        }
        try {
          await batch.commit();
        } catch (e) {
          reason = reasonOf(e);
          // One at a time, so a row the rules refuse loses only itself.
          if (chunk.length === 1) {
            refused.push(...chunk);
            continue;
          }
          for (const t of chunk) {
            try {
              await setDoc(doc(txCollection(db, uid), t.id), toDocument(t), { merge: true });
            } catch (one) {
              reason = reasonOf(one);
              refused.push(t);
            }
          }
        }
      }
      if (refused.length > 0) throw new RowsNotSaved(refused, reason);
    },

    async startClean(live, binned, discard, at, onProgress) {
      type Write = { id: string; data: DocumentData; row?: Transaction };
      /*
       * The test rows go first. The owner's first run wrote 900 of 3,070
       * rows and stopped, and since the clearing came last, every test row
       * and the whole Bin were still on screen. Cleared first, whatever is
       * interrupted, the test data is gone, and running it again adds the
       * rest.
       */
      const writes: Write[] = [
        ...discard.map((id) => ({ id, data: { discardedAt: at } })),
        // A document reused from the Bin or from an earlier discard comes back live.
        ...live.map((t) => ({ id: t.id, data: { ...toDocument(t), deletedAt: deleteField(), discardedAt: deleteField() }, row: t })),
        ...binned.map((t) => ({ id: t.id, data: { ...toDocument(t, t.deletedAt), discardedAt: deleteField() }, row: t })),
      ];
      let done = 0;
      onProgress?.(0, writes.length);

      const refused: Transaction[] = [];
      let notDiscarded = 0;
      let reason = "";
      const one = async (w: Write): Promise<void> => {
        try {
          await setDoc(doc(txCollection(db, uid), w.id), w.data, { merge: true });
        } catch (e) {
          reason = reasonOf(e);
          if (w.row) refused.push(w.row);
          else notDiscarded += 1;
        }
      };

      // Smaller than the 500 a batch allows, so a refused batch retried a row
      // at a time costs seconds, not minutes.
      for (let i = 0; i < writes.length; i += 200) {
        const chunk = writes.slice(i, i + 200);
        const batch = writeBatch(db);
        for (const w of chunk) batch.set(doc(txCollection(db, uid), w.id), w.data, { merge: true });
        try {
          await batch.commit();
        } catch (e) {
          reason = reasonOf(e);
          // One at a time, so a document the rules refuse holds up only itself.
          for (const w of chunk) await one(w);
        }
        done += chunk.length;
        onProgress?.(done, writes.length);
      }
      if (refused.length > 0) throw new RowsNotSaved(refused, reason);
      return { notDiscarded };
    },
  };
}

const byDateThenRecord = (a: Transaction, b: Transaction): number =>
  a.date === b.date ? a.recordNumber - b.recordNumber : a.date < b.date ? -1 : 1;

// ── Settings ───────────────────────────────────────────────────────────────

/**
 * The Firestore settings store.
 *
 * Same interface as the browser one, so `App.tsx` swaps between them without
 * caring which is behind it.
 */
export function firestoreSettingsStore(uid: string): SettingsStore {
  const db = firestore();

  return {
    name: "Firebase",

    async load() {
      /*
       * The copy this device already holds, first.
       *
       * `getDoc` asks the server and only falls back to the cache when
       * offline, so on a slow phone connection every refresh showed the
       * ledger with no accounts for seconds: net worth PHP 0.00, every wallet
       * empty, the assistant looking switched off. The owner, 26 September
       * 2026: "when you refresh it in phone ... after a few second its
       * fixed". The cached copy is what was last seen, and `subscribe`
       * brings any change from the server straight after.
       */
      try {
        const cached = await getDocFromCache(settingsDoc(db, uid));
        if (cached.exists()) return normaliseSettings(cached.data());
      } catch {
        // Nothing cached yet: this device's first load, so ask the server.
      }
      const snap = await getDoc(settingsDoc(db, uid));
      // A first run has no document. Defaults, not an error, the app should
      // open and work, and the first edit creates the document.
      return normaliseSettings(snap.exists() ? snap.data() : null);
    },

    async save(settings) {
      // Belt and braces: the UI has no key field, this refuses one anyway, and
      // the security rules refuse it a third time.
      assertNoSecrets(settings);

      /**
       * Refuse to erase the account list.
       *
       * Accounts are the spine of the ledger: every balance, ranking and
       * report is grouped by their names. Writing an empty list over a
       * populated one destroys all of that while leaving the transactions
       * intact, which looks like the data is gone even though it is not.
       *
       * This exists because it happened. A store swap raced ahead of its own
       * load and wrote defaults over the real document. That race is fixed in
       * `App.tsx`, but the fix is one `useEffect` dependency away from
       * regressing, and the cost of being wrong here is someone's ledger.
       *
       * A genuine "delete every account" is not a thing the app offers, so
       * there is no legitimate write this blocks.
       */
      if (settings.accounts.length === 0) {
        const existing = await getDoc(settingsDoc(db, uid));
        const stored = existing.exists() ? normaliseSettings(existing.data()) : null;
        if (stored && stored.accounts.length > 0) {
          throw new Error(
            `Refusing to save: this would erase ${stored.accounts.length} accounts and leave the ledger without them. Reload before changing anything.`,
          );
        }
      }

      await setDoc(settingsDoc(db, uid), settings as DocumentData);
    },

    async savePart(part, whole) {
      assertNoSecrets(whole);

      // The same guard as `save`: an empty account list is never written over a full one.
      if (part.accounts && part.accounts.length === 0) {
        const existing = await getDoc(settingsDoc(db, uid));
        const stored = existing.exists() ? normaliseSettings(existing.data()) : null;
        if (stored && stored.accounts.length > 0) {
          throw new Error(
            `Refusing to save: this would erase ${stored.accounts.length} accounts and leave the ledger without them. Reload before changing anything.`,
          );
        }
      }

      const keys = Object.keys(part);
      if (keys.length === 0) return;
      const data: DocumentData = {};
      for (const key of keys) {
        const value = (part as Record<string, unknown>)[key];
        data[key] = value === undefined ? deleteField() : value;
      }
      // Each named section replaced whole; every section not named stays as the database has it.
      await setDoc(settingsDoc(db, uid), data, { mergeFields: keys });
    },

    subscribe(onChange) {
      return onSnapshot(settingsDoc(db, uid), (snap) => {
        if (snap.exists() && !snap.metadata.hasPendingWrites) {
          onChange(normaliseSettings(snap.data()));
        }
      });
    },
  };
}

// ── Budgets ────────────────────────────────────────────────────────────────

export function subscribeBudgets(
  uid: string,
  onChange: (budgets: Budgets) => void,
): () => void {
  const db = firestore();
  return onSnapshot(collection(db, `${userRoot(uid)}/budgets`), (qs) => {
    const out: Record<string, BudgetYear> = {};
    for (const snap of qs.docs) {
      const year = toBudgetYear(snap.data());
      if (year) out[snap.id] = year;
    }
    onChange(out);
  });
}

/**
 * A budget year is exactly twelve amounts per track. A document with any other
 * shape is skipped rather than coerced: a short array would silently read as
 * a zero budget for the missing months.
 */
function toBudgetYear(d: DocumentData): BudgetYear | null {
  const track = (v: unknown): MonthlyAmounts | null =>
    Array.isArray(v) && v.length === 12 && v.every((n) => Number.isInteger(n))
      ? (v as unknown as MonthlyAmounts)
      : null;

  const spending = track(d.spending);
  const billsSubs = track(d.billsSubs);
  if (!spending || !billsSubs) return null;

  /**
   * Limits for kinds of spending, when a year has any.
   *
   * Read one by one: a malformed entry is dropped on its own rather than
   * taking the year's two tracks down with it. A year written before limits
   * existed simply has none.
   */
  const categories: Record<string, MonthlyAmounts> = {};
  if (d.categories && typeof d.categories === "object") {
    for (const [name, value] of Object.entries(d.categories as Record<string, unknown>)) {
      const amounts = track(value);
      if (name.trim() && amounts) categories[name] = amounts;
    }
  }

  /**
   * The record of changes to each month, when there is one. An entry that is
   * not the shape a change has is dropped on its own, so one bad entry cannot
   * cost the year its budget.
   */
  const revisions: Record<string, BudgetRevisionShape[]> = {};
  if (d.revisions && typeof d.revisions === "object") {
    for (const [month, list] of Object.entries(d.revisions as Record<string, unknown>)) {
      if (!/^(?:[1-9]|1[0-2])$/.test(month) || !Array.isArray(list)) continue;
      const kept = list.filter(isRevision);
      if (kept.length > 0) revisions[month] = kept;
    }
  }

  return {
    spending,
    billsSubs,
    ...(Object.keys(categories).length > 0 ? { categories } : {}),
    ...(Object.keys(revisions).length > 0 ? { revisions } : {}),
  };
}

type BudgetRevisionShape = import("../domain/types").BudgetRevision;

const WHOLE = (v: unknown): boolean => v === undefined || Number.isInteger(v);

function isRevision(v: unknown): v is BudgetRevisionShape {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.at === "string" &&
    (r.what === "tracks" || r.what === "limit") &&
    (r.when === "open" || r.when === "grace" || r.when === "closed") &&
    (r.name === undefined || typeof r.name === "string") &&
    (r.reason === undefined || typeof r.reason === "string") &&
    WHOLE(r.spending) &&
    WHOLE(r.billsSubs) &&
    WHOLE(r.wasSpending) &&
    WHOLE(r.wasBillsSubs) &&
    WHOLE(r.limit) &&
    WHOLE(r.wasLimit)
  );
}

export async function saveBudget(uid: string, year: string, budget: BudgetYear): Promise<void> {
  const categories = Object.fromEntries(
    Object.entries(budget.categories ?? {}).map(([name, amounts]) => [name, [...amounts]]),
  );
  // Firestore refuses `undefined` anywhere in a document, so each change is
  // written as plain JSON: an optional field that is absent stays absent.
  const revisions = JSON.parse(JSON.stringify(budget.revisions ?? {})) as Record<string, unknown>;
  // The whole document, so a limit removed here is removed there.
  await setDoc(budgetDoc(firestore(), uid, year), {
    spending: [...budget.spending],
    billsSubs: [...budget.billsSubs],
    ...(Object.keys(categories).length > 0 ? { categories } : {}),
    ...(Object.keys(revisions).length > 0 ? { revisions } : {}),
  });
}

// ── First run ──────────────────────────────────────────────────────────────

/**
 * Seed an empty database from the in-memory ledger.
 *
 * Only ever runs when the transactions collection is empty, it must be
 * impossible for this to overwrite real data by accident, so it checks first
 * and refuses rather than merging.
 */
export async function seedIfEmpty(
  uid: string,
  transactions: readonly Transaction[],
  settings: AppSettings,
): Promise<{ seeded: boolean; count: number }> {
  const db = firestore();
  const existing = await getDoc(settingsDoc(db, uid));
  if (existing.exists()) return { seeded: false, count: 0 };

  await firestoreLedger(uid).saveMany(transactions);
  await firestoreSettingsStore(uid).save(settings);
  return { seeded: true, count: transactions.length };
}
