/**
 * Core UI primitives: implements docs/04-STYLE-GUIDE.md §3.1, 3.5, 3.6, 3.7, 3.10.
 *
 * Rules honoured: no hex literals (T1), colour only for flow and status,
 * 44px touch targets, three elevation levels, sentence-case labels.
 */

import type { CSSProperties, ReactNode } from "react";

import { formatAmount, type Centavos } from "../domain/money";

/** U+2212 MINUS SIGN, never a hyphen: style guide §2.2. */
const MINUS = "−";

// ── Flow ───────────────────────────────────────────────────────────────────

export type Flow = "revenue" | "spending" | "transfer" | "debt";

export const FLOW_LABEL: Record<Flow, string> = {
  revenue: "Revenue",
  spending: "Spending",
  transfer: "Transfer",
  debt: "Debt",
};

export type Status = "ok" | "over" | "warn" | "info" | "none";

// ── Money ──────────────────────────────────────────────────────────────────

export type NumSize = "xl" | "l" | "m" | "s";

const NUM_CLASS: Record<NumSize, string> = {
  xl: "t-num-xl",
  l: "t-num-l",
  m: "t-num",
  s: "t-num-s",
};

/**
 * Money. Tabular figures, 2dp always, ₱ muted, real minus sign, never blank.
 * Style guide §2.2.
 */
export function Money({
  value,
  size = "m",
  signed = false,
  tone,
  className = "",
  style,
}: {
  value: Centavos;
  size?: NumSize | undefined;
  signed?: boolean | undefined;
  tone?: string | undefined;
  className?: string | undefined;
  style?: CSSProperties | undefined;
}) {
  const negative = value < 0;
  const colour = tone ?? (negative ? "var(--over)" : "var(--ink)");

  return (
    <span className={`${NUM_CLASS[size]} ${className}`} style={{ color: colour, ...style }}>
      {negative ? MINUS : signed && value > 0 ? "+" : ""}
      <span className="peso">₱</span>
      {formatAmount(Math.abs(value))}
    </span>
  );
}

// ── Button, §3.1 ──────────────────────────────────────────────────────────

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const BTN_SIZE: Record<ButtonSize, { height: number; padding: string; font: string }> = {
  sm: { height: 32, padding: "0 12px", font: "t-caption" },
  md: { height: 40, padding: "0 16px", font: "t-body-strong" },
  lg: { height: 48, padding: "0 20px", font: "t-body-strong" },
};

export function Button({
  children,
  onClick,
  variant = "secondary",
  size = "md",
  disabled = false,
  loading = false,
  fullWidth = false,
  iconLeft,
  type = "button",
  ariaLabel,
}: {
  children?: ReactNode;
  onClick?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  iconLeft?: ReactNode;
  type?: "button" | "submit";
  ariaLabel?: string;
}) {
  const s = BTN_SIZE[size];

  const palette: Record<ButtonVariant, CSSProperties> = {
    primary: {
      background: "var(--brand-700)",
      color: "var(--on-brand)",
      border: "1px solid transparent",
    },
    secondary: {
      background: "var(--surface-sunk)",
      color: "var(--ink)",
      border: "1px solid var(--hairline)",
    },
    ghost: {
      background: "transparent",
      color: "var(--ink-2)",
      border: "1px solid transparent",
    },
    danger: {
      background: "var(--over-bg)",
      color: "var(--over)",
      border: "1px solid transparent",
    },
  };

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      aria-label={ariaLabel}
      aria-busy={loading || undefined}
      className={`${s.font} fms-btn fms-btn--${variant}`}
      style={{
        height: s.height,
        padding: s.padding,
        width: fullWidth ? "100%" : undefined,
        borderRadius: "var(--radius-md)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--space-2)",
        opacity: disabled ? 0.45 : 1,
        pointerEvents: disabled || loading ? "none" : undefined,
        transition: "background var(--motion-hover) var(--ease-out)",
        ...palette[variant],
      }}
    >
      {loading ? <Spinner /> : iconLeft}
      {children}
    </button>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      style={{
        width: 14,
        height: 14,
        borderRadius: "var(--radius-full)",
        border: "2px solid currentColor",
        borderTopColor: "transparent",
        animation: "fms-spin 700ms linear infinite",
        display: "inline-block",
      }}
    />
  );
}

// ── Badges, §3.6 ──────────────────────────────────────────────────────────

/** Flow badge: dot in the flow accent, label in flow text, on the flow wash. */
export function FlowBadge({ flow }: { flow: Flow }) {
  return (
    <span
      className="t-micro"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-2)",
        height: 22,
        padding: "0 var(--space-2)",
        borderRadius: "var(--radius-full)",
        background: `var(--flow-${flow}-bg)`,
        color: `var(--flow-${flow}-text)`,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 6,
          height: 6,
          borderRadius: "var(--radius-full)",
          background: `var(--flow-${flow})`,
        }}
      />
      {FLOW_LABEL[flow]}
    </span>
  );
}

export function StatusPill({ status, children }: { status: Status; children: ReactNode }) {
  return (
    <span
      className="t-micro"
      style={{
        display: "inline-flex",
        alignItems: "center",
        height: 22,
        padding: "0 var(--space-2)",
        borderRadius: "var(--radius-full)",
        background: `var(--${status}-bg)`,
        color: `var(--${status})`,
      }}
    >
      {children}
    </span>
  );
}

export function CountChip({ children }: { children: ReactNode }) {
  return (
    <span
      className="t-micro"
      style={{
        display: "inline-flex",
        alignItems: "center",
        height: 22,
        padding: "0 var(--space-2)",
        borderRadius: "var(--radius-full)",
        background: "var(--surface-sunk)",
        color: "var(--ink-2)",
      }}
    >
      {children}
    </span>
  );
}

/** Delta chip for KPI tiles: ▲ 3.5% / ▼ 2.1%. */
export function DeltaChip({ pct }: { pct: number }) {
  const up = pct >= 0;
  return (
    <span
      className="t-micro"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 2,
        height: 20,
        padding: "0 6px",
        borderRadius: "var(--radius-full)",
        background: up ? "var(--ok-bg)" : "var(--over-bg)",
        color: up ? "var(--ok)" : "var(--over)",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {up ? "▲" : "▼"} {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

// ── Card, §3.5 ────────────────────────────────────────────────────────────

export function Card({
  title,
  subtitle,
  action,
  children,
  padded = true,
  style,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  /** Set false when the body is a table that should meet the card edges. */
  padded?: boolean;
  style?: CSSProperties;
}) {
  return (
    <section
      style={{
        background: "var(--surface)",
        border: "1px solid var(--hairline)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow-card)",
        overflow: "hidden",
        ...style,
      }}
    >
      {(title || action) && (
        <header
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: "var(--space-4)",
            padding: "var(--space-5) var(--space-5) 0",
          }}
        >
          <div>
            {title && (
              <h2 className="t-display-m" style={{ margin: 0 }}>
                {title}
              </h2>
            )}
            {subtitle && (
              <p className="t-caption" style={{ margin: "2px 0 0", color: "var(--ink-3)" }}>
                {subtitle}
              </p>
            )}
          </div>
          {action}
        </header>
      )}
      <div style={padded ? { padding: "var(--space-5)" } : undefined}>{children}</div>
    </section>
  );
}

// ── KPI tile, §3.5 ────────────────────────────────────────────────────────

export interface KpiComponent {
  label: string;
  value: Centavos;
  tone?: string;
}

export function KpiTile({
  label,
  value,
  delta,
  components,
  footer,
  tone,
}: {
  label: string;
  value: Centavos;
  delta?: number | undefined;
  components?: readonly KpiComponent[] | undefined;
  footer?: ReactNode | undefined;
  tone?: string | undefined;
}) {
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--hairline)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow-card)",
        padding: "var(--space-5)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-2)",
        }}
      >
        <span className="t-label" style={{ color: "var(--ink-2)" }}>
          {label}
        </span>
        {delta !== undefined && <DeltaChip pct={delta} />}
      </div>

      <div style={{ marginTop: "var(--space-2)" }}>
        <Money value={value} size="xl" {...(tone ? { tone } : {})} />
      </div>

      {components && components.length > 0 && (
        <div
          className="t-caption"
          style={{
            marginTop: "var(--space-2)",
            display: "flex",
            flexWrap: "wrap",
            gap: "var(--space-1) var(--space-3)",
            color: "var(--ink-3)",
          }}
        >
          {components.map((c) => (
            <span key={c.label}>
              {c.label}{" "}
              <Money value={c.value} size="s" {...(c.tone ? { tone: c.tone } : {})} />
            </span>
          ))}
        </div>
      )}

      {footer && <div style={{ marginTop: "var(--space-3)" }}>{footer}</div>}
    </div>
  );
}

// ── Progress bar, §3.9 ────────────────────────────────────────────────────

export function ProgressBar({
  value,
  max,
  /** 0–1 through the period; draws the pace tick. */
  pace,
  height = 8,
}: {
  value: Centavos;
  max: Centavos;
  pace?: number;
  height?: number;
}) {
  const over = max > 0 && value > max;
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const tick = pace === undefined ? null : Math.min(100, Math.max(0, pace * 100));

  return (
    <div
      style={{
        position: "relative",
        height,
        background: "var(--surface-sunk)",
        borderRadius: "var(--radius-full)",
        overflow: "hidden",
      }}
      role="img"
      aria-label={
        max > 0
          ? `${formatAmount(value)} of ${formatAmount(max)} used`
          : "No budget set"
      }
    >
      <div
        style={{
          width: `${pct}%`,
          height: "100%",
          borderRadius: "var(--radius-full)",
          background: over ? "var(--over)" : "var(--ok)",
          transition: "width var(--motion-sheet) var(--ease-out)",
        }}
      />
      {tick !== null && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: `${tick}%`,
            width: 1,
            background: "var(--ink-3)",
          }}
        />
      )}
    </div>
  );
}

// ── Alerts, §3.7 ──────────────────────────────────────────────────────────

const ALERT_GLYPH: Record<Status, string> = {
  ok: "✓",
  over: "!",
  warn: "!",
  info: "i",
  none: "–",
};

export function Alert({
  status = "info",
  title,
  children,
  action,
}: {
  status?: Status;
  title?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      role={status === "over" ? "alert" : "status"}
      style={{
        display: "flex",
        gap: "var(--space-3)",
        padding: "var(--space-3)",
        borderRadius: "var(--radius-md)",
        background: `var(--${status}-bg)`,
        border: `1px solid color-mix(in srgb, var(--${status}) 28%, transparent)`,
      }}
    >
      <span
        aria-hidden
        className="t-micro"
        style={{
          flex: "0 0 auto",
          width: 18,
          height: 18,
          borderRadius: "var(--radius-full)",
          background: `var(--${status})`,
          color: "var(--surface)",
          display: "grid",
          placeItems: "center",
          fontWeight: 700,
        }}
      >
        {ALERT_GLYPH[status]}
      </span>
      <div style={{ minWidth: 0, flex: 1 }}>
        {title && (
          <div className="t-body-strong" style={{ color: `var(--${status})` }}>
            {title}
          </div>
        )}
        <div className="t-caption" style={{ color: "var(--ink-2)" }}>
          {children}
        </div>
        {action && <div style={{ marginTop: "var(--space-2)" }}>{action}</div>}
      </div>
    </div>
  );
}

/** Toast: §3.7. Max two lines, one action. */
export function Toast({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      role="status"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-4)",
        padding: "var(--space-3) var(--space-4)",
        borderRadius: "var(--radius-md)",
        background: "var(--surface)",
        border: "1px solid var(--hairline)",
        boxShadow: "var(--shadow-overlay)",
      }}
    >
      <span className="t-body">{children}</span>
      {action}
    </div>
  );
}

// ── Tabs & segmented control, §3.8 ────────────────────────────────────────

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: readonly { id: T; label: string; count?: number }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div
      role="tablist"
      style={{ display: "flex", gap: "var(--space-4)", borderBottom: "1px solid var(--hairline)" }}
    >
      {tabs.map((t) => {
        const active = t.id === value;
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.id)}
            className={active ? "t-body-strong" : "t-body"}
            style={{
              background: "none",
              border: "none",
              padding: "var(--space-3) 0",
              color: active ? "var(--ink)" : "var(--ink-2)",
              borderBottom: `2px solid ${active ? "var(--brand-700)" : "transparent"}`,
              marginBottom: -1,
              display: "inline-flex",
              alignItems: "center",
              gap: "var(--space-2)",
            }}
          >
            {t.label}
            {t.count !== undefined && <CountChip>{t.count}</CountChip>}
          </button>
        );
      })}
    </div>
  );
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div style={{ display: "inline-flex", flexWrap: "wrap", gap: "var(--space-2)" }}>
      {options.map((o) => {
        const active = o.id === value;
        return (
          <button
            key={o.id}
            aria-pressed={active}
            onClick={() => onChange(o.id)}
            className="t-caption"
            style={{
              height: 32,
              padding: "0 var(--space-3)",
              borderRadius: "var(--radius-full)",
              border: `1px solid ${active ? "transparent" : "var(--hairline-strong)"}`,
              background: active ? "var(--brand-700)" : "var(--surface)",
              color: active ? "var(--on-brand)" : "var(--ink-2)",
              fontWeight: active ? 600 : 400,
              transition: "background var(--motion-hover) var(--ease-out)",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Empty state, §3.10 ────────────────────────────────────────────────────

export function EmptyState({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <div style={{ padding: "var(--space-12) var(--space-4)", textAlign: "center" }}>
      <p className="t-body" style={{ margin: 0, color: "var(--ink-2)" }}>
        {message}
      </p>
      {action && <div style={{ marginTop: "var(--space-4)" }}>{action}</div>}
    </div>
  );
}

/** Loading placeholder: static block, never a shimmer. §3.10 */
export function Placeholder({ height = 20, width = "100%" }: { height?: number; width?: string }) {
  return (
    <span
      aria-hidden
      style={{
        display: "block",
        height,
        width,
        background: "var(--surface-sunk)",
        borderRadius: "var(--radius-sm)",
      }}
    />
  );
}
