/**
 * One filter as a dropdown chip, for a phone.
 *
 * The chosen option is its label, a tap opens the phone's own picker, and a
 * chip set away from its default is marked, so a filtered list never passes
 * for the whole of it. Rows of pills ran off the edge of the screen and read
 * as broken (owner, 26 September 2026: "the filter, make it cleaner"); a row
 * of these fits. Styled in layout.css (`.fms-filterchip`).
 */

import { Icon } from "./Icon";

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
  options: readonly { readonly id: string; readonly label: string }[];
  onChange: (id: string) => void;
}) {
  return (
    <label className={on ? "fms-filterchip is-on" : "fms-filterchip"}>
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      <Icon name="chevronDown" size={16} />
    </label>
  );
}

