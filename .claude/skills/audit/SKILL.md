---
name: audit
description: >
  Perform code quality reviews, security audits, dependency checks, API contract audits, database
  migration reviews, or CI/CD audits on this repo. Use when asked to audit, security-review, or
  assess quality of the codebase, when checking RLS/guard coverage or dependency vulnerabilities,
  and as the engineering-gaps lens of scheduled routines like the Issue Curator.
---

# Audit & Quality Review

The checks, commands and repo-specific traps for auditing Frapp, interactively or as a read-only
lens inside a scheduled routine such as the [Issue Curator](../issue-curator/SKILL.md). A read-only
run files findings as GitHub issues instead of fixing them. Two routines fix instead:
[`docs-upkeep`](../docs-upkeep/SKILL.md) fixes docs in a docs-only PR and never files `area:docs`
issues, and [`hygiene-scan`](../hygiene-scan/SKILL.md) fixes code hygiene in a product-code PR.

A broad audit splits well across subagents by audit type, since each is independent,
context-heavy reading; group the types so the fan-out stays within the
[`multi-agent`](../multi-agent/SKILL.md) budget. Before filing findings whose proof is more than
one read, hand them to one `claim-verifier` as a batch to try to refute.

## Commands that write

- `npm run lint` is read-only in every workspace. `npm run lint:api:fix` and `npm run format`
  write; no audit needs them.
- `npm run check:api-contract` regenerates `apps/api/openapi.json` and
  `packages/api-sdk/src/types.ts` when API-related files changed. Treat those edits as throwaway
  (`git checkout -- apps/api/openapi.json packages/api-sdk/src/types.ts`) and never commit them.
- Never run the bare `npm run configure:branch-protection`; see [Branch protection](#branch-protection).

## Audit types

| Audit | What to check | Key files |
|-------|---------------|-----------|
| Code quality | Layering, DRY, naming, typing | `apps/api/src/`, `apps/web/`, `packages/` |
| Security | Auth guards, RLS, input validation, secret exposure | Guards, DTOs, migrations, `.env*`, workflows |
| Dependencies | Vulnerabilities, outdated packages, licenses | `package.json` (root and workspaces), `package-lock.json` |
| API contract | Spec drift, breaking changes, DTO completeness | `apps/api/openapi.json`, `packages/api-sdk/src/types.ts` |
| Database | Migration safety, schema consistency, RLS coverage | `supabase/migrations/`, `apps/api/src/infrastructure/supabase/database.types.ts` |
| CI/CD | Workflow correctness, secret exposure, check coverage | `.github/workflows/`, `scripts/ci/` |

## Code quality

**Layering.** Dependencies flow Interface → Application → Infrastructure → Domain: outer layers
may import inner ones, never the reverse (enforced by `scripts/dependency-cruiser.cjs`; see
[`api-development`](../api-development/SKILL.md)). Red flags: services importing from `interface/`
(DTOs, guards), `infrastructure/` importing `application/` or `interface/`, domain importing
another layer or `@nestjs/*` / `@supabase/*`, and code under `apps/api/src/` outside `domain/` importing
it by a relative path instead of `#domain/*` (`apps/api/test/` uses relative `../src/domain/`
paths by convention, and dependency-cruiser allows it).

**Patterns.** Audit API code against the conventions in
[`api-development`](../api-development/SKILL.md) (token-bound repositories, the guard chain, DTO
decorators).

**Types.** `npm run check-types` works straight after `npm install`: `check-types` depends on
`^build` in `turbo.json`, so turbo builds the shared packages first. That wiring covers only the
turbo tasks (`build`, `lint`, `check-types`), not the root `check:*` scripts. Look for `any`,
`@ts-ignore` and untyped parameters.

**Lint.** `npm run lint`. Every workspace except `apps/api` runs `--max-warnings 0`; the API's
warnings don't fail CI, so count them as debt rather than as passing.

## Security

### Auth and authorization

1. Controllers carry `@UseGuards(SupabaseAuthGuard, ChapterGuard)` unless there is no chapter
   context to check: `/health` (no auth), webhooks (signature verification only), and user-scoped
   routes that come before or outside membership (chapter creation, `chapter-directory`,
   `analytics`). A new exception needs a stated reason.
2. Every endpoint that reads or writes protected user or chapter data, GET and list included, also
   needs `PermissionsGuard` with `@RequirePermissions()` or `@RequireAnyOfPermissions()`. See
   `member.controller.ts` (`MEMBERS_VIEW` on reads) and `financial-invoice.controller.ts` (own
   invoices for members, `billing:view` for everyone else's). Route-level permissions are merged
   with the class-level list, so both apply.
3. Check each method's permission against the enum in
   `apps/api/src/domain/constants/permissions.ts`.

### RLS coverage

Every table in `supabase/migrations/` must `ENABLE ROW LEVEL SECURITY`. Almost every table then
has no permissive policies (default deny), because the API reaches data through the
`service_role` client. The deliberate exceptions are the chat hot path's client-read policies
(`chat_message_actions`, membership-scoped `chat_messages` reads). The per-table inventory is
[`AUTHORIZATION_MODEL.md`](../../../docs/internal/security/AUTHORIZATION_MODEL.md); audit a new
permissive policy against it.

`npm run check:pglite-migrations` (the CI `pglite-migrations` job) applies every migration to an
in-process Postgres and fails if any public table lacks RLS, if the policy inventory drifts from
`AUTHORIZATION_MODEL.md` §4, or if a non-owner probe role can read what it shouldn't. It needs no
Docker. What it can't judge is whether a new policy's predicate is right; that is the review.

### Input validation

DTOs use `class-validator` decorators (`@IsString`, `@MaxLength`, `@IsUUID`, …). The global
`ValidationPipe`'s flags, and the file that defines them:
[`api-architecture.md` § Never trust the client](../../../docs/guides/api-architecture.md#never-trust-the-client).
Where it is registered (not `main.ts`): [`testing.md` § 6](../../../docs/guides/testing.md#6-e2e-scaffolding).

### Secret exposure

Beyond hardcoded secrets, check what interceptors and error handlers log, what CI workflows echo,
and that `.env*` files are gitignored.

## Dependencies

```bash
npm run check:npm-audit      # what CI gates on; honors scripts/npm-audit-allowlist.json
npm outdated                 # add -w <workspace> for one workspace
```

File from the gate's output, not bare `npm audit`, which re-reports every allowlisted advisory as
if it were new.

For a transitive CVE, use the root `overrides` block in `package.json` rather than per-workspace
upgrades. Pin to the patched range the advisory cites, then re-resolve only that package with
`npm update <pkg>` (a plain `npm install` keeps the old resolution).

Never delete `package-lock.json`. A full rebuild drops the optional platform binaries for every
host except the one that ran it and re-resolves hundreds of unrelated packages. If
`npm update <pkg>` won't move a nested copy, delete just that lockfile entry and its `node_modules`
directory, then `npm update <parent>`. Confirm a single resolution with `npm ls <pkg> --all`;
optional peer dependencies can keep a stale hoisted copy alive.

The CI `dependency-audit` job (`npm run check:npm-audit`) fails on high and critical advisories.
Fix in range where possible; otherwise add a time-boxed, issue-tracked entry to
`scripts/npm-audit-allowlist.json` per
[`SECURITY_FIXES.md`](../../../docs/internal/security/SECURITY_FIXES.md) § npm audit sweep + CI gate.

## API contract

`npm run check:api-contract` regenerates the contract and fails if the committed copies differ.
Run it after any controller or DTO change. It builds the shared packages itself and bootstraps
NestJS with placeholder credentials (it never calls Supabase or Stripe), so it works on a fresh
sandbox, but it is slower than the other `check:*` scripts. It writes; see
[Commands that write](#commands-that-write).

For a manual review, open Swagger UI at `http://localhost:3001/docs` and compare it with
`spec/product/`: undocumented endpoints, missing `@ApiOperation` summaries, schemas that don't
match their DTOs.

## Database migrations

`npm run check:migration-safety` (`scripts/check-migration-safety.mjs`) checks only:

- filenames match `{14-digit-timestamp}_{snake_case}.sql`, with no duplicate timestamps;
- a migration change also updates one of the runbooks in `MIGRATION_DOCS`, and every migration has
  an entry in both runbooks, with a shrink-only `UNLEDGERED` allowlist for older migrations.

Exit 2, not 1, means the gate can't do its job rather than that your change is wrong: a rename
outran `MIGRATION_DOCS`, a declared doc has no entry shape in `LEDGER_ENTRY_PATTERNS`, or
`UNLEDGERED` gained a migration newer than `RATCHET_VERSION_CEILING`. For that last one, delete
the line you added and write the ledger entry instead.

It never reads the SQL. `npm run check:pglite-migrations` proves the migrations apply and the RLS
posture holds, and `npm run check:migration-lock-safety` (Squawk, advisory only) flags patterns
that take a heavy lock on a live table. The rest is review:

- RLS enabled on each new table in the same migration that creates it.
- No destructive operation without a rollback plan in
  [`DB_ROLLBACK_PLAYBOOK.md`](../../../docs/internal/ops/DB_ROLLBACK_PLAYBOOK.md).
- Foreign keys have deliberate `ON DELETE` behavior.
- Indexes on frequently queried columns.
- An `update_updated_at` trigger on tables with an `updated_at` column.
- No raw user input in SQL (repositories use parameterized queries).

## CI/CD

Workflows with specific audit concerns (the full set is `.github/workflows/`):

| Workflow | File | Key concerns |
|----------|------|--------------|
| CI | `ci.yml` | Required jobs passing, correct triggers |
| Deploy (staging) | `deploy-api.yml` | Secret handling, migration gating, health checks |
| Deploy (production) | `deploy-production.yml` | SHA must be an ancestor of `main` and CI-green, the migration replay and working-tree fence, the provider guardrail preflight, deploy-by-commit, `CANCELED` treated as failure |
| Production guardrails | `production-guardrails.yml` | Render `frapp-api-prod` auto-deploy off, tracking `main`, health check path `/health`; Vercel `frapp-web` and `frapp-landing` not linked to Git |
| Release | `release.yml` | Version bump logic, tag creation, `workflow_call` input plumbing |
| Docs | `docs.yml` | Not a documentation gate — what its job checks: [`DOCS_CI.md` § What runs](../../../docs/internal/ci-cd/DOCS_CI.md#what-runs) |
| Links | `links.yml` | Markdown links and heading anchors, offline — [`DOCS_CI.md` § What runs](../../../docs/internal/ci-cd/DOCS_CI.md#what-runs) |

The guardrail settings live only in provider dashboards and fail open: if one drifts, merges to
`main` can reach production ungated. Both Vercel projects are deliberately unlinked from Git
([ADR-21](../../../spec/architecture/adr/adr-21.md)), so the invariant to audit is that they stay
unlinked: Vercel `list_projects` should report `link: null` for both, and a present Git link is the
finding.

`docs.yml` and `links.yml` are all that reads the docs corpus. Neither is a required check, and
neither validates a doc's claims. The old gates for cited paths, filename references, rosters and
placement were removed on purpose; don't propose them back. The repo relies on
[`DOCUMENTATION_CONVENTIONS.md`](../../../docs/internal/DOCUMENTATION_CONVENTIONS.md) plus the
docs angle in [`diff-review`](../diff-review/SKILL.md), and
[`DOCS_CI.md`](../../../docs/internal/ci-cd/DOCS_CI.md) says what runs and what nothing checks.

**Workflow secrets.** Secrets only via `${{ secrets.* }}`, never echoed or logged; minimal
`permissions:` blocks; no `pull_request_target` trigger that exposes secrets to forks.

### Branch protection

From an agent session, run only the read-only diff:

```bash
npm run configure:branch-protection:verify
```

Bare `npm run configure:branch-protection` is a live `PUT` of the whole protection payload (it
prints `Mode: LIVE`). `npm run configure:branch-protection --dry-run` without the `--` separator
also applies, because npm swallows the flag and the script sees no arguments. Applying branch
protection is a human step with an admin PAT; an audit never applies.

The script reads `GITHUB_PAT` (aliases `GITHUB_TOKEN`, `GH_PAT`, `GH_TOKEN`); see
[`GITHUB_BRANCH_PROTECTION_RUNBOOK.md`](../../../docs/internal/ops/GITHUB_BRANCH_PROTECTION_RUNBOOK.md).
`:verify` exits non-zero and names each divergence from `CI_CHECKS` / `DOCS_CHECKS` /
`DRIFT_CHECKS` in `scripts/ci/lib/required-checks.mjs`, which is the comparand. The human-readable
roster is the runbook's § Required Status Checks.

## Spec compliance

Compare features with `spec/product/`, check that the edge cases and invariants in
`spec/behavior/` are tested, and check stack and patterns against
[`spec/architecture/README.md`](../../../spec/architecture/README.md) and environments against
[`spec/environments/README.md`](../../../spec/environments/README.md). Handle a disagreement you
find per `AGENTS.md` § Spec vs code.

## Reporting findings

```markdown
## Audit: <type> — <date>

### Critical (must fix)
### Warnings (should fix)
### Observations
```

Each finding names the file, the rule it breaks, and the fix. Deliver the report in the
conversation or run output, fold durable facts into their canonical doc, and file actionable
findings as GitHub issues. Don't commit audit write-ups to the repo; narrative audit docs are what
[`DOCUMENTATION_CONVENTIONS.md`](../../../docs/internal/DOCUMENTATION_CONVENTIONS.md) rules out.
