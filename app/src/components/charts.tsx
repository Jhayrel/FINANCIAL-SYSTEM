/**
 * Charts: implements docs/04-STYLE-GUIDE.md §3.9.
 *
 * Hand-built SVG rather than a charting library, so every colour is a token
 * and nothing arrives with its own opinions about grids, fonts or tooltips.
 *
 * Shared rules: horizontal gridlines only, no axis lines, abbreviated money on
 * axes only, a visually-hidden data table on every chart, single mount
 * animation that reduced-motion disables.
 *
 * ── Drawn at the width they are shown ─────────────────────────────────────
 *
 * The line and bar charts were drawn on a fixed 640 unit canvas and stretched
 * to fit. On a phone that canvas is squeezed to about half, and everything on
 * it went with it: the 11px axis labels came out at 5px, and the area chart,
 * which stretched without keeping its proportions, drew its month names
 * squashed flat. Each chart now measures its box and draws at that size, so a
 * label is 11px on every screen and the number of month labels follows the
 * room there is for them.
 */

import { useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";

import { formatAmount, toPesos, type Centavos } from "../domain/money";
import type { Flow } from "./primitives";

/** Axis labels only: never in a table. §2.2 */
export function abbreviate(c: Centavos): string {
  const p = Math.abs(toPesos(c));
  const sign = c < 0 ? "−" : "";
  if (p >= 1_000_000) return `${sign}${(p / 1_000_000).toFixed(p >= 10_000_000 ? 0 : 1)}m`;
  if (p >= 1_000) return `${sign}${(p / 1_000).toFixed(p >= 10_000 ? 0 : 1)}k`;
  return `${sign}${p.toFixed(0)}`;
}

/** Style guide §3.9: 200px on a phone, 260px everywhere else. */
const heightFor = (width: number): number => (width < 480 ? 200 : 260);

/** Room one axis label needs before the next is skipped rather than overlapped. */
const LABEL_ROOM = 44;

/**
 * The width of a box, kept current.
 *
 * Read in a layout effect, so the first paint already has the real width and
 * the chart never flashes at a default size before settling.
 */
function useWidth<T extends Element>(): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = (): void => {
      const next = Math.floor(el.getBoundingClientRect().width);
      setWidth((prev) => (prev === next ? prev : next));
    };
    read();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}

function HiddenTable({
  caption,
  rows,
}: {
  caption: string;
  rows: readonly { label: string; value: Centavos }[];
}) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label}>
            <th scope="row">{r.label}</th>
            <td>{formatAmount(r.value)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Evenly spaced gridline values from 0 to max, in whole centavos.
 *
 * Rounded because these are passed to `abbreviate`, which goes through
 * `toPesos`, and that rejects fractional centavos by design. A fractional
 * tick is meaningless anyway: there is no such thing as a quarter of a
 * centavo.
 */
function ticks(max: Centavos, count = 4): Centavos[] {
  if (max <= 0) return [0];
  const step = max / count;
  return Array.from({ length: count + 1 }, (_, i) => Math.round(step * i));
}

function ChartFrame({
  height,
  children,
  empty,
}: {
  height: number;
  children: ReactNode;
  empty?: boolean;
}) {
  if (empty) {
    return (
      <div
        style={{ height, display: "grid", placeItems: "center", color: "var(--ink-3)" }}
        className="t-caption"
      >
        No data for this period.
      </div>
    );
  }
  return <>{children}</>;
}

// ── Sparkline, §3.9 ───────────────────────────────────────────────────────

export function Sparkline({
  values,
  width = 96,
  height = 32,
  tone = "var(--brand-700)",
}: {
  values: readonly number[];
  width?: number;
  height?: number;
  tone?: string;
}) {
  if (values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = width / (values.length - 1);

  const points = values.map((v, i) => {
    const x = i * step;
    const y = height - ((v - min) / span) * (height - 4) - 2;
    return [x, y] as const;
  });

  const d = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const last = points[points.length - 1]!;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden focusable="false">
      <path d={d} fill="none" stroke={tone} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r="2.5" fill={tone} />
    </svg>
  );
}

// ── Area / line chart, §3.9 ───────────────────────────────────────────────

export interface Series {
  name: string;
  values: readonly Centavos[];
  colour: string;
}

export function AreaChart({
  labels,
  series,
  height,
}: {
  labels: readonly string[];
  series: readonly Series[];
  height?: number;
}) {
  const gid = useId();
  const [box, width] = useWidth<HTMLDivElement>();

  const W = Math.max(width, 1);
  const H = height ?? heightFor(width);
  const padL = 40;
  const padR = 8;
  const padB = 24;
  const padT = 8;
  const innerW = Math.max(1, W - padL - padR);
  const innerH = H - padB - padT;

  const all = series.flatMap((s) => s.values);
  const max = Math.max(1, ...all);
  const step = labels.length > 1 ? innerW / (labels.length - 1) : innerW;
  const every = Math.max(1, Math.ceil(labels.length / Math.max(1, Math.floor(innerW / LABEL_ROOM))));

  const y = (v: number) => padT + innerH - (v / max) * innerH;
  const x = (i: number) => padL + i * step;

  return (
    <div ref={box} style={{ minWidth: 0 }}>
      <ChartFrame height={H} empty={all.length === 0}>
        {width === 0 ? (
          <div style={{ height: H }} />
        ) : (
          <svg
            viewBox={`0 0 ${W} ${H}`}
            width={W}
            height={H}
            role="img"
            aria-label={`${series.map((s) => s.name).join(" and ")} over ${labels.length} periods`}
            style={{ display: "block" }}
          >
            {/* Horizontal gridlines only. No vertical grid, no axis lines. */}
            {ticks(max).map((t) => (
              <g key={t}>
                <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="var(--hairline)" strokeWidth="1" />
                <text x={padL - 8} y={y(t) + 4} textAnchor="end" fill="var(--ink-3)" style={{ fontSize: 11 }}>
                  {abbreviate(t)}
                </text>
              </g>
            ))}

            {series.map((s, si) => {
              const pts = s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ");
              const area = `${padL},${y(0)} ${pts} ${x(s.values.length - 1)},${y(0)}`;
              return (
                <g key={s.name}>
                  <polygon points={area} fill={s.colour} opacity="0.12" />
                  <polyline
                    points={pts}
                    fill="none"
                    stroke={s.colour}
                    strokeWidth="2"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    style={{ animation: `fms-draw 400ms var(--ease-out) ${si * 60}ms both` }}
                  />
                </g>
              );
            })}

            {labels.map((l, i) =>
              // Skip labels rather than rotating them.
              i % every === 0 ? (
                <text key={l} x={x(i)} y={H - 6} textAnchor="middle" fill="var(--ink-3)" style={{ fontSize: 11 }}>
                  {l}
                </text>
              ) : null,
            )}
          </svg>
        )}
      </ChartFrame>

      <Legend items={series.map((s) => ({ label: s.name, colour: s.colour }))} />
      {series.map((s) => (
        <HiddenTable
          key={`${gid}-${s.name}`}
          caption={s.name}
          rows={s.values.map((v, i) => ({ label: labels[i] ?? String(i), value: v }))}
        />
      ))}
    </div>
  );
}

// ── Grouped bar chart, §3.9 ───────────────────────────────────────────────

export function BarChart({
  labels,
  budget,
  actual,
  height,
}: {
  labels: readonly string[];
  budget: readonly Centavos[];
  actual: readonly Centavos[];
  height?: number;
}) {
  const [box, width] = useWidth<HTMLDivElement>();

  const W = Math.max(width, 1);
  const H = height ?? heightFor(width);
  const padL = 40;
  const padR = 8;
  const padB = 24;
  const padT = 8;
  const innerW = Math.max(1, W - padL - padR);
  const innerH = H - padB - padT;

  const max = Math.max(1, ...budget, ...actual);
  const slot = innerW / Math.max(1, labels.length);
  const barW = Math.max(2, Math.min(18, slot * 0.34));
  const every = Math.max(1, Math.ceil(labels.length / Math.max(1, Math.floor(innerW / LABEL_ROOM))));

  const y = (v: number) => padT + innerH - (v / max) * innerH;

  return (
    <div ref={box} style={{ minWidth: 0 }}>
      <ChartFrame height={H} empty={labels.length === 0}>
        {width === 0 ? (
          <div style={{ height: H }} />
        ) : (
          <svg
            viewBox={`0 0 ${W} ${H}`}
            width={W}
            height={H}
            role="img"
            aria-label="Budget versus actual spending by month"
            style={{ display: "block" }}
          >
            {ticks(max).map((t) => (
              <g key={t}>
                <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="var(--hairline)" strokeWidth="1" />
                <text x={padL - 8} y={y(t) + 4} textAnchor="end" fill="var(--ink-3)" style={{ fontSize: 11 }}>
                  {abbreviate(t)}
                </text>
              </g>
            ))}

            {labels.map((l, i) => {
              const cx = padL + slot * i + slot / 2;
              const b = budget[i] ?? 0;
              const a = actual[i] ?? 0;
              const over = a > b && b > 0;
              return (
                <g key={l}>
                  <rect
                    x={cx - barW - 2}
                    y={y(b)}
                    width={barW}
                    height={Math.max(0, y(0) - y(b))}
                    fill="var(--hairline)"
                    rx="3"
                  />
                  <rect
                    x={cx + 2}
                    y={y(a)}
                    width={barW}
                    height={Math.max(0, y(0) - y(a))}
                    fill={over ? "var(--over)" : "var(--brand-700)"}
                    rx="3"
                  />
                  {i % every === 0 && (
                    <text x={cx} y={H - 6} textAnchor="middle" fill="var(--ink-3)" style={{ fontSize: 11 }}>
                      {l}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        )}
      </ChartFrame>

      <Legend
        items={[
          { label: "Budget", colour: "var(--hairline)" },
          { label: "Actual", colour: "var(--brand-700)" },
          { label: "Over budget", colour: "var(--over)" },
        ]}
      />
      <HiddenTable
        caption="Actual spending by month"
        rows={labels.map((l, i) => ({ label: l, value: actual[i] ?? 0 }))}
      />
    </div>
  );
}

// ── Horizontal ranking bars, §3.9 ─────────────────────────────────────────

/** Accepts either shape so domain rankings drop straight in. */
export interface RankRow {
  name: string;
  value?: Centavos;
  amount?: Centavos;
}

const rowValue = (r: RankRow): Centavos => r.value ?? r.amount ?? 0;

/**
 * One colour per panel, not one per row.
 *
 * These bars were the categorical palette, `--cat-1` down, so the largest
 * kind of spending in the month was drawn in green and the next in blue.
 * Green means money in (rule D3), and a ranking of what money went on is not
 * a composition of unrelated things: it is one flow, sorted. So the panel
 * names the flow and every bar is that colour, lightened a step at a time
 * down the ranking, which is the only thing the shade has to carry.
 *
 * The floor keeps the smallest bar visible against the track. 55 percent
 * was the first try and the contrast test refused it: 2.22:1 for revenue in
 * the light theme, against a 3:1 floor for something this size. 75 percent
 * clears it in both themes, so the ramp steps 4 points at a time and stops
 * there. Bar length carries the ranking; the shade only has to stay legible.
 */
/**
 * One flow, five steps, largest strongest.
 *
 * ── Two wrong answers before this one ──────────────────────────────────────
 *
 * The first was the categorical palette, a different hue per row, so the
 * largest kind of spending in a month was drawn in green. Green is money
 * coming in (rule D3), and a ranking of what money went on is one flow
 * sorted, not a set of unrelated things.
 *
 * The second was the flow colour at 100 down to 75 percent of itself. Honest,
 * and invisible: four percent between neighbours is nothing, so eight bars
 * read as one block of red, which is what the owner saw on 20 September 2026.
 *
 * The steps are hand-picked per flow and per theme in `tokens.css`, spread as
 * far apart as the 3:1 floor allows: deepest first in the light theme,
 * brightest first in the dark one. More rows than steps share the last one,
 * which is correct, because by then the bars are short enough that length is
 * doing the work.
 */
export const RAMP_STEPS = 5;

export function rampFor(flow: Flow, index: number, count: number): string {
  // Spread the steps over however many rows there are, so a chart of three
  // and a chart of nine both use the whole ramp.
  const spread = count <= 1 ? 0 : Math.round((Math.min(index, count - 1) / (count - 1)) * (RAMP_STEPS - 1));
  return `var(--ramp-${flow}-${spread + 1})`;
}

const rankShade = (flow: Flow, i: number, count: number): string => rampFor(flow, i, count);

export function RankBars({
  rows,
  max: explicitMax,
  flow = "spending",
}: {
  rows: readonly RankRow[];
  max?: Centavos;
  /** What the rows are: money out, money in, moved, or owed. */
  flow?: Flow;
}) {
  const max = explicitMax ?? Math.max(1, ...rows.map(rowValue));

  return (
    <div style={{ display: "grid", gap: "var(--space-3)", minWidth: 0 }}>
      {rows.map((r, i) => (
        <div key={r.name} style={{ minWidth: 0 }}>
          <div className="fms-rankhead">
            <span className="t-body fms-rankname">{r.name}</span>
            <span className="t-num-s" style={{ color: "var(--ink-2)" }}>
              <span className="peso">₱</span>
              {formatAmount(rowValue(r))}
            </span>
          </div>
          <div style={{ height: 8, background: "var(--surface-sunk)", borderRadius: "var(--radius-full)", overflow: "hidden" }}>
            <div
              style={{
                width: `${(rowValue(r) / max) * 100}%`,
                height: "100%",
                borderRadius: "var(--radius-full)",
                background: rankShade(flow, i, rows.length),
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Donut, §3.9 ───────────────────────────────────────────────────────────

export function DonutChart({
  slices,
  size = 180,
  centreLabel,
  flow = "spending",
}: {
  slices: readonly RankRow[];
  size?: number;
  centreLabel?: string;
  /** What the slices are made of. A composition is still one flow. */
  flow?: Flow;
}) {
  const total = slices.reduce((a, s) => a + rowValue(s), 0);
  const r = size / 2 - 10;
  const c = size / 2;
  const circumference = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-5)", flexWrap: "wrap" }}>
      <ChartFrame height={size} empty={total === 0}>
        <svg width={size} height={size} role="img" aria-label="Spending composition" style={{ maxWidth: "100%" }}>
          <g transform={`rotate(-90 ${c} ${c})`}>
            {slices.map((s, i) => {
              const frac = rowValue(s) / total;
              const dash = frac * circumference;
              const el = (
                <circle
                  key={s.name}
                  cx={c}
                  cy={c}
                  r={r}
                  fill="none"
                  stroke={rampFor(flow, i, slices.length)}
                  strokeWidth="20"
                  strokeDasharray={`${dash} ${circumference - dash}`}
                  strokeDashoffset={-offset}
                />
              );
              offset += dash;
              return el;
            })}
          </g>
          {centreLabel && (
            <text
              x={c}
              y={c + 5}
              textAnchor="middle"
              fill="var(--ink)"
              style={{ fontSize: 15, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}
            >
              {centreLabel}
            </text>
          )}
        </svg>
      </ChartFrame>

      <Legend
        vertical
        items={slices.map((s, i) => ({
          label: s.name,
          colour: rampFor(flow, i, slices.length),
          value: formatAmount(rowValue(s)),
        }))}
      />
      <HiddenTable caption="Spending composition" rows={slices.map((s) => ({ label: s.name, value: rowValue(s) }))} />
    </div>
  );
}

// ── Legend ─────────────────────────────────────────────────────────────────

function Legend({
  items,
  vertical = false,
}: {
  items: readonly { label: string; colour: string; value?: string }[];
  vertical?: boolean;
}) {
  return (
    <ul
      style={{
        listStyle: "none",
        margin: `var(--space-3) 0 0`,
        padding: 0,
        display: "flex",
        flexDirection: vertical ? "column" : "row",
        flexWrap: "wrap",
        gap: vertical ? "var(--space-2)" : "var(--space-2) var(--space-4)",
        minWidth: 0,
      }}
    >
      {items.map((i) => (
        <li key={i.label} className="t-caption" style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", color: "var(--ink-2)", minWidth: 0 }}>
          <span
            aria-hidden
            style={{ width: 8, height: 8, borderRadius: "var(--radius-full)", background: i.colour, flex: "0 0 auto" }}
          />
          {i.label}
          {i.value && (
            <span className="t-num-s" style={{ color: "var(--ink-3)" }}>
              <span className="peso">₱</span>
              {i.value}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
