# FMS Style Guide

**Owner:** Jhayrel Garcia · **Version:** 1.1 (implemented) · **Date:** 29 Aug 2026

> **Status:** This supersedes Part 6 of `01-SYSTEM-REVIEW-AND-SPEC.md`.
> That part specified a heavy-ruled "ledger" look, 2px black rules, square
> corners, monospace money. It was built, reviewed and **rejected**.
> This document is the binding design contract. Nothing ships that contradicts it.

---

## 1. Principles

| # | Principle | What it means in practice |
|---|---|---|
| **P1** | **Calm by default** | White cards on a soft canvas. Hairline borders. One shallow shadow. The screen should feel quiet until something needs attention. |
| **P2** | **Colour means something** | Green/red/grey/amber encode *direction of money*. Never used to decorate. If you want visual interest, use space and hierarchy, not hue. |
| **P3** | **Numbers are the content** | Money is always right-aligned, tabular, 2 decimals. Columns line up. A figure is never truncated or abbreviated in a table. |
| **P4** | **Phone first** | Every screen designed at 360px before 1440px. 44px minimum touch target. Primary action within thumb reach. |
| **P5** | **Say what happened** | No "Something went wrong". No "No data". Every error names the cause and the fix. Every empty state names the next action. |

---

## 2. Foundations

### 2.1 Colour

All values are tokens in `src/styles/tokens.css`. **A hex literal may not appear anywhere else.**

#### Surfaces

| Token | Light | Dark | Use |
|---|---|---|---|
| `--paper` | `#F4F6F4` | `#0F120F` | App canvas behind everything |
| `--surface` | `#FFFFFF` | `#171B17` | Cards, tables, sheets, inputs |
| `--surface-sunk` | `#F2F4F2` | `#1F241F` | Progress tracks, inset panels, table head |
| `--surface-hover` | `#F8FAF8` | `#212721` | Row and item hover |
| `--hairline` | `#E5E8E4` | `#2A312A` | Card borders, cell borders |
| `--hairline-strong` | `#D0D6CE` | `#3A433A` | Dividers that must read as separation |

#### Ink

| Token | Light | Dark | Use | Min contrast |
|---|---|---|---|---|
| `--ink` | `#141A15` | `#E8EDE8` | Primary text, figures | 7:1 |
| `--ink-2` | `#4C554C` | `#A9B3A9` | Secondary text, labels | 7:1 |
| `--ink-3` | `#697269` | `#949E94` | Captions, placeholders, ₱ symbol | 4.5:1 |

> `--ink-2` and `--ink-3` were darkened from the values first drafted here.
> Measured, they came in at 6.84:1 and 4.46:1, both under their floor. The
> contrast test caught it; the guide records the corrected values.

#### Brand

| Token | Light | Dark | Use |
|---|---|---|---|
| `--brand-700` | `#2F6B21` | `#56A83A` | Primary button, active nav, links |
| `--brand-600` | `#3A7C27` | `#63B845` | Primary hover |
| `--brand-500` | `#55982F` | `#7DC95C` | Focus ring |
| `--brand-100` | `#DFF0D0` | `#223019` | Selected row, soft fill |
| `--brand-50` | `#F0F8EA` | `#1A2116` | Subtle wash |
| `--on-brand` | `#FFFFFF` | `#0F120F` | Text on a brand fill |

> The green is sampled from the Excel header. It stays the accent, not the background, a green header bar across every screen is what made the last build feel heavy.

#### Flow, the semantic core

Encodes **direction of money**. Nothing else may use these.

| Flow | Accent | Text | Wash | Glyph | Meaning |
|---|---|---|---|:--:|---|
| Revenue | `#1E7A3C` | `#14532D` | `#E7F5EC` | `↓` | Money in from outside. A gain. |
| Spending | `#B3261E` | `#8C1D18` | `#FCEAE9` | `↑` | Money out to outside. A loss. |
| Transfer | `#66705F` | `#434C3E` | `#EEF1EC` | `⇄` | Between your own wallets. **Grey, neither gain nor loss.** |
| Debt | `#9A5B12` | `#7A4409` | `#FBF0E2` | `◑` | Borrowed or lent. **Amber, a liability is not an expense.** |

#### Status

| Token | Light | Wash | Use |
|---|---|---|---|
| `--ok` | `#1E7A3C` | `#E7F5EC` | Within budget · Paid · Done · Settled |
| `--over` | `#B3261E` | `#FCEAE9` | Over budget · Overdue · Negative balance |
| `--warn` | `#8A5A00` | `#FDF3D8` | Due soon · Needs review · Approaching limit |
| `--info` | `#1F5F8B` | `#E8F1F8` | Neutral notice |
| `--none` | `#5E675E` | `#EFF1EE` | No budget set · Archived · Empty |

#### Contrast rules, enforced by test

`src/styles/contrast.test.ts` fails the build if any of these break:

- Every flow text on its own wash ≥ **4.5:1**, both themes
- Every status colour on its own wash ≥ **4.5:1**, both themes
- `--ink`, `--ink-2` ≥ **7:1** on surface, paper and sunk
- `--ink-3` ≥ **4.5:1** on surface, paper and sunk
- Focus ring ≥ **3:1** on surface
- `--on-brand` on `--brand-700` ≥ **4.5:1**

### 2.2 Typography

One face. Self-hosted via `@fontsource` so the PWA keeps its type offline.

| Role | Face | Why |
|---|---|---|
| Everything | **Inter** 400/500/600/700 | One face, weight and size carry the hierarchy. Clean, dense-data legible, and what the reference dashboards use. |

> **Money is set in Inter with `tabular-nums`, not monospace.** The monospace ledger look was rejected. Tabular figures give perfect column alignment without the typewriter feel.

#### Scale

| Token | Size/line | Weight | Face | Use |
|---|---|---:|---|---|
| `display-xl` | 36/40 | 700 | Inter | Hero figure, one per screen |
| `display-l` | 24/30 | 700 | Inter | Screen title |
| `display-m` | 18/24 | 600 | Inter | Card title |
| `body` | 14/20 | 400 | Inter | Default |
| `body-strong` | 14/20 | 600 | Inter | Emphasis, active nav |
| `caption` | 13/18 | 400 | Inter | Meta, help text |
| `label` | 12/16 | 500 | Inter | Field labels, table headers. **Sentence case, not uppercase.** |
| `micro` | 11/14 | 500 | Inter | Badges, chips |
| `num-xl` | 32/38 | 700 | Inter, tnum | KPI figure |
| `num-l` | 20/26 | 600 | Inter, tnum | Card figure |
| `num` | 14/20 | 500 | Inter, tnum | Table cell |

> Uppercase micro-labels are used **only** for table column headers. Everywhere else, sentence case. Uniform uppercase eyebrows were part of what made the last build feel generic.

#### Money rules

| Rule | Example |
|---|---|
| Always 2 decimals, always separators | `₱5,795.74` |
| ₱ muted (`--ink-3`), `0.15em` gap | ₱ then figure |
| Right-aligned in tables and stat blocks |, |
| `font-variant-numeric: tabular-nums` always |, |
| Negative uses a real minus `−` (U+2212) in `--over` | `−₱2,762.06` |
| Zero is `₱0.00`, never blank or `,` | `₱0.00` |
| `+` shown only where direction matters (ledger rows) | `+₱6,578.28` |
| Never abbreviate in a table (`₱52.4k` is banned) | `₱52,432.00` |
| Abbreviation allowed **only** on chart axes | `52k` |

### 2.3 Spacing & layout

4px base. Use tokens, never raw px.

| Token | px | Use |
|---|---:|---|
| `space-1` | 4 | Icon-to-text |
| `space-2` | 8 | Inside chips, tight stacks |
| `space-3` | 12 | Table cell padding, input padding |
| `space-4` | 16 | Card padding (phone), standard gap |
| `space-5` | 20 | Card padding (desktop) |
| `space-6` | 24 | Between cards |
| `space-8` | 32 | Screen padding (desktop) |
| `space-12` | 48 | Major section break |

| Breakpoint | Width | Layout |
|---|---|---|
| phone | < 640 | 1 column · bottom nav (5) · 16px padding |
| tablet | 640–1023 | 2 columns · bottom nav · 20px padding |
| desktop | ≥ 1024 | 240px sidebar + fluid · 32px padding · max 1440px |

### 2.4 Radius, borders, elevation

| Token | px | Use |
|---|---:|---|
| `radius-sm` | 6 | Chips, badges, small buttons |
| `radius-md` | 10 | Buttons, inputs, table container |
| `radius-lg` | 14 | Cards, modals, sheets |
| `radius-full` | 999 | Avatars, toggles, dot indicators |

Borders are `1px solid var(--hairline)`. Every card has one.

**Elevation: three levels, no more:**

| Token | Value | Use |
|---|---|---|
| `--shadow-card` | `0 1px 2px rgba(16,24,16,.05)` | Cards. Barely there. |
| `--shadow-raised` | `0 2px 8px rgba(16,24,16,.08)` | Dropdowns, popovers, hovered cards |
| `--shadow-overlay` | `0 12px 32px rgba(16,24,16,.16)` | Modals, bottom sheets |

> Banned: glows, coloured shadows, multiple stacked shadows, `shadow-2xl`.

### 2.5 Motion

| Interaction | Duration | Easing |
|---|---:|---|
| Hover / focus | 120ms | `ease-out` |
| Sheet / modal | 220ms | `cubic-bezier(.32,.72,0,1)` |
| Tab / accordion | 160ms | `ease-out` |
| Chart draw | 400ms | `ease-out`, once on mount |

`prefers-reduced-motion: reduce` → everything 0.01ms, charts render final state immediately.

**Banned:** page transitions, parallax, animated gradients, skeleton shimmer, bouncing, auto-carousels.

### 2.6 Icons

Single set, outline, 1.5px stroke, 20px default (16px in dense tables, 24px in nav). Icons never appear alone on a control unless the control also has an `aria-label`. **No emoji in the UI.**

---

## 3. Components

### 3.1 Buttons

| Variant | Fill | Border | Text | Use |
|---|---|---|---|---|
| **Primary** | `--brand-700` | none | `--on-brand` | The one main action per view |
| **Secondary** | `--surface` | `--hairline` | `--ink` | Everything else |
| **Ghost** | transparent | none | `--ink-2` | Tertiary, toolbar, row actions |
| **Danger** | `--surface` | `--over` | `--over` | Delete, permanent actions |

| Size | Height | Padding | Text | Use |
|---|---:|---|---|---|
| `sm` | 32 | 0 12px | 13/500 | Table row actions, toolbars |
| `md` | 40 | 0 16px | 14/600 | Default |
| `lg` | 48 | 0 20px | 15/600 | Primary form submit, phone |

**States:** hover → `--brand-600` (primary) or `--surface-hover` (others) · active → 1px translate down, no scale · focus-visible → 2px `--focus-ring`, 2px offset · disabled → 40% opacity, no pointer events · loading → spinner replaces label, width held.

**Rules**
- One primary per screen region. Two primaries side by side is a bug.
- Destructive actions are never primary-filled. Danger variant + confirmation.
- Order: primary rightmost on desktop, full-width stacked on phone with primary on top.
- Label is a verb: `Save transaction`, not `Submit`, `OK`, or `Yes`.
- Minimum 44px touch target on phone even at `sm` (pad the hit area, not the visual).

### 3.2 Inputs & forms

**Field anatomy** (top to bottom): label → optional help text → control → error or hint.

| Part | Spec |
|---|---|
| Label | `label` token, `--ink-2`, sentence case, always visible (no placeholder-only labels) |
| Control | 44px tall, `--surface`, 1px `--hairline`, `radius-md`, 12px padding |
| Placeholder | `--ink-3`, shows format not a repeat of the label, `0.00` not `Amount` |
| Help text | `caption`, `--ink-3`, below the control |
| Error | `caption`, `--over`, replaces help text, plus 1px `--over` border |
| Required | `*` after the label in `--over`; optional fields say `(optional)` instead |

**States:** default · hover (`--hairline-strong`) · focus (2px `--focus-ring`, offset 0, border transparent) · filled · error · disabled (`--surface-sunk`, `--ink-3`) · read-only (no border, `--ink`).

**Amount input: special**
- `inputmode="decimal"`, `autocomplete="off"`
- ₱ prefix inside the field, `--ink-3`, non-selectable
- Right-aligned, `num` token, tabular
- Accepts `1,234.56` / `1234.56` / `₱1234`; rejects letters silently (no keystroke rejection flash)
- Parsed to integer centavos on blur, reformatted to 2dp
- Never a spinner / stepper

**Select**: native on phone, custom listbox on desktop. Max 8 visible options then scroll. Type-ahead. Selected row uses `--brand-100`.

**Date**: native `date` input. Default today. Never a hand-rolled calendar on phone.

**Checkbox / radio**: 20px, `radius-sm` (checkbox) / `radius-full` (radio), `--brand-700` when checked. Label is clickable.

**Switch**: 44×24, `radius-full`. Only for settings that apply immediately. Anything needing Save uses a checkbox.

**Search**: leading search icon, clear button when non-empty, 200ms debounce, `Esc` clears.

**Form layout**
- One column. Two columns only on desktop for genuinely paired fields (from/to wallet).
- Group related fields with a 24px gap and a `display-m` subheading.
- Submit bar sticks to the bottom on phone, sits bottom-right on desktop.
- Validate on blur, not on keystroke. Re-validate on change once a field has errored.
- Never disable the submit button to indicate invalid, submit, then show errors and focus the first one.

### 3.3 Entry page (Add / Edit)

The most-used screen. Pattern:

1. **Flow picker**, four equal tiles (Revenue / Spending / Transfer / Debt), each in its flow colour, glyph above label. Selected tile gets a 2px flow-coloured border and its wash. This choice drives which fields render.
2. **Only the fields that flow needs.** Never a single form with disabled fields.
3. **Live running balance** under the wallet field: `Maya ₱5,795.74 → ₱4,695.74`, updating as the amount is typed. Turns `--over` if it goes negative.
4. **Autofill ghost text**, `--ink-3` inline suggestion; tap or `Tab` accepts.
5. **Inline warnings**, never blocking: negative balance, savings withdrawal, borrowing-looks-like-revenue, repay exceeds outstanding.
6. **Save** → toast `Saved. Record #0442.` with **Undo** for 6s.

### 3.4 Tables

Desktop is a real table. Phone is a stacked list of rows, never a horizontally scrolling table.

**Anatomy**

| Part | Spec |
|---|---|
| Container | `--surface`, 1px `--hairline`, `radius-lg`, `overflow: hidden` |
| Header | `--surface-sunk`, `micro` uppercase, `--ink-2`, 40px tall, sticky on scroll |
| Cell | 12px vertical padding, 16px horizontal, `body` |
| Divider | 1px `--hairline` between rows. **No zebra striping.** |
| Hover | `--surface-hover` (desktop only) |
| Selected | `--brand-100` fill, checkbox checked |
| Flagged | `--warn-bg` fill + `--warn` left border 3px |

**Alignment:** text left · numbers right · dates left · badges left · actions right. Header alignment always matches its column.

**Sort**: click header, chevron in `--ink-3`, active column header in `--ink`. One sort at a time.

**Row actions**: ghost icon buttons, revealed on hover on desktop, always visible on phone. Overflow into a `⋯` menu past two actions.

**Pagination**: `Showing 1–50 of 440` on the left, page controls right. Or `Show 100 more` for append-style lists. Virtualise past 200 rows.

**Density**: default 44px rows. A compact 36px mode is allowed on desktop only, remembered per table.

### 3.5 Cards & KPI tiles

**Card:** `--surface`, 1px `--hairline`, `radius-lg`, `--shadow-card`, 20px padding (16px phone). Header row = `display-m` title, optional right-side action or filter.

**KPI tile:**
```
Net worth                          ← label,  --ink-2
₱4,877.97                          ← num-xl, --ink
Wallets ₱6,112.45 · Debt −₱2,762.06 ← caption, components in flow colours
```
- Optional delta chip: `▲ 3.5%` in `--ok` / `▼ 2.1%` in `--over`, `micro` on the matching wash.
- Optional 40px sparkline bottom-right.
- **Net worth always shows its components.** Never a bare total.

### 3.6 Badges, chips, tags

| Type | Shape | Use |
|---|---|---|
| Flow badge | `radius-full`, wash bg, flow text, 6px dot in flow accent + label | Transaction type |
| Status pill | `radius-full`, status wash, status text | Paid, Over budget, Settled |
| Count chip | `radius-full`, `--surface-sunk`, `--ink-2` | `440 records`, filter counts |
| Filter pill | `radius-full`, unselected `--surface`+hairline, selected `--brand-700`+`--on-brand` | Segmented filters |

All badges: `micro`, 22px tall, 8px horizontal padding, never interactive unless clearly a filter.

### 3.7 Warnings, alerts, toasts, dialogs

**Inline alert** (inside a form or card): 1px border in the status colour, status wash, `radius-md`, 12px padding, 16px status icon, `body` text, optional action link. Used for the entry-form warnings.

**Page banner**: full width above content, same colours, dismissible only if informational. Overdue debt is persistent.

**Toast**: bottom-centre on phone, bottom-right on desktop. `--surface`, `--shadow-overlay`, `radius-md`, max 2 lines, auto-dismiss 6s, pauses on hover. Carries at most one action (`Undo`). Never stack more than 3.

**Confirm dialog**: for anything irreversible. Title states the action (`Delete record #0442?`), body states the consequence and where it goes (`It moves to the bin and can be restored.`), buttons `Cancel` (secondary) and the verb (`Delete`, danger). **Permanent deletion requires typing the record number to confirm.**

**Severity rules**

| Severity | Colour | When |
|---|---|---|
| Error | `--over` | Blocks the action, or money is wrong |
| Warning | `--warn` | Proceed-able but you should look |
| Info | `--info` | Neutral context |
| Success | `--ok` | Confirmation only, always transient |

**Copy rules**

| Bad | Good |
|---|---|
| Something went wrong | Couldn't save, you're offline. This will sync when you reconnect. |
| Invalid input | Amount must be more than ₱0.00. |
| Error 403 | Sign in again to continue. |
| Are you sure? | Delete record #0442? It moves to the bin and can be restored. |

### 3.8 Navigation

**Desktop sidebar**: 240px, `--surface`, 1px right hairline. Items 40px, `radius-md`, icon + label. Active: `--brand-100` fill, `--brand-700` text, `body-strong`. Hover: `--surface-hover`.

**Phone bottom nav**: 5 items max, 56px + safe area, `--surface`, 1px top hairline. Icon 24px + `micro` label. Active in `--brand-700`. The centre slot is a raised circular **＋** in `--brand-700`, 56px, `--shadow-raised`, the most-used action gets the best position.

**Tabs**: underline style, 2px `--brand-700` on the active tab, `--ink-2` inactive. For switching views of the same data.

**Segmented control**: pill group, used for filters (`All · Revenue · Spending · Transfer · Debt · Flagged`), not for navigation.

**Breadcrumb**: desktop only, `caption`, `--ink-3`, `/` separators.

### 3.9 Charts

Charts explain, they don't decorate. Every chart answers one question stated in its title.

**Shared rules**

| Rule | Spec |
|---|---|
| Container | Inside a card. Title `display-m`, optional period filter top-right. |
| Height | 200px phone, 260px desktop. Sparklines 40px. |
| Grid | Horizontal lines only, 1px `--hairline`. **No vertical gridlines.** |
| Axes | Labels in `caption` `--ink-3`. Y-axis abbreviated (`52k`). X-axis skips labels rather than rotating. |
| Axis lines | None, the gridline at zero is the baseline. |
| Tooltip | `--surface`, `--shadow-raised`, `radius-md`, 12px padding. Series name, exact **unabbreviated** money, date. Follows cursor on desktop, tap-to-pin on phone. |
| Legend | Below the chart, left-aligned, `caption`, 8px dot. Omitted for single-series. |
| Animation | 400ms on mount only. Never on data update, never looping. |
| Empty | `No data for this period.` centred in `--ink-3`, axes still drawn. |
| Accessibility | Every chart has a visually-hidden data table and an `aria-label` summary. Never colour alone, bars carry labels, lines carry direct end-labels. |

**Types and when to use them**

| Chart | Use for | Colour |
|---|---|---|
| **Line** | Balance or net worth over time | `--brand-700`, 2px, no point markers except the last |
| **Area** | Cash in vs cash out over time | Two lines, 12% opacity fill, revenue + spending flow colours |
| **Bar (vertical)** | Monthly comparison, budget vs actual | Budget `--hairline`, actual `--brand-700`, `--over` when over budget |
| **Bar (horizontal)** | Category ranking, top spending | `--cat-1…17` in rank order, labels inside if they fit, otherwise outside |
| **Donut** | Composition of one total, max 6 slices + Other | `--cat-*`, 60% inner radius, total in the centre |
| **Treemap** | Full spending breakdown | `--cat-*` by rank |
| **Sparkline** | Trend inside a KPI tile | `--brand-700` 1.5px, no axes, no grid, last point dotted |
| **Progress bar** | Budget usage | 8px, `radius-full`, track `--surface-sunk`, fill `--ok` → `--over` past 100%, 1px `--ink-3` tick at today's pro-rata pace |

**Category colours** are assigned by **annual rank**, fixed, so a category keeps its colour across every chart and render. Greens for ordinary life, ambers for discretionary, greys for leakage, `Unknown` is deliberately dull because it represents a gap.

**Banned:** 3D, pie charts with more than 6 slices, dual Y-axes, rainbow palettes, gradient fills beyond the single flat opacity above, chart junk (drop shadows on bars, textures).

### 3.10 Empty, loading, error states

**Empty**: centred, `body` `--ink-2` message naming the action, plus a primary button where an action exists.

| Screen | Copy |
|---|---|
| Ledger | `No transactions yet.` + `Add your first one` |
| Debt | `No debts tracked. Good place to be.` + `Add a debt` |
| Bin | `Nothing deleted. Deleted transactions stay here until you clear them.` |
| Review queue | `Nothing to review. All 440 rows check out.` |
| Budget | `No budget set for September.` + `Set it` |
| Search | `No results for "framelnk". Check the spelling or clear filters.` |

**Loading**: static hairline placeholder blocks at the final layout's dimensions, `--surface-sunk`, no shimmer, no spinner for content. Spinners only inside buttons.

**Error**: inline alert in place of the content, stating cause and offering `Try again`.

### 3.11 Modals & sheets

Desktop = centred modal, max 560px, `radius-lg`, `--shadow-overlay`, scrim `rgba(16,24,16,.4)`.
Phone = bottom sheet, full width, `radius-lg` top corners only, drag handle, swipe to dismiss.

Both: focus trapped, `Esc` closes, focus returns to the trigger, body scroll locked, title in `display-m`, actions bottom-right (desktop) / stacked full width (phone).

---

## 4. Content & voice

| Rule | Example |
|---|---|
| Sentence case everywhere except table headers | `Add transaction`, not `Add Transaction` |
| Buttons are verbs | `Save transaction`, `Delete`, `Add a debt` |
| Dates: `28 Aug 2026` in prose, `08/28/2026` in tables |, |
| Relative dates only within 7 days | `Yesterday`, `In 3 days` |
| Never "user" or "data" in user-facing copy | `your transactions`, not `user data` |
| Counts always exact | `440 records`, not `Many records` |
| No exclamation marks. No emoji. No apologies. |, |

---

## 5. Accessibility, non-negotiable

- Contrast floors in §2.1, enforced by test in both themes
- Every interactive element reachable and operable by keyboard; visible 2px focus ring
- 44px minimum touch target on phone
- Colour is never the only signal, pair with glyph, label or position
- Every icon-only control has an `aria-label`
- Form errors linked with `aria-describedby`, first error focused on submit
- Charts have a visually-hidden data table
- `prefers-reduced-motion` respected
- Live regions for toasts (`role="status"`) and errors (`role="alert"`)

---

## 6. Do / Don't

| Don't | Do |
|---|---|
| Green header bar on every screen | Green as an accent on actions and active states |
| Uppercase eyebrow labels everywhere | Sentence case; uppercase only for table headers |
| Monospace money | Public Sans with tabular figures |
| Heavy 2px black rules | 1px hairlines and whitespace |
| `shadow-lg` / stacked shadows | One of the three elevation tokens |
| Abbreviated money in tables | Full `₱52,432.00`; abbreviate only on chart axes |
| Colour for decoration | Colour only for flow and status |
| Disabled submit buttons | Always submit, then show and focus errors |
| Horizontally scrolling table on phone | Stacked list rows |
| "No data" | A sentence naming the next action |

---

## 7. Definition of done, every component

- [ ] Renders correctly at 360px and 1440px
- [ ] Both themes verified; contrast test passing
- [ ] Keyboard reachable, visible focus ring, logical tab order
- [ ] `prefers-reduced-motion` respected
- [ ] Loading, empty and error states designed, not just the happy path
- [ ] Money right-aligned, tabular, 2dp, ₱ muted
- [ ] No hex literal outside `tokens.css`
- [ ] Touch targets ≥ 44px on phone
- [ ] `npm run typecheck` and `npm test` clean

---

*Implemented in `src/styles/tokens.css`, `src/components/*` and `src/features/StyleGuide.tsx`.
111 contrast and lint assertions enforce this document in `src/styles/contrast.test.ts`.*
