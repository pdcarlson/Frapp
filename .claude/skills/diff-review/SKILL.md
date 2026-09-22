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

Frapp's pre-push review gate, and the review an agent can always run. Done means the findings are
reported, each one is fixed or filed, and the gate marker exists for the commit you are pushing.

**Try `/code-review` first.** The bundled command is richer, but a model can invoke it only when the
current turn's prompt carries the token whitespace-delimited on both sides (regex
`(?<!\S)/code-review(?=$|\s)`). Backticks, quotes, `**bold**`, and a trailing `.` or `,` all defeat
the match, and it is always refused inside a subagent, so expect refusal. A result reading
`cannot be used with Skill tool due to disable-model-invocation` means the condition isn't met; carry
on with this skill. Full rule: `docs/internal/ci-cd/AI_CODE_REVIEW_RUNBOOK.md`. `/code-review` knows
nothing of the Frapp-specific angles below and does not write the gate marker, so after it runs,
cover those angles here and write the marker (Phase 4) yourself.

Don't get past the gate with `git push --no-verify`: it bypasses the hook and leaves no review
evidence.

You are usually reviewing your own work. The independent verifier pass in Phase 2 is what makes the
result more than you agreeing with yourself, so it runs at every effort level.

## Phase 0 — Scope

Use the first of these that is non-empty:

1. `git diff @{upstream}...HEAD`
2. `git diff origin/main...HEAD` (no upstream, the usual case on a fresh branch)
3. `git diff HEAD~1`

Add `git diff HEAD` when the tree is dirty. An explicit `<target>` (path, ref, or range) overrides
all of this. State the scope in one line (base, head, file count). If the diff is empty, say so and
stop.

Effort sets the generic angle count and the findings cap. The Frapp-specific angles run at every
level: they are cheap, targeted searches, and several can share one finder.

| Level | Generic angles | Findings cap | Gap sweep |
|---|---|---|---|
| `medium` | 3 | 6 | no |
| `high` (default) | 5 | 10 | no |
| `xhigh` | 5 | 15 | yes |

The gap sweep is one more `diff-finder` after Phase 2, given the surviving findings, with the angle
"what the other angles missed". Verify its candidates the same way.

## Phase 1 — Find

Launch one `diff-finder` agent per angle, all in one message so they run in parallel, and give each
the resolved scope and its angle. (Where an agent type here or in Phase 2 isn't available,
run a general-purpose agent with its `.claude/agents/` file's body as the prompt.) Each returns
up to 6 candidates with `file`, `line`, `summary`, and `failure_scenario`. Drop a candidate with no
plausible failure scenario.

### Generic angles

- **Hunk scan.** Every changed hunk, plus the unchanged lines of each touched function, since most
  bugs are interactions between new and existing lines.
- **Removed behavior.** For each deleted or replaced line, what it did and who depended on it:
  guards, error branches, cleanup, fallbacks.
- **Caller/callee tracing.** For each changed signature, return shape, or thrown error, grep every
  caller; the diff doesn't show all uses.
- **Language pitfalls.** Missing `await` (a floating promise swallows its rejection),
  `null`/`undefined` confusion, off-by-one, `catch` blocks that discard the error, unquoted shell
  variables or a missing `set -u`.
- **Reuse, simplification, efficiency.** An existing helper the new code duplicates, logic that
  collapses, an avoidable N+1 or repeated full scan.

### Frapp-specific angles

These encode invariants the codebase can't enforce for itself.

- **Tenant isolation.** RLS is on for every base table with no permissive policies (the chat hot
  path's narrow client-read policies are the audited exception; see
  `docs/internal/security/AUTHORIZATION_MODEL.md`), but the API holds the `service_role` key, which
  bypasses RLS. Isolation for API queries is therefore application-layer only. Flag a new query
  without `.eq('chapter_id', chapterId)`, and a role or permission lookup not re-scoped by
  `chapter_id` (a cross-chapter `role_id` leaks permissions). Reference pattern:
  `apps/api/src/application/services/search.service.ts`, which filters through `canAccessChannel`
  and re-scopes roles by chapter.
- **Permission enforcement.** New controller routes need `@RequirePermissions` or
  `@RequireAnyOfPermissions`. Anything invoked on a member's behalf enforces that caller's
  permissions, not the service's ambient authority.
- **Migration safety.** Migrations pass `npm run check:migration-safety` and replay under PGlite
  (`npm run check:pglite-migrations`); `create extension` is the known PGlite breaker. Flag
  destructive DDL with no stated backfill or rollback.
- **Docs**, read against
  [`DOCUMENTATION_CONVENTIONS.md`](../../../docs/internal/DOCUMENTATION_CONVENTIONS.md). No check
  requires a doc edit, so never flag a PR for lacking one. Grep the whole tree, not only `docs/` and
  `spec/`: source comments and tests key on doc headings too.
  - **Section references.** For each heading the diff renames or removes (including a
    `* ## Heading` in a block comment), search for the old text as a bare heading, as `§ Heading`
    and `§ "Heading"`, and as a `#slug` anchor. `.github/workflows/links.yml` validates markdown
    `#anchor` links in the trees it walks; nothing validates a prose `§` reference, so prefer the
    link in anything you write.
  - **Deletion sweep.** For each deleted file, exported symbol, npm script, workflow job id, or
    command, find prose that still names it. A live instruction is a finding; a deliberately
    historical mention (a removals table, a dated amendment) is not. When unsure, treat it as live.
  - **Roster drift.** For each array, job id, workspace list, table, or version constant the diff
    changes, search for docs that restate it by hand; the breakage sits in a doc nobody on the PR
    opened. Known restatements (not exhaustive; treat an unlisted source the same way):

    | Source of truth | Docs that restate it |
    | --- | --- |
    | `scripts/ci/lib/required-checks.mjs` (`CI_CHECKS` / `DOCS_CHECKS` / `DRIFT_CHECKS`) | `GITHUB_BRANCH_PROTECTION_RUNBOOK.md`, `spec/environments/README.md`, `QUALITY_GATES.md`, `docs/README.md`, `docs/hooks/README.md`, `.claude/skills/testing/SKILL.md` (CI parity checklist) |
    | `.github/workflows/ci.yml` job steps (which workspaces `web-tests` runs) | `GITHUB_BRANCH_PROTECTION_RUNBOOK.md`, `docs/hooks/README.md` |
    | `CHAT_MESSAGE_KINDS`, declared in three files (`@repo/validation`, `chat.entity.ts`, `@repo/chat-core`) | `spec/behavior/chat/README.md`, `spec/architecture/README.md` |
    | `push-rules.ts:defaultLevelFor` | `spec/behavior/notifications.md`, `spec/architecture/README.md` |
    | `packages/validation/src/upload-allowlists.ts` (`MAX_UPLOAD_BYTES`, kinds); per-bucket caps differ, and `config.toml` is a different number | `content-validation.md`, `spec/architecture/README.md` § 7, `AUTHORIZATION_MODEL.md` |
    | `buildChapterConfigFromArchetype` (which seeds are `structuredClone`d) | `spec/engineering.md`, `spec/architecture/README.md` |
    | `DEFAULT_SYSTEM_ROLES` / `DEFAULT_CHANNELS` / `SystemPermissions` | `spec/behavior/rbac.md`, `spec/behavior/chat/README.md`, `spec/behavior/alumni.md`, `spec/product/modules.md`, `spec/product/personas.md`, `AUTHORIZATION_MODEL.md` |
    | `scripts/check-env-slugs.mjs:INFISICAL_ENV_SLUGS` | `ENV_REFERENCE.md`, `SECRETS_MANAGEMENT.md`, `docs/guides/env-config.md`, `spec/environments/README.md` |
    | Storage bucket declarations in `supabase/migrations/` | `spec/architecture/README.md` § 7, `AUTHORIZATION_MODEL.md` |
    | `apps/web/tests/visual/routes.ts` | `apps/web/tests/visual/README.md` |
    | The React pin in every `package.json`, root `overrides` included (`git ls-files '*package.json' \| xargs grep -ln '"react": "19'`) | `AGENTS.md`, `MOBILE_TESTING.md`, `SECURITY_FIXES.md` |
    | `QueryClient` defaults in `apps/web/lib/providers/query-provider.tsx` and `apps/mobile/lib/query-client.ts`; they differ, and an unset option resolves per platform | `spec/ui/resilience/`, `spec/ui/web-dashboard/README.md` |
    | The `delete from` block of the `anonymize_user` RPC (the latest migration re-creating it wins) | `spec/behavior/data-retention.md` |
    | `throttle-profiles.decorator.ts` and every handler applying a profile (applied per route, never inherited) | `spec/behavior/README.md` § Per-route rate limits, `docs/guides/api-architecture.md` |
    | Appearance config: `apps/web/app/providers.tsx` (whether a theme provider exists) and `userInterfaceStyle` in `apps/mobile/app.json` | `spec/behavior/README.md` § Dark Mode, `spec/architecture/README.md` §§ 3.2 and 3.3, `spec/ui/web-dashboard/README.md`, `spec/ui/mobile/README.md` |

    A hand-maintained count is the riskiest form: prefer deleting it and linking over syncing it.
  - **Placement and duplication.** A new or moved fact goes in the home the standard names, judged by
    what each doc is for, not in a stray new file or an unowned section of whichever doc was open.
    Two homes for one fact is a defect: merge them and link.
  - **Rewrite defects.** A rewrite that claims more than the original verified (one case widened
    into a claim about all). An edit that drops a dated stamp, run link, run id, PR number, or the
    command behind a figure; those are evidence, not narration.

  This angle sees only the drift the diff makes visible. It can't catch two files drifting apart
  when neither is in the diff, and CI doesn't close that gap either (what CI still scans is in
  [`DOCS_CI.md`](../../../docs/internal/ci-cd/DOCS_CI.md)). Never report a clean review as evidence
  that the corpus is clean.
- **Blast radius, not diff radius.** "Pre-existing" is no reason to drop a candidate. Judge it
  against [`spec/engineering.md`](../../../spec/engineering.md#changing-existing-code) § Changing
  existing code, which draws the fence.
- **Tracker.** Flag code, scripts, or workflows that write to a retired tracker. Issues live on
  GitHub ([`ROUTINES.md`](../../../docs/internal/ci-cd/ROUTINES.md#shared-ownership-boundary-all-routines)).
- **Secrets.** No secret values in source, logs, error messages, or committed files. Local Supabase
  demo keys are not secrets; real Stripe or Infisical values are.
- **Verification honesty.** Flag a comment, doc line, or PR text claiming a check ran that the diff
  shows could not have (an E2E pass when the stack can't start).

## Phase 2 — Verify

Launch one `claim-verifier` agent per surviving candidate, in parallel, with the candidate's file,
line, summary, and failure scenario. It tries to disprove the finding and returns `CONFIRMED`,
`PLAUSIBLE`, or `REFUTED` with evidence. Discard everything `REFUTED`.

## Phase 3 — Synthesize and report

Rank correctness and security above cleanups, and `CONFIRMED` above `PLAUSIBLE`. A docs finding that
names a concrete broken pointer, an orphaned section reference, or a dropped dated stamp is a
correctness finding and is not cut to fit the cap. Merge findings that share a root cause. Cap at the
level's limit.

Report with one `ReportFindings` call, most severe first, with `level` set to the effort used and
`verdict` on each finding. Pass an empty array when nothing survived. Don't also restate the findings
as prose; the host renders them.

If `ReportFindings` is unavailable (it is absent at `low` effort, under
`--output-format text|json`, and behind a feature flag), write a numbered list with the same fields:
file, line, verdict, summary, failure scenario. Always emit one or the other, because silence is
indistinguishable from a clean diff.

Then act on every finding, one of two ways:

1. Fix it in the working tree.
2. File a self-contained follow-up per [`file-follow-up`](../file-follow-up/SKILL.md), with the
   reason for deferring.

Record the dispositions by calling `ReportFindings` again with `outcome` set per finding (`fixed`,
`skipped`, `no_change_needed`); a one-line prose mapping of finding to disposition is also fine. If
the GitHub MCP is unreachable, say so and carry the unfiled finding in your summary and the PR body.

## Phase 4 — Record that the review ran

After reporting and acting on the findings, write the marker the pre-push hook checks:

```sh
mkdir -p "$(git rev-parse --show-toplevel)/.cache/diff-review" \
  && touch "$(git rev-parse --show-toplevel)/.cache/diff-review/$(git rev-parse HEAD)"
```

Use the absolute repo-root path, as above, not a `.cache/…` path relative to the cwd.
`.githooks/pre-push` reads `<repo-root>/.cache/diff-review/<SHA>`, so a marker written from
`apps/api` lands where the hook never looks and the push stays denied. The marker is keyed to the
commit, so committing fixes invalidates it by design: re-run this skill on the new HEAD, and the
review always covers exactly what gets pushed.
