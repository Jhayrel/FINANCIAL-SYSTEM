# Handoff: everything a new session needs

**Written 2026-09-28, at commit `e595864` plus this file.** For a fresh Claude
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
as Cloudflare environment secrets (`GROQ_API_KEY`, `OPENROUTER_API_KEY`;
names only, never values). The phone is the primary target. The owner
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

Verified against the emulator with a fake model that reports what it was
sent: every question reached the model with the right worked figures
(affordability, a December budget, a sum, the standing budget for "why
that number?"), the memory block and the outline; "set it" made the
December card in its two parts; "remember ..." made no card; with every
model failing, the device's figures were said and marked why. Stop and
Clear drop answers that land after them.

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

---

## 8. How the owner likes to be answered

Plainly, without jargon, and short. Say what changed in their terms (what
they will see on the phone), what was not checked, and whether it is pushed,
with the hash from the `CLAUDE.md` §6 check. When a change needs them to do
something (publish rules, reload), say exactly where to tap. No em dash.
