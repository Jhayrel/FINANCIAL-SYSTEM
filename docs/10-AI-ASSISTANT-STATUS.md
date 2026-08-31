# The assistant: what it does, and what is left

**Status at commit `03461e3`.** 935 tests, typecheck and build clean.

This is the handover for the AI work. It is written so someone picking this
up cold, including a fresh agent session, can tell what is finished, what is
half-finished, and which mistakes have already been made and must not be made
again.

---

## 1. The shape of it

The assistant lives in the panel beside the Add form
([`AskPanel.tsx`](../app/src/features/AskPanel.tsx)). It does five jobs:

| Job | Where |
|---|---|
| Answer questions about the figures | `chat` task, `domain/aiChatContext.ts` |
| Read a sentence into a proposed row | `extract` task, `domain/readEntry.ts` |
| Read a photo or file into proposed rows | `extract` task with images |
| Draw a chart | `domain/charts.ts`, no model involved |
| Find a row to bin or restore | `domain/recall.ts` |

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
- Three moving dots while working, stopped under `prefers-reduced-motion`

---

## 3. Not done

In the order I would do them.

### 3.1 Chart types
Only horizontal bars exist. Asked for repeatedly: **pie, donut, line, trend**.

The reason bars came first is real and worth keeping in mind: the panel is
280px, and a pie with twelve slices needs a legend that does not fit. A pie is
right for four or five slices, so it should be offered when the data suits it
rather than always. Flow colour means direction of money (rule D3), so slices
cannot be told apart by hue: use one hue at varying lightness.

`domain/charts.ts` already produces `rows` with `share`, which is all a pie or
a line needs. The work is a renderer and a way to choose.

### 3.2 Editing a saved entry from chat
`route` returns `editEntry` and it currently lands on the delete/restore
finder. It should find the row, show it, and load it into the form for
editing, reusing `sink.use`.

### 3.3 Deletion and archiving from the Database screen
The Database screen has delete with confirmation. There is no archive, and no
bulk selection. `handleDelete` and `handleRestore` in `App.tsx` are the seams.

### 3.4 Debt
The chat refuses to guess at debt and opens the Debt form with the amount,
wallet and date filled in. That is deliberate and correct: the credit line and
the effect (draw, repay, interest, write-off) are not in a sentence, and
reading either wrong misfiles borrowing as income. What is missing is the
assistant offering the *choice* of credit line and effect as buttons, so the
whole thing can be finished without leaving the chat.

### 3.5 The AI settings page
"What it has learned" and "History" both grow without bound. They need capping
and collapsing before they become unreadable.

### 3.6 Learning is conservative
A correction is keyed on the whole sentence that produced it, so it fires on
repeated phrasings rather than single novel words. Keying it on one word
requires knowing *which* word was the item, and getting that wrong writes bad
data. Left deliberately narrow.

---

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
