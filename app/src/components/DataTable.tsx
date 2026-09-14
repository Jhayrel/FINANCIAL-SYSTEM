/**
 * Data table: implements docs/04-STYLE-GUIDE.md §3.4.
 *
 * Desktop: a real table, sticky header, hairline row dividers, no zebra.
 * Phone: the caller renders stacked rows instead, a table never scrolls
 * horizontally on a phone.
 *
 * ── Columns that step aside ───────────────────────────────────────────────
 *
 * The ledger has ten columns and a 1024px screen has room for about six of
 * them. With every column declaring a fixed width, the one that did not
 * declare one was handed whatever was left, and at 1024px that was nothing:
 * Description rendered zero pixels wide, and Total and Status spilled into
 * their neighbours.
 *
 * A column can now say `hideBelow`. The wrapper is a size container, so the
 * decision is made against the width of the table itself rather than the
 * window, and the columns that remain always have the room they asked for.
 */

import type { ReactNode } from "react";

export interface Column<T> {
  key: string;
  header: string;
  align?: "left" | "right";
  width?: string;
  render: (row: T) => ReactNode;
  sortable?: boolean;
  /**
   * Leave this column out when the table is narrower than this.
   *
   * `md` goes below 880px of table, `lg` below 1200px. Anything that must
   * stay visible when its column is gone should be shown inside another
   * column at the same width (the ledger's description sits under the item).
   */
  hideBelow?: "md" | "lg";
}

/** The class that hides a column, shared so a cell can opt in by itself. */
export const hideClass = (below: "md" | "lg" | undefined): string =>
  below ? `fms-dt-hide-${below}` : "";

export function DataTable<T>({
  columns,
  rows,
  getKey,
  sortKey,
  sortDir = "asc",
  onSort,
  selectedKeys,
  onToggleRow,
  onToggleAll,
  rowTone,
  onRowClick,
  footer,
}: {
  columns: readonly Column<T>[];
  rows: readonly T[];
  getKey: (row: T) => string;
  sortKey?: string;
  sortDir?: "asc" | "desc";
  onSort?: (key: string) => void;
  selectedKeys?: ReadonlySet<string>;
  onToggleRow?: (key: string) => void;
  /** Select or clear every row currently on screen, from the header cell. */
  onToggleAll?: (() => void) | undefined;
  /** Status token name to tint a row, e.g. "warn" for a flagged record. */
  rowTone?: (row: T) => "warn" | "over" | undefined;
  onRowClick?: (row: T) => void;
  footer?: ReactNode;
}) {
  const selectable = Boolean(onToggleRow);
  const selectedHere = selectedKeys ? rows.filter((r) => selectedKeys.has(getKey(r))).length : 0;
  const allHere = rows.length > 0 && selectedHere === rows.length;

  return (
    <div className="fms-dt">
      <div className="scroll-slim fms-dt-scroll">
        {/*
         * Fixed layout, so the declared widths are the widths.
         *
         * With automatic layout a cell's content sets a floor the column
         * cannot go below, so a long description held the table wider than
         * its container and the last column was cut off at the right edge.
         * Truncation could not help, because the cell had already won the
         * argument about how wide it needed to be.
         *
         * Fixed layout hands each column the width it asked for and gives the
         * rest to the ones that did not ask, which is what makes the ellipsis
         * in `.fms-truncate` actually do something.
         */}
        <table className="fms-dt-table">
          <thead>
            <tr>
              {selectable && (
                <th className="fms-dt-th fms-dt-pick">
                  {onToggleAll && (
                    /*
                     * Selects what is on screen, not what matches the filter.
                     *
                     * The table pages: 25 rows arrive, then 25 more. A tick
                     * that quietly took in four hundred rows you had not
                     * looked at, in the one place the next button moves them
                     * all to the bin, is not a convenience.
                     */
                    <input
                      type="checkbox"
                      checked={allHere}
                      ref={(el) => {
                        if (el) el.indeterminate = selectedHere > 0 && !allHere;
                      }}
                      onChange={onToggleAll}
                      aria-label={allHere ? "Clear selection" : "Select the rows on screen"}
                    />
                  )}
                </th>
              )}
              {columns.map((c) => {
                const active = sortKey === c.key;
                return (
                  <th
                    key={c.key}
                    className={`t-th fms-dt-th ${hideClass(c.hideBelow)}`}
                    style={{
                      textAlign: c.align ?? "left",
                      width: c.width,
                      color: active ? "var(--ink)" : "var(--ink-2)",
                    }}
                    aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : undefined}
                  >
                    {c.sortable && onSort ? (
                      /*
                       * The whole cell sorts, not just the word in it.
                       *
                       * As an inline button this was 14px tall: hard to hit
                       * with a mouse and impossible with a thumb, in the one
                       * place a mis-click costs you your place in 400 rows.
                       * Filling the cell also means the target matches what
                       * looks clickable, which is the header.
                       */
                      <button
                        type="button"
                        onClick={() => onSort(c.key)}
                        className="t-th fms-dt-sort"
                        style={{ justifyContent: c.align === "right" ? "flex-end" : "flex-start" }}
                      >
                        <span className="fms-dt-sortlabel">{c.header}</span>
                        <span aria-hidden style={{ color: active ? "var(--ink)" : "var(--ink-3)" }}>
                          {active ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
                        </span>
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const key = getKey(row);
              const tone = rowTone?.(row);
              const selected = selectedKeys?.has(key);

              return (
                <tr
                  key={key}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  /*
                   * A selected row is sunk, not tinted green.
                   *
                   * It used to take `--brand-100`, which in the dark theme is
                   * within a shade of `--flow-revenue-bg`: on the one screen
                   * where every row already carries a flow colour, selecting
                   * a Spending row made it look like income. Rule D3 spends
                   * colour on the direction of money and nothing else, so
                   * selection is a neutral sink plus the ticked box.
                   *
                   * A flag outranks a selection, because the flag is the part
                   * you did not already know.
                   *
                   * The edge is an inset shadow rather than a border. A 3px
                   * border on the row widened the first cell by 3px on flagged
                   * rows only, so their checkboxes sat out of line with every
                   * other row's.
                   */
                  style={{
                    background: tone
                      ? `var(--${tone}-bg)`
                      : selected
                        ? "var(--surface-sunk)"
                        : "var(--surface)",
                    boxShadow: tone
                      ? `inset 3px 0 0 var(--${tone})`
                      : selected
                        ? "inset 3px 0 0 var(--ink-3)"
                        : undefined,
                    cursor: onRowClick ? "pointer" : undefined,
                  }}
                >
                  {selectable && (
                    <td className="fms-dt-td fms-dt-pick">
                      <input
                        type="checkbox"
                        checked={selected ?? false}
                        onChange={() => onToggleRow?.(key)}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`Select row ${key}`}
                      />
                    </td>
                  )}
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={`fms-dt-td ${hideClass(c.hideBelow)}`}
                      style={{ textAlign: c.align ?? "left" }}
                    >
                      {c.render(row)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {footer && <div className="fms-dt-foot">{footer}</div>}
    </div>
  );
}
