/**
 * Database: the full ledger, style guide §3.4, spec 7.4.
 *
 * Desktop is a real table. Phone stacks into rows, a table never scrolls
 * sideways on a phone.
 */

import { useMemo, useRef, useState } from "react";

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
import { Icon } from "../components/Icon";
import { useConfirm } from "../components/Confirm";
import { Sheet } from "../components/Sheet";
import { FilterChip } from "../components/FilterChip";
import { useMediaQuery } from "./useMediaQuery";
import { formatAmount } from "../domain/money";
import { parentOf, partOf } from "../domain/debt";
import { DataTable, type Column } from "../components/DataTable";
import { formatShort, getYear } from "../domain/dates";
import { inPeriod, matchesSearch, parseSearch, PERIODS, type Period } from "../domain/search";
import { yearsCovered } from "../domain/year";
import { checkIntegrity, type Issue } from "../domain/integrity";
import type { Transaction, TransactionType } from "../domain/types";
import type { Debt } from "../domain/debt";
import { ON_BEHALF } from "../domain/debtWords";

type FilterId = "all" | TransactionType | "behalf" | "flagged";

/*
 * On behalf is its own filter, as it is its own type on the Add form. Its
 * rows are stored as debt movements on a person whose form is `pass-through`,
 * so the Debt filter leaves them out and this one finds them.
 */
const FILTERS: { id: FilterId; label: string }[] = [
  { id: "all", label: "All" },
  { id: "Revenue", label: "Revenue" },
  { id: "Spending", label: "Spending" },
  { id: "Transfer", label: "Transfer" },
  { id: "Debt", label: "Debt" },
  { id: "behalf", label: ON_BEHALF },
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
  initialQuery = "",
  onDelete,
  onDeleteMany,
  onEdit,
  asOf,
  debts = [],
}: {
  transactions: readonly Transaction[];
  /** The debts and people, to tell an On behalf row from a Debt row. */
  debts?: readonly Debt[];
  initialFilter?: FilterId;
  /** Words to search for on arrival, from a link on another screen. */
  initialQuery?: string | undefined;
  onDelete?: (id: string) => void;
  /** Several at once, as one move with one record of it. */
  onDeleteMany?: ((ids: readonly string[]) => void) | undefined;
  /** Loads the row back into the Add form, the way the Excel arrows did. */
  onEdit?: (row: Transaction) => void;
  /** Today, for the Today, Yesterday, Last 7 days and This month shortcuts. */
  asOf: string;
}) {
  const [query, setQuery] = useState(initialQuery);
  const behalfIds = useMemo(() => new Set(debts.filter((d) => d.form === "pass-through").map((d) => d.id)), [debts]);
  const onBehalf = (t: Transaction): boolean => t.type === "Debt" && t.debtId !== undefined && behalfIds.has(t.debtId);
  const badge = (t: Transaction) => <FlowBadge flow={TONE[t.type]} label={onBehalf(t) ? ON_BEHALF : undefined} />;
  const [filter, setFilter] = useState<FilterId>(initialFilter);
  const [period, setPeriod] = useState<Period>("all");
  /** A year is a filter on one continuous ledger (docs/08, rule Y1). */
  const [year, setYear] = useState<number | "all">("all");
  const years = useMemo(() => yearsCovered(transactions), [transactions]);
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
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  /** The row whose sheet is open on a phone. */
  const [opened, setOpened] = useState<Transaction | null>(null);
  const phone = useMediaQuery("(max-width: 639px)");
  const { confirm, dialog } = useConfirm();

  /**
   * A long press picks a row, the way every phone list does.
   *
   * "Picking several rows at once is on a bigger screen" was the one thing a
   * phone could not do (owner, 26 September 2026: everything works on the
   * phone). Holding a row for half a second picks it and starts picking;
   * after that a tap adds or removes a row, and the bar at the bottom bins
   * them together. A finger that moves is scrolling, not holding, so it
   * cancels the press.
   */
  const press = useRef<{ timer: number; x: number; y: number; fired: boolean } | null>(null);
  const endPress = (): void => {
    if (press.current) window.clearTimeout(press.current.timer);
  };
  const startPress = (t: Transaction, x: number, y: number): void => {
    endPress();
    const state = { timer: 0, x, y, fired: false };
    state.timer = window.setTimeout(() => {
      state.fired = true;
      toggleRow(t.id);
      try {
        navigator.vibrate?.(12);
      } catch {
        // A phone without vibration still picks the row.
      }
    }, 480);
    press.current = state;
  };
  const movePress = (x: number, y: number): void => {
    const p = press.current;
    if (p && !p.fired && Math.hypot(x - p.x, y - p.y) > 10) endPress();
  };
  /** A tap: the sheet, or while picking, in or out of the pick. A long press has already done its work. */
  const tapRow = (t: Transaction): void => {
    const p = press.current;
    press.current = null;
    if (p?.fired) return;
    if (picked.size > 0 && onDeleteMany) toggleRow(t.id);
    else setOpened(t);
  };

  const toggleRow = (id: string): void =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

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

    // A debt payment goes to the bin with its interest, and a borrowing with its fees, and it says so.
    const part = partOf(t, transactions);
    const ok = await confirm({
      title: `Delete record #${String(t.recordNumber).padStart(4, "0")}?`,
      body: `${t.item || "This entry"}, ${t.description || "no description"}, ₱${formatAmount(t.total)} on ${formatShort(t.date)}.${
        part
          ? ` Its ₱${formatAmount(part.total)} of ${t.debtEffect === "draw" ? "fees" : "interest"}, #${String(part.recordNumber).padStart(4, "0")}, was part of the same ${
              t.debtEffect === "draw" ? "borrowing" : "payment"
            } and goes with it.`
          : ""
      } It moves to the bin, where you can restore it. Balances and totals update straight away.`,
      confirmLabel: "Move to bin",
      tone: "danger",
    });

    if (ok) onDelete(t.id);
  };

  /**
   * The same question for several rows, with the figure that makes it real.
   *
   * A count on its own is not enough to answer safely: "delete 12 records"
   * could be twelve coffees or twelve months of rent. The total is what tells
   * you which, so it is in the sentence, and so is the fact that the bin
   * still has them afterwards.
   */
  const askDeleteMany = async (rows: readonly Transaction[]): Promise<void> => {
    if (!onDeleteMany || rows.length === 0) return;
    const total = rows.reduce((sum, t) => sum + t.total, 0);

    const ok = await confirm({
      title: `Delete ${rows.length} records?`,
      body: `${rows.length} rows totalling ₱${formatAmount(total)}. They move to the bin, where you can restore them together. Balances and totals update straight away.`,
      confirmLabel: `Move ${rows.length} to bin`,
      tone: "danger",
    });

    if (ok) {
      onDeleteMany(rows.map((t) => t.id));
      setPicked(new Set());
    }
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
   * Search, read the way the workbook's Smart Search read it.
   *
   * Every word must match, ">1000" and "<100" are amounts over and under,
   * "P500" is that exact amount, "#442" is a record, and a plain number still
   * finds an amount written the way it is shown: 5000, 5,000 and 5000.00 all
   * find PHP 5,000.00. The rules and their tests are in domain/search.ts.
   */
  const rows = useMemo(() => {
    const terms = parseSearch(query);

    const filtered = transactions.filter((t) => {
      if (filter === "flagged" && !issuesById.has(t.id)) return false;
      if (filter === "behalf" && !onBehalf(t)) return false;
      if (filter === "Debt" && onBehalf(t)) return false;
      if (filter !== "all" && filter !== "flagged" && filter !== "behalf" && t.type !== filter) return false;
      if (!inPeriod(t.date, period, asOf)) return false;
      if (year !== "all" && getYear(t.date) !== year) return false;
      return matchesSearch(t, terms);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactions, query, filter, period, year, asOf, issuesById, sortKey, sortDir, behalfIds]);

  const shown = rows.slice(0, limit);
  const flaggedCount = issuesById.size;

  /**
   * What is picked, in the order the table shows it.
   *
   * Taken from `rows` rather than from the set, so a row that a filter or a
   * search has since hidden cannot be swept into a delete you can no longer
   * see. Narrowing the search is not a way to lose rows.
   */
  const chosen = rows.filter((t) => picked.has(t.id));
  const chosenTotal = chosen.reduce((sum, t) => sum + t.total, 0);
  const allShownPicked = shown.length > 0 && shown.every((t) => picked.has(t.id));

  const toggleAll = (): void =>
    setPicked(allShownPicked ? new Set() : new Set(shown.map((t) => t.id)));

  const onSort = (key: string): void => {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
    setLimit(PAGE);
  };

  /*
   * Ten columns, and a 1024px screen has room for about six of them.
   *
   * Record, Type and Status leave below 880px of table, and Fee and
   * Description below 1200px (see `hideBelow` in DataTable). What Type and
   * Description said moves under the item instead, so a narrower window shows
   * fewer columns and never less about a row.
   *
   * Every fixed width is set to hold its widest real value with the cell's
   * padding: a 112px Total column holding ₱222,259.14 had spilled into
   * Status, and "Transferred" was wider than its 84px pill column.
   */
  /**
   * Which rows are halves of one debt payment, said on the row.
   *
   * The owner asked how the database knows that ₱120.00 of interest belongs
   * to the ₱1,000.00 just paid. It is in the data (`partOf`), and here it is
   * on screen: each half names the other by its record number.
   */
  const paymentLinks = useMemo(() => {
    const links = new Map<string, string>();
    const number = (t: Transaction): string => `#${String(t.recordNumber).padStart(4, "0")}`;
    for (const t of transactions) {
      if (t.debtEffect === "interest" || t.debtEffect === "charge") {
        const parent = parentOf(t, transactions);
        if (parent) {
          links.set(t.id, t.debtEffect === "interest" ? `Interest in the payment ${number(parent)}` : `Fees added on the borrowing ${number(parent)}`);
        }
      } else if (t.debtEffect === "repay" || t.debtEffect === "draw") {
        const part = partOf(t, transactions);
        if (part) {
          links.set(
            t.id,
            t.debtEffect === "repay"
              ? `Paid with ₱${formatAmount(part.total)} of interest, ${number(part)}`
              : `With ₱${formatAmount(part.total)} of fees added, ${number(part)}`,
          );
        }
      }
    }
    return links;
  }, [transactions]);

  const columns: Column<Transaction>[] = [
    {
      key: "record",
      header: "Record",
      width: "104px",
      sortable: true,
      hideBelow: "md",
      render: (t) => (
        <span className="t-num-s" style={{ color: "var(--ink-3)" }}>
          {String(t.recordNumber).padStart(4, "0")}
        </span>
      ),
    },
    {
      key: "date",
      header: "Date",
      width: "116px",
      sortable: true,
      render: (t) => <span className="t-num-s">{formatShort(t.date)}</span>,
    },
    {
      key: "flow",
      header: "Type",
      width: "112px",
      hideBelow: "md",
      render: (t) => badge(t),
    },
    {
      key: "wallet",
      header: "Wallet",
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
      sortable: true,
      render: (t) => (
        <>
          <span className="t-body-strong fms-truncate" title={t.item}>
            {t.item}
          </span>
          {/* Shown only while the Type and Description columns are gone. */}
          <span className="fms-dt-sub fms-dt-only-narrow">
            <span className="fms-dt-only-md" style={{ flex: "0 0 auto" }}>
              {badge(t)}
            </span>
            {t.description && (
              <span className="t-caption fms-truncate" style={{ color: "var(--ink-2)" }} title={t.description}>
                {t.description}
              </span>
            )}
          </span>
          {/* At every width, since it is what makes the row make sense. */}
          {paymentLinks.has(t.id) && (
            <span className="t-micro fms-truncate fms-dt-link" title={paymentLinks.get(t.id)}>
              {paymentLinks.get(t.id)}
            </span>
          )}
        </>
      ),
    },
    {
      key: "description",
      header: "Description",
      hideBelow: "lg",
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
      width: "112px",
      hideBelow: "lg",
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
      width: "144px",
      sortable: true,
      render: (t) => <Money value={t.total} />,
    },
    {
      key: "status",
      header: "Status",
      width: "124px",
      hideBelow: "md",
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
          width: "104px",
          render: (t: Transaction) => (
            /*
             * Not `.fms-rowactions`: that reserves 200px and gives every
             * button a 96px minimum so the Settings tables line up with each
             * other. Applied to 442 ledger rows it pushed the table past its
             * container, and Delete was cut off at the right edge.
             *
             * Icons, as §3.4 asks for row actions, with their words kept in
             * the label for a screen reader and in the tooltip for a mouse.
             * Two worded buttons took 132px of every row, and at 1024px that
             * came straight out of the item and the description.
             */
            <span className="fms-tableactions">
              {onEdit && (
                <Button
                  size="sm"
                  variant="ghost"
                  ariaLabel={`Edit record ${t.recordNumber}`}
                  title="Edit"
                  iconLeft={<Icon name="edit" size={18} />}
                  onClick={() => onEdit(t)}
                />
              )}
              {onDelete && (
                <Button
                  size="sm"
                  variant="ghost"
                  tone="danger"
                  ariaLabel={`Delete record ${t.recordNumber}`}
                  title="Delete"
                  iconLeft={<Icon name="bin" size={18} />}
                  onClick={() => void askDelete(t)}
                />
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
        page
        title="Database"
        subtitle="Every transaction, searchable"
        padded={false}
        action={<CountChip>{transactions.length.toLocaleString()} records</CountChip>}
      >
        <div className="fms-dbtools">
          <SearchInput
            value={query}
            onChange={(v) => { setQuery(v); setLimit(PAGE); }}
            placeholder={phone ? "Search, #0442, >1000" : "Search words, #0442, >1000, <100, P500"}
          />

          {/*
            The filters on a phone: one row of dropdowns, not two rows of
            pills running off the edge (owner, 26 September 2026: "the filter
            I dont like it, make it cleaner"). Each opens the phone's own
            picker; one that is set is marked, and Clear puts them all back.
          */}
          <div className="fms-dbfilterrow" role="group" aria-label="Filters">
            <FilterChip
              label="Type"
              value={filter}
              on={filter !== "all"}
              options={FILTERS.map((f) => ({
                id: f.id,
                label: f.id === "all" ? "All types" : f.id === "flagged" && flaggedCount > 0 ? `${f.label} (${flaggedCount})` : f.label,
              }))}
              onChange={(id) => { setFilter(id as FilterId); setLimit(PAGE); }}
            />
            <FilterChip
              label="Date"
              value={period}
              on={period !== "all"}
              options={PERIODS}
              onChange={(id) => { setPeriod(id as Period); setLimit(PAGE); }}
            />
            {years.length > 1 && (
              <FilterChip
                label="Year"
                value={String(year)}
                on={year !== "all"}
                options={[
                  { id: "all", label: "All years" },
                  ...[...years].reverse().map((y) => ({ id: String(y), label: String(y) })),
                ]}
                onChange={(id) => { setYear(id === "all" ? "all" : Number(id)); setLimit(PAGE); }}
              />
            )}
          </div>

          <SegmentedControl
            label="Type"
            scroll
            options={FILTERS.map((f) => ({
              id: f.id,
              label: f.id === "flagged" && flaggedCount > 0 ? `${f.label} (${flaggedCount})` : f.label,
            }))}
            value={filter}
            onChange={(id) => { setFilter(id); setLimit(PAGE); }}
          />
          {/* The workbook's one-tap searches: today, yesterday, the last 7 days, this month. */}
          <SegmentedControl
            label="Date"
            scroll
            options={PERIODS}
            value={period}
            onChange={(id) => { setPeriod(id); setLimit(PAGE); }}
          />
          {/*
            Once the ledger spans more than one year, which it does the moment
            an older year is imported. Before that it would be one pill that
            filters nothing.
          */}
          {years.length > 1 && (
            <SegmentedControl
              label="Year"
              scroll
              options={[
                { id: "all", label: "All years" },
                ...[...years].reverse().map((y) => ({ id: String(y), label: String(y) })),
              ]}
              value={String(year)}
              onChange={(id) => { setYear(id === "all" ? "all" : Number(id)); setLimit(PAGE); }}
            />
          )}
        </div>

        {/* Shown on a phone only: how many, and how to pick several. */}
        {picked.size === 0 && (
          <div className="t-micro fms-phone-note">
            <span>
              {rows.length.toLocaleString()} {rows.length === 1 ? "entry" : "entries"}
              {rows.length !== transactions.length && ` of ${transactions.length.toLocaleString()}`}
              {onDeleteMany && " · hold a row to pick several"}
            </span>
            {(filter !== "all" || period !== "all" || year !== "all") && (
              <button
                type="button"
                className="t-caption fms-linkbtn fms-filterclear"
                onClick={() => { setFilter("all"); setPeriod("all"); setYear("all"); setLimit(PAGE); }}
              >
                Clear filters
              </button>
            )}
          </div>
        )}

        {onDeleteMany && chosen.length > 0 && (
          /*
           * Sits under the search rather than floating over the rows.
           *
           * A bar that hovers covers the very rows you are deciding about,
           * on a phone especially, where it would sit on top of the last two
           * of them.
           */
          <div className="fms-bulkbar">
            <span className="t-body-strong">
              {chosen.length} selected
              <span className="t-caption" style={{ color: "var(--ink-2)" }}>
                {" "}
                · ₱{formatAmount(chosenTotal)}
              </span>
            </span>
            <span className="fms-bulkbar-actions">
              <Button size="sm" onClick={() => setPicked(new Set())}>
                Unselect
              </Button>
              <Button size="sm" variant="danger" onClick={() => void askDeleteMany(chosen)}>
                Move to bin
              </Button>
            </span>
          </div>
        )}

        {shown.length === 0 ? (
          <EmptyState
            message={
              query
                ? `No results for “${query}”. Check the spelling or clear the filters.`
                : "Nothing matches these filters."
            }
            action={
              (query || filter !== "all" || period !== "all") && (
                <Button onClick={() => { setQuery(""); setFilter("all"); setPeriod("all"); }}>
                  Clear filters
                </Button>
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
                {...(onDeleteMany
                  ? { selectedKeys: picked, onToggleRow: toggleRow, onToggleAll: toggleAll }
                  : {})}
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

            {/* Phone list: a row is tapped for what can be done with it, and held to pick it. */}
            <ul className={`fms-dblist${picked.size > 0 ? " fms-dblist--picking" : ""}`}>
              {shown.map((t) => {
                const issues = issuesById.get(t.id);
                const isPicked = picked.has(t.id);
                return (
                  <li key={t.id} className={`fms-dbrow${issues ? " fms-dbrow--warn" : ""}${isPicked ? " fms-dbrow--picked" : ""}`}>
                    <button
                      type="button"
                      className="fms-dbrow-tap"
                      aria-pressed={picked.size > 0 ? isPicked : undefined}
                      aria-label={`Record ${t.recordNumber}, ${t.item || t.type}, ${formatAmount(t.total)} pesos${picked.size > 0 ? "" : ". Opens what can be done with it."}`}
                      onPointerDown={(e) => {
                        if (onDeleteMany && e.pointerType !== "mouse") startPress(t, e.clientX, e.clientY);
                      }}
                      onPointerMove={(e) => movePress(e.clientX, e.clientY)}
                      onPointerUp={endPress}
                      onPointerCancel={() => {
                        endPress();
                        press.current = null;
                      }}
                      onContextMenu={(e) => {
                        // The browser's own long-press menu would cover the row being picked.
                        if (press.current) e.preventDefault();
                      }}
                      onClick={() => tapRow(t)}
                    >
                      <div className="fms-dbrow-main">
                        {picked.size > 0 && (
                          <span className={`fms-dbcheck${isPicked ? " fms-dbcheck--on" : ""}`} aria-hidden>
                            {isPicked && <Icon name="check" size={14} />}
                          </span>
                        )}
                        {/*
                          A title that says what the row is. Every transfer read
                          "Uncategorised", because a transfer has no item, and
                          the description under it repeated what the title should
                          have said. The figure takes its flow's colour, so a
                          transfer is grey (rule D3) rather than red.
                        */}
                        <div className="fms-dbrow-text">
                          <div className="fms-dbrow-title">
                            <span className="t-body-strong fms-truncate">{rowTitle(t)}</span>
                            {badge(t)}
                          </div>
                          {t.item.trim() && t.description.trim() && (
                            <div className="t-caption fms-truncate" style={{ color: "var(--ink-2)" }}>
                              {t.description}
                            </div>
                          )}
                          <div className="t-micro fms-truncate" style={{ color: "var(--ink-3)" }}>
                            #{String(t.recordNumber).padStart(4, "0")} · {formatShort(t.date)} · {walletPath(t)}
                          </div>
                        </div>
                        <div className="fms-dbrow-figure">
                          <Money value={t.type === "Revenue" ? t.total : -t.total} signed size="s" tone={toneOf(t)} />
                          {t.fee > 0 && (
                            <div className="t-micro" style={{ color: "var(--warn)" }}>
                              incl. {fmtShort(t.fee)} fee
                            </div>
                          )}
                        </div>
                      </div>
                      {issues?.map((i) => (
                        <p key={i.code} className="t-micro fms-dbrow-issue">
                          ⚠ {i.message}
                        </p>
                      ))}
                    </button>
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

            {/*
              What to do with the picked rows, pinned above the phone bar like
              the Save bar, the main action on the right under the thumb.
            */}
            {onDeleteMany && chosen.length > 0 && (
              <div className="fms-selbar" role="region" aria-label="Picked rows">
                <span className="fms-selbar-count">
                  <span className="t-body-strong">{chosen.length} picked</span>
                  <span className="t-caption" style={{ color: "var(--ink-2)" }}>
                    ₱{formatAmount(chosenTotal)}
                  </span>
                </span>
                <Button onClick={() => setPicked(new Set())}>Cancel</Button>
                <Button variant="danger" onClick={() => void askDeleteMany(chosen)}>
                  Move to bin
                </Button>
              </div>
            )}
          </>
        )}
      </Card>

      {opened && (
        <Sheet
          title={rowTitle(opened)}
          subtitle={`#${String(opened.recordNumber).padStart(4, "0")} · ${formatShort(opened.date)}`}
          onClose={() => setOpened(null)}
          actions={
            <>
              {onDelete && (
                <Button
                  variant="danger"
                  onClick={() => {
                    const t = opened;
                    setOpened(null);
                    void askDelete(t);
                  }}
                >
                  Move to bin
                </Button>
              )}
              {onEdit && (
                <Button
                  variant="primary"
                  onClick={() => {
                    const t = opened;
                    setOpened(null);
                    onEdit(t);
                  }}
                >
                  Correct
                </Button>
              )}
            </>
          }
        >
          <dl className="fms-rowfacts">
            <div>
              <dt>Amount</dt>
              <dd>
                <Money value={opened.type === "Revenue" ? opened.total : -opened.total} signed tone={toneOf(opened)} />
              </dd>
            </div>
            {opened.fee > 0 && (
              <div>
                <dt>Fee</dt>
                <dd className="fms-proposalmoney">{fmtShort(opened.fee)}</dd>
              </div>
            )}
            <div>
              <dt>Type</dt>
              <dd>{badge(opened)}</dd>
            </div>
            {walletPath(opened) && (
              <div>
                <dt>{opened.fromWallet && opened.toWallet ? "From, to" : opened.toWallet ? "Into" : "From"}</dt>
                <dd>{walletPath(opened)}</dd>
              </div>
            )}
            {opened.category.trim() && (
              <div>
                <dt>Category</dt>
                <dd>{opened.category}</dd>
              </div>
            )}
            {opened.description.trim() && (
              <div>
                <dt>Description</dt>
                <dd>{opened.description}</dd>
              </div>
            )}
            {opened.status.trim() && (
              <div>
                <dt>Status</dt>
                <dd>{opened.status}</dd>
              </div>
            )}
            {opened.notes.trim() && (
              <div>
                <dt>Notes</dt>
                <dd>{opened.notes}</dd>
              </div>
            )}
          </dl>
          {issuesById.get(opened.id)?.map((i) => (
            <p key={i.code} className="t-caption fms-dbrow-issue">
              ⚠ {i.message}
            </p>
          ))}
          {onDeleteMany && (
            <Button
              fullWidth
              variant="ghost"
              onClick={() => {
                toggleRow(opened.id);
                setOpened(null);
              }}
            >
              Pick this and others
            </Button>
          )}
        </Sheet>
      )}
    </div>
  );
}

/** What a row is, in its title: its item, else its description, else what kind of row it is. */
function rowTitle(t: Transaction): string {
  return (
    t.item.trim() ||
    t.description.trim() ||
    (t.type === "Transfer" ? (t.toWallet ? `To ${t.toWallet}` : "Sent to someone") : `${t.type}, no item`)
  );
}

/** The figure's colour is its flow's: a transfer is grey, debt amber (rule D3). */
function toneOf(t: Transaction): string {
  return t.type === "Revenue"
    ? "var(--flow-revenue-text)"
    : t.type === "Transfer"
      ? "var(--ink-2)"
      : t.type === "Debt"
        ? "var(--flow-debt-text)"
        : "var(--flow-spending-text)";
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
