# What was accomplished

**2026-08-30 to 2026-09-01.** 29 commits, `574264b..e8a680c`.
**1107 tests** across 63 files, typecheck and build clean, everything pushed.

This is the summary. The reasoning behind each fix is in the commit that made
it, and the evidence behind the second half is in
[`12-DEBUGGING-FROM-THE-RECORD.md`](12-DEBUGGING-FROM-THE-RECORD.md).

---

## 1. The headline

Most of this was **money bugs**: figures that were wrong, or rows that would
have been saved wrong, not cosmetic problems. Sections 2 to 4 list them
individually. Several had been in the app for months and were invisible to a
passing test suite.

The turning point was building `?coderview`, which made the assistant's own
record readable. Everything after `de7c55a` was found in evidence rather
than guessed at, and that changed what the work found: the last two days
turned up **structural** faults, not individual misreadings.

| | Start | Now |
|---|---:|---:|
| Tests | 937 | **1107** |
| Test files | 46 | **63** |
| Messages answered, of those asked | 19 / 86 | 27 / 105 |
| Cards accepted as proposed | 57% | 61% |

The last two rows are still poor. They are the measure to watch, and the
next dump is what says whether this work moved them.

---

## 2. Two structural faults

These are the ones worth remembering, because both were invisible for the
same reason: **the test fixtures described shapes the real data has never
had.**

### Four private definitions of "what counts as spending"

`charts.ts`, `aiChatContext.ts` and `patterns.ts` each kept their own copy.
All three eventually disagreed with `totals.ts`, and all three in the same
two places: they counted a Spending row with a blank category, which the app
ignores, and dropped debt interest, which the app counts.

The one feeding the model mattered most. On four rows the app totals
PHP 303.79 and the chat's copy totalled PHP 1,114.00, so the assistant was
answering from one set of figures while every screen showed another.

They looked correct because the Excel fixture contains neither kind of row.
`oneDefinition.test.ts` now supplies them deliberately. There are no private
copies left.

### The patterns panel read the wrong field entirely

Every detector grouped by `t.category`, which in this ledger only ever holds
Spending, Bills, Subscriptions, Transfer, Revenue or Opening. The migration
detector was comparing one group against itself and could never fire; a
broken streak would have said "40 days without a Spending entry".

What a person means by a category is Treat, Food, Gas: that is `item`. On
the real ledger the streak detector went from one meaningless group to 23
real ones.

---

## 3. Money read wrongly

Each of these changed what a month cost.

| Fault | Consequence |
|---|---|
| "to my mom's gcash" read as your own Gcash | Money given away counted as nothing spent |
| "to my savings" read as money gone | Saving counted as spending |
| "I withdrew 5000 to buy food" read its reason as a recipient | The whole 5,000 spent the day it left the bank |
| "I paid my friend 600" came back as Gas, "1000" as Food | Paying a person has no thing in it to find |
| "edit them 2026" set the amount to PHP 2,026.00 | A bare year only counted as a date if you said "date" |
| "give me insights ... may to august 2026" | Became a PHP 2,026.00 transfer, after five messages of confusion |
| A negative fee was never checked | A fee of minus fifty turned a PHP 100 row into PHP 50 |
| No upper bound on an amount | The database refused it with an unreadable permissions error |
| A Spending row with no item saved silently | Real money, invisible to every report that groups by item |

---

## 4. Charts

Asked "chart about treats this past 3 months" and drawn "Spending by item,
August 2026" with every item in it. Probing every phrasing against the real
ledger found five more.

- **Income drew spending.** "chart my income this year" answered the
  opposite question. Nothing ever asked which direction was wanted.
- **"chart last month"** drew August, the month it already is.
- **"this week"** and **"yesterday"** drew the whole month.
- **Naming one account drew all of them**, and the account names were
  hardcoded, so "reserved fund" matched nothing.
- **Grouping by wallet read the source**, so income fell under "(none)".

Per-wallet charts now partition the year exactly: PHP 60,943.22 plus
16,639.71 plus 160,493.00 is PHP 238,075.93, the year total to the centavo.
That property is asserted rather than the figures.

Charts are also **kept** now, stored as the figures they drew and redrawn on
the way back. Photos remain the one thing never stored.

---

## 5. The assistant understanding you

- **It denied things the app does.** "I cannot make charts or graphs here",
  right after drawing one. The instruction said so in as many words.
- **It was reading half-noise.** The conversation sent to the model was full
  of `found: undefined`, so with six turns of history it often saw nothing.
- **"delete all data entered by ai"**, asked three times, did nothing.
- **"discard all"** ignored, then eleven cards rejected by hand.
- **Four things in one sentence** made one row.
- **Follow-ups**: "how about this month" after a chart, answered in prose.
  "also in gcash 100000000 too", read as a fresh sentence.
- **An entry the model called a question** produced no card, three times.
- **Corrections**: one reached one card out of eleven; "new laptop not
  lkaptop" did nothing.
- **The item was allowed to be "Revenue"**, so a category name became a
  spending type.

---

## 6. Built, not fixed

- **Coderview** (`?coderview`): the whole database as text, with the
  assistant scored. Temporary, and its removal is written up in
  [`11-CODERVIEW-IS-TEMPORARY.md`](11-CODERVIEW-IS-TEMPORARY.md).
- **Debt finished in the chat**: credit line and effect as buttons, with the
  wallet moving to the side the effect implies.
- **Bulk selection** on the Database screen and in the bin, with a round trip
  asserted byte-identical.
- **Edit and Delete on phone rows**, at 44px.
- **Donut and line charts**, and editing a saved entry from the chat.
- **Save health**: the AI log's failures are recorded and shown, so "is it
  saving?" has an answer.

---

## 7. Still open

- **"I buy load using gcash 30 pesos" proposes Emergency.** There is no Load
  item, so the word vote lands on a coincidence. Tightening it was tried and
  reverted: it broke "restaurant" finding Food, which is the same mechanism
  working correctly.
- **"compare july and august"** draws July alone. Two windows in one chart
  is a different shape.
- **Archiving a transaction** needs your decision: does an archived row
  still count towards the month, the year and the balances? Both answers are
  defensible and they are different features.
- **The rules still need deploying.** Charts will not save and `meta` stays
  unreadable in Coderview until they are.

```bash
npx firebase deploy --only firestore:rules --project financial-system-c2997
```

---

## 8. Two mistakes made along the way

Recorded because both repeat.

**A regression, caught before it shipped.** The override that turns a
model-routed question back into an entry keys on `isQuestion`, and "give me
insights..." passed it, so the override would have forced exactly the wrong
reading. Found by probing the real sentences from the record against the new
code, which is worth doing every time an override like that is added.

**The backslash trap, five times.** Writing a regex through a Bash heredoc
silently eats `\`. Use the Write and Edit tools for anything containing a
regex, and audit with:

```bash
python -c "import io,glob; print([p for p in glob.glob('src/**/*.ts',recursive=True) if any(ord(c)<32 and c not in '\n\r\t' for c in io.open(p,encoding='utf-8').read())])"
```

Twice it was followed by the dev server quietly serving stale code for
several minutes. If something you just fixed appears not to work, suspect
that before the fix.
