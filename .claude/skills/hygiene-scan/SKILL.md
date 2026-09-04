---
name: hygiene-scan
description: >
  Run the Hygiene Scan routine (5 of 5) — ground in the repo's engineering standards and gates,
  read a calendar-derived slice of the codebase whole (legacy patterns, grandfathered violations,
  orphaned code — never just the recent diff), fix one bounded, verified hygiene theme in a
  product-code PR a human merges, and file or ledger the rest. Use when the scheduled "Hygiene
  Scan" routine fires, or when asked to scan the codebase for hygiene debt and fix it rather than
  report it.
---

# Hygiene Scan (routine 5 of 5)

The tracker routines keep the backlog honest and Docs Upkeep keeps the docs honest. This one keeps
the **code** honest, and it is the only routine allowed to edit product code.

It exists for the reason [`docs-upkeep`](../docs-upkeep/SKILL.md) exists: hygiene that gets *filed*
ages. The [Issue Curator](../issue-curator/SKILL.md)'s engineering lens turns duplication and
layering drift into `suggestion` issues, and `/next` reaches them after everything ranked above
them. Meanwhile the repo has **no dead-code tooling at all**, its anti-pattern catalogue
(the rule sections of [`spec/engineering.md`](../../../spec/engineering.md), which it says to read
as a checklist) is enforced only by
whoever happens to be reading, [`.dependency-cruiser-known-violations.json`](../../../.dependency-cruiser-known-violations.json)
"exists to shrink" and does not, and the [`.jscpd.json`](../../../.jscpd.json) threshold only
ratchets down when someone consolidates. This routine is the scheduled hand that does the
consolidating.

It earns the right to touch product code unattended by being **grounded, whole-pattern, verified,
reviewed, and merged by a human** — every run, no exceptions. The license and its limits are
[`ROUTINES.md` → Shared ownership boundary](../../../docs/internal/ci-cd/ROUTINES.md#shared-ownership-boundary-all-routines)
rule 3 and ADR-16 amendment 7 in [`spec/architecture/README.md`](../../../spec/architecture/README.md).

---

## The three habits this routine exists to enforce

**1. Ground before you touch.** Every finding names the repo rule it violates — a line in
`AGENTS.md`, `spec/engineering.md`, a skill, a gate — and every fix names the rule it restores.
Taste is not a rule. "Established idiom" is not a rule until you have grepped for it and found it.
The first scheduled sweep (#1539) restyled a line of the **frozen** `apps/landing` surface on the
strength of an "established opacity idiom" that exists nowhere in the repo, and moved a file out of
a grandfathered dep-cruiser violation without shrinking the baseline. Both were avoidable by
reading first. Phase 0 below is not optional and is not short.

**2. Question the shape, not just the diff.** `AGENTS.md` § Tech debt protocol: this repo is
mid-rebuild (Frapp → Signet), so *treat existing code as possibly dead until you have checked, not
as precedent*, and *when the existing shape is wrong, rebuild it rather than patch around it*. Age
is not evidence of correctness. Scan the slice **whole** — the oldest file gets the same scrutiny as
yesterday's PR — and when a legacy shape is wrong, the finding is "this should not exist in this
form", not "this has a typo". Unattended, that judgement is bounded (Phase 2), never absent.

**3. Never trade one smell for another.** A hygiene fix leaves the codebase with **fewer copies,
fewer lines, fewer ways to do the same thing, or stricter types** — at least one, and never the
reverse of any. #1539's cautionary case: to remove one `@nestjs/common` import from `domain/`, it
wrapped the same call in a try/catch at four sites — three byte-identical copies in application
services, plus one inside the storage adapter's existing local helper — then filed #1538 to
dedupe the three (the fourth is passed as a bare `forEach` callback and must stay as it is; #1538
says so). The "clean" fix that adds duplication is the wrong fix; the right one there is a typed
domain error translated once at the boundary. If you cannot see the right fix, **file it with the
design question** — do not ship the mechanical half.

---

## Repo write permission

| | |
| --- | --- |
| **May edit** | `apps/**` and `packages/**` product code and their tests; under `scripts/**`, dead code and stale allowlist entries only — the check, CI and deploy scripts there *are* the gates, so their logic is never in scope; the gate baselines, downward only (`.dependency-cruiser-known-violations.json` via `--update-baseline` after a clean run, the `.jscpd.json` threshold); **path citations** in any doc — `spec/behavior/**` included — when a fix moves or renames a file (that is doc-sync, not intent), and the **relevant** `docs/` file when a fact it states moved; this skill directory (self-maintenance) |
| **Never** | `supabase/migrations/**` · `.github/workflows/**` · any dependency version (`package.json` deps, `package-lock.json`) · `apps/landing` **visuals** (frozen — [`spec/ui/landing/README.md`](../../../spec/ui/landing/README.md); dead code and correctness there are fair game) · the seven frozen mobile files ([`spec/ui/mobile/navigation.md`](../../../spec/ui/mobile/navigation.md) § Hotspot freeze) · the legacy `@repo/theme` exports landing consumes · `spec/behavior/**` and `spec/product/**` prose (intent — never "corrected" to match code; only a path citation there may change, per the row above) · ADRs (append-only) · `.buildpad/**` · a gate's posture (required ↔ advisory is the owner's call: [`QUALITY_GATES.md`](../../../docs/internal/ci-cd/QUALITY_GATES.md)) · `FRAPP_SKIP_REVIEW_GATE` |
| **Volume** | at most **one** PR per run, on `claude/hygiene-scan-YYYY-MM-DD` (append `-2` if that branch exists); at most **one open** Hygiene Scan PR at a time; at most **~3** net-new issues per run. Never merge — a human does. |

**Behaviour change is out of scope**, with one exception. Observable behaviour is anything a test,
an API consumer, a user, or the database can see: response status, shape or message; rendered
output; persisted data; the order or timing of side effects. A hygiene fix preserves all of it. The
exception is a **bug found inside the pattern you are already cleaning**, small enough to carry a
test that fails before and passes after: fix it, and give it its own heading in the PR body so the
reviewer sees a behaviour change and not a refactor. "Bug" here means code that violates what its
own tests, its own comments, or the spec *already* require, in a way no caller could be relying on
— an off-by-one, a guard that can never fire, a `catch` that swallows the error it logs. Where spec
and code disagree about what *should* happen, that is a contradiction to file, never a bug to fix
(`AGENTS.md` § Spec vs code). A security or tenant-isolation bug is never "hygiene": file it
`P1`/`P2` immediately with the evidence and lead the run report with it; fix it in this run's PR
only when there is one and the change is a single line the new test covers, otherwise leave it to
`/next`, which picks a `P1` first.

---

## Phase 0 — Ground (the first quarter of the run, not the first minute)

### 0.1 Read the standards you will cite

In this order, and actually read them — the run's findings are only as good as this list:

1. `AGENTS.md` § Tech debt protocol, § Spec vs code, § Documentation sync mandate.
2. [`spec/engineering.md`](../../../spec/engineering.md) § Changing existing code (the rebuild-not-patch
   standard and its sequencing rule) and the rule sections after it — Identity and ownership,
   Catalog lookups and defaults, Seeds and shared state, Input handling, Empty states,
   Accessibility, Aggregations, Privacy — which the doc itself says to treat as a checklist.
3. [`signet-cutover`](../signet-cutover/SKILL.md) — what is Signet, what is legacy, what is frozen.
   The `apps/web` migration window is **closed** ([`ui-development`](../ui-development/SKILL.md)):
   a legacy class or a live `dark:` variant on a dashboard screen is a defect now, not a pending slice.
4. The app skill for today's slice: [`api-development`](../api-development/SKILL.md) (layers, guard
   chain, the never-do list) or [`ui-development`](../ui-development/SKILL.md) (component layers,
   token rules, data layer), plus [`realtime-resilience`](../realtime-resilience/SKILL.md) whenever
   the slice touches `packages/chat-core` or a realtime subscription.
5. [`QUALITY_GATES.md`](../../../docs/internal/ci-cd/QUALITY_GATES.md) — which gate is required,
   which is advisory, and why posture is not yours to change.
6. [`check-our-docs`](../check-our-docs/SKILL.md) — the habit for the moment a doc you are relying
   on turns out to be wrong. Fix the doc in the same PR when it is small and in scope; report it
   otherwise. A stale doc is never a licence to skip the check it describes.

### 0.2 Name today's slice — deterministically, carrying no state

Sessions are fresh per run. Derive the slice from the calendar alone:

```sh
J=$(date -u +%j); echo $(( 10#$J % 5 ))
```

`%j` is the zero-padded day of year, so parse it base 10 (`10#$J`) or `008` and `009` throw. `-u`
keeps a manual re-run on the same answer as the scheduled firing. 365 is divisible by 5, so the
cycle is stable across years; a leap year shifts it by one day, which is accepted.

| Group | Slice (read it whole) | Grounding skill |
| --- | --- | --- |
| 0 | `apps/api/src/domain`, `apps/api/src/application` | `api-development` |
| 1 | `apps/api/src/interface`, `apps/api/src/infrastructure`, `apps/api/src/modules`, `apps/api/src/config`, the `apps/api/src/*.ts` bootstrap files, `apps/api/test`, `packages/api-sdk` (hand-written code only), `packages/validation`; `supabase/` is read for context and is **flag-only** | `api-development` |
| 2 | `apps/web`, `packages/theme`, `packages/color`, `packages/chapter-theme`, `packages/brand-assets`, `packages/formatting` | `ui-development`, `signet-cutover` |
| 3 | `apps/mobile`, `packages/chat-core`, `packages/chat-integrations`, `packages/hooks` | `ui-development`, `signet-cutover`, `realtime-resilience` |
| 4 | `packages/org-archetypes`, `packages/eslint-config`, `packages/typescript-config`, `scripts/`, `apps/landing` (dead code and correctness only — never visuals), and the gates' own baselines | `testing`, `QUALITY_GATES.md` |

The slice bounds the **deep read**, not the fix: a pattern found in the slice is fixed everywhere it
occurs (Phase 2's whole-pattern rule), and the repo-wide lenses in Phase 1 run every day. Groups
differ in reading weight; budget for it and say in the report where you stopped. **Do not re-scope
the slice to balance it** — a slice that depends on judgement is not reproducible, and
`ROUTINES.md` § Verify asserts that two runs on one day take the same one.

**Read the slice in a fixed order and record where you stopped.** Take `git ls-files` over the
group's directories in its own order, skip generated files (`packages/api-sdk/src/types.ts`,
`apps/api/openapi.json`, `*.d.ts`, snapshots — `check:api-contract` regenerates the first two, so
"unused" there is not a finding), and read top to bottom. When the run budget ends before the list
does, the ledger's `carry:` line names the last file reached, and the next run of the same group
starts from the file after it rather than from the top. Not finishing group 2 or 3 in one pass is
normal; a group that is never finished is a finding for the owner.

### 0.3 Run the gates and record their baselines

Before touching anything, run and **write down** the numbers you will compare against after the fix:

| Baseline | Command | Record |
| --- | --- | --- |
| Types | `npm run check-types` | must be clean |
| Lint | `npm run lint` | clean, **plus the `apps/api` warning count** — that workspace's lint script has no `--max-warnings 0`, so warnings pass silently; the run must not add one |
| Layering | `npm run check:dep-cruiser` | the grandfathered entries still reported, and any **stale** entries it lists (a stale entry is a free baseline shrink) |
| Duplication | `npm run check:duplication` | the measured percentage and the clone list (`npx jscpd --config .jscpd.json --reporters consoleFull` for every clone) |
| Tests | `npm run test -w <workspace>` for each workspace in the slice | pass, and the count |
| Coverage ledgers | read the backlog tables in [`tenant-scope-coverage.spec.ts`](../../../apps/api/src/infrastructure/supabase/repositories/tenant-scope-coverage.spec.ts), [`no-as-never.spec.ts`](../../../apps/api/src/infrastructure/supabase/repositories/no-as-never.spec.ts), [`dto-constraint-coverage.spec.ts`](../../../apps/api/src/interface/dtos/dto-constraint-coverage.spec.ts), [`signet.css.spec.ts`](../../../packages/theme/src/signet.css.spec.ts) | every deferred entry is a standing finding with its reason already written |

`check-types` and `lint` are turbo tasks wired to `^build`, so they work on a fresh sandbox after
the SessionStart install; the root `check:*` scripts are plain node and need no build — **except**
`check:dep-cruiser`, which resolves `@repo/*` imports through each package's `main`/`exports` —
for most packages a built `dist/`. Run `npx turbo run build --filter='./packages/*'` first on a
fresh sandbox, or those imports report as `not-to-unresolvable`: dozens of "new violations" that
are none (observed 2026-09-02).
`check:api-contract` regenerates `openapi.json` and `packages/api-sdk/src/types.ts` — run it only
in Phase 3, and read a changed artifact as "this fix changed the contract", i.e. behaviour.

### 0.4 Read what earlier runs already decided

- **The ledger.** `search_issues query:"Hygiene Scan — ledger"` — a `routine-state` issue. The
  matcher is semantic, so **a hit counts only if its title is exactly `Hygiene Scan — ledger` and
  it carries `routine-state`**; the PR Follow-ups tracking issue is the near-match it will offer
  you. No such issue → create it (`issue_write`, labelled `routine-state` and nothing else — the
  carve-out `GITHUB_PM.md` grants routine infrastructure, the same one `pr-followups` uses — and
  ask the owner to pin it). Read the **newest** comments: `issue_read get` gives the `comments`
  count, and `get_comments` pages oldest-first, so fetch `perPage: 30` at `page: ceil(count / 30)`
  (and the page before it when that one holds fewer than ten). A `declined:` line is a standing
  decision for 30 days unless `git log` shows the file changed since; a `carry:` line is the
  previous run talking to you. Never rewrite the ledger's body — it is append-only (Phase 5).
- **The open PR.** `list_pull_requests state:open base:main` — the `head` filter is an exact
  `owner:branch`, not a prefix, so page through and filter client-side on `head.ref` starting
  `claude/hygiene-scan-`. If one is open, this run **services it and files only** — see 0.5.
- **Open issues.** `search_issues` for `fp=hygiene/` (open **and** closed) so you never re-file, and
  for the key terms of each candidate so you find the Curator's `suggestion` that already tracks
  it — fixing that one and writing `Fixes #N` is the best outcome a run can have. Confirm a hit
  actually carries the marker text before skipping on it; the matcher is semantic.
- **Recent merges.** `git log --oneline -30 origin/main` — a pattern that landed yesterday with a
  reviewer's blessing is not yours to reverse today; file the disagreement instead.

### 0.5 If a Hygiene Scan PR is already open

Reviewer bandwidth is the scarce resource, and stacked hygiene PRs conflict with each other. So:
check the open PR's mergeability, CI on its head, and unresolved review threads, and act on every
one per `AGENTS.md` § Autonomous PR lifecycle — merge `origin/main` into it, fix a real failure,
answer or implement review asks. Every push to that branch goes through Phase 4's review gate
exactly as a new PR would, and never widens it beyond its theme. Then run Phase 0–1 and Phase 5
in full, but **open no second PR**:
findings go to the ledger (and up to the filing cap to the tracker), and the report says which PR
is still waiting on a human.

---

## Phase 1 — Scan

Fan out for breadth — sub-agents per lens or per directory are fine (`AGENTS.md` § Operating
mindset) — but **verify every candidate yourself** before it reaches the ledger: open the file, check the
consumers, name the rule. A candidate without a rule and a consumer check is not a finding.

### Repo-wide signal lenses — every run, whatever the slice

- **Gate output.** Every grandfathered `dependency-cruiser` entry, every `jscpd` clone above
  `minLines`, every `apps/api` lint warning, every coverage-ledger backlog entry. These are
  findings the repo has *already made* — you are choosing which one to close.
- **Named anti-patterns, by grep.** The canonical bad forms from `spec/engineering.md`'s rule
  sections (`+e.target.value`, an unguarded `ARCHETYPES[…]` subscript, a hardcoded actor
  id, a `<div onClick>`, a division without a zero guard, a `.single()` where the row may be
  absent, an `as never` write cast, a bare `SupabaseClient` injection, a raw `fetch` where
  `@repo/hooks` owns the data layer) and the layering red flags from
  [`api-development`](../api-development/SKILL.md) and [`audit`](../audit/SKILL.md).
- **Two ways to do one thing.** A helper in `packages/*` reimplemented locally; the same guard
  hand-copied across screens with a comment admitting it; a wrapper kept "for now" beside the thing
  it wraps. `git grep` the helper's name and its body's distinctive line.

### Slice lenses — the deep read of today's group

**L1 · Orphans and possibly-dead code.** There is no tooling for this; you are it. For each export
in the slice: `git grep -n '<name>' -- apps packages scripts` excluding the definition and any
barrel re-export. Zero real importers → candidate. Before calling anything dead, check the
non-import consumers: file-based routes (`apps/mobile/app/**`, `apps/web/app/**`) are consumed by
the router; NestJS providers by module registration; specs by path strings in `jest.mock`; assets
by URL. A definition, an `index.ts` re-export, or a "we might need it later" comment is not a
consumer (`AGENTS.md` § Tech debt protocol; `spec/ui/design-system/README.md` §3: a primitive with
no importers is deleted, not kept).

**L2 · Legacy Frapp on a Signet surface.** Geist, bone/bronze/ink, `#2563EB`, `royal-blue-*`,
`navy-900`, an undefined Tailwind key that compiles to nothing, `hsl(var(--token))` hand-wrapping,
a live `dark:` variant in `apps/web`, NativeWind or raw hex or a `fontSize` literal in
`apps/mobile`, a primitive the #920 primitives slice deleted (`accordion`, `progress`,
`scroll-area`, `separator`, `skeleton`, `sonner`, `tooltip`, `Button`'s `outline` variant) coming
back — the table in [`signet-cutover`](../signet-cutover/SKILL.md) and
[`ui-development`](../ui-development/SKILL.md) is the reference. **On `apps/landing` the same
markers are correct**: it is frozen, and a visual ban is not a defect there.

**L3 · Duplication and parallel paths.** The jscpd clone list is the floor, not the ceiling — it
sees textual clones over 50 tokens, not the same logic written twice. Look for the shape: the
same parse-and-guard, the same error translation, the same interval hook, the same permission
unwrap. Then look for the *parallel path*: an old implementation left live beside its replacement
without a flag or a documented window (`signet-cutover` § Cutover deletes what it replaces).

**L4 · Layering and coupling.** The `dependency-cruiser` rules are the repo's actual boundary
(`.dependency-cruiser.cjs`); the audit skill's red flags (domain importing `@nestjs/*` or
`@supabase/*`, a service importing a DTO, a controller reaching into `infrastructure/`) are the
intent behind them. Fix toward the rule the repo *enforces*, and when the ideal costs duplication
(habit 3) the finding is a design question, not a mechanical move.

**L5 · Correctness anti-patterns in old code.** The `spec/engineering.md` checklist applied to
files nobody has opened in months: `find` results dereferenced without an `undefined` branch,
missing `length === 0` states, unguarded division, a `Number()` on raw input, a `z.number()` where
a cents column needs `.int().nonnegative()`, non-semantic interactives, a soft-disabled control
without `aria-disabled`. These are the visual-prototype defects the standard warns about, and
legacy screens are where they survive.

**L6 · Verification debt.** Consolidated logic with no test of the helper; a spec that asserts
nothing (`expect(true)`); a coverage-ledger backlog entry whose reason no longer holds; a
`TENANT_SCOPE_BACKLOG` repository that has since grown a write path. A fix that consolidates logic
ships a test for the consolidated helper when none exists — the repo's own idiom for this class of
thing is the tree-walking ledger spec, so extend one rather than inventing a new shape.

**L7 · The gates themselves.** A stale baseline entry (the file moved and the violation is gone —
#1539 left two); a jscpd threshold that can drop after a consolidation; an allowlist entry in
`scripts/doc-paths-allowlist.json` or `scripts/npm-audit-allowlist.json` past its stated expiry.
Ratchets only move one way, and moving them is in scope.

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

---

## Phase 2 — Choose one theme

Fix **one theme per run**: one rule restored across every site it applies to (a helper extracted
and *all* its copies replaced; a dead module and *all* its re-exports removed; a legacy token
replaced on *every* Signet screen that carries it), **or** a batch of at most ~6 unrelated small
cleanups — never both in one PR, because a reviewer must be able to hold the PR's one idea in mind.
A candidate ships only if every line below is true:

- **Grounded.** The rule it restores is named and cited. Not taste, not "cleaner".
- **Whole-pattern, and it deletes what it replaces.** Every site, no shim, no "the rest in a
  follow-up" — a half-migrated pattern is two ways to do one thing, which is itself a finding.
  When the whole pattern is genuinely too large for one reviewable PR, ship the first step of a
  sequence you declare up front (`spec/engineering.md` § Changing existing code) and file the
  rest as an ordered epic with sub-issues.
- **Net simpler** (habit 3). Count copies and lines before and after.
- **Verifiable.** A typecheck, lint, test, or gate can demonstrate no behaviour changed. If the
  only evidence is that you read it carefully, it is not a hygiene fix.
- **Bounded.** A reviewer reads it in one sitting. Mechanical breadth is cheap to review (one
  pattern, forty sites); mixed themes are not.
- **Not on the never list**, and not a behaviour change (except the tested-bug exception above).

Prefer, in order: a fix that **closes a `suggestion` issue** (`Fixes #N`); a fix that **shrinks a
gate baseline**; a fix that **deletes** more than it adds; then everything else.

Decline — to the ledger, with the reason — anything that is taste, anything on a frozen surface,
anything whose "clean" fix adds copies, anything needing a product or design decision. **Zero
fixes is a fine outcome.** A run that reports "the slice held up" or "everything I found needs a
decision" and says why is a pass; a run that manufactures a change to show work is a failure.

---

## Phase 3 — Fix and verify

1. Branch `claude/hygiene-scan-YYYY-MM-DD` from `origin/main`. Parallel implementers per workspace
   are fine when the files are disjoint; each reports a diff description, not "done".
2. **Verify against the Phase 0.3 baselines**, in the sandbox, and record the outcome for the PR body:
   `npm run check-types`; `npm run lint` (the `apps/api` warning count did not rise);
   `npm run test -w <workspace> --if-present` for every workspace touched (some packages have no
   suite — say so, don't record a missing script as a failure); `npm run check:dep-cruiser` **plain
   first**, and only when it reports `0 new` run `-- --update-baseline` for a grandfathered or
   stale entry that is gone — the runner re-records *every* current violation, so a re-record with
   a new violation present grows the baseline without a red signal; the JSON diff must be
   **deletions only**, and anything else is a fix to back out; `npm run check:duplication` (the
   percentage did not rise; lower the `.jscpd.json` threshold to just above the new number when a
   consolidation moved it, never below it); `npm run check:api-contract` when any file under
   `apps/api/src` changed (a changed artifact means the contract changed — back the fix out);
   `npm run test:ci-scripts` when `scripts/` changed; `npm run check:doc-paths` when anything a
   doc cites moved. `npm run ci:local-gate` runs lint, types, API tests, the contract check, the
   docs-structure and secret scans, migration safety and the audit gate in one go and is the parity
   run to do last.
3. **A check you could not run is reported as not run**, never as passed — the same honesty rule
   every routine carries. If the sandbox cannot run a suite, say so in the PR body and the report.
4. **Docs.** A moved or renamed file that a doc cites gets the doc fixed in the same PR
   (`check:doc-paths` is whole-tree and required). Otherwise a mechanical PR changes no doc at all —
   nothing requires one, and a filler line in an unrelated doc is a review finding
   ([`DOCS_CI.md`](../../../docs/internal/ci-cd/DOCS_CI.md)).
5. End with the **"debt spotted"** note `AGENTS.md` requires — one line per item you saw and did
   not take, with its issue or ledger reference.

---

## Phase 4 — Review, push, open the PR

1. **Review before pushing, for real.** Run [`/diff-review`](../diff-review/SKILL.md) at `high`
   or better and act on every finding. You are reviewing your own unattended edit of product
   code; the independent verifier pass is the whole reason this routine is allowed to exist. The
   pre-push hook (`.claude/hooks/pre-push-review-gate.sh`) denies `git push` without the review
   marker for the current HEAD; committing invalidates the marker by design, so review **last**.
   Never set `FRAPP_SKIP_REVIEW_GATE`; if the livelock guard ever releases a push labelled
   UNREVIEWED, that is a finding to lead the report with, not a success.
2. **Push and open** against `main` with `mcp__github__create_pull_request`, filling the PR
   template. The body must carry, per fix: **the rule restored** (cited), **the consumers
   checked**, and **the verification that ran** (commands and outcomes, including what could not
   run). Any behaviour change sits under its own heading. Close tracked work with `Fixes #N`. Label
   `release:patch`. If the GitHub MCP is
   unavailable, push the branch, report its name, and stop — there is no sanctioned fallback.
3. **Fix your own CI, then stop — do not subscribe.** `AGENTS.md` § Autonomous PR lifecycle
   (`doneMeansMerged`, subscribe, babysit) is written for interactive sessions and does not apply
   here: merging is forbidden, and the Routines setting *Autofix on PR create* is **on** for this
   routine, so a routine session that also subscribes puts two drivers on one branch pushing
   different fixes. Instead, before the report, read the PR's check runs once
   (`pull_request_read get_check_runs`); a failure in code you just touched is yours — fix it,
   re-review (the marker keys on HEAD), push; an infra death is a re-run. Never widen the PR to
   chase a red check outside your theme, never push an empty commit to kick CI, and **never
   merge**. Then the run ends with the report; autofix is the single driver after that, and a
   review comment waits for the next run's Phase 0.5.

---

## Phase 5 — File the rest, and write the ledger

**File** what you will not fix unattended through [`file-follow-up`](../file-follow-up/SKILL.md),
exactly as feature work does: labels `triage` + `suggestion` + one `area:<x>` + a priority
(`P3`/`P4` for hygiene; `P1`/`P2` only for the security or data-loss bug that is not hygiene at
all), an **Agent brief** (`model:fable` for anything cross-cutting), the finding in the format
above with the design question spelled out when there is one, and a visible dedup line:

```text
agent-suggestion: v1 fp=hygiene/<slug> file=<primary-path>
```

Search that `fp=` before filing (open and closed). Cap at **~3 net-new issues per run** — the
Curator's net-growth budget binds here too, and a hygiene backlog that balloons is the failure
mode this routine replaces. Everything past the cap goes to the ledger, where a later run can
promote it.

**Ledger.** Append **one comment** to the "Hygiene Scan — ledger" issue per run, in this shape,
and never rewrite its body (no MCP read returns a body faithfully — `ROUTINES.md` § Tracker access):

```text
hygiene-scan run: v1 date=YYYY-MM-DD slice=<0-4> pr=#<N>|none filed=#<a>,#<b>|none
fixed:    <one line per theme or cleanup, rule restored, sites>
declined: fp=hygiene/<slug> file=<path> — <reason>        (new this run only, one per line; standing for 30 days)
found:    fp=hygiene/<slug> file=<path> — <one line>      (past the filing cap; a later run may promote)
carry:    <what the next run should know: where you stopped, a baseline that can ratchet, a PR waiting on a human>
```

This is state, not a status update: the "comment once" rule is about restating what stands, and a
run entry never restates. Keep it to the facts the next run needs.

---

## Budget and guardrails

- **Zero fixes is a success** when the reasons are written down. Never lower the bar to have a PR.
- **One theme, one PR, one open at a time.** No stacking, no "while I'm here".
- **Whole-pattern or file it.** Never leave a pattern half-migrated.
- **Net simpler, always.** A fix that adds a copy, a shim, or a parallel path is the wrong fix.
- **Frozen means frozen.** `apps/landing` visuals, the seven mobile hotspot files, the legacy
  theme exports landing consumes, ADRs, `.buildpad/`.
- **Spec is intent; code is current.** A spec-vs-code contradiction is filed, never resolved by
  editing either side to match the other (`AGENTS.md` § Spec vs code).
- **Never print secret values.** Names and presence only.
- **Say "not run" rather than guessing.** A verification you did not run did not happen.
- **Never** migrations, CI workflows, dependency versions, gate posture, `FRAPP_SKIP_REVIEW_GATE`,
  an empty commit, a self-merge.

---

## Run report

End every run with, in this order:

1. **Lead line** — the PR link and its one-sentence theme, or "no PR" and why; then any
   security/data-loss bug found (issue number) before anything else.
2. **Grounding** — the standards read, the slice (group + day of year), the baselines recorded
   (types, lint warnings, dep-cruiser entries, duplication %, tests), what the ledger and the open
   PR said.
3. **Fixed** — one line per fix: rule restored, sites, verification outcome. Which baselines
   moved.
4. **Filed** — issue numbers with one line each.
5. **Declined / found, not filed** — the ledger lines, so the owner can overrule a decline.
6. **Needs you** — the design questions, the frozen-surface findings, the spec-vs-code
   contradictions, the open PR waiting on review. This is the section the owner reads; be specific
   enough to decide from.
7. **Not run** — anything you could not verify, and why.
8. **Debt spotted** — even when "none".

---

## Self-maintenance

Same contract as the other routines
([`ROUTINES.md` → Self-maintenance](../../../docs/internal/ci-cd/ROUTINES.md#self-maintenance-the-update-themselves-contract)),
folded into this run's PR rather than a second one. Each run, verify: the commands in the Phase
0.3 table still exist in `package.json`; the slice table still names real directories (a new
package or a moved layer joins its group); the ledger-spec paths and the skills this file cites
still resolve; the frozen list still matches `signet-cutover` and `spec/ui/mobile/navigation.md`.
Fix mechanical drift here in the same PR (pairing it with `ROUTINES.md` when the PR would
otherwise touch no `docs/` file — the `.claude/`-only trap). Judgement-laden drift — a lens that
seems wrong, a slice that should split, a guardrail that seems too tight or too loose — goes in the
run report under "Needs you", never a self-authored rewrite of what this routine is *for*.
