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
| desktop | ≥ 1024 | 240px sidebar + fluid · 32px padding · max 1600px |

**Spare width goes to a side panel, not to longer rows** (owner, 2026-09-15: "use all spaces"). From 1280px a list screen puts a summary beside the list: the Bin shows counts by type and what restoring would do to each wallet, Activity shows its counts, Budget keeps the planner beside the month. A row stretched to 1600px puts its action a hand's width from its label, so rows keep their reading width. Settings keeps its settings in one column: a two column Settings was rejected on sight (see `layout.css`, "One column, always"). From 1280px the space beside them holds a panel that reads out the open tab and changes nothing (owner, 2026-09-16: "use the side too, the right side"): what each account group holds, goals saved against their targets, what each debt owes, how many categories there are, the low balance line and who is under it, and that section's findings.

**List screens move their rows, not their heading** (owner, 2026-09-15). From 1024px the Database, Statements, the Bin and Activity are exactly one screen tall: the title, search, filters and column headings stay put and only the rows scroll. Tables inside cards on a scrolling page (Budget, Debt, Insights) keep their column headings pinned to the top of the page while they are in view.

**Every screen works on a phone** (owner, 2026-09-15, replacing the same day's "a phone is for adding and for the summary"). Below 1024px the bar holds Dashboard, Database, Add, Budget and the assistant, and the top bar's ⋯ opens Debt, Insights, Statements, the Bin, Activity and Settings. Nothing says "on a bigger screen": the owner found that anything crucial waiting for a desk, or a link from one screen landing on a note, broke the app on the phone. The Database corrects and bins one row at a time there (picking several at once is the one desk-only action), and Budget sets the month's budget and limits and shows the year's tables, one card under another.

**A phone has its own sizes.** Below 640px the type and spacing come down a step: hero figure 26px, card titles 16px, captions 12px, 12px of page and card padding, a 52px bar with a 48px Add. Fields stay 16px so iOS does not zoom.

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

Implemented in `src/components/Icon.tsx` as drawn SVG. Text glyphs (◧ ☰ ⚙) are not a set: each device draws them from whichever font it has, and some phones draw ⚙ as a colour emoji.

### 2.7 Fitting any screen

Every screen holds up at 360, 768, 1024, 1280 and 1920px, with a long account name, a seven figure amount and an error message showing. Three rules do that. A screen relies on them rather than fixing its own overflow.

| # | Rule | How |
|---|---|---|
| **F1** | **A card measures itself.** Anything inside a card that changes shape (a table stacking into rows, a toolbar wrapping, a form moving its labels above its fields) asks the card how wide it is, not the window. | `.fms-section`, `.fms-card` and `.fms-dt` are size containers, and the Add form is the `entry` container. Inside them, use `@container`, not `@media`. |
| **F2** | **Text wraps, figures never do.** A figure with no room moves to a line of its own or shrinks to fit. It is never cut, never abbreviated and never split across two lines. | `.fms-qrow`, `.fms-balrow` and `.fms-dbrow-main` put the figure under its label when they must. `Money` at `xl` and `l` shrinks to fit its box. Table money columns hold ₱999,999.99 with their padding. |
| **F3** | **Every child that holds text can shrink.** A long word never forces its row wider than the screen. | `min-width: 0` on flex and grid children, `minmax(0, 1fr)` tracks, and `min(100%, 240px)` style minimums in every `auto-fit` grid. |

A data table leaves out the columns it cannot fit (`hideBelow` on the column) and shows what they said inside the cell beside them. It never scrolls sideways.

On a touch screen every field is 16px, so iOS does not zoom the page, and the phone navigation steps aside while a field has focus.

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

**What every field refuses, and says so** (2026-09-16 field check):

- **A money field takes no minus sign**, except an account's actual balance when reconciling it, which can be below zero. A minus typed anywhere else stays in the box with "This takes an amount above zero. Leave out the minus sign." under it and is never saved: a budget, a limit, a credit limit and a goal target all took "-500" before.
- **Free text has a length**: a description 160 characters, notes 500. A pasted page is not a description, and it broke every list the row appears in.
- **A goal's deadline is after today**, when a goal is added and when its deadline moves. A deadline in the past made a goal that was over as it was made.
- **One account, one row.** Adding, renaming and reactivating all refuse a name another account has, whatever its capitals. An account already listed twice says so on the row, and the later row offers "Remove copy", which takes only the list entry away: a balance belongs to the name, so the ledger does not change. Before this, the two rows each showed the whole balance, a rename changed both, and neither could be deactivated.

### 3.3 Entry page (Add / Edit)

The most-used screen. Pattern:

1. **Flow picker**, four equal tiles (Revenue / Spending / Transfer / Debt), each in its flow colour, glyph above label. Selected tile gets a 2px flow-coloured border and its wash. This choice drives which fields render.
2. **Only the fields that flow needs.** Never a single form with disabled fields.
3. **Live running balance** under the wallet field: `Maya ₱5,795.74 → ₱4,695.74`, updating as the amount is typed. Turns `--over` if it goes negative.
4. **Autofill ghost text**, `--ink-3` inline suggestion; tap or `Tab` accepts. A value the form filled itself reads in `--ink-2` until it is edited. **A description is never filled in for you**: the idea from history or the model is the empty field's placeholder, and Tab or a "Use …" link beside the label takes it. It saved Item "Food" with the description "food" when it was typed in, and an idea for one item never follows the form to another. A suggested category or item is a "Use Food" link beside the label, never a placeholder that looks chosen. **What the Status box shows is what is saved**: an empty status showed "Paid" in grey and saved nothing. No bar or border beside it: a green bar beside Description was taken for an error. No hint lines repeating where a guess came from ("Filed this way 12 times", "Last time: …", "Usually ₱15.00"); a hint appears only when it offers something not already in the field.
5. **Inline warnings**, never blocking: negative balance, savings withdrawal, borrowing-looks-like-revenue, repay exceeds outstanding.
6. **Save** → toast `Saved. Record #0442.` with **Undo** for 6s.
7. **On a phone the form is the page** (below 640px): no card around it, labels above the fields whenever the form is under 520px wide, and the Save bar runs edge to edge above the navigation. Values nothing types into (record number, total) keep their label on the same line.
8. **Latest entries where the chat would be.** With AI off, a desktop shows the eight newest rows beside the form (under the balances below 1600px, a third column above it), so a new entry is checked against the last ones before it is saved.
9. **The form says what an entry does before it is saved.** Beside it on a desktop, under it on a phone:
   - **What it does to the month's budget**: the track it counts toward, what is left before and after, the kind of spending so far, and its limit if it has one. When the month has no budget, a link to Budget. When the month is closed, a note saying the entry still counts against the budget as it was planned (docs/08, rule Y4).
   - **Everything due within a week or late**, above the flow tiles: bills from the same list as the Budget screen, and debt payments from the same dates as the Debt screen. Late first, as many as fit on one line (each at least 180px), with "Show all N" only when more are hidden, so ten due bills never push the form off the screen and a wide form never shows three beside empty room. A tap fills the form, and asks first when that would replace something typed. Hidden while a saved row is being corrected.
   - **What it does to a debt**: the debt's balance before and after the entry.
   - **A likely duplicate**, with a link to that row in the Database. A bill already paid that month is named with its date.
   - **Latest entries** open for editing on a tap.
   - **After a save, the toast links to the row.** When the form was opened from a bill on Budget, Insights or the Dashboard, or from a debt, saving goes back there.
10. **Checks that stop a quiet mistake.** Warnings wait until an amount is typed. None blocks a save except where noted:
    - A debt offers only the effects its direction takes: draw, repay, interest or write-off for money you owe; lend, collect or write-off for money owed to you. The wrong one is refused.
    - An archived debt takes no new rows.
    - A spending row named after a debt offers "Book it as a repayment".
    - An amount five times the largest of its kind asks once before saving.
    - A date days ahead or over a year back is questioned.
    - A fee larger than its amount is questioned.
    - One press saves once.
    - **Every check is said once, in one "Before you save" list** under the fields, each with its action beside it as a link ("Book it as a repayment", "Open #0412"). Not a stack of boxes: three boxes for one repayment pushed the fields apart. Only errors after a save attempt keep their own red box.
11. **One path down the form, in the order a person answers it** (owner, 2026-09-16: "use human psychology, it is hard to navigate"): the amount first and largest (26px), then what it was for (category and item, sharing a line on a form 760px wide or more), the description, the wallet, the date, and "More details" folded shut with a summary of what is in it (status, a spending fee, notes). A transfer's fee sits beside its amount, because transfers carry fees. **Labels sit on top of their fields** at every width: a label column beside the controls sent the eye left and right on every line. Total shows only when there is a fee in it.
12. **A wallet is a button, not a dropdown**: every wallet once, with its balance under the name (below zero in `--over`), the one usually used tagged "Usual", nothing chosen until tapped. Arrow keys move through them. The destination of a transfer leaves out the wallet the money leaves. A debt and its effect are buttons the same way. **The date is Today, Yesterday, or the date field.**
13. **The form says which entry it is**, at the top: "New entry" with the number it saves as, or "Correcting #0412" with the row as it was saved and "Stop correcting". A correction lists every change above Save ("Amount ₱500.00 → ₱550.00"), the button counts them ("Save 2 changes"), and saving goes back to the screen the correction was opened from, with a message naming what changed and Undo. A new entry's button names its amount ("Save ₱999.00").
14. **A correction left half done is not restored as a new entry**, and leaving Add for another screen ends a correction.

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

**Boxes sit in rows and share their edges.** Wherever cards stand side by side, each fills its grid cell, so neighbours share a top and a bottom edge; a row is as tall as its tallest card. Screens use the whole width, with no maximum. A list inside a card goes in whole rows (six figures in threes or twos, never five and one). A table that would stack into a list at half width gets the full width instead. Zoomed out, a page reads as a set of aligned rectangles, never a tall column beside a short one.

**The Dashboard answers "how much can I spend today" first.** Its main column is:

1. **The month.** What is safe to spend a day, how the budget stands, and the month's sentences.
2. **Still to pay.** Each item has a button to record it.
3. **Where it went.** Spending by kind, against last month.

A rail beside it holds your money (net worth, then each account, with Low and Below zero said), the worst three findings, and the debts. The year's charts sit below, on a desktop only. "Safe to spend" is the spending wallets less the bills and debt payments still due this month, capped by what is left of the spending budget, divided by the days left and rounded down (`domain/monthPlan.ts`). Insights reads the same brief for any month, so the two screens cannot disagree.

**The Debt screen judges its dates.** Each debt card shows:

- the next payment and whether it has passed
- how much is due
- the last payment
- the last 30 days of borrowing against payments

A due day, limit or term is set under Details. "Record payment" opens the Add form filled in. The history covers every year.

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

**Notifications**: every finding lives behind a bell at the top right of every screen, not as a stack of boxes on the Dashboard.

- **Count on the bell:** findings not yet looked at, in the colour of the worst of them. It clears once the list is opened.
- **The list:** drops down under the bell, worst first. Each finding is a title, one line of figures, and where tapping it goes: its rows in the Database, or the screen that deals with it.
- **On a phone:** the list spans the screen under the bar.
- **Where "seen" is kept:** in the browser only.
- **The assistant's paragraph:** sits under the list while AI is on.

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

**Phone bottom nav**: 5 items max, 56px + safe area, `--surface`, 1px top hairline. Icon 24px + `micro` label. Active in `--brand-700`. The centre slot is a raised circular **＋** in `--brand-700`, 56px, `--shadow-raised`, the most-used action gets the best position. With four items (AI switched off) there is no centre slot: the four share the bar equally and Add is a level 56×32 pill in `--brand-700` with its label under it, like the others.

**Phone "More" sheet**: the top bar's ⋯ button opens a sheet listing every screen the bar has no room for, 48px rows, icon + label, the Bin with its count. **Every screen works on a phone**, and nothing says "on a bigger screen": Budget's planner, limits and year tables, the Dashboard's year charts, Statements and Activity included. A link from one screen to another (Open Insights, a statement from Debt, a notification into Activity) always lands somewhere usable. The one exception is picking several Database rows at once, which a phone does one row at a time.

**Moving to the bin says Undo**: the toast after binning a row carries Undo, which restores it, for the tap meant for the row beside it.

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

**Insights calendar**, first on the screen, beside what was picked:

| Part | Spec |
|---|---|
| Picking | "One day" or "A range". In a range the first tap sets one end and the second the other, in either order; Shift-click extends on a desktop. Quick picks: Today, This week, Last 7 days, Next 7 days, Month so far (or Whole month for a past one). |
| Frame | **One height that never changes** (owner, 2026-09-16: "set a maximum container so no adjusting"): 560px for the calendar and its panel side by side from 1024px, the panel 480px stacked under the calendar below that. A month is always six week rows. What a pick holds scrolls inside the panel; nothing on the page moves when a day is tapped. |
| Days | Five heat steps of spending red (14%, 26%, 38%, 50% over the sunk surface), a 6px green dot when money came in, today's number in a filled brand circle. Only a real pick is tinted, with its two ends outlined; the month shown by default is not marked. Days ahead are plain with a hairline and can be picked. The amount in each day hides when the card is under 460px wide. Arrow keys move a day, or a week up and down. |
| What was picked | Its own panel. Three figures: went out, came in, and either expected ahead, the month to that day, or the heaviest day. Then three tabs, each disabled when it has nothing: **Where it went** (every kind with its share, past eight folded into one line, and a total equal to "went out"), **Entries** (grouped by day with each day's spending, every row with Correct), **Still ahead** (bills monthly, debt payments from the Debt screen's dates, usual spending marked "about", Pay now on a bill, and what those days allow at today's safe amount, or that nothing is safe when the budget is spent). A range can cross months and years. |

**The assistant knows the screen it was opened from.** Every screen reports a few plain lines of what it shows (the month and its figures on Dashboard, the picked range on Insights, the half-typed entry on Add, the search on Database). "What do you think" is answered about that, not about the whole ledger. The report is text, rebuilt from the same figures the screen draws, and never includes settings the assistant has no reason to see.

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

- [ ] Renders correctly at 360, 768, 1024, 1280 and 1920px, with a long name, a ₱1,234,567.89 figure and its error state showing (§2.7)
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
