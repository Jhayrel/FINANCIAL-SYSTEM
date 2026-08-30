/**
 * Statements: spec 7.8.
 *
 * Five statement types × a month range, exported as CSV. The Excel exported
 * to PDF via a staging sheet; CSV is the honest equivalent here because it
 * re-imports as numbers rather than as pictures of numbers.
 */

import { useMemo, useState } from "react";

import { Button, Card, EmptyState, Money, StatusPill } from "../components/primitives";
import { Select } from "../components/forms";
import { DataTable, type Column } from "../components/DataTable";
import { formatShort, MONTH_NAMES } from "../domain/dates";
import type { Debt } from "../domain/debt";
import {
  buildStatement,
  statementFilename,
  statementToCsv,
  STATEMENT_HINT,
  STATEMENT_LABEL,
  type StatementRow,
  type StatementType,
} from "../domain/statements";
import type { ReferenceLists, Transaction } from "../domain/types";

const TYPES: StatementType[] = ["account", "revenue", "expense", "savings", "debt"];

export function Statements({
  transactions,
  reference,
  debts,
  year,
}: {
  transactions: readonly Transaction[];
  reference: ReferenceLists;
  debts: readonly Debt[];
  year: number;
}) {
  const [type, setType] = useState<StatementType>("account");
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(12);
  const [debtId, setDebtId] = useState(debts[0]?.id ?? "");

  const statement = useMemo(
    () => buildStatement(transactions, type, year, from, to, reference, debtId || undefined),
    [transactions, type, year, from, to, reference, debtId],
  );

  const download = (): void => {
    const blob = new Blob([statementToCsv(statement)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = statementFilename(statement);
    a.click();
    URL.revokeObjectURL(url);
  };

  const columns: Column<StatementRow>[] = [
    { key: "record", header: "Record", width: "84px", render: (r) => <span className="t-num-s" style={{ color: "var(--ink-3)" }}>{String(r.transaction.recordNumber).padStart(4, "0")}</span> },
    { key: "date", header: "Date", width: "104px", render: (r) => <span className="t-num-s">{formatShort(r.transaction.date)}</span> },
    {
      key: "type",
      header: "Type",
      width: "120px",
      render: (r) => (
        <span className="t-caption" style={{ color: "var(--ink-2)" }}>
          {r.transaction.debtEffect ? `Debt / ${r.transaction.debtEffect}` : r.transaction.type}
        </span>
      ),
    },
    {
      key: "wallet",
      header: "Wallet",
      width: "160px",
      render: (r) => {
        const t = r.transaction;
        const path = t.fromWallet && t.toWallet ? `${t.fromWallet} → ${t.toWallet}` : t.toWallet ? `→ ${t.toWallet}` : t.fromWallet || "—";
        return <span className="t-caption fms-truncate" style={{ color: "var(--ink-2)" }} title={path}>{path}</span>;
      },
    },
    { key: "item", header: "Item", width: "140px", render: (r) => <span className="t-body-strong fms-truncate" title={r.transaction.item}>{r.transaction.item || "—"}</span> },
    {
      key: "desc",
      header: "Description",
      render: (r) => (
        <span className="t-caption fms-truncate" style={{ color: "var(--ink-2)" }} title={r.transaction.description}>
          {r.transaction.description || "—"}
        </span>
      ),
    },
    { key: "total", header: "Total", align: "right", width: "124px", render: (r) => <Money value={r.transaction.total} /> },
    ...(type === "debt"
      ? [{
          key: "running",
          header: "Outstanding",
          align: "right" as const,
          width: "132px",
          render: (r: StatementRow) => <Money value={r.runningBalance ?? 0} tone="var(--flow-debt-text)" />,
        }]
      : []),
  ];

  return (
    <div className="fms-db">
      <Card title="Statements" subtitle="Five views over the same ledger" padded={false}>
        <div className="fms-stmttools">
          <label className="fms-stmtfield">
            <span className="t-label" style={{ color: "var(--ink-2)" }}>Statement type</span>
            <Select
              value={STATEMENT_LABEL[type]}
              onChange={(label) => {
                const found = TYPES.find((t) => STATEMENT_LABEL[t] === label);
                if (found) setType(found);
              }}
              options={TYPES.map((t) => STATEMENT_LABEL[t])}
            />
          </label>

          <label className="fms-stmtfield">
            <span className="t-label" style={{ color: "var(--ink-2)" }}>From</span>
            <Select
              value={MONTH_NAMES[from - 1] ?? ""}
              onChange={(m) => setFrom(MONTH_NAMES.indexOf(m as (typeof MONTH_NAMES)[number]) + 1)}
              options={[...MONTH_NAMES]}
            />
          </label>

          <label className="fms-stmtfield">
            <span className="t-label" style={{ color: "var(--ink-2)" }}>To</span>
            <Select
              value={MONTH_NAMES[to - 1] ?? ""}
              onChange={(m) => setTo(MONTH_NAMES.indexOf(m as (typeof MONTH_NAMES)[number]) + 1)}
              options={[...MONTH_NAMES]}
            />
          </label>

          {type === "debt" && debts.length > 0 && (
            <label className="fms-stmtfield">
              <span className="t-label" style={{ color: "var(--ink-2)" }}>Debt</span>
              <Select
                value={debts.find((d) => d.id === debtId)?.name ?? ""}
                onChange={(name) => setDebtId(debts.find((d) => d.name === name)?.id ?? "")}
                options={debts.map((d) => d.name)}
              />
            </label>
          )}

          <div style={{ marginLeft: "auto", alignSelf: "flex-end" }}>
            <Button variant="primary" onClick={download} disabled={statement.rows.length === 0}>
              Export CSV
            </Button>
          </div>
        </div>

        <div className="fms-stmtsummary">
          <span className="t-caption" style={{ color: "var(--ink-3)" }}>{STATEMENT_HINT[type]}</span>
          <span style={{ display: "flex", gap: "var(--space-4)", flexWrap: "wrap" }}>
            <span className="t-caption" style={{ color: "var(--ink-2)" }}>
              In <Money value={statement.totalIn} size="s" tone="var(--flow-revenue-text)" />
            </span>
            <span className="t-caption" style={{ color: "var(--ink-2)" }}>
              Out <Money value={statement.totalOut} size="s" tone="var(--flow-spending-text)" />
            </span>
            <span className="t-caption" style={{ color: "var(--ink-2)" }}>
              Net <Money value={statement.net} size="s" signed />
            </span>
            <StatusPill status="info">{statement.rows.length} rows</StatusPill>
          </span>
        </div>

        {statement.rows.length === 0 ? (
          <EmptyState message={`Nothing in the ${STATEMENT_LABEL[type].toLowerCase()} for ${MONTH_NAMES[from - 1]} to ${MONTH_NAMES[to - 1]}.`} />
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
                      <span className="t-body-strong fms-truncate">{r.transaction.item || "Uncategorised"}</span>
                      <div className="t-caption fms-truncate" style={{ color: "var(--ink-2)" }}>
                        {r.transaction.description || "—"}
                      </div>
                      <div className="t-micro" style={{ color: "var(--ink-3)" }}>
                        {formatShort(r.transaction.date)} · {r.transaction.type}
                      </div>
                    </div>
                    <Money value={r.transaction.total} />
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </div>
  );
}
