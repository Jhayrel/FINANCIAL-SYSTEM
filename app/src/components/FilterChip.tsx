/**
 * One filter as a dropdown chip.
 *
 * The chosen option is its label, and a chip set away from its default is
 * marked, so a filtered list never passes for the whole of it. Rows of pills
 * ran off the edge of a phone and read as broken (owner, 26 September 2026:
 * "the filter, make it cleaner"); a row of these fits.
 *
 * On a phone a tap opens the phone's own picker. On a computer it opens the
 * app's own list (`Select`), the same as every other dropdown there: the
 * computer kept three stacked rows of pills, one of them a pill per year of
 * imported history (owner, 27 September 2026: "fix all the filters and
 * dropdown in the system"). Options can sit under headings, the way wallets
 * do everywhere else. Styled in layout.css (`.fms-filterchip`,
 * `.fms-filterselect`).
 */

import { Fragment } from "react";

import { useMediaQuery } from "../features/useMediaQuery";
import { Icon } from "./Icon";
import { Select } from "./Select";

export interface FilterOption {
  readonly id: string;
  readonly label: string;
  /** The heading it sits under; options sharing one are next to each other. */
  readonly group?: string | undefined;
}

export function FilterChip({
  label,
  value,
  on,
  options,
  onChange,
}: {
  label: string;
  value: string;
  on: boolean;
  options: readonly FilterOption[];
  onChange: (id: string) => void;
}) {
  const phone = useMediaQuery("(max-width: 639px)");

  if (!phone) {
    const labelOf = (id: string): string => options.find((o) => o.id === id)?.label ?? "";
    const groups = options.some((o) => o.group)
      ? Object.fromEntries(options.filter((o) => o.group).map((o) => [o.label, o.group!]))
      : undefined;
    return (
      <span className={on ? "fms-filterselect is-on" : "fms-filterselect"}>
        <Select
          value={labelOf(value)}
          options={options.map((o) => o.label)}
          groups={groups}
          ariaLabel={label}
          onChange={(picked) => {
            const found = options.find((o) => o.label === picked);
            if (found) onChange(found.id);
          }}
        />
      </span>
    );
  }

  // Consecutive options under one heading become one <optgroup>.
  const runs: { group: string | undefined; items: FilterOption[] }[] = [];
  for (const o of options) {
    const last = runs[runs.length - 1];
    if (last && last.group === o.group) last.items.push(o);
    else runs.push({ group: o.group, items: [o] });
  }
  const optionOf = (o: FilterOption) => (
    <option key={o.id} value={o.id}>
      {o.label}
    </option>
  );

  return (
    <label className={on ? "fms-filterchip is-on" : "fms-filterchip"}>
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {runs.map((run, i) =>
          run.group ? (
            <optgroup key={`${run.group}-${i}`} label={run.group}>
              {run.items.map(optionOf)}
            </optgroup>
          ) : (
            <Fragment key={`none-${i}`}>{run.items.map(optionOf)}</Fragment>
          ),
        )}
      </select>
      <Icon name="chevronDown" size={16} />
    </label>
  );
}
