# Handoff: everything a new session needs

**Written 2026-09-28, at commit `e595864` plus this file; brought up to date on 2026-10-02.** For a fresh Claude
session, or anyone, picking this project up cold. It says what the project
is, how to work in it without breaking anything, what has happened, and what
is left. The detail behind each change is in its commit message; this is
the map.

---

## 1. Read these first, in this order

1. [`CLAUDE.md`](../CLAUDE.md): the guardrails. Binding. `MY THINGS/` is
   read only, forever. No secrets anywhere. Money is integer centavos.
2. [`04-STYLE-GUIDE.md`](04-STYLE-GUIDE.md): the design contract. Binding.
3. [`01-SYSTEM-REVIEW-AND-SPEC.md`](01-SYSTEM-REVIEW-AND-SPEC.md) (Part 6 is
   obsolete) and [`SYSTEM-ANALYSIS.md`](SYSTEM-ANALYSIS.md): the rules.
4. [`07-WRITING-RULES.md`](07-WRITING-RULES.md): no em dash, anywhere,
   including replies to the owner.
5. [`08-YEARS-AND-BACKUP.md`](08-YEARS-AND-BACKUP.md) and
   [`09-AUTO-PUSH.md`](09-AUTO-PUSH.md): the ledger is continuous; push
   without being asked, after the checks.
6. [`10-AI-ASSISTANT-STATUS.md`](10-AI-ASSISTANT-STATUS.md): how the
   assistant is built and the mistakes already made.
7. This file.

Before the first write in a session, `CLAUDE.md` §7 asks for a one line
acknowledgement to the owner.

---

## 2. The project in one paragraph

A single owner's personal finance system, moved from an Excel workbook with
VBA to a web app for phone and computer. React 19, Vite, TypeScript strict,
Firestore for data, Firebase Auth locked to one uid, Cloudflare Pages for
hosting (`financial-system-96l.pages.dev`, built from `main`), and a Pages
Function (`app/functions/api/ai.ts`) that calls free AI models with keys held
as Cloudflare environment secrets (`GEMINI_API_KEY`, `GROQ_API_KEY`,
`OPENROUTER_API_KEY`; names only, never values) and Cloudflare's own Workers
AI through a binding named `AI`, which takes no key. The phone is the primary target. The owner
writes in English and Tagalog, is direct, tests on a real phone, and sends
screenshots and `?coderview` dumps as evidence.

---

## 3. How to work here safely

### Checks before any push

```bash
cd app
npx tsc -b            # never --noEmit: it skips functions/ (CLAUDE.md §6)
npx vitest run
npx vite build
```

**Known baseline on a machine without the private fixture:** 43 test files
fail to load with "Fixture missing" (they need `app/src/fixtures/
excel-fixture.json`, the real ledger, which is gitignored and must never be
committed), and one test, `pickableYears.test.ts` "brings imported history in
with nothing to switch on", fails on untouched code. Anything beyond that is
new and yours. Compare against a baseline run of the untouched commit rather
than trusting a count: a `git worktree` of `HEAD` with `node_modules`
symlinked in works.

### Pushing

`main` deploys to production on every push. The working branch for a Claude
session is named by the harness (this one was `claude/cool-cori-ttbz0w`);
commit there, push it, and push the same commit to `main`:

```bash
git push -u origin <branch> && git push origin <branch>:main
```

Then run the check in `CLAUDE.md` §6 and report its output with the hash.
Never force push, never `git add -f`, and look at `git status --porcelain`
for `*.xlsm`, `MY THINGS/`, `.env`, `fixtures/*.json` and coderview dumps
before every commit. Commit messages: Conventional Commits, the reasoning in
the body, the attribution lines the harness gives at the end.

### Seeing the phone screens without the owner's data

The app runs locally against `app/src/fixtures/excel-fixture.json`. Without
it, it shows "No ledger loaded". For screenshots, write an **invented**
ledger to that path (same shape: `transactions`, `deleted`, `budgets`,
`reference`), start `npx vite --port 5173`, drive Chromium with Playwright
(`/opt/node22/lib/node_modules/playwright`, browser at
`/opt/pw-browsers/chromium`) at 390 by 844 with `isMobile` and `hasTouch`,
and **delete the invented file before running the tests**, because the tests
would read it as the owner's ledger. The app scrolls inside its own frame, so
a tall viewport (390 by 2200) shows a whole screen in one picture. AI is off
in a local copy: Settings, the AI tab, "Turn on AI".

### Walking the app against a real database, locally

Everything that writes (add, correct, bin, restore, transfer, a chat card,
a delete asked in words, restoring a backup, budgets) was checked on
28 September against the Firebase emulator, not by reading code. How:

1. `firebase-tools` emulators for `firestore` and `auth`, project
   `demo-fms`, with the repository's `firestore.rules` copied in.
2. Create the owner in the auth emulator with the uid the rules name
   (`POST 127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/demo-fms/accounts`
   with `Authorization: Bearer owner` and a `localId`).
3. A temporary, never committed, five-line patch to `src/data/firebase.ts`:
   `connectFirestoreEmulator` and `connectAuthEmulator` when
   `VITE_USE_EMULATOR` is set, and a `window.__testSignIn` that signs in
   with email and password. Revert it with `git checkout` before any commit.
4. Run Vite with `VITE_USE_EMULATOR=1`, `VITE_OWNER_UID` and six dummy
   `VITE_FIREBASE_*` values, seed with an **invented** backup made by
   `createBackup` and restored through Settings, Data, and read what landed
   with the emulator's REST API (`Authorization: Bearer owner` bypasses
   the rules).

Phones are `isMobile` and `hasTouch` in Playwright; tap, do not click, or a
scroll closes the app's menus. The page scrolls inside `.fms-main`.

### Reading a picture the way the phone does

With the dev server running, `page.evaluate` can `import("/src/data/ocr.ts")`
and call `readPicture(dataUrl)`: the same engine, the same clean-up and the
same two readings as the phone. That is how the receipt fix below was found
and checked. Keep pictures in the scratchpad, never in the repo.

### Checking the database rules for real

`tools/rules-check.mjs` runs `firestore.rules` in Google's emulator: 33
checks. Instructions are in its header and in
[`06-FIREBASE.md`](06-FIREBASE.md) §3. Needs Java, which this environment
has.

### Traps already fallen into

- **Backslashes through a Bash heredoc** vanish from regexes. Use the Write
  and Edit tools for anything with a regex. The audit command is in
  `10-AI-ASSISTANT-STATUS.md` §4.
- **Em dashes** in test data count: `writing.test.ts` scans every source
  file, including OCR text pasted into a test. Even its escape sequence in a test string is
  caught.
- **Hooks after an early return** in `App.tsx` blacked out the app once.
  Hooks go above every return.
- **A fixture that has never had the shape real data has** passes while the
  feature is broken. Several faults in `12-DEBUGGING-FROM-THE-RECORD.md`
  hid that way.

---

## 4. Where things live

| Path | What |
|---|---|
| `app/src/App.tsx` | Screens, navigation, the save paths, the `?coderview` route |
| `app/src/features/*.tsx` | One file per screen. `AskPanel.tsx` (8,000 lines) is the assistant |
| `app/src/domain/` | Pure logic, no React or Firebase: money, totals, debt, budgets, reading entries |
| `app/src/domain/receipt.ts` | A shop receipt checked by its own arithmetic (2026-09-28) |
| `app/src/domain/proposal.ts` | What a model read, turned into cards, and the checks after it |
| `app/src/domain/ocrText.ts`, `app/src/data/ocr.ts` | Reading a picture on the device (tesseract.js, served from this site) |
| `app/src/data/aiClient.ts` | Every call to the AI endpoint |
| `app/src/data/firestoreLedger.ts` | Every Firestore read and write of the ledger, settings and budgets |
| `app/functions/api/ai.ts` | The Pages Function: every AI task and its instruction |
| `app/src/styles/tokens.css` | Colours and spacing, light and dark (one dark block, rule D6) |
| `app/src/styles/layout.css` | Every screen's layout. Phone rules are `@media (max-width: 639px)` |
| `firestore.rules` | The database's rules. Deployed by hand (see §6) |
| `tools/` | Fixture extraction, history migration, the rules check |

---

## 5. What has happened

### Before this repository's history (to 2026-09-15)

The Excel was reverse engineered (`SYSTEM-ANALYSIS.md`), the web app built
with parity tests against the 440 row ledger, Firestore and sign-in wired,
the design rebuilt after the first look was rejected, and the assistant
added. 2026-08-30 to 09-01 were mostly money bugs found through
`?coderview`: see `13-ACCOMPLISHMENTS.md` and
`12-DEBUGGING-FROM-THE-RECORD.md`. On 09-15 the assistant moved into one
panel shown beside Add, as a floating chat, or as its own phone tab.

### 2026-09-26 (31 commits)

The phone made a phone rather than a shrunk desktop; Back goes back; filters
as one row; charts over any window; the chat able to do everything the app
does except Settings; statements as PDFs in the owner's layout over any
span; the 2023 to 2025 workbooks brought in as a mergeable backup; "start
clean from a file"; pictures read on the device first, then by fast text
models, with vision models as the fallback; a long wallet history read in
parts; each unclear card asked about one at a time; the black window after
sign-in fixed.

### 2026-09-27 (18 commits)

A wallet history that could double the ledger; one borrowing seen on two
screens booked once; the chat live across devices; On behalf (money held or
paid for someone) as its own kind; credit limits that grow; stopping a bill;
billing days for credit lines; debt payments as principal plus interest and
fees in one; reading only what changed (the owner hit 48,000 of the free
50,000 reads a day); "can I afford it"; Insights over any month, year or
range.

### 2026-09-28, the previous session

The batch bar folded to one line on a phone, and typed dates like "Aug 25"
read as that day (`3893fcd`). That session ran out of usage while writing
this handoff.

### 2026-09-28, this session

The owner asked for five things. Each is pushed.

| Asked | Done | Commit |
|---|---|---|
| "it struggles reading a receipt ... every different layout" | `domain/receipt.ts` finds a receipt's total by its arithmetic (cash less change, VATable plus VAT, VAT at 12/112, items, subtotal less discounts plus charges), tells the model with its working, and moves a card that landed on the cash handed over, the change or a tax line to the total. Photos read at 1,600px and whole, not cut like a screenshot. The extract instruction names receipt layouts. 33 tests | `434f6e4` |
| "look at the code view" | The uploaded dump was the one word "Reading…": the screen had never finished. Each read now gives up after 20 seconds and uses the device's copy, progress shows, and Copy and Save wait until it is done | `ddae2e7` |
| "give me new database rule that works" | Every write the app makes was checked against the rules. One real fault: binning, restoring and starting clean re-checked the whole row, so a row written under older rules could never be binned or set aside. A change to only a row's state is now allowed on any row, its money still guarded. Proved in the emulator: 33 of 33, where the old rules failed 2 | `b2f2746` |
| "in phone all parts the ui is too large ... the spacing in add" | A phone spacing scale in `tokens.css`, labels that sit on their fields, a 22px amount, Today and Yesterday and the date on one line, three filters on one row, Settings accounts on two lines, Budget's rows tighter. The Add form fits on one screen above Save | `e595864` |
| "Make a file in github that tell all things happened" | This file | |

The owner's receipt of that day, the one that prompted the work, reads as
109.00 with four checks agreeing, paid in cash. Its readings are in
`receipt.test.ts`.

### 2026-09-28, later: the coderview dump, read through

The owner sent a full coderview dump and asked for "the reasoning, the
logic ... all" to be fixed, then for charts, statements and the chat to
work "to all kind of scenario", then for the Activity screen and a loading
screen. Every fault below was found in that dump or on screen, reproduced,
fixed and tested. All pushed.

| What went wrong | What happens now | Commit |
|---|---|---|
| A habit guess ("the wallet you usually use") overruled what was said, and a card could say Revenue with a spending category | What the message says wins; the category always fits the kind; a guessed wallet only fills a blank and says so | `f9ad3a1` |
| "Hard to read" on cards typed by hand | "unsure, check it", and only for a picture | `f9ad3a1` |
| A receipt's card asked "What was it for?" about a reed diffuser | The item is chosen from what was bought; the `classify` instruction the server was missing is written | `9f20be5` |
| Free models printed their own reasoning as the answer ("We need to answer the question...") | Thinking is removed before an answer is shown | `27552ae` |
| Activity showed its filters twice on a computer | One row | `bf3eb98` |
| "trend march 2026 to today" drew today; a statement for "january 2026 to june 2026" came out January only | `domain/periodIn.ts` reads a range said any way, and charts and statements both use it | `170a8ff` |
| Replies to a card's question ("Cash, i purchase it for my room", "Reed defuser wood and santal", "cash") went to the router and became new entries or balance answers; "Read it" became an item; the chat said it "cannot read a receipt" | A reply goes to the card that asked; "read it" and "look at the receipt" read the last picture again; the chat knows the app reads pictures; "can you check if this is added" answers from the ledger by record number | `2ddb5de` |
| The composer kept the typed text after an export | Cleared | `2ddb5de` |
| The Dashboard waited behind one line of text | Each screen waits behind its own outline (`components/LoadingScreen.tsx`), ticking off Accounts, Entries and Budget. Style guide 2.5 and 3.10 changed at the owner's instruction | `7f11c6f` |
| "Change the title" found three saved rows to correct | It asks what the title should say and puts the reply on the card: the one asking, the one open, or the one just discarded | `eaedb8b` |
| "Its 109" while a card asked what it was for became a new entry, then a leaked chain of thought | The amount on that card changes and the question stays | `eaedb8b` |
| Card answers logged the whole row as a correction, and "2026-09-15 Revenue" was learned as a phrase meaning the item "//fix this"; "fee" and "moved into" were learned as wallets | Values only; lessons skip row summaries, figures and "//" notes, and never key on how money moved | `eaedb8b` |
| "summary per year" was answered "I only have monthly figures"; "since starting I didn't have good budgeting?" was answered from September and drawn as a chart | The chat gets every year's totals and every month against its own budget; a judging question is never a chart follow-up | `a9ebebc` |
| With no model, "6 pesos unknown spending cash" got "The AI model is not working" and no card | The device reads it | `2620184` |
| "revenue 14 pesos change of the electric bill payment cash" with a card open changed that card's wallet and made no card | A whole new entry is its own row | `2620184` |
| A single entry's question had only a text box | Its answers are buttons, as the batch questions have | `2620184` |

### 2026-09-28, evening: a real database, the second dump, the phone

The owner asked whether everything works "from add or ai to the database
to deleting, editing, adding, moving", and for the phone to be clean at
any size. All pushed.

| Found | Now | Commit |
|---|---|---|
| Tapping Save right after typing did nothing on a phone: the bottom bar came back under the finger and moved Save 52px mid-tap | The bar returns a moment after typing stops | `68d9466` |
| Restoring a backup with Replace or Merge never saved its budget | Saved, as Start clean did | `68d9466` |
| With no model, "delete the breakfast I just added" became the answer to "What was it for?"; a blank item warned that "" is not one of your spending types | Instructions are never answers; no warning for no item | `68d9466` |
| "breakfast", "fuel", "air freshener" were not known on the device | English words find the owner's own items | `68d9466` |
| Bank histories re-sent: 7 of 11 rows already logged came back as new | Matched on totals with fees, across kinds, within two days, and as parts (30,010 is 5,010 plus 25,000); one transfer answers both its ends | `4f9bc03` |
| A history list's rows dated by the heading below them | Dated on the device by the heading above; Today is the picture's day | `4f9bc03` |
| A receipt sent twice showed every field twice, and read as the description doubled | Only what differs; one line when nothing does | `4f9bc03` |
| "whats my balance actual usable" counted savings | Usable, reserve and savings are told apart | `4f9bc03` |
| The assistant forgot everything after Clear this view | Earlier sessions go with each question (`domain/memory.ts`) | `4f9bc03` |
| "by year" after an income chart drew spending; "trend of income" after a spending chart drew both | A follow-up keeps its direction; a new one replaces it | `4f9bc03` |
| A pie in the chat column read "Onlin...", "Mone..." | The legend goes under the ring unless there is room, and wraps | `4f9bc03` |
| "statement september 1 to 19" was made for September so far | Statements take days | `4f9bc03` |
| Maya Credit with Bill closes and Payment due both the 6th | Settings says what that means: due the 6th of the month after the bill | `4f9bc03` |
| Phone at 320 to 430px: filters cut to "All ...", Settings sections hidden past the edge, account names cut, Insights picks and tabs past the edge, months hidden, a stray dot in Activity | Every screen re-checked at 320, 360, 390 and 430, light and dark: nothing past an edge | `c722623` |
| "Gas 300" typed today was "already in your ledger" because of yesterday's | Typed entries match the same day only | `c722623` |

Verified in the running app against the emulator: add, correct, bin and
restore (a soft delete, `deletedAt` set and cleared), a transfer with a
fee (stored as Spending / Transaction Fee, net worth down by the fee
alone), a chat card (`entrySource: ai`), a delete asked in words,
Replace and Merge restores, statement CSV and PDF (closing balance equal
to net worth), full backup and CSV, Insights, Investigate.

Checked against the dump but already fixed on 09-27: "can I afford it"
questions (`affordAsk.ts`), charts per year and as a pie.

The owner corrected record #3846 (the PHP 14.00 change from the electric
bill) to Revenue themselves; nothing in the app changed it.

### 2026-09-28, night: the third dump, a realistic budget, a memory that holds

The owner's test run of hard questions, then: "fix the ai and the logic
of clear this view", "I ask it for budget recommendation for next month
based on my current spending and the separation, it didnt answer it
right", and "make an algorithm that works everything from free ai so
that it wont get lost or forget".

The rule this round settled on, in the owner's words, "ai first
allways": **the model answers every question. The device works out the
figures a question may need and puts them above everything else as
"Worked out by the app for this question"; its own words are said only
when no model answers, marked "this device, because ...". Actions (cards,
charts, files, deletes) stay the device's.** A first version answered
budgets, sums and affordability on the device; the owner rejected it the
same night ("this is not what I want I want ai first not system always
ai"), and it was changed before the next deploy.

**What the model is never allowed to forget** (`domain/memory.ts`,
`keepInMind`), sent whole with every question above the conversation,
where no trimming reaches (`fitConversation` keeps it):

- what the owner told it, read from every saved message, newest first:
  the income they expect, what they want saved, "based on balance not
  budget", plans, "remember ...", and corrections they made;
- this conversation in outline: every question and the first sentence of
  its answer, numbered, so "the first you said" and "why 14K" point at
  something.

A budget recommended a few messages ago also goes back with the next
questions as the app worked it out, so "why that number?" is answered
from how it was made.

| Found | Now |
|---|---|
| "what budget do you recommend for October if I only expect 8000 allowance?" asked five times, never answered | It read as a what if ("if i"), the what-if section subtracted centavos from pesos, the formatter threw, and the dropped promise said nothing. Units fixed; income wording is not a purchase; any fault now says so and is logged |
| "realistic budget next month" answered from July alone; "the separation of that" answered about September | `domain/budgetAdvice.ts` works out the budget the model is given: each item's median month over the six before, bills still running at their last amount, stopped ones and one-offs named and left out, held to an income and a savings goal when said, wants cut by the same share before any need. The month is the one beside the word budget. "set it" makes one card with both parts |
| "how about december what budget you proporse?" moved an October card to December | A question for a proposal goes to the model; a card is made only when the message says to do something (set, add, apply) |
| "but based on my current budget and give me realistic costing", about eating out, got October's whole budget | It is the eating-out decision again: the model gets the wallets, what a meal usually costs them and the budget |
| "remember that my allowance is 8000 a month" became an income card | Said to the assistant, kept in memory |
| "Bills and subscriptions: 1641 / Spending: 6359 / Save to: Oct only" became a PHP 1,641.00 spending entry; "Set October's bills ... to ₱1,641 and spending ... to ₱6,359" made a card with PHP 0.00 for spending | Each budget line is read with its own figure, either way round, and the two lines typed as a form are a budget without the word (`tracksIn`, `isBudgetForm`). "raise spending by 1000" changes what is set |
| "thats budget" asked what September's budget should be | The message before is read again as a budget and the entry card it made is put aside |
| "where do the funds even come from?": three income rows that did not add up to the total quoted, and "no credit entries this month" beside two Maya Credit draws | `domain/moneyFlow.ts`: every movement into and out of the spending wallets, grouped (income by item and wallet, borrowed, held for someone, paid back, brought out of savings; spending, bills, sent away, fees, interest, repaid, passed on, put aside), start plus in less out equal to the balance. With `whyOver` (each item against its usual month), the bills paid month by month and the credit history, it is in every chat request; a section the question asks about is kept first when a request must shrink |
| The sidebar on a computer was empty under the menu | The balances: usable now, each account under its Settings heading, a "low" tag under the low-balance threshold, empty reserves and savings folded into one line, and what is owed; it scrolls on its own and gives way first on a short window |
| The sidebar balances would grow into a wall with more banks | Names on one line with the rest on hover; each group folds from its heading, which carries its total; four accounts a group (six for Spending, and a low one always shows), the rest behind "Show N more" (`components/SideBalances.tsx`) |
| Two Maya cashback notifications asked "What was it?", though every cashback before was Random | "cashback" and "cash back" are one word to the history (`infer.ts`), and a card read off a picture is matched by its own description when nothing was typed |
| A Maya "Net boosted interest" screen: three figures, one of them what arrived | `domain/interestCredit.ts` checks earned less tax is the net, tells the model, and holds its cards to one Revenue of the net, Bank interest, into Maya Bank (Personal savings); a credit line's interest is left alone. Checked on the device's own reading of the screen |
| Saving a purchase said only "Saved", even when it took the month past its budget | A calm note after spending (`domain/spendNote.ts`): past the budget, past a limit, past nine tenths, each once a month; a want while already over once a day and only when not small; a need is counted, never judged, and says nothing once the month is over. Worded by the model (task "note") from the note's facts only, kept only if it uses their figures and does not preach; the device's words otherwise. Settings, Alerts, "Notes after spending" turns it off; the AI list's "Budget notes" stops the wording |
| The budget card was a sentence ending "was ₱0.00 and ₱0.00" | A table: Now and New for each part, the total, and the change; months changed alike are one block |
| "should I set my budget to 9000?" was an edit to a saved entry | Asking what to do goes to the model; a card is made only when told ("can you set", "set", "change") (`asksRatherThanTells`), for budgets, edits and deletes alike |
| The conversation was appended below the entries, and a model refusing the size had it cut first | Sent as its own `conversation` field; the server keeps it beside the figures and shortens it from the oldest end (`fitConversation`). The newest four turns go whole, not cut to 500 characters |
| At 18,000 characters the figures were cut from the end, losing the window asked about and the years | `compactContext` drops whole sections, least needed first (flags, the debt log, day by day), and says which |
| Stop said "Stopped" and the answer arrived anyway; Clear this view left a pending question and an in-flight answer behind | Both abort the request and drop a late answer; Clear forgets the waiting entry, the card question, the rename, the last recommendation |
| "how much would I save?" offered a spreadsheet | "save", "copy", "print" ask for a file only with something to put in it |
| "pie" and "spending only" after "by year" went back to the first chart's window, one point | The router's period is used only when the message names one; year by year inside one year is month by month |
| "compare income vs spending this year" drew two lists of items | Month against month |
| "so is it an option or not?" after the device's yes went to the model and came back no | The device answers the same decision again (`followsUpDecision`) |
| "how much did I spend on food in August" was a model's sum | `domain/spendAsk.ts` works out the sum the model is given: the charts' window and `costOf`, in English, Tagalog and phone typos |
| The Budget screen's forecast said October ₱10,030.39 "3,601.51 to 16,459.27" and November and December ₱16,127.76 "15% up on the trend", and still counted stopped subscriptions | The forecast is the owner's usual month (`domain/outlook.ts`): each item at its median over the months before, one-offs left out, bills still running at their last amount, what usually comes in, the debt due and the budget already set. Every month ahead reads the same months, across the year end. Last year's same month is named beside a month when it held something big (tuition, Christmas) and is never added. The same figures go to the chat ("The months ahead, as the app plans them") and to "use the forecast" |
| The forecast table was five columns with a paragraph on every row | Three figures (you usually spend, you usually earn, left over), the next three months with the rest of the year behind "Show the next 12 months", one line saying how it was worked out, and "Use as budget" on each month, confirmed first (`features/Outlook.tsx`) |
| The forecast had no words, from the model or the device | "What this means" is the device's own explanation, always. "Explain with AI" asks the model (task "outlook") from the same facts only, and its words are kept only if every figure in them is one of those; otherwise the device's words stay and say why. The AI list's "Forecast" switch turns the button off |
| On the 3rd of a month the month still running, three days of entries, was read as a whole month and pulled every item's usual month down | It is read only once three quarters of it has passed (`budgetAdvice.ts`, rule 1) |

Verified against the emulator with a fake model that reports what it was
sent: every question reached the model with the right worked figures
(affordability, a December budget, a sum, the standing budget for "why
that number?"), the memory block and the outline; "set it" made the
December card in its two parts; "remember ..." made no card; with every
model failing, the device's figures were said and marked why. Stop and
Clear drop answers that land after them.

### 2026-09-29: a total and its parts, an ATM slip, a tilted receipt

The owner: "make sure it knows logic too, i keep explaining this", then
two photos and "train it dont hard code". No model is trained from here:
the free models are used as they are. What is taught is general rules on
the device, worked examples in the instructions the model gets, and the
owner's own corrections, which already outrank the next guess.

| Found | Now |
|---|---|
| "I paid 450, 300 for honorarium for capstone and 150 for my donation for capstone. All school category basically 300 and 150 total of 450" made three cards, ₱450.00, ₱150.00 and ₱150.00 | `domain/entryTotals.ts`: a figure said as the total of the others (given first and broken down to the centavo, or named total, in total, in all, lahat) is not an entry, and a later sentence that only says it all again is not either; what it says about all of them ("all school") files each card. The splitter, the per-card amount check, the chat and the model's instructions all use it, and a card the model makes of the total beside cards that add up to it is dropped. The chat says "₱450.00 is what they come to, so it is not an entry of its own", and when the parts do not add up to the total said, says so |
| The same cards were labelled "hard to make out in the picture", and a ₱300.00 honorarium was "Already in your ledger" as a ₱300.00 of gas two days before | Cards from typed words are marked typed (`Proposal.typed`), never taken for a picture's: typed labels, and the same-day window for repeats |
| An ATM slip (China Bank Savings, "CASH WITHDRAWAL 1,000.00", "AN ATM FEE OF 16.00 IS ALREADY INCLUDED", balance after 2,934.79, "Visa Credit") had no rules | `domain/withdrawal.ts`: one Transfer into Cash, the cash as the amount and the ATM fee as the fee. A machine gives whole hundreds, so the cash is whichever of the printed figure, or it less the fee, is whole hundreds. The account is the one whose balance less what left it is the slip's balance, else the one the owner's withdrawals (at that machine first) came from, else asked; a balance far from the slip's says to check the account. "Visa Credit" is the chip's label, never a Debt. Nothing about China Bank is in it |
| A history's "Withdrawal from TANQUI SFLU -1,018.00" was saved as ₱1,018.00 into Cash with no fee | The same rule: ₱1,000.00 of cash and an ₱18.00 fee, when the rest is ₱30.00 or less (`cashAndFee`) |
| Two purchases out of Maya the same day, ₱700.00 and ₱300.00, were called a ₱1,000.00 withdrawal "together" | Between two of the owner's own accounts, parts must go the same way at both ends |
| A 7-Eleven receipt photographed about ten degrees tilted lost its item, total, cash and date to the reader | Every camera photo is straightened before it is read (`ocrText.ts`, `skewAngle`: the tilt at which lines of print on paper line up sharpest, only paper with ink counting, so a rock or a zebra crossing does not). It is read both ways and the reading the reader is surer of is kept, so a level photo reads as before. The receipt then read whole, and the receipt check found ₱25.00 in cash on 29 September |
| "NatureSprigPur iDHIL U": the shop's VAT mark read as part of the item | A lone tax mark after the price is dropped, and the model is told how a shop shortens names |

Then, the same day, a message the owner means to send in their own words
each time: "I paid for gas using cash 250. I paid 150 for my school and
honorarium 300 both in 450 total in school for our final capstonedefense.
Then i ate lunch 95 and buy water 25 and also i withdraw from maya 1000 16
fee". Six entries; it made three. Every fix is a rule about English, tested
on five wordings of the same day (`wholeDay.test.ts`), not on that sentence.

| Found | Now |
|---|---|
| Two sentences were one entry | A full stop, a question mark or an exclamation ends an entry (`splitEntries`) |
| "150 for my school and honorarium 300", "lunch 95 and buy water 25", "lunch 95, water 25" were one entry each | "and", "at", "tsaka", "saka" or a comma splits when both sides carry their own amount and the second opens with a verb, a few words and a figure, or a figure. Never before a fee ("and 16 fee", ", fee 16"), and a date or a count ("sept 29", "2 shirts") is not an amount. "tapos" and "pagkatapos" are "then" |
| "honorarium 300" had no verb and read as nothing | A clause with no verb borrows the nearest one before it ("I paid"), only the verb, never the words around it |
| "from maya 1000 16 fee" was lent to the lunch as its wallet and fee | A wallet is shared from the last clause only when that clause has no figure of its own |
| "i withdraw from maya 1000 16 fee" had no destination | Cash taken out with no destination named goes into the cash wallet |
| "i ate lunch 95" was not spending | Eating and drinking words are spending (ate, kumain, drank, uminom) |
| "gas 250 cash, school 150" with no verbs read as nothing without history | A kind from the owner's own list and a price is spending |
| "450 total" was measured against every figure in the message | A total's parts are the figures beside it in its sentence that come to it exactly; one said on its own line or sentence looks at the ones before it. The chat names them: "₱450.00 is ₱150.00 and ₱300.00 together" |
| When the model returned fewer cards than the message held, all of its cards were thrown away for the device's | Its cards stay; only what it left out is added, marked "The model's reading left this one out" (`partsTheModelMissed`) |
| The lunch card warned "You wrote PHP 1,000.00" | Each card is checked against the clause the splitter gave it (`clauseFor`) |

Then a card payment, sent as two photos: a Maya Business terminal's slip
("PAYMENT CHANNEL Credit Card", "APP. LABEL Visa Credit", ₱2,082.00,
approval code on it) and Mang Inasal's own receipt for the same meal.

| Found | Now |
|---|---|
| Neither photo was checked: the receipt's "VAT" was read as "UAT", so it was not known as a receipt | VAT labels take a U for a V, as this printer's typeface is read: the receipt is checked, ₱2,082.00, three ways |
| "PAYMAYA CREDIT CARD" on the receipt was read as paid with Maya | A card on the payment line is a card: PAYMAYA is the terminal's company, and any bank's card on it prints the same |
| A terminal's slip had no rules | `domain/cardSlip.ts`: one card payment at the merchant printed at the top, with its date, time, approval code and the card's last four. "Credit Card", "Visa Credit", "I promise to pay" and the terminal company's name are never a Debt or a credit line. The model is told so, and its cards are held to it (`checkCardSlips`) |
| The slip and the receipt, sent together, were two cards (or three, with a "bought on credit" borrowing) | A slip and a receipt with the same approval code, or the same amount within a quarter hour, are one payment: one Spending, described from the receipt, made one again across the separate requests each picture goes in. An approval code read as "ppprCode", or a year read as 2020 in one of two readings, still matches |
| Which account a card paid from | Where the owner's own card payments come from (`cardAccount`: rows like "Purchase at MCDO 878", "JOLLIBEE JB3829"; Maya in their ledger). A line is used instead only when their card purchases are filed as bought on one. Picking the account once teaches the next slip |

Then: "I scan the picture, it got it wrong in the details but I click edit
then I add it in manual but in ai it didnt register it as add". The card
was sent to the form, corrected and saved as #3859, and still read "In the
form" with Add to ledger on it; Put back in the form then filled the form
with the first reading, a copy of #3859.

| Found | Now |
|---|---|
| A save from the form marked the card added on that screen only, and never wrote it down, so the chat on any other screen, or after a reload, brought it back waiting | The change is recorded like a button press, with the number the row was given, and the card shows the row as saved, not as first read |
| The phone's AI tab and the chat on other screens are not open while the form saves, so they never heard of it | The save is looked for again whenever a conversation loads, for a card sent to the form before it; and a card still in the form is settled from the ledger itself: the one row saved after the card with its date, amount and kind (`formSaved.ts`), which is what fixes a card left waiting before this |

**For the owner, not changed:** the September withdrawals already saved
from Maya's history hold their fee inside the amount: ₱1,018.00 on the
18th and the 20th, ₱516.00 on the 24th and ₱218.00 on the 26th, each with
no fee. Cash was credited ₱70.00 it never received and ₱70.00 of fees were
never counted as spending. Correcting each to its cash and fee is the
owner's call; nothing was changed.

### 2026-09-30: Gemini, and Workers AI behind it

The owner: "Can we add another powerful ai that is free and cannot forget
and actually smart?", and, asked which, "Both".

| Asked | Now |
|---|---|
| Smarter | Google Gemini, text and pictures, from Google's own list (`geminiRank`). Nothing is pinned, as with the others: a model Google adds is used the day it appears. Its thinking is kept short, since the figures are worked out on the device and every call has twenty seconds |
| Free, and a backup | Cloudflare Workers AI, through a binding on the Pages project, so no key and no network hop out of Cloudflare. Text only: a model there that cannot see a picture would answer anyway. `AI_WORKERS_MODELS` replaces its list without a deploy |
| Cannot forget | The memory is the app's, not the model's: every model is sent what to keep in mind and the conversations before, from the database. What changed is how much of it goes: 30,000 characters of conversation, from 14,000, since Gemini reads a million tokens and cutting was the forgetting |
| Chain as before | With neither set up the chain is exactly the old one. A bad Gemini key, or a Cloudflare location Google does not serve, is refused with 400; it is read as 403 (`geminiRefusal`), so the next model is asked at once rather than the same request sent twice |

Settings lists both, with their models, and says when one is not set up in
Cloudflare yet. `firestore.rules` accepts the two new provider names; until
the rules are published, picking either in Settings is refused.

**Privacy, told to the owner:** Gemini's free tier may be used by Google to
improve its products, and people there may read what is sent. Workers AI
says it does not train on what it is sent. The owner chose both knowing it.

Then, the same day: "I want the most powerful ai. Like if the other
powerful is not available means use the other most powerful. All low end ai
and not smart ai make them last option."

| Found | Now |
|---|---|
| The chain went by provider: Gemini's two, Workers AI's first, then Groq and OpenRouter taking turns, so Groq's 8B model could be asked before OpenRouter's MiniMax M3 | One list of every model from every provider, strongest first (`functions/api/_strength.ts`): a rough standing from public benchmarks, by family and version, so Gemini 3.8 Flash ranks above 3.5 and a newer GLM or MiniMax above the last without a change. An id never seen is placed by its size and marks ("70b", "lite", "instant"). The same model on two hosts sits side by side, so one host's outage leaves the other |
| Two models were asked at once and the quicker answer won, so a weak model beat a strong one working beside it | The strongest answer is taken (`bestInOrder`): a weaker one that answers first is held while a stronger one is still working, until the job's hold (18 seconds for the chat and panels, 35 for a picture, 3 for sorting a message), inside what the app waits |
| A model refused in a second still made the one beside it wait for the next round | A failed model is replaced at once by the next one down |
| A model with nothing left for the day was asked first on every request | A refusal keeps it at the back for a while (`coolFor`): a minute for a busy minute, three hours for a day's allowance used, twelve for a model the free tier gives nothing (Gemini Pro since April 2026), an hour for a bad key, an unserved region or a retired model. Still tried last should all the others fail |
| The newest Gemini Flash models give about twenty free answers a day each, Flash-Lite hundreds, Pro none | Every Flash version is kept, so four of them are about eighty strong answers a day, each used up in turn; three Lite; only the newest Pro, for the day the key has billing |
| Sorting each message would have spent those | The quick jobs (sorting a message, naming an item, a one line note) leave Gemini's Flash and Pro and Workers AI to the questions, and count Groq's speed for ten points: the app waits only seconds for them |
| Workers AI's list was Llama 3.3 70B and Mistral Small | GPT-OSS 120B first, then Qwen 3.8 27B, Llama 3.3 70B, Mistral Small. Its answer is read in each shape its models give (`workersText`). DeepSeek V4 on Workers AI needs the paid plan, so it is not on the list; a model that says so is left alone twelve hours |

### 2026-10-02: the fourth dump, read from the 30 September build

The owner sent a `?coderview` dump taken on build `9ad7d26` and asked for
everything in it to be fixed. It covers 30 September to 2 October: a shop
receipt, a Maya history, two screenshots of Maya Bank's daily interest, and
typed entries. The dump itself stays out of git.

| Found | Now |
|---|---|
| "Add N ready" on the batch bar saved the rows and never wrote the cards down as added, logged nothing as accepted, and saved each card as first read, ignoring an edit made on it. After a reload the cards came back open: two interest cards added this way at 05:08 were back ten minutes later, were discarded, and stayed in the ledger as #3869 and #3870, and the two added by hand in between were warned as copies of them | Each card goes the way its own Add to ledger button does: what is on the card, logged, learned from, recorded as added (`addReady` in `AskPanel.tsx`). The same fault "Discard all" had on 21 September |
| A card saved from the form was recorded as added twice, once as the form held it and once as the ledger row, so the record had two "Added" lines for #3860, #3865 and #3876 | Written once (`addedCards`) |
| "Received money" ₱2,018.00 and ₱3,000.00 off a Maya history came back as transfers from Maya to Maya: the blank source was filled with the account the statement is for, which was already the destination | Money into the statement's account from outside is income into it, as every received row in the ledger is filed (hundreds, all Revenue); from one of the owner's accounts it stays a transfer; a row read as the same account at both ends asks where it went (`domain/statement.ts`, `readAgainst`) |
| Two screenshots of the same daily interest list came back as four cards all dated the day of the picture, and five more rows were dropped as "shown twice". A date with no year ("Oct 1", "Oct 1, 11:59 PM") was not known as a date, so every row sat under no day and one day's "Interest earned ₱0.15" looked like the next day's | A date alone on its line is a date with or without a year, a weekday or a time, day first or month first, or as 10/01/2026; with no year it is the picture's year, or last year's when that would be more than a month ahead. When nearly every row has its own date under its figure, each date belongs to the row above it, and the stitched-screenshot check tells rows apart by that date. A date inside a row's own line dates that row (`ocrText.ts`: `DATE_LINE`, `isoDayIn`, `rowDatesIn`, `dropRepeats`). The photo is not kept, so the exact layout was not seen: the common layouts are tested (`rowDates.test.ts`) |
| "I spent 25 water and 175 tokens" made a card for a new kind "Water", though the owner had filed water three times that week under Food | A new kind the model names is filed where the ledger has filed that word, when at least two past rows and two in three of them agree, and the card says so (`domain/fileAsBefore.ts`). "Tokens", never seen, is left as read |
| The same typed ₱25.00 of water was "already in the ledger" as the day before's | A card's `typed` mark is now kept when it is stored and read back, so a typed card is matched against its own day only, after a reload too; cards from before that mark, sourced "user text", count as typed |
| "How is this month going?" was answered "a daily shortfall of PHP -10,218.71 for the remaining day" | The app told the model "What is left of the budget works out to PHP -10,218.71 a day". Over budget it now says nothing is left to spend a day, and the overspend once (`aiContext.ts`) |

**For the owner, not changed:** Maya Bank interest on 2 October is five
rows, #3869 to #3873 (₱0.15, ₱0.10, ₱0.10, ₱0.15 and ₱0.35, ₱0.85 in all),
all dated 2 October. #3869 and #3870 are the two the chat later showed as
discarded; the four from the screenshots were most likely different days.
Which of them to keep, and their dates, is the owner's call.

Then "lets fix the ai", read against every question asked since the 28
September "AI first" change. Most were already fixed that night; two were
still open:

| Found | Now |
|---|---|
| "I think i deleted a wrong entry" was shown the newest saved rows to edit or bin (the rule for "my last entry is wrong" caught "wrong entry"); "last month?" after it was answered with August's spending; "//fix this it should know all the deleted by date" | A sentence about having deleted something lists the bin, newest deletion first, each with Restore and the day it was deleted and the day it was for; a day or period narrows it, by either date; a period said alone right after ("last month?", "september") narrows the same list. The model is told the bin too: count and the newest 25 by deletion day (`domain/deletedAsk.ts`, `binForModel` in `aiChatContext.ts`) |
| "You didn't read the other one", after two photos came back as cards off one, was answered with where the month's money came from | Heard as "read it again", and only the pictures no card came off are read (`saysOneWasMissed` in `capture.ts`) |

**Read but not fixed:** the shop receipt of 30 September came back as four
items (₱495.00, ₱80.00, ₱3.00, ₱1.00) and was treated as a stitched list;
the owner kept one. Without the photo the reading cannot be replayed.

### 2026-10-02, night: Gemini and Workers AI set up, pictures looked at

The owner added `GEMINI_API_KEY` and the Workers AI binding `AI` in
Cloudflare and asked for the picture reader, "always failing in
identifying", to be fixed. Every upload in the fourth dump says "read on this
device": the model was only ever given the device's text, so its misreadings
became item names and a quantity became an amount.

| Found | Now |
|---|---|
| Pictures went to a model only as the device's text, and to a model that could see only when that text found nothing, which it never did | With Gemini set up each picture goes to Gemini itself, one to a request, two at a time, with the device's reading beside it marked for checking only; the device's checks (amounts, dates under headings, receipt arithmetic) still run on the answer (`lookFirst`, `seesPictures` in `data/aiClient.ts`; the prompt's line on "the picture itself" in `functions/api/ai.ts`) |
| A picture Gemini cannot read (its free allowance spent, say) would have fallen to the free vision models that were slow and blind on 26 September | The request asks Gemini only (`seeWell`) and is not retried; that picture then goes the device's way, and one neither could read goes to every model that can see, as before |
| A list the device counts over twelve rows | Still read in parts as text: one answer for all of it would outrun the twenty seconds a model is given |
| No way to see on the screen whether the keys and binding took | Settings, AI, under Model: "Set up in Cloudflare: ..." and how pictures will be read (`providersSetUp` in `domain/settings.ts`) |

Not seen against the live models: there is no key here. The owner's first
picture after the deploy is the test; its card says which model answered.

### 2026-10-03: two dumps, one Maya history, and the difference it left

The owner sent dumps at 22:08 on 2 October and 01:59 on 3 October (build
`a8aeea4`), a Maya screenshot and two Dashboard screenshots, and said the
asking struggles, Find a difference could not find what was wrong after
adding, and the app cannot tell what is already added. They then put Maya
right by hand: binned #3877 to #3879 and added one ₱200.00 row (#3882).
Nothing in their data was changed here.

| Found | Now |
|---|---|
| A Maya history's ₱204.00, ₱102.00 and ₱102.00 of load were already one ₱408.00 row (#3867, "Buy load"). Each was compared alone, all three were called new, and "Add ready" added them again: Maya ₱206.00 out | Two to four cards out of (or into) one account within a day that add up to one row here are that row: "This and the ₱102.00 and ₱102.00 cards are #3867, already in the ledger as one row." The batch bar holds them back as already in, they are not asked questions, and "is this added?" lists them together (`togetherAsOne` in `duplicates.ts`, `checkPicture.ts`) |
| "wait my original balance is 176.56" made the open ₱102.00 card ₱176.56 | A sentence with a balance and a figure is never a card correction (`statesBalance` in `capture.ts`); with no account named it is the account of the picture just read, and goes to finding the difference, with that picture's rows as the history (`readInvestigateAsk`'s `inContext`, `lastRead` in `AskPanel.tsx`) |
| Find a difference, given that history, would have called #3867 "not on the statement" and the two copies matched; a row dated 30 September did not match the same movement listed on 1 October; today's ₱100.00 took yesterday's row and yesterday's was called missing; a cashback the picture does not reach was counted as a cause | Closest pairs are matched first across the whole list; rows three days either side are matched; a row the day's lines add up to takes them, and the rows entered after it for those lines are named as copies ("already part of #3867"); rows the picture does not show are set apart, uncounted, when the rest account for the difference to the centavo (`investigate.ts`: kind `inside`, `aside`). On the owner's data: "Found all ₱206.00": #3878 and #3879 inside #3867, and ₱100.00 on 3 October missing |
| "all that entry is load" gave five cards of Unknown | A kind said for every row goes on every spending card, filed where the ledger filed that word this past year: load under Online Buy (`saidForAll.ts`) |
| The newest row, under Maya's "Today", was dated the day before. Replaying the screenshot through the phone's reader: "Today" (white on black) is not read at all, and the second reading prints "October 02,2026" with no space and a stray letter before it, so it had no dates | "36 mins ago" (minutes, or up to three hours) dates a row as the picture's day; a date with no space after the comma is a date; two readings disagree about a repeated figure only when the other has no undated row of it left (`ocrText.ts`, `datesFromHeadings`) |
| "if I recieved my salary woth 10k today how can I budget it? maya" became ₱10,000.00 of income, twice, then a budget card | "how can I", "if I ... how", and a question mark with up to three words after it are questions; a question never sets a budget (`intent.ts`, `asksRatherThanTells`). Asked how to budget an amount, the model is told to divide it into parts that add up to it: bills still due, the rest of the month's spending, what is left to keep (`ADVICE_RULES`) |
| Dashboard: "Spending faster than the budget allows ... ₱4,964.95 left over 29 days is ₱171.21 a day" beside "₱3,264.95 left of the spending budget, ₱112.58 a day" | The warning counts the spending budget when the month has one, as the Dashboard does (`alerts.ts`) |
| A picture after the deploy was still "read on this device"; the record cannot say whether the page was the old build or Gemini could not read it | The reason Gemini could not is now in the record and under the answer: "read on this device (Gemini could not: ...)" (`sightMissed`) |

**Open:** the owner wrote "ui error" with the 3 October Dashboard
screenshot. Nothing in the dump names one. The two figures that disagreed
are fixed above; the outline round the Dashboard item in the menu is the
keyboard focus ring and was left. Ask the owner which part they meant.

### 2026-10-03, later: how the chat reads a message, measured

The owner sent a phone screenshot: "Does my treat earlier
unconstitutional?" answered "Yes, ... it is not a violation", and "Like I
was invited urgently earlier, what can you advice?" answered "Yes, you can
allocate PHP 4,500.00", a sum nobody said, beside "gym sessions" nobody
planned. They asked for "an algorithm that works", and for every add, edit,
delete and move to be checked.

**Measured, not guessed.** Every sentence in the 3 October dump was labelled
by what happened next: a card from it was added (an entry), or it was
answered with no card or followed by "I am asking" (a question), 281 in all.
The local reader (`readEntry`, `isQuestion`) read 15 questions as entries.
After the changes below, 6, and each of those is an answer to a card's own
question, a report ("blue screen"), or a label that was wrong ("umutang ako
2000 sa maya credit" is borrowing). The labelling script is
`scratchpad/oct3b/label.ts` in that session; rebuild it from the
description here, never commit the dump.

| Found | Now |
|---|---|
| Plans read as money that moved: "I will spend 1000 today for my school", "I'm planning to go to the beach today ang spen 500 for food" | A plan with no past verb beside it is a question (`isPlan` in `intent.ts`); "I want to add 500 food" and "I borrowed 2000, will pay next week" stay entries |
| Questions asked mid-sentence, misspelt or in Tagalog: "so if the night comes what happens", "rate your self how advanced are you", "hw much i spnt on gas last wek", "magkano nagastos ko" | Read as questions (`ASKED_ELSEWHERE`); the scoreboard (`eval/corpus.ts`) carries invented sentences of each shape, and its judge now follows the app's real order, question before entry |
| "My Maya Credit does not balance" | Opens Find a difference |
| Every question answered with yes or no first; "what can you advise" answered "Yes, you can allocate PHP 4,500.00" | Only a yes or no question opens with yes or no, and the word must agree with the rest; no figure on a cost nobody gave; "earlier", "that", "the treat" read against the conversation; a word that does not fit is answered by its likely meaning, said (`ADVICE_RULES`) |
| An invented figure passed the check under the answer: in a context of hundreds of figures nearly any number is one step from two of them | With more than 40 figures given, the step must show one of its parts in the answer; the owner's own "2k" or "5000" count as given (`aiFigures.ts`) |

**Every action, end to end.** On the demo build, by Playwright, each checked
against the wallet balances rather than a screenshot, at desktop and phone
widths: add a spending; edit its amount in the Database; bin it; restore it
from the Bin; move money Cash to Gcash; change a month's budget and see it on
the Dashboard; borrow on a credit line into a wallet and pay part back; add
an entry from the chat and bin it from the chat; add a wallet, move money
into it, rename it (its entries follow the name). All passed, no page
errors. `firestore.rules` in Google's emulator: 33 of 33 (`tools/rules-check.mjs`).
The rules have not changed since 30 September, so nothing needs publishing.

One thing found and changed: the last field above the pinned Save bar (the
debt payment's "Paid from") could sit under the bar at one scroll position,
so a press landed on the bar. A field scrolled to the end of the view now
leaves the bar's height clear (`layout.css`).

**Open:** with no model reachable at all, "lunch 99 cash" (no verb, and
"lunch" not a kind's name) reads as nothing and the chat says the model is
not working; "food 150 gcash" and "I spent 99 on lunch cash" are read on
the device. Signed in, the model reads it.

### 2026-10-03, later still: the same two questions, answered the same way

After the rules above went live the owner asked again and got "I recommend
allocating PHP 4,500.00 for the urgent invitation ... after the planned
school spend (PHP 2,000) and gym sessions (PHP 140)", from GPT-OSS, with
Gemini chosen as the provider. Traced:

| Where it came from | Now |
|---|---|
| "Gym sessions (PHP 140)": "I'm planning to go to the gym this week and 70 per session 2x a week", said on 28 September, pinned in "What to keep in mind" as a plan, sent with every question since | A plan stays in it for three days (`keepInMind`'s `asOf`) |
| PHP 4,500.00, invented once, then repeated: the earlier answer was in the conversation, and the figure check counted the conversation, model answers included, as a source | Only the owner's words and the device's own answers count (`trusted` in `useAi.ts`); an answer that was flagged is marked in the outline, "never repeat them" |
| "Earlier" and "the treat" not connected to the ₱375.00 treat added that day | The device says what the question most likely points at, the newest entry it names or the newest today, and that no amount was given (`pointsAt.ts`, a section of the chat's figures) |
| GPT-OSS answering with Gemini chosen: the Dashboard and Insights panels asked Gemini first, two at a time, whenever they opened, and its free answers (a few dozen a day) were gone when the owner asked | The panels leave the scarce models for the chat and pictures (`BACKGROUND_TASKS`); a question asks the strongest alone for eight seconds before a second joins (`bestInOrder`'s `staggerMs`), so an answer costs one Gemini request, not two |

### 2026-10-03, last: every provider at once, the strongest that answers

The eight seconds alone above made it worse: with Gemini busy the chat
waited on one Gemini model after another, twenty seconds each, and said
"The model took too long to answer". The owner asked for every provider to
be used, the strongest that is available, and the fastest. Now:

| Before | Now |
|---|---|
| The chain in strength order, so the first two or three asked were often all Gemini | The strongest of each provider is asked together, Gemini, Groq and OpenRouter (`spreadProviders`), then the rest in order |
| The strongest asked alone for eight seconds (`staggerMs`) | No wait, unless every model left is one provider's (a picture for Gemini alone), which keeps six seconds |
| The chat held for the strongest up to eighteen seconds, each model allowed twenty | Twelve seconds held, fifteen each (`HOLD_MS`, `CHAT_TIMEOUT_MS`, Workers AI as well) |
| A model that ran out of time was asked first again on the next question | Set aside for five minutes (`coolFor("timeout")`), only when it ran out on its own clock, never when it was stopped because a stronger one answered |
| Settings: "Automatic (the best free one available)", and Provider said "the service tried first" | "Automatic (the strongest available, any provider)"; under it, the three asked at once by name; Provider says it changes nothing while the model is Automatic, which was already true (the provider is sent only with a model) |


### 2026-10-03, last: a card's kind is always one of the owner's

"I said I travel ... the entry says vacation instead of travel. Make it always
align in the database." A model named a kind the owner does not have, the card
kept it and said "Saving this adds it as a new one", which nothing did: the row
was saved with an item on no list, so no total, filter or ranking that goes by
the owner's kinds found it again. The Add form only ever offered the lists.

| Where | Now |
|---|---|
| A model's reading (`readProposals`) | `fitItem` (`domain/onList.ts`): the list's own spelling; the one kind the owner named in their words (when the message made one card); a near spelling; the item's words read against the notes and the everyday words (Vacation is Travel, Groceries is Home Needs); the description; else left empty, the word kept as the description, and the card says why |
| The card on its way to the chat (`offer` in `AskPanel.tsx`) | The same, before the ledger and a model fill an empty item, and again after |
| The ledger's history (`inferFromHistory`) | Only rows whose item is on a list now count: a kind from years back is never today's |
| An answer to "What was it for?", and "change the item to X" | One of theirs, a bill or subscription by name moving the card to that list, or refused with what to do |
| The card | A kind on no list shows the picker, and Add refuses it (`offListProblem` in the sink's check) |
| Everyday words (`filipino.ts`) | vacation, trip, transportation, entertainment, medicines, dining, grooming and a few more, resolved against the owner's own list like the rest |

A genuinely new kind is made in Settings and is then on the list like the rest.

### 2026-10-03, last: every kind on every list can be renamed

"In categories make them editable too then it will sync to the whole system and
fix every data." Only kinds of spending had Rename; a bill, a subscription or a
kind of income could only be removed and added again, which left its rows on
no list.

| What | How |
|---|---|
| Rename on every list (Settings, Categories) | Typed in place; under the box, what saving will do; Enter saves, Escape puts it back; a confirm names the rows before anything changes (`useRename` in `Settings.tsx`) |
| What follows a rename | Every row with that name, any case, live and in the bin (`renameItem`); the budget limits (`renameLimitKind`); a stop on a bill or subscription; what the assistant learned under the old name (a rename is kept as a correction, and `correctionsFrom` follows the chain); the trail ("Renamed the kind ...") |
| Onto a name already on the same list | A merge: one kind afterwards, the target's note and mark kept, the old one's taken where the target has none |
| Refused, with the reason under the box | A name on another list, an account's or credit line's name, Money Send or Transaction Fee, a kind of entry (Spending, Revenue ...) |
| Kinds on no list (new group, shown only when there are some) | Kinds the rows carry that no list has, newest first: Move into one of yours (every row renamed), or Put on the list. This is where rows saved from a card before today with a made-up kind are put right |

Checked in a browser on the sample ledger: rename, refusals, merge, Move into,
the month's spending unchanged throughout, and the phone layout at 390px with
no sideways scroll. `kindRename.test.ts` holds the rules. The sample ledger is
not kept across a reload in the local preview (only Firestore keeps rows), so
a rename there comes back as a kind on no list after a reload, which the new
group then fixes.

### 2026-10-03, last: the budget card, from the right figure and editable

The owner's screenshot: "if I received my salary worth 10k today, how can I
budget it?", then "add it", gave a card for November 2026 of PHP 13,600.00
spending and PHP 1,522.00 bills, PHP 15,122.00 against the PHP 10,000.00
salary. The app's own advice was held to the salary; the model's answer
recommended the usual month instead ("leaves room for the salary and your
wallets"), and "add it" put the model's figure on the card.

| Before | Now |
|---|---|
| "add it" after the app's advice took a different total the answer named | The app's own parts, always; the card says the answer named another figure, and what the salary covers: bills, spending, what is left to save |
| The model told only "never recompute" | Held to an income, it is told the total is the first sentence's, never the usual month's, and wallets are not part of it |
| Money "today" was planned for the next month | Money that arrives today, now or this month is budgeted in the month running |
| The card could only be applied or discarded | Change the figures: Spending and Bills and subscriptions (or the limit), every month on the card, planned again with the Budget screen's rules before Apply (`editedAsk`); the edited ask is what is kept, so a reload plans the owner's figures |

Checked in a browser: a card made from the chat, changed to PHP 6,000.00
and PHP 1,522.00, the total following the typing, applied, and the Budget
screen showing both.

### 2026-10-03, last: "fix more, find more"

| Found | Fixed |
|---|---|
| With no model, "lunch 99 cash", "coffee 120 gcash", "grab 250 gcash", "spotify 149 maya" made nothing: a sentence with no verb was read only when the word was a past item or a kind's exact name | The everyday word for one of the owner's kinds counts (`kindByWord` in `readEntry.ts`), and so does a bill or subscription by name; a question, plan or budget never does (`NOT_A_ROW`, which also stops "food budget 3000" becoming a Food row). The 281 labelled sentences read the same as before |
| "paid spotify 149 maya" was filed under plain Spending, on no list | A bill or subscription named in a sentence goes on its own list; an AI card naming one under the wrong list moves to it (`fitItem`) |
| The Budget screen said PHP 1,837.00 a day, the Dashboard PHP 1,719.66, the assistant the first: the whole plan's remainder counted the bills budget's unspent PHP 352.00 with every bill paid | One figure: a day's share of the spending track's remainder, on the Budget screen ("a day for spending"), in the assistant's context, its what-if and the offline answer (`dailyAgree.test.ts`) |
| "whats that selected?" (open item 2) | Above |

On the owner's data (the 2 October dump), the new "Kinds on no list" group
holds 15 kinds, most from 2024; two came from the AI bug: Water (1 row,
30 September) and Load (7 rows, September). Theirs to move; nothing was
changed.

### 2026-10-03, last: two periods side by side

"Show me my spending this month compared to last month" drew September
alone, by item. A comparison was read only when two months were named
("september vs august"), so "last month" became the whole window.

| Found | Fixed |
|---|---|
| "this month compared to last month" drew last month | Both periods, row by row: each item's figure now beside its figure then, on one scale, the earlier bar thin and grey with "was" beside it, and a key naming both totals (`comparedPeriods`, `buildComparison` in `charts.ts`, `chartCompare.test.ts`). A month still running is compared with the same days of the one before, as Insights does. Week and year work the same way |
| The owner: "sometimes the grammar will change so identify first" | The router now names the two periods itself (`compare`, "this month\|last month") however the sentence puts it, and the device works out their dates (`periodsSaid`). With no model, the device's own words for a comparison still draw it. "chart my spending from last month" stays one month |
| A follow-up ("by wallet", "pie") lost the comparison | The chart keeps both windows, and a follow-up naming no period of its own compares the same two |
| Every bar chart in the chat: each row sized its own figure column, so a row with a longer figure had a shorter track and its bar was not on the same scale as the rest | One set of columns for the chart (`subgrid`), so every track is the same length |
| "did I spend more this month than last month?", asked in words, gave the model a month still running and a whole month | Both periods, the same days of each, money out and in, by item, worked out on the device and put in front of the model (`comparisonWorked`); said as the answer when no model replies |
| "by wallet" after the comparison drew one bar of one month: its title names two months and "against", which read as "compare two months" | A known pair decides its own grouping, and the title is carried as dates |
| "by category" after "Spending by wallet" stayed by wallet, on any chart: the old title's "by wallet" was read first | A grouping named in the follow-up replaces the one in the title |
| "by month", "by wallets", "per category" straight after a chart, with no model, went nowhere | Read as follow-ups (`isChartFollowUp`) |

### 2026-10-03, last: Insights entries and the bottom bar

| Found | Fixed |
|---|---|
| Insights listed each entry by its kind only; reading the description meant Correct, which leaves for the Add form | The description sits under the kind, three lines at most; a longer one opens whole with a tap (`EntryWords` in `Insights.tsx`) |
| On a phone the bottom bar vanished and stayed gone: it hid while a field had focus, and Android's back gesture closes the keyboard and leaves the field focused | It follows the keyboard, read from the visible height: hidden while the keyboard is up, back the moment it closes. A tap on Save still gets its moment before the bar returns (`App.tsx`, `typing`) |

### 2026-10-03, last: Find a difference on Cash

The owner: Cash recorded PHP 760.00, really PHP 1,100.00. Replayed on the
2 October copy, the same faults came up.

| Found | Fixed |
|---|---|
| "#3854 Food on September 29 looks like #3842 Food on September 28 entered a second time": breakfast one day, lunch the next, PHP 95.00 each; and water bought on each day. The kind was read with the words, so "Food breakfast" and "Food ate lunch" shared "Food", and a day apart counted like the same day | Only the owner's own words make two rows alike, never the kind. Same day: the same kind with words alike, or the very same words. A day apart: the very same words, and never a habit (three days or more of the same thing at the same price) (`twins`, `investigateCash.test.ts`) |
| More cash than recorded was offered bank interest, with an "Add as interest" button | Cash gets a person's reasons (given, paid back, change, a spending that did not happen) and no interest |
| The owner's own earlier estimate ("Cash spending not written down at the time", PHP 3,523.00) was never looked at | With more in hand than recorded, an estimate big enough to hold the difference is the first thing offered, with the figure to lower it to (`estimate`) |
| "Difference −PHP 340.00" and "Found −PHP 120.00" in red read as money lost | Said in words: "More than recorded" or "Less than recorded", the figure plain |
| The chat added a "Random PHP 220.00" income card beside two entries that add up to the same, said "mostly clear in the picture" with no picture, and its cards read "Matched on entered twice" | No income card when the ledger itself could be the answer; a card from the difference is never "in the picture"; each reason is a sentence ("Looks like #3842 entered a second time.") |
| On a phone, "Read Saturday, October 3, 2026" on the Spending through chart did nothing that could be seen: it changed the day panel, a screen above | The panel is brought into view after a chart's button changes it (`showPanel` in `Insights.tsx`), for the spending, trend and budget charts |

### 2026-10-03, last: Edit, and a write-off without a kind

| Asked | Done |
|---|---|
| "Correct? Just say edit for universal terming" | Every button, link and sentence that changes a saved entry says Edit: the Database sheet, Insights, Find a difference, the Debt history, the Add form ("Editing #3888", "Stop editing"), a closed budget month ("Edit it, with a reason"), the chat. Rule W4 in `07-WRITING-RULES.md` and `CLAUDE.md` |
| "In write off why do I need to add a spending? ... mostly use is the logic of giving money to someone" | The kind on a write-off is optional ("What it bought"). Left empty it is filed as Money Send, money given away; it is spending either way, so no figure moves. Retained still needs its kind of income. Spec 5.6.1 updated (`entry.ts`, `kinds.ts`, `charts.ts`, `onBehalf.test.ts`) |
| (same screenshot) A write-off against a name with nothing owed only said "takes it below zero" | It says nothing is owed, that no wallet moves, and that money given now is a Transfer with no destination |
| (same screenshot) The budget note said "PHP 500.00 of this is interest" for a write-off | "PHP 500.00 written off counts as October spending" |

### 2026-10-03, last: Credit and loans, by how often each thing is done

The owner, over a settled, archived "Loan to Tita" that filled a phone screen
with two dropdowns, a green Reopen and a Remove: "fix this more suitable and
faster to use ... study how this will be used. How often will I remove an
entry or update".

| Found | Done |
|---|---|
| Every debt was a table row of four pickers and two buttons; stacked on a phone, a screen each | One line each: name, form, bill days, and what is owed on the right. Its settings open under it on a tap, one at a time (`CreditLines` in `Settings.tsx`) |
| Settled ones had to be opened to be put away | A settled one (nothing outstanding, history behind it) has Archive on its row |
| Archived ones sat among the open ones, Reopen the loudest button | Folded under "Archived (N)"; Reopen is an ordinary button inside |
| Remove was offered on everything, then refused with a message at the bottom of the page when anything was filed | Remove shows only when nothing is filed; otherwise the row says why it is archived instead |
| Archive, Reopen and a change of account each asked first | Only a change of form asks (it changes what recorded money means); the rest is undone the way it was done |
| Lending to Tita again made a second "Tita" beside the archived one | The same name on the same side is reopened with its history, in the form and the chat (`archivedNamed`, `withDebt`, `reopenPerson.test.ts`), and the form says so |
| (owner's phone, after) Maya Credit at PHP 0.00 was called "settled" and offered Archive, and the button wrapped to "Archi / ve" | A credit line is never settled: it is drawn on again. Only a loan, money on someone's behalf or a repaid bank loan is offered Archive, and the button keeps its word on one line |
| (same) An empty list read "Nothing open. Add one below if you have what is owed to me" in a large empty block | One quiet line per list: "You owe nothing right now. Add a credit line or loan below." and "Nobody owes you anything right now. Lending money in Add puts them here." |

### 2026-10-04: AI first, and fast

The owner: "make the system powerful and instant ... make sure questions and
entry it should know", "make sure ai first", with five screenshots.

| Found | Done |
|---|---|
| "I will be spending 1000 cash" was answered with an Entry line and a PHP 1,000.00 card ("spending spending") | A plan is never an entry: "im going to", "planning to", "about to", "will be spending", the Filipino future (gagastos, bibili, magbabayad) and later, tomorrow, bukas, mamaya all read as plans (`isPlan`). No card is taken from the answer to a plan, and the chat and entry models are told so (`ai.ts`) |
| Every message waited on a model to sort it, then the chat held a quicker answer up to 12 seconds for the strongest model: "looking for the best model", and "this device, because the model took too long" | Plans and plain entries ("I spent 1000 cash", `plainlyDone`) skip the sorting call (the entry is still read by the model). The chat holds 4.5 seconds, sorting 1.2; each model gets 10 seconds and the whole answer comes within 18, before the app's 25 (`CHAT_DEADLINE_MS`, `bestInOrder` deadline) |
| "How much should I use? The fare is 300" got "Yes, going by what you hold" | A "how much" question gets the figure first ("PHP 300.00 fits what you hold"); yes and no only when asked as one (`affordAsk.ts`) |
| "How much I spent in my trip in abra? show me a chart" drew all of October | A place or trip is found in the descriptions ("in abra", "to baguio"), over the whole ledger unless a window is named, titled "Spending on Abra by item". With nothing mentioning it, the chat says so rather than charting another word (`aboutOf`, `chartTopic`, `aiFirst.test.ts`) |
| A Maya receipt for load, note "Load", booked as Emergency, "what you called it the last few times" | The kind from past words goes by how often each word went with each kind: "load" is Online Buy 19 times and Emergency once, so Online Buy, and the card says "19 of your entries with these words are Online Buy" (`infer.ts`) |
| On a phone, a card sent to the form stayed "In the form" after the edit was cancelled there | The phone's chat reads what the form holds; an emptied form with no save opens the card again, as read. A save still marks it added (`formDraftNow`, the release effect in `AskPanel.tsx`) |
| "allow copy paste ... I screenshot then I can attach it directly" | A Paste picture button in the phone's chat box reads a copied screenshot from the clipboard; a pasted picture is taken from the clipboard's items as well as its files |

The 275 labelled sentences of the owner's read exactly as before.

### 2026-10-04: the AI and the charts, one answer

The owner: "Fix the ai and charting like make sure they are align like if
the result need to show charts or pie or tend etc show them but be careful
ai should know properly and show the right things. Make sure everything ai
can do and charts can do all." Then, beside a screenshot of the Claude app:
"Fix the chat area ui ... it shows the photo in clipboard and in my system
it didn't ... I dont want that paste icon thats just clutter".

| Found | Done |
|---|---|
| The model said only whether a message was a chart; what kind, split by what and of which money came from the words alone | Routing returns `draw` (shape, by, money). The device's own reading of plain words wins (a "pie" typed is a pie) and the model fills what the words leave open; a model's budget, balance or debt stands only when the words are about one (`chartAsk.ts`: `hintFrom`, `localHint`, `mergeHint`, `inWords`) |
| "where did my money go this month?", "what did I spend most on", "is my food going up?" were answered in words with nothing drawn | A question a chart answers better gets one beside the words: a pie for where it went, bars for what cost most, a line for going up or down, both periods for a comparison. Never for one figure, a yes or no, a list of questions, or a question about the chart on screen (`chartHelps`, `besideFor`) |
| The model's words and the chart could disagree ("your description and the chart doesnt match", 5 September) | The model is handed the drawn chart's own figures as worked text (`chartsWorked`); a chart request that also asks something ("how much ... show me a chart") gets the chart and then the answer from it |
| "show me my budget vs actual" drew spending by item; balances and what is owed could not be drawn at all | Three more charts: spending against the budget by month (the Dashboard's figures), one month day by day against a steady pace (the Insights burn), a balance per account or over time (the balances every screen shows), and what is owed over time (rule 5.6.2, interest paid left out). "chart my maya credit" is a chart now; "check my maya credit draw by draw" is still a question |
| Every chart was a picture with a total and nothing said | Each chart says itself in a sentence under its title, worked out from its rows: the largest part and its share, the high, the low and the average of a trend, how two periods differ, which months broke the budget. A period still running is called that and kept out of the high, low and average (`chartReading`, `running`) |
| "Treat by month" ran straight from May to July; "how did august compare with july" drew a line between two points | A month, week or year with nothing in it is a zero on the line, and said ("Nothing in June 2026"); two named months are two bars |
| "I want chart and trend at the same time" charted entries mentioning "same"; "all of my transaction" charted "Transaction" | Words about the asking are never the topic (`ASKING_WORDS`) |
| The keyboard offered a copied screenshot over the Claude app's box and nothing over ours | Chrome tells a phone keyboard a box takes pictures only when the box is rich text; a textarea is text only. The chat box is now a rich box kept plain (`PlainBox.tsx`): the keyboard's Paste chip and long-press Paste both hand the picture in as a paste, which attaches it. Formatting never gets in; Enter sends, Shift+Enter is a new line |
| The box was crowded: the words wrapped to two lines beside +, Paste and the camera | One rounded box: the words across the whole width, + and the camera under them, Send inside at the right. The Paste picture button is gone |

`chartAsk.test.ts` pins every rule with invented figures, including that a
balance chart ends at `walletBalance` and an owed chart at `outstandingOf`.
Of the owner's 618 messages, five would now get a chart beside the answer,
each a split or a ranking.

### 2026-10-04: withdrawals on the statements, and short notes

The owner, under a September account statement whose withdrawals showed
blank columns: "in withdrawal add how muc i spent like transactions fee,
how much i withdraw. Be careful like you know how the logic of transferring
is. Make sure everything works fine update all statement". Then, of the
notes under the totals: "I dont like to have so very long text explanation.
Mkae it ver short and clean".

| Found | Done |
|---|---|
| A transfer between two of the owner's own accounts showed nothing on the account statement, so a withdrawal said neither what was taken out nor its fee | Every transfer row says it under its description, on screen and in the PDF: "Withdrew ₱2,000.00, fee ₱15.00", "Moved ₱1,000.00, no fee", "Sent ₱5,000.00, fee ₱10.00"; the expense sheet says "Fee on ₱2,000.00 withdrawn" (`SheetLine.detail`). The columns are unchanged and correct: on a sheet of everything held, money between your own accounts is still yours, so only the fee is money out; on one wallet's sheet the whole figure leaves it |
| Four September withdrawals (₱1,018.00 twice, ₱516.00, ₱218.00) were saved before withdrawal cards split the machine's fee, with the fee inside the figure: no fee was spending and Cash was recorded ₱70.00 higher than it was | Never changed by the app. The statement says "fee not saved" on each, and one note names the days; Find a difference on Cash names them as the likely cause, with Edit on each (`feeInside`, clue `fee-inside`); the Add form offers "Split: ₱1,000.00 cash + ₱18.00 fee" on such a withdrawal, one tap |
| Statement notes ran to paragraphs | One short line each: "Cash withdrawn: ₱9,200.00 (8), fees ₱67.00. A transfer counts only its fee.", "No fee saved on 4 withdrawals (Sep 18, Sep 20, Sep 24, Sep 26). Edit each: cash in Amount, the rest in Fee.", "Money Send: ₱5,571.00 (2), spending in full, not only the fee.", "Interest and fees paid: ₱1,071.36, not part of what is owed." The notes are on the Statements screen now as well as in the PDF |

Every statement type was checked on the owner's September: the account and
wallet sheets close at what the wallets hold, the revenue and expense sheets
total `incomeOf` and `costOf`, the debt sheets close at `outstandingOf`.

### 2026-10-04: a budget plan, AI first

The owner, with a screenshot: "I plan to adjusted my budget this month, can
you set a plan? Like based on my income and spending" was answered by the
device, "What should the budget be for October 2026?". Then: "Ai first. Fix
this".

| Found | Done |
|---|---|
| A plan, an adjustment with no figure, or a budget "based on my income" was not read as asking for advice, so it fell to the budget command with no figure, which asks | Read as advice (`asksBudgetAdvice`): the model answers with the app's recommendation for the month named ("this month" is October) |
| "based on my income" had nothing to hold the budget to | Held to the income they usually receive, the median month over the months the spending is read from (`BY_INCOME`, `typicalIncome`) |
| A recommendation needed "add it" before there was anything to apply | Asked to set or adjust one, the card comes with the answer, the app's own two parts, editable before Apply; asked only what it should be, it is still "add it" (`SETS_BUDGET`, `ASKS_ONLY`, `offerAdvisedBudget`) |
| Any budget request with no figure got the device's question | With a model available it gets the recommendation and the card instead; the question is only for when no model can answer |

### 2026-10-04: "I said 250 not 450"

The owner asked whether PHP 250.00 a week would work ("2 classes means 250
per week then I'll use 200 for gas and other too"). The model took PHP
450.00 and worked out PHP 64.29 a day and PHP 1,030.95 itself, which the app
flagged as not its figures. "I said 250 not 450" then became a Spending card
of PHP 250.00, described "said not".

| Found | Done |
|---|---|
| A correction of what the answer understood, with no card on screen, was read as an entry | "I said 250 not 450", "I meant 250", "250 not 450" go back to the model as the same question with the figure put right; never a row (`correctsWhatWasSaid`). It needs a figure and no command word, so "I said delete it" and "I mean subscription" are read as before (none of the owner's 733 messages changes) |
| A plan said by the week or the day was the model's arithmetic | The app sets each figure the plan names, and their sum, beside what is left of the spending budget: a day, a week, over the days left, and whether it fits or by how much it does not (`planRate.ts`). A correction takes its period from the question before it, and a figure after "not" is left out |

### 2026-10-04: scenario tests

The owner: "Run more test and fix more, implement more", then "Use
scenario base testing". `app/src/domain/monthScenarios.test.ts` tells
fourteen stories (an allowance month, a credit line, money held for an
aunt, a withdrawal with its fee inside, a week run from the chat, an entry
dated ahead, and others). After every step `screensAgree` checks that the
sidebar, each statement, the balance chart, Find a difference, the month
total, the budget, the budget chart, the AI's figures and the debt screens
all say the same thing. The same story was then run in the app at phone
width (390px): an entry, a withdrawal with its fee, a plan, a delete and a
restore by describing them, a balance chart, a balance told, a statement.

| Found | Done |
|---|---|
| "paid my wifi bill 999 from maya" was Online Buy | Two word boundaries in the bill matcher had been saved as backspace characters. Now Bills, Globe at Home Wifi (`recurringIn`) |
| A chart of "Maya Bank (Personal savings)" drew Maya | A name ending in a bracket never matched. It now matches in full, without its brackets ("maya bank"), or by the words inside them ("personal savings") |
| The Send button said Log for "I will be spending 1000 cash tomorrow" | `detectIntent` now knows the same plans `isQuestion` does. No card was ever made; the label was wrong |
| A saved card still said "This puts Maya at −₱5,954.00. Save anyway?" | Problems and warnings show only while a card is open. A saved card was being checked against a ledger that already held it |
| A balance chart, and Find a difference, left out entries dated after today while the sidebar counts them | Read to today, the last point counts them and the reading says "Counts 5 entries dated after today." Told "my cash balance is X" today, the answer starts from the sidebar's figure, and an early entry is named as a cause only when it fits inside the difference |
| The budget chart for this month left out spending entered for later in the month | Counted on the last day, as the month total counts it |
| "One entry add up to exactly" | "One entry adds up to exactly" |

### 2026-10-04: e-wallet receipts

The owner sent a GCash "Sent via GCash" receipt: "Make sure it knows this
type of receipt etc. More powerful". Read on the device, it has one figure
that is money and four that look like it: the reference number, the phone
number (its "+" read as a peso sign, "₱63"), the carbon banner ("279g"
read as "2799") and the date. The masked name is not read at all.

`domain/walletReceipt.ts` reads an e-wallet's own confirmation screen
(GCash, Maya, GoTyme, ShopeePay, GrabPay, Coins.ph): money sent, a bank
transfer, a bill, load, a QR or shop payment, money received, and the text
message form. It reads the amount, the fee, the total, the day, the time,
the reference and who it went to, only from figures printed with two
decimals, and names the rest as not money.

| Part | What it does |
|---|---|
| Note to the model | Goes with the picture's text: what kind of screen it is, the one proposal it makes, and what is not an amount (`walletReceiptNote`) |
| Check on the answer | `checkWalletReceipts`: the amount, fee, day and wallet are the screen's; a card made of the phone, reference or carbon figure is put back or dropped. Money sent to a person is a Transfer with no destination (Money Send), unless the owner's words name what it paid for, or it went to one of their own accounts. A bill is filed as their bill of that biller, load as their load item, money received is never spending |
| One picture, one request | Each request is checked only against the screen in its own picture, so a ₱10.00 shop receipt beside it is never taken for this screen's "10" (October) |
| No model | `onDeviceWhenUnread`: when no model answers, or one leaves the screen out, the device's own reading makes the card and says "read on this device" |
| Model instruction | One line in the extract instructions on these screens, for when the model sees the picture itself |

Tested with invented receipts of every kind (`walletReceipt.test.ts`,
`walletReceiptRead.test.ts`), and in the app at phone width with the
owner's picture and no model: one card, Transfer from Gcash to someone
else, ₱99.00, 4 October 2026, its time and reference in the notes, and
Gcash down ₱99.00 once added. Not tested with a live model.

### 2026-10-04: statements say their exact days

"Give me account statement all 2022 to today" made a PDF headed "January
2022 to October 2026" with a balance brought forward on Jan 1, 2022, four
months before the first entry, and October four days old. The owner: "Can
you be specific? Like look it say January like make sure its align." Then
"What do you think about that statement?" was offered a new statement for
2026: "Fix the reasoning".

| Found | Done |
|---|---|
| A statement started before the first entry and ran past today | `fitPeriod` (statementSheet.ts): it starts at the month of the first entry it covers and ends today, and the period is said to the day: "May 1, 2022 to October 4, 2026". The chat, the PDF, the CSV and the Statements screen all use it. Whole past months are still said as months ("January to December 2023") |
| The chat said only "a statement for January 2022 to October 2026, so far" | `statementWords`: which statement, the days, "(today)", the number of entries, brought forward, money in, money out, the balance at the end, and where it starts and why. The card shows the days and the count, and keeps them, so a file saved later is the one described |
| "Date issued 4 October 2026" beside "May 1, 2022" | Month first everywhere: "October 4, 2026, 5:18 PM" |
| A question about a statement made a new one | `asksAboutAFile`: pointing back ("that statement", "my statement", "the PDF") and asking (what, is it right, explain, check) is a question. It goes to the model with that statement's figures (`statementBrief`): the days, totals, each year, the three largest each way and its notes. Asking for it again (give, send, export, again) still makes the file. None of the owner's 13 earlier file requests changes |
### 2026-10-05: asking, adding or looking, and the receipts to train on

Daily use, five reports. "MY BALANCE NOW IN MAYA IS 6000" came back with a
card saving the difference as unknown spending; "fix this it should know if
I am asking or adding entry or investigation etc". The savings warning
called Extra Cash, a reserve, "a saving". "Transfer extra cash to cash" was
asked how much; "Check my balance and transfer it" went to the chat, which
said it could not transfer and wrote a second card; "That's yesterday" was
told "I could not find a figure in that". "Thats apply today or this week?
A gas can last a week or 4 days" became a Parking card and a Gas card with
no amount. "Just usual not too deep, safe to spend" opened a budget change
for May 2027. And fourteen receipts: "Training receipts. Dont add this just
train". Nothing of the owner's was written or added; the receipt texts in
the tests are invented in the same layouts.

| Found | Done |
|---|---|
| A told balance made a card for the difference | The difference is explained and nothing is offered. The guess is held, and becomes a card only when the next message asks: "add it", or what it was, "it was food" (`differenceFollowUp.ts`). The answer ends "Nothing is added. Say what the ₱2,040.56 was ..." |
| "Extra Cash is savings" | Settings' own word: "a reserve, set aside", "a goal", or savings (`accountKinds` on the reference lists) |
| "How much?" of a transfer had no answer for all of it | "all of it", "everything", "lahat", "check my balance and transfer it" is what the account holds less the fee, and an "All of it (₱1,000.00)" button sits under the question (`saysAllOfIt`, `allOf`) |
| "That's yesterday" while it asked how much | The entry takes the change and the same question is asked again |
| The chat's card for the same transfer left the question open | A card for the entry a question waits on answers it; "I cannot transfer it" is taken out of answers like "I cannot add it" |
| "Transfer maya to cash" with no figure was not an entry without a model | The account before "to" is the source; a transfer between two named accounts asks how much |
| A question mark mid-message, then context, was cut into empty cards | `askedThenSaid`: a question followed by more words with no money in them (a count of days or litres is not money) is a question. The splitter offers no piece that asks or has no figure and no "paid" word |
| The router's "budget" alone opened a budget change | Only with words that name the budget or say to set something; "may" the verb is never the month May |
| "advice me", "help me budget", "I need help" were not questions | They are |
| A bill, a fee assessment and two checkout screens read as purchases | `notPaid.ts`: "not a receipt", "please pay on or before", "statement of account", an assessment's amount due, "Place Order". The owner is told what it is, what it asks for and by when, and nothing is added; "paid it from cash" or "placed it, paid with gcash" next makes its card (bill on the bills list, checkout as an online purchase, fees as school). A card a model made on one anyway is held back |
| A school's official receipt read 2,600.00 in one reading; the LTO total was in no reading | `amountInWords`: "Four Hundred Thirty One And 06/100 Pesos Only" is checked against the figures, and "...thousand only" says whole thousands. A receipt that is only a breakdown is the sum of its lines. "MODE OF PAYMENT: CASH" is cash |
| DEFERRED INCOME-TUITION on a receipt | The model is told a receipt is money paid out whatever its lines say; a fee breakdown is one row; a renewal or due date is not the day paid; RECEIVED FROM another person they pay for is On behalf; 0.00 lines are free items; two tickets of one purchase are one row |
| A GCash bank transfer's recipient was read from "Receipt sent to" (an e-mail) | The account name, and an address is never a recipient |

What the phone's reader could not read at all: the dessert receipt under
pink light and the faded supermarket tape. Those go to the vision model,
which has the new rules. The cinema tickets were unreadable on the device too.

### 2026-10-05: the paper reader is trained, not written

"Dont hard code those please train them." The kind of paper a picture is
(receipt, card slip, e-wallet or bank confirmation, ATM slip, account
history, bill, assessment of fees, checkout, quotation) now comes from a
naive Bayes reader trained on examples (`paperKind.ts`), not from rules
written for particular papers.

| Part | What it does |
|---|---|
| `paperSeed.ts` | Starter examples, invented in many layouts, none the owner's. Adding one teaches every reading after it |
| `paperMemory.ts` | The owner's own examples, kept in their `ai` record as `accepted` events with field `paper` (reading masked in `text`, filing in `entry`). The existing rules allow this shape, so nothing was deployed. Read whole with one equality query (`aiLogStore.papers`). Counted three times over the starter set |
| Teach mode | Pictures sent with "train", "don't add", "for training": each card has a kind picker and **Teach this** in place of Add to ledger, asks no questions, stays out of the batch bar, and comes back a training card after a refresh. A bill or checkout gets a card too |
| Learning from use | Every picture card added teaches: this paper, filed this way, paid |
| At read time | The model is told the trained kind and how sure, and the nearest taught paper with how it was filed (`taughtNote`). A paper that reads like a taught one is that kind; a new one is held back as unpaid only at 85% or more (`SURE_UNPAID`), because holding back a paid receipt loses an entry. The amount is read off the line the owner's example carried it on. A single picture like a taught one gets that filing where the model left a field open (`fileAsTaught`) |
| No model | A shop receipt the device is sure of makes its own card |

Measured on the owner's 14 readings (kept out of the repo): 13 right on
the starter set alone; the miss is the dessert receipt the phone cannot
read, at 0.35, below anything acted on. Leave-one-out on the starter set
is 61 of 68, and no paid paper is ever read as unpaid (asserted in
`paperTraining.test.ts`).

---

## 6. What the owner has to do

1. **Publish the rules whenever `firestore.rules` changes.** The owner
   published the 28 September rules that day. Firestore does not read the
   file from GitHub.
   Firebase console, Firestore Database, Rules, paste the whole of
   `firestore.rules`, Publish. Or
   `npx firebase-tools deploy --only firestore:rules --project financial-system-c2997`.
   Until then the previous rules are the ones running.
2. **Reload the app on the phone** after a deploy: tap Reload on the "newer
   version" notice, or leave the app for a minute and come back.
3. **Rotate the AI keys** if that has not been done since they were exposed
   (CLAUDE.md §2).
4. **Gemini (30 September).** Make a free key at Google AI Studio
   (aistudio.google.com, Get API key), then in Cloudflare: Workers & Pages,
   the project, Settings, Variables and Secrets, Add, type Secret, name
   `GEMINI_API_KEY`, the key as its value, for Production. Never paste the
   key anywhere else.
5. **Workers AI (30 September).** Same project, Settings, Bindings, Add,
   Workers AI, variable name `AI`, for Production. It takes no key.
6. **Redeploy after 4 and 5:** Deployments, the latest, Retry deployment.
   Secrets and bindings reach the function only on a new deployment. Then
   publish the rules (1), so Settings can save Gemini or Workers AI as the
   provider.
   Done on 2 October, night: the owner set up 4 and 5 and redeployed.
   Settings, AI, under Model, says which providers are set up.

---

## 7. Open, in order of what matters

1. **Nothing above was seen working against a live model.** This includes
   the 28 September night round: whether the free models use the separate
   `conversation` field as well as they used the appended one is for the
   next dump to show. The container
   cannot reach the providers or the deployed site, so every fix is proved
   by tests and by the device path on a local copy. The next coderview dump
   is the check: read "Thrown away, and never corrected" and "Said, and
   nothing happened" first (`12-DEBUGGING-FROM-THE-RECORD.md` §1 says how).
2. ~~"whats that selected?"~~ Done 3 October 2026: a tapped part of any
   chart (the chat's own, and the Dashboard's and Insights' line and bar
   charts) is kept for fifteen minutes (`src/chartPick.ts`) and sent with a
   question that points at it (`domain/chartPick.ts`).
3. **The real due date for Maya Credit.** The app now says what "both the
   6th" means; whether Maya's own due date is another day only its app can
   say. If it is, the owner sets Payment due to it.
4. **A receipt's printed date** is often lost: the date line sits at the
   curled bottom of the photo and the device does not read it. The card is
   then dated today, which is right for a receipt photographed the same day
   and wrong otherwise. The card says where its date came from only when it
   was read.
5. **A receipt with several purchases for different people or budgets** is
   read as one purchase unless the owner asks for the items separately.
6. **Remove `?coderview`** once the assistant's faults it shows are fixed:
   six steps in `11-CODERVIEW-IS-TEMPORARY.md`, including the rules block and
   a redeploy.
7. **Archiving a transaction** needs the owner's decision first
   (`10-AI-ASSISTANT-STATUS.md` §3.2).
8. **Learning from corrections is narrow on purpose** (same file, §3.1).
9. **Personal details in a public repository.** Test data and comments name
   places from the owner's own bank history (an ATM's location, a college,
   the province) and the spec names the owner. Swapping them for invented
   ones is safe for the tests; the old commits keep them either way. Ask the
   owner before doing it.
10. **The next dump** should show "Add N ready" cards staying added after a
    reload, and a daily interest screenshot read one row a day. Read the
    interest cards' dates first.

---

## 8. How the owner likes to be answered

Plainly, without jargon, and short. Say what changed in their terms (what
they will see on the phone), what was not checked, and whether it is pushed,
with the hash from the `CLAUDE.md` §6 check. When a change needs them to do
something (publish rules, reload), say exactly where to tap. No em dash.
