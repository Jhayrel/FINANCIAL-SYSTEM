/**
 * Database: the full ledger, style guide §3.4, spec 7.4.
 *
 * Desktop is a real table. Phone stacks into rows, a table never scrolls
 * sideways on a phone.
 */

import { useMemo, useState } from "react";

import {
  Button,
  Card,
  CountChip,
  FlowBadge,
  Money,
  SegmentedControl,
  StatusPill,
  EmptyState,
  type Flow as FlowTone,
} from "../components/primitives";
import { SearchInput } from "../components/forms";
import { DataTable, type Column } from "../components/DataTable";
import { formatShort } from "../domain/dates";
import { checkIntegrity, type Issue } from "../domain/integrity";
import type { Transaction, TransactionType } from "../domain/types";

type FilterId = "all" | TransactionType | "flagged";

const FILTERS: { id: FilterId; label: string }[] = [
  { id: "all", label: "All" },
  { id: "Revenue", label: "Revenue" },
  { id: "Spending", label: "Spending" },
  { id: "Transfer", label: "Transfer" },
  { id: "Debt", label: "Debt" },
  { id: "flagged", label: "Needs review" },
];

const TONE: Record<TransactionType, FlowTone> = {
  Revenue: "revenue",
  Spending: "spending",
  Transfer: "transfer",
  Debt: "debt",
};

const PAGE = 50;

export function Database({
  transactions,
  initialFilter = "all",
  onDelete,
}: {
  transactions: readonly Transaction[];
  initialFilter?: FilterId;
  onDelete?: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterId>(initialFilter);
  const [sortKey, setSortKey] = useState("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [limit, setLimit] = useState(PAGE);

  /** Issues indexed by transaction id so a row can show its own flags. */
  const issuesById = useMemo(() => {
    const map = new Map<string, Issue[]>();
    for (const issue of checkIntegrity(transactions)) {
      if (issue.severity === "info") continue;
      for (const id of issue.ids) {
        const list = map.get(id);
        if (list) list.push(issue);
        else map.set(id, [issue]);
      }
    }
    return map;
  }, [transactions]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();

    const filtered = transactions.filter((t) => {
      if (filter === "flagged" && !issuesById.has(t.id)) return false;
      if (filter !== "all" && filter !== "flagged" && t.type !== filter) return false;
      if (!q) return true;
      return (
        t.item.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.fromWallet.toLowerCase().includes(q) ||
        t.toWallet.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q) ||
        t.notes.toLowerCase().includes(q) ||
        t.status.toLowerCase().includes(q) ||
        String(t.recordNumber).padStart(4, "0").includes(q)
      );
    });

    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sortKey) {
        case "amount":
          return (a.total - b.total) * dir;
        case "item":
          return a.item.localeCompare(b.item) * dir;
        case "record":
          return (a.recordNumber - b.recordNumber) * dir;
        default:
          return (
            (a.date === b.date ? a.recordNumber - b.recordNumber : a.date.localeCompare(b.date)) * dir
          );
      }
    });
  }, [transactions, query, filter, issuesById, sortKey, sortDir]);

  const shown = rows.slice(0, limit);
  const flaggedCount = issuesById.size;

  const onSort = (key: string): void => {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
    setLimit(PAGE);
  };

  const columns: Column<Transaction>[] = [
    {
      key: "record",
      header: "Record",
      width: "84px",
      sortable: true,
      render: (t) => (
        <span className="t-num-s" style={{ color: "var(--ink-3)" }}>
          {String(t.recordNumber).padStart(4, "0")}
        </span>
      ),
    },
    {
      key: "date",
      header: "Date",
      width: "104px",
      sortable: true,
      render: (t) => <span className="t-num-s">{formatShort(t.date)}</span>,
    },
    { key: "flow", header: "Type", width: "116px", render: (t) => <FlowBadge flow={TONE[t.type]} /> },
    {
      key: "wallet",
      header: "Wallet",
      width: "170px",
      render: (t) => (
        <span
          className="t-caption fms-truncate"
          style={{ color: "var(--ink-2)" }}
          title={walletPath(t)}
        >
          {walletPath(t)}
        </span>
      ),
    },
    {
      key: "item",
      header: "Item",
      width: "150px",
      sortable: true,
      render: (t) => (
        <span className="t-body-strong fms-truncate" title={t.item}>
          {t.item || "—"}
        </span>
      ),
    },
    {
      key: "description",
      header: "Description",
      render: (t) => (
        <span className="t-caption fms-truncate" style={{ color: "var(--ink-2)" }} title={t.description}>
          {t.description || "—"}
        </span>
      ),
    },
    {
      key: "fee",
      header: "Fee",
      align: "right",
      width: "92px",
      render: (t) =>
        t.fee ? (
          <Money value={t.fee} size="s" tone="var(--warn)" />
        ) : (
          <span className="t-num-s" style={{ color: "var(--ink-3)" }}>—</span>
        ),
    },
    {
      key: "amount",
      header: "Total",
      align: "right",
      width: "124px",
      sortable: true,
      render: (t) => <Money value={t.total} />,
    },
    {
      key: "status",
      header: "Status",
      width: "116px",
      render: (t) =>
        t.status ? (
          <StatusPill status={t.status === "Paid" || t.status === "Withdrawn" ? "over" : "ok"}>
            {t.status}
          </StatusPill>
        ) : null,
    },
    ...(onDelete
      ? [{
          key: "actions",
          header: "",
          align: "right" as const,
          width: "88px",
          render: (t: Transaction) => (
            <Button
              size="sm"
              variant="ghost"
              ariaLabel={`Delete record ${t.recordNumber}`}
              onClick={() => onDelete(t.id)}
            >
              Delete
            </Button>
          ),
        }]
      : []),
  ];

  return (
    <div className="fms-db">
      <Card
        title="Database"
        subtitle="Every transaction, searchable"
        padded={false}
        action={<CountChip>{transactions.length.toLocaleString()} records</CountChip>}
      >
        <div className="fms-dbtools">
          <SearchInput value={query} onChange={(v) => { setQuery(v); setLimit(PAGE); }} placeholder="Search item, description, wallet, status, record #…" />
          <SegmentedControl
            options={FILTERS.map((f) => ({
              id: f.id,
              label: f.id === "flagged" && flaggedCount > 0 ? `${f.label} (${flaggedCount})` : f.label,
            }))}
            value={filter}
            onChange={(id) => { setFilter(id); setLimit(PAGE); }}
          />
        </div>

        {shown.length === 0 ? (
          <EmptyState
            message={
              query
                ? `No results for “${query}”. Check the spelling or clear the filters.`
                : "Nothing matches these filters."
            }
            action={
              (query || filter !== "all") && (
                <Button onClick={() => { setQuery(""); setFilter("all"); }}>Clear filters</Button>
              )
            }
          />
        ) : (
          <>
            {/* Desktop table */}
            <div className="fms-tablewrap">
              <DataTable
                columns={columns}
                rows={shown}
                getKey={(t) => t.id}
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={onSort}
                rowTone={(t) => (issuesById.has(t.id) ? "warn" : undefined)}
                footer={
                  <>
                    <span className="t-caption" style={{ color: "var(--ink-3)" }}>
                      Showing {shown.length.toLocaleString()} of {rows.length.toLocaleString()}
                      {rows.length !== transactions.length && ` (filtered from ${transactions.length.toLocaleString()})`}
                    </span>
                    {rows.length > shown.length && (
                      <Button size="sm" onClick={() => setLimit((n) => n + PAGE)}>
                        Show {Math.min(PAGE, rows.length - shown.length)} more
                      </Button>
                    )}
                  </>
                }
              />
            </div>

            {/* Phone list */}
            <ul className="fms-dblist">
              {shown.map((t) => {
                const issues = issuesById.get(t.id);
                return (
                  <li
                    key={t.id}
                    className="fms-dbrow"
                    style={issues ? { background: "var(--warn-bg)", borderLeft: "3px solid var(--warn)" } : undefined}
                  >
                    <div className="fms-dbrow-main">
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                          <span className="t-body-strong fms-truncate">{t.item || "Uncategorised"}</span>
                          <FlowBadge flow={TONE[t.type]} />
                        </div>
                        <div className="t-caption fms-truncate" style={{ color: "var(--ink-2)" }}>
                          {t.description || "No description"}
                        </div>
                        <div className="t-micro" style={{ color: "var(--ink-3)" }}>
                          {formatShort(t.date)} · {walletPath(t)}
                        </div>
                      </div>
                      <div style={{ textAlign: "right", flex: "0 0 auto" }}>
                        <Money value={t.type === "Revenue" ? t.total : -t.total} signed />
                        {t.fee > 0 && (
                          <div className="t-micro" style={{ color: "var(--warn)" }}>
                            incl. {fmtShort(t.fee)} fee
                          </div>
                        )}
                      </div>
                    </div>
                    {issues?.map((i) => (
                      <p key={i.code} className="t-micro" style={{ margin: "6px 0 0", color: "var(--warn)" }}>
                        ⚠ {i.message}
                      </p>
                    ))}
                  </li>
                );
              })}
              {rows.length > shown.length && (
                <li style={{ padding: "var(--space-3)" }}>
                  <Button fullWidth onClick={() => setLimit((n) => n + PAGE)}>
                    Show {Math.min(PAGE, rows.length - shown.length)} more
                  </Button>
                </li>
              )}
            </ul>
          </>
        )}
      </Card>
    </div>
  );
}

/** "Gcash → Maya", "Maya", "→ Maya": never a bare em dash on one side. */
function walletPath(t: Transaction): string {
  if (t.fromWallet && t.toWallet) return `${t.fromWallet} → ${t.toWallet}`;
  if (t.toWallet) return `→ ${t.toWallet}`;
  return t.fromWallet || "—";
}

const fmtShort = (c: number): string =>
  `₱${(c / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
