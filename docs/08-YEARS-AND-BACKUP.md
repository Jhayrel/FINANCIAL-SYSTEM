# Years, and what a backup covers

Two decisions that determine whether this system is still usable in 2035.
Binding. Referenced from `CLAUDE.md`.

---

## Y1. The ledger is continuous. A year is a filter, not a container.

**Nothing happens when the year ends.**

A balance is the running sum of every transaction ever recorded, so 1 January
opens with exactly what 31 December closed with. No year-end routine to run, no
step to forget, and no way for a balance to drift from the transactions that
produced it.

Opening and closing balances per year are **derived on demand**
(`yearPositions` in `domain/year.ts`), never stored. A stored figure can
disagree with its own history; a derived one cannot.

### What the Excel did instead, and why it is not copied

Each January the workbook wrote one "Transfer of balance" row per account and
booked it as **Revenue**. Records #1 to #5 carry 2025 forward:

| Record | Account | Amount |
|---|---|---:|
| #1 | Maya | ₱2.45 |
| #2 | Maya Bank (Personal savings) | ₱0.94 |
| #3 | Gcash | ₱0.50 |
| #4 | Cash | ₱450.00 |
| #5 | Extra Cash | ₱500.00 |
| | **Counted as 2026 income** | **₱953.89** |

That is money you already had, reported as money you earned. Same defect as
booking a debt draw as revenue, same consequence: the income line describes
something that never happened.

### The `Opening` category

`TransactionCategory` gains `"Opening"`. A row with it credits its destination
wallet exactly as before and is excluded from income.

`planOpeningMigration` / `applyOpeningMigration` reclassify the five rows.
**Only `category` changes.** `type` stays `Revenue`, both wallet fields are
untouched, so no balance can move: rule 3.1 credits a destination by `amount`
regardless of type, and these rows have no source wallet. `year.test.ts`
asserts byte-identical balances across all 440 rows.

### Detecting a carry-forward row

Three conditions, all required:

1. dated 1 January
2. no source wallet
3. the description names the previous year

**Not by item name.** Record #371 is `item = "Transfer of balance"` as well,
dated 30 June, described "From pnb 2000 to 1700": ₱1,522.00 of real money from
a bank outside the wallet list. Matching on the name alone reclassifies genuine
income as an opening balance.

### When a stored opening balance IS correct

Exactly one case: **archiving**. If old years are ever trimmed out of the
working ledger, the balance carried by the removed rows must be written down or
it is gone. `planYearClose` and `openingRowsFor` do that, marked `Opening`, and
it is always an explicit operation. Never automatic, never on a schedule.

---

## Y2. A backup is the whole system, not the database.

Restoring into a browser that has never seen this app must reproduce it
exactly. `BACKUP_VERSION` is 2 and the file carries:

| Part | Notes |
|---|---|
| Transactions | The ledger |
| Recycle bin | Soft-deleted rows, still restorable |
| Budgets | Every year |
| Accounts and goals | Including archived ones and goal targets and deadlines |
| Credit and loans | The debt headers |
| Bills, subscriptions, revenue categories, spending types | The lists the Excel backup left behind |
| AI settings, alert threshold | |
| **Theme** | Lives in its own `localStorage` key, outside the settings document |
| **Migration record** | Which one-time rewrites have run |

The last two are the ones that are easy to miss. The debt and opening
migrations each rewrite historical rows once; a restore that forgot they had
run would run them again over already converted rows.

### Also in the file

- **Manifest**: every part with its count, shown on screen before you commit
- **Checksum**: FNV-1a over key-sorted JSON. Catches a truncated download or a
  hand edit. It is not a signature and does not pretend to be one
- **Version**: an older file still restores; a file from a *newer* app is
  refused rather than read partially

### Restore rules, from `Module8.bas`

1. **Validate before touching anything.** Nothing is written until the file
   passes end to end. A restore that fails halfway is worse than one that
   refuses to start.
2. **Merge must not duplicate.** Identity is content, not id, then everything
   is renumbered. Running the same file twice leaves you where you were.
3. **Replace is reversible.** Snapshot first, and that snapshot restores.

Refusals, all tested: not a backup, newer version, truncated against the
manifest, `total ≠ amount + fee`, and fractional centavos.
