# Debugging from the record

**2026-08-31. From `285ad3f` to `10903de`.**
1090 tests, typecheck and build clean.

Every fault below was found in the assistant's own record of what it did, in
`users/{uid}/ai`, or by sweeping the 492 rows in the ledger. None of them came
from reading the code and wondering. That distinction is the point of this
document: the app now keeps enough about its own behaviour to be repaired
from evidence, and this is what the first pass of that produced.

---

## 1. How to do this again

1. Open the app you are signed into and put `?coderview` on the end of the
   address. It prints every collection as plain text.
2. Read the block headed **How the assistant is doing**. `asked` against
   `answered` is the blunt measure. `Corrections by field` says which reading
   is weak: a pile against `toWallet` means the transfer question, a pile
   against `item` means the categoriser.
3. Read the event stream in time order. The faults are in the gaps: a
   question asked three times in twenty seconds, a card rejected seconds
   after it appeared, four messages of rising frustration.
4. Save the dump somewhere git ignores, fix from it, and delete it.

The numbers moved over the session that produced this work:

| | Before | After |
|---|---:|---:|
| asked | 86 | 105 |
| answered | 19 | 27 |
| accepted as proposed | 57% | 61% |

Both are still poor. The work below removes causes rather than symptoms, and
the next dump is what says whether it worked.

---

## 2. What the record showed, and what was done

### The assistant denied things the app does

> 15:06:32 "I want chart and trend at the same time with proper explaantion"
> 15:07:14 "I cannot make charts or graphs here, only plain text"
> 15:07:31 "what you just did it!!!"

And at 09:42:51, to "Delete that last": "I cannot add, change or delete
anything here."

Not a misreading. The chat instruction said, in as many words, *"You cannot
add, change or delete anything"*, and the model generalised from it to
charts. A part of an app denying what the whole does is worse than an
unhelpful answer, because it teaches the owner not to ask.

It is now told what surrounds it. Files stay the one genuine limit.
Pinned by `instruction.test.ts`, which is the only thing standing between
that sentence and someone editing it back in.

### A request for insights became a ₱2,026.00 transfer

> 14:48:04 "give me insights oif all transaction under treat this may to august 2026"
> 14:48:18 "all, under treat"
> 14:48:27 "I said all"
> 14:48:37 "ok maya"
> 14:48:53 "what is this???"
> 14:49:04 rejected: 2026-08-29 Transfer ₱2,026.00

Two faults in one sentence. `isQuestion` was anchored at the start of the
message and none of these open with one of its words, so a plain request read
as something that had happened. And the year in the date range was read as
money.

Phrases and not bare words, because "give me" is a request and "I give 1000 to
my friend" is an entry and they share a verb.

### It was reading the chat, and half of what it read was noise

The conversation sent to the model was built by subtracting card types.
Cards, charts, found lists and debt cards carry no text, so the history
arriving at the model was full of `found: undefined` with roles it had never
been told about. Six turns go back with each question and about half of them
are cards, so it was often seeing nothing.

The rule is positive now: a turn is conversation when it is words somebody
said. A kind added later has to opt in rather than leak in, which is the
property that failed here twice.

### "delete all data entered by ai", asked three times, did nothing

`ai` is two letters and the finder drops words under three. More
fundamentally it is not a description of a row: every rule there asks which
one you meant, and the answer was all of them. `entrySource` is written on
every row at save time, so the ledger already knew.

### "discard all" ignored, then eleven cards rejected by hand

09:31:18 through 09:31:48. One message now clears every open card. Nothing is
confirmed, because a card has been added to nothing.

### Four things in one sentence, one row

> "Transfer 1000 to my firend maya payment for things I bought and also add
> spending treat food 1000 paid gcash and also I paid my spotify and globe at
> home for next month"

Splitting only ever looked at line breaks. Splitting liberally is safe
because a piece is kept only when it reads as an entry on its own: the cost
of a wrong split is a discarded guess, not a wrong row.

### Whose account the money went to

Four separate faults, all in the one decision that changes what a month cost:

- **"to my mom's gcash"** named Gcash the way "to gcash" does, so money given
  away counted as nothing spent.
- **"to my savings"** matched no account, and an unmatched destination was
  read as money gone, so saving counted as spending.
- **"I withdrew 5000 to buy food"** read its own reason as a recipient.
- **"I paid my friend 600"** came back as Gas, and "1000" as Food, because
  "paid" put them on the spending path and the spending path has to name a
  thing, so it found a coincidence. Paying a person has no thing in it.

### Corrections

- **"edit them 2026" set the amount to ₱2,026.00.** A bare year only counted
  as a date when the message also said "date" or "year".
- **One correction reached one of eleven cards.** "to all" now reaches every
  card, worked out per card so each keeps its own day.
- **"new laptop not lkaptop" did nothing.** The most natural correction there
  is, and the only one where both halves have already been said.

### Charts were thrown away on reload

Now stored as the figures they drew and redrawn by the same renderer. The
message text carries what the chart says in words, so the model can answer a
follow-up from it. Photos remain the one thing never kept.

### Charts answered a different question than the one asked

Asked "chart about treats this past 3 months", drawn "Spending by item,
August 2026" with every item in the ledger. Both halves ignored. Probing
every phrasing against the real ledger found four more:

| Asked | Drawn |
|---|---|
| "chart my income this year" | Spending by item |
| "chart my revenue per month" | Spending by month |
| "chart last month" | August, the month it already is |
| "chart this week" / "chart yesterday" | the whole of August |

The income ones are the worst: not imprecise, the opposite. Every chart
counted spending because nothing ever asked which direction was wanted.

A chart is a claim about money, and one that quietly answers a different
question is worse than no chart, because it looks like an answer.

Still not handled, and now known: "compare july and august" draws July
alone. Two windows in one chart is a different shape and needs more than a
window function.

### Debt could not be finished in the chat

The credit line and the effect are offered as buttons. Picking the effect
moves the wallet to the side that effect implies: borrowing puts money in,
and left where the reader parked it the balance would move by twice the draw
in the wrong direction.

---

## 3. The manual form

Found by sweeping the ledger, not by reading the code, which is why they had
survived. Each saves cleanly and each is wrong in a way no screen mentioned.

| Fault | What it cost |
|---|---|
| **A negative fee was never checked** | `total = amount + fee`, so a fee of minus fifty turned a hundred peso row into a fifty peso one. The database stores it: its rule checks the parts add up, not which way they point. |
| **No upper bound** | `firestore.rules` stops at ±₱1,000,000,000, so a larger figure was refused at the write with "Missing or insufficient permissions": true, unhelpful, and indistinguishable from the rules not being deployed. |
| **A row with no item** | Record #442 is Spending, ₱371.00, item blank. Real money, invisible to every report that groups by item. A warning rather than an error, because some imported history has none and refusing would make the owner's own past unwritable. |

## 4. Two mistakes made during this work

Recorded because both are the kind that repeat.

**A regression, caught before it shipped.** The override that turns a
model-routed question back into an entry keys on `isQuestion`, and "give me
insights..." passed it. The override would have forced exactly the wrong
reading rather than correcting one. It was found by probing the real
sentences from the record against the new code, which is worth doing every
time an override like that is added.

**The backslash trap, for the fifth time.** Writing a regex through a Bash
heredoc silently eats `\`, producing a file that fails to parse or, worse,
one that parses and matches nothing. Use the Write and Edit tools for
anything containing a regex, and audit with:

```bash
python -c "import io,glob; print([p for p in glob.glob('src/**/*.ts',recursive=True) if any(ord(c)<32 and c not in '\n\r\t' for c in io.open(p,encoding='utf-8').read())])"
```

---

## 5. Still open

- **"I buy load using gcash 30 pesos" proposes Emergency.** There is no Load
  item in the owner's list, so the word vote lands on a coincidence.
  Tightening the vote to require two agreeing words was tried and reverted:
  it broke "restaurant" finding Food, which is the same mechanism working
  correctly. The fault is asking the question at all when nothing in the
  sentence names a thing.
- **"also in gcash 100000000 too"** as a continuation of the entry above it.
- **Archiving a transaction**, which needs the owner to say whether an
  archived row still counts. See `docs/11-CODERVIEW-IS-TEMPORARY.md` §3.2.
- **105 asked against 27 answered.** Better than 86 against 19, still poor.

---

## 6. Do not lose these

Every fix above has a test named after the fault, so the reasoning survives
the fix:

`chartAccuracy.test.ts` · `transferSide.test.ts` · `askingNotEntering.test.ts` · `splitEntries.test.ts` ·
`sweep.test.ts` · `discardAll.test.ts` · `everyCard.test.ts` ·
`spokenHistory.test.ts` · `chartMemory.test.ts` · `fromHistory.test.ts` ·
`debtChat.test.ts` · `bulkBin.test.ts` · `manualEntry.test.ts` ·
`instruction.test.ts`

And the tool that made it possible is temporary: `?coderview` should be
removed when this work is finished. The six-step removal is in
`docs/11-CODERVIEW-IS-TEMPORARY.md`.
