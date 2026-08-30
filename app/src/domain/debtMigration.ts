/**
 * Debt migration: spec 5.6.5.
 *
 * The ledger records borrowing as Revenue and repayment as a Bill. This turns
 * that into a proper Debt without rewriting history behind the user's back:
 * it produces a *plan* of proposals, each with a reason, and applies nothing
 * until the user approves it.
 *
 * ── The safety property ───────────────────────────────────────────────────
 * Migration changes CLASSIFICATION ONLY. Wallet balances must be byte-
 * identical before and after. That holds because of how the balance rule is
 * shaped (see balances.ts):
 *
 *   Revenue → Debt/draw    the row credits `toWallet` via term 2 either way;
 *                          term 1 never applied (fromWallet was empty) and
 *                          term 3 still does not (fromWallet is still empty).
 *   Bills   → Debt/repay   term 3 subtracts `total` for any non-Revenue type,
 *                          so the deduction is unchanged.
 *   Split   → two rows     term 3 subtracts each row's total; the split
 *                          preserves the sum, so the deduction is unchanged.
 *
 * `debtMigration.test.ts` asserts this against the real 440-row ledger.
 */

import type { Centavos } from "./money";
import type { Debt } from "./debt";
import { splitRepayment } from "./debt";
import type { IsoDate, ReferenceLists, Transaction } from "./types";

// ── Detection ──────────────────────────────────────────────────────────────

/**
 * Words that mark a credit-related inflow as genuine income rather than
 * borrowing: a reward on the account, not money lent to you.
 */
const REWARD_WORDS = /freebie|reward|cashback|rebate|bonus|promo|refund/i;

/**
 * Items that look like a debt.
 *
 * The signature is an item appearing as BOTH a revenue category and a bill,
 * money coming in under that name, and going out under it too. That is
 * borrowing and repayment wearing the wrong labels.
 */
export function detectDebtCandidates(reference: ReferenceLists): string[] {
  const bills = new Set(reference.bills.map((b) => b.trim().toLowerCase()));
  return reference.revenueCategories.filter((r) =>
    bills.has(r.trim().toLowerCase()),
  );
}

// ── Plan ───────────────────────────────────────────────────────────────────

export type ProposalAction = "draw" | "repay" | "keep-revenue";

export interface Proposal {
  readonly transactionId: string;
  readonly recordNumber: number;
  readonly date: IsoDate;
  readonly description: string;
  readonly amount: Centavos;
  readonly action: ProposalAction;
  /** Shown in the review queue so the user can judge each row. */
  readonly reason: string;
  /** Set when a repayment covers interest as well as principal. */
  readonly principal?: Centavos | undefined;
  readonly interest?: Centavos | undefined;
}

export interface MigrationPlan {
  readonly debt: Debt;
  readonly proposals: readonly Proposal[];
  /** Outstanding once the plan is applied. */
  readonly outstanding: Centavos;
  /** Revenue that stops being counted as income. */
  readonly revenueRemoved: Centavos;
  readonly totalInterest: Centavos;
}

export interface PlanOptions {
  /** Stable id for the created debt. Injected so tests are deterministic. */
  readonly debtId?: string;
  readonly counterparty?: string;
  readonly wallet?: string;
}

/**
 * Build the migration plan for one debt name.
 *
 * Walks the ledger in date order so each repayment is split against the
 * outstanding balance *at that moment*: paying ₱2,688.79 when ₱2,500.00 is
 * outstanding gives ₱2,500.00 principal and ₱188.79 interest, not some
 * average of the whole year.
 */
export function planDebtMigration(
  transactions: readonly Transaction[],
  debtName: string,
  options: PlanOptions = {},
): MigrationPlan {
  const name = debtName.trim().toLowerCase();
  const rows = transactions
    .filter((t) => t.item.trim().toLowerCase() === name)
    .sort((a, b) => (a.date === b.date ? a.recordNumber - b.recordNumber : a.date.localeCompare(b.date)));

  const inflows = rows.filter((t) => t.type === "Revenue");
  const largestInflow = Math.max(0, ...inflows.map((t) => t.total));

  const proposals: Proposal[] = [];
  let outstanding = 0;
  let revenueRemoved = 0;
  let totalInterest = 0;

  for (const t of rows) {
    if (t.type === "Revenue") {
      /**
       * A tiny credit on the account alongside real borrowing is a reward,
       * not a loan. Both signals must be weak before we keep it as revenue:
       * the wording, and the size relative to actual draws.
       */
      const looksLikeReward =
        REWARD_WORDS.test(t.description) ||
        (largestInflow > 0 && t.total < largestInflow * 0.01);

      if (looksLikeReward) {
        proposals.push({
          transactionId: t.id,
          recordNumber: t.recordNumber,
          date: t.date,
          description: t.description,
          amount: t.total,
          action: "keep-revenue",
          reason: "Reads as a reward on the account, not money borrowed.",
        });
        continue;
      }

      outstanding += t.amount;
      revenueRemoved += t.total;
      proposals.push({
        transactionId: t.id,
        recordNumber: t.recordNumber,
        date: t.date,
        description: t.description,
        amount: t.total,
        action: "draw",
        reason: "Money in under a debt name: borrowing, not income.",
      });
      continue;
    }

    if (t.type === "Spending") {
      const split = splitRepayment(t.total, outstanding);
      outstanding -= split.principal;
      totalInterest += split.interest;

      proposals.push({
        transactionId: t.id,
        recordNumber: t.recordNumber,
        date: t.date,
        description: t.description,
        amount: t.total,
        action: "repay",
        reason:
          split.interest > 0
            ? "Repayment: the excess over the outstanding principal is interest."
            : "Repayment of principal.",
        principal: split.principal,
        interest: split.interest,
      });
    }
  }

  const first = rows[0];
  const debt: Debt = {
    id: options.debtId ?? `debt-${name.replace(/\s+/g, "-")}`,
    name: debtName.trim(),
    kind: "payable",
    counterparty: options.counterparty ?? debtName.trim(),
    openedDate: first?.date ?? "1970-01-01",
    wallet: options.wallet ?? first?.toWallet ?? first?.fromWallet ?? "",
    interestType: totalInterest > 0 ? "flat" : "none",
    interestRate: 0,
    notes: "Created from the ledger by the debt migration.",
    archived: false,
  };

  return { debt, proposals, outstanding, revenueRemoved, totalInterest };
}

// ── Apply ──────────────────────────────────────────────────────────────────

/**
 * Apply an approved plan, returning a new ledger.
 *
 * Pure: the input array is never mutated. A repayment carrying interest
 * becomes two rows so the split is auditable in the ledger rather than hidden
 * inside one row's metadata.
 */
export function applyDebtMigration(
  transactions: readonly Transaction[],
  plan: MigrationPlan,
  /** Proposals to apply. Defaults to all but the keep-revenue ones. */
  approvedIds?: ReadonlySet<string>,
): Transaction[] {
  const byId = new Map(plan.proposals.map((p) => [p.transactionId, p]));
  const out: Transaction[] = [];

  /**
   * Interest rows are new records, so they take fresh numbers from the end of
   * the ledger. Reusing the repayment's number would leave two rows sharing
   * one record number, which the integrity check correctly flags, and which
   * would make "#408" ambiguous when the user goes looking for it.
   */
  let nextRecordNumber = Math.max(0, ...transactions.map((t) => t.recordNumber)) + 1;

  for (const t of transactions) {
    const proposal = byId.get(t.id);
    const approved =
      proposal !== undefined &&
      proposal.action !== "keep-revenue" &&
      (approvedIds === undefined || approvedIds.has(t.id));

    if (!approved || !proposal) {
      out.push(t);
      continue;
    }

    if (proposal.action === "draw") {
      out.push({
        ...t,
        type: "Debt",
        category: "",
        debtId: plan.debt.id,
        debtEffect: "draw",
      });
      continue;
    }

    // Repayment. Split into principal and interest when both are present, so
    // the two amounts still sum to the original total and the wallet
    // deduction is unchanged.
    const principal = proposal.principal ?? t.total;
    const interest = proposal.interest ?? 0;

    if (interest > 0) {
      out.push({
        ...t,
        type: "Debt",
        category: "",
        amount: principal,
        fee: 0,
        total: principal,
        debtId: plan.debt.id,
        debtEffect: "repay",
      });
      out.push({
        ...t,
        id: `${t.id}-interest`,
        recordNumber: nextRecordNumber++,
        type: "Debt",
        category: "",
        amount: interest,
        fee: 0,
        total: interest,
        description: `Interest on ${plan.debt.name}`,
        debtId: plan.debt.id,
        debtEffect: "interest",
      });
    } else {
      out.push({
        ...t,
        type: "Debt",
        category: "",
        amount: principal,
        fee: 0,
        total: principal,
        debtId: plan.debt.id,
        debtEffect: "repay",
      });
    }
  }

  return out;
}

/** One-line summary for the review queue header. */
export function summarisePlan(plan: MigrationPlan): string {
  const draws = plan.proposals.filter((p) => p.action === "draw").length;
  const repays = plan.proposals.filter((p) => p.action === "repay").length;
  const kept = plan.proposals.filter((p) => p.action === "keep-revenue").length;

  const parts = [`${draws} borrowing`, `${repays} repayment`];
  if (kept > 0) parts.push(`${kept} kept as revenue`);
  return `${plan.proposals.length} rows: ${parts.join(", ")}`;
}
