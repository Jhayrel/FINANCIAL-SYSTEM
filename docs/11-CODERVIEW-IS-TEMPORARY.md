# Coderview is temporary. Patch it out when the system is done.

**Added 2026-08-31. Remove before the system is called finished.**

`?coderview` prints the entire database as plain text so the assistant's own
record of what it proposed, and what you corrected, can be read while the
assistant is being fixed. It exists because that record is the only honest
answer to "why does it keep getting this wrong", and there was no way to read
it from outside your signed-in session.

It is a debugging tool. It is not a feature, it was never designed, and it
should not outlive the debugging.

---

## Why it must not stay

It is not a security hole today. It reads and never writes, it is owner-only
like every other screen, and the Firestore rules are what protect the data
either way. But it is one URL that turns your entire financial history into a
single copy-pasteable block, and that is a shape worth removing once it has
served its purpose:

- A dump is easy to leave in Downloads, attach to something, or paste into a
  chat window. The app's other screens do not produce one.
- It is the only screen with no design and no place in the navigation, so it
  will not be noticed when other things are reviewed.
- Its two Firestore rules exist for it alone. Rules that outlive their reason
  are how a permissions file stops being readable.

---

## The removal, in full

Nothing else depends on any of this. Deleting it cannot break a screen.

1. **The screen.** Delete `app/src/features/CoderView.tsx` and
   `app/src/features/coderview.test.ts`.

2. **The route.** In `app/src/App.tsx`, delete the `import { CoderView }` line
   and the `window.location.search.includes("coderview")` block just after the
   sign-in gate.

3. **The rules.** In `firestore.rules`, delete the block headed
   "Reading the whole database at once", which is the two `read` rules for
   `users/{uid}` and `users/{uid}/meta/{docId}`, then redeploy:

   ```bash
   npx firebase deploy --only firestore:rules --project financial-system-c2997
   ```

   Deploying matters. Deleting them from the file changes nothing until the
   deploy runs, and a rule that only exists in git is not a rule.

4. **The ignore lines.** In `.gitignore`, the `coderview*.txt`,
   `coderview*.json`, `coderview*.md` and `CODERVIEW/` entries can go. Leave
   them if any dumps are still on disk: an ignore rule for a file that exists
   is doing its job.

5. **The dumps themselves.** Delete every saved dump. They are complete copies
   of the ledger with no protection on them at all. `MY THINGS/CODERVIEW/` is
   where they were meant to go, so look there first, then in Downloads.

6. **This file.** Delete it too. It only describes something that is gone.

---

## What to keep

The two things that came out of this work and should outlive it:

- `transferSide.test.ts`, which pins whose account a transfer landed in. That
  is a money bug, not a debugging convenience.
- Whatever else the AI history turns out to explain. Every fix made from
  reading a dump should end up in a test, so the fix survives the tool that
  found it.

---

## When "done" is

Not a date. The condition is: the assistant's corrections have been read, the
faults they show have been fixed, and the fixes are pinned by tests. After
that this screen has nothing left to tell anyone, and every day it stays is a
day of risk bought for nothing.
