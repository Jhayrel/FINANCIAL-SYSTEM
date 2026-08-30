# Writing rules

Binding for every Claude Code / AI agent session in this repository, and for
every word that ships in the app. Referenced from `CLAUDE.md` §5.

---

## W1. No em dash. Ever.

**Do not use `—` (em dash, U+2014) in any explanation or description.**

That covers, without exception:

- UI copy: hints, help text, placeholders, empty states, error messages,
  confirmation dialogs, alert bodies, tooltips
- Documentation in `docs/`
- Code comments and JSDoc
- Commit messages and PR descriptions
- Chat replies to the owner

### Use instead

The left column is what not to write. This file is the one place in the repo
where the character legitimately appears, because a rule has to name the thing
it forbids.

| Do not write | Write |
|---|---|
| `Reserve — cash you set aside` | `Reserve: cash you set aside` |
| `It stays in history — nothing is lost` | `It stays in history. Nothing is lost.` |
| `Rewrites 6 rows — the ranking stays whole` | `Rewrites 6 rows, so the ranking stays whole` |
| `Maya Credit — open` | `Maya Credit (open)` |

A colon when the second half explains the first. A full stop when both halves
are complete thoughts. A comma when it is a genuine aside. Parentheses when it
is a label and a state. If none of those fit, the sentence was doing too much:
split it.

### Why

An em dash is a shrug. It lets a sentence attach a second idea without saying
how the two relate. In a finance app that is a real cost: "Transfer fee is not
categorised as Spending — it leaves the wallet without counting as an expense"
hides whether the second clause is the cause, the consequence, or a restatement.
Picking a colon, a full stop, or a comma forces that decision, and the reader
gets the answer instead of a pause.

---

## W2. The minus sign is not a dash

`−` (U+2212 MINUS SIGN) is the correct character for a negative amount, and W1
does not touch it. See `docs/04-STYLE-GUIDE.md` §2.2 and `domain/money.ts`.

Also untouched:

- `–` (U+2013 en dash) in ranges: `January – August 2026`
- `-` (hyphen) inside words and identifiers: `maya-credit`, `low-balance`
- `─` (U+2500) in the box-drawing rules that separate code sections
- A bare `—` alone in a table cell, meaning "no value". That is a symbol,
  not a sentence, and it is what the Database and Debt tables already use.

---

## W3. Say what happened and what to do

Already rule D8 in the style guide, restated here because it is a writing rule.
No "Something went wrong". An error names the thing that failed and the next
action. An empty state names an action, not an absence.

---

## Checking

```bash
grep -rn $'—' app/src docs CLAUDE.md --include=*.ts --include=*.tsx --include=*.md
```

Any hit in a string literal, a comment, or prose is a violation. Hits inside
`docs/01-SYSTEM-REVIEW-AND-SPEC.md` and `docs/02-BUILD-PROMPT.md` are the
owner's own earlier drafts and are left alone: this rule governs what gets
written from here, not a rewrite of the source documents.
