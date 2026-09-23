---
name: diff-review
description: >
  Review the current working diff for correctness bugs, security holes, and cleanups before
  pushing. Use before any git push, when the pre-push review gate blocks a push, and whenever
  asked to review uncommitted or unpushed work on this branch.
argument-hint: "[medium|high|xhigh] [full] [ultracode] [<target>]"
allowed-tools: Agent, Task, Workflow, Read, Grep, Glob, Edit, Write, ReportFindings, Bash(git diff *), Bash(git show *), Bash(git log *), Bash(git status *), Bash(git rev-parse *), Bash(git merge-base *), Bash(git fetch origin main), Bash(node scripts/diff-review-scope.mjs*), Bash(npm run check:*)
---

# Review this branch's diff

Frapp's pre-push review gate, and the review an agent can always run. Done means the findings are
reported, each one is fixed or filed, and the gate marker exists for the commit you are pushing.

This is the one review that is allowed to be big. Every other fan-out in the repo stays small
([`multi-agent`](../multi-agent/SKILL.md)), because this gate reviews everything that gets pushed.

**`/code-review` doesn't replace this skill.** A model can invoke the bundled command only when the
current turn's prompt carries the token whitespace-delimited on both sides (regex
`(?<!\S)/code-review(?=$|\s)`). Backticks, quotes, `**bold**`, and a trailing `.` or `,` all defeat
the match, and it is always refused inside a subagent. When the token is there, run it as asked,
then run this skill in full: `/code-review` knows nothing of the Frapp-specific angles, for Opus
models it runs no verifier pass, and it doesn't write the gate marker. Full rule:
`docs/internal/ci-cd/AI_CODE_REVIEW_RUNBOOK.md`.

Don't get past the gate with `git push --no-verify`: it bypasses the hook and leaves no review
evidence.

You are usually reviewing your own work. The independent verifier pass in Phase 2 is what makes the
result more than you agreeing with yourself, so it runs at every effort level and in a re-review.

## Phase 0 — Scope

Fetch main, then resolve the scope once, to pinned SHAs, with the scope script:

```sh
git fetch origin main                     # a stale origin/main makes main's commits look like the branch's
node scripts/diff-review-scope.mjs        # add --full to force a full review
```

It prints one JSON line: `mode`, `base`, `head`, `branchBase`, `root`, `files`, `changedLines`,
`dirty`. Use those values as they are. Don't re-resolve `origin/main` later: a background agent's
`git fetch` can move it mid-review, and the same command would then name a different diff.

- **`full`**: the branch's first review in this checkout, from `branchBase`.
- **`delta`**: the branch passed a review up to `base`, so this reviews only the commits since. The
  finders still read the whole branch for context. This is the fix round. A level argument doesn't
  change it; `full` does. If a merge landed since `base`, the script returns `full` instead: a merge
  can hide a change (a conflict resolved by taking one side whole appears in no diff of the merge).
- **`none`**: HEAD already has a marker. **`empty`**: the branch has no commits of its own.
  Say so and stop. To push a commit that is already on `origin/main` anyway (a tag, say), mark it
  `merged` in Phase 4. It is already public on main, so the gate has nothing left to protect; the
  script refuses any commit that isn't there.

"Passed a review" means a marker this skill wrote as `full` or `delta` (Phase 4) on a commit
between `branchBase` and HEAD. Nothing else counts: not the upstream tip (a push can skip the
hook), and not a marker from before markers carried a kind.
After a rebase the old markers sit on commits outside that range, so the branch gets a full
review again.

An explicit `<target>` (a path, ref, or range) replaces the script: review exactly what it names
with pinned SHAs, as a full review. It writes no marker, because it didn't review the commit a push
would publish. To push another ref, check it out and run this skill there. Commit before you review,
because the marker keys to a commit. If you must review a dirty tree (`dirty: true`), say so; the
acceptance-and-tests finder sees only committed code. State the scope in one line (mode, base,
head, file count).

Effort sets the findings cap below. The finders it runs, their candidate caps and the gap sweep
are set in [`frapp-review.js`](../../workflows/frapp-review.js). An ultracode review is a full review
at `xhigh` with the acceptance-and-tests finder added. A re-review runs two light finders at any
level.

| Level | Findings cap |
|---|---|
| `medium` | 6 |
| `high` (default), re-review | 10 |
| `xhigh`, ultracode | 15 |

## Phase 1 — Find

**When you are opted into the Workflow tool** (a session-level ultracode reminder, `ultracode` in
this skill's arguments or in the command that called it, such as `/next ultracode`, or the user
invoking `/diff-review` themselves), run the saved workflow. It runs this phase and Phase 2, and
sets every agent's effort itself. Pass the scope script's JSON as `args`, plus:

```js
Workflow({ name: 'frapp-review', args: {
  ...scope,                   // the JSON line from scripts/diff-review-scope.mjs, unchanged
  level: 'high',              // the level argument, if any
  ultracode: true,            // whenever you are opted in through ultracode: forces xhigh plus the extra finder
  acceptance: '<the issue's acceptance criteria, when there is an issue>',
} })
```

**Otherwise**, run the same shape with the Agent tool. Read `frapp-review.js` for the angle bundles,
the candidate caps and the verify rule, launch the `diff-finder` agents in one message, then the
verifiers. The Agent tool can't set effort per call. The agent files pin theirs, but whether that
beats a session's `xhigh` hasn't been measured ([`multi-agent`](../multi-agent/SKILL.md) § Effort),
so prefer the workflow whenever you may use it.

Either way:

- Finders share this working tree, so they are read-only. The one finder that may mutate source
  (to prove a test bites) runs in its own git worktree and reverts before it returns. Don't commit,
  reset, merge, stash or check out while finders or verifiers are live: a finder reading a moving
  tree reports lines that no longer exist, and a hook that fires on `git status` would have you
  commit someone's experiment.
- A finder that returned nothing, or reported a `problem` (`finderFailures` in the workflow's
  result), left angles unchecked: cover them inline before you report.
- Drop a candidate with no plausible failure scenario.

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
- **Blast radius, not diff radius.** A rule every finder applies, not an angle of its own.
  "Pre-existing" is no reason to drop a candidate. Judge it
  against [`spec/engineering.md`](../../../spec/engineering.md#changing-existing-code) § Changing
  existing code, which draws the fence.
- **Tracker.** Flag code, scripts, or workflows that write to a retired tracker. Issues live on
  GitHub ([`ROUTINES.md`](../../../docs/internal/ci-cd/ROUTINES.md#shared-ownership-boundary-all-routines)).
- **Secrets.** No secret values in source, logs, error messages, or committed files. Local Supabase
  demo keys are not secrets; real Stripe or Infisical values are.
- **Verification honesty.** Flag a comment, doc line, or PR text claiming a check ran that the diff
  shows could not have (an E2E pass when the stack can't start).


### Ultracode angles

These run only in an ultracode full review, as one finder in its own worktree.

- **Acceptance criteria.** Against the issue's acceptance criteria when the launcher passes them,
  otherwise against what the commits and PR text say the change does: each criterion the diff
  claims to meet but doesn't, and each one left silently unmet.
- **Test adequacy.** Whether the tests that changed, or should have, would fail if the new behavior
  broke. Prove it where you can: mutate the source in your worktree, run the narrowest test, and
  revert. A test that still passes with the guard removed is a finding. A worktree has no
  `node_modules` or `.env.local` of its own: resolution walks up to the main checkout's, whose
  workspace links point at the main checkout's packages. So a mutation proves something only when
  the test reaches the mutated file by a relative import inside one workspace. Where it can't be
  proven, say what stopped you rather than reporting "doesn't bite".

## Phase 2 — Verify

Candidates are deduped by `file:line` first. A later duplicate of a kept candidate rides along as
`alsoFlaggedBy`; a duplicate of one that is refuted or unverified may be a different defect at the
same line, so it gets its own verdict (the exact rule is in `frapp-review.js`). Each remaining candidate gets one `claim-verifier`
on the reproduce lens: does the stated failure scenario actually happen? Only if it returns
`REFUTED` does a second `claim-verifier` look at it, on the material lens and without seeing the
first verdict: is there a real defect here worth acting on, even if the scenario is inexact? A
candidate is discarded only when both say `REFUTED`. With the same two verifiers, that is the
keep-or-drop call two verifiers per candidate would make keeping on either vote, at about half the
cost. These verifiers run at `medium` and `high` effort, not the `xhigh` the earlier two-verifier
runs inherited, so their recall per vote isn't measured
([ADR-23](../../../spec/architecture/adr/adr-23.md)).
A verdict that never came back (`unverified` in the workflow's result) is a check not run: get it
before you report.

## Phase 3 — Synthesize and report

Rank correctness and security above cleanups, and `CONFIRMED` above `PLAUSIBLE`. A docs finding that
names a concrete broken pointer, an orphaned section reference, or a dropped dated stamp is a
correctness finding and is not cut to fit the cap. Each `alsoFlaggedBy` entry is an unverified
candidate at a kept finding's line, with its own summary and failure scenario. Merge it when it
shares the root cause. When it names a different defect, give it one `claim-verifier` like any other
candidate, and report it as its own finding unless that verifier refutes it. Merge other findings
that share a root cause. Cap at the level's limit.

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

After reporting and acting on the findings, check that `git rev-parse HEAD` is still the `head` you
reviewed and that `git status` shows nothing you didn't write. Then write the marker the pre-push
hook checks, with the kind of review it records (`full` or `delta`, or `merged` for a commit
already on `origin/main`; an explicit-target review writes none):

```sh
node scripts/diff-review-scope.mjs --mark full
```

The script writes `<repo-root>/.cache/diff-review/<HEAD SHA>`, the only place the hook looks, and
the kind is what lets the next Phase 0 trust it. The marker is keyed to the commit, so committing
fixes invalidates it by design: re-run this skill on the new HEAD. Phase 0 then finds this marker
and re-reviews just the fix commits, or the whole branch if a merge from `main` landed since.
