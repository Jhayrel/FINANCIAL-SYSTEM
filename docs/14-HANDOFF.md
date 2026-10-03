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
2. **"whats that selected?"** about a pie slice the owner had tapped: the
   chat is not told which slice is picked. It needs the chart's picked row
   passed up from `components/charts.tsx` into the question's context.
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
