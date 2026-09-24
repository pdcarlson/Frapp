# What `/diff-review` looks for

The angles a [`/diff-review`](SKILL.md) covers. In a workflow round each `diff-finder` reads the
angles it holds; an inline review checks all of them itself. A candidate is worth reporting only
with a concrete failure scenario: specific inputs or state that lead to a wrong result, a broken
reference, a failed check, or a lost behavior.

## Generic angles

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

## Frapp-specific angles

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
    A citation inside a shipped migration is neither: it keeps the path it shipped with
    ([`DOCUMENTATION_CONVENTIONS.md` § When a doc turns out to be wrong](../../../docs/internal/DOCUMENTATION_CONVENTIONS.md#when-a-doc-turns-out-to-be-wrong)),
    so a stale path there is not a finding.
  - **Roster drift.** For each array, job id, workspace list, table, or version constant the diff
    changes, search for docs that restate it by hand; the breakage sits in a doc nobody on the PR
    opened. Known restatements (not exhaustive; treat an unlisted source the same way):

    | Source of truth | Docs that restate it |
    | --- | --- |
    | `scripts/ci/lib/required-checks.mjs` (`CI_CHECKS` / `DOCS_CHECKS` / `DRIFT_CHECKS`) | `GITHUB_BRANCH_PROTECTION_RUNBOOK.md`, `spec/environments/README.md`, `QUALITY_GATES.md`, `docs/README.md`, `docs/hooks/README.md`, `.claude/skills/testing/SKILL.md` (CI parity checklist) |
    | `.github/workflows/ci.yml` job steps (which workspaces `web-tests` runs) | `GITHUB_BRANCH_PROTECTION_RUNBOOK.md`, `.claude/skills/testing/SKILL.md` (CI parity checklist) |
    | `CHAT_MESSAGE_KINDS`, declared in three files (`@repo/validation`, `chat.entity.ts`, `@repo/chat-core`) | `spec/behavior/chat/README.md`, `spec/architecture/README.md` |
    | `push-rules.ts:defaultLevelFor` | `spec/behavior/notifications.md`, `spec/architecture/README.md` |
    | `packages/validation/src/upload-allowlists.ts` (`MAX_UPLOAD_BYTES`, kinds); per-bucket caps differ, and `config.toml` is a different number | `content-validation.md` (the owner), `spec/architecture/README.md` § 7 |
    | `buildChapterConfigFromArchetype` (which seeds are `structuredClone`d) | `spec/engineering.md`, `spec/architecture/README.md` |
    | `DEFAULT_SYSTEM_ROLES` / `DEFAULT_CHANNELS` / `SystemPermissions` | `spec/behavior/rbac.md`, `spec/behavior/chat/README.md`, `spec/behavior/alumni.md`, `spec/product/modules.md`, `spec/product/personas.md`, `AUTHORIZATION_MODEL.md` |
    | `scripts/check-env-slugs.mjs:INFISICAL_ENV_SLUGS` | `ENV_REFERENCE.md` (the owner), and the slug warnings in `SECRETS_MANAGEMENT.md`, `LOCAL_DEV.md`, `AGENT_INFRA.md`, `.claude/skills/infrastructure-research/SKILL.md` |
    | Storage bucket declarations in `supabase/migrations/` | `spec/architecture/README.md` § 7, `AUTHORIZATION_MODEL.md` |
    | `apps/web/tests/visual/routes.ts` | `apps/web/tests/visual/README.md` |
    | The React pin in every `package.json`, root `overrides` included (`git ls-files '*package.json' \| xargs grep -ln '"react": "19'`) | `AGENTS.md` (the owner), `SECURITY_FIXES.md` |
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
- **Blast radius, not diff radius.** A rule every reviewer applies, not an angle of its own.
  "Pre-existing" is no reason to drop a candidate. Judge it
  against [`spec/engineering.md`](../../../spec/engineering.md#changing-existing-code) § Changing
  existing code, which draws the fence.
- **Tracker.** Flag code, scripts, or workflows that write to a retired tracker. Issues live on
  GitHub ([`ROUTINES.md`](../../../docs/internal/ci-cd/ROUTINES.md#shared-ownership-boundary-all-routines)).
- **Secrets.** No secret values in source, logs, error messages, or committed files. Local Supabase
  demo keys are not secrets; real Stripe or Infisical values are.
- **Verification honesty.** Flag a comment, doc line, or PR text claiming a check ran that the diff
  shows could not have (an E2E pass when the stack can't start).


## Acceptance and tests

These run in every workflow round, as one finder in its own worktree. An inline review covers
them itself when the fix round changed behavior or tests.

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
