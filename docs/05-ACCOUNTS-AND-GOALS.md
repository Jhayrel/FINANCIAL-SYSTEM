# Accounts, Reserves and Goals, the rules

**Added:** 29 Aug 2026 · Supersedes the flat "wallets + savings" lists in
`01-SYSTEM-REVIEW-AND-SPEC.md` §4.5.

The Excel had two lists, `ACTIVE WALLET` and `SAVINGS`, and everything had to
be one or the other. That was already breaking down: `Reserved Fund`,
`Allowance (Reserve)` and `Tuition (Reserve)` sat in the wallet list but are not
wallets, and `Maya Bank (Drone)` / `Maya Bank (New Phone)` were savings goals
pretending to be accounts.

This document names those things properly.

---

## 1. The four account kinds

| Kind | What it is | Your examples | In net worth? | In the daily budget? |
|---|---|---|:--:|:--:|
| **Spending** | Money you actually spend from, day to day | Gcash · Maya · Cash | ✔ | ✔ |
| **Reserve** | Cash you have set aside and hidden. Still yours, still liquid, but not for everyday use | Reserved Fund · Allowance (Reserve) · Tuition (Reserve) · Hidden cash (fieldtrip) | ✔ | ✖ |
| **Savings** | Held somewhere longer-term | Maya Bank (Personal savings) · Extra Cash | ✔ | ✖ |
| **Goal** | A savings target inside a parent account | Maya Bank (Drone) · Maya Bank (New Phone) | ✔ | ✖ |

**The word for your stash is Reserve.** You already named them that way. A
reserve is not spending money and not long-term savings, it is money you have
deliberately put out of reach of yourself.

### Why the distinction earns its keep

The daily allocation divides your balance by the days left in the month. Today
it uses `wallets` only, so your reserves are correctly excluded, but only by
accident, because they happen to sit at ₱0.00. The moment you put ₱5,000 into
`Tuition (Reserve)`, the old model would have offered it to you as spending
money. The `reserve` kind makes that exclusion deliberate instead of lucky.

### Rules

| # | Rule |
|---|---|
| A1 | Every account has exactly one kind. |
| A2 | **Net worth counts all four.** Money hidden from yourself is still yours. |
| A3 | **Only `spending` accounts feed the daily budget** and the smart allocation. |
| A4 | Moving money between your own accounts is a **Transfer**, never income, never spending, whatever the kinds involved. |
| A5 | Taking money *out* of a `savings`, `reserve` or `goal` account warns you before saving. Proceed-able, but never silent. |
| A6 | An account is **never deleted** while history references it. It is archived: hidden from pickers, still counted, still shown under "Retired" in Settings. |
| A7 | Historical rows may name accounts that no longer exist. Never validate old data against the current list. |

---

## 2. Goals

> *"in maya bank I can also separate some funds like a goal, titled buy iphone,
> set a deadline, and after the deadline month it auto closes"*

### The honest constraint

This system has no bank connection. It knows only what you type. So a goal
cannot *observe* that ₱800 of your Maya Bank balance is set aside, something
has to record it.

Your ledger already solved this without naming it. `Maya Bank (Drone)` and
`Maya Bank (New Phone)` are goals implemented as separate accounts, funded by
ordinary transfers. That works, the balance engine already handles it exactly
right, and it needs no new maths.

**So: a goal IS an account**, with a parent, a target and a deadline.

```ts
interface Goal {
  id: string;
  name: string;            // "Buy iPhone"
  parentAccountId: string; // "Maya Bank (Personal savings)"
  target: Centavos;        // ₱65,000.00
  deadline: IsoDate;       // 2027-02-28
  openedDate: IsoDate;
  archived: boolean;
}
```

### Funding a goal

You record a **Transfer** from any account into the goal. That is it. The
balance rule needs no change:

```
Maya Bank (Personal savings)  →  Maya Bank (iPhone)     ₱5,000.00
```

The parent drops ₱5,000, the goal rises ₱5,000, net worth is unchanged. Taking
money back out is the same transfer in reverse.

### Progress

```
saved     = balance of the goal account
progress  = saved / target                     (0 when target is 0)
remaining = max(0, target − saved)
```

### Pace, the useful part

```
daysLeft       = deadline − today
monthsLeft     = daysLeft / 30.44
requiredPerMonth = remaining / max(1, monthsLeft)
```

`requiredPerMonth` is the number worth showing: *"₱10,000 a month to make it."*

### Status, computed, never stored

| Status | When |
|---|---|
| `active` | Before the deadline, target not yet met |
| `reached` | `saved ≥ target`, at any time |
| `matured` | Deadline has passed and `saved < target` |
| `archived` | You archived it by hand |

### What "auto close" means here

**The system computes the status. It never moves your money.**

When the deadline month ends, the goal stops being `active`, it becomes
`reached` or `matured`, drops out of the active list, and stops counting
against your pace. What it does **not** do is sweep the balance back to the
parent, because that would be the app inventing a transaction you never made.

Instead, a matured or reached goal shows one prompt:

> **Buy iPhone reached ₱65,000.00.** Spend it, or move it back to Maya Bank?
> `[ Record a withdrawal ]` `[ Move back to parent ]` `[ Keep it open ]`

Both buttons pre-fill a normal transfer for you to confirm. Every peso that
moves is still a row you approved.

| # | Rule |
|---|---|
| G1 | A goal is an account with `kind: "goal"` and a `parentAccountId`. |
| G2 | Funding is an ordinary Transfer. No special maths, no parallel ledger. |
| G3 | Status is **derived** from balance, target and deadline. Never stored. |
| G4 | Reaching a deadline changes status only. **The app never moves money by itself.** |
| G5 | A goal's balance is part of net worth and of its parent's total, but never of the daily budget. |
| G6 | Deleting a goal with a balance is refused, move the money out first. |
| G7 | Overshooting the target is fine and is shown as such. |

---

## 3. Everything in Settings is editable and stored

| List | Editable | Notes |
|---|:--:|---|
| Accounts (all four kinds) | ✔ | Rename, change kind, archive. Never hard-delete with history. |
| Goals | ✔ | Target, deadline, parent, archive |
| Bills | ✔ | Drives the one-month-after-last-payment prediction |
| Subscriptions | ✔ | Same, separate budget line |
| Revenue categories | ✔ | |
| **Spending types** | ✔ | Name **and** remark. This is the authoritative list for every ranking |
| Budgets | ✔ | 12 months × 3 tracks |
| Theme | ✔ | |
| AI settings | ✔ | See §4, everything except the key |

### Renaming

Renaming an account or spending type **rewrites every historical row that
references it**, inside one atomic write. The alternative, leaving history
pointing at the old name, silently splits a category in two and quietly
corrupts every ranking. A rename shows how many rows it will touch before it
runs.

---

## 4. AI, and where the key lives

You want AI alerts and auto-written summaries. That works. The key does not go
in the database, and this is not a style preference.

### Why not

A browser app that reads its key from the database has to **send that key to
the browser**. Once there it is in devtools, in the network tab, in any browser
extension's reach, and in every database export. It is strictly worse than the
spreadsheet cell that already leaked three of your keys.

### The design that works

```
Browser  ──►  /api/ai  (Cloudflare Pages Function)  ──►  provider
              key from an environment secret
              the browser never sees it
```

**Stored in the database** (all editable in Settings):

| Setting | Example |
|---|---|
| AI enabled | on / off |
| Provider | Groq · OpenRouter · OpenAI · Anthropic |
| Model | `llama-3.3-70b-versatile` |
| Which features use it | alerts · insight summary · descriptions |
| Tone | brief · plain · detailed |

**Not stored anywhere in the app:** the key. It goes in the Cloudflare
dashboard once, Pages → your project → Settings → Environment variables →
`AI_API_KEY` (encrypted). Rotate it there without touching the app.

### Rules

| # | Rule |
|---|---|
| AI1 | The rule-based output is computed **first, always**. The model only rewrites it. |
| AI2 | 4-second hard timeout. A slow provider must never block you entering a transaction. |
| AI3 | Failure is silent, you see the rule-based text and nothing looks broken. |
| AI4 | The key lives only in a Cloudflare environment secret. |
| AI5 | Only figures the app already computed are sent. Never the whole ledger. |
| AI6 | AI never writes to the ledger. It produces text, nothing else. |

> If you would still rather paste the key into Settings after reading this, say
> so and I will build it, but it will carry a visible warning in the UI, and
> `CLAUDE.md` gets amended so no future session "fixes" it back.

---

## 5. Migration from the current lists

| Currently | Becomes |
|---|---|
| `ACTIVE WALLET`: Gcash, Maya, Cash | kind `spending` |
| `ACTIVE WALLET`: Reserved Fund, Allowance (Reserve), Tuition (Reserve) | kind **`reserve`** |
| `SAVINGS`: Extra Cash, Maya Bank (Personal savings) | kind `savings` |
| History only: Hidden cash (fieldtrip) | kind `reserve`, archived |
| History only: Maya Bank (Drone), Maya Bank (New Phone) | kind **`goal`**, parent Maya Bank (Personal savings), archived |

**Balances do not move.** This is a classification change, exactly like the debt
migration, and the same test applies: every account balance must be identical
before and after.
