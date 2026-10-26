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
- **Bell**: due soon, due today, overdue, short, a payment to link, a goal
  behind.
- **Chat and AI**: everything above, in words and cards.
- **Activity**: every plan added, edited, moved, paid, skipped, removed or
  restored.
- **Backup**: whole.
