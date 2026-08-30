/**
 * Debt: spec 7.5.
 *
 * A debt card per position, plus the full history with a running outstanding
 * column. That column is the most useful view in the module: it is the only
 * way to see how a balance actually moved rather than where it ended.
 */

import { useMemo, useState } from "react";

import {
  Alert,
  Button,
  Card,
  EmptyState,
  Money,
  ProgressBar,
  StatusPill,
} from "../components/primitives";
import { DataTable, type Column } from "../components/DataTable";
import { formatShort, formatMedium } from "../domain/dates";
import type { Debt, DebtPosition } from "../domain/debt";
import { debtAlerts, positionsOf, projectNextDue, rowsFor } from "../domain/debt";
import { buildStatement } from "../domain/statements";
import type { ReferenceLists, Transaction } from "../domain/types";

export function DebtScreen({
  transactions,
  debts,
  reference,
  asOf,
  onAdd,
}: {
  transactions: readonly Transaction[];
  debts: readonly Debt[];
  reference: ReferenceLists;
  asOf: string;
  onAdd: () => void;
}) {
  const positions = useMemo(() => positionsOf(debts, transactions, asOf), [debts, transactions, asOf]);
  const alerts = useMemo(() => debtAlerts(positions, asOf), [positions, asOf]);
  const [openId, setOpenId] = useState<string | null>(positions[0]?.debt.id ?? null);

  const payables = positions.filter((p) => p.debt.kind === "payable");
  const receivables = positions.filter((p) => p.debt.kind === "receivable");

  const totalOwed = payables.reduce((a, p) => a + Math.max(0, p.outstanding), 0);
  const totalOwedToYou = receivables.reduce((a, p) => a + Math.max(0, p.outstanding), 0);

  const open = positions.find((p) => p.debt.id === openId);

  return (
    <div className="fms-dash">
      {alerts.map((a) => (
        <Alert key={a.position.debt.id} status={a.severity} title={a.severity === "over" ? "Overdue" : "Due soon"}>
          {a.message}
        </Alert>
      ))}

      <div className="fms-charts">
        <Card title="You owe" subtitle="Liabilities">
          {payables.length === 0 ? (
            <EmptyState message="No debts tracked. Good place to be." action={<Button variant="primary" onClick={onAdd}>Add a debt</Button>} />
          ) : (
            <div style={{ display: "grid", gap: "var(--space-3)" }}>
              {payables.map((p) => (
                <DebtCard
                  key={p.debt.id}
                  position={p}
                  transactions={transactions}
                  selected={p.debt.id === openId}
                  onSelect={() => setOpenId(p.debt.id)}
                />
              ))}
            </div>
          )}
        </Card>

        <Card title="Owed to you" subtitle="Receivables">
          {receivables.length === 0 ? (
            <EmptyState message="Nothing outstanding." action={<Button onClick={onAdd}>Add a debt</Button>} />
          ) : (
            <div style={{ display: "grid", gap: "var(--space-3)" }}>
              {receivables.map((p) => (
                <DebtCard
                  key={p.debt.id}
                  position={p}
                  transactions={transactions}
                  selected={p.debt.id === openId}
                  onSelect={() => setOpenId(p.debt.id)}
                />
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card title="Position">
        <div style={{ display: "grid", gap: "var(--space-3)" }}>
          <div className="fms-qrow">
            <span className="t-body">Total liabilities</span>
            <Money value={totalOwed} tone="var(--flow-debt-text)" />
          </div>
          <div className="fms-qrow">
            <span className="t-body">Total receivables</span>
            <Money value={totalOwedToYou} tone="var(--flow-revenue-text)" />
          </div>
          <div className="fms-qrow">
            <span className="t-body-strong">Net</span>
            <Money value={totalOwedToYou - totalOwed} size="l" />
          </div>
        </div>
      </Card>

      {open && <DebtHistory position={open} transactions={transactions} reference={reference} />}
    </div>
  );
}

function DebtCard({
  position,
  transactions,
  selected,
  onSelect,
}: {
  position: DebtPosition;
  transactions: readonly Transaction[];
  selected: boolean;
  onSelect: () => void;
}) {
  const { debt } = position;
  const nextDue = projectNextDue(position, transactions);
  const overdue = position.daysToDue !== undefined && position.daysToDue < 0;

  return (
    <button
      onClick={onSelect}
      aria-pressed={selected}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        padding: "var(--space-3)",
        borderRadius: "var(--radius-md)",
        background: "var(--flow-debt-bg)",
        border: `${selected ? 2 : 1}px solid ${overdue ? "var(--over)" : "var(--flow-debt)"}`,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "var(--space-3)" }}>
        <span className="t-body-strong" style={{ color: "var(--flow-debt-text)" }}>{debt.name}</span>
        <Money value={position.outstanding} size="l" tone={overdue ? "var(--over)" : "var(--flow-debt-text)"} />
      </div>

      <div style={{ marginTop: "var(--space-2)" }}>
        <ProgressBar value={position.repaid} max={position.drawn || 1} />
      </div>

      <div
        className="t-caption"
        style={{ marginTop: "var(--space-2)", display: "flex", flexWrap: "wrap", gap: "var(--space-3)", color: "var(--flow-debt-text)" }}
      >
        <span>Drawn <Money value={position.drawn} size="s" tone="var(--flow-debt-text)" /></span>
        <span>Repaid <Money value={position.repaid} size="s" tone="var(--flow-debt-text)" /></span>
        {position.interestPaid > 0 && (
          <span>Interest <Money value={position.interestPaid} size="s" tone="var(--flow-debt-text)" /></span>
        )}
      </div>

      <div style={{ marginTop: "var(--space-2)", display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
        <StatusPill status={overdue ? "over" : position.status === "open" ? "warn" : "ok"}>
          {position.status}
        </StatusPill>
        {nextDue && (
          <span className="t-caption" style={{ color: "var(--flow-debt-text)" }}>
            next due {formatMedium(nextDue)}
          </span>
        )}
      </div>
    </button>
  );
}

/** The running-outstanding history: spec 7.5's "most useful view". */
function DebtHistory({
  position,
  transactions,
  reference,
}: {
  position: DebtPosition;
  transactions: readonly Transaction[];
  reference: ReferenceLists;
}) {
  const rows = rowsFor(transactions, position.debt.id);
  const first = rows[0];
  const year = first ? Number(first.date.slice(0, 4)) : new Date().getFullYear();

  const statement = buildStatement(
    transactions,
    "debt",
    year,
    1,
    12,
    reference,
    position.debt.id,
  );

  const columns: Column<(typeof statement.rows)[number]>[] = [
    { key: "date", header: "Date", width: "104px", render: (r) => <span className="t-num-s">{formatShort(r.transaction.date)}</span> },
    {
      key: "effect",
      header: "Effect",
      width: "120px",
      render: (r) => (
        <StatusPill status={r.transaction.debtEffect === "draw" ? "warn" : "ok"}>
          {r.transaction.debtEffect}
        </StatusPill>
      ),
    },
    {
      key: "desc",
      header: "Description",
      render: (r) => (
        <span className="t-caption fms-truncate" style={{ color: "var(--ink-2)" }} title={r.transaction.description}>
          {r.transaction.description || "—"}
        </span>
      ),
    },
    { key: "amount", header: "Amount", align: "right", width: "124px", render: (r) => <Money value={r.transaction.total} /> },
    {
      key: "running",
      header: "Outstanding",
      align: "right",
      width: "132px",
      render: (r) => <Money value={r.runningBalance ?? 0} tone="var(--flow-debt-text)" />,
    },
  ];

  return (
    <Card title={`${position.debt.name} history`} subtitle="Running outstanding after each row" padded={false}>
      {statement.rows.length === 0 ? (
        <EmptyState message="No transactions on this debt yet." />
      ) : (
        <>
          <div className="fms-tablewrap">
            <DataTable columns={columns} rows={statement.rows} getKey={(r) => r.transaction.id} />
          </div>
          <ul className="fms-dblist">
            {statement.rows.map((r) => (
              <li key={r.transaction.id} className="fms-dbrow">
                <div className="fms-dbrow-main">
                  <div style={{ minWidth: 0 }}>
                    <span className="t-body-strong">{r.transaction.debtEffect}</span>
                    <div className="t-caption fms-truncate" style={{ color: "var(--ink-2)" }}>
                      {r.transaction.description || "—"}
                    </div>
                    <div className="t-micro" style={{ color: "var(--ink-3)" }}>
                      {formatShort(r.transaction.date)}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <Money value={r.transaction.total} />
                    <div className="t-micro" style={{ color: "var(--ink-3)" }}>
                      left <Money value={r.runningBalance ?? 0} size="s" tone="var(--flow-debt-text)" />
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
