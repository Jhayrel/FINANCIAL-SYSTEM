# 17. Allocations

The owner, 4 November 2026, with the allocation notes they kept by hand for
January to April and November 2026: "So we can do a plans and allocation.
Plans is for plans and allocation is different ... The goal is to set aside a
plan budget like example for gas 1200 and 300 per week." And: "what if I over
spend, what if I under spent, what if I deleted or add budget, what happen if
I didnt add a allocation", "whats the difference between allocation and set
limit", "connect it to the whole system". On 8 November: "in planner even the
skip can see and I can pull it back", and "what if I allocated an amount then
I spend it ... is it safe to spend ... would it affect my daily budget?"

This is the binding description of how allocations behave. The code
(`app/src/domain/monthAllocation.ts`) follows it, and a change to a rule here
comes first, as with every other rule in this project. (`allocation.ts` is the
older daily split of safe to spend, spec rule 5.7, and a different thing.)

## A1. What an allocation is

An allocation is money set aside, for one month, for one kind of spending that
happens again and again in that month: gas, parking, the gym, food, fun money.
It is the envelope in the owner's notes: "800 - gas for 4 weeks 200 per week".

| Field | Meaning | Example |
|---|---|---|
| Name | What the owner calls it | Gym |
| Kind | The kind of spending whose entries count against it | Self Care |
| Words (optional) | Only entries of that kind whose description or notes say one of them | gym |
| Amount | For the whole month | ₱400.00 |
| Each and times (optional) | How the amount is made up, and the pace it is checked against | ₱50.00 a time, 8 times; ₱300.00 a week, 4 weeks; ₱50.00 each Tuesday and Thursday |
| How long | This month only (the default), every month, or every month until a month (A12) | Every month from November 2026 |
| Wallet (optional) | Where it is paid from, for "need to withdraw" | Cash |
| Month | The month it is for | November 2026 |

An allocation is not an entry. Nothing moves in any wallet when one is made,
changed or removed. Entries are made exactly as before, from the Add form,
the chat or a receipt; an entry of that kind, in that month, counts against
the allocation by itself. There is nothing to link and nothing to press.

## A2. Allocation, plan, limit and bill: which is which

| | Allocation | Plan (Planner) | Limit (Budget, Set a limit) | Bill or subscription |
|---|---|---|---|---|
| What it is | Money held for a kind of spending this month | Money meant for one thing, by a date | A ceiling on a kind of spending | A charge expected every month |
| Example | Gas ₱1,200, ₱300 a week | Tuition ₱8,700 by Nov 15; Christening gift ₱3,000 | Food no more than ₱3,000 | Globe ₱999 |
| Paid by | Every entry of that kind in the month, counted on its own | One payment, or a few, linked to the plan | Not paid: it only measures | One entry a month |
| Holds money out of safe to spend | Yes: what is left of it | Yes, when "Set aside" is on | No | Yes, until paid |
| Ends | When the month ends | When paid, skipped or removed | When the month ends | Comes again next month |
| Over it | Said; the extra comes out of safe to spend | Said | Said: over the limit | Said when paid late |
| Where it lives | Budget, Allocations | Planner | Budget, Where it went | Settings, Categories |

In short: **a limit says "no more than"; an allocation says "this much is
already spoken for"**. A limit changes nothing about the money the owner holds;
an allocation takes what is left of it out of safe to spend, so the figure on
the Dashboard is money nobody has a job for yet. A plan is for a thing; an
allocation is for a habit.

The owner's notes, sorted:

| In the notes | In the app |
|---|---|
| Gas 800 (200 a week), Parking 400 (100 a week), Gym 400 (50 a time, twice a week) | Allocations |
| Spotify, MS Office, Google Drive, Dito, Globe | Bills and subscriptions (Settings, Categories): held already |
| Tuition 11,000; School field trip 15,000; Christening 3,000 | Plans, with Set aside on |
| Maya Bank 1,000; Extra money 350 | Plans to save (P11) |
| Maya Credit 1,075 | Held already as a debt payment due |
| Withdrawal fee 20 | Not allocated: a fee is worked out from its transfer and is not a kind of spending, so it comes out of safe to spend when it happens |
| Need to withdraw 5,800 | Worked out: A11 |
| Free 1,325 | Safe to spend |

## A3. Where it lives and how it syncs

Allocations are a list inside the settings document (`settings.allocations`),
each line carrying its month ("2026-11"), saved as their own section like the
plans, so a change on the phone shows on the computer at once and works
offline. They are in every backup and come back with every restore; a restore
that merges keeps the allocations this device has and adds the file's others,
by id.

The database rules already allow them: the settings rule checks the fields it
knows and lets new ones through. `docs/firestore-rules-allocations.txt` is the
full rules file with a size check for the list (at most 1,000 lines), to paste
into the Firebase console when convenient. The app does not depend on it.

## A4. What counts against an allocation

Every live entry dated in the allocation's month whose kind is the
allocation's kind, and, when words are set, whose description or notes say one
of them. Each counts by what it cost (`costOf`), the same figure the Budget,
Insights and the statements use, so a transfer counts only its fee and an
entry over several days counts each day's share in its own month, as the
budget does.

**One entry, one allocation.** When a kind has more than one line (Self Care
for everything, and Gym for entries that say "gym"), an entry counts against
the first made whose words it says, else the line for the whole kind; never
two. Counted against both, a gym entry took its cost out of both and
spending ₱100.00 raised safe to spend by ₱100.00 (scenario analysis, 9
November 2026). A plan inside an allocation follows the same rule.

Binned entries do not count. An edit, a bin, a restore or a change of kind
moves the money between allocations at once, because nothing is stored: what
was spent is worked out from the ledger every time.

Bills and subscriptions are not allocated: they are held as "bills and
subscriptions still to pay" already, and holding them twice would halve the
money the owner can see. The form does not offer them.

## A5. What is held, safe to spend, and the daily figures

For the month that is running, each allocation holds what is left of it,
never less than nothing. Safe to spend becomes:

> wallets − bills and subscriptions still to pay − debt payments due − plans set aside − **allocations set aside**

Spending out of an allocation changes none of the daily figures. Gas bought
out of the gas allocation leaves the wallet and the allocation alike, so:

| Figure | When gas is bought within its allocation | When it goes past it |
|---|---|---|
| Safe to spend until the month ends | Unchanged | Lower by the extra |
| Safe to spend today, and today's share | Unchanged: it is set aside money, like a bill paid today | Lower by the extra |
| A day from tomorrow | Unchanged | Lower |
| The budget's day figure ("₱X a day for the N days left") | Unchanged: it is the spending budget less the allocations still held | Lower |
| The allocation | Less by what was spent | Over, holding nothing |

Past months hold nothing. A month ahead holds nothing yet; on its 1st its
allocations start holding (and "From 1 December" on the Dashboard counts them).

A plan of the same kind in the same month is held once, not twice: whichever
is larger, what is left of the allocation or what is left of those plans. Its
payment, being an entry of that kind, counts against the allocation too.

## A6. The pace (a week, a time, set days)

An allocation made of ₱300.00 a week for 4 weeks is checked week by week:
week 1 is the 1st to the 7th, week 2 the 8th to the 14th, week 3 the 15th to
the 21st, week 4 the 22nd to the end of the month. This week's share, what
this week has spent and what is left of it are shown, and going past this
week's share is said. The month's amount is what is held; the weeks are a
pace to keep, not four separate envelopes.

A "time" pace (₱50.00 a time, 8 times) is counted by entries: 3 of 8 used.

A "set days" pace (owner, 9 November 2026: "custom but weeks tuesday and
thursday only") is an amount each day on chosen days of the week. Its month's
amount is that amount times how many of those days the month has, worked out
for every month on its own (November 2026 has 8 Tuesdays and Thursdays,
December 10). Made after its month began, it counts from the day it was made:
the days before were never in it, and neither is what was spent on them,
which stays ordinary spending. Today's share is shown when today is one of its
days, else the next day; going past today's share is said in the bell.

## A7. What if

| What if | What happens |
|---|---|
| I spend more than the allocation | It shows "Over by ₱X". It holds nothing more, so the extra came out of the money that was free: safe to spend and the day figures are lower by it. The bell says so, and the Add form says it before saving. Nothing is blocked. |
| I go past this week's share | "₱X past this week's ₱300.00" on the line and in the bell. The month's amount is unchanged; later weeks have less. |
| I spend less | What is left stays held until the month ends. When it ends the hold stops: the leftover is free money in the new month and Budget says "₱X not used in November". In the first week of the new month the bell says how much last month's allocations left unused and that it is now in safe to spend. Nothing carries by itself; the owner decides (more for this month, or a transfer to savings). |
| I spend the money on something else | The allocation still holds what is left of it, because nothing of its kind was spent; the other spending came out of safe to spend. If the money is gone for good, Done frees what is left (below), or lower the allocation. |
| I am done with it before the month ends | Done (on the line, or "the gym allocation is done" in the chat): it stops holding what is left from that day, so safe to spend rises by it; what was spent stays counted against it; its kind spent after that day is ordinary spending. Hold it again undoes it. A repeating one holds again next month as usual. |
| I want it every month, or until a month | How long: This month only, Every month, or Until a month (A12). Each month counts on its own: one month over or under never changes the next. |
| I change or remove a repeating one in a later month | The change applies from that month on, and the months before keep what they had: the line is split. Removed in a later month, it is stopped from that month, kept under Removed there and in the Bin, and put back from either. |
| I add an allocation in the middle of the month | Everything already spent of that kind this month counts. It holds the amount less that. |
| I make the amount smaller than what is spent | Allowed, and said: it is over at once. |
| I change the kind or the words | What counts is worked out again at once. |
| I remove an allocation | It stops holding at once; safe to spend rises by what it held. It is kept under Removed on Budget and in the Bin, with Put back, as a skipped plan is in the Planner; Undo on the notice puts it back too. Entries are not touched. |
| I put one back | It holds again what is left of it. Refused only when the month has a live allocation of the same kind and words: change that one instead. |
| I have no allocations | Everything is exactly as before: the same safe to spend, budget, statements and figures to the centavo. |
| I edit, bin or restore an entry | The allocation follows at once (A4). |
| I rename a kind or a wallet in Settings | Allocations on it follow the new name. |
| I stop using a kind | The allocation stays, with nothing counting against it, until removed. |
| The allocations add up to more than my wallets hold | Safe to spend is ₱0.00 and the Dashboard says by how much the money falls short, as it does for bills and plans: the owner's "I am short of 2,000". |
| An allocation is paid from Cash and Cash holds less than it needs | Budget says "Withdraw ₱X into Cash" (A11). |
| I copy last month | Each live line comes with its amount and pace, not with what was left. Lines already there for the kind are kept; removed ones are not copied. |
| A new month starts | Nothing happens by itself. In the first week, if last month had allocations and this one has none, the bell offers to copy them. |
| The same kind twice in a month | Refused: change the one there is. |
| The same allocation made on two phones offline, or brought in by a merge | The first made counts; the second holds nothing and counts nothing, and Budget and the bell say "Gas is allocated twice": remove one. It is never removed by itself. |
| I pay gas from savings, not from a spending wallet | The allocation needs that much less, and the spending wallets did not move, so safe to spend rises by it, as it does when a bill is paid from savings. Today's figure is unchanged. |
| I record gas dated later this month | The wallet and the allocation both take it now, so safe to spend is unchanged; today is untouched. |
| I spend inside an allocation today | Nothing moves; the Dashboard says "₱300.00 spent today came out of Gas allocation, not today's share", so the spending is seen. |
| A kind with a limit and an allocation | Both are shown; they do not change each other. The allocation holds money, the limit measures. |
| The allocations add up to more than the spending budget | Budget says so. Nothing is refused. |
| I am offline | Saved on the device and sent when the connection is back, like every setting. |
| I restore a backup | The file's allocations come back with it (replace), or are added by id (merge). |

## A8. Where it shows

| Part | What it shows |
|---|---|
| Dashboard, safe to spend | "Set aside in allocations −₱X" beside bills and plans, in the figure and in its words; what came out of allocations today, under today's figure |
| Dashboard, Still to pay this month | "Set aside in allocations": each line with what it still holds, this week's share left, or how far over |
| Dashboard and Insights, Where it went | Under each kind with an allocation: "₱600.00 left of its ₱1,200.00 allocation", "₱200.00 over", or for a month that ended "₱300.00 not used" |
| Insights, Safe to spend | Each allocation's hold, and each plan's, as lines, so the lines add up to the figure |
| Insights, How it ended | For a month that ended: allocated, and each line not used or over |
| Budget | The Allocations card for the month on screen: each line with spent, left, over and this week, with Edit and Remove as quiet links on the line's last row, as "Set a limit" is on the card below; Add beside the title once there is one (an empty month has the one "Add an allocation" button instead, centred on a computer and one wide button on a phone, with Copy from last month beside it); Removed, with Put back; the total against the spending budget; need to withdraw |
| Add form | Under the item: "Gas allocation: ₱900.00 of ₱1,200.00 left (this week ₱300.00 of ₱300.00 left), ₱600.00 after this", and before saving, when it goes past: "This takes Gas ₱100.00 over its ₱1,200.00 allocation: ₱900.00 of this is covered by what is left of it, and ₱100.00 comes out of safe to spend" |
| Bell | Over an allocation; past this week's share; the start-of-month copy offer |
| Chat (no AI) | "how much is left for gas", "my allocations", "allocation status"; for a kind with no allocation, what it has spent, its limit if it has one, and how to set money aside for it (also in Tagalog: "magkano natira sa gas") |
| AI | The month's allocations are in what the model is sent, with the rule that safe to spend is after them |
| Activity | Every allocation added, changed, removed, put back, marked done or copied, who did it and how (Budget or the chat), under Budget |
| Bin | Under Removed elsewhere: every removed or stopped allocation, and every removed plan, with Put back |
| Statements | The account statement, the expense sheet and bills and subscriptions carry the budget for their months: both tracks, the limits and the allocations, with budget, spent and left, on screen, in the PDF and in the spreadsheet |
| Statements, Database, charts | Unchanged: they show money that moved, and an allocation moves none. The Expense sheet cut to a kind (Show) is the history of that envelope. |
| Settings | Nothing new. Allocations are made on Budget. Renaming a kind or a wallet carries them. |
| Backup and restore | Included (A3) |

## A9. The AI

The model is told, in what it is sent with every question: the month's
allocations, each with its amount, what is spent, what is left, this week and
over; and that safe to spend is already after them, so it never subtracts
them again. Asked "can I afford gas", it answers from the gas allocation
first. Changes are made from the chat as cards, below, or on Budget.

What it is sent says so in figures, not only in rules (9 November 2026,
found reading what the model receives for the owner's data): the safe to
spend sentence takes the allocations off with the bills, so its arithmetic
adds up; each allocation is listed with its month, spent, left and this
week; the spending budget's day figure says how much of the budget is in
the allocations; a what-if for a kind with an allocation is covered by it
first, and only the part past it comes off safe to spend; and an everyday
price of an allocated kind is set against what is left of the allocation,
not today's figure. The device's own answers (`affordAsk.ts`,
`whatIfAsk.ts`) work the same way.

Since 9 November 2026 the chat changes allocations too (owner: "ai should
able to do it"), always as a card the owner presses, worked out by the same
function Budget uses (`allocationApply.ts`): add ("allocate 300 a week for
gas", "allocate 50 every Tuesday and Thursday for gym"), change ("change the
gas allocation to 1500", "raise gas by 200"), extend ("make the gym allocation
every month", "extend gas until March", "for 2 more months"), mark done, hold
again, stop from a month, remove, put back and copy. It reads a change only
when the message says "allocation" (or names a live allocation by its own
name with a verb that changes it), and never from a question or a what-if,
which are answered instead (`allocationChange.ts`, with tests for the near
misses). Anything unclear (which kind, how much, which days, an amount that
does not split evenly) is asked back, never guessed.

Nothing is learned from allocations; the kinds and words the owner picks are
the same lists entries use, so what the app learned about kinds already
applies.

## A10. What does not change

Entries, their numbers, wallets, balances, net worth, the budget's two tracks,
limits, the Planner, statements and every parity figure in `CLAUDE.md`. An
allocation only decides how much of what is already held is spoken for.

## A12. How long

Each line is for its own month by default. Every month makes it hold in each
month from its own on; Until a month stops it after that month by itself. A
repeating line is one line, not copies: each month works out its own amount
(set days differ month to month), its own spending and its own left, and one
month over or under never changes the next. Changed in a later month, it is
split there, so a month that ended is never rewritten. Stopped in a later
month, the months before keep it. A month with its own line for the same kind
and words refuses a repeating one into it, so nothing is ever held twice. In
its last week the bell says a line that repeats until this month ends with it.

## A11. Need to withdraw

For each wallet named on the month's allocations: what those allocations still
hold, against what the wallet holds. When the wallet holds less, Budget says
"Withdraw ₱X into Cash", the owner's "Need to withdraw". Allocations with no
wallet are left out of this, never guessed.
