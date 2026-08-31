# AI Chatbot for the Financial Management System

**Design, behaviour, and build guide.**

This document describes how to add an AI assistant to your existing app (React + TypeScript + Firebase Firestore, deployed on Cloudflare Pages, AI proxied through the `/api/ai` Pages Function using free Groq and OpenRouter models).

It is written to match your existing architecture and your repository rules. In particular it follows the no em dash rule in `docs/07-WRITING-RULES.md`, keeps money as integer centavos, keeps provider keys server side only, and never lets the model write to the database.

The assistant does three jobs:

1. **Ask.** Answer questions about your finances (read only).
2. **Capture from text.** Turn a sentence like "I spent 100 cash on food" into a proposed ledger row you approve before it is saved.
3. **Capture from images.** Read screenshots of bank transactions and photos of paper receipts, then propose one or more rows you approve before they are saved.

Everything the assistant produces is a **proposal**. It never writes. You press a button, and the row is saved through the exact same validated path your manual entry form already uses.

---

## 0. Read this first

Three rules constrain every part of this design. If you remember nothing else, remember these.

### 0.1 Rotate your keys before you wire anything up

`CLAUDE.md` section 2 records that your OpenRouter and Groq keys have already been exposed in screenshots and chat, and must be treated as compromised. Rotate all three at the provider **before** you enable any new AI feature. The new key goes into Cloudflare, Pages, Settings, Environment variables (`GROQ_API_KEY`, `OPENROUTER_API_KEY`). It never goes into source, the database, a spreadsheet cell, or the browser.

### 0.2 The assistant reads and proposes. Only you commit.

This is not a policy you have to trust the model to follow. It is enforced by architecture in three independent layers (section 2). The model has no code path that writes to Firestore. The only write path is the one your `AddTransaction` form already uses, and it runs only when you press an Add button.

This matches the pattern every serious agent framework uses for money and other irreversible actions: reads run freely, writes are gated behind explicit human approval. Amazon Bedrock Agents gate write operations behind a confirm or reject prompt while letting read operations run automatically. The safer form of this is orchestrator driven, meaning the approval gate is fixed in your code and the model cannot decide to skip it because it "feels confident". This design puts the gate in your code, not in the prompt.

### 0.3 "100% access except email, password, and keys" is automatic here

You asked for the assistant to read everything except your email, password, and API keys. In your system that separation already exists by construction:

- **Passwords** do not exist in your system. Auth is Google sign in (`docs/PLAN.md`), so there is no password stored anywhere to read.
- **Your email** lives in the Firebase Auth token, not in the ledger. The assistant reads the ledger, settings, and budgets. It is never handed the auth profile.
- **API keys** are forbidden from Firestore by your security rules (`noSecretKeys`) and live only in a Cloudflare environment secret. They are not in the data the assistant reads, and the browser never receives them.

So the assistant can be given the whole financial dataset, and the three things you want withheld are simply not part of that dataset. Section 3 adds one more guard on top: a redaction pass that strips anything key shaped out of text before it is ever sent, in case you paste a key into the chat by accident.

---

## 1. Insight: what this is, and why it is shaped this way

### 1.1 The mental model

Think of the assistant as a **fast data entry clerk with read access to your books**. It can look at everything, it can read a receipt and draft the row for you, and it can answer "how much did I spend on food this month". What it cannot do is pick up the pen. Every row it drafts sits in front of you as a preview with an Add button. Nothing reaches the ledger until you press it.

This is deliberately the opposite of an autopilot. Your ledger is real money, your `CLAUDE.md` sets a correctness bar that says guessing is not acceptable, and free models are inconsistent by nature. So the model does the tedious part (reading, transcribing, aligning fields to your schema) and you keep the one decision that matters (is this correct, save it).

### 1.2 Why propose and confirm, not auto save

The research on this is consistent, and it points the same way for anything that touches money:

- Production agents insert **approval gates** before consequential actions. Three shapes exist: approve before every action, review results after, or escalate only on risk signals. For irreversible financial writes, approve before is the correct shape.
- The gate should be **predictable and code driven**, not something the model chooses to invoke. A high risk write should always stop for review, every time, with no user choice removed by a confident model.
- The clean pattern is **diff and approve**: compute the exact change the write would make, show it to the person, and commit only on approval. Your Add button is exactly this: the proposal is the diff, pressing Add is the approval.

Your app already embodies this instinct elsewhere. Deletes are soft and restorable. Integrity checks report and never auto correct. The AI feature simply extends the same posture to a new kind of input.

### 1.3 The three jobs, and what each one sends

Each job sends the smallest thing that does the work, which keeps the free tier cheap and keeps exposure low.

| Job | What the model receives | What it returns |
|---|---|---|
| Ask | A computed snapshot of your figures (and, for detailed questions, a bounded slice of rows) | A short answer, read only |
| Capture from text | Your sentence, plus your reference lists (wallet names, categories, spending types) and today's date | A structured proposal, matching your `Draft` shape |
| Capture from images | Up to five images, plus your reference lists | One or more structured proposals |

Notice that Capture never needs the whole ledger. To turn "100 cash on food" into a row, the model needs to know your wallet is called "Cash" and that "Food" is one of your spending types. It does not need to see your other 440 rows. That keeps the write path both cheaper and safer than the read path.

---

## 2. The safety model: how "cannot tamper, only read" is guaranteed

Your system is already built in layers that each refuse a bad write independently. The AI feature adds nothing that bypasses them, and adds one new capability boundary of its own. Four layers, top to bottom.

### Layer 0: capability. The model has no writer.

The model returns text (a proposal). It does not hold a Firestore handle, and there is no function anywhere that takes model output and writes it to the database without passing through your validation and your Add button. The `functions/api/ai.ts` endpoint is explicit that the model gets text and returns text, with no tools and no function calling. The extraction task added in section 7 keeps that property: it returns a JSON proposal, nothing more.

### Layer 1: the write path is the one you already trust.

When you press Add on a proposal, the client does exactly what `AddTransaction` does today:

```
proposal (from AI)
  -> build a Draft (domain/entry.ts: Draft)
  -> checkDraft(draft, transactions, reference, debts)   // same validation as manual entry
  -> if errors, the Add button is disabled and the reasons are shown
  -> draftToTransactions(draft, nextRecordNumber, id, split)
  -> onSave(rows)  ==  handleSave in App.tsx
  -> insertChronologically(prev, rows)  +  saveMany(rows)  // the only writer
```

There is no second writer. `handleSave` and `saveMany` in `data/firestoreLedger.ts` are the same functions a hand typed row goes through. The AI proposal is just another way to fill the draft.

### Layer 2: application validation runs on the proposal.

`checkDraft` in `domain/entry.ts` runs on an AI proposal identically to a typed one. It blocks a save with missing or invalid fields, and it surfaces the same warnings you already have: going negative, spending from savings, and the borrowing catch that stops a debt draw being booked as income. The model does not get to skip this by being confident. If the proposal is malformed, the Add button stays disabled and the reasons are shown.

### Layer 3: Firestore security rules reject anything that slips through.

`firestore.rules` validates every write at the database, regardless of what the client sent:

- `validTransaction()` enforces the field whitelist, integer centavos, the `total == amount + fee` invariant, the debt fields, and `noSecretKeys`.
- `allow delete: if false` on every money collection, so nothing can hard delete a row.
- `isOwner(uid)` so only your account can write at all.

The AI runs client side under your own session, so it is subject to the identical rules as any other write. It has no elevated path. A malformed or malicious proposal that somehow reached Firestore would be rejected by the same rules that already protect you.

### The read boundary

Reads are the mirror image. The assistant is handed a computed view of your data assembled client side (section 3). It is never given a query interface into Firestore, so there is no way for a bad question to turn into an unbounded or unintended read. This is the same reasoning `domain/aiContext.ts` already documents: a fixed snapshot cannot be talked into returning everything, because its size and shape are decided before the call, not by the model.

**Net effect.** For the assistant to corrupt your ledger, all four layers would have to fail at once: the capability boundary, your validation, the Add button, and the database rules. Any one of them holding is enough to keep your data safe. That is the same defence in depth your app already uses for manual entry.

---

## 3. What the assistant reads: the 100% surface

You want the assistant to see everything. For the **Ask** job, here is what "everything" means and how it is bounded.

### 3.1 The data access layer

Today `domain/aiContext.ts` builds a figures only snapshot: totals, balances, rankings, counts. That is perfect for the summary panels and it stays. For a chatbot that can answer "what did I spend at the pharmacy in March", the snapshot alone is not enough, so the chat path adds a **bounded row view** on top of it.

Build one new pure function next to the existing context builder:

```
domain/aiChatContext.ts

buildChatContext({ transactions, accounts, budgets, credits, reference, asOf, options })
  returns {
    snapshot,        // the existing AiContext (figures)
    rows,            // compact transactions, redacted, bounded by a byte budget
    reference,       // wallet names, categories, spending types, so answers use your labels
    included,        // { rowCount, from, to, notesIncluded }  so the UI can say what was sent
  }
```

Each compact row is small and structured, for example:

```
{ n: 441, date: "2026-08-31", type: "Spending", from: "Cash", to: "",
  cat: "Spending", item: "Food", amt: 100.00, fee: 0, status: "Paid" }
```

Because your dataset is one person and roughly 440 rows, the whole ledger in this compact form is on the order of tens of kilobytes. That is small enough to send when a question needs it, and the byte budget below keeps it from ever growing without bound.

### 3.2 Three guards on the read surface

**Bound the size.** Keep a hard byte cap on what leaves the device, the same idea as the existing `MAX_CONTEXT_BYTES`. Raise it for the chat task (a figure in the region of 60 to 120 KB is reasonable for your dataset), and select the most relevant rows first (the month or category the question is about, then recent history) until the budget is spent. The UI shows what was included, so you always know what was sent.

**Redact secrets from text.** Before any text is sent, run it through a redactor built on the patterns already in `domain/settings.ts` (`containsSecret` / `KEY_PATTERNS`, which match OpenAI, OpenRouter, Groq, and Anthropic key formats). If a key shaped string appears anywhere (a description, a note, a pasted chat line), replace it with `[redacted]`. This is the guard that honours "never send my keys" even if a key ends up in your data by accident.

**Gate free text notes.** Your `notes` and `description` fields are where the most sensitive text lives ("paid Tita back for the hospital bill"). Default the chat context to **include `item` and short `description`** (needed to answer real questions) but **exclude `notes`** unless you turn on a "share notes with the assistant" toggle in Settings. This gives you the 100% access you asked for on the figures and the classifying fields, while keeping the private prose behind one clear switch.

> Design note. The existing `aiContext.ts` sends figures only and no free text at all. Enabling the chatbot deliberately widens that surface, because a chatbot that cannot see your items cannot answer questions about them. The widening is your choice, made by turning the feature on, and the three guards above keep it bounded and secret free. If you would rather keep the tighter posture, leave the chatbot in figures only mode: it can still answer most "how much" and "am I over budget" questions from the snapshot alone.

---

## 4. Function A: Ask (chat question and answer, read only)

### 4.1 Flow

```
You type a question in the chat box
  -> client builds the chat context (section 3), redacted and bounded
  -> POST /api/ai  { task: "chat", context, history }   // recent turns passed in, see 4.3
  -> Groq or OpenRouter free model answers
  -> answer rendered in the thread, with a provenance line (which model, or "this device")
  -> the question and the answer are written to the chat collection (section 8)
  -> an activity event ai.query is written (section 9)
```

### 4.2 The server task

Add a `chat` task to the `TASKS` map in `functions/api/ai.ts`. It reuses the existing system prompt rules (repeat figures exactly, never recalculate, plain sentences, no Markdown, no em dash, not a financial adviser) and adds the conversational instruction. It stays a narrative task, so a plain prose reply is accepted, matching how `summary`, `alerts`, and `patterns` already work.

### 4.3 Multi turn without server state

Your endpoint is deliberately stateless: it keeps no conversation history, so nothing accumulates server side and there is no session to leak. Keep that. For multi turn chat, the **client** sends the last few turns with each request (a small, bounded history), and the server treats each call as independent. History lives in your Firestore chat collection, which is your own database under owner only rules, not on the provider.

### 4.4 Offline and failure

Reuse the existing fallback behaviour from `data/aiClient.ts`. If no key is set, every free model is rate limited, or you are on `vite dev` with no Functions runtime, the chat turn falls back to a locally written answer with a visible reason, and the feature never simply goes blank.

---

## 5. Function B: Capture from text

This is your worked example: **"I spent 100 today cash to buy food"** becomes a row you approve.

### 5.1 The six steps

```
1. PARSE     Model reads your sentence and extracts intent and fields.
2. ALIGN     Fields are mapped to your real schema using your reference lists.
             "cash" -> wallet "Cash", "food" -> spending type "Food",
             "100" -> 10000 centavos, "today" -> 2026-08-31, status -> "Paid".
3. VALIDATE  checkDraft runs. Wallet exists, amount is positive, category fits.
             Warnings (negative balance, savings, debt as income) are computed.
4. PRESENT   A proposal card is shown with a one line ledger preview,
             any warnings, and a confidence marker.
5. APPROVE   You press Add. The row is saved through handleSave (section 2).
             An activity event is written with actor "ai". The chat is stored.
6. RECORD    The saved row's real record number is confirmed in the thread.
```

Steps 1 and 2 are the model. Steps 3 to 6 are your own code and your press of the button. The "double check" you asked for is step 3 (validation and warnings) plus step 5 (nothing is saved until you approve).

### 5.2 Field mapping for the example

Your `Transaction` and `Draft` types (`domain/types.ts`, `domain/entry.ts`) define the real columns. Here is how the sentence lands in them.

| Field | Value | Where it comes from |
|---|---|---|
| flow | `Spending` | "spent" |
| date | `2026-08-31` | "today", ISO, never a Date object |
| fromWallet | `Cash` | "cash", matched to your wallet list |
| category | `Spending` | default for a plain purchase (not Bills or Subscriptions) |
| item | `Food` | "food", matched to your spending types |
| description | `to buy food` | the rest of the sentence, cleaned |
| amount | `10000` centavos | "100" pesos, parsed at the boundary with `parseAmount` from `domain/money.ts` |
| fee | `0` | none stated |
| status | `Paid` | a spend that already happened |

The amount is converted to centavos once, at the input boundary, using the existing `parseAmount` in `domain/money.ts`. No `parseFloat`, no `toFixed` arithmetic. This is the money rule in `CLAUDE.md`, and the AI path obeys it like every other path.

### 5.3 The one line preview

Your example format was `440-08/31/2026-spending-cash To buy-food-100-paid`. Here is a canonical preview line mapped to the real columns, in the same spirit:

```
#441 · 2026-08-31 · Spending · Cash · Food · to buy food · ₱100.00 · Paid
```

Two honest details:

- The record number shown is **provisional**. Your ledger renumbers on every write (`insertChronologically`), so the real number is assigned at the moment you press Add. The preview shows the projected next number, exactly as your `AddTransaction` form already shows `nextRecordNumber`. For a back dated entry the final number can differ, because the row sorts into its date.
- The internal date is ISO (`2026-08-31`). You can display it as `08/31/2026` if you prefer, but store and reason in ISO, matching your schema.

### 5.4 The proposal card

The card shows the structured fields (so you can see and correct each one), the one line preview, any warnings from `checkDraft` in your existing warning style, a confidence marker, and two buttons:

- **Add** commits through `handleSave`. Disabled while `checkDraft` reports any error.
- **Discard** drops the proposal and logs `ai.proposal.rejected`.

Every field stays editable before you press Add, so a wrong guess (say the model picked the wrong wallet) is a one tap fix, not a reason to start over.

---

## 6. Function C: Capture from images

Your example: **five screenshots of bank transactions and a photo of a paper receipt**, read and turned into proposals.

### 6.1 Which models, on the free tier

Both providers you already use offer free vision models, and both are OpenAI compatible, so they slot into your existing endpoint with the same `chat/completions` shape plus an `image_url` content block.

- **Groq.** Current multimodal models include `qwen/qwen3.6-27b` (accepts up to 5 images per request) and `qwen/qwen3.8-27b` (up to 3). Both support JSON mode, which you use to get a structured proposal back. Groq's free developer tier has no per token charge and is gated only by rate limits.
- **OpenRouter.** Free vision model IDs churn week to week (the Llama 4 vision free listings, for example, have come and gone). The robust option is `openrouter/free`, a router that automatically selects a free model and filters for the capabilities your request needs, including image understanding, tool calling, and structured outputs.

Because the specific free IDs change so often, do not hardcode them. Discover them at runtime, exactly as `functions/api/ai.ts` already does for text models, and add a capability filter for vision (section 7.3). This is the same lesson your endpoint already learned the hard way when an entire hardcoded chain returned 404 overnight.

### 6.2 Image limits (the maximum MB you asked for)

Set these client side, before anything is sent, and make them configurable in Settings.

| Limit | Recommended default | Why |
|---|---|---|
| Max images per message | 5 | Matches Groq `qwen3.6-27b` and your "five screenshots" case |
| Hard size cap per image | 4 MB | Practical ceiling for base64 inline image payloads on the free vision endpoints. Reject anything larger with a clear message |
| Auto compress target | 1.5 MB per image | Keeps the request small and the cost down. Each image already counts as 2048 input tokens regardless of detail |
| Max long edge | 1568 px | Downscale larger images. Receipts and screenshots stay legible well below this |
| Accepted types | JPEG, PNG, WebP | Photos re encode to JPEG at about 0.82 quality. Keep crisp text screenshots as PNG if already under the cap |

Show a live total size readout under the composer and block Send if the message is over budget. The error names the file and the limit, per your rule W3 (say what happened and what to do), for example: "receipt.png is 6.2 MB. The limit is 4 MB. It was not sent. Try a smaller photo."

Groq rejects a request whose single image URL exceeds 20 MB with a 400, so your 4 MB client cap keeps you comfortably inside the provider limit as well as keeping the free tier fast.

### 6.3 Flow

```
You attach up to 5 images and optionally add a note ("these are August, all from BPI")
  -> client validates count, size, type; downscales and compresses
  -> client redacts your note text (secret patterns) and builds the extract context
     (your reference lists + today's date + your note)
  -> POST /api/ai  { task: "extract", images: [...], context }
  -> vision model returns JSON: an array of proposals, one per transaction it found
  -> server validates the JSON against the strict schema (section 7.4)
  -> client converts each proposal to a Draft, runs checkDraft on each
  -> a stack of proposal cards is shown, one per row, each with its own Add and Discard
  -> "Add all" is offered when every card validates
  -> each Add commits through handleSave; each writes an activity event with actor "ai"
     and via "ai_image"; the chat and image metadata are stored (section 8)
```

### 6.4 Multiple rows from one batch

A bank screenshot usually holds several transactions and a receipt is usually one. So the extract task returns an **array** of proposals, and the UI shows a reviewable stack. You approve them one by one, or press "Add all" once every card is green. Each approved row is its own ledger entry and its own activity event, so the provenance stays exact even for a batch.

### 6.5 What the model is told to do with a receipt

The extraction instruction (server side, fixed) tells the model to read each image, and for each distinct transaction output one proposal aligned to the allowed wallet names, categories, and spending types it is given. It is told to copy amounts exactly, to prefer your existing labels, to set confidence, and to say which image and line each proposal came from (so a low confidence row is easy to check against the picture). It is told not to invent a wallet or category that is not in the list, and to mark a field it cannot read as empty rather than guessing.

---

## 7. Server endpoint changes (`functions/api/ai.ts`)

The endpoint keeps every property it has now: owner only (Firebase ID token verified by `_owner.ts`), stateless, nothing logged, keys from env only. You add two tasks and a vision aware model chain.

### 7.1 Keep the owner gate

No change. Both `onRequestPost` and the new paths call `refuseStranger` first. The endpoint spends your quota, so it must keep refusing anyone who cannot prove they are you.

### 7.2 New tasks

Add to `TASKS`:

- **`chat`** (narrative). Instruction: answer the owner's question about their own figures conversationally, in a few sentences, repeating figures exactly and following the existing accuracy rules. `proseIsFine: true`. Accepts the client sent recent history.
- **`extract`** (structured). Instruction: from the text and any images, output proposals matching the schema in 7.4. Enforced with `response_format: json_object` where the model supports it, and validated on return.

### 7.3 Vision aware model discovery

Add a `visionChainFrom(env)` alongside the existing `chainFrom`. It lists each provider's models (already cached per isolate for an hour), then filters for multimodal capability rather than excluding it:

- **Groq.** Keep the current `:free` and not-a-chat filters, and additionally keep only known multimodal families (the `qwen3.x-27b` vision models and any successor the catalogue lists as image capable).
- **OpenRouter.** Prefer `openrouter/free` for vision, since it self selects a free model that supports image input. If you also want to discover specific `:free` multimodal IDs, read each model's modality from the models endpoint and keep only those that accept image input.

Interleave the providers the same way the text chain does, so one provider being slow costs one attempt, not the whole batch. Fall back to the text chain for a text only `extract` (a sentence with no image).

### 7.4 The extract schema, and why the server validates it

The model returns:

```json
{
  "proposals": [
    {
      "reasoning": "one short sentence, decided first, never shown",
      "flow": "Spending",
      "date": "2026-08-31",
      "fromWallet": "Cash",
      "toWallet": "",
      "category": "Spending",
      "item": "Food",
      "description": "to buy food",
      "amountPesos": 100.00,
      "feePesos": 0,
      "status": "Paid",
      "confidence": "high",
      "sourceRef": "your message"
    }
  ]
}
```

The server validates shape before returning (an array of objects, known enum values for `flow`, `category`, and `status`, numeric amounts, strings within length limits), the same three layer approach the existing tasks use: the prompt names the shape, `response_format` asks the API to enforce it, and this code checks what actually arrived. A renamed or missing field fails here and triggers the one retry that shows the model its own broken output, exactly as the current tasks do.

The client then does the real conversion and the real validation: `amountPesos` becomes centavos through `parseAmount`, the proposal becomes a `Draft`, and `checkDraft` decides whether Add is allowed. The server schema is a convenience for a clean handoff. The client validation and the Firestore rules are the guarantees.

### 7.5 Size caps for images

Add an image branch to the size guard. Cap the number of images (5), the per image byte size after the client has compressed (a few MB), and the total request body. Reject over cap requests with a clear error, the same way `MAX_CONTEXT_BYTES` already rejects an oversized text context.

---

## 8. Chat storage (Firestore)

You asked to save all chat. Store it in your own database, under owner only rules.

### 8.1 Layout

Keep it under the single user document, consistent with your existing layout:

```
users/{uid}/chat/{messageId}
```

One document per message. Fields:

| Field | Type | Notes |
|---|---|---|
| `role` | string | `user` or `assistant` |
| `text` | string | the message, secret redacted before write |
| `at` | string | ISO timestamp, plus a server timestamp field for ordering |
| `threadId` | string | groups a conversation. A single rolling thread is fine to start |
| `source` | string | for assistant messages: `model` or `offline` |
| `model` | string | for assistant messages: `provider:model` when one answered |
| `attachments` | list | image metadata only: filename, byte size, sha256 hash, width, height. Not the raw image |
| `proposalIds` | list | links to any proposals this turn produced |
| `contextBytes` | number | how much was sent, for your own visibility |

### 8.2 Do not store raw images in Firestore

A Firestore document is capped at about 1 MB, so a base64 image does not belong in one. Two clean options:

- **Metadata only (recommended to start).** Store the filename, size, and a sha256 hash of the image in the chat message, plus the text the model extracted. The picture itself is not persisted. This is the smallest footprint and the least sensitive data at rest.
- **Firebase Storage.** If you want the original image kept, upload it to Firebase Storage under `users/{uid}/uploads/{hash}` with Storage rules that mirror your Firestore owner check, and store only the path in the chat message. Add a size limit and a content type check in the Storage rules.

### 8.3 Rules

Chat is append only, like everything else that matters in your system:

```
match /users/{uid}/chat/{messageId} {
  allow read:   if isOwner(uid);
  allow create: if isOwner(uid) && validChatMessage();
  allow update, delete: if false;
}
```

`validChatMessage()` checks the field types and lengths, and reuses `noSecretKeys` on the document keys. Redact the text value before writing (section 3.2), so a pasted key never lands at rest even though the rule only guards key names.

If you want a "clear history" action, implement it as a soft archive flag rather than a delete, matching how your ledger never hard deletes.

---

## 9. Activity log (your detailed, every move record)

You asked for a very detailed activity log, stored in the database, with a clear indication when something was added by the AI. This section gives you an append only audit trail that follows the fields and the immutability that financial audit guidance calls for.

### 9.1 What audit guidance says to capture

Across banking, ERP, and data engineering practice, an audit entry should record who did it, what action on what target, when (in UTC), how it arrived (UI, API, batch, or in your case AI), and the before and after state where a value changed. High risk areas like finance get field level tracking (log the exact field that changed, with old and new values) and a unique event ID. The log must be append only and immutable: inserts only, no updates or deletes, enforced at the storage layer, not just in code. Optionally each entry carries a hash of the previous one, so any tampering breaks the chain and stands out.

Your Firestore rules already give you the immutability primitive: deny update and delete on the collection, and the database enforces append only for you.

### 9.2 Layout and schema

```
users/{uid}/activity/{eventId}
```

| Field | Type | Notes |
|---|---|---|
| `eventId` | string | unique, also the doc id |
| `at` | string | ISO 8601 UTC, plus a server timestamp for ordering |
| `actor` | string | `owner` or `ai`. This is the "added by AI" indication |
| `via` | string | `manual`, `ai_chat`, `ai_image`, `csv_import`, `migration`, `system` |
| `action` | string | see the list below |
| `target` | map | `{ collection, id }`, for example a transaction id |
| `summary` | string | one human readable line, following your writing rules |
| `before` | map or null | prior state (for edits and bins) |
| `after` | map or null | new state (for creates and edits) |
| `changed` | list | for edits: the field names that changed, for fast scanning |
| `model` | string | when `actor` is `ai`: the `provider:model` used |
| `source` | string | `ui` or `api` |
| `sessionId` | string | groups events from one app session |
| `prevHash` | string | optional: hash of the previous event, for tamper evidence |
| `hash` | string | optional: hash of this event including `prevHash` |

### 9.3 What to log (three tiers)

You said "every move in the system". Logging literally every render is expensive and mostly noise, so split it into tiers and let the top two always run.

**Tier 1, changes and access decisions (always on).** Every write and every security relevant event:

- `transaction.create`, `transaction.update`, `transaction.bin`, `transaction.restore`
- `settings.update`, `budget.update`, `account.add`, `account.archive`
- `backup.export`, `backup.restore`
- `auth.signin`, `auth.signout`

Each carries before and after where a value changed, so you can answer "who changed this row, when, and from what to what".

**Tier 2, AI interactions (always on).** The full story of the assistant:

- `ai.query` (a chat question was asked, with the model used and the context byte size)
- `ai.proposal` (the assistant proposed one or more rows, with the proposed values)
- `ai.proposal.accepted` (you pressed Add, linking to the created `transaction.create` event)
- `ai.proposal.rejected` (you discarded it)
- `ai.image.ingest` (images were read, with count and hashes, never the raw image)

Because an AI created row produces both an `ai.proposal.accepted` event and a `transaction.create` event with `actor: "ai"`, the provenance is unambiguous and it survives later edits (the events reference the stable transaction `id`, not the record number).

**Tier 3, navigation (optional toggle).** Screen views and filter changes (`view.open`, `filter.change`). Useful for "what was I doing" but higher volume. Make it a Settings toggle, and batch these writes (buffer a few and write them together) so you do not spend a Firestore write on every tap. Default it off, turn it on when you want the fine grained trail.

### 9.4 Where the writes happen

Wrap your existing mutation points so the activity write travels with the data write. For transactions, the natural seam is `handleSave` and `handleUpdate` in `App.tsx`, plus the bin and restore handlers. Pass a small provenance object (`actor`, `via`, `model`, `sessionId`) into these so a manual save logs `actor: "owner"` and an AI save logs `actor: "ai"`. Write the activity event as part of the same user action, so an action never lands without its audit record. If you want the stronger guarantee that the audit cannot be missing, write the activity event first and the data second, then the worst case is an audit entry for a write that failed, which is a safe direction to fail in.

### 9.5 Rules

```
match /users/{uid}/activity/{eventId} {
  allow read:   if isOwner(uid);
  allow create: if isOwner(uid) && validActivity();
  allow update, delete: if false;   // append only, immutable
}
```

`validActivity()` checks the field types and the enum values for `actor`, `via`, and `action`, caps the sizes of `before` and `after`, and reuses `noSecretKeys`. Redact `before` and `after` text through the secret redactor before writing, so the audit trail cannot become a place a key hides either.

### 9.6 Showing "added by AI" in the app

Two ways, and you can use either or both:

- **From the log (recommended, keeps the money schema clean).** When rendering a ledger row, look up whether its creating event has `actor: "ai"` and show a small "AI" badge. Your `CLAUDE.md` values keeping the transaction record pure, and this adds nothing to it. The activity log is the source of truth for provenance.
- **A flag on the row (simpler badge, changes the schema).** Add an optional `entrySource: "manual" | "ai"` field to the transaction. Your rules use `hasAll` (a whitelist that allows extra non secret fields), so this is permitted, but it changes your domain type and touches your parity tests, so weigh it against the cleaner option above.

An activity screen (reuse your `DataTable`) lets you scan the trail, filter by actor, action, and date, and open any entry to see the before and after. That is the "very detailed" view you asked for.

---

## 10. The glowing chat box (subtle, AI powered look)

You want the chat box border to glow a little, enough to read as AI powered, not enough to be loud. Your style guide is a clean light SaaS look with a green accent, square feeling corners, hairlines, and minimal motion (rule D9: no shimmer, and `prefers-reduced-motion` respected). So the glow is a soft green halo that sits still most of the time and breathes gently only while the assistant is thinking.

### 10.1 Tokens (hex only in `tokens.css`, per rule D1)

Add to `styles/tokens.css`, in `:root` and in the `.theme-dark` block, using your brand green:

```css
/* :root */
--ai-glow-ring:        rgba(58, 124, 39, 0.35);   /* brand-600, low alpha */
--ai-glow-halo:        rgba(58, 124, 39, 0.15);
--ai-glow-halo-active: rgba(58, 124, 39, 0.28);

/* .theme-dark */
--ai-glow-ring:        rgba(125, 201, 92, 0.30);   /* brand-active in dark */
--ai-glow-halo:        rgba(125, 201, 92, 0.14);
--ai-glow-halo-active: rgba(125, 201, 92, 0.26);
```

### 10.2 The style (everywhere else uses `var(...)`)

```css
.ai-chatbox {
  border: 1px solid var(--hairline-strong);
  border-radius: var(--radius-md);
  background: var(--surface);
  box-shadow:
    0 0 0 1px var(--ai-glow-ring),
    0 0 10px 1px var(--ai-glow-halo);
  transition: box-shadow var(--motion-hover) var(--ease-out);
}

/* A touch stronger when you are typing in it. */
.ai-chatbox:focus-within {
  box-shadow:
    0 0 0 1px var(--ai-glow-ring),
    0 0 16px 3px var(--ai-glow-halo-active);
}

/* Breathe only while the assistant is working, and only if motion is allowed. */
@media (prefers-reduced-motion: no-preference) {
  .ai-chatbox[data-thinking="true"] {
    animation: ai-breathe 2.4s var(--ease-out) infinite;
  }
}

@keyframes ai-breathe {
  0%, 100% {
    box-shadow:
      0 0 0 1px var(--ai-glow-ring),
      0 0 10px 1px var(--ai-glow-halo);
  }
  50% {
    box-shadow:
      0 0 0 1px var(--ai-glow-ring),
      0 0 18px 4px var(--ai-glow-halo-active);
  }
}
```

Set `data-thinking="true"` on the box while a request is in flight, and clear it when the answer or the proposal arrives. Under reduced motion the box does not animate at all: it keeps the static halo, which still reads as AI powered without any movement. This satisfies D9 and D7 (the halo is decoration over your surface, and your text contrast is unchanged because the glow sits outside the box).

---

## 11. Settings additions

Extend `AiSettings` in `domain/settings.ts` and `normaliseSettings`, and mirror the new fields in the `validSettings()` rule. Keep the golden rule: no key field, ever.

```
ai: {
  enabled: boolean,
  provider, model, tone,          // unchanged
  features: {
    alerts, insightSummary, descriptions,   // existing
    chat: boolean,                 // Ask
    capture: boolean,              // text and image capture
  },
  chat: {
    shareNotes: boolean,           // section 3.2, default false
    contextByteBudget: number,     // section 3.2
  },
  image: {
    maxCount: number,              // default 5
    maxSizeMB: number,             // default 4  (your requested maximum)
    compressTargetMB: number,      // default 1.5
    maxEdgePx: number,             // default 1568
  },
  activity: {
    logNavigation: boolean,        // Tier 3 toggle, default false
  },
}
```

Update `validSettings()` in `firestore.rules` to accept these (types and ranges), and keep `noSecretKeys(d.keys())` and `noSecretKeys(d.ai.keys())`.

---

## 12. Build order

A phased path, each phase shippable and testable on its own. Every push to `main` deploys, so `tsc`, `vitest`, and `vite build` must pass first (your `docs/09-AUTO-PUSH.md`).

1. **Keys.** Rotate at the providers. Confirm `GROQ_API_KEY` and `OPENROUTER_API_KEY` are set in Cloudflare. No code change.
2. **Activity log core.** New collection, rules (append only), `validActivity()`, and the write seam in `handleSave` / `handleUpdate` / bin / restore, with `actor: "owner"`. Ship it. Now every existing manual action is audited before any AI touches anything.
3. **Chat storage.** New collection, rules, `validChatMessage()`, the redactor. No model calls yet.
4. **Ask.** The `chat` server task, `buildChatContext`, the chat panel with the glowing box, provenance line, and the offline fallback. Log `ai.query`. This is read only, so it cannot affect your ledger. Ship and use it for a while.
5. **Capture from text.** The `extract` server task (text only branch), the proposal card, the Add path through `handleSave`, and the `ai.proposal.*` events with `actor: "ai"`. This is where writes begin, so lean on `checkDraft` and your rules.
6. **Capture from images.** `visionChainFrom`, image validation and compression, the multi proposal stack, `ai.image.ingest`. Start with Groq `qwen3.6-27b` and `openrouter/free`.
7. **Polish.** The activity screen, the "AI" badge on rows, Tier 3 navigation logging behind its toggle, and the optional hash chain on the activity log.

---

## 13. What the sources say, and how this design follows them

You asked for the assistant to behave the way banks, articles, and the wider community describe. Here is the through line, and where each idea shows up above.

- **Reads run free, writes are gated (human in the loop).** Production agent guidance and vendor frameworks put a confirm or reject gate before any consequential write, and let read only actions run automatically. The safer form makes that gate predictable and code driven, not a decision the model can skip when it feels confident. This design puts the gate in your Add button and your `checkDraft`, and the model has no writer at all. (Sections 0.2, 1.2, 2.)
- **Diff and approve.** The clean pattern for an AI proposed change is to compute the exact change and commit only on approval. Your proposal card is the diff and pressing Add is the approval. (Sections 1.2, 5.)
- **Vision LLMs as OCR.** Modern multimodal models read receipts, invoices, screenshots, and tables well, and both Groq and OpenRouter expose free ones on an OpenAI compatible surface. Groq documents up to 5 images per request and JSON mode; OpenRouter offers a free router that self selects an image capable free model. (Section 6.)
- **Do not hardcode free model IDs.** The free catalogue churns constantly (weekly on OpenRouter), which is exactly why your endpoint already discovers models at runtime. The vision path extends the same discovery rather than pinning names. (Sections 6.1, 7.3.)
- **Audit trails are append only and detailed.** Banking and ERP guidance says capture who, what, when (UTC), how, and before and after, with field level tracking for finance and a unique event ID, and make the log immutable at the storage layer with optional hash chaining for tamper evidence. Your Firestore rules give append only for free (deny update and delete), and the schema in section 9 captures the rest, including the `actor: "ai"` marker you asked for. (Section 9.)
- **Keys never touch the client.** Your own `CLAUDE.md` and `settings.ts` already hold this line, and the community lesson on leaked keys is the same one you learned. The design keeps keys in Cloudflare env, adds a redaction pass so a key cannot land in the chat or the audit log, and reminds you to rotate first. (Sections 0.1, 0.3, 3.2.)

Sources consulted: GroqDocs Images and Vision (image limits, JSON mode, 5 image cap); Groq free tier notes; OpenRouter free models and the `openrouter/free` router (vision routing, weekly churn); LangChain, Cloudflare Agents, Elastic, Oracle, and Amazon Bedrock write ups on human in the loop and pre execution approval gates; and audit trail guidance from Trullion, Hubifi, Blu Banyan, AuditReady, and practitioner write ups on append only, immutable, field level logging with before and after values and hash chaining.

---

## 14. Test checklist

Add these to your Vitest suite. The point of your project is parity and safety, so the AI feature earns tests too.

**Safety (must pass):**

- A proposal with a nonexistent wallet fails `checkDraft`, so Add is disabled.
- A proposal with a non positive amount fails `checkDraft`.
- A proposal whose `total != amount + fee` is rejected by the transaction rule (rules test in the emulator).
- A proposal that names a debt in a Revenue flow raises the borrowing warning.
- The redactor replaces each of the four provider key formats in `KEY_PATTERNS` with `[redacted]`, in chat text, in `description`, and in `notes`.
- The activity collection denies update and delete in the emulator.
- The chat collection denies update and delete in the emulator.

**Behaviour:**

- "I spent 100 cash on food" maps to the fields in section 5.2, with amount `10000` centavos.
- A multi transaction bank screenshot produces more than one proposal.
- An image over `maxSizeMB` is rejected client side with a message that names the file and the limit.
- More than `maxCount` images is rejected before send.
- An AI committed row produces both an `ai.proposal.accepted` event and a `transaction.create` event with `actor: "ai"`, both referencing the same transaction id.
- With `shareNotes` off, no `notes` value appears in the bytes sent to the endpoint.

**Money rule:**

- Every amount that enters the ledger via the AI path went through `parseAmount`, and no `parseFloat` or `toFixed` arithmetic appears on the AI code path.

---

## 15. Open decisions for you

1. **Notes to the model.** Default is off (section 3.2). Turn on only if you want the assistant to read your private prose. Most questions do not need it.
2. **Keep original images or metadata only.** Metadata only is the smaller, safer default (section 8.2). Choose Storage if you want the pictures kept.
3. **Provenance: log only, or a flag on the row too.** Log only keeps your money schema pure (section 9.6). A row flag makes the badge trivial but touches your types and tests.
4. **Navigation logging.** Off by default for volume and cost (section 9.3, Tier 3). Turn on when you want the fine grained trail.
5. **Hash chain on the audit log.** Optional tamper evidence (section 9.2). Worth it if you want the log to prove it has not been altered, skippable if the append only rule is enough for you.

---

### Appendix: file by file change map

| File | Change |
|---|---|
| `functions/api/ai.ts` | Add `chat` and `extract` tasks; add `visionChainFrom`; add image size guard; keep owner gate, statelessness, no logging |
| `app/src/domain/aiChatContext.ts` | New. Builds the bounded, redacted row view for Ask |
| `app/src/domain/aiRedact.ts` | New. Secret redaction built on `settings.ts` `KEY_PATTERNS` |
| `app/src/domain/entry.ts` | No change to logic. AI proposals reuse `Draft`, `checkDraft`, `draftToTransactions` |
| `app/src/data/aiClient.ts` | Add `chat` and `extract` calls (with images) alongside `askAi` |
| `app/src/data/firestoreLedger.ts` | Add chat and activity stores (create and read); keep the no delete posture |
| `app/src/features/AiChat.tsx` | New. The chat panel, the glowing box, the proposal cards, the Add path |
| `app/src/features/Activity.tsx` | New. The audit trail screen, reusing `DataTable` |
| `app/src/App.tsx` | Wrap `handleSave` / `handleUpdate` / bin / restore to write activity events with provenance; wire the chat panel to `handleSave` |
| `app/src/domain/settings.ts` | Extend `AiSettings` (features, chat, image, activity); keep no key field |
| `app/src/styles/tokens.css` | Add the `--ai-glow-*` tokens in both theme blocks |
| `app/src/styles/layout.css` | Add the `.ai-chatbox` glow styles using `var(...)` |
| `firestore.rules` | Add `chat` and `activity` collections (append only); extend `validSettings()` for the new AI fields |
| `firestore.indexes.json` | Add indexes for activity queries (by `at`, by `actor`, by `action`) |

---

*End of guide. Rotate your keys first (section 0.1). Ship the activity log and the read only Ask before you enable any write. The assistant reads and proposes. Only you commit.*
