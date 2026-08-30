/**
 * Form controls: implements docs/04-STYLE-GUIDE.md §3.2.
 *
 * Field anatomy: label → help → control → error.
 * Labels are always visible; a placeholder shows format, never the label.
 */

import { useId, useState, type CSSProperties, type ReactNode } from "react";

import { formatAmount, parseAmount, type Centavos } from "../domain/money";

const CONTROL_HEIGHT = 44;

function controlStyle(opts: {
  invalid?: boolean | undefined;
  disabled?: boolean | undefined;
  align?: "left" | "right";
  paddingLeft?: number;
}): CSSProperties {
  return {
    width: "100%",
    height: CONTROL_HEIGHT,
    paddingTop: 0,
    paddingBottom: 0,
    paddingLeft: opts.paddingLeft ?? "var(--space-3)",
    paddingRight: "var(--space-3)",
    textAlign: opts.align ?? "left",
    background: opts.disabled ? "var(--surface-sunk)" : "var(--surface)",
    color: opts.disabled ? "var(--ink-3)" : "var(--ink)",
    border: `1px solid ${opts.invalid ? "var(--over)" : "var(--hairline-strong)"}`,
    borderRadius: "var(--radius-md)",
    outline: "none",
  };
}

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
    <div>
      <label
        htmlFor={htmlFor}
        className="t-label"
        style={{ display: "block", color: "var(--ink-2)", marginBottom: "var(--space-2)" }}
      >
        {label}
        {required && <span style={{ color: "var(--over)" }}> *</span>}
        {optional && <span style={{ color: "var(--ink-3)" }}> (optional)</span>}
      </label>
      {children}
      {(error || help) && (
        <p
          className="t-caption"
          style={{ margin: "var(--space-2) 0 0", color: error ? "var(--over)" : "var(--ink-3)" }}
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
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string | undefined;
  invalid?: boolean | undefined;
  disabled?: boolean | undefined;
  id?: string | undefined;
  describedBy?: string | undefined;
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
      className="t-body"
      style={controlStyle({ ...(invalid !== undefined ? { invalid } : {}), ...(disabled !== undefined ? { disabled } : {}) })}
    />
  );
}

// ── Amount input, §3.2 "Amount input: special" ───────────────────────────

/**
 * Money field. Accepts "1,234.56" / "1234.56" / "₱1234", parses to integer
 * centavos on blur and reformats to 2dp. Numeric keypad on phone.
 * No spinner: a stepper makes no sense for arbitrary amounts.
 */
export function AmountInput({
  value,
  onChange,
  invalid,
  disabled,
  id,
  placeholder = "0.00",
}: {
  value: Centavos | null;
  onChange: (v: Centavos | null) => void;
  invalid?: boolean | undefined;
  disabled?: boolean | undefined;
  id?: string | undefined;
  placeholder?: string | undefined;
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
    <div style={{ position: "relative" }}>
      <span
        aria-hidden
        className="t-num"
        style={{
          position: "absolute",
          left: "var(--space-3)",
          top: "50%",
          transform: "translateY(-50%)",
          color: "var(--ink-3)",
          pointerEvents: "none",
        }}
      >
        ₱
      </span>
      <input
        id={id}
        value={text}
        inputMode="decimal"
        autoComplete="off"
        disabled={disabled}
        aria-invalid={invalid || undefined}
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
        className="t-num"
        style={controlStyle({
          ...(invalid !== undefined ? { invalid } : {}),
          ...(disabled !== undefined ? { disabled } : {}),
          align: "right",
        })}
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
    <div style={{ position: "relative", flex: 1, minWidth: 180 }}>
      <span
        aria-hidden
        style={{
          position: "absolute",
          left: "var(--space-3)",
          top: "50%",
          transform: "translateY(-50%)",
          color: "var(--ink-3)",
          lineHeight: 0,
        }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onChange("")}
        placeholder={placeholder}
        aria-label={placeholder}
        className="t-body"
        style={{ ...controlStyle({}), height: 40, paddingLeft: 36 }}
      />
      {value && (
        <button
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="t-caption"
          style={{
            position: "absolute",
            right: "var(--space-2)",
            top: "50%",
            transform: "translateY(-50%)",
            background: "none",
            border: "none",
            color: "var(--ink-3)",
            padding: "var(--space-1)",
          }}
        >
          ✕
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
    <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-2)" }}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        style={{ width: 18, height: 18, accentColor: "var(--brand-700)", margin: 0 }}
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
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      style={{
        width: 44,
        height: 24,
        borderRadius: "var(--radius-full)",
        border: "none",
        padding: 2,
        background: checked ? "var(--brand-700)" : "var(--hairline-strong)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: checked ? "flex-end" : "flex-start",
        transition: "background var(--motion-hover) var(--ease-out)",
      }}
    >
      <span
        style={{
          width: 20,
          height: 20,
          borderRadius: "var(--radius-full)",
          background: "var(--surface)",
          boxShadow: "var(--shadow-card)",
        }}
      />
    </button>
  );
}
