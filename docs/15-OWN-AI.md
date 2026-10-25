# 15. An AI of our own: what training on the owner's data can mean

The owner, 26 October 2026: "We can actually build our own ai from the data
now. Fix all reasoning. This is the process: Ai first, then system but better
reasoning. Lets train our system based on all types of data it gathers ...
use my personal data and the api ai to train the ai. Be careful of conflict
like the ai and system ai will be in conflict."

This is a proposal. Nothing in it is built until the owner says which parts
to build (`CLAUDE.md` §5: a decision the spec does not cover is proposed, not
defaulted). Section 5 lists the decisions.

---

## 1. What "train the AI" can mean, and which fits

| Way | What it changes | Fits this app? |
|---|---|---|
| **Fine-tuning** a model on the ledger | How the model behaves every time | **No, not now.** Neither provider the app uses trains models: OpenRouter only routes to hosted models, and Groq only serves adapters trained elsewhere, on request, for enterprise customers. Training would mean a GPU service, a cost, and the whole ledger uploaded to a third party. Fine-tuning also teaches behaviour, not facts, and the ledger changes every day. |
| **Retrieval** (the model is handed the owner's data each time) | What the model can see right now | **Already built.** Every chat question is sent with the month, the balances, the totals worked out by the app, and the rows that matter (`aiChatContext.ts`). This is the standard way to give a model private data that changes. |
| **Examples from the owner's own corrections** (few-shot) | How the model reads this owner | **Proposed.** Each card the owner edits before adding ("carwash" filed under Random necessities, not Repairs) becomes a worked example the model is shown next time. |
| **A small model trained on the phone** (a word classifier, like the spam filters BankClassify uses for bank statements) | What the app guesses for an item, a wallet, a kind | **Proposed.** Trained from the ledger's 3,953 rows in the browser, retrained after every save, never leaves the phone, no new package. |
| **An answer bank** (the owner's real questions, each with the right answer) | Whether a change made reasoning better or worse | **Proposed.** Kept private, beside the fixture. Every change runs against it before a push. |

The sources agree on the order: retrieval or examples first, fine-tuning only
when behaviour cannot be fixed any other way, and measuring with held-back
real cases matters more than which method is picked.

## 2. "Ai first, then system"

Today a message goes: the app's quick rules (an open card, a pie after an
answer, safe to spend), then the AI reads what the message means, then the
app's rules again, then the AI answers with figures the app worked out.

Proposed order, for every message that is not the answer to an open card:

1. **The AI reads it first**: what is meant (an entry, a question, a chart, a
   change, a correction of the last answer), and what it is about.
2. **The app works it out**: every figure, every date, every balance, every
   card.
3. **The AI says it** in words, from the app's figures only.
4. **The app checks the words**: figures it did not work out are named under
   the answer, a "fits" that does not fit is corrected underneath.

Cost: every message waits for the AI first (one to three seconds), which the
owner asked to remove on 4 October 2026 ("make the system powerful and
instant"). With the AI off or slow, the app's own rules answer, as now.

## 3. No conflict between the AI and the app: who decides what

| Decision | Decided by | When they disagree |
|---|---|---|
| Any figure, total, balance, date range, safe to spend | **The app**, always | The AI's figure is flagged under the answer. Never the other way round. |
| What a message means | **The AI** (step 1 above) | The app's rule wins only for an answer to a card that is open, and for a sentence that plainly records money with its figure. |
| The item, wallet and kind on a card | 1. what the owner typed, 2. the owner's own corrections, 3. the trained word model when sure, 4. the AI's guess, 5. a question | The higher one wins and the card says why ("you filed this as Random necessities on 22 October"). |
| Whether anything is saved, edited or binned | **The owner**, by pressing the button | Nothing is saved by either. |
| A rule in the spec (spending, transfers, debt) | **The spec** | Neither may change it. A learned guess never overrides a documented rule. |

The learner never writes a rule: it only proposes on a card, which the owner
sees before anything is saved. That is what keeps the "learned gas is Food"
mistake (`10-AI-ASSISTANT-STATUS.md` §3.1, §4) from coming back.

## 4. What it will not do

- Send the ledger anywhere to be trained on.
- Learn from a card the owner discarded, or from the AI's own unchecked words.
- Change a figure, a balance or a past entry by itself.

## 5. For the owner to decide

1. **AI first for every message?** Smarter reading, one to three seconds
   slower per message. Recommended: yes, with the app answering on its own when
   the AI is off or slow.
2. **The word model on the phone**, trained on the entries and on cards edited
   before adding? Recommended: yes.
3. **Examples from corrections** sent with each question? Recommended: yes,
   the last few dozen.
4. **The answer bank** from the owner's real questions? Recommended: yes,
   private, never in this public repository.
5. **Cloud fine-tuning on the ledger?** Recommended: no, for the reasons in §1.

Before any of it: the AI keys in the workbook were exposed in screenshots and
chat (`CLAUDE.md` §2). Rotate them at OpenRouter and Groq first.
