# Auto-push

Binding for every Claude Code / AI agent session in this repository.
Supersedes the old "do not commit or push unless asked" in `CLAUDE.md` §6,
at the owner's instruction on 2026-08-30.

---

## P1. Push without being asked

**Commit and push after every meaningful change. Do not wait to be told.**

The owner should be able to open GitHub at any moment and see the current
state. Asking "shall I push?" wastes a turn and leaves the remote stale in the
meantime.

### What counts as meaningful

Push after any of these:

- A feature or a fix that compiles and passes tests
- A domain module plus its tests
- A documentation change
- A configuration change that affects the build or the deploy

Do **not** push:

- A half-finished edit that does not typecheck
- A change with failing tests, unless the failure is the point and is explained
  in the message
- Scratch files, debug dumps, or anything written to explore a problem

One commit per coherent change. Ten commits of "wip" are worse than one commit
that says what happened.

---

## P2. The safety check is not optional

**This repository is public, and pushing is irreversible.**

`github.com/Jhayrel/FINANCIAL-SYSTEM` is public. Anything pushed is readable by
anyone, immediately, and stays readable: GitHub is scraped and cached, and
deleting later does not reliably undo it.

The repository also sits inside a folder that holds, in gitignored form:

- the original `.xlsm`, which contains live third-party API keys in
  `CATEGORIES!U7:U16` and the complete financial history
- `app/.env.local`
- `app/src/fixtures/excel-fixture.json`, the real 440-row ledger

`.gitignore` covers all of these. **Verify it every time anyway.** A rule that
is only checked when someone remembers is not a rule.

### Before every push

```bash
git status --porcelain
```

Then confirm nothing staged matches any of:

```
*.xlsm   *.xlsx   MY THINGS/   .env   .env.*   fixtures/*.json
*.key    serviceAccount*.json   firebase-adminsdk*.json
```

If anything does, **stop and tell the owner**. Do not push, do not "fix" it by
force-adding, and do not assume a new `.gitignore` line makes it safe after the
fact: once a file is in a commit it is in the history.

**Never use `git add -f`.** The only reason to force-add is to defeat
`.gitignore`, and every rule in that file is there because the thing it names
must not be published.

---

## P3. What is already public, and what that means

The owner chose a public repository knowing that `CLAUDE.md` and `docs/`
contain 55 real peso figures: wallet balances, net worth, annual spending and
debt. That was a deliberate decision on 2026-08-30 and is not to be quietly
reversed.

It does change the standard for new files. Before writing anything that will be
committed, ask whether it would be acceptable on a billboard. A worked example
in a doc should use invented figures unless the real one is load-bearing, as
the parity targets are.

---

## P4. Commit messages say what changed and why

Conventional Commits for the subject line. The body explains the reasoning,
not the diff: the diff is already in the commit.

```
fix: derive transfer classification from the destination

"Money Send" and "Transaction Fee" were spending types picked by hand, so
forgetting to pick one silently dropped the money from every total. Record
#8 lost PHP 15.00 that way. Both are now worked out from whether the
destination is one of the owner's own accounts.

Moves the 2026 annual figure by PHP 4,115.00. August is unchanged. Pinned
per month in totals.test.ts as MONTHLY_DELTA.
```

End every commit with:

```
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

---

## P5. Never force-push, never rewrite history

`--force`, `--force-with-lease`, `reset --hard` on a pushed commit, and
`rebase` of anything already on the remote are all off limits without the owner
saying so in the moment.

A bad commit is fixed by a new commit on top. History that has been pushed is
the record of what happened, and Cloudflare Pages deploys from it.

---

## P6. Deploys follow pushes

Cloudflare Pages builds `main` automatically. **Every push to `main` deploys to
production.**

So a push is not just a save. It is a release. A commit that breaks the build
takes the live site down until the next green one, which means the pre-push
check is `npm run build`, not just the tests:

```bash
npx tsc -b && npx vitest run && npx vite build
```

All three green, then push.
