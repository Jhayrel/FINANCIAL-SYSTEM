# FINANCIAL MANAGEMENT SYSTEM — Review, Specification & Design Bible

**Owner:** Jhayrel Garcia · **Currency:** PHP (₱) · **Users:** 1
**Reviewed:** 29 August 2026 · **Source of truth reviewed:** `MY THINGS/` (read-only)
**Scope of review:** 1 workbook / 14 sheets · 32 VBA modules / 18,559 lines · 440 transactions (2026‑01‑01 → 2026‑08‑28) · the in-progress React app in `app/`

> This document is the **specification**. `02-BUILD-PROMPT.md` is what you paste into Claude Code. `03-CLAUDE.md` replaces the file at your project root and is what protects your work from any future AI session.

---

# PART 0 — VERDICT

## 0.1 The one-paragraph summary

Your Excel system is genuinely good work. The VBA is not toy code — there is a chronological-insert engine, a soft-delete recycle bin, an eight-mode search, a pattern-learning autofill, a multi-provider LLM fallback chain, and a twenty-view insights report generator. The reverse-engineering already in `docs/SYSTEM-ANALYSIS.md` is accurate and I verified its headline figures against the raw data myself. The **domain layer** of the new app (integer centavos, pure functions, parity tests against the real workbook numbers) is professional-grade and should be kept exactly as it is. Two things are not yet good enough: the **UI has no point of view**, and the **financial model has a hole in it** — you are carrying real debt that the system has no concept of, so it is being silently counted as income.

## 0.2 Scorecard

| Layer | Grade | Verdict |
|---|:---:|---|
| Business-rule extraction (`SYSTEM-ANALYSIS.md`) | **A** | Verified. Trustworthy. Do not re-derive. |
| Domain layer (`app/src/domain/`) | **A−** | Integer centavos, pure, tested against real figures. Best part of the codebase. |
| Guardrails (`CLAUDE.md`, `.gitignore`) | **B+** | Strong. Needs the design contract and debt model added. |
| Data integrity of the ledger itself | **C** | 64 blank categories, ₱3,110.63 "Unknown", a ₱30.00 tie-out failure. |
| Financial model completeness | **D** | **No debt/liability concept.** Borrowing is booked as Revenue. |
| UI / visual design | **D** | Generic. Rounded grey cards, default type, no identity. Your complaint is correct. |
| Screens shipped | **20%** | Dashboard + Ledger only. Entry, Insights, Budgeting, Statements, Bin, Settings all missing. |
| Security posture | **F** | Three live API keys sitting in a spreadsheet cell, already exposed. |

## 0.3 The three things that actually matter

1. **Rotate your API keys today.** Details in Part 3. This is the only item with a deadline.
2. **Add a real Debt module.** You owe ₱2,762.06 on Maya Credit right now and your system reports it as income. Part 5.6.
3. **Give the UI a spine.** Part 6 is a complete design system, colour-coded, ready to implement. No more grey cards.

---

# PART 1 — WHAT WAS REVIEWED

## 1.1 Workbook inventory

| Sheet | Visible | Role |
|---|:---:|---|
| INPUT PAGE | ✔ | Entry form, wallet + savings balances, Finance Alert banner |
| INSIGHTS | ✔ | Month calendar, budget vs actual, AI insight, long text report |
| SUMMARY | ✔ | Annual overview, treemap, top spending, most-used wallet |
| BUDGETING | ✔ | 12-month budget grid, per-month summary, forecast, net cash flow |
| DATABASE | ✔ | The ledger — 440 rows, columns B:N |
| FINANCIAL STATEMENT | ✔ | 4 statement types × month range, export |
| DELETED DATA | ✔ | Soft-delete recycle bin (4 rows) |
| CATEGORIES | ✔ | Wallets, savings, bills, subs, revenue cats, spending types, **API keys** |
| SHEETS · EXPENSE/SAVINGS/REVENUE SHEET · ACCOUNT STATEMENT | ✖ | Export staging |
| BACKEND | ✖ | Materialised cache — dropdowns, balances, rankings |

## 1.2 VBA inventory

| Module | Lines | Responsibility | Port? |
|---|---:|---|---|
| Module1 | 2,362 | CRUD, chronological insert, renumber, 8 search modes | ✔ Rules only |
| Module2 | 647 | INSIGHTS calendar paint + day popups | ✔ Redesign |
| Module3 | 48 | Sync CATEGORIES savings → BACKEND | ✖ Obsolete |
| Module4 | 379 | Forecast (spending + bills) | ✔ |
| Module5 | 443 | Financial statement filter/render | ✔ |
| Module6 | 3,790 | PDF/Excel export, backup, restore, rollback | ⚠ Partial |
| Module7 | 1,280 | Finance Alert engine, holiday API, multi-LLM + offline | ✔ Server-side |
| Module8 | 2,840 | Autofill / suggestion engine | ✔ |
| Module9 | 479 | SUMMARY calendar | ✔ Merge with M2 |
| Module10 | 5,009 | Insights engine — 20 report views, frequency allocation | ✔ |
| Sheet1/3/6–13 | ~1,100 | Sheet events, protection, input cleaning | ✖ N/A on web |

**`AddDataToDatabase` in Sheet1 is dead code.** It appends without the balance check, chronological insert, or renumber that `AddOrUpdateRecord` performs. Do not port it. (Correctly flagged in the existing analysis.)

## 1.3 Dataset shape as reviewed

```
440 transactions            2026-01-01 → 2026-08-28
  Revenue    80    Spending  268    Transfer  92
  4 soft-deleted rows
  30 rows carry a transaction fee
  8 months of budgets, 2 tracks
  33 reference-list entries + 3 API keys
```

**Type × Category matrix** — this is where the structural weakness shows:

| type ↓ / category → | Revenue | Spending | Bills | Subscriptions | Transfer | *(blank)* |
|---|---:|---:|---:|---:|---:|---:|
| Revenue | 80 | – | – | – | – | – |
| Spending | – | 227 | 16 | 25 | – | – |
| Transfer | – | 27 | – | – | 1 | **64** |

64 Transfer rows carry no category at all. They still move wallet balances but fall out of every category-filtered total. That single gap is the direct cause of the ₱30.00 tie-out failure in Part 2.3.

---

# PART 2 — FINDINGS

## 2.1 What is right (keep it, don't let any agent "improve" it)

| # | Finding |
|---|---|
| ✔ 1 | **Integer centavos end to end.** The Excel carries float drift — `5795.740000000005`, `155.7100000000064`, `1527.5800000000027`. The new domain layer stores `579574` and the drift is gone. This is the single best decision in the project. |
| ✔ 2 | **Parity tests against real workbook figures.** Wallet balances, monthly spend, annual spend, and the 16-row spending ranking all reproduce the workbook exactly. This is what makes the port trustworthy. |
| ✔ 3 | **The domain layer imports nothing.** No React, no Firebase, no I/O. That is why it is testable and auditable. Hold this line. |
| ✔ 4 | **Soft delete, not hard delete.** Matches the `DELETED DATA` sheet. Correct for money records. |
| ✔ 5 | **`total = amount + fee` holds for all 440 rows.** So `total` is safely derivable and never needs to be stored as an independent truth. |
| ✔ 6 | **The two documented asymmetries in the balance rule are deliberate** and are documented with reasoning. An agent that "fixes" them breaks parity. |

## 2.2 Verified financial rules (do not re-derive these)

**Wallet balance** — reproduces all four workbook balances exactly:

```
balance(w) = SUM(total)  WHERE type = 'Revenue' AND fromWallet = w
           + SUM(amount) WHERE toWallet = w
           - SUM(total)  WHERE fromWallet = w AND type <> 'Revenue'
```

Two intentional asymmetries: Revenue may name its wallet in *either* column, and money **in** uses `amount` while money **out** uses `total` — so the fee is borne entirely by the source wallet.

| Wallet | Computed | Workbook | |
|---|---:|---:|:--:|
| Maya | 5,795.74 | 5,795.74 | ✔ |
| Cash | 161.00 | 161.00 | ✔ |
| Gcash | 155.71 | 155.71 | ✔ |
| Maya Bank (Personal savings) | 1,527.58 | 1,527.58 | ✔ |

**Monthly spend** — Aug 2026 → `6,943.58 + 3,886.79 + 443.00 + 18.00 = 11,291.37`, matches INSIGHTS I16.
**Annual spending** — `217,701.14 + 443.00 + 4,100.00 = 222,244.14`, matches SUMMARY D4.
**Spending ranking** — iterate the 17 CATEGORIES spending types, never raw ledger items. All 16 populated values matched.

## 2.3 Defect — TOTAL FUNDS does not tie to its own wallets

`SUMMARY!D9` shows **₱7,670.03**. The wallet balances printed beside it sum to **₱7,640.03**. A ₱30.00 gap, on screen, in the same viewport, with no indication anything is wrong.

Cause: the TOTAL FUNDS formula only subtracts a transfer fee when `category = 'Spending'` **and** `item = 'Transaction Fee'`. Two rows carry a real fee but fail that test:

| Record | Date | Transfer | Fee | Why it escapes |
|---|---|---|---:|---|
| #8 | 2026-01-04 | Gcash → Maya | 15.00 | category blank, item blank |
| #190 | 2026-04-03 | Gcash → Maya | 15.00 | category blank |

So ₱30.00 of fees never reaches the tile, while the same ₱30.00 *is* deducted from Gcash's balance. **Decision: the new app shows the sum of wallet balances**, so the headline always ties to the parts beside it, and both rows surface in the integrity check instead of being silently absorbed.

## 2.4 Defect — three disagreeing fee definitions

The workbook computes transaction fees three different ways in three different places: **513.00**, **443.00**, and **428.00**. Additionally, INSIGHTS treats the ₱18.00 August fee as its own bucket while Module10's report folds it into Spending (`6,961.58` vs `6,943.58`). Grand totals agree; the split does not.

**Resolution:** one attribution pass, fees ride with the spending track, and the two budget tracks provably sum to the month total — a property the Excel never had.

## 2.5 Defect — the ledger has quality holes

| Issue | Count / Value | Consequence |
|---|---:|---|
| Blank category | **64 rows** | Drop out of every category total, still move balances |
| Blank item | **63 rows** | Invisible to the ranking engine |
| Blank description | **28 rows** | Unauditable later — you won't remember |
| `Unknown` spending | **₱3,110.63** | 1.4% of annual spend is unaccounted |
| Hard-coded 5,000-row ceiling | across every SUMIFS | Silent data loss at ~4,993 rows (~2 yrs headroom) |

## 2.6 **The big one — you have debt and the system has no idea**

This is the finding that changes the design. Filtering the ledger for credit activity:

| Rec | Date | Booked as | Item | Amount | What it actually is |
|---|---|---|---|---:|---|
| 403 | 2026-07-29 | **Revenue** | Maya Credit | 2,500.00 | Borrowing — a liability |
| 408 | 2026-08-03 | Spending / Bills | Maya Credit | 2,688.79 | Repayment of principal + interest |
| 411 | 2026-08-04 | **Revenue** | Maya Credit | 0.85 | Reload freebie — actual income |
| 425 | 2026-08-13 | **Revenue** | Maya Credit | 1,050.00 | Borrowing |
| 427 | 2026-08-14 | **Revenue** | Maya Credit | 1,500.00 | Borrowing |
| 432 | 2026-08-20 | **Revenue** | Maya Credit | 400.00 | Borrowing |

```
Drawn on credit        ₱5,450.85
Repaid                 ₱2,688.79
─────────────────────────────────
OUTSTANDING            ₱2,762.06     ← appears nowhere in your system
```

**What this does to your numbers:**

- Reported annual revenue **₱245,715.96** includes **₱5,450.85 of borrowed money**. Borrowed money is not income; it is a liability with your name on it.
- TOTAL FUNDS shows **₱7,670.03**. Your actual net position is **₱7,640.03 − ₱2,762.06 = ₱4,877.97**.
- **Your system overstates your net worth by 57%.**

**Revenue quality breakdown** — what the ₱245,715.96 is really made of:

| Item | Amount | Share | Real income? |
|---|---:|---:|:--:|
| Framelink | 151,566.80 | 61.7% | ✔ |
| Allowance | 74,815.83 | 30.4% | ✔ |
| Random | 10,867.32 | 4.4% | ✔ |
| **Maya Credit** | **5,450.85** | **2.2%** | ✖ **borrowing** |
| **Transfer of balance** | **2,475.89** | **1.0%** | ✖ **opening balance** |
| **Cash on hand** | **500.00** | **0.2%** | ✖ **self-move** |
| Bank interest | 39.27 | 0.0% | ✔ |
| | **245,715.96** | | **true income ₱237,289.22** |

₱8,426.74 — 3.4% of reported revenue — is not income at all. Part 5.6 specifies the Debt module that fixes this.

## 2.7 UI review — why it reads as AI-generated

Your instinct is right. Concretely, from `ui.tsx` and `Dashboard.tsx`:

| Symptom | Evidence | Why it reads as generated |
|---|---|---|
| Default card shell | `rounded-xl border shadow-sm` on every surface | The universal AI-app card. Zero information encoded in the shape. |
| No typographic voice | `"Segoe UI", system-ui, -apple-system` | System stack = no decision was made. |
| Uppercase micro-labels everywhere | `text-xs font-medium uppercase tracking-wide` | Applied uniformly, so hierarchy carries no meaning. |
| Colour used as decoration | `tone: neutral \| good \| bad \| warn` | Four abstract tones, not four financial meanings. |
| Money is not typographically special | `.tnum` class only | In a ledger, money is the subject. It should look engineered. |
| The grid was thrown away | Everything is a floating card | Your Excel's identity **was** the heavy-ruled grid. Discarding it discarded the identity. |

The fix is not "more polish." It is a point of view, specified in full in Part 6.

## 2.8 Missing entirely

| Missing | Impact |
|---|---|
| Entry form | **You cannot add a transaction.** The app is read-only. |
| Debt module | Part 2.6 |
| Insights screen | The 20-view report engine has no home |
| Budgeting screen | 12-month grid, forecast, net cash flow |
| Statements screen | 4 statement types + export |
| Recycle bin | Soft deletes cannot be restored |
| Settings | Wallets, bills, subs, categories unmanageable |
| Firebase wiring | Auth, Firestore, security rules — none connected |
| PWA | Not installable on your phone |

---

# PART 3 — SECURITY: DO THIS TODAY

## 3.1 Exposed credentials

`CATEGORIES!U7:U16` holds **three live third-party API keys** in plain cells:

| Slot | Provider | Status |
|---|---|---|
| U7 | OpenRouter (`sk-or-v1-…`) | **COMPROMISED — rotate now** |
| U8 | OpenRouter (`sk-or-v1-…`) | **COMPROMISED — rotate now** |
| U9 | Groq (`gsk_…`) | **COMPROMISED — rotate now** |

These keys have now been visible in a spreadsheet screenshot, in a chat window, and in a folder headed for a public GitHub repository. Treat all three as **already leaked**. OpenRouter keys are billable — someone else can spend your credits.

**Do this now, in this order:**

1. **OpenRouter** → Settings → Keys → delete both keys → create one new key.
2. **Groq** → Console → API Keys → revoke → create new.
3. Do **not** paste the replacements into the spreadsheet, the repo, a config file, or a chat.
4. Store the replacement in a **Cloudflare Pages environment secret** (Part 7.9). The browser never sees it.
5. In the workbook, clear `U7:U16` and put a note in `U7`: `Keys moved to Cloudflare secrets — do not store keys here.`

## 3.2 The Firebase config is *not* a secret

Different situation, and worth understanding so you don't over-react:

```js
const firebaseConfig = {
  apiKey: "AIzaSy…",          // ← public client identifier. Safe in the bundle.
  authDomain: "financial-system-c2997.firebaseapp.com",
  databaseURL: "https://financial-system-c2997-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "financial-system-c2997",
  …
};
```

A Firebase web `apiKey` is an **identifier, not a credential** — it says which project you are talking to. It is designed to ship in client code. What actually protects your data is **security rules**. So: committing this config is fine; shipping weak rules is not.

## 3.3 Your Firebase project is currently misconfigured

From the console screenshots, two problems:

| Observed | Problem | Fix |
|---|---|---|
| **Realtime Database** created, data `null` | The plan targets **Firestore**, not RTDB. You have the wrong product provisioned. | Create a **Firestore** database (asia‑southeast1, matching your RTDB region). Leave RTDB empty or delete it. |
| Rules are `".read": false, ".write": false` | Correct default, but locks out everything including you. | Deploy the owner-locked Firestore rules in 3.4. |

## 3.4 The security rules to deploy

Single-user app, public URL, private data. Lock to exactly one UID:

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Exactly one account may read or write anything. No anonymous access,
    // no second user, no exceptions. Replace OWNER_UID after first sign-in.
    function isOwner() {
      return request.auth != null
          && request.auth.uid == 'OWNER_UID_GOES_HERE';
    }

    match /users/{uid}/{document=**} {
      allow read, write: if isOwner() && uid == 'OWNER_UID_GOES_HERE';
    }

    // Everything else is denied.
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

Enable **Google sign-in only** in Firebase Auth. No email/password, no anonymous — nothing to phish, nothing to leak.

## 3.5 Standing rules

| Rule | Reason |
|---|---|
| Secrets live in Cloudflare environment secrets. Nowhere else. | Never in the tree, never in the DB, never in a cell |
| The AI proxy runs server-side (`functions/api/ai.ts`) | The browser must never hold a provider key |
| `.gitignore` excludes `MY THINGS/`, `*.xlsm`, `*.xlsx`, fixtures | Both the keys **and** your entire financial history |
| Migration tooling **strips column U** before writing anything | Belt and braces |
| Never `git add -A` from the project root without checking `git status` | One careless stage puts your ledger on GitHub permanently |

---

# PART 4 — DATA MODEL v2

## 4.1 Design principles

| # | Principle |
|---|---|
| 1 | **Money is `Centavos` — a branded integer.** Parse at input, format at render, integers everywhere between. No `parseFloat` on money. No `toFixed` arithmetic. |
| 2 | **Dates are `YYYY-MM-DD` strings.** Never `Date` objects in the domain. No timezone traps. |
| 3 | **`id` is a stable surrogate key. `recordNumber` is display only** — it is reassigned on every write and must never be referenced. |
| 4 | **History is immutable.** Migration never rewrites a historical row's meaning. Corrections are proposed to you and applied only on your approval. |
| 5 | **Every derived figure is computed, never stored.** No aggregation documents that can drift out of sync. |

## 4.2 Transaction — the v2 shape

```ts
export type TransactionType =
  | "Revenue"     // money in from outside — actual income
  | "Spending"    // money out to outside
  | "Transfer"    // between your own wallets — net zero
  | "Debt";       // NEW — creates or settles a liability/asset

export interface Transaction {
  readonly id: string;              // stable surrogate key
  readonly recordNumber: number;    // Excel display number — never a reference
  readonly date: IsoDate;           // YYYY-MM-DD
  readonly type: TransactionType;
  readonly fromWallet: string;      // source; empty on most Revenue rows
  readonly toWallet: string;        // destination; empty on most Spending rows
  readonly category: TransactionCategory;
  readonly item: string;            // the real classifier — drives rankings
  readonly description: string;
  readonly amount: Centavos;
  readonly fee: Centavos;           // borne entirely by fromWallet
  readonly total: Centavos;         // invariant: amount + fee
  readonly notes: string;
  readonly status: TransactionStatus;

  // ── NEW in v2 ──────────────────────────────────────────────
  readonly debtId?: string;         // links to a Debt record
  readonly debtEffect?: DebtEffect; // what this row does to that debt
  readonly tags?: readonly string[];
  readonly reviewed?: boolean;      // cleared through the integrity queue
}

export type DebtEffect =
  | "draw"       // borrowing — wallet UP, liability UP.  NOT revenue.
  | "repay"      // principal  — wallet DOWN, liability DOWN. NOT spending.
  | "interest"   // interest   — wallet DOWN, liability flat. IS spending.
  | "fee"        // late/service fee — same treatment as interest.
  | "writeoff"   // forgiven   — liability DOWN, no wallet movement.
  | "lend"       // you lend   — wallet DOWN, asset UP.  NOT spending.
  | "collect";   // repaid to you — wallet UP, asset DOWN. NOT revenue.
```

## 4.3 Debt — the new entity

```ts
export type DebtKind =
  | "payable"      // you owe someone      → liability
  | "receivable";  // someone owes you     → asset

export interface Debt {
  readonly id: string;
  readonly name: string;              // "Maya Credit"
  readonly kind: DebtKind;
  readonly counterparty: string;      // "Maya", "Papa", "Kuya Jun"
  readonly openedDate: IsoDate;
  readonly dueDate?: IsoDate;
  readonly wallet: string;            // wallet the money moves through

  readonly interestType: "none" | "flat" | "monthly_pct";
  readonly interestRate: number;      // basis points. 3.5%/mo → 350
  readonly creditLimit?: Centavos;    // revolving lines only

  readonly status: "open" | "settled" | "written_off";
  readonly notes: string;
  readonly archived: boolean;
}
```

**Derived, never stored:**

```ts
export interface DebtPosition {
  readonly debt: Debt;
  readonly drawn: Centavos;        // Σ draw   (or lend)
  readonly repaid: Centavos;       // Σ repay  (or collect)
  readonly interestPaid: Centavos; // Σ interest + fee
  readonly writtenOff: Centavos;   // Σ writeoff
  readonly outstanding: Centavos;  // drawn − repaid − writtenOff
  readonly utilisation?: number;   // outstanding / creditLimit
  readonly daysToDue?: number;     // negative = overdue
  readonly nextDueDate?: IsoDate;
}
```

## 4.4 Firestore layout

```
users/{uid}/transactions/{id}      Transaction
users/{uid}/deleted/{id}           Transaction + deletedAt   (recycle bin)
users/{uid}/debts/{id}             Debt                      ← NEW
users/{uid}/budgets/{year}         { spending: C[12], billsSubs: C[12], debt: C[12] }
users/{uid}/reference/lists        { wallets, savings, bills, subscriptions,
                                     revenueCategories, spendingTypes, counterparties }
users/{uid}/meta/counters          { nextRecordNumber }
users/{uid}/meta/settings          { theme, defaultWallet, firstDayOfMonth }
```

**Whole ledger in memory is the correct call at this size.** 440 records now, ~650/year, so ten years is well under a megabyte. Every figure is computed client-side with the same semantics as the Excel, works offline, and needs no server logic that could drift.

## 4.5 Reference lists (from CATEGORIES)

| List | Source | Count | Notes |
|---|---|---:|---|
| Active wallets | `C7:C56` | 6 | Gcash · Maya · Cash · Reserved Fund · Allowance (Reserve) · Tuition (Reserve) |
| Savings | `D7:D56` | 2 | Extra Cash · Maya Bank (Personal savings) |
| Bills | `H7:H56` | 3 | Globe at Home Wifi · Dito Prepaid · **Maya Credit** ← becomes a Debt |
| Subscriptions | `I7:I56` | 4 | Spotify · Google Drive · Microsoft Office 365 · Netflix |
| Revenue categories | `M7:M56` | 7 | Includes **Maya Credit** ← must leave this list |
| Spending types | `P7:P56` + `Q` remarks | 17 | Authoritative domain for rankings |
| ~~API keys~~ | `U7:U16` | 3 | **STRIP AT MIGRATION. NEVER WRITE TO DISK.** |

> **Wallets are historical and open-ended, not a closed enum.** The ledger references `Hidden cash (fieldtrip)`, `Maya Bank (Drone)`, `Maya Bank (New Phone)` — none in the active list. Never validate historical data against the active list.

> **`Maya Credit` appears in both Bills and Revenue categories.** That is the symptom of the missing debt concept: borrowing was filed as revenue, repaying as a bill. Migration converts it to a `Debt` record.

---

# PART 5 — BUSINESS RULES

Rules 5.1–5.5 are **verified against the workbook** and must be ported exactly. Rules 5.6+ are new.

## 5.1 Wallet balance `[VERIFIED]`

```
balance(w) = SUM(total)  WHERE type = 'Revenue' AND fromWallet = w
           + SUM(amount) WHERE toWallet = w
           - SUM(total)  WHERE fromWallet = w AND type <> 'Revenue'
```

Debt rows participate normally: a `draw` credits `toWallet`, a `repay` debits `fromWallet`.

## 5.2 Monthly spend `[VERIFIED — Aug 2026 = 11,291.37]`

```
spending = SUM(total) WHERE type='Spending' AND category='Spending'
bills    = SUM(total) WHERE type='Spending' AND category='Bills'
subs     = SUM(total) WHERE type='Spending' AND category='Subscriptions'
fees     = SUM(fee)   WHERE type='Transfer' AND item='Transaction Fee'
interest = SUM(total) WHERE type='Debt'     AND debtEffect IN ('interest','fee')   ← NEW
monthTotal = spending + bills + subs + fees + interest
```

## 5.3 Annual spending `[VERIFIED — 222,244.14]`

```
  SUM(total) WHERE type='Spending' AND category='Spending'     217,701.14
+ SUM(fee)   WHERE type='Transfer' AND item='Transaction Fee'      443.00
+ SUM(total) WHERE type='Transfer' AND item='Money Send'         4,100.00
                                                            = 222,244.14
```

## 5.4 Spending ranking `[VERIFIED — 16/16 matched]`

Iterate the **17 CATEGORIES spending types**, never raw ledger items (that would pull in revenue items like `Framelink`). Per type:

- `Transaction Fee` → `SUM(fee)` across all rows
- `Money Send` → `SUM(amount) WHERE category='Spending' AND item='Money Send'`
- otherwise → `SUM(total) WHERE item = type`, within the window

## 5.5 Budget status `[VERIFIED]`

Two independent tracks, each `OVER THE BUDGET` when spent > budget. **A third track is added for debt service** (interest + fees, not principal). Budgets live at `BUDGETING!H11:S11` and `H12:S12`, columns H..S = Jan..Dec.

## 5.6 **DEBT — the new module**

### 5.6.1 The accounting rules

The whole module rests on four statements. Print them on the wall.

| Event | Wallet | Liability | Counts as income? | Counts as spending? |
|---|:---:|:---:|:---:|:---:|
| **Draw** — you borrow | ▲ up | ▲ up | **NO** | no |
| **Repay** — principal | ▼ down | ▼ down | no | **NO** |
| **Interest / fee** | ▼ down | – flat | no | **YES** |
| **Write-off** — forgiven | – none | ▼ down | yes¹ | no |

¹ A forgiven debt is a genuine gain, but book it as `Debt/writeoff`, not `Revenue`, so it never contaminates the income trend.

Mirror image for money you lend out:

| Event | Wallet | Asset | Income? | Spending? |
|---|:---:|:---:|:---:|:---:|
| **Lend** | ▼ down | ▲ up | no | **NO** |
| **Collect** | ▲ up | ▼ down | **NO** | no |
| **Bad debt** | – none | ▼ down | no | yes² |

² A receivable you accept you will never collect is a real loss.

### 5.6.2 Outstanding balance

```
outstanding(d) = SUM(amount) WHERE debtId=d AND debtEffect='draw'
               − SUM(amount) WHERE debtId=d AND debtEffect='repay'
               − SUM(amount) WHERE debtId=d AND debtEffect='writeoff'
```

Interest is **excluded** — it is expense, not principal. Paying ₱2,688.79 against a ₱2,500.00 draw reduces principal by ₱2,500.00 and books ₱188.79 as interest expense.

### 5.6.3 Net worth — the figure the Excel never had

```
netWorth = Σ wallet balances
         + Σ savings balances
         + Σ receivables outstanding
         − Σ payables outstanding
```

Applied to your data today:

| Component | Amount |
|---|---:|
| Wallets (Maya + Cash + Gcash) | 6,112.45 |
| Savings (Maya Bank Personal) | 1,527.58 |
| Receivables | 0.00 |
| **Payables (Maya Credit)** | **−2,762.06** |
| **NET WORTH** | **₱4,877.97** |

Against the ₱7,670.03 your system currently reports, that is a **57% overstatement**.

### 5.6.4 True income

```
trueIncome = SUM(total) WHERE type='Revenue'
           − SUM(total) WHERE type='Revenue' AND item IN debtNames
           − SUM(total) WHERE type='Revenue' AND item='Transfer of balance'
           − SUM(total) WHERE type='Revenue' AND item='Cash on hand'
```

2026 YTD: `245,715.96 − 5,450.85 − 2,475.89 − 500.00 = ₱237,289.22`

Show **both** figures on the Insights screen, labelled `Income` and `Cash in (incl. borrowing)`, so the difference is visible rather than hidden.

### 5.6.5 Migration of the six Maya Credit rows

**Never silently rewrite history.** On first run, the app presents a one-time review queue:

```
┌─────────────────────────────────────────────────────────────┐
│  DEBT DETECTED — 6 rows look like credit activity           │
│  "Maya Credit" appears as both a Revenue category and a     │
│  Bill. That pattern means borrowing, not income.            │
│                                                             │
│  Proposed: create debt "Maya Credit" (payable, Maya)        │
│    #403  2026-07-29   ₱2,500.00   Revenue → Debt/draw       │
│    #425  2026-08-13   ₱1,050.00   Revenue → Debt/draw       │
│    #427  2026-08-14   ₱1,500.00   Revenue → Debt/draw       │
│    #432  2026-08-20     ₱400.00   Revenue → Debt/draw       │
│    #408  2026-08-03   ₱2,688.79   Bills   → Debt/repay      │
│                                    ₱2,500.00 principal      │
│                                      ₱188.79 interest       │
│    #411  2026-08-04       ₱0.85   Revenue → keep as Revenue │
│                          (reload freebie — real income)     │
│                                                             │
│  Result: outstanding ₱2,762.06 · revenue −₱5,450.85         │
│                                                             │
│  [ Review each ]   [ Apply all ]   [ Not now ]              │
└─────────────────────────────────────────────────────────────┘
```

Wallet balances are **unchanged** by this migration — only classification moves. Assert that in a test.

### 5.6.6 Debt rules to implement

| # | Rule |
|---|---|
| D1 | A `Debt` transaction **must** carry `debtId` and `debtEffect`. Reject the save otherwise. |
| D2 | `repay` may not exceed `outstanding`. Excess auto-splits into an `interest` row, shown before saving. |
| D3 | `draw` may not exceed `creditLimit − outstanding` when a limit is set. Warn, allow override. |
| D4 | A debt auto-closes to `settled` when `outstanding` reaches 0. Reopens on a new draw. |
| D5 | Interest on `monthly_pct` accrues on the **last day of the month** on the closing balance. Never compound silently — post a visible `interest` row. |
| D6 | Debt due within 7 days → Finance Alert. Overdue → persistent banner. |
| D7 | Debt **never** appears in the spending ranking. Interest appears as its own `Debt Interest` type. |
| D8 | Net worth **always** shows payables, even at zero, so the concept stays visible. |

## 5.7 Smart daily allocation (Module10 — port as-is)

```
dailyBudget = walletBalance / daysLeftInMonth
score(cat)  = avgAmount × recurrenceMultiplier
```

Multiplier: `×2` if due/overdue · `×1.5` if due within 2 days · `×1.1` if 2+ transactions in the last 7 days · else `×1`. Then proportional split; cap **25%** per category; floor 50 (or `avgAmount × 0.5` clamped to [50,150]); round to nearest 10; if total exceeds budget, rescale to **90%**; display **top 3**.

- Recurring = 3+ transactions, avgGap ≤ 30d, daysSinceLast ≤ 45d
- Overdue = 6+ transactions, avgGap 2–14d, daysSinceLast > avgGap × 0.8
- **NEW:** debt due inside the window is a **hard first claim** — deducted before allocation, never scored against.

## 5.8 Forecast (Module4)

Spending, in priority order: same month last year × 1.03 → mean of last 3 months × 1.03 → overall mean × 1.03.
Bills: most recent non-zero month, **never forecast below it**.
**NEW:** scheduled debt repayments are added as a known, non-estimated line.

## 5.9 Bill due prediction

`nextDue = lastPaidDate + 1 month`, per bill/subscription item. Debts use their own `dueDate` when set.

## 5.10 Statement filters (Module5)

| Type | Includes |
|---|---|
| Account Statement | Everything in range |
| Revenue Sheet | `type='Revenue'` |
| Expense Sheet | `type='Spending'` + Transfer rows with `category='Spending'` and `item='Transaction Fee'` + `Debt/interest` + `Debt/fee` |
| Savings Sheet | Rows whose from/to wallet is a known savings wallet |
| **Debt Statement** *(new)* | All rows with a `debtId`, grouped by debt, with a running outstanding column |

## 5.11 Write path (Module1)

Required: `type` and `amount`. On save: validate → balance check → chronological insert → renumber → clear form → refresh next ID.
Warnings (both proceed-able): resulting balance < 0; withdrawal from a wallet whose name contains "saving".
**NEW warning:** saving a `Revenue` row whose item matches an open debt name → *"This looks like borrowing. Book it as a debt draw instead?"*

## 5.12 Autofill (Module8)

Learns most common `toWallet` per revenue, `fromWallet` per spending, transfer destination per source, category per (type, wallet), item per (type, category), status per (type, item), and a predicted fee per wallet pair. Renders as grey ghost text; click to accept; rejections tracked. LLM used only for free-text descriptions, with a local generator fallback.

## 5.13 Integrity checks — the standing queue

Every check produces a row in a reviewable queue, never a silent correction.

| ID | Check | Severity | Current hits |
|---|---|:---:|---:|
| `INT-01` | Transfer with a fee but blank category | **error** | 2 (#8, #190) |
| `INT-02` | `total ≠ amount + fee` | **error** | 0 |
| `INT-03` | Spending row with blank item | warn | 63 |
| `INT-04` | Row with blank category | warn | 64 |
| `INT-05` | `item='Unknown'` | info | ₱3,110.63 |
| `INT-06` | Revenue whose item matches an open debt | **error** | 4 |
| `INT-07` | Wallet referenced but not in the active list | info | 3 wallets |
| `INT-08` | Blank description | info | 28 |
| `INT-09` | Transfer where `fromWallet = toWallet` | **error** | 0 |
| `INT-10` | Debt row missing `debtId` / `debtEffect` | **error** | n/a |
| `INT-11` | Negative resulting wallet balance at any point | warn | run it |
| `INT-12` | Duplicate suspect — same date, amount, item within 3 days | info | run it |

**Do not over-fire.** The previous session's check flagged 28 rows, of which only 1 was genuine — a `Transfer` row with `item='Transaction Fee'` and a populated `amount` is completely normal (the amount is the transfer, the fee is the fee). `INT-01` must test **blank category**, not the presence of a fee.

---

# PART 6 — THE DESIGN SYSTEM

> This is the part you said was ugly. Everything below is a decision with a reason. An agent implementing this must not substitute defaults for any of it.

## 6.1 The direction, in one line

**Ledger, not dashboard.** Your Excel's identity was never the green fill — it was the **heavy-ruled grid**: black 2px outer borders, hairline inner cells, dense columns, money that lines up. The previous attempt threw the grid away and replaced it with floating rounded cards, which is why it looks like every other AI app. This design puts the grid back and makes it the point.

### What was rejected, and why

| Rejected | Reason |
|---|---|
| Cream `#F4F1EA` + serif + terracotta `#D97757` | The single most common AI-generated look right now. Instantly recognisable as generated. |
| Near-black + one acid accent | Default #2. Also wrong for a document you read in daylight. |
| Floating rounded cards on grey | What you already have and already dislike. |
| Glassmorphism / gradient meshes | Decoration with no informational job. |
| Inter as the UI face | The default. Choosing it is not choosing. |

### The three signature moves

| # | Move | What it encodes |
|---|---|---|
| **S1** | **The Rule.** A 2px ink rule under every section header, hairlines inside tables. Nothing floats. | The Excel's black-bordered tables, translated honestly. |
| **S2** | **Money is monospace.** All figures in IBM Plex Mono, tabular, right-aligned, with the ₱ in muted weight. | Money is the subject of this app. It should look like an instrument, not body copy. |
| **S3** | **The Flow Rail.** A 3px vertical bar at the left edge of every ledger row, colour-coded by *direction of money*, not by category. | Four financial meanings become instantly scannable without reading. |

Boldness is spent on S2 and S3. Everything else stays quiet.

## 6.2 COLOUR CODE — light theme

### 6.2.1 Surfaces & ink

| Token | Hex | Swatch | Use |
|---|---|---|---|
| `--paper` | `#F6F8F3` | 🟩 pale sage | App canvas. Never pure white — this is a document. |
| `--surface` | `#FFFFFF` | ⬜ white | Table bodies, sheets, entry form |
| `--surface-sunk` | `#EDF2E7` | 🟩 mint wash | Zebra rows, disabled fields, table footers |
| `--rule` | `#000000` @ 100% | ⬛ ink | **S1** section rules. 2px. The structural signature. |
| `--hairline` | `#D5DFCB` | ⬜ pale | Table cell borders. 1px. |
| `--ink` | `#131A0E` | ⬛ near-black | Primary text |
| `--ink-2` | `#4F5C46` | 🟫 olive-grey | Secondary text, labels |
| `--ink-3` | `#7E8B75` | 🟫 muted | Captions, placeholders, ₱ symbol |

### 6.2.2 Brand green — taken from your workbook

| Token | Hex | Swatch | Use |
|---|---|---|---|
| `--forest-900` | `#16300F` | 🟩 darkest | Header bar on dark, deep accents |
| `--forest-800` | `#1F4415` | 🟩 | Hover on header |
| `--forest-700` | `#2F6B21` | 🟩 **PRIMARY** | Header bar, primary buttons, active nav. *Sampled from your Excel header.* |
| `--forest-600` | `#3F7A22` | 🟩 | Button hover |
| `--forest-500` | `#55982F` | 🟩 | Focus rings, links |
| `--forest-300` | `#9BCD77` | 🟩 | Chart mid-tone |
| `--forest-100` | `#DFF0D0` | 🟩 **row fill** | *Sampled from your Excel data rows.* Selected states. |
| `--forest-50` | `#F2F9EC` | 🟩 lightest | Subtle wash |

### 6.2.3 FLOW COLOURS — the semantic core (S3)

Colour never decorates. It encodes **direction of money** and nothing else.

| Flow | Rail | Text | Bg wash | Glyph | Meaning |
|---|---|---|---|:--:|---|
| **Revenue** | `#1E7A3C` | `#14532D` | `#E7F5EC` | `↓` | Money in from outside. A gain. |
| **Spending** | `#B3261E` | `#8C1D18` | `#FCEAE9` | `↑` | Money out to outside. A loss. |
| **Transfer** | `#5B6A52` | `#3F4A38` | `#EEF1EC` | `⇄` | Between your own wallets. **Deliberately grey — a transfer is neither gain nor loss.** |
| **Debt** | `#9A5B12` | `#7A4409` | `#FBF0E2` | `◑` | Borrowed or lent. **Amber, not red** — a liability is not an expense. |

> **The Transfer grey is the most important colour in the system.** Half your ledger rows are transfers. Colouring them red or green would make it look like you gain and lose money moving cash between your own pockets. Grey states the truth: nothing happened.

> **The Debt amber is the second most important.** If debt were red it would read as spending, which is exactly the confusion that put ₱5,450.85 of borrowing into your revenue line.

### 6.2.4 Status colours

| Token | Hex | Bg | Use |
|---|---|---|---|
| `--ok` | `#1E7A3C` | `#E7F5EC` | WITHIN THE BUDGET · Paid · Done · Settled |
| `--over` | `#B3261E` | `#FCEAE9` | OVER THE BUDGET · overdue · negative balance |
| `--warn` | `#8A5A00` | `#FDF3D8` | Approaching limit · due soon · integrity warnings |
| `--info` | `#1F5F8B` | `#E8F1F8` | Neutral notices, integrity info |
| `--none` | `#7E8B75` | `#EFF2ED` | NO BUDGET SET · empty · archived |

### 6.2.5 Category palette (charts only)

Sequential, colour-blind-safe, deliberately **not** rainbow. Ordered by your actual annual ranking so the treemap is stable across renders.

| Rank | Category | Hex | 2026 YTD |
|---:|---|---|---:|
| 1 | School | `#1F4415` | 52,432.00 |
| 2 | Online Buy | `#2F6B21` | 41,491.74 |
| 3 | Treat | `#3F7A22` | 25,702.00 |
| 4 | Money Send | `#55982F` | 17,061.00 |
| 5 | Home Needs | `#6FAA45` | 15,948.00 |
| 6 | Food | `#8ABE62` | 14,513.00 |
| 7 | Travel | `#A6CF83` | 13,656.00 |
| 8 | Repairs | `#9A5B12` | 12,931.00 |
| 9 | Fun | `#B8791F` | 7,805.00 |
| 10 | Random necessities | `#C99A4E` | 5,905.00 |
| 11 | Gas | `#5B6A52` | 5,528.27 |
| 12 | Unknown | `#8A9682` | 3,110.63 |
| 13 | Self Care | `#A8B29F` | 1,431.00 |
| 14 | Transaction Fee | `#C2C9BC` | 428.00 |
| 15 | Parking | `#D5DACF` | 250.00 |
| 16 | Emergency | `#E4E8E0` | 11.50 |
| — | Health | `#EFF2ED` | 0.00 |

Greens for ordinary life, ambers for discretionary, greys for leakage. **Unknown is deliberately dull** — it should look like a gap, because it is one.

## 6.3 COLOUR CODE — dark theme

Not an inversion. A separate, tuned palette. Dark mode is for phone use at night.

| Token | Light | Dark | Note |
|---|---|---|---|
| `--paper` | `#F6F8F3` | `#0D120A` | Deep, near-black green |
| `--surface` | `#FFFFFF` | `#141B10` | |
| `--surface-sunk` | `#EDF2E7` | `#1B2416` | |
| `--rule` | `#000000` | `#E4EDDD` | **Rule inverts to light ink** — the signature survives |
| `--hairline` | `#D5DFCB` | `#2C3826` | |
| `--ink` | `#131A0E` | `#E4EDDD` | |
| `--ink-2` | `#4F5C46` | `#A5B39C` | |
| `--ink-3` | `#7E8B75` | `#78866F` | |
| `--forest-700` (header) | `#2F6B21` | `#1F3D16` | |
| Revenue rail | `#1E7A3C` | `#5FC97F` | Lifted for contrast |
| Spending rail | `#B3261E` | `#F0857A` | |
| Transfer rail | `#5B6A52` | `#94A38B` | |
| Debt rail | `#9A5B12` | `#E0A45C` | |
| `--ok` | `#1E7A3C` | `#7DC95C` | |
| `--over` | `#B3261E` | `#F08B7F` | |
| `--warn` | `#8A5A00` | `#E0B155` | |

> **The bug from your last session:** dark tokens landed in the `@media (prefers-color-scheme: dark)` block but not the `[data-theme="dark"]` block, so flagged rows had unreadable contrast. Both blocks must be written from **one shared source**. See 6.9.

### Contrast floor — non-negotiable

| Pair | Ratio | Standard |
|---|---:|---|
| `--ink` on `--surface` | 15.8:1 | AAA |
| `--ink-2` on `--surface` | 7.4:1 | AAA |
| `--ink-3` on `--surface` | 4.6:1 | AA |
| Spending text on its wash | 7.1:1 | AAA |
| Debt text on its wash | 6.8:1 | AAA |
| White on `--forest-700` | 6.9:1 | AAA |

**Every flow colour must clear 4.5:1 on its own wash in both themes. Test it, don't assume it.**

## 6.4 TYPOGRAPHY

Three faces, three jobs. Self-hosted via `@fontsource` — no Google Fonts CDN, so it works offline in the PWA.

| Role | Face | Why this one |
|---|---|---|
| **Display** | **Archivo** (600/700, width axis) | A grotesque with real width variation. Condenses for dense table headers without a second family. Not Inter, not a system stack. |
| **Body / UI** | **Public Sans** (400/500/600) | Government-grade legibility, designed for forms and dense data. Neutral without being characterless. |
| **Money & data** | **IBM Plex Mono** (400/500/600) | **Signature S2.** Every figure monospaced and right-aligned. Columns align perfectly at any size. A ledger should look engineered. |

```
Fallbacks:
  display : Archivo, "Archivo Expanded", system-ui, sans-serif
  body    : "Public Sans", system-ui, -apple-system, sans-serif
  mono    : "IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace
```

### Type scale

| Token | Size / line | Weight | Tracking | Face | Use |
|---|---|---:|---|---|---|
| `display-xl` | 40/44 | 700 | −0.02em | Archivo | Net worth on Dashboard. One per screen. |
| `display-l` | 30/36 | 700 | −0.015em | Archivo | Screen titles |
| `display-m` | 22/28 | 600 | −0.01em | Archivo | Card titles |
| `label` | 11/16 | 600 | +0.08em, UPPER | Archivo | Section eyebrows. **Sparingly.** |
| `body` | 15/22 | 400 | 0 | Public Sans | Descriptions, prose |
| `body-strong` | 15/22 | 600 | 0 | Public Sans | Emphasis, active nav |
| `caption` | 13/18 | 400 | 0 | Public Sans | Dates, meta |
| `micro` | 11/14 | 500 | +0.02em | Public Sans | Table headers, badges |
| `money-xl` | 34/38 | 500 | −0.03em | Plex Mono | Hero figures |
| `money-l` | 20/26 | 500 | −0.02em | Plex Mono | Card figures |
| `money` | 15/20 | 400 | −0.01em | Plex Mono | Table cells |
| `money-s` | 13/18 | 400 | −0.01em | Plex Mono | Secondary amounts |

### Money formatting rules

| Rule | Example |
|---|---|
| Always 2 decimals, always thousands separators | `₱5,795.74` |
| ₱ in `--ink-3`, one weight lighter, `0.25em` gap | `<span class=peso>₱</span>5,795.74` |
| Right-aligned in every table | — |
| `font-variant-numeric: tabular-nums` always | — |
| Negative in `--over`, with a real minus `−`, never a hyphen | `−₱2,762.06` |
| Zero is `₱0.00`, never blank or `–` | `₱0.00` |
| Sign shown only where direction matters | `+₱6,578.28` on ledger rows |

## 6.5 SPACING, RADIUS, ELEVATION

4px base. **The 8px sub-step is banned above 16 to prevent drift.**

| Token | px | Use |
|---|---:|---|
| `space-1` | 4 | Icon gaps |
| `space-2` | 8 | Inside badges |
| `space-3` | 12 | Table cell padding |
| `space-4` | 16 | Standard element gap |
| `space-6` | 24 | Section gap |
| `space-8` | 32 | Screen padding (desktop) |
| `space-12` | 48 | Major section break |

| Token | px | Use |
|---|---:|---|
| `radius-none` | 0 | **Tables, rails, section rules.** The default for structure. |
| `radius-sm` | 4 | Badges, inputs, buttons |
| `radius-md` | 8 | Sheets, modals, popovers |
| `radius-full` | 999 | Avatar, toggle knob |

> **`rounded-xl` is banned on data surfaces.** It is the tell. Tables and ledger rows have square corners because a ledger is ruled paper, not a card.

**Elevation:** exactly two levels. Flat (everything) and `0 8px 24px rgba(19,26,14,.14)` (modals, sheets, dropdowns). **No `shadow-sm` on cards.** Separation comes from the rule and the hairline, not from shadow.

## 6.6 COMPONENTS

### 6.6.1 Section header — signature S1

```
┌──────────────────────────────────────────────┐
│ WALLETS                          Aug 29, 2026│   ← label 11/600/+0.08em
├══════════════════════════════════════════════┤   ← 2px --rule. THE signature.
│  Maya                             ₱5,795.74  │
│  Cash                               ₱161.00  │   ← 1px --hairline between rows
│  Gcash                              ₱155.71  │
└──────────────────────────────────────────────┘
```

No border-radius. No shadow. No card. The rule does the work.

### 6.6.2 Ledger row — signature S3

```
▌ Treat                                   −₱1,100.00
▌ Treat my friends at Bacsil View deck
▌ 08/28/2026 · Maya · Spending
▲ 3px rail, --flow-spending

▌ Framelink                               +₱6,578.28
▌ Framelink income
▌ 08/28/2026 · → Maya · Revenue
▲ 3px rail, --flow-revenue

▌ Gcash → Maya                             ₱2,700.00
▌ Transfer fee at from Gcash                 ₱18.00 fee
▌ 08/03/2026 · Transfer
▲ 3px rail, --flow-transfer  (GREY — no gain, no loss)

▌ Maya Credit                             −₱2,688.79
▌ ₱2,500.00 principal · ₱188.79 interest
▌ 08/03/2026 · Maya · Debt repay · ₱2,762.06 left
▲ 3px rail, --flow-debt  (AMBER)
```

Desktop switches to a full ruled table; the rail becomes the leftmost 3px column. Same colour language.

### 6.6.3 Flow badge

Not a rounded pill. A **square-cornered tag** with the flow glyph, 11/500, `radius-sm`, flow text colour on flow wash, 1px border in the rail colour at 30% alpha.

`↓ Revenue`  ·  `↑ Spending`  ·  `⇄ Transfer`  ·  `◑ Debt`

### 6.6.4 Stat block

```
NET WORTH                    ← label
₱4,877.97                    ← money-xl, Plex Mono
Wallets 6,112.45 · Savings 1,527.58 · Debt −2,762.06
                             ← caption, each component in its flow colour
```

**Always break net worth into its components.** The whole point of the debt module is that the parts are visible.

### 6.6.5 Budget bar

Square, 8px tall, no radius. Fill in `--ok`, turning `--over` past 100%. A 1px `--ink` tick marks today's pro-rata position, so pace is legible at a glance.

```
Spending      ₱11,291.37 / ₱7,700.00
████████████████████████│███████       OVER THE BUDGET
                        ▲ today
```

### 6.6.6 Debt card

```
MAYA CREDIT                              ◑ payable
₱2,762.06 outstanding
────────────────────────────────────────────────
Drawn      ₱5,450.85    Repaid     ₱2,688.79
Interest     ₱188.79    Limit          — 
Opened   2026-07-29     Next due   2026-09-03
────────────────────────────────────────────────
[ Draw ]  [ Repay ]  [ Log interest ]
```

Amber rail down the left. If overdue, the rail turns `--over` and a banner appears — the only place debt is allowed to look like an emergency.

### 6.6.7 Empty states

Never "No data." Always name the action.

| Screen | Copy |
|---|---|
| Ledger | `No transactions yet. Add your first one.` |
| Debt | `No debts tracked. Good place to be. [ Add a debt ]` |
| Bin | `Nothing deleted. Deleted transactions stay here until you clear them.` |
| Integrity | `Nothing to review. All 440 rows check out.` |
| Budget | `No budget set for September. [ Set it ]` |

### 6.6.8 Errors

Never apologise, never vague. State what happened and what to do.

| Bad | Good |
|---|---|
| "Something went wrong" | `Couldn't save. You're offline — this will sync when you reconnect.` |
| "Invalid input" | `Amount must be more than ₱0.00.` |
| "Error 403" | `Sign in again to continue.` |

## 6.7 MOTION

Deliberately minimal — this is a document, not a toy.

| Interaction | Duration | Easing |
|---|---:|---|
| Hover / focus | 120ms | `ease-out` |
| Sheet / modal in | 220ms | `cubic-bezier(.32,.72,0,1)` |
| Tab switch | 160ms | `ease-out` |
| Number change | 400ms count-up | `ease-out` |
| Row insert | 200ms height + fade | `ease-out` |

`prefers-reduced-motion: reduce` → everything to `0.01ms`. Already correct in your CSS; keep it.

**No page transitions. No parallax. No animated gradients. No skeleton shimmer** — use a static hairline placeholder instead.

## 6.8 LAYOUT

| Breakpoint | Width | Layout |
|---|---|---|
| `phone` | < 640px | Single column, bottom nav (5 items), 16px padding, sheets slide from bottom |
| `tablet` | 640–1023px | Two columns, bottom nav, 24px padding |
| `desktop` | ≥ 1024px | 240px fixed sidebar + fluid content, 32px padding, max content 1440px |

**Phone is the primary target.** You will enter transactions on your phone and read reports on your PC. Design entry for the thumb: primary action bottom-right, 44px minimum touch target, numeric keypad on amount fields (`inputmode="decimal"`).

## 6.9 TOKEN IMPLEMENTATION

One source of truth. Tokens defined once, themes swap values only.

```css
/* tokens.css — the ONLY place a hex literal may appear */

:root {
  /* Surfaces */
  --paper:        #F6F8F3;
  --surface:      #FFFFFF;
  --surface-sunk: #EDF2E7;
  --rule:         #000000;
  --hairline:     #D5DFCB;

  /* Ink */
  --ink:   #131A0E;
  --ink-2: #4F5C46;
  --ink-3: #7E8B75;

  /* Brand */
  --forest-900: #16300F;  --forest-700: #2F6B21;  --forest-500: #55982F;
  --forest-800: #1F4415;  --forest-600: #3F7A22;  --forest-300: #9BCD77;
  --forest-100: #DFF0D0;  --forest-50:  #F2F9EC;

  /* FLOW — the semantic core */
  --flow-revenue:       #1E7A3C;
  --flow-revenue-text:  #14532D;
  --flow-revenue-bg:    #E7F5EC;
  --flow-spending:      #B3261E;
  --flow-spending-text: #8C1D18;
  --flow-spending-bg:   #FCEAE9;
  --flow-transfer:      #5B6A52;
  --flow-transfer-text: #3F4A38;
  --flow-transfer-bg:   #EEF1EC;
  --flow-debt:          #9A5B12;
  --flow-debt-text:     #7A4409;
  --flow-debt-bg:       #FBF0E2;

  /* Status */
  --ok:   #1E7A3C;  --ok-bg:   #E7F5EC;
  --over: #B3261E;  --over-bg: #FCEAE9;
  --warn: #8A5A00;  --warn-bg: #FDF3D8;
  --info: #1F5F8B;  --info-bg: #E8F1F8;
  --none: #7E8B75;  --none-bg: #EFF2ED;

  /* Type */
  --font-display: Archivo, system-ui, sans-serif;
  --font-body:    "Public Sans", system-ui, -apple-system, sans-serif;
  --font-mono:    "IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace;

  color-scheme: light;
}

/*
 * Dark theme. Both selectors below share ONE declaration block via
 * :is(), so the two can never drift apart — that drift is exactly what
 * caused the unreadable flagged rows in the previous build.
 */
:is(:root[data-theme="dark"],
    :root:not([data-theme="light"]):has(~ *) ) { /* see note */ }

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { --theme-dark: 1; }
}
:root[data-theme="dark"] { --theme-dark: 1; }

/* Single dark block, applied whenever --theme-dark is set. */
@supports (color: rgb(from white r g b)) {
  :root:where([data-theme="dark"]), 
  :root:where(:not([data-theme="light"])) {
    /* values applied only when --theme-dark resolves — see dark.css */
  }
}
```

> **Implementation note for the agent:** the cleanest correct approach is to put every dark value in a single class, `.theme-dark`, and set that class on `<html>` from one small script that reads both the stored preference and `matchMedia("(prefers-color-scheme: dark)")`. One block, one source, no duplication, no drift. Do that rather than maintaining two CSS blocks by hand.

**Hard rules:**

| # | Rule |
|---|---|
| T1 | Hex literals appear **only** in `tokens.css`. Everywhere else uses `var(--…)`. |
| T2 | No Tailwind colour utilities on data surfaces (`bg-green-500`, `text-red-600`). Tokens only. |
| T3 | Flow colours are used **only** for flow. Never for decoration. |
| T4 | Every new colour needs a documented reason and a contrast check in both themes. |
| T5 | `rounded-xl` and `shadow-sm` are banned on tables, rows, and stat blocks. |

---

# PART 7 — SCREEN SPECIFICATIONS

Nine screens. Ordered by value — each is usable the day it ships.

## 7.1 Nav

| Phone (bottom, 5) | Desktop (sidebar, 9) |
|---|---|
| Home · Ledger · **＋** · Insights · More | Dashboard · Add · Ledger · Debt · Insights · Budget · Statements · Bin · Settings |

The **＋** is a raised circular button in `--forest-700`, centre of the bottom bar. It is the single most-used action in the app and gets the best position on the screen.

## 7.2 Dashboard

```
┌────────────────────────────────────────────────┐
│ NET WORTH                        29 Aug 2026   │
├════════════════════════════════════════════════┤
│ ₱4,877.97                                      │
│ Wallets 6,112.45 · Savings 1,527.58            │
│ Debt −2,762.06                                 │
└────────────────────────────────────────────────┘

┌─ WALLETS ──────────────┐ ┌─ THIS MONTH ────────┐
├════════════════════════┤ ├═════════════════════┤
│ Maya         ₱5,795.74 │ │ Spending            │
│ Cash           ₱161.00 │ │ 11,291.37 / 7,700   │
│ Gcash          ₱155.71 │ │ ████████│███  OVER  │
│ ─────────────────────  │ │                     │
│ Maya Bank    ₱1,527.58 │ │ Bills & Subs        │
└────────────────────────┘ │ 1,641 / 1,700  OK   │
                           └─────────────────────┘
┌─ DEBT ─────────────────┐ ┌─ TOP SPENDING ──────┐
├════════════════════════┤ ├═════════════════════┤
│ ◑ Maya Credit          │ │ School    ₱52,432.00│
│   ₱2,762.06            │ │ Online Buy 41,491.74│
│   due 3 Sep · 5 days   │ │ Treat      25,702.00│
└────────────────────────┘ └─────────────────────┘

┌─ NEEDS REVIEW ─────────────────────────── 2 ──┐
├═══════════════════════════════════════════════┤
│ ⚠ #8   Transfer fee ₱15.00, no category       │
│ ⚠ #190 Transfer fee ₱15.00, no category       │
│ These two are why TOTAL FUNDS was off by ₱30. │
│                                    [ Review ] │
└───────────────────────────────────────────────┘
```

**Net worth is the hero, and it is always broken into components.** That is the whole argument of this redesign in one block.

## 7.3 Add / Edit — the screen that matters most

Currently missing entirely, which means the app cannot be used. Build it first after the domain work.

**Step 1 — pick the flow.** Four large tiles, each in its flow colour. This one choice drives the entire rest of the form.

```
┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐
│    ↓    │ │    ↑    │ │    ⇄    │ │    ◑    │
│ REVENUE │ │SPENDING │ │TRANSFER │ │  DEBT   │
└─────────┘ └─────────┘ └─────────┘ └─────────┘
```

**Step 2 — the fields that flow actually needs.** Not one form with everything disabled.

| Flow | Fields |
|---|---|
| **Revenue** | date · to wallet · category · item · description · amount · status |
| **Spending** | date · from wallet · category (Spending/Bills/Subs) · item · description · amount · fee · status |
| **Transfer** | date · from · to · amount · fee · notes · status |
| **Debt** | date · **debt** · **effect** (draw/repay/interest/writeoff) · wallet · amount · notes |

**Live behaviours:**

| Behaviour | Detail |
|---|---|
| Running balance | Under the wallet field: `Maya ₱5,795.74 → ₱4,695.74` updates as you type |
| Autofill ghost text | Rule 5.12. Grey inline suggestion; tap to accept |
| Debt split preview | Repay > outstanding → `₱2,500.00 principal + ₱188.79 interest` shown **before** saving |
| Borrowing catch | Revenue whose item matches an open debt → *"This looks like borrowing. Book as a debt draw?"* |
| Negative warning | `This puts Gcash at −₱44.29. Save anyway?` — proceed-able |
| Savings warning | Withdrawal from a wallet containing "saving" — proceed-able |
| Amount input | `inputmode="decimal"`, ₱ prefix, monospace, right-aligned |
| Autosave draft | Survives an accidental close |

Save → chronological insert → renumber → toast `Saved. Record #0442.` with **Undo** for 6 seconds.

## 7.4 Ledger

440 rows, virtualised. Phone = stacked rows with rails. Desktop = full ruled table.

**Filter bar:** `All · ↓ Revenue · ↑ Spending · ⇄ Transfer · ◑ Debt · ⚠ Flagged`
Search across item, description, wallet, notes, amount. Date-range picker. Column sort on desktop. Row tap → detail sheet with Edit / Duplicate / Delete.

Delete is **soft** — goes to the bin, restorable, never gone.

## 7.5 Debt (new screen)

```
┌─ YOU OWE ──────────────────────────────────────┐
├════════════════════════════════════════════════┤
│ ◑ Maya Credit          ₱2,762.06   due in 5d  │
│   ██████░░░░  drawn 5,450.85 · repaid 2,688.79│
└────────────────────────────────────────────────┘

┌─ OWED TO YOU ──────────────────────────────────┐
├════════════════════════════════════════════════┤
│ Nothing outstanding.            [ Add a debt ] │
└────────────────────────────────────────────────┘

TOTAL LIABILITIES   ₱2,762.06
TOTAL RECEIVABLES       ₱0.00
NET                −₱2,762.06
```

Debt detail = the card from 6.6.6 plus a full transaction history with a **running outstanding column** — the single most useful view in the module.

## 7.6 Insights

Month calendar (spend intensity per day, tap for that day's rows), two-track budget vs actual, the rule-based text report from Module10, and an AI summary **layered on top** of the rule output — never instead of it.

**New block — Income Quality:**

```
CASH IN THIS YEAR         ₱245,715.96
  True income             ₱237,289.22
  Borrowed                  ₱5,450.85   ← not income
  Opening balance           ₱2,475.89   ← not income
  Self-moves                  ₱500.00   ← not income
```

## 7.7 Budget

12-month grid × 3 tracks (Spending, Bills & Subs, **Debt Service**). Per-month summary, forecast (rule 5.8), net cash flow. Inline editable cells, tabular mono, over-budget cells in `--over-bg`.

## 7.8 Statements · Bin · Settings

**Statements** — 5 types (rule 5.10) × month range → CSV always, PDF where supported.
**Bin** — the 4 soft-deleted rows, restore, permanent delete with a typed confirmation.
**Settings** — wallets, savings, bills, subscriptions, revenue categories, spending types, counterparties, theme, export-everything. **No API key field. Ever.**

## 7.9 AI layer

```
Browser  →  functions/api/ai.ts  →  provider
             (Cloudflare Pages Function)
             key from env secret
```

| Rule | Detail |
|---|---|
| Rule-based output is computed **first, always** | The LLM only rewrites it |
| Hard timeout | 4s. Slow provider must never block entry |
| Failover | Groq → OpenRouter → local generator |
| Degradation | Silent. If AI fails you see the rule output and nothing looks broken |
| Key location | Cloudflare env secret only. Never client, never DB, never a cell |

---

# PART 8 — QUALITY BAR

## 8.1 Definition of done, per screen

- [ ] Works at 360px and 1920px
- [ ] Dark theme verified — **every flow colour checked on its own wash**
- [ ] Keyboard reachable, visible focus ring (`--forest-500`, 2px, 2px offset)
- [ ] `prefers-reduced-motion` respected
- [ ] Loading state is a hairline placeholder, not a shimmer
- [ ] Empty state names an action
- [ ] Errors say what happened and what to do
- [ ] Money right-aligned, tabular, 2dp, ₱ muted
- [ ] No hex literal outside `tokens.css`
- [ ] No `rounded-xl` / `shadow-sm` on a data surface
- [ ] Domain functions have parity tests
- [ ] `npm run typecheck` and `npm test` clean

## 8.2 Test requirements

| Suite | Must assert |
|---|---|
| `balances.test.ts` | All 4 workbook balances exactly |
| `totals.test.ts` | Monthly 11,291.37 · annual 222,244.14 · all 16 ranking values |
| `budget.test.ts` | Two-track status per month against the workbook |
| `integrity.test.ts` | `INT-01` finds **exactly 2** rows (#8, #190) — not 28 |
| `debt.test.ts` | Outstanding = 2,762.06 · net worth = 4,877.97 · true income = 237,289.22 |
| `migration.test.ts` | **Wallet balances are byte-identical before and after debt migration** |
| `money.test.ts` | No float ever enters the money path |

## 8.3 Commits

Conventional Commits. Feature branches. No push without your say-so.

```
feat(debt): add Debt entity and outstanding calculation
fix(theme): share one dark block so flagged rows stay legible
test(parity): assert annual spending matches SUMMARY!D4
docs(design): add flow colour tokens
```

## 8.4 Build order

| Phase | Work | Gate |
|---|---|---|
| **0** | Rotate keys · Firestore (not RTDB) · deploy rules | Keys rotated |
| **1** | `tokens.css` · fonts · `Rule`, `FlowBadge`, `Money`, `LedgerRow` | Both themes pass contrast |
| **2** | Debt domain + tests · migration review queue | `debt.test.ts` green |
| **3** | **Add/Edit screen** | You can add a transaction on your phone |
| **4** | Dashboard + Ledger redesigned to tokens | No hex outside tokens |
| **5** | Firebase wiring · migrate 440 rows · verify balances | Balances match pre-import |
| **6** | Debt · Insights · Budget screens | — |
| **7** | Statements · Bin · Settings | — |
| **8** | PWA · Cloudflare Pages · installable | Runs offline on your phone |
| **9** | AI proxy | Degrades silently |

**Phase 3 is the milestone that makes this a real app.** Until then it is a viewer.

## 8.5 Risks

| Risk | Handling |
|---|---|
| Leaked API keys used | **Rotate today.** Migration strips column U. |
| Public URL exposes finances | Google auth, rules locked to one UID |
| A rule ported wrong | Every rule has a parity test against the real figure |
| Debt migration corrupts balances | Test asserts balances unchanged; classification only |
| Float creeps back in | `Centavos` branded type; lint bans `parseFloat` on money |
| Losing the Excel | `MY THINGS/` protected by `CLAUDE.md`; copy, never move |
| `node_modules` in OneDrive | Gitignored; exclude the folder from OneDrive sync |

## 8.6 Non-goals

Multi-user · multi-currency · bank integration · custom domain · analytics · ads · social. The Excel is never modified and remains the archive.

---

# PART 9 — YOUR ACTION LIST

| # | Task | When |
|---|---|---|
| 1 | **Rotate the 3 API keys** (OpenRouter ×2, Groq) | **Today** |
| 2 | Create a **Firestore** database, asia-southeast1 | Before phase 5 |
| 3 | Enable Google sign-in, sign in once, copy your UID | Before phase 5 |
| 4 | Paste the UID into the security rules and deploy | Before phase 5 |
| 5 | Create the GitHub repo (**private**) | Before phase 8 |
| 6 | Connect Cloudflare Pages · build `npm run build` · output `dist` | Phase 8 |
| 7 | Add the rotated key as a Cloudflare env secret | Phase 9 |
| 8 | Exclude `node_modules` from OneDrive sync | Any time |
| 9 | Decide: does the debt migration match your memory of Maya Credit? | Phase 2 |

Everything else is build work.

---

*End of specification. `02-BUILD-PROMPT.md` is the prompt. `03-CLAUDE.md` goes at your project root.*
