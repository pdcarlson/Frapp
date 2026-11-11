# What's new lines waiting to ship

A PR that changes what members see or can do adds its What's new line here, as
its own file: `<short-name>.md`, holding one sentence written by the rules at
the top of [`../src/release-notes.ts`](../src/release-notes.ts) (plain member
words; no issue numbers, versions, internal names, emojis or em dashes). Say
"on the web" or "on your phone" when it is only on one. One PR can add several
files; a PR that changes nothing a member would notice adds none.

Don't edit `RELEASE_NOTES` for a new line: parallel PRs would conflict on it.
After each merge to `main`, the What's new fold workflow
(`.github/workflows/release-notes-fold.yml`, script
`scripts/release-notes-fold.mjs`) moves the waiting lines into the list under
that day's date and deletes their files, in a bot PR that merges itself once CI
is green. A line merged shortly before a production deploy may ship in the next
one.

Every PR checks the lines here against the writing rules
(`scripts/ci/__tests__/release-notes-fold.test.mjs`), so a bad line fails in
the PR that adds it.
