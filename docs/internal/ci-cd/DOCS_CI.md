# Docs/spec CI checks

## What runs

Two workflows, one job each.

- **Docs checks** (`.github/workflows/docs.yml`) — the `env-slugs` job, below.
- **Links** (`.github/workflows/links.yml`) — lychee, offline, over `docs/`, `spec/`, `.claude/`,
  `AGENTS.md`, `README.md` and `CONTRIBUTING.md`: markdown links and heading anchors resolve.
  External URLs are never fetched.

Both are ASSERTIVE: each checks a fact, costs nothing when you are right, and cannot be satisfied by
noise. Keep it that way. A COERCIVE check — one that requires a doc *write* rather than checking
anything — cannot tell truth from filler, so it gets filler. This repo had exactly one,
`docs-spec-sync`, and deleted it in #1597. Do not add one back. The measured account sits at the
site where the temptation is acted on: `DOCS_CHECKS` in
[`required-checks.mjs`](../../../scripts/ci/lib/required-checks.mjs).

## Env slugs (`check-env-slugs.mjs`)

Asserts that every Infisical environment named anywhere in the repo is one that exists: `dev`,
`staging`, `prod`. It reads the tree, not the diff — a reference and the slug list it must match sit
in different files — and it scans configs, workflows, `package.json` and `docs/`/`spec/` code
samples alike, because a wrong slug in a script is the same defect as one in prose. That is also why
it is **not** a documentation gate and has its own job: a failure should name what it is.

The trap it catches already bit us. Infisical environments carry a display *name* and a separate
*slug*, two of our three differ ("Development" is `dev`, "Production" is `prod`), and a `local`
environment that never existed reached six docs and all five `npm run dev:*` scripts, which could
never resolve. A wrong slug does not warn; it fails. The full account, and the scan's exact inputs,
are in the script's own header.

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

What closes that is [`DOCUMENTATION_CONVENTIONS.md`](../DOCUMENTATION_CONVENTIONS.md) — one
canonical place per fact, and verify a claim against whatever owns it before you act on it — read
when you rely on a doc, and applied to a diff by the docs angle in
[`diff-review`](../../../.claude/skills/diff-review/SKILL.md) before a push.
