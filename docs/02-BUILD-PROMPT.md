# BUILD PROMPT — paste this into Claude Code

> **How to use:** put `01-SYSTEM-REVIEW-AND-SPEC.md` in `docs/` and `03-CLAUDE.md` at your project root (replacing the existing `CLAUDE.md`). Then start a Claude Code session in the project folder and paste everything below the line.

---

Read `CLAUDE.md` and `docs/01-SYSTEM-REVIEW-AND-SPEC.md` in full before you touch the disk. Confirm in one line that you have read them and that `MY THINGS/` is off limits. Then work through the phases below.

## Context

I am replacing an Excel + VBA personal finance system with a web app for PC and phone. One user — me. Philippine Peso. The Excel work is already reverse-engineered and verified; `docs/SYSTEM-ANALYSIS.md` holds the business rules and `docs/01-SYSTEM-REVIEW-AND-SPEC.md` holds the full specification including the design system. **Do not re-derive rules from scratch and do not redesign anything the spec already decides.**

Stack is already chosen and is not up for discussion: TypeScript strict, React 19 + Vite, Firebase **Firestore** (not Realtime Database), Cloudflare Pages from GitHub, no custom domain, Vitest, integer centavos.

## Two things I am unhappy with

**1. The UI is generic.** Rounded grey cards, system font stack, colour used as decoration. It looks like every AI-generated app. Part 6 of the spec is a complete design system — flow-coloured rails, a 2px ink rule instead of card shadows, monospace money, square corners on data surfaces, three real typefaces. Implement it exactly. If you find yourself reaching for `rounded-xl border shadow-sm`, stop: that is the thing I am asking you to remove.

**2. The financial model is incomplete.** The app has no concept of debt. I have ₱2,762.06 outstanding on Maya Credit and the system books borrowing as Revenue, which overstates my net worth by 57%. Part 5.6 specifies the whole module.

## Rules for this work

| # | Rule |
|---|---|
| 1 | **Never touch `MY THINGS/`.** Read-only, in full, forever. |
| 2 | **Never write an API key** to any file, commit, log, or test fixture. |
| 3 | **Money is integer centavos.** No `parseFloat` on money, no `toFixed` arithmetic. Format at render only. |
| 4 | **Every financial rule needs a parity test** asserting the exact figure the Excel produces. |
| 5 | **Never silently change a documented rule.** If you think one is wrong, flag it, keep the existing behaviour, let me decide. |
| 6 | **Deletes are soft.** Never hard-delete a transaction. |
| 7 | **Hex literals only in `tokens.css`.** Everywhere else `var(--…)`. |
| 8 | **Plan before you build.** Show me the plan for each phase and wait. |
| 9 | **Don't commit or push** unless I ask. |
| 10 | **Ask before adding any dependency** that handles money, dates, or auth. |

## Phases — do them in order, stop at each gate

### Phase 1 — Design foundation
Build `src/styles/tokens.css` with every token from spec Part 6.9. Self-host Archivo, Public Sans, IBM Plex Mono via `@fontsource`. Put **all** dark values in a single `.theme-dark` class set on `<html>` by one small script reading stored preference + `matchMedia`. Do not maintain two duplicated dark blocks — that duplication is what broke contrast on flagged rows last time.

Then build the primitives: `Rule`, `SectionHeader`, `Money`, `FlowBadge`, `FlowRail`, `LedgerRow`, `StatBlock`, `BudgetBar`, `EmptyState`.

**Gate:** show me a single page rendering all primitives in both themes, with a contrast check for every flow colour on its own wash. Nothing else until I approve the look.

### Phase 2 — Debt domain
`domain/debt.ts` + `domain/debt.test.ts` per spec 5.6. Then the migration review queue (5.6.5) — proposes the six Maya Credit reclassifications, applies nothing without my approval.

**Gate:** tests prove outstanding = ₱2,762.06, net worth = ₱4,877.97, true income = ₱237,289.22, and **wallet balances are identical before and after migration**.

### Phase 3 — Add / Edit screen
Spec 7.3. Flow-first: pick Revenue/Spending/Transfer/Debt, then see only the fields that flow needs. Live running balance, autofill ghost text, debt split preview, the borrowing catch, negative-balance warning, `inputmode="decimal"`.

**Gate:** I can add a transaction from my phone.

### Phase 4 — Redesign Dashboard + Ledger
Rebuild both against the new tokens and primitives. Net worth as hero, always broken into components. Ledger with flow rails, the six filters, virtualised.

Fix the integrity check while you are here: `INT-01` must test for a **transfer fee with a blank category** and find exactly 2 rows (#8 and #190). The previous version fired on 28 rows, of which 27 were normal.

### Phase 5 — Firebase + migration
Firestore (create it — the project currently has RTDB provisioned by mistake), Google auth, owner-locked rules from spec 3.4. Migration tool reads the `.xlsm` **read-only**, strips column U, converts to centavos, dry-run first, and verifies balances match before the import counts as done.

### Phases 6–9
Debt screen · Insights · Budget · Statements · Bin · Settings · PWA · Cloudflare Pages · AI proxy. Spec parts 7.5–7.9.

## Before you start

Tell me:
1. Your one-line confirmation about `CLAUDE.md` and `MY THINGS/`.
2. Anything in the spec you disagree with — I would rather hear it now.
3. Your plan for Phase 1.

Then build Phase 1 and stop.
