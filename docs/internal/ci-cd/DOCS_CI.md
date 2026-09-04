# Docs/spec CI checks

## What runs

On pull requests to `main`, `.github/workflows/docs.yml` (workflow display name
**Docs checks**) runs **four jobs** covering **five** checks. They are separate on purpose: each
asserts one thing, and each fails with a different fix.

Every one of them is ASSERTIVE: it checks a fact, costs nothing when you are right, and cannot be
satisfied by noise. That is deliberate. The one COERCIVE check this workflow used to carry —
`docs-spec-sync`, which required a doc *write* rather than checking anything — was deleted in #1597
because a gate that cannot tell truth from filler gets filler.

| Check | Script | Asserts | Scope | Job | Required? |
|---|---|---|---|---|---|
| Structure | [`check-docs-structure.mjs`](../../../scripts/check-docs-structure.mjs) | Every file under `docs/`/`spec/` sits in a declared home and matches the naming rule, per [`scripts/ci/lib/docs-structure.mjs`](../../../scripts/ci/lib/docs-structure.mjs) | Whole tree | `docs-structure` | Not yet — see rollout below |
| Citations | [`check-doc-paths.mjs`](../../../scripts/check-doc-paths.mjs) | Backticked repo-path citations resolve to real files | Whole tree | `doc-paths` | **Yes** — in `DOCS_CHECKS` |
| References | [`check-doc-refs.mjs`](../../../scripts/check-doc-refs.mjs) | In files OUTSIDE the docs corpus (source, workflows, migrations, shell): bare `docs/`/`spec/` paths resolve, and bare markdown filenames still name a tracked file | Whole tree | `doc-refs` | Not yet — see rollout below |
| Rosters | [`check-doc-tables.mjs`](../../../scripts/check-doc-tables.mjs) | Hand-copied required-check rosters and per-job suite lists match `CI_CHECKS` / `DOCS_CHECKS` and `ci.yml`; the placement map and the two index READMEs match `DIRECTORIES` | Whole tree | `doc-tables` | Not yet — see rollout below |
| Env slugs | [`check-env-slugs.mjs`](../../../scripts/check-env-slugs.mjs) | Every Infisical environment named anywhere is one that exists | Whole tree | `doc-tables` (same job) | Not yet — inherits `doc-tables` |

### Citations (`check-doc-paths.mjs`)

This covers the blind spot in the **`Links`** workflow. lychee validates markdown links and heading
anchors; it never sees a file cited as inline code — `` `apps/api/src/main.ts` `` — which is how
these docs overwhelmingly cite the repo. Those citations rot silently when a file moves.

- **Scope:** `docs/`, `spec/`, every `AGENTS.md`, `.claude/skills/**/*.md`, and root `README.md` /
  `CONTRIBUTING.md`. Skills and `AGENTS.md` are included because a wrong path there misroutes an
  agent before a human reads it. `spec/ui/design-system/reference/` is excluded, matching the
  `Links` gate's exclusion of the same directory.
- **Whole-tree, not diff-based.** A citation breaks when the file it names moves — a change on the
  *other* side of the reference — so a diff-scoped check would miss the case it exists to catch.
- **Resolution** is tried three ways: repo root, the citing file's own directory, and a
  trailing-segment match (so a bare `main.ts` legitimately names `apps/api/src/main.ts`). When
  exactly one tracked file shares the basename, the failure names it: *"did it move to …?"*.
- **Noise** — globs, `<placeholders>`, fenced code blocks, prose elisions — is skipped by heuristic,
  not by allowlist.

**Deliberate dead references** — a removals/renames table, an ADR amendment naming a deleted file —
go in [`scripts/doc-paths-allowlist.json`](../../../scripts/doc-paths-allowlist.json). Entries are
scoped `perFile` by preference, since a dead path that is deliberate in one doc is usually a real bug
in another, and **every entry requires a `reason`** (the script exits 2 without one). Entries that
stop matching anything **fail the check**, so the allowlist shrinks as docs get fixed rather than
accumulating stale excuses.

Run locally: `npm run check:doc-paths` — but **`git add` your new docs first**. It enumerates via
`git ls-files`, so an untracked file is not scanned at all and the run passes without ever reading
it. CI checks out a commit, where everything is tracked, so a new doc that cites a dead path passes
locally and fails on the PR. Unit tests: `scripts/ci/__tests__/check-doc-paths.test.mjs`,
covered by the `ci-scripts-tests` job.

**Rollout.** `doc-paths` was added to `DOCS_CHECKS` on **2026-08-21**, after a year of reporting
only. Because it is whole-tree, that means a PR renaming a source file can be blocked by a
citation in a doc it never touched. The trade was accepted deliberately: the alternative is
citations rotting silently, and the size of `scripts/doc-paths-allowlist.json` is the evidence of
how much rot accumulated while it only reported.

Being in the array is *intent*, not live state — branch protection changes only when an admin runs
`npm run configure:branch-protection`. That is a human step with an admin PAT: the bare command is a
live `PUT`, and an agent session runs `npm run configure:branch-protection:verify` (which writes
nothing) and nothing else. Ask for the apply once this lands and `main` is green; read live state
per [`GITHUB_BRANCH_PROTECTION_RUNBOOK.md`](../ops/GITHUB_BRANCH_PROTECTION_RUNBOOK.md).

### References (`check-doc-refs.mjs`)

**Citations** is whole-tree but its scope *is* the documentation. Everything else — source, tests,
workflows, migrations, shell scripts — cites docs constantly and was checked by nothing. At the time
this gate was added that was roughly 770 path references and 470 filename references across 530
files (2026-09-02). It prints the live counts on every run, and those are the numbers to trust — an
exact figure written here would be stale by the next commit, which is the failure this whole page is
about.

The gap was not hypothetical. The spec split in [#432](https://github.com/pdcarlson/Frapp/issues/432)
left dead pointers that nothing caught for months: `apps/api/README.md` named three files that no
longer existed, and `supabase/seed.sql` still pointed at the pre-split behavior spec.

Widening **Citations** would not have fixed it. That gate requires an inline code span, because that
is how prose cites a path; source cites bare, in comments. So this is a separate bare-path extractor
that reuses the other's allowlist machinery, including the property that an entry excusing nothing
fails the run.

**Two passes, because a doc breaks in two different ways.** A doc that *moves* changes its path; a
doc that is *renamed* changes its filename. The path pass needs the `docs/` or `spec/` prefix to know
a token is a claim about the corpus — which is exactly what a bare filename lacks, and source cites
docs by filename alone all the time, in comments, workflow strings, shell and migration headers. So a
second pass extracts bare markdown filenames and asks only whether any tracked file still carries
that name. That is deliberately weaker than the path pass: a filename names no directory, so it
cannot say *which* file it meant, and a move keeps resolving. It catches renames, which nothing else
could see.

The second pass was added for the docs restructure ([#1597](https://github.com/pdcarlson/Frapp/issues/1597)),
whose kebab-case renames change dozens of filenames cited this way. Stage 2 made the *layout*
machine-enforced so the restructure's move would be self-checking; for renames it was not, and this
closes that.

- **Scope:** every tracked file *outside* the Citations scope.
- **Excluded, each for a reason:** `.gitleaks-baseline.json` (entries pin a path *and* a SHA, so they describe the tree as it was);
  **both** allowlists — `scripts/doc-paths-allowlist.json` and this gate's own
  `scripts/doc-refs-allowlist.json` (their job is naming references that do not resolve, so scanning
  them would make every excuse its own violation); and any `__tests__/` directory (assertion fixtures
  are synthetic — a gate's own test must be free to name an invented path under `spec/` and assert
  that it is rejected).
- **Fenced code blocks are blanked in the filename pass**, the way `check-doc-paths.mjs` strips them:
  17 tracked markdown files sit outside the Citations scope and so are scanned here — command files,
  the PR template, package READMEs — and a shell transcript naming a filename is a worked example,
  not a claim. Blanked rather than removed, because this gate reports a *line*. An unterminated fence
  strips nothing rather than swallowing the rest of the file.
- **Allowlist:** [`scripts/doc-refs-allowlist.json`](../../../scripts/doc-refs-allowlist.json), same
  shape as the citation allowlist. Prefer `perFile`.
- **The one false positive the filename pass has**, worth recognising before you go looking for a
  file that was never there: a **design-token step written in backticks** is shaped exactly like a
  filename. `packages/theme` defines `spacing`, `radius` and `fontSize` groups each with an `md`
  step, so a comment reading ``\`spacing.md\` is 12`` extracts as a markdown filename. The same step
  reached through its object — the group name preceded by a dot — does *not*, because the dot
  disqualifies it, so this only bites the backticked house style. (Spell that full form out here and
  the **Citations** gate flags it, which is the same ambiguity arriving from the other side.) The
  excuse is an allowlist entry, and unlike the path pass the entry is
  consulted **before** resolution, so adding a real file with that basename cannot silently retire it.
- **Run locally:** `npm run check:doc-refs`.

**Rollout.** Reports on every PR, not merge-blocking yet — the same path `doc-paths` and
`doc-tables` each took. Promote by adding `"doc-refs"` to `DOCS_CHECKS` in
[`required-checks.mjs`](../../../scripts/ci/lib/required-checks.mjs) once it has run green on `main`,
then having an admin apply branch protection. As with the other whole-tree gates, that trade means a
PR can be blocked by a reference in a file it never touched; the alternative is what already
happened, which is references rotting for months with nothing watching.

### Rosters (`check-doc-tables.mjs`)

One doc restates the roster by hand, and only one. `GITHUB_BRANCH_PROTECTION_RUNBOOK.md` used to
document the fanout as procedure — *"if CI job names change, update: the script, this runbook,
`CONTRIBUTING.md`, `spec/environments/README.md`"* — which was four hand-kept copies of one array,
and they had all drifted at once: `@repo/theme` (#1153) and `@repo/formatting` were missing from
every `lint-and-typecheck` suite list, and `packages/chat-integrations` (#1114) from two `web-tests`
lists. `CONTRIBUTING.md` and `spec/environments/README.md` now hold pointers instead, so
`DOC_TABLES` names only the runbook; this check asserts that surviving copy against its source.

- **Sources:** the `CI_CHECKS` / `DOCS_CHECKS` arrays in
  [`required-checks.mjs`](../../../scripts/ci/lib/required-checks.mjs), and the
  job ids and `npm run test -w <workspace>` steps in `.github/workflows/ci.yml`.
- **Asserts** that every required check appears in each doc's roster, and that the workspaces a
  doc names for `lint-and-typecheck` and `web-tests` are the ones those jobs actually run.
- **Whole-tree, not diff-based** — a table goes stale when a *workflow* changes, the other side of
  the reference, so a diff-scoped check would miss the case it exists to catch.
- **Only `@repo/*` and `packages/*` are compared.** `ci.yml` runs `-w apps/landing` and
  `-w apps/web`, which the docs render as prose ("landing plus …"); demanding a literal token
  there would be a false positive, not a finding.

It states *intended* required checks, never live branch protection — read live state from the API,
per [`GITHUB_BRANCH_PROTECTION_RUNBOOK.md`](../ops/GITHUB_BRANCH_PROTECTION_RUNBOOK.md).

#### The directory structure, three times over

The same script also polices the directory structure, which the corpus restates in three places
against one manifest — `DIRECTORIES` in
[`docs-structure.mjs`](../../../scripts/ci/lib/docs-structure.mjs).

| Restatement | Constant | Rule |
| ----------- | -------- | ---- |
| [`DOCUMENTATION_CONVENTIONS.md`](../DOCUMENTATION_CONVENTIONS.md) § Where things go | `PLACEMENT_DOC` | Exact both directions against all of `DIRECTORIES` |
| [`docs/README.md`](../../README.md) § Folders + § Internal subfolders | `INDEX_DOCS` | Exact both directions against the declared children of `docs` and `docs/internal` |
| [`docs/internal/README.md`](../README.md) | `INDEX_DOCS` | Exact both directions against the declared children of `docs/internal` |

- **Exact, never prefix coverage.** A `spec/ui/` row must not speak for `spec/ui/mobile`. Coverage
  matching was the first design and it disarmed the check: five declared directories had no row and
  the gate stayed green.
- **The index READMEs are scoped, not weaker.** Each of their tables is exactly one directory's
  *immediate children*, so the same both-directions rule applies once the comparison is made per
  scope — no coverage is left unchecked.
- **Their paths are relative to the doc**, so they go through `resolveIndexHome`, not
  `normalizeHome`. `normalizeHome` rejects any token not starting with `docs/` or `spec/`, which is
  right for the placement map and would silently match *nothing* in either index (#1619).
- **Link targets only, not every backticked token.** `docs/README.md`'s Hooks row says "tests for
  `packages/hooks`" — a mention, not a claim about where docs live.

This is what makes a rename or a flatten safe: `check-doc-paths` and lychee catch a broken *link*,
but only this catches a table that still describes the *old directory set*.

Run locally: `npm run check:doc-tables`. Unit tests:
`scripts/ci/__tests__/check-doc-tables.test.mjs`, covered by `ci-scripts-tests`.

**Rollout.** Reports on every PR, not merge-blocking yet. Promote by adding `"doc-tables"` to
`DOCS_CHECKS` — an ordinary PR — and then having a human re-run
`npm run configure:branch-protection` once it has run green on the target branch. The apply is the
human half by policy, which is why promoting a check to required is filed as a `[human]` issue.

### Env slugs (`check-env-slugs.mjs`)

Asserts that every Infisical environment named in the repo is one that exists: `dev`, `staging`,
`prod`. It scans `package.json` (`infisical run --env=`), `.infisical.json`
(`defaultEnvironment` and every branch mapping), the workflows (`env-slug:`), every `--env=` in a
`docs/` or `spec/` code sample, and the canonical table in
[`ENV_REFERENCE.md`](../environment/ENV_REFERENCE.md) § Infisical Environments.

**The bug it exists to catch already happened.** Infisical environments carry a display *name* and a
separate *slug*, and two of our three differ — "Development" is `dev`, "Production" is `prod`. Six
docs asserted a `local` environment, and `package.json` followed them: all five `npm run dev:*`
scripts passed a `--env=` value of `local` and could never resolve an environment. Nothing caught it, because the
deploy workflows hardcode `staging`/`prod` correctly and the cloud sandbox writes
`apps/*/.env.local` directly — so no CI path ever exercised the broken flag. A wrong slug does not
warn; it fails to resolve.

The slug list lives in exactly one place, `INFISICAL_ENV_SLUGS` in the script, mirrored from
**Infisical → Project Settings → Environments**. If an environment is genuinely renamed, update that
constant and `ENV_REFERENCE.md` — do **not** widen the list to silence a failing reference.

Pure helpers (`unknownSlugsIn`, `infisicalConfigSlugs`, `canonicalSection`, `lineOf`) are exported
for `scripts/ci/__tests__/check-env-slugs.test.mjs`, run by the `ci-scripts-tests` job; importing
the module has no side effects, so the gate can be tested without running it.

**What it cannot do:** notice a rename in the Infisical dashboard. It proves internal consistency
only. A rename surfaces as a loud failure on the next deploy workflow run, and the constant above is
the single place to fix.

### What none of these check

Whether a doc's **claims** are still true — with the one narrow exception of env slugs above. The
rest are structural: they check that files exist, that pointers resolve, and that two lists match,
not that a sentence is accurate. A doc can pass every gate here and still be confidently wrong, or
be accurate and still mislead (two correct tables on one topic, far apart, with no cross-reference).

That gap is not one a gate can close. `docs-spec-sync` tried, by demanding a doc edit from every
non-doc PR, and produced filler instead: a check that demands an edit from every PR gets one from
every PR, including the PRs with nothing to say. It was deleted in #1597.

What closes it is the discipline in
[`DOCUMENTATION_CONVENTIONS.md`](../DOCUMENTATION_CONVENTIONS.md) — one canonical place per fact,
edit the doc that owns it — and the
[`check-our-docs`](../../../.claude/skills/check-our-docs/SKILL.md) skill, invoked while coding,
before you act on what a doc told you.

- **Ambiguity is the real cost.** Contributors should default to
  [`docs/guides/`](../../guides/README.md) and `spec/` for product-code PRs;
  there is no `apps/docs` workspace. Where things go:
  [`DOCUMENTATION_CONVENTIONS.md`](../DOCUMENTATION_CONVENTIONS.md).

Any change to these scripts should update this file, `AGENTS.md`, and the PR
template so agents and humans share one story.
