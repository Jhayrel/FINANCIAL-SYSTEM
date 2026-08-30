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
import { useConfirm } from "../components/Confirm";
import { formatAmount } from "../domain/money";
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

/**
 * How many rows arrive before you ask for more.
 *
 * Fifty filled several screens of a page that then scrolled as a whole. Now
 * that only the rows move and the footer stays visible, a smaller first page
 * loads faster and puts the count and the button where they can be seen
 * without scrolling to find them.
 */
const PAGE = 25;

export function Database({
  transactions,
  initialFilter = "all",
  onDelete,
  onEdit,
}: {
  transactions: readonly Transaction[];
  initialFilter?: FilterId;
  onDelete?: (id: string) => void;
  /** Loads the row back into the Add form, the way the Excel arrows did. */
  onEdit?: (row: Transaction) => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterId>(initialFilter);
  /**
   * Newest entry first, by record number rather than by date.
   *
   * The two agree for anything logged as it happens, and disagree for
   * exactly the case that matters: an entry with an older date, added now.
   * A starting balance is dated the day the ledger begins, so under a date
   * sort it went straight to the last page and looked like it had not
   * saved. Record order is also the order the Excel's DATABASE sheet kept,
   * where rows are appended and referred to by number.
   */
  const [sortKey, setSortKey] = useState("record");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [limit, setLimit] = useState(PAGE);
  const { confirm, dialog } = useConfirm();

  /**
   * Deleting asks first, and says what it is about to remove.
   *
   * Delete sits next to Edit on every one of four hundred rows, at the end
   * of a line your eye is already travelling along, so hitting it by
   * accident is a matter of time.
   *
   * The dialog names the record, the item and the amount, because "are you
   * sure" on its own does not help: what makes this safe to answer is
   * seeing which row it means. It also says where the row goes, since a
   * delete here is a move to the bin and nothing is actually destroyed.
   * That is the difference between a warning worth reading and one that
   * gets clicked through.
   */
  const askDelete = async (t: Transaction): Promise<void> => {
    if (!onDelete) return;

    const ok = await confirm({
      title: `Delete record #${String(t.recordNumber).padStart(4, "0")}?`,
      body: `${t.item || "This entry"}, ${t.description || "no description"}, ₱${formatAmount(t.total)} on ${formatShort(t.date)}. It moves to the bin, where you can restore it. Balances and totals update straight away.`,
      confirmLabel: "Move to bin",
      tone: "danger",
    });

    if (ok) onDelete(t.id);
  };

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

  /**
   * Search by what it cost, which is how anyone looks for a transaction.
   *
   * Typing 5000 to find a PHP 5,000.00 row returned nothing, because the
   * search covered every field except the one people actually remember. It
   * now matches the amount, the fee and the total, written the way they are
   * shown and the way they would be typed: 5000, 5,000, and 5000.00 all find
   * the same row.
   */
  const matchesAmount = (t: Transaction, q: string): boolean => {
    // A query with no digits cannot be an amount, and testing it would make
    // every text search do this work for nothing.
    if (!/\d/.test(q)) return false;

    const wanted = q.replace(/[^\d.]/g, "");
    if (!wanted) return false;

    return [t.amount, t.fee, t.total].some((cents) => {
      const exact = (cents / 100).toFixed(2);
      // "5000" should find 5000.00, so a whole-peso query matches the
      // pesos alone as well as the full two decimal places.
      const whole = String(Math.trunc(cents / 100));
      return exact.includes(wanted) || whole === wanted;
    });
  };

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
        String(t.recordNumber).padStart(4, "0").includes(q) ||
        matchesAmount(t, q) ||
        t.date.includes(q)
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
      width: "72px",
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
      width: "92px",
      sortable: true,
      render: (t) => <span className="t-num-s">{formatShort(t.date)}</span>,
    },
    { key: "flow", header: "Type", width: "96px", render: (t) => <FlowBadge flow={TONE[t.type]} /> },
    {
      key: "wallet",
      header: "Wallet",
      width: "18%",
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
      width: "14%",
      sortable: true,
      render: (t) => (
        <span className="t-body-strong fms-truncate" title={t.item}>
          {t.item}
        </span>
      ),
    },
    {
      key: "description",
      header: "Description",
      render: (t) => (
        <span className="t-caption fms-truncate" style={{ color: "var(--ink-2)" }} title={t.description}>
          {t.description}
        </span>
      ),
    },
    {
      key: "fee",
      header: "Fee",
      align: "right",
      width: "76px",
      render: (t) =>
        t.fee ? (
          <Money value={t.fee} size="s" tone="var(--warn)" />
        ) : (
          <span className="t-num-s" style={{ color: "var(--ink-3)" }} />
        ),
    },
    {
      key: "amount",
      header: "Total",
      align: "right",
      width: "112px",
      sortable: true,
      render: (t) => <Money value={t.total} />,
    },
    {
      key: "status",
      header: "Status",
      width: "84px",
      render: (t) =>
        t.status ? (
          <StatusPill status={t.status === "Paid" || t.status === "Withdrawn" ? "over" : "ok"}>
            {t.status}
          </StatusPill>
        ) : null,
    },
    ...(onDelete || onEdit
      ? [{
          key: "actions",
          header: "",
          align: "right" as const,
          width: "132px",
          render: (t: Transaction) => (
            /*
             * Not `.fms-rowactions`: that reserves 200px and gives every
             * button a 96px minimum so the Settings tables line up with each
             * other. Applied to 442 ledger rows it pushed the table past its
             * container, and Delete was cut off at the right edge.
             */
            <span className="fms-tableactions">
              {onEdit && (
                <Button
                  size="sm"
                  variant="secondary"
                  ariaLabel={`Edit record ${t.recordNumber}`}
                  onClick={() => onEdit(t)}
                >
                  Edit
                </Button>
              )}
              {onDelete && (
                <Button
                  size="sm"
                  variant="danger"
                  ariaLabel={`Delete record ${t.recordNumber}`}
                  onClick={() => void askDelete(t)}
                >
                  Delete
                </Button>
              )}
            </span>
          ),
        }]
      : []),
  ];

  return (
    <div className="fms-db">
      {dialog}
      <Card
        title="Database"
        subtitle="Every transaction, searchable"
        padded={false}
        action={<CountChip>{transactions.length.toLocaleString()} records</CountChip>}
      >
        <div className="fms-dbtools">
          <SearchInput value={query} onChange={(v) => { setQuery(v); setLimit(PAGE); }} placeholder="Search item, description, wallet, amount, date, record #…" />
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

/** "Gcash → Maya", "Maya", "→ Maya". Empty when the row names no wallet. */
/**
 * The wallets a row touches.
 *
 * An arrow only appears when there are two of them, because that is the only
 * case where it says anything. A lone "→ Maya" was repeating what the Type
 * badge in the previous column already says, and it cost fourteen pixels of
 * the one column that runs out: "Maya Bank (Personal savings)" is a real
 * account name and it has to fit.
 */
function walletPath(t: Transaction): string {
  if (t.fromWallet && t.toWallet) return `${t.fromWallet} → ${t.toWallet}`;
  return t.toWallet || t.fromWallet;
}

const fmtShort = (c: number): string =>
  `₱${(c / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
