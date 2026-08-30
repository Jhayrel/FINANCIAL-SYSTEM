/**
 * Shared presentational pieces.
 *
 * Deliberately small and unopinionated: layout lives in the feature screens.
 */

import type { ReactNode } from "react";

import { formatMoney, type Centavos } from "../domain/money";

export function Card({
  title,
  action,
  children,
  className = "",
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-xl border shadow-sm ${className}`}
      style={{ background: "var(--surface)", borderColor: "var(--border)" }}
    >
      {title && (
        <header
          className="flex items-center justify-between gap-3 border-b px-4 py-3"
          style={{ borderColor: "var(--border)" }}
        >
          <h2 className="text-sm font-semibold tracking-wide uppercase" style={{ color: "var(--text-2)" }}>
            {title}
          </h2>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

/** A headline number with a label. */
export function Stat({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: Centavos | string;
  sub?: ReactNode;
  tone?: "neutral" | "good" | "bad" | "warn";
}) {
  const color =
    tone === "bad"
      ? "var(--danger)"
      : tone === "good"
        ? "var(--ok)"
        : tone === "warn"
          ? "var(--warn)"
          : "var(--text)";

  return (
    <div
      className="rounded-xl border px-4 py-3"
      style={{ background: "var(--surface)", borderColor: "var(--border)" }}
    >
      <div className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--text-3)" }}>
        {label}
      </div>
      <div className="tnum mt-1 text-xl font-semibold sm:text-2xl" style={{ color }}>
        {typeof value === "string" ? value : formatMoney(value)}
      </div>
      {sub && (
        <div className="mt-0.5 text-xs" style={{ color: "var(--text-3)" }}>
          {sub}
        </div>
      )}
    </div>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "good" | "bad" | "warn";
}) {
  const styles = {
    good: { background: "var(--ok-bg)", color: "var(--ok)" },
    bad: { background: "var(--danger-bg)", color: "var(--danger)" },
    warn: { background: "var(--warn-bg)", color: "var(--warn)" },
    neutral: { background: "var(--surface-3)", color: "var(--text-2)" },
  }[tone];

  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap"
      style={styles}
    >
      {children}
    </span>
  );
}

/** Horizontal proportion bar, used for budget usage and rankings. */
export function Bar({
  value,
  max,
  tone = "brand",
}: {
  value: number;
  max: number;
  tone?: "brand" | "danger" | "warn";
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const color =
    tone === "danger"
      ? "var(--danger)"
      : tone === "warn"
        ? "var(--warn)"
        : "var(--color-brand-500)";

  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full"
      style={{ background: "var(--surface-3)" }}
      role="presentation"
    >
      <div
        className="h-full rounded-full transition-[width] duration-500"
        style={{ width: `${pct}%`, background: color }}
      />
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: ReactNode }) {
  return (
    <div className="px-4 py-10 text-center">
      <p className="text-sm font-medium" style={{ color: "var(--text-2)" }}>
        {title}
      </p>
      {hint && (
        <p className="mx-auto mt-1 max-w-sm text-xs" style={{ color: "var(--text-3)" }}>
          {hint}
        </p>
      )}
    </div>
  );
}

/** Money, coloured by direction, right-aligned and tabular. */
export function Money({
  value,
  signed = false,
  className = "",
}: {
  value: Centavos;
  signed?: boolean;
  className?: string;
}) {
  const tone =
    !signed || value === 0
      ? "var(--text)"
      : value > 0
        ? "var(--ok)"
        : "var(--danger)";

  return (
    <span className={`tnum ${className}`} style={{ color: tone }}>
      {signed && value > 0 ? "+" : ""}
      {formatMoney(value)}
    </span>
  );
}
