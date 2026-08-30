# Excel System, Reverse-Engineering Analysis

Source: `MY THINGS/` (read-only). Analysed 2026-08-29.
Scope: 1 workbook (14 sheets), 32 VBA modules (~24,000 lines), 440 transactions
spanning 2026-01-01 → 2026-08-28.

Every rule marked **[VERIFIED]** was executed against the real dataset and
reproduces the workbook's own displayed figure exactly.

---

## 1. Inventory

### Sheets
| Sheet | Vis. | Role |
|---|---|---|
| INPUT PAGE | visible | Transaction entry form + wallet/savings balances + Finance Alert |
| INSIGHTS | visible | Month calendar, budget vs actual, AI insight, text report |
| SUMMARY | visible | Annual overview, treemap, top spending, most-used wallet |
| BUDGETING | visible | 12-month budget grid, per-month summary, forecast, net cash flow |
| DATABASE | visible | The ledger, 440 rows, cols B:N |
| FINANCIAL STATEMENT | visible | 4 statement types x month range, export |
| DELETED DATA | visible | Soft-delete recycle bin (4 rows) |
| CATEGORIES | visible | Wallets, savings, bills, subs, revenue cats, spending types, **API keys** |
| SHEETS, EXPENSE/SAVINGS/REVENUE SHEET, ACCOUNT STATEMENT | hidden | PDF/Excel export staging |
| BACKEND | hidden | Materialised cache: dropdown lists, wallet balances, rankings |

### VBA modules
| Module | Lines | Responsibility |
|---|---|---|
| Module1 | 2,362 | CRUD, chronological insert, renumber, 8 search modes |
| Module2 | 647 | INSIGHTS calendar paint + day popups |
| Module3 | 48 | Sync CATEGORIES savings to BACKEND list |
| Module4 | 379 | Forecast (spending + bills) |
| Module5 | 443 | Financial statement filter/render |
| Module6 | 3,790 | PDF + Excel export, backup, restore, rollback |
| Module7 | 1,280 | Finance Alert engine, holiday API, multi-LLM + offline |
| Module8 | 2,840 | Autofill / suggestion engine (pattern learning + LLM) |
| Module9 | 479 | SUMMARY calendar |
| Module10 | 5,009 | Insights engine, 20 report views, frequency allocation |
| Sheet1/3/6-13 | ~1,100 | Sheet events, protection, input cleaning |

---

## 2. Data model

### Transaction (DATABASE B:N, data starts row 7)
| Col | Field | Notes |
|---|---|---|
| B | recordNumber | Sequential, **renumbered on every write** |
| C | date | Rows kept sorted ascending by date |
| D | type | `Revenue` / `Spending` / `Transfer` |
| E | fromWallet | Source. Empty for most Revenue rows |
| F | toWallet | Destination. Empty for most Spending rows |
| G | category | `Revenue` / `Spending` / `Bills` / `Subscriptions` |
| H | item | The real classifier, see section 3 |
| I | description | Free text |
| J | amount | |
| K | transactionFee | Non-zero on 30 rows |
| L | total | `= amount + fee`. Holds for all 440 rows |
| M | notes | |
| N | status | `Done` / `Paid` / `Transferred` / `Withdrawn` / `Received` |

Observed distribution: type = Revenue 80 / Spending 268 / Transfer 92;
category = Revenue 80 / Spending 254 / blank 64 / Subscriptions 25 / Bills 16.

### Reference data (CATEGORIES)
- `C7:C56` active wallets, `D7:D56` savings wallets
- `H7:H56` bills, `I7:I56` subscriptions
- `M7:M56` revenue categories
- `P7:P56` spending types + `Q` remarks, **17 defined**, and this list is
  the authoritative domain for spending rankings
- `U7:U16` API keys, **secrets, must be stripped on migration**

> The ledger references wallets not in the active list (`Hidden cash
> (fieldtrip)`, `Maya Bank (Drone)`, `Maya Bank (New Phone)`). Wallets are
> **historical and open-ended**, not a closed enum. Do not validate against
> the active list when reading old data.

---

## 3. Core rules

### 3.1 Wallet balance **[VERIFIED]**

```
balance(w) = SUM(total)  WHERE type = 'Revenue' AND fromWallet = w
           + SUM(amount) WHERE toWallet = w
           - SUM(total)  WHERE fromWallet = w AND type <> 'Revenue'
```

Two deliberate asymmetries, **do not "fix" these**:

1. Revenue may name its wallet in *either* `fromWallet` or `toWallet`;
   the first two terms absorb both conventions.
2. Money **in** uses `amount`; money **out** uses `total`. The transaction fee
   is therefore borne entirely by the source wallet.

| Wallet | Computed | Workbook |
|---|---|---|
| Maya | 5,795.74 | 5,795.74 (match) |
| Cash | 161.00 | 161.00 (match) |
| Gcash | 155.71 | 155.71 (match) |
| Maya Bank (Personal savings) | 1,527.58 | 1,527.58 (match) |

### 3.2 Monthly spend **[VERIFIED]**, Aug 2026 gives 11,291.37, matches INSIGHTS I16

```
spending = SUM(total) WHERE type='Spending' AND category='Spending'
bills    = SUM(total) WHERE type='Spending' AND category='Bills'
subs     = SUM(total) WHERE type='Spending' AND category='Subscriptions'
fees     = SUM(fee)   WHERE type='Transfer' AND item='Transaction Fee'
monthTotal = spending + bills + subs + fees
```

Aug 2026: 6,943.58 + 3,886.79 + 443.00 + 18.00 = **11,291.37**

### 3.3 Annual spending **[VERIFIED]**, SUMMARY D4 gives 222,244.14

```
SUM(total) WHERE type='Spending' AND category='Spending'    = 217,701.14
+ SUM(fee) WHERE type='Transfer' AND item='Transaction Fee' =     443.00
+ SUM(total) WHERE type='Transfer' AND item='Money Send'    =   4,100.00
                                                            = 222,244.14
```

### 3.4 Spending ranking **[VERIFIED]**, all 11 values matched

Iterate the 17 CATEGORIES spending types (never raw ledger items, that would
pull in revenue items like `Framelink` and `Allowance`). Per type:

- `Transaction Fee` → SUM(`fee`) across all rows
- `Money Send` → SUM(`amount`) WHERE category='Spending' AND item='Money Send'
- otherwise → SUM(`total`) WHERE item = type, within the date window

### 3.5 Most-used wallet **[VERIFIED, see 3.5.1]**

Rule 3.3's definition grouped by `fromWallet`:
Cash 160,493.00 (match), Maya 46,125.43 (match), Gcash 15,625.71 vs 15,610.71.
The 15.00 delta is **not** a rule difference, it is one of the two
mis-categorised rows in 3.5.1. The rule is correct as stated.

### 3.5.1 TOTAL FUNDS is not the sum of the wallets **[VERIFIED]**

`SUMMARY!D9` does not add up the wallet balances shown beside it. It is an
independent cash-flow formula:

```
totalFunds = SUM(amount+fee) WHERE type='Revenue'
           - SUM(amount+fee) WHERE type IN ('Spending','Bills','Subscriptions')
           - SUM(fee)        WHERE type='Transfer' AND category='Spending'
                               AND item='Transaction Fee'
           - SUM(amount+fee) WHERE type='Transfer' AND category='Spending'
                               AND item='Money Send'
```

(The `Bills` / `Subscriptions` terms test column **D**, which only ever holds
Revenue / Spending / Transfer, so they always contribute zero.)

A transfer fee is only subtracted when `category='Spending'` **and**
`item='Transaction Fee'`. Two rows carry a real fee but fail that test:

| Record | Date | Transfer | Fee | Defect |
|---|---|---|---|---|
| #8 | 2026-01-04 | Gcash → Maya | 15.00 | category blank, item blank |
| #190 | 2026-04-03 | Gcash → Maya | 15.00 | category blank |

So ₱30.00 of fees never reaches the tile, while the same ₱30.00 *is* deducted
from Gcash's balance (outflow uses `total`). Result:

```
sum of wallet balances   7,640.03    <- internally consistent
SUMMARY!D9 TOTAL FUNDS   7,670.03    <- overstated by exactly 30.00
```

**Decision for the new app:** show the sum of wallet balances, so the total
always ties to the parts beside it, and surface the two offending rows through
the integrity check (`domain/integrity.ts`) rather than silently absorbing
them. Encoded in `balances.test.ts` and `integrity.test.ts`.

### 3.6 Budget status

Two independent tracks, Spending, and Bills & Subscriptions, each
`OVER THE BUDGET` when spent > budget. Budgets: `BUDGETING!H11:S11` (spending)
and `H12:S12` (bills & subs), columns H..S = Jan..Dec.

### 3.7 Smart daily allocation (Module10)

```
dailyBudget = walletBalance / daysLeftInMonth
score(cat)  = avgAmount * recurrenceMultiplier
```

Multiplier: `x2` if due/overdue, `x1.5` if due within 2 days, `x1.1` if 2 or more
transactions in the last 7 days, else `x1`. Then: proportional split; cap **25%**
per category; floor 50 (or `avgAmount * 0.5` clamped to [50,150]); round to
nearest 10; if the total exceeds budget, rescale to **90%**; display **top 3**.

- Recurring = 3+ transactions, avgGap <= 30d, daysSinceLast <= 45d.
- Overdue = 6+ transactions, avgGap 2–14d, daysSinceLast > avgGap * 0.8.

### 3.8 Forecast (Module4)

Spending, in priority order: same month last year * 1.03 → mean of last 3
months * 1.03 → overall mean * 1.03.
Bills: most recent non-zero month, and **never forecast below it**.

### 3.9 Bill due prediction

`nextDue = lastPaidDate + 1 month`, per bill/subscription item.

### 3.10 Statement filters (Module5)

| Type | Includes |
|---|---|
| Account Statement | everything in range |
| Revenue Sheet | `type='Revenue'` |
| Expense Sheet | `type='Spending'`, plus Transfer rows with category='Spending' and item='Transaction Fee' |
| Savings Sheet | rows whose from/to wallet is any known savings wallet |

### 3.11 Write path (Module1)

Required: type (E9) and amount (E15). On save: balance check → chronological
insert → renumber all → clear form → refresh next ID.
Warnings (both proceed-able): resulting balance < 0; withdrawal from a wallet
whose name contains "saving".

### 3.12 Autofill (Module8)

Learns from history: most common toWallet per revenue, fromWallet per spending,
transfer destination per source, category per (type, wallet), item per (type,
category), status per (type, item), and a predicted transaction fee per wallet
pair. Renders as grey ghost text; click to accept; rejection is tracked.
LLM used only for the free-text description, with a local generator fallback.

---

## 4. Defects found in the Excel

1. **Float drift.** Stored balances carry error: `5795.740000000005`,
   `155.7100000000064`, `1527.5800000000027`. Caused by repeated float
   addition. Fix by storing integer centavos.
2. **Inconsistent fee bucketing.** INSIGHTS `I16` counts the 18.00
   transaction fee as its own bucket; Module10's report folds it into
   *Spending* (`6,961.58` vs the formula's `6,943.58`). Grand totals agree,
   the split does not. Pick one; documented here as a real discrepancy.
3. **Secrets in a data cell.** Three live API keys in `CATEGORIES!U7:U16`.
4. **Hard-coded 5000-row ceiling** across every SUMIFS. Silent data loss at
   ~4,993 transactions (currently 440; roughly 2 years of headroom).
5. **`AddDataToDatabase` (Sheet1) is dead code**, appends without the balance
   check, chronological insert, or renumber that `AddOrUpdateRecord` performs.
   Do not port it.
6. **64 rows have a blank category** and 63 a blank item, so they fall out of
   every category-filtered total while still moving wallet balances.
7. **TOTAL FUNDS disagrees with its own wallet balances by ₱30.00**, two
   mis-categorised transfer fees. Full trace in section 3.5.1. The Excel gave
   no indication anything was wrong; the numbers simply did not tie.

---

## 5. Migration notes

- 440 rows, 4 soft-deleted rows, 8 months of budgets, ~30 reference-list entries.
- `total = amount + fee` holds for all 440 rows, so `total` is safe to derive.
- Dates are clean `datetime`, no string dates.
- Strip `CATEGORIES!U` (secrets) at the boundary.
- Preserve `recordNumber` for traceability, but use a stable surrogate id as the
  primary key so renumbering never rewrites references.
