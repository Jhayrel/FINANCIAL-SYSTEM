# Build Plan, Financial Management System (Web)

Replaces the Excel + VBA system with a web app for PC and phone.
Read `SYSTEM-ANALYSIS.md` first, it holds the verified business rules.
Read `../CLAUDE.md` first, it holds the protection rules.

---

## Decisions

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript, strict | Money math needs a type checker |
| Framework | React 19 + Vite | Fast, first-class on Cloudflare Pages |
| Styling | Tailwind CSS | Mobile-first, keeps the green identity |
| Database | Firebase Firestore | As specified |
| Auth | Firebase Auth, Google sign-in, locked to one UID | Public URL, private data. No password to manage |
| Hosting | Cloudflare Pages from GitHub, `*.pages.dev` | As specified |
| Charts | Recharts | Bundled, no CDN, has a treemap |
| Tests | Vitest | Parity tests are the point of this project |
| Money | Integer centavos | Kills the float drift in the current system |
| Offline | PWA + Firestore persistence | Phone use on bad signal |
| AI | Rule-based core + LLM polish, both in v1 | Rules always work offline; the LLM layer is optional enhancement on top |

### Money rule
Every amount is an integer number of centavos (`5795.74` → `579574`).
Parse at the input boundary, format at the render boundary, integers everywhere
between. No `parseFloat` on money, no `toFixed` arithmetic.

---

## Architecture

```
app/
  src/
    domain/          pure TypeScript, no React, no Firebase, no I/O
      money.ts       centavo type, parse, format, add/sub
      types.ts       Transaction, Wallet, BudgetYear, ReferenceLists
      balances.ts    rule 3.1  wallet + savings balances
      totals.ts      rules 3.2-3.5  month / annual / rankings
      budget.ts      rule 3.6  two-track budget status
      allocation.ts  rule 3.7  smart daily allocation
      forecast.ts    rule 3.8  spending + bills forecast
      bills.ts       rule 3.9  due prediction, paid/upcoming
      statements.ts  rule 3.10 four statement filters
      autofill.ts    rule 3.12 pattern learning
      insights.ts    the text report generator
      alerts.ts      the Finance Alert generator
    data/
      firebase.ts    init
      repo.ts        Firestore reads/writes
      useLedger.ts   loads all transactions once, live-subscribes, memoises
    features/
      entry/ ledger/ insights/ summary/ budgeting/
      statements/ bin/ settings/
    components/      shared UI
  functions/         (phase 5) Cloudflare Pages Function, AI proxy
tools/
  migrate-excel.mjs  one-time xlsm -> Firestore import
  extract-fixture.mjs  xlsm -> JSON test fixture
docs/
```

**The domain layer imports nothing.** That is what makes it testable against the
Excel's real numbers, and what keeps the money math auditable.

### Firestore shape

```
users/{uid}/transactions/{id}   Transaction
users/{uid}/deleted/{id}        Transaction + deletedAt
users/{uid}/budgets/{year}      { spending: number[12], billsSubs: number[12] }
users/{uid}/reference/lists     { wallets, savings, bills, subscriptions,
                                  revenueCategories, spendingTypes }
users/{uid}/meta/counters       { nextRecordNumber }
```

Rules: `allow read, write: if request.auth.uid == <owner-uid>`, one account only.

Whole-ledger-in-memory is the right call at this size: 440 records now, roughly
650/year, so even 10 years is well under a megabyte. Every figure is then
computed client-side with the exact same semantics as the Excel, works offline,
and needs no server logic or aggregation documents that could drift.

---

## Phases

### Phase 0, Safety and scaffolding
- [x] `CLAUDE.md` protection rules
- [x] `docs/SYSTEM-ANALYSIS.md` verified business rules
- [x] `docs/PLAN.md` this file
- [x] `.gitignore`, excludes `MY THINGS/`, `*.xlsm` and fixtures, so neither
      the API keys nor the financial history can reach GitHub
- [x] Vite + React 19 + strict TS + Tailwind v4 skeleton
- [ ] `git init` (deferred until you create the repo)

### Phase 1, Domain core + parity tests **(the critical phase)**
- [x] `tools/extract_fixture.py`, 440 transactions, budgets, lists, and the
      workbook's own displayed figures, as integer centavos. Secrets stripped.
- [x] `domain/money.ts`, centavo arithmetic
- [x] `domain/dates.ts`, ISO-string calendar maths, no Date objects
- [x] `domain/types.ts`, ledger model
- [x] `domain/balances.ts` + parity tests, rule 3.1, **all balances exact**
- [x] `domain/integrity.ts` + tests, surfaces the ₱30.00 defect (3.5.1)
- [x] `domain/totals.ts` + parity tests, rules 3.2-3.5
- [x] `domain/budget.ts` + parity tests, rule 3.6
- [ ] `domain/allocation.ts`, rule 3.7
- [ ] `domain/forecast.ts`, rule 3.8
- [ ] `domain/bills.ts`, rule 3.9
- [ ] `domain/statements.ts`, rule 3.10
- [ ] `domain/autofill.ts`, rule 3.12
- [ ] `domain/insights.ts` + `domain/alerts.ts`, the rule-based text engines

Resolved during Phase 1:
- Rule 3.5's 15.00 delta and defect 2's TOTAL FUNDS gap were **the same bug**,
  two mis-categorised transfer fees. See SYSTEM-ANALYSIS 3.5.1.
- Defect 2 (fee bucketing, 6,943.58 vs 6,961.58) settled in favour of the AI
  report's split: fees ride with the spending track, so the two budget tracks
  add up to the month total.
- The workbook held **three** disagreeing fee definitions (513 / 443 / 428) and
  a Money Send rule that silently dropped ₱10. Replaced with a single
  attribution pass that provably sums to the annual total, a property the
  Excel never had. Divergences: Transaction Fee (record #280, mis-filed) and
  Money Send (+₱10 the workbook lost).

**66 tests passing. Typecheck clean. Production build 80 kB gzipped.**

### Phase 3 (started early), Screens
- [x] App shell: sidebar on desktop, bottom nav on phone, light/dark themes
- [x] **Dashboard**, funds, wallets, two-track budget, burn rate, top spending,
      data-health summary
- [x] **Ledger**, 440 records, search, type filter, flagged-only filter;
      stacked cards on phone, full table on desktop
- [ ] Entry form, Insights, Budgeting, Statements, Recycle Bin, Settings

Nothing moves to Phase 2 until these tests pass.

### Phase 2, Data layer + migration
- [ ] Firebase init, auth, security rules
- [ ] `data/repo.ts`, `useLedger.ts`
- [ ] `tools/migrate-excel.mjs`, reads the xlsm **read-only**, strips
      `CATEGORIES!U` secrets, converts to centavos, writes to Firestore
- [ ] Dry-run mode; post-import verification recomputes balances and asserts
      they match the Excel before the import is considered done

### Phase 3, Screens
In value order, each usable as it lands:
1. **Entry**, the form, live balances, alert banner, autofill ghost text
2. **Ledger**, table, search, the 8 filter modes, edit, soft delete
3. **Insights**, calendar, budget vs actual, text report
4. **Summary**, annual overview, treemap, top spending, most-used wallet
5. **Budgeting**, 12-month grid, per-month summary, forecast, cash flow
6. **Statements**, 4 types, month range, CSV/PDF export
7. **Recycle Bin**, restore
8. **Settings**, wallets, bills, subs, categories, spending types

### Phase 4, PWA + deploy
- [ ] `vite-plugin-pwa`, installable, offline shell
- [ ] GitHub repo, Cloudflare Pages connection, build config
- [ ] Deploy Firestore rules

### Phase 5, AI layer
Built on top of the Phase 1 rule-based engines, never instead of them,
exactly the arrangement the VBA already uses, where the offline path is the
fallback whenever a key is missing or a call fails.

- [ ] `functions/api/ai.ts`, Cloudflare Pages Function proxy. The key lives in
      a Cloudflare environment secret; the browser never sees it.
- [ ] Provider detection + failover across keys (ported from Module7/Module8:
      Groq, DeepSeek, OpenAI, Anthropic, OpenRouter)
- [ ] Finance Alert rewriting, insight summarising, description suggestion
- [ ] Rate limiting and a hard timeout, so a slow provider never blocks entry
- [ ] Every AI surface degrades silently to its rule-based output

---

## What only you can do

1. **Rotate the three API keys** in `CATEGORIES!U7:U16` (OpenRouter x2, Groq).
   They are in a file destined for a public GitHub repo. Do this now, not at
   Phase 5, treat them as already compromised.
2. Create the Firebase project; enable Firestore and Google auth; send me the
   config object (the `apiKey` there is a public client identifier, not a
   secret, the security rules do the actual protecting).
3. Create the GitHub repo.
4. Connect Cloudflare Pages to it.

I will tell you exactly when each is needed. Everything else I build.

---

## Risks

| Risk | Handling |
|---|---|
| Exposed API keys reach a public repo | Rotate now; migration strips column U; never written to the tree |
| Public URL exposes finances | Auth required, rules locked to one UID, no anonymous read |
| Money precision | Integer centavos + parity tests |
| A rule ported wrong | Every rule has a test asserting the real Excel figure |
| `node_modules` in OneDrive | Gitignored; recommend excluding from OneDrive sync |
| Losing the Excel | `MY THINGS/` protected by `CLAUDE.md`; import is copy-only, never move |

## Non-goals

Multi-user, multi-currency, bank integrations, custom domain, analytics.
The Excel is not modified and remains the archive.
