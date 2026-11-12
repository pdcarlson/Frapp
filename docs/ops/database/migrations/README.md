# Migration ledger pages

Each migration created since 2026-11-12 has one page here, named after it:
`supabase/migrations/20261113093000_add_polls.sql` is ledgered in
`20261113093000_add_polls.md`. The page holds what used to be two entries, one
at the top of [`promotion-log.md`](../promotion-log.md) and one at the top of
[`db-rollback-playbook.md`](../../db-rollback-playbook.md). Every migration PR
prepended to those two shared files, so each merge conflicted every other open
migration PR. A page per migration can't conflict.

## Writing one

`npm run migration:new -- add_polls` creates the SQL file and its page from the
template, with a version after both the clock and everything on `main`. Fill in:

- `## Promotion`: **Purpose**, **Checks** (queries to run after `db push`) and
  **Promoter notes** (deploy order against the API, data writes, hand steps).
- `## Rollback`: when reverting is worth it and how, as a forward-migration
  `sql` block, or "not reversible, restore from backup" with the steps. Link
  shared procedure in the playbook ([§ Decision matrix](../../db-rollback-playbook.md#decision-matrix),
  [§ 3) Undo one migration](../../db-rollback-playbook.md#3-undo-one-migration)) rather than copying it.

`check:migration-safety` reads the two heading lines `## Promotion` and
`## Rollback`, and refuses a page that still has the template's
`TODO(migration:new)` text; either problem is reported by the page's name. The two shared docs
still count for older migrations and for a PR opened before this page existed.

## When `main` moves past your migration

Usually the base-sync sweep has fixed it already. When `main` moves, it checks
each clean PR from this repository that it reaches, and when the PR's
migrations no longer sort after `main`'s it pushes one commit to the branch that
merges `main` and renumbers them, so `git pull` before doing it yourself. It
leaves it to you, with the command below in a wake comment, when it can't do it
safely (a fork, a branch that changes a workflow, a bare old version left in a
file): [`pr-babysitting.md` § Base-branch
sync](../../../ci-cd/pr-babysitting.md#base-branch-sync-scriptscipr-base-syncmjs).
It can't see a migration you applied by hand, so don't apply a branch's own.

`migration-order` requires every migration a PR adds to sort after everything
on `main`. When another PR merges a newer one first, run:

```bash
git merge origin/main
npm run migration:renumber
```

It moves the branch's own migrations and their pages to fresh versions (keeping
their order) and rewrites references in the files the branch changed. A bare
version left in a file the branch only edited (an anchor in a shared doc) is
listed for you to check, because it may be `main`'s migration of the same
version. `--dry-run` shows the plan first. Never renumber a migration that is on
`main`, or one you applied to a hosted database by hand: that database keeps a
ledger row no file explains, and every later `db push` there refuses.
