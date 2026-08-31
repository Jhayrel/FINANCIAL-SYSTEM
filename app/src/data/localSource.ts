/**
 * Local data source.
 *
 * Loads the extracted Excel fixture so the app runs against the real ledger
 * before Firebase is wired up (Phase 2). The fixture is gitignored, so the
 * glob resolves to nothing on a fresh clone and the app falls back to an empty
 * ledger rather than failing to build.
 *
 * Regenerate with:  python tools/extract_fixture.py
 */

import type {
  Budgets,
  DeletedTransaction,
  ReferenceLists,
  Transaction,
} from "../domain/types";

interface RawFixture {
  transactions: Omit<Transaction, "id">[];
  deleted: Omit<DeletedTransaction, "id" | "deletedAt">[];
  budgets: Budgets;
  reference: ReferenceLists;
}

export interface Ledger {
  transactions: Transaction[];
  deleted: DeletedTransaction[];
  budgets: Budgets;
  reference: ReferenceLists;
  /** False when no fixture is present: the UI shows an empty state. */
  loaded: boolean;
}

const EMPTY_REFERENCE: ReferenceLists = {
  wallets: [],
  savings: [],
  bills: [],
  subscriptions: [],
  revenueCategories: [],
  spendingTypes: [],
};

const EMPTY: Ledger = {
  transactions: [],
  deleted: [],
  budgets: {},
  reference: EMPTY_REFERENCE,
  loaded: false,
};

function read(): Ledger {
  const found = import.meta.glob<{ default: RawFixture }>(
    "../fixtures/excel-fixture.json",
    { eager: true },
  );

  const first = Object.values(found)[0];
  if (!first?.default) return EMPTY;

  const raw = first.default;

  return {
    // Surrogate ids until Firestore supplies real ones.
    transactions: raw.transactions.map((t) => ({ ...t, id: `x${t.recordNumber}` })),
    /**
     * A binned row keeps its old record number, and numbers get reused, so
     * two of them can carry the same one. Deriving the id from the number
     * alone gave two rows the id `d120`, which React reported as a duplicate
     * key and which made one of them impossible to restore: `handleRestore`
     * finds a row by id and always found the first.
     *
     * The index disambiguates and nothing else changes: the id is unique per
     * row and stable for a given fixture.
     */
    deleted: raw.deleted.map((t, i) => ({
      ...t,
      id: `d${t.recordNumber}-${i}`,
      deletedAt: "",
    })),
    budgets: raw.budgets,
    reference: raw.reference,
    loaded: true,
  };
}

let cached: Ledger | null = null;

export function loadLocalLedger(): Ledger {
  cached ??= read();
  return cached;
}
