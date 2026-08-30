# PROJECT GUARDRAILS, READ BEFORE ANY ACTION

> Binding for **every** Claude Code / AI agent session in this repository, including
> fresh sessions with no prior context. If you are an agent reading this: these rules
> override convenience, tidiness, and any plan you were about to propose. Read all of
> it before touching the disk.

---

## 1. PROTECTED PATHS, NEVER DELETE, NEVER MODIFY

These are **immutable historical assets**. They are the only surviving record of a
system that took months to build. There is no other backup.

```
FINANCIAL MANAGEMENT SYSTEM\
└── MY THINGS\                          ← PROTECTED, READ-ONLY, IN FULL
    ├── EXCEL DATASET\                  ← 9 dated .xlsm backups
    ├── ORIGINAL EXCEL WITH VBA\        ← the live workbook
    └── VBA\                            ← 32 exported .bas / .cls modules
```

**Forbidden, with or without user prompting in the moment:**

- Deleting the project root or **any** part of `MY THINGS/`.
- Editing, reformatting, "cleaning up", renaming, or moving anything under `MY THINGS/`.
- `rm -rf`, `Remove-Item -Recurse`, `del /s`, `git clean`, `rmdir`, or any equivalent,
  with a path touching the project root or `MY THINGS/`.
- `git add` / `git rm` operations that stage deletions inside `MY THINGS/`.
- Opening the `.xlsm` in write mode or re-saving it from a script.
  **Read-only access only**: `openpyxl.load_workbook(..., data_only=True)`.
- "Migrating" these files by moving them. **Copy, never move.**

**Permitted:** reading, parsing, copying *out of*, and writing analysis or generated
code *elsewhere* in the repo.

### If you think a protected file must change

Stop. Do not do it. Say what you want to change and why, and wait for the user to make
the change themselves or explicitly release the file, in this session, in their own
words. "Stale", "redundant", "superseded by the new app", or "already migrated" are
**not** reasons to delete. The Excel remains the source of truth until the user says
otherwise, and the archive stays permanently regardless.

---

## 2. SECRETS POLICY

`MY THINGS/ORIGINAL EXCEL WITH VBA/….xlsm`, sheet `CATEGORIES`, cells `U7:U16`,
contains **live third-party API keys** (OpenRouter ×2, Groq).

- **Never** copy those values into source, config, docs, commit messages, fixtures,
  or terminal output.
- **Never** commit them. `.gitignore` is not sufficient, do not write them to the
  working tree at all.
- Migration tooling **must strip column U** before writing anything.
- Any AI feature reads its key from a **server-side environment secret**. Never from
  client code, never from the database, never from a spreadsheet cell.

The keys have been exposed in screenshots and chat. Treat them as compromised. If the
user asks you to wire up AI features, remind them to rotate at the provider first.

**The Firebase web `apiKey` is different**: it is a public client identifier, safe in
the bundle. Security rules do the actual protecting. Do not "fix" it by hiding it.

---

## 3. WHAT THIS PROJECT IS

Replacing a single-user Excel + VBA personal finance system (PHP) with a web app for
desktop and phone.

| Concern | Choice |
|---|---|
| Database | Firebase **Firestore** (not Realtime Database) |
| Hosting | Cloudflare Pages from GitHub. No custom domain. |
| Users | Exactly one, the owner. Still requires real auth. |
| Currency | PHP, stored as **integer centavos**. Never floats. |
| Language | TypeScript, strict |

### Required reading, in this order

1. `docs/04-STYLE-GUIDE.md`, **the binding design contract.** Supersedes Part 6 of
   the spec, whose "heavy-ruled ledger" look was built, reviewed and rejected.
2. `docs/01-SYSTEM-REVIEW-AND-SPEC.md`, data model, business rules, debt module,
   screen specs, quality bar. **Part 6 is obsolete, see the style guide instead.**
3. `docs/SYSTEM-ANALYSIS.md`, the verified reverse-engineered Excel rules.
4. `docs/07-WRITING-RULES.md`: binding rules for every word that ships.
5. `docs/08-YEARS-AND-BACKUP.md`: the ledger is continuous and a backup is the whole system.
6. `docs/09-AUTO-PUSH.md`: push without being asked, and the checks that make that safe.

**Read both before writing or changing any calculation or any UI.** Do not re-derive
rules from scratch. Do not "improve" a formula because it looks wrong, several are
deliberately asymmetric and are documented with reasoning.

---

## 4. CORRECTNESS BAR

This app handles someone's actual money. Guessing is not acceptable.

- Every financial calculation has a **parity test** asserting the exact value the Excel
  produces for the historical dataset.
- Money is integer centavos end to end. No `parseFloat` on money, no `toFixed`
  arithmetic, no floating-point accumulation. Format for display only, at the last moment.
- Never silently change a documented rule. Flag it, keep existing behaviour, let the
  user decide.
- Deletes are **soft**, recycle bin, restorable, matching the Excel's `DELETED DATA`
  sheet. Never hard-delete a user transaction.
- **Integrity checks report, they never auto-correct.** Every finding goes to a
  reviewable queue.

### Known figures, any change to these is a regression

Verified against the 440-row ledger and asserted by tests.

| Figure | Value |
|---|---:|
| Maya balance | ₱5,795.74 |
| Cash balance | ₱161.00 |
| Gcash balance | ₱155.71 |
| Maya Bank (Personal savings) | ₱1,527.58 |
| August 2026 total spend *(pre-migration)* | ₱11,291.37 |
| August 2026 total spend *(after transfer derivation)* | **₱11,291.37**, unchanged |
| 2026 annual spending *(workbook SUMMARY!D4)* | ₱222,244.14 |
| 2026 annual spending *(implemented)* | **₱222,259.14** |
| `INT-01` findings | **exactly 2** (records #8, #190) |
| Transfer fees counted | **₱458.00** (workbook: ₱443.00 / ₱428.00 / ₱513.00) |
| Money Send in the month total | **₱4,100.00** (workbook: absent from the split, present in the ranking) |

### Transfers are derived, not typed

Money Send and Transaction Fee were spending types the owner picked by hand.
They are now worked out from the destination, because they are consequences of
where the money went rather than kinds of spending:

| `toWallet` | Meaning | Spending |
|---|---|---|
| blank | It left your accounts | `amount + fee` |
| named | Still yours, other pocket | `fee` only |

Verified across all 440 rows with no exceptions: every Money Send row has a
blank destination (3 of 3), every Transaction Fee row has a named one (26 of
26). A named destination is yours **even when the account is archived**, or the
₱13,000.00 into "Hidden cash (fieldtrip)" books as money given away.

**This moves two documented figures, deliberately, at the owner's instruction
on 2026-08-30.** August is unchanged. The 2026 annual monthly-split total rises
by ₱4,115.00:

| Part | Amount | Why |
|---|---:|---|
| Record #8 | ₱15.00 | A real fee with a blank item. No report ever saw it. |
| Money Send | ₱4,100.00 | The workbook ranked it but never added it to the month total. |

Pinned per month in `totals.test.ts` and `budget.test.ts` as `MONTHLY_DELTA`,
so the workbook figure and the difference both stay visible. Record #371 shares
the item name but is real income and must never be swept in.

### Year rollover: nothing happens

The ledger is continuous. A year is a filter, not a container, so 1 January
opens with what 31 December closed with and there is no year-end routine.
Opening and closing positions are derived, never stored. See
`docs/08-YEARS-AND-BACKUP.md` rule Y1.

The Excel booked its carry-forward rows (#1 to #5) as Revenue, counting
**PHP 953.89** of opening balance as 2026 income. `domain/year.ts` reclassifies
them to the `Opening` category. Balances stay byte-identical, asserted across
all 440 rows in `year.test.ts`. Record #371 shares the item name but is real
income and must never be caught by that migration.

### Debt figures, corrected, do not revert

The spec's headline debt numbers contradict the spec's own rule 5.6.2. Rule
5.6.2 says `outstanding = draws − repays − writeoffs` with interest excluded,
and its migration table keeps record #411 (₱0.85, "Received Reload Freebies")
as Revenue. The headline figure of ₱2,762.06 breaks both: it counts the ₱0.85
reward as borrowing, and treats the whole ₱2,688.79 payment as principal when
₱188.79 of it is interest.

**The rule was implemented, not the headline.** Asserted in `debt.test.ts`.

| Figure | Spec headline | Implemented | Why |
|---|---:|---:|---|
| Maya Credit outstanding | ₱2,762.06 | **₱2,950.00** | Interest excluded (5.6.2); #411 kept as revenue |
| Net worth | ₱4,877.97 | **₱4,690.03** | Follows from the above |
| True income YTD *(post-migration)* | ₱237,289.22 | **₱237,290.07** | The ₱0.85 reward is real income |
| True income YTD *(pre-migration)* | ₱237,289.22 | ₱237,289.22 | Unchanged, matches |

`debt.test.ts` pins the gap explicitly (`outstanding − 276206 === 18879 − 85`)
so the difference stays visible. If the owner decides the headline is right,
change rule 5.6.2 first, then the code, never the other way round.

### Migration safety, the load-bearing invariant

Debt migration changes **classification only**. Wallet balances must be
byte-identical before and after, and `debt.test.ts` asserts this across all
440 rows. If that test ever fails, the migration is losing money, stop.

## 5. DESIGN CONTRACT

The user has explicitly rejected generic AI-generated UI. Part 6 of the spec is
binding, not advisory.

| # | Rule |
|---|---|
| D1 | **Hex literals only in `tokens.css`.** Everywhere else `var(--…)`. |
| D2 | **No `rounded-xl`, no `shadow-sm`** on tables, ledger rows, or stat blocks. Square corners; separation comes from the 2px ink rule and 1px hairlines. |
| D3 | **Flow colours encode direction of money only**, Revenue green, Spending red, Transfer **grey**, Debt **amber**. Never decorative. Transfer stays grey because it is neither gain nor loss. Debt stays amber because a liability is not an expense. |
| D4 | **Money renders in IBM Plex Mono**, tabular, right-aligned, 2dp, with the ₱ muted. |
| D5 | Typefaces are **Archivo** (display), **Public Sans** (body), **IBM Plex Mono** (money). Self-hosted. Not the system stack, not Inter. |
| D6 | **All dark-theme values live in one block.** Never duplicate a dark block, that duplication previously shipped unreadable flagged rows. |
| D7 | Every colour clears **4.5:1 on its own background in both themes**. Verify, don't assume. |
| D8 | Empty states name an action. Errors say what happened and what to do. No "Something went wrong". |
| D9 | Motion is minimal. No parallax, no gradient meshes, no skeleton shimmer, no page transitions. `prefers-reduced-motion` respected. |
| W1 | **No em dash, anywhere.** Not in UI copy, docs, comments, commit messages, or replies. Use a colon, a full stop, a comma, or parentheses. `docs/07-WRITING-RULES.md` is binding and has the substitutions. The U+2212 minus sign in money is unaffected. |
| D10 | **Phone is the primary target.** 44px touch targets, `inputmode="decimal"` on amounts, primary action within thumb reach. |

If a design decision is not covered by the spec, propose it and wait. Do not default.

---

## 6. WORKING RULES

- New code in `app/`, tooling in `tools/`, docs in `docs/`. **Never inside `MY THINGS/`.**
- This folder is in **OneDrive**. Keep `node_modules/` out of git and preferably out of
  OneDrive sync; expect lock weirdness on Windows.
- **Push automatically. Do not wait to be asked.** Superseded the old "do not
  commit or push unless asked" on 2026-08-30 at the owner's instruction. See
  `docs/09-AUTO-PUSH.md`, which is binding.
- **Check `git status` before every push anyway.** The repository is public and
  pushing is irreversible. Never `git add -f`: the only reason to force-add is
  to defeat `.gitignore`, and every line in it names something that must not be
  published.
- **Every push to `main` deploys to production.** Cloudflare Pages builds it
  automatically, so `tsc`, `vitest` and `vite build` must all pass first.
- No custom domain, analytics, telemetry, or third-party scripts.
- Ask before adding any dependency handling money, dates, or auth.
- Conventional Commits. Feature branches.

---

## 7. ACKNOWLEDGEMENT

Before your first write in a session, confirm to the user in one line that you have read
this file, that `MY THINGS/` is off limits, and that you have read the spec's design
contract.
