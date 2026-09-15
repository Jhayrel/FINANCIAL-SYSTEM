/**
 * A year and a month, picked in one place.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * The screens that show a month used twelve loose pills and had no year at
 * all, so the ledger could only be read for the year on the calendar. A year
 * is a filter on one continuous ledger (docs/08, rule Y1): importing 2025 has
 * to make 2025 readable, and planning 2027 has to make 2027 reachable.
 *
 * One control: the year with a step either side, and the twelve months as a
 * single strip. Months with nothing in them are quieter and this month
 * carries a dot, so the strip says where the data is before anything is
 * clicked.
 */

import { useEffect, useRef } from "react";

import { MONTH_NAMES } from "../domain/dates";
import { Icon } from "./Icon";

export interface PeriodPickerProps {
  readonly year: number;
  readonly month: number;
  /** Oldest first. The steps stop at either end. */
  readonly years: readonly number[];
  readonly onChange: (year: number, month: number) => void;
  /** Months of the shown year with anything in them. The rest are shown quieter. */
  readonly active?: ReadonlySet<number> | undefined;
  /** Today's month, marked when it falls in the shown year. */
  readonly today?: { readonly year: number; readonly month: number } | undefined;
}

export function PeriodPicker({ year, month, years, onChange, active, today }: PeriodPickerProps) {
  const strip = useRef<HTMLDivElement>(null);

  // The chosen month stays in view where the strip scrolls. The strip moves, never the page.
  useEffect(() => {
    const el = strip.current;
    const on = el?.querySelector<HTMLElement>('[aria-checked="true"]');
    if (!el || !on || el.scrollWidth <= el.clientWidth) return;
    el.scrollTo({ left: Math.max(0, on.offsetLeft - (el.clientWidth - on.offsetWidth) / 2) });
  }, [year, month]);

  const at = years.indexOf(year);
  const earlier = at > 0 ? years[at - 1] : undefined;
  const later = at >= 0 && at < years.length - 1 ? years[at + 1] : undefined;

  return (
    <div className="fms-period">
      <div className="fms-period-year" role="group" aria-label="Year">
        <button
          type="button"
          className="fms-period-step"
          disabled={earlier === undefined}
          onClick={() => earlier !== undefined && onChange(earlier, month)}
          aria-label={earlier === undefined ? "No earlier year" : `Show ${earlier}`}
        >
          <Icon name="chevronLeft" size={18} />
        </button>
        <span className="t-body-strong fms-period-label" aria-live="polite">
          {year}
        </span>
        <button
          type="button"
          className="fms-period-step"
          disabled={later === undefined}
          onClick={() => later !== undefined && onChange(later, month)}
          aria-label={later === undefined ? "No later year" : `Show ${later}`}
        >
          <Icon name="chevronRight" size={18} />
        </button>
      </div>

      <div ref={strip} className="fms-period-months" role="radiogroup" aria-label={`Month of ${year}`}>
        {MONTH_NAMES.map((name, i) => {
          const m = i + 1;
          const on = m === month;
          const isToday = today !== undefined && today.year === year && today.month === m;
          const quiet = !on && active !== undefined && !active.has(m);
          return (
            <button
              key={name}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={`${name} ${year}${isToday ? ", this month" : ""}`}
              className={["fms-period-month", on && "is-on", quiet && "is-quiet"].filter(Boolean).join(" ")}
              onClick={() => onChange(year, m)}
            >
              <span className="t-caption">{name.slice(0, 3)}</span>
              {isToday && <span aria-hidden className="fms-period-dot" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
