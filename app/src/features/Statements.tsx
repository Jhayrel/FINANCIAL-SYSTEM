/**
 * Statements: spec 7.8.
 *
 * A statement type × a month range, shown as the sheet it prints as and
 * exported as a PDF laid out the way the owner's Excel printed one, or as
 * CSV for a spreadsheet.
 *
 * ── Asked for on 26 September 2026 ────────────────────────────────────────
 *
 * "Add pdf ... I want a layout", "who issued the statement like name to
 * input", "more option in the statement like credit or loan, all borrowed",
 * "at the end add nothing follows", "add somewhere the logo and the name of
 * the system". The PDF is `pdf/statementPdf.ts`, loaded only when asked for,
 * so the fonts it carries cost nothing until then. What this screen shows is
 * `buildSheet`, the same figures the PDF prints, row for row.
 */

import { useEffect, useMemo, useState } from "react";

import { Button, Card, EmptyState, Money, StatusPill } from "../components/primitives";
import { Select } from "../components/Select";
import { TextInput } from "../components/forms";
import { DataTable, type Column } from "../components/DataTable";
import { formatShort, MONTH_NAMES } from "../domain/dates";
import type { Debt } from "../domain/debt";
import { buildSheet, type SheetLine } from "../domain/statementSheet";
import {
  buildStatement,
  debtInScope,
  statementFilename,
  statementToCsv,
  STATEMENT_HINT,
  STATEMENT_LABEL,
  STATEMENT_TYPES,
  type StatementType,
} from "../domain/statements";
import type { ReferenceLists, Transaction } from "../domain/types";
import { yearsCovered } from "../domain/year";

/** Remembered on this device, so the name is typed once. */
const ISSUED_KEY = "fms.statement.issued";

export function readIssued(): { to: string; by: string } {
  try {
    const raw = localStorage.getItem(ISSUED_KEY);
    if (!raw) return { to: "", by: "" };
    const v = JSON.parse(raw) as { to?: unknown; by?: unknown };
    return { to: typeof v.to === "string" ? v.to : "", by: typeof v.by === "string" ? v.by : "" };
  } catch {
    return { to: "", by: "" };
  }
}

function saveFile(name: string, data: BlobPart, type: string): void {
  const blob = new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked a moment later: a phone can still be reading it when click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function Statements({
  transactions,
  reference,
  debts,
  year: initialYear,
}: {
  transactions: readonly Transaction[];
  reference: ReferenceLists;
  debts: readonly Debt[];
  /** The year it opens on. Any year the ledger covers can be picked. */
  year: number;
}) {
  const [year, setYear] = useState(initialYear);
  /** Newest first. An imported year appears here as soon as its rows do. */
  const years = useMemo(
    () => [...new Set([...yearsCovered(transactions), initialYear])].sort((a, b) => b - a),
    [transactions, initialYear],
  );
  const [type, setType] = useState<StatementType>("account");
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(12);

  // Every wallet the settings list or the year's rows name, the everyday ones first.
  const wallets = useMemo(() => {
    const named = new Set<string>([...reference.wallets, ...reference.savings]);
    for (const t of transactions) {
      if (!t.date.startsWith(String(year))) continue;
      if (t.fromWallet) named.add(t.fromWallet);
      if (t.toWallet) named.add(t.toWallet);
    }
    return [...named];
  }, [reference, transactions, year]);
  const [wallet, setWallet] = useState(reference.wallets[0] ?? "");
  const [debtId, setDebtId] = useState(debts[0]?.id ?? "");

  const [issued, setIssued] = useState(readIssued);
  useEffect(() => {
    try {
      localStorage.setItem(ISSUED_KEY, JSON.stringify(issued));
    } catch {
      /* Private browsing: the name is simply not remembered. */
    }
  }, [issued]);

  const [making, setMaking] = useState(false);
  const [failed, setFailed] = useState("");

  const sheet = useMemo(
    () => buildSheet(transactions, { type, year, fromMonth: from, toMonth: to, wallet, debtId: debtId || undefined }, reference, debts),
    [transactions, type, year, from, to, wallet, debtId, reference, debts],
  );

  // Statements that cover a kind of debt say so when there is none of that kind.
  const noDebtsOfKind =
    (type === "borrowed" || type === "credit" || type === "lent" || type === "onbehalf") &&
    !debts.some((d) => debtInScope(d, type));

  const downloadCsv = (): void => {
    const statement = buildStatement(transactions, type, year, from, to, reference, debtId || undefined, { wallet, debts });
    saveFile(statementFilename(statement, "csv", sheet.subject), statementToCsv(statement), "text/csv;charset=utf-8");
  };

  const downloadPdf = async (): Promise<void> => {
    setMaking(true);
    setFailed("");
    try {
      const { statementPdf } = await import("../pdf/statementPdf");
      const bytes = await statementPdf({ sheet, issuedTo: issued.to, issuedBy: issued.by, issuedAt: new Date() });
      const statement = buildStatement(transactions, type, year, from, to, reference, debtId || undefined, { wallet, debts });
      saveFile(statementFilename(statement, "pdf", sheet.subject), bytes as BlobPart, "application/pdf");
    } catch (e) {
      setFailed(
        `The PDF could not be made (${(e as Error).message || "no reason given"}). The CSV has the same rows; try the PDF again after reloading the page.`,
      );
    } finally {
      setMaking(false);
    }
  };

  const signedCell = (value: number, tone: string) =>
    value === 0 ? <span className="t-num-s" style={{ color: "var(--ink-3)" }}>-</span> : <Money value={value} size="s" tone={tone} />;

  const columns: Column<SheetLine>[] = [
    { key: "date", header: "Date", width: "104px", render: (l) => <span className="t-num-s">{formatShort(l.date)}</span> },
    {
      key: "desc",
      header: "Description",
      render: (l) => (
        <span className="t-body fms-truncate" title={l.description}>
          {l.description}
        </span>
      ),
    },
    {
      key: "type",
      header: "Type",
      width: "112px",
      hideBelow: "md",
      render: (l) => <span className="t-caption fms-truncate" style={{ color: "var(--ink-2)" }}>{l.kind}</span>,
    },
    {
      key: "wallet",
      header: "Wallet",
      width: "180px",
      hideBelow: "lg",
      render: (l) => {
        const path = l.fromWallet && l.toWallet ? `${l.fromWallet} → ${l.toWallet}` : l.toWallet ? `→ ${l.toWallet}` : l.fromWallet;
        return <span className="t-caption fms-truncate" style={{ color: "var(--ink-2)" }} title={path}>{path}</span>;
      },
    },
    ...(sheet.headings.moneyIn
      ? [{
          key: "in",
          header: sheet.headings.moneyIn,
          align: "right" as const,
          width: "128px",
          render: (l: SheetLine) => signedCell(l.moneyIn, "var(--flow-revenue-text)"),
        }]
      : []),
    ...(sheet.headings.moneyOut
      ? [{
          key: "out",
          header: sheet.headings.moneyOut,
          align: "right" as const,
          width: "128px",
          render: (l: SheetLine) => signedCell(l.moneyOut, "var(--flow-spending-text)"),
        }]
      : []),
    {
      key: "balance",
      header: sheet.headings.balance,
      align: "right",
      width: "136px",
      render: (l) => <Money value={l.balance ?? 0} size="s" />,
    },
  ];

  const typeLabel = STATEMENT_LABEL[type];

  return (
    <div className="fms-db">
      <Card page title="Statements" subtitle="Any period, printed the way your Excel printed it" padded={false}>
        <div className="fms-stmttools">
          <label className="fms-stmtfield fms-stmtfield--wide">
            <span className="t-label" style={{ color: "var(--ink-2)" }}>Statement</span>
            <Select
              value={typeLabel}
              onChange={(label) => {
                const found = STATEMENT_TYPES.find((t) => STATEMENT_LABEL[t] === label);
                if (found) setType(found);
              }}
              options={STATEMENT_TYPES.map((t) => STATEMENT_LABEL[t])}
            />
          </label>

          {type === "wallet" && wallets.length > 0 && (
            <label className="fms-stmtfield">
              <span className="t-label" style={{ color: "var(--ink-2)" }}>Wallet</span>
              <Select value={wallet} onChange={setWallet} options={wallets} />
            </label>
          )}

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

          {years.length > 1 && (
            <label className="fms-stmtfield fms-stmtfield--narrow">
              <span className="t-label" style={{ color: "var(--ink-2)" }}>Year</span>
              <Select value={String(year)} onChange={(v) => setYear(Number(v))} options={years.map(String)} />
            </label>
          )}

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
        </div>

        <div className="fms-stmttools fms-stmttools--issue">
          <label className="fms-stmtfield fms-stmtfield--wide">
            <span className="t-label" style={{ color: "var(--ink-2)" }}>Issued to</span>
            <TextInput
              value={issued.to}
              onChange={(v) => setIssued((p) => ({ ...p, to: v }))}
              placeholder="Your name"
              maxLength={80}
            />
          </label>
          <label className="fms-stmtfield fms-stmtfield--wide">
            <span className="t-label" style={{ color: "var(--ink-2)" }}>
              Issued by <span style={{ color: "var(--ink-3)" }}>(optional)</span>
            </span>
            <TextInput
              value={issued.by}
              onChange={(v) => setIssued((p) => ({ ...p, by: v }))}
              placeholder="Who is issuing it"
              maxLength={80}
            />
          </label>
          <div className="fms-stmtexport">
            <Button variant="secondary" onClick={downloadCsv} disabled={sheet.lines.length === 0}>
              CSV
            </Button>
            <Button variant="primary" onClick={() => void downloadPdf()} loading={making}>
              Download PDF
            </Button>
          </div>
        </div>

        {failed && (
          <p className="t-caption" role="alert" style={{ margin: 0, padding: "var(--space-3) var(--space-5)", color: "var(--over)" }}>
            {failed}
          </p>
        )}

        <div className="fms-stmtsummary">
          <span className="t-caption" style={{ color: "var(--ink-3)" }}>
            {sheet.period}
            {sheet.subject ? ` · ${sheet.subject}` : ""} · {STATEMENT_HINT[type]}
          </span>
          <span style={{ display: "flex", gap: "var(--space-2) var(--space-4)", flexWrap: "wrap", alignItems: "center" }}>
            {sheet.broughtForward !== null && (
              <span className="t-caption" style={{ color: "var(--ink-2)" }}>
                Brought forward <Money value={sheet.broughtForward} size="s" />
              </span>
            )}
            {sheet.headings.moneyIn && (
              <span className="t-caption" style={{ color: "var(--ink-2)" }}>
                {sheet.headings.moneyIn} <Money value={sheet.totalIn} size="s" tone="var(--flow-revenue-text)" />
              </span>
            )}
            {sheet.headings.moneyOut && (
              <span className="t-caption" style={{ color: "var(--ink-2)" }}>
                {sheet.headings.moneyOut} <Money value={sheet.totalOut} size="s" tone="var(--flow-spending-text)" />
              </span>
            )}
            <span className="t-caption" style={{ color: "var(--ink-2)" }}>
              {sheet.headings.balance} <Money value={sheet.closing} size="s" />
            </span>
            <StatusPill status="info">{sheet.lines.length} rows</StatusPill>
          </span>
        </div>

        {sheet.lines.length === 0 ? (
          <EmptyState
            message={
              noDebtsOfKind
                ? `No debt of this kind is set up. Add one on the Debt screen and its rows will show here.`
                : `Nothing in the ${typeLabel.toLowerCase()} for ${sheet.period}. Pick a wider range of months or another year.`
            }
          />
        ) : (
          <>
            <div className="fms-tablewrap">
              <DataTable columns={columns} rows={sheet.lines} getKey={(l) => l.id} />
            </div>
            <ul className="fms-dblist">
              {sheet.lines.map((l) => (
                <li key={l.id} className="fms-dbrow">
                  <div className="fms-dbrow-main">
                    <div className="fms-dbrow-text">
                      <span className="t-body-strong fms-truncate">{l.description}</span>
                      <div className="t-micro" style={{ color: "var(--ink-3)" }}>
                        {formatShort(l.date)} · {l.kind}
                        {l.fromWallet || l.toWallet ? ` · ${[l.fromWallet, l.toWallet].filter(Boolean).join(" → ")}` : ""}
                      </div>
                    </div>
                    <div className="fms-dbrow-figure fms-stmtfigure">
                      {l.moneyIn > 0 && <Money value={l.moneyIn} size="s" signed tone="var(--flow-revenue-text)" />}
                      {l.moneyOut > 0 && <Money value={-l.moneyOut} size="s" tone="var(--flow-spending-text)" />}
                      {l.balance !== null && (
                        <span className="t-micro" style={{ color: "var(--ink-3)" }}>
                          <Money value={l.balance} size="s" tone="var(--ink-3)" />
                        </span>
                      )}
                    </div>
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
