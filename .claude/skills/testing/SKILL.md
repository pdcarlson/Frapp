---
name: testing
description: >
  Run tests, verify code changes, and keep local checks in parity with CI. Use when running or
  writing tests (unit, E2E, Playwright), editing `*.spec.ts` files or CI workflow config,
  verifying changes before a push, or setting up the test environment — lint and unit tests need
  only `npm install`; integration/manual testing needs Docker + Supabase.
---

# Testing

Use this to pick which checks to run for a change, run them the way CI does, and read their
failures. `scripts/ci/lib/required-checks.mjs` is the canonical list of required checks
(`CI_CHECKS` for the `ci.yml` jobs below), and `.github/workflows/ci.yml` has the exact steps.

## Quick reference

| What | Command |
|------|---------|
| Core pre-push subset (secret scan, lint, types, API unit tests, contract, migration safety with a commit range, audit) | `npm run ci:local-gate` |
| API-only lint | `npm run lint:api` (read-only) |
| API lint autofix | `npm run lint:api:fix`, the only lint script that writes ([contributing.md §5](../../../docs/guides/contributing.md#5-linting-types-and-tests)) |
| Single API test file | `npm run test -w apps/api -- --testPathPatterns="event.service"` |
| Repository tenant-scope specs only | `npm run test -w apps/api -- --testPathPatterns="\.repository\.spec\.ts$\|repositories/"` |
| Live-PostgREST integration suite | `npm run test:integration -w apps/api` |
| Build `packages/*` (what CI's `packages-build` job runs) | `npx turbo run build --filter='./packages/*'` |

Jest 30 takes the plural `--testPathPatterns`. The singular `--testPathPattern` no longer
exists. The tenant-scope pattern keys on the filename so module-local repositories are included,
and the `repositories/` half picks up the meta-specs that enforce the ledgers
(`tenant-scope-coverage`, `tenant-scope.harness`, `no-as-never`).

The root has no `test` script and `turbo.json` has no `test` task, so `npm run lint` and
`npm run check-types` run no test suite. Run the suites for the workspaces you touched.

## Environment tiers

| Tier | Setup | What it runs |
|------|-------|--------------|
| Node only | `npm install` | Lint, type-check, `nest build`, every unit suite, API E2E (mocked Supabase), `check:api-contract`, `check:migration-safety`, `check:pglite-migrations` (Postgres in WASM), `test:ci-scripts`, `check:dep-cruiser` (after `packages/*` are built) |
| + Chromium | `npx playwright install chromium` | `test:floor -w apps/web`, `test:fold -w apps/landing`. Each starts its own app server with stand-in env |
| + Docker | A running Docker daemon | `docker build -f apps/api/Dockerfile .` |
| + local Supabase | Docker, then `npx supabase start` and `npx supabase db push --local` | `test:integration -w apps/api` (skips cleanly without a stack, and no CI job runs it), manual API testing, running the apps |
| Staging | none locally | The [`live-verification`](../live-verification/SKILL.md) skill |

To run the apps, prefer Infisical-injected env: `npm run dev:api` (port 3001) and `npm run dev:web`
(port 3000). Where Infisical is unavailable, and always in a cloud sandbox (whose bringup has
already written `.env.local`), use `npm run start:dev -w apps/api` and `npm run dev -w apps/web`,
which read `.env.local` (see
[`CLOUD_SANDBOX.md`](../../../docs/internal/environment/CLOUD_SANDBOX.md) § "Booting the API"). Full
bringup: [`AGENTS.md`](../../../AGENTS.md) § "Starting the dev environment". Check the API with
`curl http://localhost:3001/health`, which reports `"status":"ok"` when the database and storage
are connected.

## CI parity checklist

Before pushing, run the rows your change touches. Every job here is a required check except those
in the last row; path-gated jobs are still required.

| CI job | Run locally |
|--------|-------------|
| `lint-and-typecheck` | `npm run check-types`, `npm run build -w apps/api` (full `nest build`, which catches what `tsc --noEmit` misses), `npm run lint`, `npm run check:brand-assets`, and `npm run test -w <ws>` for `apps/landing`, `@repo/validation`, `@repo/color`, `@repo/formatting`, `@repo/observability`, `@repo/chapter-theme`, `@repo/theme`, `@repo/api-sdk` |
| `clean-checkout-typecheck` | `npm run check-types` and `npm run lint` on a tree with no prebuilt `packages/*/dist`. This guards the `^build` wiring in `turbo.json` |
| `api-tests` | `npm run test -w apps/api`, `npm run test:e2e -w apps/api`, `npm run test:ai-evals -w apps/api` |
| `web-tests` (path-gated) | `npm run test -w apps/web`, plus `-w packages/hooks`, `-w packages/chat-core`, `-w packages/chat-integrations`. The job runs on any `packages/**` change |
| `mobile-validate` | `npm run lint -w apps/mobile`, `npm run check-types -w apps/mobile`, `npm run test -w apps/mobile` and again with `TZ=Asia/Tokyo`. For `app.json` or dependency changes, run `npx expo prebuild --no-install --clean --platform all` in `apps/mobile` |
| `api-docker-build` | `docker build -f apps/api/Dockerfile .` (CI also boots the image and probes `/health`) |
| `api-contract-check` | `npm run check:api-contract` and `npm run check:api-breaking:shipped` (blocking once a shipped mobile build is listed; run `bash scripts/install-oasdiff.sh` first). CI also runs the advisory `check:api-breaking` against the PR base |
| `dependency-cruiser` | `npm run check:dep-cruiser` |
| `migration-safety` | `npm run check:migration-safety -- --base "$(git merge-base origin/main HEAD)" --head HEAD` |
| `dependency-audit` | `npm run check:npm-audit`. Add `-- --soft-network` when offline. Fails on any high/critical advisory not in `scripts/npm-audit-allowlist.json` |
| `secret-scan` | `npm run check:secrets -- --base "$(git merge-base origin/main HEAD)" --head HEAD` |
| `ci-scripts-tests` | `npm run test:ci-scripts` |
| `chapter-directory-seed` | `npm run check:chapter-directory-seed` |
| `web-responsive-floor` (path-gated) | `npm run test:floor -w apps/web` (every dashboard route at 375px without horizontal scroll) |
| `landing-fold` (path-gated) | `npm run test:fold -w apps/landing` (fold geometry at 1440x900 and 390x844) |
| `pglite-migrations` (path-gated) | `npm run check:pglite-migrations` (every migration from empty, plus the RLS posture) |
| `web-production-build` | The Vercel-parity build below |
| `packages-build` | `npx turbo run build --filter='./packages/*'` |
| `changes` | Nothing to run locally. It computes the path filter for the path-gated jobs and is required because `web-tests` needs it |
| Run in CI but not required | The advisory `migration-lock-safety` (`npm run check:migration-lock-safety`) and `duplicate-detection` (`npm run check:duplication`) |

Mobile specs that assert calendar days must build dates with local-time constructors, not ISO
strings ending in `Z`. CI runs in UTC and again in Asia/Tokyo so a timezone bug shows up in one of
the two.

### Browser suites

`test:floor` and `test:fold` store no baseline and compare no pixels. They read geometry off the
rendered page, so nothing drifts and nothing needs regenerating. The snapshot suite that diffed
committed PNGs was deleted because its baselines drifted with every Chromium bump.
**Never re-add an `--update-snapshots` step to a checklist** — there are no baselines to update.

- A new spec in `apps/web/tests/visual/` joins `web-responsive-floor` automatically (see its
  `README.md`).
- `apps/landing/tests/visual/` holds one spec on purpose. Playwright exits 1 when it collects no
  tests, and that is the only guard against the job going green with nothing asserted. With a
  second spec, deleting the first would still pass. If you add one, port the sibling-reading
  guard from `apps/web`.
- The fold suite serves a production build (`next start` on port 3102), because under `next dev`
  the stylesheet arrives after hydration and no reveal ever arms.
- If the preinstalled Chromium's revision doesn't match the pinned `@playwright/test`, results are
  unaffected, because no pixels are compared. The browser only has to launch.

### Vercel-parity production build

`web-production-build` builds `apps/web` and `apps/landing` on a devDependency-pruned tree. It is
the only check that runs the program `next build` type-checks in production, and gaps here have
twice caused production outages that no other check saw.

```sh
npm ci --omit=dev
npx --yes "turbo@$(node -p "require('./package-lock.json').packages['node_modules/turbo'].version")" run build --filter=web --filter=landing
npm ci   # restore the dev tree afterwards
```

`turbo` is a devDependency, so after the prune a bare `npx turbo` would fetch whatever version
the registry serves, which is why CI pins the lockfile version this way. Two traps each produce a
false pass:

- `apps/web/.env.local`: `next build` prerenders `/chat`, which needs `NEXT_PUBLIC_*`. Sandbox
  bringup writes this file, but CI builds with the stand-ins from `apps/web/playwright.config.ts`.
  Move the file aside or export those stand-ins.
- Stale `packages/*/dist` and turbo cache from a dev-tree build turn the package builds into cache
  hits. Add `--force`.

## API unit tests

Specs live beside their source under `apps/api/src/`. Service specs mock repositories with
`jest.fn()` through `Test.createTestingModule`. Full guide:
[`docs/guides/testing.md`](../../../docs/guides/testing.md) (§4 guards, §4a tenant scope, §6 E2E
scaffolding and `createSupabaseMock()`, §6a integration).

Controller specs that build a testing module use `createUnguardedTestingModule()`
(`apps/api/test/helpers/guard-stubs.factory.ts`) instead of `Test.createTestingModule()`. Nest
instantiates the controller's guards during `.compile()`, so the real `SupabaseAuthGuard` demands
`SUPABASE_CLIENT` even though no guard runs. Don't work around that by stubbing
`'SUPABASE_CLIENT'`. Provide it only when the code under test injects it. Two kinds of controller
spec don't need the helper: controllers with no guards (`health`, `webhook`) and specs that
construct the controller with `new` (`analytics`, `write-payload-ordering`).

Repository specs must use `createTenantHarness` (`apps/api/test/helpers/tenant-scope.harness.ts`).
It seeds two chapters whose rows collide on every column except `id` and `chapter_id`, so only a
real tenant filter narrows the result. `expectTenantScoped(chapterId, fn)` asserts the predicate
was applied and no foreign row was read or written. Follow
`supabase-task.repository.spec.ts` as the example.

- `tenant-scope-coverage.spec.ts` fails if a `*.repository.ts` anywhere under `apps/api/src`
  (module-local ones included, found through `#test/helpers/repository-corpus`) has no harness
  spec and no reason in `TENANT_SCOPE_BACKLOG`.
- When you extend the harness, also extend `tenant-scope.harness.spec.ts`, which proves each guard
  still fails against a deliberately broken repository. A harness that can't fail looks identical
  to a clean codebase.

`npm run test:e2e -w apps/api` boots `AppModule` with `SUPABASE_CLIENT` overridden and guards
stubbed, so it needs no live services or secrets.

## Contract and migration checks

### API contract (`check:api-contract`)

This check regenerates `apps/api/openapi.json` and `packages/api-sdk/src/types.ts` and fails if
the committed copies differ. It bootstraps Nest with placeholder credentials and builds
`packages/*` itself, so it works on a fresh clone after `npm install`, but it is slower than the
other `check:*` scripts. To fix a failure:

```bash
npm run openapi:export -w apps/api
npm run generate -w packages/api-sdk
```

### Migration safety (`check:migration-safety`)

This check validates migration filenames (`{14-digit-timestamp}_{snake_case}.sql`) and unique
version prefixes. It also checks that every migration has an entry, in the documented shape, in
both [`DB_PROMOTION_RUNBOOK.md`](../../../docs/internal/ops/DB_PROMOTION_RUNBOOK.md) and
[`DB_ROLLBACK_PLAYBOOK.md`](../../../docs/internal/ops/DB_ROLLBACK_PLAYBOOK.md), across the whole
tree on every run. With `--base`/`--head` it also requires a migration change to touch one of
those docs. Without a range it skips that half and says so, which is why the checklist passes one.
Migrations older than the gate are grandfathered in `UNLEDGERED` in
[`scripts/check-migration-safety.mjs`](../../../scripts/check-migration-safety.mjs). That list is
shrink-only, and `RATCHET_VERSION_CEILING` rejects newer entries, so a new migration needs real
doc entries.

Reading failures:

- **Exit 1** means a rule was violated. Ledger coverage has four cases, and only `missing` is fixed
  by writing an entry. `covered` (an allowlist line for a migration that now has an entry) and
  `absent` (an allowlist line for a file no longer on disk) are fixed in `UNLEDGERED`. `orphan` (a
  rollback entry naming a missing migration) is fixed in the runbook. The failure line names the
  file and the remedy.
- A catch-all in `main()` also exits 1 on unexpected errors. `Unable to diff changed files for
  base=… head=…` means the checkout is too shallow for the range, so fetch more history before
  suspecting your diff.
- **Exit 2** means the gate can't grade: a renamed runbook, a declared doc with no entry shape, an
  unreadable ledger, a malformed `--base`/`--head`, or a post-ceiling migration added to
  `UNLEDGERED` (`UNLEDGERED grew`). Several of these come from your own change, so check your diff
  before escalating.

## Manual testing workflows

The local Supabase API is at `http://127.0.0.1:54321`, Studio at `http://127.0.0.1:54323`, the API
at `http://localhost:3001`, web at `:3000`, and landing at `:3002`.

```bash
# Sign up, then use the returned access_token
curl -X POST http://127.0.0.1:54321/auth/v1/signup -H "apikey: <ANON_KEY>" \
  -H "Content-Type: application/json" -d '{"email":"test@example.com","password":"Password123!"}'
curl http://localhost:3001/v1/users/me -H "Authorization: Bearer <token>"   # creates the users row

# Create a chapter. The DTO whitelist rejects any extra key with a 400
curl -X POST http://localhost:3001/v1/chapters -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" -d '{"name":"Test Chapter","university":"Test University"}'

# Chapter-scoped call
curl http://localhost:3001/v1/events -H "Authorization: Bearer <token>" -H "x-chapter-id: <chapter_id>"
```

A fresh token carries no `active_chapter_id` claim, so chapter-scoped routes need the
`x-chapter-id` header. Once the token carries the claim, a header that disagrees with it gets
`403 chapter.context.mismatch`.
