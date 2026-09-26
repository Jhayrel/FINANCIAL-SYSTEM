# The assistant: what it does, and what is left

**Status at commit `580e455`.** 957 tests, typecheck and build clean.

This is the handover for the AI work. It is written so someone picking this
up cold, including a fresh agent session, can tell what is finished, what is
half-finished, and which mistakes have already been made and must not be made
again.

---

## 1. The shape of it

### Where it lives (since 2026-09-15)

One panel, [`AskPanel.tsx`](../app/src/features/AskPanel.tsx), shown in one of
three places and never two at once:

| Device | Where |
|---|---|
| Computer, Add screen | Beside the form, as before |
| Computer, any other screen | A round AI button at the bottom right opens it as a floating chat |
| Phone or tablet | Its own AI tab in the bottom bar. The Add form has no chat beside it |

All three save through [`useProposalSink.ts`](../app/src/features/useProposalSink.ts),
so a row added from the floating chat passes exactly the checks one added
beside the form does. "Edit first" from outside the Add screen opens the Add
screen with the card in it.

**Off means gone.** [`aiSurface.ts`](../app/src/domain/aiSurface.ts) decides
whether an AI surface exists. With AI switched off in Settings there is no
chat, no floating button, no AI tab and no AI card on the Dashboard or
Insights, and the Settings AI tab shows only the switch. The owner asked for
this: surfaces that stayed on screen answering from the device read as the AI
still being on.

**A failure says so.** When the model cannot answer, every surface shows
`MODEL_DOWN` in [`aiClient.ts`](../app/src/data/aiClient.ts), "The AI model is
not working. Please try again.", with the reason underneath. It used to write
a summary of the month from `domain/aiOffline.ts` instead, which answered a
different question and never said the AI had failed. Failures are no longer
cached, so a busy minute does not keep reporting itself.

### What it does

It does five jobs:

| Job | Where |
|---|---|
| Answer questions about the figures | `chat` task, `domain/aiChatContext.ts` |
| Read a sentence into a proposed row | `extract` task, `domain/readEntry.ts` |
| Read a photo or file into proposed rows | read on the device (`data/ocr.ts`), then the `extract` task as text; images only as the fallback |
| Draw a chart | `domain/charts.ts`, no model involved |
| Find a row to bin or restore | `domain/recall.ts` |

**Pictures are read on the device first** (26 September 2026). Read, then
analyse, then check, in the owner's order: the device reads the picture's text
twice (as it is, and with the contrast raised), in about a second on a laptop,
and the fast text models turn that text into rows. The free vision models are
few, slow and rationed, and they were failing the owner's wallet screenshots
with "nothing readable" and 429s. A picture with too little text still goes to
a vision model, and so do all of them if the text finds nothing, so reading on
the device can only add a faster answer. The reader (tesseract.js, Apache 2.0)
and its English data are copied from `node_modules` into the build under
`/ocr/v7/` by `tools/ocrAssets.ts` and served from this site: no CDN, no
third-party script. When it works, the picture never leaves the device.

**The safety model has not changed and must not.** The assistant returns text.
It holds no Firestore handle. Every row reaches the ledger through
`checkDraft` and the Add button, exactly as a typed one does. A proposal is a
filled-in form that has not been submitted.

### The model decides what a message wants

`route` task, called from `send()`. It gets the last few turns **and what is
on screen**, and returns one of: `entry`, `question`, `chart`, `correction`,
`answer`, `delete`, `restore`, `editEntry`, `chat`.

This replaced a pile of regular expressions that were wrong constantly.
`domain/intent.ts`, `domain/recall.ts` and `isChartFollowUp` still exist and
still run, but **only when no model can be reached**. Do not put routing logic
back into them.

---

## 2. Done

### Reading and entering
- Sentences into rows, all four flows, with the model reading and the owner's
  lists constraining it
- Photos and files (JPEG, PNG, WebP, CSV, TXT, MD, JSON, TSV), up to five,
  downscaled and re-encoded on the device before sending
- Several entries in one message (Shift+Enter, one card per line)
- Missing details asked for one at a time, and the answer completes the row
- `"the usual"` answered from the commonest past amount for that item
- Amounts as `100k`, `2.5k`, `1m`, `1,234.56`, `PHP 250`, `₱250`
- Fees read separately from amounts (`"withdraw 5000 fee 18"`)
- Bills and Subscriptions keep their own categories
- Items only ever come from Settings; a genuinely new one is capitalised and
  the card says it will add a new type

### The conversation
- Answers with real structure: bold and bullets, parsed and rendered as
  elements, never as raw markup
- Follow-ups routed by the model, including corrections to the card on screen
- Editing a card in chat: amount, wallet, item, date, fee, description
- The old card is removed and the corrected one appears at the bottom
- Charts: by item, month, wallet or category, over a named month, the year, or
  everything. Every total pinned to `totalsFor` by `costOf.test.ts`
- Delete and restore by describing a row, with candidates shown and a button
  each. Never acts by itself
- Debt finished in the chat: the credit line and the effect are offered as a
  choice rather than guessed at, and picking the effect moves the wallet to
  the side that effect implies. `debtChat.test.ts`
- Stop button, which actually aborts the request
- Three retries with a growing pause before giving up, then the providers'
  own reasons

### Storage and records
- `users/{uid}/chat`: the conversation, append only, redacted before write
- `users/{uid}/activity`: what happened to the money, append only
- `users/{uid}/ai`: what happened to the assistant, append only.
  **Photos are described, never stored:** filename, kind, size, and what was
  read out of it. The rule rejects a `data:` URL outright
- `entrySource` on every transaction
- Corrections are learned: told once that a phrase means Food, it uses Food
- Settings shows the history, the counts, and what it has learned

### Interface
- The Add row is one fixed frame; the form scrolls inside it
- Attachments are 44px squares, click for full screen, Escape closes
- A half-typed entry survives navigation and reload (`sessionStorage`)
- "Clear this view" marks a point rather than deleting the record
- Rows select on the Database screen and in the bin, and go to the bin or come
  back together, as one move with one record of it. A round trip through the
  bin is asserted byte-identical in `bulkBin.test.ts`
- Edit and Delete exist on the phone rows, at 44px
- Three moving dots while working, stopped under `prefers-reduced-motion`

---

## 3. Not done

Everything that was on this list has since been built. What follows is what
is deliberately left, and the one thing that needs the owner rather than a
decision from whoever picks this up.

### 3.1 Learning is conservative, on purpose
A correction is keyed on the whole sentence that produced it, so it fires on
repeated phrasings rather than single novel words. Keying it on one word
requires knowing *which* word was the item, and getting that wrong writes bad
data into the thing that decides future entries. Left narrow deliberately.

### 3.2 Archiving a transaction needs a decision, not code
The Database screen can now bin a selection and the bin can restore one, but
there is still no *archive*. That is not an oversight. A transaction has no
archived state in the data model, and adding one asks a question only the
owner can answer: does an archived row still count towards the month, the
year, and the balances?

Both answers are defensible and they are different features. If it still
counts, archive is a view filter and costs almost nothing. If it does not, it
is a second kind of soft delete, and every total in the app needs to say which
one it means. Rule: propose, do not default. So it is proposed here.

Accounts and credit lines already archive (`archived` on `Debt`), and there
the answer is settled: an archived account is still yours, and its money still
counts. That is the precedent, and it points at the first answer.

### 3.3 Done since this document was written
Kept as a list because the reasoning behind each is in the commit, and
because a handover that only says what is left reads as though nothing
happened.

| Was | Commit |
|---|---|
| Only bar charts existed. Pie, donut, line and trend asked for repeatedly | `00411c2` |
| `editEntry` landed on the delete finder instead of editing | `bc45ef6` |
| The AI settings lists grew without bound | `99e2177` |
| Debt could not be finished in the chat | `95dfcf6` |
| No bulk selection, no bulk bin, no bulk restore | `580e455` |

## 4. Mistakes already made, so they are not made twice

These all shipped and were caught. The tests named here exist to stop them
coming back.

| What happened | Why | Pinned by |
|---|---|---|
| `"I earnd 100k"` read as PHP 100.00 | No k/m suffix parsing. Out by a factor of a thousand, and the row looks ordinary | `scenarios.test.ts` |
| `"clubshirt"` booked as Gas | A word rule matched "cash" in fuel descriptions | `infer.test.ts` |
| Chart over-counted 2026 by PHP 13,128 | The chart had its own definition of spending | `costOf.test.ts` |
| Money Send never saved | `sentOut` was component state, invisible to `checkDraft` | `entry.test.ts` |
| Two binned rows shared id `d120` | Ids derived from a reused record number; one could never be restored | `fixtures/ids.test.ts` |
| Learned "gas is Food" | The correction was keyed on the guess, not the sentence | `aiLog.test.ts` |
| Chat died when Insights was switched off | It read the wrong feature flag | |
| `phpFigure` given centavos | Printed PHP 550,000.00 for five and a half thousand | `aiChatContext.test.ts` |
| Eight rows, eight identical questions | A batch queued one pending question per row | |
| The phone Database screen drew the desktop table on top of the phone list | `.fms-db .fms-tablewrap` is two classes, the rule hiding it is one, and a media query adds no specificity | |
| A selected row looked like income | Selection took `--brand-100`, a shade off `--flow-revenue-bg` in the dark theme | |
| A debt card's chosen effect was brand green | Same mistake, on a card about borrowing. It is amber now, rule D3 | |

### Two traps in the tooling

**Backslashes.** Writing files through a Bash heredoc silently eats them:
`\b` becomes a literal backspace byte (0x08), and a regex full of those
matches nothing while looking correct. It happened four times. Use the
Write/Edit tools for anything containing a regex, and audit with:

```bash
python -c "import io,glob; print([p for p in glob.glob('src/**/*.ts',recursive=True) if any(ord(c)<32 and c not in '\n\r\t' for c in io.open(p,encoding='utf-8').read())])"
```

**Template literals.** Inside backticks, `\b` is the backspace escape. A regex
built with `` new RegExp(`\b${x}\b`) `` matches a control character. It needs
`\\b`.

---

## 5. Before deploying

```bash
npx firebase deploy --only firestore:rules --project financial-system-c2997
```

Three collections depend on rules: `activity`, `chat`, `ai`. Without them
those writes are denied and the Settings panels show a permissions error. The
ledger is unaffected either way, by design.

Cloudflare Pages builds `main` automatically. `tsc`, `vitest` and
`vite build` must all pass first (`docs/09-AUTO-PUSH.md`).

---

## 6. Where things live

| File | What |
|---|---|
| `functions/api/ai.ts` | Every task: `chat`, `extract`, `route`, `classify`, `summary`, `alerts`, `patterns`, `describe`, `categorise`. Keys, model discovery, the owner gate |
| `src/data/aiClient.ts` | Every call out, retries, redaction |
| `src/domain/aiChatContext.ts` | What the chat is allowed to see |
| `src/domain/readEntry.ts` | Reading a sentence, offline fallback |
| `src/domain/infer.ts` | Filling blanks from the ledger |
| `src/domain/capture.ts` | Questions, replies, corrections, item matching |
| `src/domain/charts.ts` | Chart data. No model |
| `src/domain/recall.ts` | Finding a row to bin or restore |
| `src/domain/aiLog.ts` | What the assistant did, and the learning |
| `src/features/AskPanel.tsx` | The panel |
| `firestore.rules` | Six collections, all append-only except transactions and settings |
