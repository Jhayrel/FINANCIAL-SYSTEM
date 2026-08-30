/**
 * Test fixture loader.
 *
 * The fixture is real financial data and is gitignored. Regenerate it with:
 *
 *     python tools/extract_fixture.py
 *
 * Tests that need it call `loadFixture()`, which fails with that instruction
 * rather than a confusing module-not-found error.
 */

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import type {
  Budgets,
  Centavos,
  DeletedTransaction,
  ReferenceLists,
  Transaction,
} from "../domain/types";

export interface ExpectedFigures {
  /** The date the workbook was captured: INSIGHTS figures are for this month. */
  asOf: string;
  walletBalances: Record<string, Centavos>;
  savingsBalances: Record<string, Centavos>;
  insights: {
    spendingBudget: Centavos;
    billsSubsBudget: Centavos;
    totalSpendThisMonth: Centavos;
    status: string;
  };
  summary: {
    spending: Centavos;
    revenue: Centavos;
    subscription: Centavos;
    bills: Centavos;
    savings: Centavos;
    totalFunds: Centavos;
  };
  spendingRanking: { name: string; amount: Centavos }[];
  walletUsage: { name: string; amount: Centavos }[];
  monthlyBudgetSummary: {
    month: string;
    budget: Centavos;
    spending: Centavos;
    remaining: Centavos;
  }[];
  forecast: { spending: Centavos[]; billsSubs: Centavos[] };
  netCashFlow: {
    revenue: Centavos[];
    expense: Centavos[];
    savings: Centavos[];
    transfer: Centavos[];
  };
}

export interface Fixture {
  transactions: Transaction[];
  deleted: DeletedTransaction[];
  budgets: Budgets;
  reference: ReferenceLists;
  expected: ExpectedFigures;
}

const FIXTURE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "excel-fixture.json",
);

export const fixtureExists = (): boolean => existsSync(FIXTURE_PATH);

let cached: Fixture | null = null;

export function loadFixture(): Fixture {
  if (cached) return cached;

  if (!fixtureExists()) {
    throw new Error(
      `Fixture missing: ${FIXTURE_PATH}\n\n` +
        `It holds real financial data and is gitignored by design.\n` +
        `Regenerate it from the workbook:\n\n` +
        `    python tools/extract_fixture.py\n`,
    );
  }

  const raw = JSON.parse(readFileSync(FIXTURE_PATH, "utf-8")) as {
    transactions: Omit<Transaction, "id">[];
    deleted: Omit<DeletedTransaction, "id" | "deletedAt">[];
    budgets: Budgets;
    reference: ReferenceLists;
    expected: ExpectedFigures;
  };

  // The workbook has no surrogate key; synthesise a stable one from the
  // record number so tests can exercise id-based code paths.
  cached = {
    transactions: raw.transactions.map((t) => ({ ...t, id: `x${t.recordNumber}` })),
    deleted: raw.deleted.map((t) => ({
      ...t,
      id: `d${t.recordNumber}`,
      deletedAt: "",
    })),
    budgets: raw.budgets,
    reference: raw.reference,
    expected: raw.expected,
  };

  return cached;
}
