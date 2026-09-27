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
 *
 * ── Read by pointing, opened by clicking ──────────────────────────────────
 *
 * The owner, 27 September 2026: make the charts interactable. A chart says
 * the shape and hides the figures, so every line and bar chart now reads out
 * the point under the pointer: a crosshair and a dot on the line, a band
 * behind the bars, and a small card beside it with each figure in full.
 *
 * A phone has no hover, so a tap does what pointing does and the card stays
 * until the next tap. Where a chart can open what it shows (a month on the
 * Dashboard opens that month in Insights), a click on a computer opens it at
 * once and the card on a phone carries the same action as a button, so the
 * first tap is always a reading and never a surprise jump. The arrow keys
 * move the reading along and Enter opens it.
 *
 * The card sits on the side of the crosshair with more room, so it never
 * covers the point it is describing and never runs off the chart.
 */

import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from "react";

import { formatAmount, formatMoney, toPesos, type Centavos } from "../domain/money";
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

// ── Reading a point ────────────────────────────────────────────────────────

/** What a pointer, a tap or a key is reading on a chart, and whether a tap pinned it. */
function useReading(count: number) {
  const [at, setAt] = useState<number | null>(null);
  const [pinned, setPinned] = useState(false);
  const touch = useRef(false);

  const clamp = (i: number): number => Math.max(0, Math.min(count - 1, i));
  return {
    at: at !== null && at < count ? at : null,
    pinned,
    touch,
    hover: (i: number): void => {
      if (!pinned) setAt(clamp(i));
    },
    tap: (i: number): void => {
      const next = clamp(i);
      if (pinned && at === next) {
        setPinned(false);
        setAt(null);
        return;
      }
      setPinned(true);
      setAt(next);
    },
    leave: (): void => {
      if (!pinned) setAt(null);
    },
    step: (by: number): void => {
      setPinned(true);
      setAt((prev) => clamp(prev === null ? (by > 0 ? 0 : count - 1) : prev + by));
    },
    clear: (): void => {
      setPinned(false);
      setAt(null);
    },
  };
}

type Reading = ReturnType<typeof useReading>;

export interface TipLine {
  readonly label: string;
  readonly value: Centavos;
  /** The mark's own colour, beside the words: the words stay in ink. */
  readonly colour?: string | undefined;
  readonly strong?: boolean | undefined;
  readonly signed?: boolean | undefined;
}

/**
 * The card beside the crosshair: a title, each figure in full, and what the
 * point opens, when it opens anything.
 */
function ChartTip({
  x,
  width,
  top,
  title,
  lines,
  note,
  action,
  onAction,
  onClose,
}: {
  x: number;
  width: number;
  top: number;
  title: string;
  lines: readonly TipLine[];
  note?: string | null | undefined;
  action?: string | undefined;
  onAction?: (() => void) | undefined;
  onClose?: (() => void) | undefined;
}) {
  // The side with more room, so the card never covers the point it describes.
  const right = x > width / 2;
  const style = right ? { right: Math.max(4, width - x + 12) } : { left: Math.min(width - 4, x + 12) };
  return (
    <div className="fms-charttip" style={{ ...style, top }} role="status" aria-live="polite">
      <div className="fms-charttip-head">
        <span className="t-label">{title}</span>
        {onClose && (
          <button type="button" className="fms-charttip-close" aria-label="Close the reading" onClick={onClose}>
            ×
          </button>
        )}
      </div>
      {lines.map((l) => (
        <div key={l.label} className={l.strong ? "fms-charttip-line is-strong" : "fms-charttip-line"}>
          <span className="fms-charttip-name">
            {l.colour && <span aria-hidden className="fms-charttip-key" style={{ background: l.colour }} />}
            {l.label}
          </span>
          <span className="fms-charttip-money">
            {l.signed && l.value > 0 ? "+" : ""}
            {formatMoney(l.value)}
          </span>
        </div>
      ))}
      {note && <div className="fms-charttip-note">{note}</div>}
      {action && onAction && (
        <button type="button" className="fms-charttip-go" onClick={onAction}>
          {action}
        </button>
      )}
    </div>
  );
}

/**
 * The pointer handlers every plotted chart shares.
 *
 * A mouse reads on move and opens on click. A finger reads on tap, and the
 * card it pins carries the action: `touch` remembers which the last press
 * was, because a tap also fires a click and must not open anything by itself.
 */
function pointerHandlers(
  reading: Reading,
  indexAt: (px: number) => number,
  onPick: ((i: number) => void) | undefined,
) {
  const where = (e: PointerEvent<SVGRectElement>): number => {
    const box = (e.currentTarget.ownerSVGElement ?? e.currentTarget).getBoundingClientRect();
    return indexAt(e.clientX - box.left);
  };
  return {
    onPointerDown: (e: PointerEvent<SVGRectElement>) => {
      reading.touch.current = e.pointerType !== "mouse";
    },
    onPointerMove: (e: PointerEvent<SVGRectElement>) => {
      if (e.pointerType === "mouse") reading.hover(where(e));
    },
    onPointerLeave: (e: PointerEvent<SVGRectElement>) => {
      if (e.pointerType === "mouse") reading.leave();
    },
    onClick: (e: React.MouseEvent<SVGRectElement>) => {
      const box = (e.currentTarget.ownerSVGElement ?? e.currentTarget).getBoundingClientRect();
      const i = indexAt(e.clientX - box.left);
      if (!reading.touch.current && onPick) onPick(i);
      else reading.tap(i);
    },
  };
}

/** Left and right read along, Home and End jump, Enter opens, Escape lets go. */
function keyHandler(reading: Reading, count: number, onPick: ((i: number) => void) | undefined) {
  return (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") reading.step(1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") reading.step(-1);
    else if (e.key === "Home") reading.step(-count);
    else if (e.key === "End") reading.step(count);
    else if (e.key === "Escape") reading.clear();
    else if (e.key === "Enter" && reading.at !== null && onPick) onPick(reading.at);
    else return;
    e.preventDefault();
  };
}

/** A label at the very edge anchors inward, so "Aug" is never cut to "Au". */
const anchorAt = (x: number, width: number): "start" | "middle" | "end" =>
  x < 18 ? "start" : x > width - 18 ? "end" : "middle";

// ── Area / line chart, §3.9 ───────────────────────────────────────────────

export interface Series {
  name: string;
  values: readonly Centavos[];
  colour: string;
  /** A reference line, such as a budget pace: dashed, with no fill under it. */
  guide?: boolean | undefined;
}

export function AreaChart({
  labels,
  series,
  height,
  titles,
  onPick,
  pickLabel,
  note,
  hidden: initiallyHidden,
}: {
  labels: readonly string[];
  series: readonly Series[];
  height?: number | undefined;
  /** The full name of each point for the reading: "March 2026" where the axis says "Mar". */
  titles?: readonly string[] | undefined;
  /** What a click on a point opens. */
  onPick?: ((index: number) => void) | undefined;
  /** The words on the button that opens it: "Open March". */
  pickLabel?: ((index: number) => string) | undefined;
  /** One more line under the figures: "Kept ₱1,200.00". */
  note?: ((index: number) => string | null) | undefined;
  /** Series switched off to begin with; the legend switches them back on. */
  hidden?: readonly string[] | undefined;
}) {
  const gid = useId();
  const [box, width] = useWidth<HTMLDivElement>();
  const [off, setOff] = useState<ReadonlySet<string>>(() => new Set(initiallyHidden ?? []));
  const reading = useReading(labels.length);

  const W = Math.max(width, 1);
  const H = height ?? heightFor(width);
  const padL = 40;
  const padR = 8;
  const padB = 24;
  const padT = 8;
  const innerW = Math.max(1, W - padL - padR);
  const innerH = H - padB - padT;

  const shown = series.filter((s) => !off.has(s.name));
  const all = series.flatMap((s) => s.values);
  const max = Math.max(1, ...shown.flatMap((s) => s.values));
  const single = labels.length < 2;
  const step = single ? 0 : innerW / (labels.length - 1);
  const every = Math.max(1, Math.ceil(labels.length / Math.max(1, Math.floor(innerW / LABEL_ROOM))));

  const y = (v: number) => padT + innerH - (v / max) * innerH;
  const x = (i: number) => (single ? padL + innerW / 2 : padL + i * step);
  const indexAt = (px: number): number => (single ? 0 : Math.round((px - padL) / step));

  const at = reading.at;
  const toggle = (name: string): void =>
    setOff((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      // One series always stays on: an empty chart reads as no data.
      else if (series.length - next.size > 1) next.add(name);
      return next;
    });

  return (
    <div
      ref={box}
      className="fms-plot"
      style={{ minWidth: 0 }}
      tabIndex={labels.length > 0 ? 0 : -1}
      aria-label={`${series.map((s) => s.name).join(" and ")} chart. Left and right arrows read each point${onPick ? ", Enter opens it" : ""}.`}
      onKeyDown={keyHandler(reading, labels.length, onPick)}
    >
      <ChartFrame height={H} empty={all.length === 0}>
        {width === 0 ? (
          <div style={{ height: H }} />
        ) : (
          <div className="fms-plotbox">
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
                  <text x={padL - 8} y={y(t) + 4} textAnchor="end" fill="var(--ink-3)" className="fms-axislabel">
                    {abbreviate(t)}
                  </text>
                </g>
              ))}

              {shown.map((s, si) => {
                const pts = s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ");
                const area = `${x(0)},${y(0)} ${pts} ${x(s.values.length - 1)},${y(0)}`;
                return (
                  <g key={s.name}>
                    {!single && !s.guide && <polygon points={area} fill={s.colour} opacity="0.12" />}
                    {!single && (
                      <polyline
                        points={pts}
                        fill="none"
                        stroke={s.colour}
                        strokeWidth={s.guide ? 1.5 : 2}
                        strokeDasharray={s.guide ? "5 4" : undefined}
                        strokeLinejoin="round"
                        strokeLinecap="round"
                        style={{ animation: `fms-draw 400ms var(--ease-out) ${si * 60}ms both` }}
                      />
                    )}
                    {single && <circle cx={x(0)} cy={y(s.values[0] ?? 0)} r="4" fill={s.colour} />}
                  </g>
                );
              })}

              {/* The point being read: a hairline down the full height, a ringed dot on each line. */}
              {at !== null && (
                <g aria-hidden>
                  <line x1={x(at)} x2={x(at)} y1={padT} y2={padT + innerH} stroke="var(--ink-3)" strokeWidth="1" />
                  {shown
                    .filter((s) => at < s.values.length)
                    .map((s) => (
                      <circle
                        key={s.name}
                        cx={x(at)}
                        cy={y(s.values[at] ?? 0)}
                        r="4.5"
                        fill={s.colour}
                        stroke="var(--surface)"
                        strokeWidth="2"
                      />
                    ))}
                </g>
              )}

              {labels.map((l, i) =>
                // Skip labels rather than rotating them.
                i % every === 0 ? (
                  <text
                    key={`${l}-${i}`}
                    x={x(i)}
                    y={H - 6}
                    textAnchor={anchorAt(x(i), W)}
                    fill={at === i ? "var(--ink)" : "var(--ink-3)"}
                    className="fms-axislabel"
                  >
                    {l}
                  </text>
                ) : null,
              )}

              {/* The whole plot is the target, so anywhere above a point reads it. */}
              {labels.length > 0 && (
                <rect
                  x={padL - (single ? innerW / 2 : step / 2)}
                  y={0}
                  width={innerW + (single ? innerW : step)}
                  height={H}
                  fill="transparent"
                  style={{ cursor: onPick ? "pointer" : "crosshair", touchAction: "pan-y" }}
                  {...pointerHandlers(reading, indexAt, onPick)}
                />
              )}
            </svg>
            {at !== null && (
              <ChartTip
                x={x(at)}
                width={W}
                top={padT}
                title={titles?.[at] ?? labels[at] ?? ""}
                // A series that stops early (spending so far, in a month still going) says nothing past its end.
                lines={shown
                  .filter((s) => at < s.values.length)
                  .map((s) => ({ label: s.name, value: s.values[at] ?? 0, colour: s.colour }))}
                note={note?.(at)}
                action={onPick && (reading.pinned || reading.touch.current) ? (pickLabel?.(at) ?? "Open") : undefined}
                onAction={onPick ? () => onPick(at) : undefined}
                onClose={reading.pinned ? reading.clear : undefined}
              />
            )}
          </div>
        )}
      </ChartFrame>

      <Legend
        items={series.map((s) => ({ label: s.name, colour: s.colour }))}
        {...(series.length > 1 ? { off, onToggle: toggle } : {})}
      />
      {series.map((s) => (
        <HiddenTable
          key={`${gid}-${s.name}`}
          caption={s.name}
          rows={s.values.map((v, i) => ({ label: titles?.[i] ?? labels[i] ?? String(i), value: v }))}
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
  titles,
  onPick,
  pickLabel,
}: {
  labels: readonly string[];
  budget: readonly Centavos[];
  actual: readonly Centavos[];
  height?: number | undefined;
  /** The full name of each month for the reading. */
  titles?: readonly string[] | undefined;
  /** What a click on a month opens. */
  onPick?: ((index: number) => void) | undefined;
  pickLabel?: ((index: number) => string) | undefined;
}) {
  const [box, width] = useWidth<HTMLDivElement>();
  const reading = useReading(labels.length);

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
  const indexAt = (px: number): number => Math.floor((px - padL) / slot);
  const at = reading.at;

  const tipFor = (i: number): { lines: TipLine[]; note: string | null } => {
    const b = budget[i] ?? 0;
    const a = actual[i] ?? 0;
    return {
      lines: [
        { label: "Budget", value: b, colour: "var(--hairline-strong)" },
        { label: "Spent", value: a, colour: a > b && b > 0 ? "var(--over)" : "var(--brand-700)" },
      ],
      note: b <= 0 ? "No budget set" : a > b ? `${formatMoney(a - b)} over` : `${formatMoney(b - a)} left`,
    };
  };

  return (
    <div
      ref={box}
      className="fms-plot"
      style={{ minWidth: 0 }}
      tabIndex={labels.length > 0 ? 0 : -1}
      aria-label={`Budget and spending chart. Left and right arrows read each month${onPick ? ", Enter opens it" : ""}.`}
      onKeyDown={keyHandler(reading, labels.length, onPick)}
    >
      <ChartFrame height={H} empty={labels.length === 0}>
        {width === 0 ? (
          <div style={{ height: H }} />
        ) : (
          <div className="fms-plotbox">
            <svg
              viewBox={`0 0 ${W} ${H}`}
              width={W}
              height={H}
              role="img"
              aria-label="Budget versus actual spending by month"
              style={{ display: "block" }}
            >
              {/* The month being read, as a quiet band behind its two bars. */}
              {at !== null && (
                <rect
                  aria-hidden
                  x={padL + slot * at + 1}
                  y={padT}
                  width={Math.max(0, slot - 2)}
                  height={innerH}
                  fill="var(--surface-sunk)"
                />
              )}

              {ticks(max).map((t) => (
                <g key={t}>
                  <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="var(--hairline)" strokeWidth="1" />
                  <text x={padL - 8} y={y(t) + 4} textAnchor="end" fill="var(--ink-3)" className="fms-axislabel">
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
                  <g key={`${l}-${i}`}>
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
                      <text
                        x={cx}
                        y={H - 6}
                        textAnchor={anchorAt(cx, W)}
                        fill={at === i ? "var(--ink)" : "var(--ink-3)"}
                        className="fms-axislabel"
                      >
                        {l}
                      </text>
                    )}
                  </g>
                );
              })}

              {labels.length > 0 && (
                <rect
                  x={padL}
                  y={0}
                  width={innerW}
                  height={H}
                  fill="transparent"
                  style={{ cursor: onPick ? "pointer" : "default", touchAction: "pan-y" }}
                  {...pointerHandlers(reading, indexAt, onPick)}
                />
              )}
            </svg>
            {at !== null && (
              <ChartTip
                x={padL + slot * at + slot / 2}
                width={W}
                top={padT}
                title={titles?.[at] ?? labels[at] ?? ""}
                {...tipFor(at)}
                action={onPick && (reading.pinned || reading.touch.current) ? (pickLabel?.(at) ?? "Open") : undefined}
                onAction={onPick ? () => onPick(at) : undefined}
                onClose={reading.pinned ? reading.clear : undefined}
              />
            )}
          </div>
        )}
      </ChartFrame>

      <Legend
        items={[
          { label: "Budget", colour: "var(--hairline)" },
          { label: "Spent", colour: "var(--brand-700)" },
          { label: "Over budget", colour: "var(--over)" },
        ]}
      />
      <HiddenTable
        caption="Spending by month"
        rows={labels.map((l, i) => ({ label: titles?.[i] ?? l, value: actual[i] ?? 0 }))}
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
  /** A line under the bar: "₱83.00 more than July". */
  hint?: string | undefined;
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
  onPick,
  active,
  total,
}: {
  rows: readonly RankRow[];
  max?: Centavos;
  /** What the rows are: money out, money in, moved, or owed. */
  flow?: Flow;
  /** Makes each row a button: what a click on it opens or narrows to. */
  onPick?: ((name: string) => void) | undefined;
  /** The row picked, drawn as picked. */
  active?: string | null | undefined;
  /** The whole the rows are part of, for each row's share. */
  total?: Centavos | undefined;
}) {
  const max = explicitMax ?? Math.max(1, ...rows.map(rowValue));

  return (
    <div className={onPick ? "fms-rankbars is-pickable" : "fms-rankbars"}>
      {rows.map((r, i) => {
        const value = rowValue(r);
        const share = total && total > 0 ? Math.round((value * 100) / total) : null;
        const body = (
          <>
            <div className="fms-rankhead">
              <span className="t-body fms-rankname">{r.name}</span>
              <span className="t-num-s" style={{ color: "var(--ink-2)" }}>
                <span className="peso">₱</span>
                {formatAmount(value)}
                {share !== null && <span className="t-micro fms-rankshare">{share < 1 ? "<1%" : `${share}%`}</span>}
              </span>
            </div>
            <div className="fms-ranktrack">
              <div
                style={{
                  width: `${Math.max(value > 0 ? 1.5 : 0, (value / max) * 100)}%`,
                  height: "100%",
                  borderRadius: "var(--radius-full)",
                  background: rankShade(flow, i, rows.length),
                }}
              />
            </div>
            {r.hint && <span className="t-micro fms-rankhint">{r.hint}</span>}
          </>
        );
        return onPick ? (
          <button
            key={r.name}
            type="button"
            className="fms-rankrow"
            aria-pressed={active === r.name}
            onClick={() => onPick(r.name)}
          >
            {body}
          </button>
        ) : (
          <div key={r.name} className="fms-rankrow">
            {body}
          </div>
        );
      })}
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
  off,
  onToggle,
}: {
  items: readonly { label: string; colour: string; value?: string }[];
  vertical?: boolean;
  /** Series switched off, when the legend switches them. */
  off?: ReadonlySet<string> | undefined;
  onToggle?: ((label: string) => void) | undefined;
}) {
  return (
    <ul
      className="fms-legend"
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
      {items.map((i) => {
        const key = (
          <span
            aria-hidden
            style={{ width: 8, height: 8, borderRadius: "var(--radius-full)", background: i.colour, flex: "0 0 auto" }}
          />
        );
        const value = i.value && (
          <span className="t-num-s" style={{ color: "var(--ink-3)" }}>
            <span className="peso">₱</span>
            {i.value}
          </span>
        );
        return (
          <li key={i.label} className="t-caption" style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", color: "var(--ink-2)", minWidth: 0 }}>
            {onToggle ? (
              // A series can be switched off to read the other at its own scale.
              <button
                type="button"
                className="t-caption fms-legendtoggle"
                aria-pressed={!off?.has(i.label)}
                title={off?.has(i.label) ? `Show ${i.label}` : `Hide ${i.label}`}
                onClick={() => onToggle(i.label)}
              >
                {key}
                {i.label}
              </button>
            ) : (
              <>
                {key}
                {i.label}
                {value}
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}
