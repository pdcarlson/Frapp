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

- **Tenant isolation.** RLS is enabled on every base table with **no permissive policies**, and the
  API holds the `service_role` key, which bypasses RLS entirely. Isolation is therefore
  *application-layer only*. Flag any new query missing `.eq('chapter_id', chapterId)`, and any role
  or permission lookup not re-scoped by `chapter_id` — a stray cross-chapter `role_id` otherwise
  leaks permissions. `apps/api/src/application/services/search.service.ts` is the reference pattern:
  it filters candidates through `canAccessChannel` and re-scopes roles by chapter.
- **Permission enforcement.** New controller routes need `@RequirePermissions` or
  `@RequireAnyOfPermissions`. Anything invocable on a member's behalf must enforce *that caller's*
  permissions, never the service's ambient authority.
- **Migration safety.** Migrations must pass `npm run check:migration-safety` and replay under
  PGlite (`npm run check:pglite-migrations`). Flag anything that breaks the PGlite path — a
  `create extension` is the known trap. Flag destructive DDL without a stated backfill or rollback.
- **Doc-sync mandate.** Every non-doc change needs a matching update under `docs/` or `spec/`, in
  that content's canonical home per `docs/internal/DOCUMENTATION_CONVENTIONS.md`. A new stray file
  added just to satisfy the gate is itself a finding.
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

Rank: correctness and security above cleanups; `CONFIRMED` above `PLAUSIBLE`. Merge findings that
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
2. **File a self-contained follow-up** as a GitHub issue (`issue_write` create, labels `triage` +
   a priority + one `area:<x>`) with an explicit reason for deferring.

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
