# Docs/spec CI checks

## What runs

Two workflows, one job each.

- **Docs checks** (`.github/workflows/docs.yml`) — the `env-slugs` job, below.
- **Links** (`.github/workflows/links.yml`) — lychee, offline, over `docs/`, `spec/`, `.claude/`,
  `AGENTS.md`, `README.md`, `CONTRIBUTING.md`, `apps/web/AGENTS.md` and
  `.github/pull_request_template.md`: markdown links and heading anchors resolve. External URLs are
  never fetched.

Both are ASSERTIVE: each checks a fact, costs nothing when you are right, and cannot be satisfied by
noise. Keep it that way. A COERCIVE check — one that requires a doc *write* rather than checking
anything — cannot tell truth from filler, so it gets filler. This repo had exactly one,
`docs-spec-sync`, and deleted it in #1597. Do not add one back. The measured account sits at the
site where the temptation is acted on: `DOCS_CHECKS` in
[`required-checks.mjs`](../../../scripts/ci/lib/required-checks.mjs).

## Env slugs (`check-env-slugs.mjs`)

Asserts that every Infisical environment slug named in the files it scans is one that exists: `dev`,
`staging`, `prod`. It reads the tree, not the diff — a reference and the slug list it must match sit
in different files.

**It scans a fixed list, not the repo, and matches fixed syntaxes rather than any mention of a
slug.** `SCAN_ROOTS` is `package.json`, `.infisical.json`, `.github/environments.json`,
`.github/workflows`, `.github/actions`, `docs`, `spec`, and `ENV_REFERENCE.md` itself — which is
listed separately so its absence is caught, not just its content. Within those it reads
`infisical run --env=`, `.infisical.json`'s `defaultEnvironment` and branch mapping, `env-slug:` in
workflows and actions, `--env=` in `docs`/`spec` code samples, and `infisicalEnvSlug` in the
environments config. A slug carried by any other syntax — an `infisical-environment:` input, an
`INFISICAL_ENV` variable — is not seen even inside a scanned file. Configs and workflows are in scope alongside prose because a wrong slug in a script is the
same defect as one in a doc — which is also why this is **not** a documentation gate and has its own
job: a failure should name what it is. Everything outside that list is unscanned, `.claude/`,
`scripts/`, `apps/` and the root `README.md` included. Read `SCAN_ROOTS` rather than this sentence
when the boundary matters.

The rule it encodes is one line: **an Infisical environment's display name and its slug are
different strings, so never infer a slug from a name.** Ours differ, a slug that does not exist
never resolves, and nothing warns you first. The worked account of the failure that produced this
gate — which names and which slugs, and how far the wrong one spread — is in the script's own
header, which is the canonical telling; do not restate it here.

`INFISICAL_ENV_SLUGS` in the script is the only copy of the slug list, mirrored from **Infisical →
Project Settings → Environments**; [`ENV_REFERENCE.md`](../environment/ENV_REFERENCE.md)
§ Infisical Environments is the doc it is asserted against. On a genuine rename update both — do
**not** widen the list to silence a failing reference. The gate cannot see a dashboard rename; that
surfaces as a failing deploy run.

## What none of these check

Almost everything. Nothing verifies that a repo path cited in backticks resolves, that a doc sits
in a declared home or matches the naming rule, that a reference from source, a workflow or a
migration still names a real file, or that a hand-copied roster matches its source. Gates for those existed
and were deleted; git history is their record. And beyond the env-slug case above, nothing has ever
checked whether a doc's **claims** are true — so a doc can pass everything here and still be
confidently wrong.

The worked example of that class: the spec split in
[#432](https://github.com/pdcarlson/Frapp/issues/432) left dead pointers nothing caught for months —
`apps/api/README.md` named three files that no longer existed, and `supabase/seed.sql` still pointed
at the pre-split behavior spec. Both were found by hand.

**How big the unchecked surface is.** When the reference gate was added it reported roughly 770 path
references and 470 filename references across 530 files (2026-09-02) — the last measurement taken
before it was deleted, and the size of what is now unwatched. It moves with the tree, so treat it as
an order of magnitude rather than a current count.

**A file can be inside one checker and outside the rest.** lychee walks every file listed above, so
a broken markdown link or heading anchor is caught wherever it lives. Nothing checks a **backticked
path citation** anywhere any more — that was `doc-paths`, and it is gone — so a doc naming a file
that has moved reads exactly as it did before, in every file in the corpus. The env-slug gate is
narrower still: it reads only the `SCAN_ROOTS` listed above, so a wrong Infisical slug outside them
is caught by nothing.

What closes that is [`DOCUMENTATION_CONVENTIONS.md`](../DOCUMENTATION_CONVENTIONS.md) — one
canonical place per fact, and verify a claim against whatever owns it before you act on it — read
when you rely on a doc, and applied to a diff by the docs angle in
[`diff-review`](../../../.claude/skills/diff-review/SKILL.md) before a push.
