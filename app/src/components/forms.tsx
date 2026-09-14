/**
 * Form controls: implements docs/04-STYLE-GUIDE.md §3.2.
 *
 * Field anatomy: label → help → control → error.
 * Labels are always visible; a placeholder shows format, never the label.
 *
 * ── Styled by class ───────────────────────────────────────────────────────
 *
 * These were styled inline, and the inline style set `outline: none` on every
 * field. That removed the only sign of which field had focus, and an inline
 * style cannot express hover, disabled, or the 16px a touch screen needs to
 * stop the page zooming in. `.fms-input` in layout.css carries all of it.
 */

import { useId, useState, type ReactNode } from "react";

import { formatAmount, parseAmount, type Centavos } from "../domain/money";
import { Icon } from "./Icon";

// ── Field wrapper ──────────────────────────────────────────────────────────

export function Field({
  label,
  help,
  error,
  required,
  optional,
  children,
  htmlFor,
}: {
  label: string;
  help?: string | undefined;
  error?: string | undefined;
  required?: boolean | undefined;
  optional?: boolean | undefined;
  children: ReactNode;
  htmlFor?: string | undefined;
}) {
  return (
    <div className="fms-field">
      <label htmlFor={htmlFor} className="t-label fms-field-label">
        {label}
        {required && <span style={{ color: "var(--over)" }}> *</span>}
        {optional && <span style={{ color: "var(--ink-3)" }}> (optional)</span>}
      </label>
      {children}
      {(error || help) && (
        <p
          className="t-caption fms-field-note"
          style={{ color: error ? "var(--over)" : "var(--ink-3)" }}
        >
          {error || help}
        </p>
      )}
    </div>
  );
}

// ── Text input ─────────────────────────────────────────────────────────────

export function TextInput({
  value,
  onChange,
  placeholder,
  invalid,
  disabled,
  id,
  describedBy,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string | undefined;
  invalid?: boolean | undefined;
  disabled?: boolean | undefined;
  id?: string | undefined;
  describedBy?: string | undefined;
  ariaLabel?: string | undefined;
}) {
  return (
    <input
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      aria-label={ariaLabel}
      className="t-body fms-input"
    />
  );
}

// ── Amount input, §3.2 "Amount input: special" ───────────────────────────

/**
 * Money field. Accepts "1,234.56" / "1234.56" / "₱1234", parses to integer
 * centavos on blur and reformats to 2dp. Numeric keypad on phone.
 * No spinner: a stepper makes no sense for arbitrary amounts.
 *
 * The figure is right-aligned and the ₱ sits on the left, so a long amount
 * grows towards the sign. The field reserves the sign's width on that side,
 * otherwise ₱1,234,567.89 was typed straight over the top of it.
 */
export function AmountInput({
  value,
  onChange,
  invalid,
  disabled,
  id,
  placeholder = "0.00",
  ariaLabel,
}: {
  value: Centavos | null;
  onChange: (v: Centavos | null) => void;
  invalid?: boolean | undefined;
  disabled?: boolean | undefined;
  id?: string | undefined;
  placeholder?: string | undefined;
  ariaLabel?: string | undefined;
}) {
  const [text, setText] = useState(() => (value === null ? "" : formatAmount(value)));
  const [focused, setFocused] = useState(false);

  /**
   * While you are not typing in it, the field shows what is actually saved.
   *
   * The text is local so you can type freely, but the moment focus leaves it
   * has no authority any more. Without this, a change the caller declines (a
   * cancelled confirmation, a failed validation) leaves the box displaying a
   * number the app never accepted, and typing that same number again reads as
   * no change at all, so it can never be retried.
   */
  const committed = value === null ? "" : formatAmount(value);
  if (!focused && text !== committed) setText(committed);

  return (
    <div className="fms-amount">
      <span aria-hidden className="t-num fms-amount-peso">
        ₱
      </span>
      <input
        id={id}
        value={text}
        inputMode="decimal"
        autoComplete="off"
        enterKeyHint="done"
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-label={ariaLabel}
        placeholder={placeholder}
        onFocus={() => setFocused(true)}
        onChange={(e) => {
          setText(e.target.value);
          if (focused) onChange(parseAmount(e.target.value));
        }}
        onBlur={() => {
          setFocused(false);
          const parsed = parseAmount(text);
          onChange(parsed);
          // Show what was typed for now. If the caller declines it, the
          // re-sync above puts the committed value back on the next render.
          setText(parsed === null ? "" : formatAmount(parsed));
        }}
        className="t-num fms-input fms-input--amount"
      />
    </div>
  );
}

// The Select lives in its own file: a native select cannot left-align its
// menu while centring its closed value, so it is a listbox now.
export { Select } from "./Select";

// ── Search ─────────────────────────────────────────────────────────────────

export function SearchInput({
  value,
  onChange,
  placeholder = "Search…",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string | undefined;
}) {
  return (
    <div className="fms-search">
      <span aria-hidden className="fms-search-icon">
        <Icon name="search" size={16} />
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onChange("")}
        placeholder={placeholder}
        aria-label={placeholder}
        enterKeyHint="search"
        autoComplete="off"
        className="t-body fms-input fms-search-input"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="fms-search-clear"
        >
          <Icon name="close" size={16} />
        </button>
      )}
    </div>
  );
}

// ── Checkbox, switch ───────────────────────────────────────────────────────

export function Checkbox({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: ReactNode;
  disabled?: boolean | undefined;
}) {
  const id = useId();
  return (
    <span className="fms-check">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label && (
        <label htmlFor={id} className="t-body" style={{ color: "var(--ink)" }}>
          {label}
        </label>
      )}
    </span>
  );
}

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className="fms-switch"
    >
      <span aria-hidden className="fms-switch-knob" />
    </button>
  );
}
