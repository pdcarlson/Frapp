---
name: diff-review
description: >
  Review the current working diff for correctness bugs, security holes, and cleanups before
  pushing. Use before any git push, when the pre-push review gate blocks a push, and whenever
  asked to review uncommitted or unpushed work on this branch.
argument-hint: "[medium|high|xhigh] [<target>]"
allowed-tools: Agent, Task, Read, Grep, Glob, Edit, Write, ReportFindings, Bash(git diff *), Bash(git show *), Bash(git log *), Bash(git status *), Bash(git rev-parse *), Bash(git merge-base *), Bash(npm run check:*), Bash(mkdir *), Bash(touch *)
---

# Review this branch's diff

Frapp's pre-PR review gate — the review an agent can **always** run.

**Try `/code-review` first.** The bundled command is richer (per-model-tuned effort cells, a
workflow-backed verifier pass at `high`/`xhigh`/`max`, cloud `ultra` mode, `--fix`, `--comment`), and
it is *conditionally* model-invocable: `Skill(skill: "code-review")` succeeds only when the current
turn's prompt carries the token `/code-review` **whitespace-delimited on both sides** (regex
`(?<!\S)/code-review(?=$|\s)`). Backticks, quotes, `**bold**`, and a trailing `.` or `,` all defeat
it — so **expect refusal by default**, including on prompts that plainly read as asking for a review.
If it returns `cannot be used with Skill tool due to disable-model-invocation`, that condition simply
is not met — expected, not an error — so fall through to this skill. It is also always refused inside a sub-agent.
Note that `/code-review` does **not** write the gate marker (Phase 4 below); this skill does.

Use this skill when `/code-review` is refused, and for the Frapp-specific angles below, which the
bundled command has no knowledge of. Full invocation rule:
`docs/internal/ci-cd/AI_CODE_REVIEW_RUNBOOK.md`.

**Do not weaken this into a rubber stamp.** You are usually reviewing your own work, so the
independent verification pass in Phase 2 is what makes the result trustworthy. Skipping it turns
this skill into you agreeing with yourself.

## Phase 0 — Scope

Establish the diff. In order, first that yields a non-empty result:

1. `git diff @{upstream}...HEAD` — the unpushed commits.
2. `git diff origin/main...HEAD` — when no upstream is configured (the usual case on a fresh branch).
3. `git diff HEAD~1` — a single-commit branch.

Additionally run `git diff HEAD` and include uncommitted changes when the tree is dirty. If an
explicit `<target>` argument is given (a path, a ref, or a range), it overrides all of the above.

State the resolved scope in one line — base, head, file count — before reviewing. If the diff is
empty, say so and stop; do not invent findings.

Effort controls the **generic** angle count and the findings cap. The Frapp-specific angles are
always included at every level — they are cheap, targeted greps, and several may be bundled into one
subagent. Never drop them to fit a budget.

| Level | Generic angles | Findings cap | Gap sweep |
|---|---|---|---|
| `medium` | 3 | 6 | no |
| `high` (default) | 5 | 10 | no |
| `xhigh` | 5 | 15 | yes |

## Phase 1 — Find

Launch finder subagents **in parallel, in a single message** (`Agent`, subagent_type
`general-purpose`), one per angle. Give each the resolved diff scope and its angle only. Each
returns at most 6 candidates, every one with `file`, `line`, a one-sentence `summary`, and a
concrete `failure_scenario` — specific inputs or state leading to a wrong result. A candidate
without a plausible failure scenario is not a finding; drop it.

### Generic angles

- **Hunk scan.** Line by line through every changed hunk. Also read the *unchanged* lines of any
  function that was touched — most real bugs are interactions between new and existing lines.
- **Removed behavior.** For every deleted or replaced line, what did it do, and who depended on it?
  Guard clauses, error branches, cleanup, and fallbacks that quietly disappeared.
- **Caller/callee tracing.** For each changed signature, return shape, or thrown error, find every
  caller and confirm they still hold. Grep for the symbol; don't assume the diff shows all uses.
- **Language pitfalls.** Missing `await` (especially a floating promise whose rejection is
  swallowed), `null`/`undefined` confusion, off-by-one, unhandled rejection paths, `catch` blocks
  that discard the error, shell scripts unquoted or missing `set -u` guarantees.
- **Reuse, simplification, efficiency.** An existing helper that should have been used instead of
  new code; logic that collapses; an avoidable N+1 or repeated full scan.

### Frapp-specific angles — always include these

These encode invariants this codebase cannot enforce for itself. Each is a real, previously observed
failure mode, not a hypothetical.

- **Tenant isolation.** RLS is enabled on every base table with **no permissive policies** (the
  chat hot path's narrow client-read policies are the audited exception — see
  `docs/internal/security/AUTHORIZATION_MODEL.md`), and the
  API holds the `service_role` key, which bypasses RLS entirely. Isolation for API queries is
  therefore *application-layer only*. Flag any new query missing `.eq('chapter_id', chapterId)`, and any role
  or permission lookup not re-scoped by `chapter_id` — a stray cross-chapter `role_id` otherwise
  leaks permissions. `apps/api/src/application/services/search.service.ts` is the reference pattern:
  it filters candidates through `canAccessChannel` and re-scopes roles by chapter.
- **Permission enforcement.** New controller routes need `@RequirePermissions` or
  `@RequireAnyOfPermissions`. Anything invocable on a member's behalf must enforce *that caller's*
  permissions, never the service's ambient authority.
- **Migration safety.** Migrations must pass `npm run check:migration-safety` and replay under
  PGlite (`npm run check:pglite-migrations`). Flag anything that breaks the PGlite path — a
  `create extension` is the known trap. Flag destructive DDL without a stated backfill or rollback.
- **Docs — the reviewer.** The standard is
  [`DOCUMENTATION_CONVENTIONS.md`](../../../docs/internal/DOCUMENTATION_CONVENTIONS.md); this angle
  reads a diff against it. No check requires a doc edit — the gate that did was deleted in #1597 for
  producing filler — so never flag a PR for lacking one. Flag these. Every search below is the
  `Grep` tool — `git grep` is not in this skill's `allowed-tools`, so do not reach for it.
  - **Section references.** For every heading the diff renames or removes — including a
    `* ## Heading` inside a block comment, since source files carry headings too — take the *old*
    text off the diff's `-` side and search the tree for it: the bare heading, the section-symbol
    forms (`§ Heading`, `§ "Heading"`), and the `#heading-slug` anchor. Search the whole tree, not
    only `docs/` and `spec/` — such references live in source comments, and in tests that key on a
    doc's section titles, where a renamed heading fails a suite. A prose `§` reference is validated
    by nothing; a markdown link with an `#anchor` under the trees `.github/workflows/links.yml`
    walks is validated by that checker, so prefer the link in anything you write.
  - **Deletion sweep.** For every file, exported symbol, npm script, workflow job id or command the
    diff deletes, search the corpus for prose naming it. A deletion is not finished while a doc
    still gives instructions about the deleted thing. Separate a live instruction from a
    deliberately historical reference: a removals table or a dated amendment *needs* the dead name
    and is not a finding; a step someone will try to follow is. When you cannot tell, treat it as
    live.
  - **Roster drift.** For every array, job id, workspace list, table or version constant the diff
    changes, search for a doc that restates it by hand. This is the case that reads as a pure code
    change while the breakage sits in a doc nobody on the PR opened.

    The semantic sweep in [#1635](https://github.com/pdcarlson/Frapp/issues/1635) adjudicated 57
    duplicated facts and found **52 already had a false copy in the tree**. These are the sources
    whose rosters that sweep found restated in prose — when the diff touches one, search the corpus
    before you approve it. The list is the useful residue of that sweep's per-fact analysis, not an
    exhaustive inventory; treat a source not named here the same way.

    | Source of truth | Search these when it changes |
    | --- | --- |
    | `scripts/ci/lib/required-checks.mjs` (`CI_CHECKS` / `DOCS_CHECKS` / `DRIFT_CHECKS`) | `GITHUB_BRANCH_PROTECTION_RUNBOOK.md`, `spec/environments/README.md`, `QUALITY_GATES.md`, `docs/README.md`, `docs/hooks/README.md` |
    | `.github/workflows/ci.yml` job steps (esp. which workspaces `web-tests` runs) | `GITHUB_BRANCH_PROTECTION_RUNBOOK.md`, `docs/hooks/README.md` |
    | `CHAT_MESSAGE_KINDS` (declared in **three** files: `@repo/validation`, `chat.entity.ts`, `@repo/chat-core`) | `spec/behavior/chat/README.md`, `spec/architecture/README.md` |
    | `push-rules.ts:defaultLevelFor` | `spec/behavior/notifications.md`, `spec/architecture/README.md` |
    | `packages/validation/src/upload-allowlists.ts` (`MAX_UPLOAD_BYTES`, kinds) — **per-bucket caps differ**; `config.toml` is not the same number | `content-validation.md`, `spec/architecture/README.md` § 7, `AUTHORIZATION_MODEL.md` |
    | `buildChapterConfigFromArchetype` (which seeds are `structuredClone`d) | `spec/engineering.md`, `spec/architecture/README.md` |
    | `DEFAULT_SYSTEM_ROLES` / `DEFAULT_CHANNELS` / `SystemPermissions` | `spec/behavior/rbac.md`, `spec/behavior/chat/README.md`, `spec/product/modules.md`, `AUTHORIZATION_MODEL.md` |
    | `scripts/check-env-slugs.mjs:INFISICAL_ENV_SLUGS` | `ENV_REFERENCE.md`, `SECRETS_MANAGEMENT.md`, `docs/guides/env-config.md`, `spec/environments/README.md` |
    | Storage bucket declarations in `supabase/migrations/` | `spec/architecture/README.md` § 7, `AUTHORIZATION_MODEL.md` |
    | `apps/web/tests/visual/routes.ts` | `apps/web/tests/visual/README.md` |
    | The exact React pin — every `package.json` naming it, root `overrides` included (`git ls-files '*package.json' \| xargs grep -ln '"react": "19'`) | `AGENTS.md`, `MOBILE_TESTING.md`, `SECURITY_FIXES.md` |

    **A hand-maintained count is the highest-risk form.** Prefer deleting it and linking over
    syncing it — that is what the standard says, and a count with no mechanism behind it is a future
    contradiction whether or not it is true today.
  - **Placement and duplication.** A new or moved fact belongs in the home the standard names — not
    a stray file added so the change looks documented, and not an unowned section appended to
    whichever doc was open; the test is what that doc is *for*. Two homes for one fact is a defect:
    merge them and link, rather than syncing both.
  - **The two rewrite defects.** Flag a rewrite that states more than the original verified — one
    case widened into a claim about all of them. Flag an edit that drops a dated stamp, a run link,
    a run id, a PR number, or the command behind a figure: that is evidence, not narration.

  **What this angle dropped.** CI used to scan the whole corpus every run: cited paths resolve,
  filename references resolve, hand-copied rosters match their source, and every doc sits in a
  declared home under a conforming name. This angle inherits only the slice of each that the
  diff makes visible, and doc naming and placement are now conventions the standard states rather
  than rules a machine enforces. **It cannot catch drift between two files when neither is in the
  diff.** Nor does CI close that gap: what still runs and over which trees — including the fixed
  `SCAN_ROOTS` list the env-slug check reads, which is narrower than the corpus and does not include
  `.claude/` — is in [`DOCS_CI.md`](../../../docs/internal/ci-cd/DOCS_CI.md), which is its one home;
  read it there rather than restating it here. That is the accepted cost of deleting the gates: a
  clean review here is not evidence that the corpus is clean, and must never be reported as if it
  were.
- **Blast radius, not diff radius.** "Pre-existing" is not grounds to drop a candidate, and a finder
  that drops one for that reason is under-reporting. Judge every such candidate against
  [`spec/engineering.md`](../../../spec/engineering.md#changing-existing-code) § Changing existing
  code, which draws the fence — do not re-derive it here.
- **Tracker rule.** Issues are opened on GitHub with the `triage` label. Shared boundary:
  [`ROUTINES.md`](../../../docs/internal/ci-cd/ROUTINES.md#shared-ownership-boundary-all-routines).
  Flag any code, script, or workflow that writes to a retired tracker.
- **Secrets.** No secret values in source, logs, error messages, or committed files. Local Supabase
  demo keys are not secrets; real Stripe or Infisical values are.
- **Verification honesty.** Flag any comment, doc line, or PR text claiming a check was run that the
  diff shows could not have been — for example asserting an E2E pass when the stack cannot start.

## Phase 2 — Verify (do not skip)

For **each surviving candidate**, launch one independent verifier subagent. Give it the candidate
and the file, and instruct it to actively try to *disprove* the finding by reading the surrounding
code. It returns exactly one verdict:

- `CONFIRMED` — the failure scenario holds; it traced the path.
- `PLAUSIBLE` — cannot fully confirm without running it, but the concern is real.
- `REFUTED` — something already prevents this (a guard upstream, a type constraint, a caller
  invariant). It must name what.

Discard everything `REFUTED`. Run verifiers in parallel where there are several.

## Phase 3 — Synthesize and report

Rank: correctness and security above cleanups; `CONFIRMED` above `PLAUSIBLE`. A docs finding that
names a concrete broken pointer, an orphaned section reference, or a removed dated stamp is a
**correctness** finding, not a cleanup, and is not dropped to fit the cap. Merge findings that
share one root cause into a single entry. Cap at the effort level's limit.

Report with **one `ReportFindings` call**, most severe first, setting `level` to the effort used and
`verdict` on each finding. Pass an empty array when nothing survived — that is a valid, useful
result. When you use the tool, don't *also* restate each finding as prose; the host UI renders them.

**If `ReportFindings` is unavailable** (it is gated — absent at `low` effort, under
`--output-format text|json`, and behind a feature flag), fall back to a numbered prose list with the
same fields per finding: file, line, verdict, summary, failure scenario. Never finish a review having
emitted nothing — silence is indistinguishable from a clean diff, which is the one outcome you must
not fake.

Then act on every finding. Do one of exactly two things per finding:

1. **Fix it** in the working tree, or
2. **File a self-contained follow-up** per [`file-follow-up`](../file-follow-up/SKILL.md) (not a
   drive-by `issue_write` with only `triage`) with an explicit reason for deferring.

Record the disposition where it is auditable: after acting, re-call `ReportFindings` with `outcome`
set per finding (`fixed` / `skipped` / `no_change_needed`) — that is what the field is for. A short
prose line mapping each finding to its disposition is also fine and is *not* what the "don't restate
as prose" rule above is about; that rule is only to avoid duplicating the rendered findings list.

Never silently leave a finding unaddressed. If the GitHub MCP is unreachable, say so and carry the
finding forward in your summary and the PR body rather than dropping it.

## Phase 4 — Record that the review ran

Write a marker so the pre-push gate can tell a real review from a retried push:

```sh
mkdir -p "$(git rev-parse --show-toplevel)/.cache/diff-review" \
  && touch "$(git rev-parse --show-toplevel)/.cache/diff-review/$(git rev-parse HEAD)"
```

**Use the absolute repo-root path, as above — not a `.cache/…` path relative to the cwd.** The hook
reads `<repo-root>/.cache/diff-review/<SHA>`, so a marker written from `apps/api` lands somewhere the
hook never looks. `.gitignore` matches `.cache/diff-review/` at any depth, so a stray copy is
invisible in `git status` and the mismatch would be silent — you'd just get denied until the livelock
guard released the push labelled UNREVIEWED.

Only do this **after** reporting and acting on findings. The gate keys on the HEAD SHA, so committing
fixes invalidates the marker by design — re-run this skill on the new HEAD, and the review always
covers exactly what gets pushed.
