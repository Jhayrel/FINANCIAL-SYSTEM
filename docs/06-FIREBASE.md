# Firebase setup

Everything the app needs to run on Firebase instead of browser storage.
Follow this in order. Steps 1–3 must happen in the console before the app can
connect at all.

Project: **FINANCIAL SYSTEM** (`financial-system-c2997`), region
`asia-southeast1` (Singapore).

---

## 0. About the Realtime Database that is already there

The project has **Realtime Database** provisioned. This app does not use it.

RTDB and Firestore are two separate products that happen to live in the same
console. The spec calls for **Firestore** (CLAUDE.md §3): it has per-document
security rules, real queries, and typed field validation, none of which RTDB
offers in a form that can express "money must be an integer" or "this row may
never be deleted".

**Leave the Realtime Database rules exactly as they are:**

```json
{
  "rules": {
    ".read": false,
    ".write": false
  }
}
```

That is the locked default, and it is correct. Nothing should ever read or
write there. Do not delete the database; just leave it closed. Everything below
is about Firestore.

---

## 1. Create the Firestore database

Firebase console → **Build → Firestore Database** → *Create database*.

| Choice | Value | Why |
|---|---|---|
| Mode | **Production mode** | Starts denied. Test mode is world-writable for 30 days, never acceptable for a ledger. |
| Location | `asia-southeast1` | Same region as the existing RTDB, closest to you. **This cannot be changed later.** |

---

## 2. Enable Google sign-in

Console → **Build → Authentication** → *Get started* → **Sign-in method** →
**Google** → enable → save.

Then sign in to the app once (step 5). Your account appears under
**Authentication → Users**; copy the **User UID**. You need it twice, in steps
3 and 4.

Why auth at all, for one user? Because the rules key off the uid. Without a
signed-in owner, every read and write is denied, which is exactly what should
happen if someone finds the URL.

---

## 3. Publish the security rules

The rules live in [`firestore.rules`](../firestore.rules) at the repo root.

**Before publishing, replace the placeholder** on the `ownerUid()` line:

```
function ownerUid() {
  return 'REPLACE_WITH_OWNER_UID';   // ← your uid from step 2
}
```

Leaving the placeholder is safe (it denies everything), but the app will not
work until it is your real uid.

Publish either way:

**From the console**: Firestore Database → **Rules** → paste the whole file →
*Publish*.

**From the CLI**, which keeps the file in the repo as the source of truth:

```bash
npx firebase-tools deploy --only firestore:rules
```

### What the rules enforce

| # | Rule | Why |
|---|---|---|
| 1 | One owner. `request.auth.uid` must equal both the path uid and `ownerUid()`. | Signed in is not enough. Another Google account gets nothing. |
| 2 | `allow delete: if false` on every money collection. | A transaction is binned by setting `deletedAt`, never removed. A bug in the client cannot lose a record (CLAUDE.md §4). |
| 3 | `amount`, `fee`, `total` must be **integers**. | Money is centavos. A float at rest means someone did arithmetic in pesos. |
| 4 | `total == amount + fee`. | The ledger invariant, enforced at the database rather than trusted from the client. |
| 5 | A `Debt` row must carry `debtId` and a valid `debtEffect`. | An unlinked debt movement can never be reconciled (rule D1). |
| 6 | No `apiKey` / `token` / `secret` field on any document. | The AI key lives in a Cloudflare env secret. Three layers refuse it: the UI has no field, `assertNoSecrets` throws, and this rejects the write (CLAUDE.md §2, rule AI4). |
| 7 | Length caps on every string, size caps on every list. | A runaway client cannot fill the free tier with one document. |
| 8 | `match /{document=**} { allow read, write: if false; }` | A collection added by hand in the console later is not silently public. |

---

## 4. Point the app at the project

Console → **Project settings → General → Your apps → SDK setup and
configuration → Config**. Copy the values into `app/.env.local`:

```bash
cp app/.env.example app/.env.local
```

```
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=financial-system-c2997.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=financial-system-c2997
VITE_FIREBASE_STORAGE_BUCKET=financial-system-c2997.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
VITE_OWNER_UID=...
```

**All seven of these are public.** The web `apiKey` is a project identifier,
not a credential. It says which project a request belongs to, and the rules
plus the signed-in uid do the actual protecting. Hiding it would buy nothing.
The AI provider key is a different thing entirely and must never appear here.

`.env.local` is gitignored. For the deployed site, set the same seven variables
in **Cloudflare → Pages → your project → Settings → Environment variables**.

---

## 5. First run

```bash
cd app && npm run dev
```

With the variables set you get a sign-in screen instead of the dashboard. Sign
in with the owner account.

The first time it connects to an empty database, the app uploads the current
in-memory ledger, all 441 rows plus settings, and reports how many. After
that the Excel fixture is never read again; Firestore is the source of truth.

If you sign in with the wrong Google account you get a plain "that is not this
database" screen rather than a wall of permission errors.

---

## 6. What is stored where

```
users/{uid}/transactions/{id}    one document per ledger row
users/{uid}/meta/settings        accounts, goals, categories, credit lines,
                                 AI preferences, theme
users/{uid}/budgets/{year}       twelve amounts per track, index 0 = January
```

Credit lines and loans are not a collection. They live inside the settings
document as `settings.credits`, because the app always reads that short list
whole.

A binned transaction stays in `transactions` with `deletedAt` set. There is no
second collection to drift out of sync, and no code path that removes a money
record.

Offline persistence is on. Reads come from the on-device cache first, and
writes queue and replay when signal returns, which is what makes the phone
usable on mobile data.

---

## 7. Cost

The free Spark plan covers this comfortably. One user, ~450 documents, a
handful of writes a day. The daily free allowance is 50,000 reads and 20,000
writes; the live subscription reads each document once and then streams only
what changed.

No composite indexes are needed: `firestore.indexes.json` is deliberately
empty. The ledger is read as one plain collection and sorted in the client,
because 450 rows is nothing to sort and it avoids an index to maintain.

---

## 8. Troubleshooting

| Symptom | Cause |
|---|---|
| "Missing or insufficient permissions" | `ownerUid()` still says `REPLACE_WITH_OWNER_UID`, or does not match the uid you signed in with. |
| Sign-in popup opens and closes with nothing | Google is not enabled under Authentication → Sign-in method. |
| Sign-in blocked on the deployed site | Add the Cloudflare Pages domain under Authentication → Settings → Authorized domains. |
| Writes silently rejected | Read the rule that failed in the console's **Rules → Monitor** tab. The usual cause is a non-integer amount or a missing `debtId` on a Debt row. |
| App still says "This browser" under Settings → Data | The `VITE_FIREBASE_*` variables are missing or incomplete. All six are required; a partial config is treated as none. |
