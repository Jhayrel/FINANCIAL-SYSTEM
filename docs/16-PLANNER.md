# 16. The Planner

The owner, 26 October 2026: "add a feature for plan spending like spending
planner ... I am planning to pay my tuition next month etc. This is just a
planner so I can see it ... make sure it connects to the categories etc make
sure all sync like ai, notifications, database settings etc. Also planner
also can direct pay like I can click already paid." And: "overthink all like
more what ifs".

This is the binding description of how the Planner behaves. The code
(`app/src/domain/planner.ts`) follows it, and a change to a rule here comes
first, as with every other rule in this project.

## P1. What a plan is

A plan is money the owner means to spend later: what it is for, how much,
the day it is to be paid by, the kind of spending it is (the same list as
entries: School, Food, a bill), the wallet it should come out of, whether it
is a need or a want, and optionally a goal it is being saved in.

A plan is not an entry. Nothing moves in any wallet, and no total, budget or
balance changes, until it is paid. Paying it makes an ordinary entry through
the same checks as the Add form, and links that entry to the plan.

## P2. Where it lives and how it syncs

Plans are a list inside the settings document (`settings.plans`), saved as
their own section like every other part of settings, so a change on the
phone shows on the computer at once and works offline. They are in every
backup and come back with every restore. The current database rules already
allow them; `docs/firestore-rules-planner.txt` adds a size check the owner
can paste in when convenient. The app does not depend on it.

## P3. States

Stored: open, done, skipped, removed. Worked out from the date, the linked
entries and the wallets, never stored:

| Shown | When |
|---|---|
| Later | Due more than 7 days from today |
| Soon | Due within 7 days |
| Due today | Due today |
| Overdue | Open and its day has passed |
| Part paid | Linked payments are less than the amount |
| Paid | Done. Early, on time or late is said from the last payment's date against the due date |
| Skipped | The owner decided not to go ahead |
| Removed | Taken off the list; kept, restorable |

## P4. The what-ifs

1. **Planned, then ignored when the day came.** It becomes Overdue and stays
   on the list, at the top. It is never skipped, moved or removed by the app
   (integrity rule: report, never correct). From the day after, the bell
   lists it as overdue until it is paid, moved or skipped, and opens the
   Planner, where the three answers are: Record payment, Move the date, Skip.
2. **Paid early.** Pay it any time. It shows "Paid early, Oct 20". If it
   counted in safe to spend, it stops counting the moment it is paid; the
   entry itself has already taken the money out of the wallet, so nothing is
   counted twice.
3. **Paid late.** Pay an overdue plan as usual. It shows "Paid 5 days late".
4. **The day has come and the money is not there.** The plan says how short
   the wallets are, after the bills, debt payments and the plans before it
   that month. The choices: pay part now (it stays open, Part paid), move the
   date, pay it from a goal or savings, or skip. Nothing is paid
   automatically, and an entry that would take a wallet below zero warns, as
   any entry does.
5. **Part paid.** Each payment is linked. The plan shows "Paid PHP 3,000.00
   of PHP 9,000.00" until the rest is paid, or the owner says the last
   payment settled it ("That settles it": done for less, the difference
   said).
6. **Paid more than planned.** Done, with "PHP 500.00 more than planned".
7. **Paid, and the entry was already added by hand.** "Link an entry I
   added" lists the likely ones (same kind or words, amount close, around
   the date), so the payment is never entered twice.
8. **A linked entry is moved to the bin or edited.** What is paid is worked
   out from the live entries every time, so a binned payment puts the plan
   back to open (and says which entry went), and an edited amount changes
   what is paid.
9. **An entry that looks like a plan's payment is added without linking.**
   The Planner and the bell ask "Is #3970 the Tuition payment?" with Link and
   Not this one. Never linked by itself.
10. **Something put in for no reason, no longer wanted.** Remove: off the
   list, kept under Removed, restorable. Never deleted outright.
11. **Changed mind, but it might come back.** Skip: kept under Done as
   Skipped, with an optional reason. "Plan it again" copies it with a new
   date.
12. **Extend the date.** Move the date, as many times as needed. Each move is
   kept ("Moved twice, first planned for Nov 15") and in the activity trail.
13. **The price changed.** Edit the amount. The change is in the activity
   trail with the old and new figure.
14. **A date already past when planning.** Allowed (a plan can be written
   after the fact), with a note: if it is already paid, record the payment
   instead.
15. **The same thing planned twice.** A plan with the same name and month as
   an open one is flagged on its form before saving.
16. **A plan for a bill or subscription.** Bills are already set aside every
   month. Counting a plan for the same bill would set the money aside twice,
   so its form says so and turns "Count it in safe to spend" off.
17. **A plan saved in a goal** ("new phone for 2027", saved in a Phone fund
   goal). The goal is linked. The plan shows what the goal holds against what
   is left to pay and what it takes a month to get there. Its money is
   already apart from the spending wallets, so it never counts in safe to
   spend, and paying it comes out of the goal by default. A goal can be made
   from the plan's form in one tap; the goal then lives in Settings, Goals,
   like any other.
18. **The goal is renamed, archived or gone.** The plan keeps the goal's id;
   a goal no longer there is said on the plan ("its goal is no longer in
   Settings") and the plan carries on unlinked.
19. **Many plans in one month.** The month's heading says the total, and
   whether the money covers it: this month against what is safe until the
   month ends; a month ahead against the usual month's income less the usual
   spending.
20. **A plan far ahead** (next year). Shown under Later with what it takes a
   month until then.
21. **Two devices changing plans at once.** Plans are one section of
   settings: the later save wins, as for any other section.
22. **Restoring a backup.** Plans come back as they were in the backup.
23. **The AI.** It can add, edit, move, pay, link, skip, remove, restore and
   list plans from the chat, each as a card to press. Its answers about a
   month ahead count the plans due in it.

## P5. Counting in safe to spend

Each plan has **Count it in safe to spend**, on by default except for a bill,
a subscription or a plan saved in a goal. On, an open plan due this month,
or overdue, is set aside from safe to spend like a bill still to pay: what is
left of it, not what is already paid. Off, it is only shown. A month ahead
counts its plans in what that month needs (the Dashboard's next-month line,
the chat's "how much do I need next month").

This is a new part of the safe to spend figure, deliberately and only by the
owner's own choice on each plan. With no plans, every figure is unchanged.

## P6. Where it shows

- **Planner** (sidebar on a computer, More on a phone): the list by month,
  the summary, and every action.
- **Dashboard**: the month card says what is planned this month, set aside.
  Plans due in the next days are in its "coming up" list beside the bills,
  with Pay. P9 says how every screen reads the same figure.
- **Budget**: "Planned this month" under the tracks, and the planner's
  chips "Usual + plans" and "With plans" for a month ahead (P9).
- **Insights**: the calendar rings a day with a plan due and says the
  amount; Still ahead lists the plans with Pay now.
- **Bin**: a binned entry that paid a plan says so in its sheet, and the
  plan goes back to unpaid only by what that entry paid.
- **Bell**: due soon, due today, overdue, short, a payment to link, a goal
  behind.
- **Chat and AI**: everything above, in words and cards.
- **Activity**: every plan added, edited, moved, paid, skipped, removed or
  restored.
- **Backup**: whole.

## P7. From the chat: today or later (owner, 27 October 2026)

"Make sure it knows if I want to plan something like 'I am planning a trip
or etc or tuition etc' ... But be careful what if I said I plan to buy good
today at mall but what I meant is just a budget breakdown for today."
`domain/planIntent.ts`, in this order:

1. **Money that moved is an entry.** "I paid", "I bought": the entry readers.
   Income, saving towards a goal, a debt or On behalf line, a bill or
   subscription already tracked, and setting a budget are their own readers'.
2. **A day said decides it.** Today is today's money. Any later day (a date,
   tomorrow, a weekday, next month, a month by name, next year, "in 2027",
   Christmas) is the Planner. A day already gone is neither.
3. **No day said.** "Tonight", "later", "for lunch", the mall, the market or
   eating out are today. So is a thing the ledger shows bought eight times
   or more in sixty days, counted by its kind when the words name the kind
   ("food" is Food) and by its own words otherwise (a laptop filed under
   Online Buy is not everyday because Online Buy is). Anything else is the
   Planner.

**Today** is answered as "can I afford it" is, as a breakdown: what it
usually costs going by the owner's entries, against today's safe to spend,
what the month's money can cover and what that leaves a day from tomorrow,
with the budget said apart. Never an entry card, never a plan card.

**Later** with an amount is a Planner card to press. Its words say the day
when none was said, what safe to spend has for it when it is due this month,
and for a later month within a year what that month needs with it against
the usual income (the same working as "how much do I need"). Without an
amount the chat asks for it, with what it cost before (the latest entries
that name it, small change and the app's own carry-forward rows left out),
and the next short reply with a figure ("5000 by dec 20") makes the card.
Said with a question ("can I afford it?", "what budget should I set?"), the
question is answered first and the card follows it. Already on the Planner,
it says so instead of offering it twice.

**"Add it as a plan"**, "put it on my planner", "plan it": what this message
said is coming, else the last few messages, else the budget just worked out.
"Add the tuition as a plan" picks the one named, and with nothing said
before asks the amount. "Set a plan" alone is still a budget: on 27 October
2026 "add it as a plan" made a Budget change card, because the budget rule
read "plan" as "set a budget".

**Edits from the chat**: date, amount, payment, skip, remove, put back, and
every other field: "rename the trip plan to Baguio trip", "the trip plan is a
want", "don't count the trip plan in safe to spend", "the trip plan is
Travel", "change the tuition plan to gcash", "note on the trip plan: bring a
jacket", "save for the phone plan in Phone fund". Each is a card with the
field before and after, and "undo that" puts it back.

**The model** ends an answer with "Plan: Tuition, PHP 9,000.00, by
2026-11-15" when it worked out a plan, and the app makes the card, as it does
an "Entry:" line. Never under a plan for today, never twice for one already
planned, and never "type plan tuition 9000".

## P8. The screen (owner, 27 October 2026: "more cleaner ui like the rest of the system")

Laid out as the Bin and Activity are. One list card, titled Plans, with Plan
something beside the title; from 1280px a side panel: **Due by** the month's
end (the figure, safe to spend before plans, set aside for plans, left or
short) and **Further ahead** (each month's total, what it takes a month to
save for the far ones, how much of it is wants). Narrower, the same figures
head the list. A row: the name and what is left; the day ("Oct 28, in 2
days"), kind and wallet; one line with an icon only when there is something
to act on (short of safe to spend, a payment gone, part paid, a goal or what
it takes a month). A pill only when the state needs one: Due soon and Due
today amber, Overdue red, Part paid blue, Paid green, Skipped and Removed
grey; a plan simply later has none. The sheet lays its facts out as a
Database row's. The form folds Need or want, the goal, Count it in safe to
spend and Notes under More details. Kind is grouped as the Add form files
spending (Spending, Bills, Subscriptions), without Unknown or stopped bills
and subscriptions; Pay from is grouped Spending wallets, Savings.

Classes are `fms-plans` and `fms-plan*`. `fms-planner` is the Budget
screen's panel: the first Planner shared it and squeezed Budget's "Budget for
the month" into a narrow column.

## P9. A day, a month, or no date yet; and one figure on every screen (owner, 27 October 2026)

"WHAT IF I DONT HAVE A DAY SPECIFICS YET LIKE NO DATE LIKE NO IDEA WHEN /
FIX ALSO THE AI", with a screenshot of a card that had picked November 30
"as no day was said". A plan's `dueKind` says how much of the date is known:

| Kind | `due` | Shown as | Counted |
|---|---|---|---|
| day | the day | "November 15, 2026" | in its month, as before |
| month | the month's last day | "Sometime in November 2026" | in that month: its safe to spend once it is the running month, its budget always |
| year | 31 December | "Sometime in 2027" | as a month plan in December |
| none | `9999-12-31` (`NO_DATE`) | "No date yet" | nowhere: not safe to spend, not a month's budget, never late, never in the bell |

- **Nothing is invented.** No day said is no date, never the month's end.
  "Next month" or "in December" is a month plan; "next year" or "in 2027" a
  year plan. Plans saved before this have no `dueKind` and read as day plans,
  so nothing that was counted stops counting.
- **The form**: When is three choices, A day, A month (a list of months, not
  the browser's month box, which desktop Safari and Firefox show as text) and
  No date yet. A new plan starts on A month, next month.
- **Moving**: Move the date takes any of the three; a no-date plan given a
  month or a day starts counting there. A move is kept on the plan only
  between real days.
- **The chat**: "I'm planning to buy a laptop, no idea when" is a no-date
  card; "move the laptop plan to December" and "the laptop plan has no date
  yet" are cards. Every card and list says the when as above, and the card's
  Safe to spend row says "Not counted until it has a date" or "Counted in
  November 2026".
- **The model** writes "Plan: Laptop, PHP 35,000.00, no date yet", "in
  November 2026" or "in 2027", and never invents a day.

**One figure on every screen** (owner: "Make everything sync properly all
parts / Add also the planned in budget and insight and other aparts"). Two
functions, used everywhere:

- `plannedForBudget(views, year, month, reference, asOf)`: open plans due in
  the month, and in the running month the overdue ones too, split into
  spending and bills/subscriptions. Budget, the month note, the next-month
  answer and the AI read it.
- `plannedByDay`: day plans only, for the Insights calendar and the
  Dashboard's coming up.

Safe to spend still sets aside only plans with Count it in safe to spend on
and no goal (P5). A spread payment (one entry split over months on the
Database) is folded back into its whole entry before a plan is matched to
it: on 27 October the Dashboard said a paid ₱9,000.00 plan still needed
₱11,200.00 while the Planner said ₱2,200.00, because one read the spread
rows and the other the entry. A renamed kind or wallet in Settings renames it
on every plan too (`renamePlans`).

