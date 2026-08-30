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
  /** Status token name to tint a row, e.g. "warn" for a flagged record. */
  rowTone?: (row: T) => "warn" | "over" | undefined;
  onRowClick?: (row: T) => void;
  footer?: ReactNode;
}) {
  const selectable = Boolean(onToggleRow);

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
              {selectable && <th style={{ width: 44 }} />}
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
                      <button
                        onClick={() => onSort(c.key)}
                        className="t-th"
                        style={{
                          background: "none",
                          border: "none",
                          padding: 0,
                          color: "inherit",
                          display: "inline-flex",
                          alignItems: "center",
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
                  style={{
                    background: selected
                      ? "var(--brand-100)"
                      : tone
                        ? `var(--${tone}-bg)`
                        : "var(--surface)",
                    borderLeft: tone ? `3px solid var(--${tone})` : "3px solid transparent",
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
