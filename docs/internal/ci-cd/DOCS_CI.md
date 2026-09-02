# Docs/spec CI gate

## What runs

On pull requests to `main`, `.github/workflows/docs.yml` (workflow display name
**Docs spec sync**) runs **five jobs** covering **six** checks. They are separate on purpose: each
asserts one thing, and each fails with a different fix.

| Check | Script | Asserts | Scope | Job | Required? |
|---|---|---|---|---|---|
| Sync | [`check-docs-impact.mjs`](../../../scripts/check-docs-impact.mjs) | A PR touching non-doc files also touches `docs/` or `spec/` | PR diff | `docs-spec-sync` | **Yes** |
| Structure | [`check-docs-structure.mjs`](../../../scripts/check-docs-structure.mjs) | Every file under `docs/`/`spec/` sits in a declared home and matches the naming rule, per [`scripts/ci/lib/docs-structure.mjs`](../../../scripts/ci/lib/docs-structure.mjs) | Whole tree | `docs-structure` | Not yet — see rollout below |
| Citations | [`check-doc-paths.mjs`](../../../scripts/check-doc-paths.mjs) | Backticked repo-path citations resolve to real files | Whole tree | `doc-paths` | **Yes** — in `DOCS_CHECKS` |
| References | [`check-doc-refs.mjs`](../../../scripts/check-doc-refs.mjs) | In files OUTSIDE the docs corpus (source, workflows, migrations, shell): bare `docs/`/`spec/` paths resolve, and bare markdown filenames still name a tracked file | Whole tree | `doc-refs` | Not yet — see rollout below |
| Rosters | [`check-doc-tables.mjs`](../../../scripts/check-doc-tables.mjs) | Hand-copied required-check rosters and per-job suite lists match `CI_CHECKS` / `DOCS_CHECKS` and `ci.yml` | Whole tree | `doc-tables` | Not yet — see rollout below |
| Env slugs | [`check-env-slugs.mjs`](../../../scripts/check-env-slugs.mjs) | Every Infisical environment named anywhere is one that exists | Whole tree | `doc-tables` (same job) | Not yet — inherits `doc-tables` |

`docs-spec-sync` is a required check under `enforce_admins: true`, registered via the `DOCS_CHECKS`
array in [`scripts/ci/lib/required-checks.mjs`](../../../scripts/ci/lib/required-checks.mjs)
— a **separate array** from `CI_CHECKS` in the same file, which is easy to miss when grepping.
The arrays moved out of `configure-branch-protection.mjs` in #1383 so the production deploy path
could read them without importing a module that writes live branch protection.

**Sync** is intentionally simple: if the PR modifies **any** path **not** under `docs/` or `spec/`,
it must **also** modify **at least one** path under **either** prefix. So a single edit under
`docs/guides/`, `docs/internal/`, or `spec/` satisfies it for a product-code change. It does **not**
require a specific subtree (e.g. it does not yet require `spec/` for API-only changes). Two narrow
exemptions cut through that, below.

Pure helpers (`classifyChanges`, `NON_CODE_PREFIXES`) are exported for
`scripts/ci/__tests__/check-docs-impact.test.mjs`, run by the `ci-scripts-tests` job.

### Exemptions

`docs-spec-sync` is **required** under `enforce_admins: true`, so a category of PR that can never
satisfy it is not merely red — it is permanently unmergeable, with no override. All three exemptions
exist for that reason.

The label is the one you are most likely to need, and reaching for it is **not** a failure of
discipline — see below.

| Exempt | Where | Why |
|---|---|---|
| Dependabot PRs | Workflow condition on the *step*, in [`docs.yml`](../../../.github/workflows/docs.yml) | A bump touches `package.json` / `package-lock.json` and nothing else. Skipping the **step**, never the job, keeps the required check reporting — a skipped job never reports, leaving the PR blocked on a check that never arrives. |
| `.buildpad/**` | `NON_CODE_PREFIXES` in [`check-docs-impact.mjs`](../../../scripts/check-docs-impact.mjs) | The canvas export is neither code nor documentation, so it has no docs impact to sync. Every periodic sync would otherwise land as "N non-doc files changed, no docs updated". |
| PRs labelled `no-doc-change-needed` | `EXEMPT_LABEL` in [`check-docs-impact.mjs`](../../../scripts/check-docs-impact.mjs) | A change with genuinely no docs impact — a pure-code consolidation, a lint fix, a formatting-only sweep — cannot satisfy the gate, and the gate is required, so it would be unmergeable rather than merely red. **This is the expected answer for a mechanical PR, not a last resort.** |

#### The `no-doc-change-needed` waiver

**Reach for this whenever your change genuinely has no docs impact.** The gate cannot tell a
relevant doc edit from an irrelevant one — it only checks that *some* path under `docs/` or `spec/`
moved (`const DOCS_OR_SPEC = ["docs/", "spec/"]`). So when a PR has nothing real to sync, there are
exactly two ways through, and they are not equally good:

- **Label it.** One reviewable act, visible in the timeline, annotated in the run summary.
- **Append something to a doc so the check goes green.** This passes, and it is worse than the
  failure it avoids. It puts a sentence nobody owns into a doc's canonical home, where the next
  reader has no way to tell it from a maintained claim, and it grows a corpus that already has no
  mechanism for retiring anything.

That second path is not hypothetical, and until this change **this file** carried the proof: a
`## Maintenance Log` sat at the bottom of it, holding three bullets about React Query hook tests
and `package-lock` peer metadata — notes that were perfectly true and had nothing to do with the
docs gate this document describes. It has been deleted.
[`diff-review`](../../../.claude/skills/diff-review/SKILL.md) now names that shape as a review
finding.

So: **if the honest answer is "this PR changes nothing a doc describes", the honest action is the
label.** A waived run is a better artifact than a green one bought with filler.

Applying it needs **write access**, so it is not a self-serve bypass for an outside contributor, and it
lands in the PR timeline as a named, reviewable act rather than a silent skip. The gate still **runs**
and still **prints the paths it would have required a doc for**, so what was waived is auditable from
the check's log, not just from the label.

Two mechanics make it work, and both are easy to get wrong:

- **The trigger.** `docs.yml` listens for `labeled`/`unlabeled` on top of the default
  `opened`/`synchronize`/`reopened`. Without them the label would be applied, nothing would re-run, the
  stale red conclusion would stand, and the PR would still be blocked. A waiver has to be able to
  re-run the check it waives.
- **The single home.** The same script used to run a second time as a step inside `ci.yml`'s
  `lint-and-typecheck` — itself a required check — so honouring the label would have meant giving
  `ci.yml` the same `labeled` trigger and re-running the entire suite, Docker build included, on every
  label mutation on every PR. The duplicate was removed instead. **The sync gate now has exactly one
  home: `docs.yml`.** The copies had already drifted once (only `docs.yml` carried the Dependabot
  exemption), which is the other half of the argument for keeping one.

Labels reach the script through `env:` (`PR_LABELS_JSON`, as `toJSON(...)`), never interpolated into
the `run:` string — a label is free-form text and would otherwise be shell-executable. An absent or
malformed value is treated as *no labels*, so a parse failure leaves the gate enforced rather than
silently waived.

A waived run also emits a `::warning::` annotation, so it shows up in the run summary and the Checks
UI rather than rendering as an ordinary green check — the label alone is easy to miss among the
routine `area:*` / `P2` / `in-review` labels every PR carries.

The label does not exist in the repo's label set until it is first applied; create it under
**Issues → Labels**, or type the name when applying it to a PR.

**Locally**, `npm run ci:local-gate` runs the same script and inherits the environment, so the waiver
works there too:

```sh
PR_LABELS_JSON='["no-doc-change-needed"]' npm run ci:local-gate
```

This matters more than it looks: the docs check runs **first** in that gate and a failure aborts the
whole run, so without the waiver a pure-code PR never reaches lint, type-check, the API tests, the
npm-audit gate, or the gitleaks scan. The failure output names this command.

The `.buildpad/` exemption **ignores** those paths; it does not treat them as documentation. A PR that
edits code *and* `.buildpad/` still owes a `docs/` or `spec/` edit, and the failure output names only
the real code changes. What the directory is, and why it is not a doc home:
[`DOCUMENTATION_CONVENTIONS.md`](../DOCUMENTATION_CONVENTIONS.md#buildpad-is-background-not-documentation).

`.claude/` is **not** exempt — a `SKILL.md`-only PR still fails the gate. Pair it with the `docs/`
file that states the same rule (usually the right move anyway), or label it `no-doc-change-needed`
when there genuinely is none. [#810](https://github.com/pdcarlson/Frapp/issues/810) tracks teaching the gate about it;
[`ROUTINES.md`](ROUTINES.md#maintenance) records the workaround until then.

**Structure** validates the **whole tree** against
[`scripts/ci/lib/docs-structure.mjs`](../../../scripts/ci/lib/docs-structure.mjs) — the placement map
as data. It stops the sync gate from being satisfied by dropping a stray file, and it stops the
layout drifting generally: a file in an undeclared directory, a stray file at a tree root, a name
that breaks the convention, a banned prefix returning, a declared directory that holds nothing, or a
directory that owes a `README.md` and lacks one.

It used to look only at paths a PR *added* or renamed, which meant a file already in the wrong place
was invisible forever, and its `spec/` rule matched only root-level paths — so a newly invented
`spec/` subfolder passed. `docs/hooks/` and `docs/performance/` reached `main` that way, absent from
the placement map this gate points at.

The naming rule is kebab-case `.md`, or `README.md`. The `SCREAMING_SNAKE_CASE` files that predate
it — all under `docs/internal/` — are grandfathered in `LEGACY_NAMES`, which is a **ratchet**: an
entry that no longer matches a tracked file fails the gate, so a rename must delete its entry in the
same commit and the list can only shrink. `.dc.html` design exports are exempt from naming.

`--base`/`--head` are still accepted but no longer scope the check; they only label which violations
the change introduced.

**Rollout.** It moved out of the required `docs-spec-sync` job when it stopped being diff-scoped, and
reports on its own `docs-structure` job until the trade is accepted — the same path `doc-paths` took.
[`required-checks.mjs`](../../../scripts/ci/lib/required-checks.mjs) states the rule next to
`doc-paths`: a whole-tree check inside a required job "can block a PR over a citation in a doc that
PR never touched". While it was ADD-only that placement was safe; whole-tree, one stale
`LEGACY_NAMES` entry would red every open PR at once. Promote by adding `"docs-structure"` to
`DOCS_CHECKS` once it has run green on `main`.

Placement rules live in
[`DOCUMENTATION_CONVENTIONS.md`](../DOCUMENTATION_CONVENTIONS.md), and `doc-tables` checks that
document's table against the manifest in both directions, so the two cannot drift.

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
- **Excluded, each for a reason:** `.buildpad/` (a synced export, never hand-edited);
  `.gitleaks-baseline.json` (entries pin a path *and* a SHA, so they describe the tree as it was);
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

Several docs restate one roster by hand. `GITHUB_BRANCH_PROTECTION_RUNBOOK.md` documents the
fanout as procedure — *"if CI job names change, update: the script, this runbook, `CONTRIBUTING.md`,
`spec/environments/README.md`"* — which is four hand-kept copies of one array, and they had all
drifted at once: `@repo/theme` (#1153) and `@repo/formatting` were missing from every
`lint-and-typecheck` suite list, and `packages/chat-integrations` (#1114) from two `web-tests`
lists. This check asserts those copies against their source.

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

Whether a doc's **claims** are still true — with the one narrow exception of env slugs above.
The rest are structural: they check that files exist,
that edits happened, and that two lists match, not that a sentence is accurate. A doc can pass every gate here and still
be confidently wrong, or be accurate and still mislead (two correct tables on one topic, far apart,
with no cross-reference). That judgement half is the
[`check-our-docs`](../../../.claude/skills/check-our-docs/SKILL.md) skill, invoked while coding —
before you act on what a doc told you.

## Why keep it broad

- Cheap to implement and explain; hard to game with accidental omissions of entire prefixes.
- Forces an explicit doc/spec touch for almost every non-doc change, which was an early goal when doc discipline was weak.

That last point is also the gate's failure mode, and it is worth stating plainly: a check that
demands a doc edit from *every* PR will get one from every PR, including the PRs with nothing to
say. Breadth buys coverage and pays for it in filler. The label is what keeps the bill down, which
is why it is documented above as the expected path rather than an escape hatch.

## Trade-offs

- **Noise:** Mechanical edits (e.g. `AGENTS.md` at repo root) still need a `docs/` or `spec/` touch unless the PR is docs-only in a sense the script does not recognize (root-level `.md` files are _not_ exempt). When there is no real doc to sync, label the PR `no-doc-change-needed` rather than inventing one.
- **Ambiguity:** Contributors should default to [`docs/guides/`](../../guides/README.md) and `spec/` for product-code PRs; there is no `apps/docs` workspace. Where to put updates: [`DOCUMENTATION_CONVENTIONS.md`](../DOCUMENTATION_CONVENTIONS.md).

## Optional future tightening (not implemented)

If the team wants less noise or stricter mapping:

- **Path-based rules:** e.g. changes under `apps/api/**` must touch `spec/` or `docs/**` matching an allowlist. Considered as the alternative to the label waiver and rejected for that purpose: a pure-code consolidation moves code *inside* `apps/*/src/**` and `packages/*/src/**`, the very paths any sane allowlist includes, so path-scoping never unblocks the case the waiver exists for. Still worth doing on its own merits, as noise reduction.
- **Changelog:** allow a single audited file to count as the doc touch (still easy to make meaningless updates).

Any change to the script should update this file, `AGENTS.md`, and the PR template so agents and humans share one story.
