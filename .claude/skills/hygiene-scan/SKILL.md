---
name: hygiene-scan
description: >
  Run the Hygiene Scan routine (5 of 5): ground in the repo's engineering standards and gates, read
  a calendar-derived slice of the codebase whole (legacy patterns, grandfathered violations,
  orphaned code, not just the recent diff), fix one bounded, verified hygiene theme in a
  product-code PR a human merges, and file or ledger the rest. Use when the scheduled "Hygiene
  Scan" routine fires, or when asked to scan the codebase for hygiene debt and fix it rather than
  report it.
---

# Hygiene Scan (routine 5 of 5)

This is the one unattended routine that edits product code. Filed hygiene ages behind feature work,
and nothing else consolidates, so each run fixes one theme itself. A run is done when at most one
PR (one theme, or one small batch per Phase 2) is open for a human to merge (or you've written
down why there is none), the rest is filed or ledgered, and the run report is written. The license
and its limits:
[`ROUTINES.md` → Shared ownership boundary](../../../docs/internal/ci-cd/ROUTINES.md#shared-ownership-boundary-all-routines)
rule 3, and ADR-16 amendment 7 in [`spec/architecture/adr/adr-16.md`](../../../spec/architecture/adr/adr-16.md).
It holds only while every run is grounded, whole-pattern, verified, reviewed, and human-merged.

## Hard limits

- Never touch `supabase/migrations/**`, `.github/workflows/**`, or a dependency version
  (`package.json` deps, `package-lock.json`): schema changes hit shared databases, workflows are the
  gates judging this PR, and an upgrade is a behaviour change needing its own review.
- Never change a gate's posture (required ↔ advisory); that is the owner's call
  ([`QUALITY_GATES.md`](../../../docs/internal/ci-cd/QUALITY_GATES.md)).
- Never change `apps/landing` visuals. The page is built to binding boards
  (`spec/ui/landing/reference/`) and its open items are owner decisions, so a visual change there is
  design work. Dead code and correctness there are fair game.
- Never edit the seven frozen mobile files, which change only through a single integrator PR so
  parallel slices don't collide ([`spec/ui/mobile/navigation.md`](../../../spec/ui/mobile/navigation.md)
  § Hotspot freeze). Under `apps/mobile/`: `app/_layout.tsx`, `app/(tabs)/_layout.tsx`,
  `lib/theme.tsx`, `components/screen-shell.tsx`, `lib/href.ts`, `package.json`, `app.json`.
- Never edit `spec/behavior/**` or `spec/product/**` prose: it is intent, never "corrected" to match
  code. Only a path citation there may change, when a fix moves a file.
- Never `git push --no-verify`; the pre-push hook is the review gate. If it can't find valid
  evidence, stop and report the blocker.
- Never merge. The human merge is what licenses unattended product-code edits.
- One PR per run, on `claude/hygiene-scan-YYYY-MM-DD` (append `-2` if that exists), and one open
  Hygiene Scan PR at a time: reviewer bandwidth is scarce and stacked hygiene PRs conflict.
- File no more net-new issues per run than the Curator's
  [net-growth budget](../issue-curator/SKILL.md#net-growth-budget) allows; it binds here too.
- Never print secret values; names and presence only.

**May edit:** `apps/**` and `packages/**` code and tests; in `scripts/**`, dead code and stale
allowlist entries only (the check, CI and deploy scripts are the gates); gate baselines, downward
only (`scripts/dependency-cruiser-known-violations.json`, the `.jscpd.json` threshold); path
citations in any doc, `spec/behavior/**` included, when a fix moves a file, and the relevant `docs/`
file when a fact it states moved; this skill directory.

**Behaviour stays unchanged:** anything a test, API consumer, user, or the database can observe
(status, shape, message, rendered output, persisted data, side-effect order and timing). The one
exception is a bug inside the pattern you are cleaning that violates what its own tests, comments,
or the spec already require, in a way no caller could rely on (an off-by-one, a guard that can't
fire, a `catch` that swallows what it logs), and that a fails-then-passes test covers. Put it under
its own PR-body heading. A spec-vs-code disagreement about what *should* happen is filed, never
resolved by editing either side (`AGENTS.md` § Spec vs code). A security or tenant-isolation bug is
not hygiene: file it `P1`/`P2` at once and lead the report with it; fix it here only if this run has
a PR and the fix is one line the new test covers.

## The three habits this routine exists to enforce

1. **Ground before you touch.** Every finding names the repo rule it violates (a line in
   `AGENTS.md`, `spec/engineering.md`, a skill, a gate), and every fix names the rule it restores.
   Taste isn't a rule, and an "established idiom" isn't one until grep finds it. An ungrounded fix is
   an opinion applied to product code with nobody watching.
2. **Question the shape, not just the diff.** The repo is mid-rebuild (legacy Frapp → the Signet design system; the product is still named Frapp, ADR-25): treat
   existing code as possibly dead until checked, not as precedent. Read the slice whole, the oldest
   file as hard as yesterday's PR. When a legacy shape is wrong, the finding is "this should not
   exist in this form". Phase 2 bounds that judgment; it never switches it off.
3. **Never trade one smell for another.** A fix leaves fewer copies, fewer lines, fewer ways to do
   one thing, or stricter types, and worsens none of them. Dropping a framework import from
   `domain/` by wrapping the call in the same try/catch at four sites adds duplication; the right
   fix is a typed domain error translated once at the boundary. If you can't see the right fix,
   file it with the design question instead of shipping the mechanical half.

## Phase 0 — Ground

Spend about the first quarter of the run here.

### 0.1 Read the standards you will cite

`AGENTS.md` § Tech debt protocol, § Spec vs code, § Documentation discipline;
[`spec/engineering.md`](../../../spec/engineering.md) § Changing existing code and the rule sections
after it (a checklist); [`signet-cutover`](../signet-cutover/SKILL.md) (in `apps/web`, a legacy class
or live `dark:` variant is a defect now); the slice's app skill,
[`api-development`](../api-development/SKILL.md) or [`ui-development`](../ui-development/SKILL.md),
plus [`realtime-resilience`](../realtime-resilience/SKILL.md) when the slice touches
`packages/chat-core` or a realtime subscription;
[`QUALITY_GATES.md`](../../../docs/internal/ci-cd/QUALITY_GATES.md); and
[`DOCUMENTATION_CONVENTIONS.md`](../../../docs/internal/DOCUMENTATION_CONVENTIONS.md). When a doc
you rely on is wrong, fix it in the PR if small and in scope, else report it; a stale doc never
licenses skipping the check it describes.

### 0.2 Name today's slice — deterministically, carrying no state

Sessions carry no state, so the date alone picks the slice:

```sh
J=$(date -u +%j); echo $(( 10#$J % 5 ))
```

`%j` is zero-padded, so parse it base 10 (`10#$J`) or `008` and `009` throw; `-u` keeps a manual
re-run on the scheduled answer. 365 is divisible by 5, so the cycle is stable across years (a leap
year shifts it a day, accepted).

| Group | Slice (read it whole) | Grounding skill |
| --- | --- | --- |
| 0 | `apps/api/src/domain`, `apps/api/src/application` | `api-development` |
| 1 | `apps/api/src/interface`, `apps/api/src/infrastructure`, `apps/api/src/modules`, `apps/api/src/config`, the `apps/api/src/*.ts` bootstrap files, `apps/api/test`, `packages/api-sdk` (hand-written code only), `packages/validation`; `supabase/` is read for context and is flag-only | `api-development` |
| 2 | `apps/web`, `packages/theme`, `packages/color`, `packages/chapter-theme`, `packages/brand-assets`, `packages/formatting` | `ui-development`, `signet-cutover` |
| 3 | `apps/mobile`, `packages/chat-core`, `packages/chat-integrations`, `packages/hooks` | `ui-development`, `signet-cutover`, `realtime-resilience` |
| 4 | `packages/org-archetypes`, `packages/observability`, `packages/eslint-config`, `packages/typescript-config`, `scripts/`, `apps/landing` (dead code and correctness only), and the gates' own baselines | `testing`, `QUALITY_GATES.md` |

The slice bounds the deep read, not the fix: a pattern found there is fixed everywhere it occurs.
Don't re-scope a slice to balance it, because `ROUTINES.md` § Verify checks that two runs on one day
take the same one. Read `git ls-files` over the group in order, skipping generated files
(`packages/api-sdk/src/types.ts`, `apps/api/openapi.json`, `*.d.ts`, snapshots; "unused" there is
not a finding). If the budget runs out first, the ledger's `carry:` line names the last file read
and the group's next run resumes after it. Groups 2 and 3 often need several passes; a group that
never finishes is a finding for the owner.

### 0.3 Run the gates and record their baselines

| Baseline | Command | Record |
| --- | --- | --- |
| Types | `npm run check-types` | clean |
| Lint | `npm run lint` | clean, plus the `apps/api` warning count: its lint script has no `--max-warnings 0`, so warnings pass silently, and the run must not add one |
| Layering | `npm run check:dep-cruiser` | violation / baselined / new counts. The baseline is empty, so expect `0 violation(s), 0 baselined, 0 new`; non-zero violations are a regression on `main` to report, and non-zero baselined means someone re-recorded instead of fixing |
| Duplication | `npm run check:duplication` | the percentage and clone list (`npx jscpd --config .jscpd.json --reporters consoleFull` shows every clone) |
| Tests | `npm run test -w <workspace>` per workspace in the slice | pass, and the count |
| Coverage ledgers | the backlog tables in [`tenant-scope-coverage.spec.ts`](../../../apps/api/src/infrastructure/supabase/repositories/tenant-scope-coverage.spec.ts), [`no-as-never.spec.ts`](../../../apps/api/src/infrastructure/supabase/repositories/no-as-never.spec.ts), [`dto-constraint-coverage.spec.ts`](../../../apps/api/src/interface/dtos/dto-constraint-coverage.spec.ts), [`signet.css.spec.ts`](../../../packages/theme/src/signet.css.spec.ts) | each deferred entry is a standing finding with its reason written |

`check:dep-cruiser` resolves `@repo/*` through each package's `main`/`exports`, which for several
packages is a built `dist/`: on a fresh sandbox run `npx turbo run build --filter='./packages/*'`
first, or you get dozens of false `not-to-unresolvable` violations. `check:api-contract` regenerates
`openapi.json` and `packages/api-sdk/src/types.ts`, so run it only in Phase 3. `check:links` needs
lychee installed first ([`AGENTS.md` § Lint, test, build, type-check](../../../AGENTS.md#lint-test-build-type-check)).

### 0.4 Read what earlier runs already decided

- **The ledger.** `search_issues query:"Hygiene Scan — ledger"`. The matcher is semantic: a hit
  counts only with the exact title `Hygiene Scan — ledger` and the `routine-state` label (the PR
  Follow-ups tracking issue is the near-miss it offers). If none exists, create it with
  `issue_write`, labelled `routine-state` only (the routine-infrastructure carve-out in
  `GITHUB_PM.md`), and ask the owner to pin it. `get_comments` pages oldest-first, so take the
  `comments` count from `issue_read get` and fetch `perPage: 30` at `page: ceil(count / 30)`, plus
  the page before if that one holds fewer than ten. A `declined:` line stands for 30 days unless
  `git log` shows the file changed since; `carry:` is the last run talking to you.
- **The open PR.** `list_pull_requests state:open base:main`, filtered client-side on `head.ref`
  starting `claude/hygiene-scan-` (the `head` filter is an exact `owner:branch`, not a prefix).
- **Issues.** Search `fp=hygiene/` (open and closed) so you never re-file, and each candidate's key
  terms to find the Curator `suggestion` already tracking it; fixing that with `Fixes #N` is the best
  outcome a run can have. Confirm a hit carries the marker text before skipping on it.
- **Recent merges.** `git log --oneline -30 origin/main`. A pattern a reviewer approved yesterday
  isn't yours to reverse; file the disagreement.

### 0.5 If a Hygiene Scan PR is already open

Service it: mergeability, CI on its head, unresolved review threads, each handled the way `AGENTS.md`
§ Autonomous PR lifecycle steps 3–4 describe (merge `origin/main` in, re-run a job that died
before its first repo step instead of patching it, fix real failures, answer or implement review
asks); routines are exempt from its subscribe-and-babysit loop, not from how it handles a PR, with every push through Phase 4's review gate and within its theme. Then run Phases 0, 1
and 5, but open no second PR; findings go to the ledger and, up to the cap, the tracker.

## Phase 1 — Scan

Slice lenses are independent reads: on a large slice, split the lenses or directories across a few
subagents (within the [`multi-agent`](../multi-agent/SKILL.md) budget, so several lenses share
one) that return candidates in the finding format below, and keep gate output and quick greps
yourself.
A delegated candidate is a lead until you have opened the file, checked consumers, and named the
rule.

### Repo-wide signal lenses — every run, whatever the slice

- **Gate output.** Every jscpd clone, every `apps/api` lint warning, every coverage-ledger entry, and
  any dep-cruiser entry that reappeared (find how it got there; don't grandfather it). These are
  findings the repo has already made.
- **Named anti-patterns, by grep.** The canonical bad forms in `spec/engineering.md`'s rule sections,
  plus: a `.single()` where the row may be absent, a bare `SupabaseClient` injection, a raw `fetch`
  where `@repo/hooks` owns the data layer, and a cast or `@ts-expect-error` on an
  `.insert`/`.update`/`.upsert` payload. `as never` is one spelling (`as any`, `as unknown as …` and
  an expanded `Database[…]['Insert']` erase as much), and `no-as-never.spec.ts` covers only
  `*.repository.ts`, so grep service-layer writes. Also the layering red flags in
  [`api-development`](../api-development/SKILL.md) and [`audit`](../audit/SKILL.md).
- **Two ways to do one thing.** A `packages/*` helper reimplemented locally, a guard hand-copied
  across screens, a wrapper kept "for now" beside what it wraps. `git grep` the name and the body's
  most distinctive line.

### Slice lenses — the deep read of today's group

- **L1 · Orphans.** No tool does this. For each export, `git grep -n '<name>' -- apps packages
  scripts` minus the definition and barrel re-exports; zero importers makes a candidate. Then check
  non-import consumers: file-based routes (`apps/mobile/app/**`, `apps/web/app/**`), NestJS module
  registration, `jest.mock` path strings, asset URLs. A definition, an `index.ts` re-export, or a
  "might need it later" comment is not a consumer.
- **L2 · Legacy Frapp on a Signet surface.** Geist, bone/bronze/ink, `#2563EB`, `royal-blue-*`,
  `navy-900`, a Tailwind key that compiles to nothing, hand-wrapped `hsl(var(--token))`, a live
  `dark:` in `apps/web`, NativeWind or raw hex or a `fontSize` literal in `apps/mobile`, or a
  primitive the #920 slice deleted coming back (`accordion`, `progress`, `scroll-area`, `separator`,
  `skeleton`, `sonner`, `tooltip`, `Button`'s `outline`). `apps/landing` is a Signet surface, so a
  leftover Geist, bone/bronze, `navy` or `emerald` marker there is a defect; file it, since its
  visuals are off-limits.
- **L3 · Duplication and parallel paths.** jscpd sees textual clones of 50+ tokens, not the same
  logic written twice: look for the repeated parse-and-guard, error translation, interval hook, or
  permission unwrap, and for an old implementation live beside its replacement with no flag or
  documented window (`signet-cutover` § Cutover deletes what it replaces).
- **L4 · Layering.** `scripts/dependency-cruiser.cjs` is the enforced boundary; the audit skill's
  red flags (domain importing `@nestjs/*` or `@supabase/*`, a service importing a DTO) are the
  intent. Fix toward the enforced rule; when the ideal costs duplication, it's a design question.
- **L5 · Correctness in old code.** The `spec/engineering.md` rule sections, read against files
  nobody has opened in months, for what grep misses (fallbacks, empty states, cents validation,
  control semantics).
- **L6 · Verification debt.** Consolidated logic with no helper test, a spec asserting nothing, a
  ledger entry whose reason no longer holds, a `TENANT_SCOPE_BACKLOG` repository that grew a write
  path. A consolidating fix ships a test for the helper when none exists; the repo's idiom is the
  tree-walking ledger spec, so extend one rather than inventing a new shape.
- **L7 · The gates.** A stale baseline entry, a jscpd threshold that can drop, a
  `scripts/npm-audit-allowlist.json` entry past its expiry. Ratchets move one way.

### What a finding looks like

```text
<file>:<line> — <one sentence>
rule:      <AGENTS.md § … | spec/engineering.md § … | skill § … | gate>
consumers: <what you grepped, what you found>
fix:       <the whole-pattern fix, all sites named> | design question: <…>
blast:     <sites, workspaces, tests that cover it>
verify:    <which gate/test proves no behaviour change>
class:     fix-now | file | decline (<reason>)
```

## Phase 2 — Choose one theme

Fix one theme: one rule restored at every site (a helper extracted and all copies replaced, a dead
module and all its re-exports removed, a legacy token replaced on every screen carrying it), or
else a batch of at most ~6 unrelated small cleanups, never both, so the reviewer holds one idea.
Ship a candidate only if it is:

- **Grounded:** the restored rule is cited.
- **Whole-pattern, deleting what it replaces:** every site, no shim, no "rest in a follow-up",
  because a half-migrated pattern is two ways to do one thing. If the whole is too big for one
  reviewable PR, ship step one of a sequence declared up front (`spec/engineering.md` § Changing
  existing code) and file the rest as an ordered epic with sub-issues.
- **Net simpler:** count copies and lines before and after.
- **Verified by a gate:** a typecheck, lint, test, or gate shows no behaviour changed. Careful
  reading alone doesn't count.
- **Bounded:** readable in one sitting. One pattern at forty sites is cheap to review; mixed themes
  are not.
- **Allowed:** clear of the hard limits and the behaviour rule.

Prefer a fix that closes a `suggestion` issue, then one that shrinks a gate baseline, then one that
deletes more than it adds. Decline to the ledger, with the reason, anything that is taste,
off-limits, adds copies, or needs a product or design decision. Zero fixes with written reasons is a
pass; manufacturing a change to show work is a failure.

## Phase 3 — Fix and verify

1. Branch `claude/hygiene-scan-YYYY-MM-DD` from `origin/main`. Parallel implementers are fine for
   disjoint files in separate workspaces; each reports its diff.
2. Compare against the Phase 0.3 baselines and record each outcome for the PR body:
   - `npm run check-types`; `npm run lint` (the `apps/api` warning count did not rise).
   - `npm run test -w <workspace> --if-present` per touched workspace; a package with no suite is
     recorded as such, not as a failure.
   - `npm run check:dep-cruiser`, plain. Re-recording is how violations get tolerated, so run
     `-- --update-baseline` only to remove an entry that's gone, only after a plain run reports
     `0 new`, and confirm the JSON diff is deletions only. The runner re-records every current
     violation, so a re-record with a new one present grows the baseline silently; a diff that adds
     an entry means back the fix out.
   - `npm run check:duplication`: the percentage did not rise. After a consolidation, lower the
     `.jscpd.json` threshold to just above the new number, never below.
   - `npm run check:api-contract` when anything under `apps/api/src` changed. A changed artifact
     means the contract changed; back the fix out.
   - `npm run test:ci-scripts` when `scripts/` changed; `npm run check:links` when a heading or
     linked file moved.
   - `npm run ci:local-gate` last, as the parity run (lint, types, API tests, contract, secret scan,
     migration safety, audit).
3. A check you could not run is recorded as not run, in the PR body and the report.
4. When a fix moves or renames a file a doc cites, fix the doc in the same PR. `check:links` catches
   only markdown links, not backticked paths, so grep the old name before moving it. Otherwise a
   mechanical PR changes no doc.
5. End with the "debt spotted" note `AGENTS.md` requires: one line per item seen and not taken, with
   its issue or ledger reference.

## Phase 4 — Review, push, open the PR

1. Run [`/diff-review`](../diff-review/SKILL.md) at `high` or better after the final commit and act
   on every finding. The pre-push hook (`.githooks/pre-push`) refuses a push without the review
   marker for HEAD, and any commit invalidates it.
2. Open the PR against `main` with `mcp__github__create_pull_request`, filling the PR template. Per
   fix, the body gives the rule restored (cited), the consumers checked, and the verification run
   (commands, outcomes, what couldn't run); a behaviour change gets its own heading. Use `Fixes #N`
   for tracked work and label `release:patch`. If the GitHub MCP is unavailable, push the branch,
   report its name, and stop; there is no sanctioned fallback.
3. Fix your own CI, then stop; don't subscribe (routines are exempt from `AGENTS.md` § Autonomous
   PR lifecycle). *Autofix on PR create* is on for this routine, so a subscribed session
   would be a second driver on the branch. Read the check runs once (`pull_request_read
   get_check_runs`): fix, re-review, and push a failure in code you touched; re-run an
   infrastructure death. Don't widen the PR for an unrelated red check or push an empty commit.
   Review comments wait for the next run's 0.5.

## Phase 5 — File the rest, and write the ledger

File what you won't fix through [`file-follow-up`](../file-follow-up/SKILL.md): `triage` +
`suggestion` + one `area:<x>` + a priority (`P3`/`P4` for hygiene; `P1`/`P2` only for a security or
data-loss bug), an Agent brief (`model:fable` when cross-cutting), the finding in the format above
with any design question spelled out, and a visible dedup line:

```text
agent-suggestion: v1 fp=hygiene/<slug> file=<primary-path>
```

Search that `fp=` (open and closed) first. Past the filing cap in [Hard limits](#hard-limits),
findings go to the ledger for a later run to promote.

Append one comment per run to the "Hygiene Scan — ledger" issue in this shape, and never rewrite its
body; run state lives in the comments. It is state for the next
run, so it never restates earlier entries.

```text
hygiene-scan run: v1 date=YYYY-MM-DD slice=<0-4> pr=#<N>|none filed=#<a>,#<b>|none
fixed:    <one line per theme or cleanup, rule restored, sites>
declined: fp=hygiene/<slug> file=<path> — <reason>        (new this run only, one per line; standing for 30 days)
found:    fp=hygiene/<slug> file=<path> — <one line>      (past the filing cap; a later run may promote)
carry:    <what the next run should know: where you stopped, a baseline that can ratchet, a PR waiting on a human>
```

## How the run ends

Nothing from grounding through the ledger needs the human, so work straight through, putting
progress notes in the same message as the next tool call. End when the ledger comment is posted and
the PR is open, or you've decided on no PR and written why. End early only when a protected resource
blocks you (the pre-push hook refuses; the cloud sandbox failed to come up, per `AGENTS.md`) or
nothing left can move without the human. A missing GitHub MCP doesn't stop the scan: it ends the
run at Phase 4 with the branch pushed. A single check you can't run is recorded as not run, not a
reason to stop. A summary announcing the next step, an offer to continue, or a list of
non-blocking decisions is not an ending. The final message is the run report.

## Run report

In this order:

1. **Lead line:** the PR link and its one-sentence theme, or "no PR" and why; then any security or
   data-loss issue filed.
2. **Grounding:** standards read, the slice (group and day of year), baselines (types, lint
   warnings, dep-cruiser counts, duplication %, tests), what the ledger and open PR said.
3. **Fixed:** per fix, the rule restored, sites, verification outcome; which baselines moved.
4. **Filed:** issue numbers, one line each.
5. **Declined / found, not filed:** the ledger lines, so the owner can overrule a decline.
6. **Needs you:** design questions, off-limits findings, spec-vs-code contradictions, the PR waiting
   on review, each specific enough to decide from.
7. **Not run:** anything you couldn't verify, and why.
8. **Debt spotted:** even when "none".

## Self-maintenance

Same contract as the other routines
([`ROUTINES.md` → Self-maintenance](../../../docs/internal/ci-cd/ROUTINES.md#self-maintenance-the-update-themselves-contract)),
folded into this run's PR. Check each run that the Phase 0.3 commands exist in `package.json`, the
slice table names real directories (a new package joins a group), cited paths and skills resolve,
and the frozen list matches `spec/ui/mobile/navigation.md`. Fix mechanical drift here.
Judgment-laden drift (a lens that seems wrong, a slice that should split, a limit that seems off)
goes under "Needs you", never into a self-authored rewrite of what this routine is for.
