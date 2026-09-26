/**
 * Core UI primitives: implements docs/04-STYLE-GUIDE.md §3.1, 3.5, 3.6, 3.7, 3.10.
 *
 * Rules honoured: no hex literals (T1), colour only for flow and status,
 * 44px touch targets, three elevation levels, sentence-case labels.
 *
 * ── Classes for structure, inline only for what varies ────────────────────
 *
 * Every primitive used to carry its whole look as an inline style. An inline
 * style cannot hold a hover, a focus ring, a media query or a container
 * query, and it outranks any class, so the hover rules written for buttons in
 * layout.css never once applied: the inline background beat them. Structure
 * lives in layout.css now. The only values set inline are the ones picked per
 * call, a flow's colour or a status's colour, which is what inline is for.
 */

import { useEffect, useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";

import { formatAmount, type Centavos } from "../domain/money";
import { Icon, type IconName } from "./Icon";

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
 * Shrink a figure to fit its box, and never grow it.
 *
 * A hero figure is set at 32px, which is right for ₱4,690.03 in a tile a third
 * of the screen wide and wrong for ₱1,234,567.89 in a tile a quarter wide: the
 * last digits ran out past the edge of the card. Truncating money is banned
 * (style guide §2.2) and abbreviating it would hide the centavos this app
 * exists to keep, so the figure gets smaller instead, only by as much as it
 * has to, and only when it has to.
 *
 * Measured rather than estimated from the number of characters, because a
 * comma is narrower than a digit and the font can still be loading on the
 * first paint.
 */
function useFitText<T extends HTMLElement>(enabled: boolean, content: unknown) {
  const ref = useRef<T>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    const box = el?.parentElement;
    if (!enabled || !el || !box) return;

    const fit = (): void => {
      el.style.fontSize = "";
      const pad = getComputedStyle(box);
      const room =
        box.clientWidth - parseFloat(pad.paddingLeft) - parseFloat(pad.paddingRight) - 1;
      const range = document.createRange();
      range.selectNodeContents(el);
      const needed = range.getBoundingClientRect().width;
      if (room <= 0 || needed <= room) return;

      const base = parseFloat(getComputedStyle(el).fontSize);
      // Past a little over half its size a hero figure stops reading as one.
      const scaled = Math.floor(((base * room) / needed) * 10) / 10;
      el.style.fontSize = `${Math.max(base * 0.55, scaled)}px`;
    };

    fit();

    let width = box.clientWidth;
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            // Height changes when the figure shrinks; only a new width matters.
            if (box.clientWidth === width) return;
            width = box.clientWidth;
            fit();
          });
    observer?.observe(box);
    // The typeface arriving changes every width, so measure once it has.
    void document.fonts?.ready.then(fit);

    return () => observer?.disconnect();
  }, [enabled, content]);

  return ref;
}

/**
 * Money. Tabular figures, 2dp always, ₱ muted, real minus sign, never blank.
 * Style guide §2.2.
 *
 * Hero and card sizes fit themselves to their box. Table sizes never shrink:
 * a column of figures only lines up when every one is the same size, and the
 * table makes room for them instead.
 */
export function Money({
  value,
  size = "m",
  signed = false,
  tone,
  className = "",
  style,
  fit,
}: {
  value: Centavos;
  size?: NumSize | undefined;
  signed?: boolean | undefined;
  tone?: string | undefined;
  className?: string | undefined;
  style?: CSSProperties | undefined;
  /** Shrink to fit the box. Defaults to on for `xl` and `l`. */
  fit?: boolean | undefined;
}) {
  const negative = value < 0;
  const colour = tone ?? (negative ? "var(--over)" : "var(--ink)");
  const ref = useFitText<HTMLSpanElement>(fit ?? (size === "xl" || size === "l"), value);

  return (
    <span ref={ref} className={`${NUM_CLASS[size]} ${className}`} style={{ color: colour, ...style }}>
      {negative ? MINUS : signed && value > 0 ? "+" : ""}
      <span className="peso">₱</span>
      {formatAmount(Math.abs(value))}
    </span>
  );
}

// ── Button, §3.1 ──────────────────────────────────────────────────────────

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

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
  title,
  tone,
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
  title?: string;
  /** A quiet button whose action removes something: it turns red on hover. */
  tone?: "danger";
}) {
  const classes = ["fms-btn", `fms-btn--${variant}`, `fms-btn--${size}`];
  if (fullWidth) classes.push("fms-btn--full");
  if (tone === "danger") classes.push("fms-btn--tone-danger");
  // An icon with no words is a square, so it lines up with the row it sits in.
  if (iconLeft && (children === undefined || children === null)) classes.push("fms-btn--icon");

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      aria-label={ariaLabel}
      aria-busy={loading || undefined}
      title={title}
      className={classes.join(" ")}
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
        flex: "0 0 auto",
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
export function FlowBadge({ flow, label }: { flow: Flow; label?: string | undefined }) {
  return (
    <span
      className="t-micro fms-badge"
      style={{ background: `var(--flow-${flow}-bg)`, color: `var(--flow-${flow}-text)` }}
    >
      <span aria-hidden className="fms-badge-dot" style={{ background: `var(--flow-${flow})` }} />
      {label ?? FLOW_LABEL[flow]}
    </span>
  );
}

export function StatusPill({ status, children }: { status: Status; children: ReactNode }) {
  return (
    <span
      className="t-micro fms-badge"
      style={{ background: `var(--${status}-bg)`, color: `var(--${status})` }}
    >
      {children}
    </span>
  );
}

export function CountChip({ children }: { children: ReactNode }) {
  return <span className="t-micro fms-badge fms-badge--count">{children}</span>;
}

/** Delta chip for KPI tiles: ▲ 3.5% / ▼ 2.1%. */
export function DeltaChip({ pct }: { pct: number }) {
  const up = pct >= 0;
  return (
    <span
      className="t-micro fms-badge"
      style={{
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

/**
 * A card measures itself.
 *
 * `.fms-section` is a size container, so what sits inside it (a table that
 * stacks into rows, a toolbar that wraps) answers to the width of the card and
 * not to the width of the window. The same card is half a 1440px screen on the
 * Dashboard and all of a 375px one on a phone, and a rule keyed to the window
 * gets one of those two wrong.
 */
export function Card({
  title,
  subtitle,
  action,
  children,
  padded = true,
  page = false,
  style,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  /** Set false when the body is a table that should meet the card edges. */
  padded?: boolean;
  /**
   * The screen's own container rather than one card among several.
   *
   * On a phone it is the page: no border, edge to edge, and its title, which
   * the top bar already says, is left out. A card inside a padded page inside
   * a screen read as a computer's screen shrunk (owner, 26 September 2026).
   */
  page?: boolean;
  style?: CSSProperties;
}) {
  return (
    <section className={page ? "fms-section fms-section--page" : "fms-section"} style={style}>
      {(title || action) && (
        <header className="fms-section-head">
          <div className="fms-section-titles">
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
          {action && <div className="fms-section-action">{action}</div>}
        </header>
      )}
      <div className={padded ? "fms-section-body" : "fms-section-flush"}>{children}</div>
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
    <div className="fms-kpi">
      <div className="fms-kpihead">
        <span className="t-label" style={{ color: "var(--ink-2)" }}>
          {label}
        </span>
        {delta !== undefined && <DeltaChip pct={delta} />}
      </div>

      <div className="fms-kpivalue">
        <Money value={value} size="xl" {...(tone ? { tone } : {})} />
      </div>

      {components && components.length > 0 && (
        <div className="t-caption fms-kpiparts">
          {components.map((c) => (
            <span key={c.label}>
              {c.label} <Money value={c.value} size="s" {...(c.tone ? { tone: c.tone } : {})} />
            </span>
          ))}
        </div>
      )}

      {footer && <div className="fms-kpifootslot">{footer}</div>}
    </div>
  );
}

// ── Progress bar, §3.9 ────────────────────────────────────────────────────

export function ProgressBar({
  value,
  max,
  /** 0 to 1 through the period; draws the pace tick. */
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
  // No budget, no pace: a tick on an empty track said "you are here" on nothing.
  const tick = pace === undefined || max <= 0 ? null : Math.min(100, Math.max(0, pace * 100));

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

/*
 * The status in a word, where a coloured glyph used to be.
 *
 * A round badge with a tick or an exclamation mark in it said "this is an
 * alert" and nothing else: the colour was the only content, and to anyone
 * who cannot separate the two colours it was a dot. The word carries it
 * instead, and the rule beside it carries the colour.
 */
/** Said to a screen reader in front of the title: the icon carries it for the eye. */
const ALERT_WORD: Record<Status, string> = {
  ok: "Done",
  over: "Problem",
  warn: "Check",
  info: "Note",
  none: "Note",
};

const STATUS_ICON: Record<Status, IconName> = {
  ok: "statusOk",
  over: "statusOver",
  warn: "statusWarn",
  info: "statusInfo",
  none: "statusInfo",
};

/**
 * A note inside a screen: §3.7, inline alert.
 *
 * ── The fourth look, and why it is this one ──────────────────────────────
 *
 * It has been a washed box with a coloured border ("looked generated", 20
 * September 2026), then a 2px rule with a status word in front of the title,
 * then the same on two lines ("a shape cut out and fitted in", 26 September
 * 2026, twice). Each of those made the notice louder than the page it sat
 * on: colour across its whole area, or a coloured word shouting the category
 * before the sentence said anything.
 *
 * It is now what the rest of the app is made of. A quiet panel on the sunk
 * surface with a hairline, the corner radius every input has, and the status
 * in one place only, a small icon in the status colour whose shape also says
 * it (a tick, a triangle, a bar, an i), so it reads without colour too. The
 * title and the sentence are ordinary ink. Nothing about it says "alert"
 * except what it says.
 *
 * The status word is still there for a screen reader, in front of the title.
 */
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
      className="fms-alert"
      style={{ "--alert-tone": `var(--${status})` } as CSSProperties}
    >
      <span className="fms-alert-icon" aria-hidden>
        <Icon name={STATUS_ICON[status]} size={18} />
      </span>
      <div className="fms-alert-body">
        {title ? (
          <p className="t-body-strong fms-alert-title">
            <span className="sr-only">{ALERT_WORD[status]}: </span>
            {title}
          </p>
        ) : (
          <span className="sr-only">{ALERT_WORD[status]}: </span>
        )}
        <div className="t-caption fms-alert-text">{children}</div>
      </div>
      {action && <div className="fms-alert-action">{action}</div>}
    </div>
  );
}

/**
 * A notice over the page: §3.7, toast, and every notice that floats.
 *
 * One object for all of them: "Saved. Record #0442." with Undo, the newer
 * version waiting, a change the database refused, the connection going.
 * They were three different things drawn three different ways, one of them a
 * band across the top of the page that pushed everything down.
 *
 * A card like the other cards: the surface, a hairline, the overlay shadow
 * a floating thing is allowed (§2.4), the status icon, the title, one line
 * under it, and at most a couple of buttons. It can always be closed.
 *
 * `timeout` makes it go by itself, and the clock stops while the pointer is
 * on it or it has focus (§3.7: "pauses on hover"), so a notice being read or
 * reached for is never taken away mid-reach.
 */
export function Notice({
  status = "info",
  title,
  children,
  action,
  onDismiss,
  timeout,
}: {
  status?: Status;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  onDismiss?: () => void;
  /** Milliseconds before it goes by itself. Absent: it stays until closed. */
  timeout?: number;
}) {
  const held = useRef(false);
  const left = useRef(timeout ?? 0);
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;

  useEffect(() => {
    if (!timeout) return;
    let last = Date.now();
    const tick = window.setInterval(() => {
      const now = Date.now();
      if (!held.current) left.current -= now - last;
      last = now;
      if (left.current <= 0) {
        window.clearInterval(tick);
        dismiss.current?.();
      }
    }, 250);
    return () => window.clearInterval(tick);
  }, [timeout]);

  const hold = (on: boolean) => () => {
    held.current = on;
  };

  return (
    <div
      role={status === "over" ? "alert" : "status"}
      // A one-line confirmation keeps its button on the same line, the way a toast reads.
      className={`fms-notice${children ? "" : " fms-notice--line"}`}
      style={{ "--alert-tone": `var(--${status})` } as CSSProperties}
      onPointerEnter={hold(true)}
      onPointerLeave={hold(false)}
      onFocus={hold(true)}
      onBlur={hold(false)}
    >
      <span className="fms-alert-icon" aria-hidden>
        <Icon name={STATUS_ICON[status]} size={18} />
      </span>
      <div className="fms-notice-body">
        <p className="t-body-strong fms-notice-title">
          <span className="sr-only">{ALERT_WORD[status]}: </span>
          {title}
        </p>
        {children && <div className="t-caption fms-notice-text">{children}</div>}
        {action && <div className="fms-notice-actions">{action}</div>}
      </div>
      {onDismiss && (
        <button type="button" className="fms-notice-close" aria-label="Close this notice" onClick={onDismiss}>
          <Icon name="close" size={16} />
        </button>
      )}
    </div>
  );
}

/** Toast: §3.7. A notice that goes by itself after six seconds. */
export function Toast({
  children,
  action,
  onDismiss,
}: {
  children: ReactNode;
  action?: ReactNode;
  onDismiss?: () => void;
}) {
  return (
    <Notice status="ok" title={children} action={action} {...(onDismiss ? { onDismiss, timeout: 6000 } : {})} />
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
    <div role="tablist" className="fms-linetabs">
      {tabs.map((t) => {
        const active = t.id === value;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.id)}
            className={`fms-linetab ${active ? "t-body-strong" : "t-body"}`}
          >
            {t.label}
            {t.count !== undefined && <CountChip>{t.count}</CountChip>}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Filter pills, §3.6 and §3.8.
 *
 * They wrap onto a second line by default. `scroll` keeps them on one line
 * that scrolls sideways instead, for a set that would otherwise stack three
 * rows deep on a phone (twelve months), and brings the chosen one into view.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  scroll = false,
  label,
}: {
  options: readonly { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  scroll?: boolean;
  label?: string;
}) {
  const strip = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = strip.current;
    const on = el?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!scroll || !el || !on) return;
    // The strip scrolls, never the page. `scrollIntoView` would also move the
    // main column, which is the scroll position you were reading from.
    el.scrollTo({ left: Math.max(0, on.offsetLeft - (el.clientWidth - on.offsetWidth) / 2) });
  }, [scroll, value]);

  return (
    <div
      ref={strip}
      role="group"
      aria-label={label}
      className={scroll ? "fms-pills fms-pills--scroll" : "fms-pills"}
    >
      {options.map((o) => {
        const active = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.id)}
            className={active ? "t-caption fms-pill fms-pill--on" : "t-caption fms-pill"}
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
    <div className="fms-empty">
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
