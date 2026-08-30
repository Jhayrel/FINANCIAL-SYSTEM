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
function toDocument(t: Transaction, deletedAt?: string): DocumentData {
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
  if (t.reviewed !== undefined) d.reviewed = t.reviewed;
  if (deletedAt !== undefined) d.deletedAt = deletedAt;
  return d;
}

function fromDocument(snap: QueryDocumentSnapshot<DocumentData>): Transaction & {
  deletedAt?: string;
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
    ...(d.reviewed !== undefined ? { reviewed: Boolean(d.reviewed) } : {}),
    ...(typeof d.deletedAt === "string" && d.deletedAt.length > 0
      ? { deletedAt: d.deletedAt }
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
            if (row.deletedAt) {
              binned.push({ ...row, deletedAt: row.deletedAt });
            } else {
              const { deletedAt: _drop, ...rest } = row;
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
      await setDoc(doc(txCollection(db, uid), t.id), toDocument(t), { merge: true });
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
      for (let i = 0; i < transactions.length; i += 450) {
        const batch = writeBatch(db);
        for (const t of transactions.slice(i, i + 450)) {
          batch.set(doc(txCollection(db, uid), t.id), toDocument(t), { merge: true });
        }
        await batch.commit();
      }
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
  return spending && billsSubs ? { spending, billsSubs } : null;
}

export async function saveBudget(uid: string, year: string, budget: BudgetYear): Promise<void> {
  await setDoc(budgetDoc(firestore(), uid, year), {
    spending: [...budget.spending],
    billsSubs: [...budget.billsSubs],
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
