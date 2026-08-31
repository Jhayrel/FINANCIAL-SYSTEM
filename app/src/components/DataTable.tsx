/**
 * Data table: implements docs/04-STYLE-GUIDE.md §3.4.
 *
 * Desktop: a real table, sticky header, hairline row dividers, no zebra.
 * Phone: the caller renders stacked rows instead, a table never scrolls
 * horizontally on a phone.
 */

import type { ReactNode } from "react";

export interface Column<T> {
  key: string;
  header: string;
  align?: "left" | "right";
  width?: string;
  render: (row: T) => ReactNode;
  sortable?: boolean;
}

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
    <div>
      <div className="scroll-slim" style={{ overflowX: "auto" }}>
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
         * rest to the one that did not ask, which is what makes the ellipsis
         * in `.fms-truncate` actually do something.
         */}
        <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
          <thead>
            <tr style={{ background: "var(--surface-sunk)" }}>
              {selectable && (
                <th style={{ width: 44, padding: "var(--space-3) 0 var(--space-3) var(--space-3)" }}>
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
                      style={{ width: 18, height: 18, accentColor: "var(--brand-700)", margin: 0 }}
                    />
                  )}
                </th>
              )}
              {columns.map((c) => {
                const active = sortKey === c.key;
                return (
                  <th
                    key={c.key}
                    className="t-th"
                    style={{
                      textAlign: c.align ?? "left",
                      width: c.width,
                      padding: "var(--space-3) var(--space-4)",
                      color: active ? "var(--ink)" : "var(--ink-2)",
                      whiteSpace: "nowrap",
                      borderBottom: "1px solid var(--hairline)",
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
                        onClick={() => onSort(c.key)}
                        className="t-th"
                        style={{
                          background: "none",
                          border: "none",
                          margin: "calc(var(--space-3) * -1) calc(var(--space-4) * -1)",
                          padding: "var(--space-3) var(--space-4)",
                          width: "calc(100% + var(--space-4) * 2)",
                          color: "inherit",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: c.align === "right" ? "flex-end" : "flex-start",
                          gap: 4,
                        }}
                      >
                        {c.header}
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
                   */
                  style={{
                    background: tone
                      ? `var(--${tone}-bg)`
                      : selected
                        ? "var(--surface-sunk)"
                        : "var(--surface)",
                    borderLeft: tone
                      ? `3px solid var(--${tone})`
                      : selected
                        ? "3px solid var(--ink-3)"
                        : "3px solid transparent",
                    cursor: onRowClick ? "pointer" : undefined,
                  }}
                >
                  {selectable && (
                    <td style={{ padding: "var(--space-3) 0 var(--space-3) var(--space-3)" }}>
                      <input
                        type="checkbox"
                        checked={selected ?? false}
                        onChange={() => onToggleRow?.(key)}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`Select row ${key}`}
                        style={{ width: 18, height: 18, accentColor: "var(--brand-700)", margin: 0 }}
                      />
                    </td>
                  )}
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      style={{
                        textAlign: c.align ?? "left",
                        padding: "var(--space-3) var(--space-4)",
                        borderBottom: "1px solid var(--hairline)",
                        verticalAlign: "middle",
                        maxWidth: c.width ?? 260,
                      }}
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
      {footer && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "var(--space-4)",
            padding: "var(--space-3) var(--space-4)",
            borderTop: "1px solid var(--hairline)",
          }}
        >
          {footer}
        </div>
      )}
    </div>
  );
}
