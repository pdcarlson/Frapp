---
name: testing
description: >
  Run tests, verify code changes, and keep local checks in parity with CI. Use when running or
  writing tests (unit, E2E, Playwright visual), editing `*.spec.ts` files or CI workflow config,
  verifying changes before a push, or setting up the test environment — lint and unit tests need
  only `npm install`; integration/manual testing needs Docker + Supabase.
---

# Testing

> Use when running tests, verifying changes, or setting up the test environment.

---

## Quick reference

| What | Command |
|------|---------|
| All lint | `npm run lint` (read-only) |
| API-only lint | `npm run lint:api` (read-only) |
| API lint autofix | `npm run lint:api:fix` — the only lint script that writes; why: [contributing.md §5](../../../docs/guides/contributing.md#5-linting-types-and-tests) |
| Type-check | `npm run check-types` |
| API `nest build` (Render / Docker parity) | `npm run build -w apps/api` |
| API image (optional, needs Docker) | `docker build -f apps/api/Dockerfile .` |
| API unit tests | `npm run test -w apps/api` |
| Repository tenant-scope specs only | `npm run test -w apps/api -- --testPathPatterns="repositories/"` |
| API E2E tests (mocked Supabase, no live services) | `npm run test:e2e -w apps/api` |
| Web unit tests (Vitest / jsdom) | `npm run test -w apps/web` |
| Mobile unit tests (Vitest) | `npm run test -w apps/mobile` |
| Shared hooks tests (Vitest / jsdom) | `npm run test -w packages/hooks` |
| Shared validation tests (Vitest) | `npm run test -w @repo/validation` |
| Shared formatting tests (Vitest) | `npm run test -w @repo/formatting` |
| Single test file | `npm run test -w apps/api -- --testPathPatterns=<pattern>` |
| PGlite migration validator | `npm run check:pglite-migrations` |
| Contract check | `npm run check:api-contract` |
| Migration check | `npm run check:migration-safety` |
| npm audit gate (high/critical) | `npm run check:npm-audit` (offline: `-- --soft-network`) |
| Vercel-parity production build | `npm ci --omit=dev && npx turbo run build --filter=web --filter=landing` — **destroys your dev tree**; `npm ci` to restore |
| 375px responsive floor (Playwright, blocking gate once rolled out) | `npm run test:floor -w apps/web` |

---

## Environment setup for testing

### Minimal (lint + unit tests only)

Unit tests and lint do **not** require Docker, Supabase, or running services. Just `npm install`.

```bash
npm install
npm run lint
npm run test -w apps/api
npm run check-types
```

### Full (integration / manual testing)

Requires Docker + Supabase. See the "Starting the dev environment" section in
[`AGENTS.md`](../../../AGENTS.md).

Prefer Infisical-injected envs as the primary method — **except in a cloud sandbox**: there,
bringup already writes `.env.local`, so skip straight to the fallback below (see
[`CLOUD_SANDBOX.md`](../../../docs/internal/environment/CLOUD_SANDBOX.md) § "Booting the API";
Infisical reach from a sandbox also depends on the environment allowlist,
[#1279](https://github.com/pdcarlson/Frapp/issues/1279)):
```bash
sudo dockerd &>/tmp/dockerd.log &
sleep 3
npx supabase start
npx supabase db push --local
npm run dev:api     # Infisical-injected, port 3001
npm run dev:web     # Infisical-injected, port 3000
```

Fall back to `.env.local` files only when Infisical is unavailable (NestJS ConfigModule reads `.env.local` then `.env` — `.env.local` is a fallback, not the primary method):
```bash
npm run start:dev -w apps/api   # reads .env.local, port 3001
npm run dev -w apps/web         # reads .env.local, port 3000
```

### Health verification

```bash
curl http://localhost:3001/health
# {"status":"ok","database":"connected","uptime":...}
```

---

## API unit tests

### Location and naming

All tests live alongside their source in `apps/api/src/`:
- Services: `application/services/<name>.service.spec.ts`
- Guards: `interface/guards/<name>.guard.spec.ts`
- Interceptors: `interface/interceptors/<name>.interceptor.spec.ts`
- Utils: `domain/utils/<name>.spec.ts`

### Mocking pattern

Tests use `@nestjs/testing` `TestingModule` with manual mocks:

```typescript
const module: TestingModule = await Test.createTestingModule({
  providers: [
    MyService,
    { provide: MY_REPOSITORY, useValue: mockRepo },
    { provide: SUPABASE_CLIENT, useValue: mockSupabase },
  ],
}).compile();
```

Repositories and adapters are mocked via `jest.fn()` on each method. Service specs define their own
fixtures inline.

**Repository tenant-scope specs are the exception, and they must use the shared harness.**
`createTenantHarness` (`apps/api/test/helpers/tenant-scope.harness.ts`) seeds two chapters whose rows
collide on every column except `id` and `chapter_id`, so any predicate but the tenant one matches
both rows and only a real tenant filter narrows the result:

```typescript
const harness = createTenantHarness({
  tables: { roles: [inA({ id: ROLE_A, name: 'Treasurer' }), inB({ id: ROLE_B, name: 'Treasurer' })] },
});
const repo = new SupabaseRoleRepository(harness.client);

await harness.expectTenantScoped(CHAPTER_B, () => repo.findByChapter(CHAPTER_B));
```

`expectTenantScoped` asserts the tenant predicate was applied, no foreign row was written, and no
foreign row was returned. Hand-rolling a double instead loses the colliding-twin check, which is what
stops a spec passing for the wrong reason — `tenant-scope-coverage.spec.ts` fails if a repository
spec does not call `createTenantHarness`. Full treatment, including `tenantColumns`,
`untenantedTables` and `collisionExempt`: [`docs/guides/testing.md`](../../../docs/guides/testing.md) §4a.

Two rules when touching this area:

- Extending the harness means extending `tenant-scope.harness.spec.ts`, which proves each guard still
  fails against a deliberately broken repository. A harness that cannot fail is indistinguishable
  from a clean codebase.
- Adding a repository under `infrastructure/supabase/repositories/` means adding its tenant-scope
  spec, or a reason in `TENANT_SCOPE_BACKLOG`. CI fails if you do neither.

For the full treatment — service coverage goals, guard/interceptor test targets, coverage
expectations, and the E2E scaffolding (the `jest-e2e.json` CommonJS transform quirks and the
`createSupabaseMock()` factory in `apps/api/test/helpers/`) — see the testing guide:
[`docs/guides/testing.md`](../../../docs/guides/testing.md).

### E2E tests (compact)

`npm run test:e2e -w apps/api` boots the app from `AppModule` with the Supabase client overridden
via the `SUPABASE_CLIENT` provider token and guards stubbed — deterministic, no live services or
secrets needed. Details and gotchas (env defaults, UUID-valid fixtures) are in
[`docs/guides/testing.md`](../../../docs/guides/testing.md) §6.

### Running a subset

```bash
# Single file (via npm workspace flag). Jest 30 uses the plural
# `--testPathPatterns`; the singular `--testPathPattern` flag is gone.
npm run test -w apps/api -- --testPathPatterns="event.service"

# Pattern match
npm run test -w apps/api -- --testPathPatterns="billing"
```

---

## Contract and migration checks

### API contract (`check:api-contract`)

Verifies that `openapi.json` and `packages/api-sdk/src/types.ts` are up to date when API source changes. It **regenerates** both artifacts and fails if the committed copies differ — it is not a git-diff heuristic (that was replaced because it false-positived on contract-neutral controller edits and false-negatived when only one artifact needed updating).

Regenerating **does** bootstrap NestJS, using placeholder credentials — the export only builds the Swagger document and never calls Supabase or Stripe, so no real secrets are needed. It also needs the shared workspace packages built; the script builds `./packages/*` itself, so `npm run check:api-contract` works on a fresh sandbox after `npm install`. Budget more time for it than the other `check:*` scripts.

If this fails after changing API endpoints:
```bash
npm run openapi:export -w apps/api
npm run generate -w packages/api-sdk
```

### Migration safety (`check:migration-safety`)

Validates migration filenames match `{14-digit-timestamp}_{snake_case}.sql`, that version prefixes
are unique, and that a migration change also touches one of the promotion docs
([`docs/internal/ops/DB_PROMOTION_RUNBOOK.md`](../../../docs/internal/ops/DB_PROMOTION_RUNBOOK.md),
[`docs/internal/ops/DB_ROLLBACK_PLAYBOOK.md`](../../../docs/internal/ops/DB_ROLLBACK_PLAYBOOK.md)).

Separately and more strictly, it asserts **per-migration ledger coverage in both docs**, whole-tree,
on every run — including the bare push invocation, not just PRs. Coverage is matched by entry
**shape**, so naming a migration in prose does not count; each runbook states the shapes it accepts.
Migrations predating the gate are grandfathered in `UNLEDGERED` in
[`scripts/check-migration-safety.mjs`](../../../scripts/check-migration-safety.mjs), which is
**shrink-only**: `RATCHET_VERSION_CEILING` rejects any entry newer than the gate, so a new migration
must carry a real entry in both docs rather than an allowlist line.

**Exit 1 is `ledger coverage`, and a missing entry is only one of its four cases.** The others are an
allowlist line for a migration that now *has* an entry (`covered`), an allowlist line for a migration
no longer on disk (`absent`), and a rollback entry naming a migration that no longer exists
(`orphan`) — the last three are fixed by editing `UNLEDGERED` or the runbook, not by writing a new
entry. Read the failure, which names the file and the remedy, rather than assuming you owe an entry.

**Exit 2 is the gate refusing to run at all**, and never your change: a renamed runbook that
`MIGRATION_DOCS` no longer resolves, a declared doc with no entry shape, a declared ledger that
cannot be read, or a post-ceiling migration added to `UNLEDGERED` (`UNLEDGERED grew`).

---

## Manual testing workflows

### Auth flow (end-to-end)

1. Create a user via Supabase Auth:
```bash
curl -X POST http://127.0.0.1:54321/auth/v1/signup \
  -H "apikey: <ANON_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"Password123!"}'
```

2. Use the returned `access_token` to hit the API:
```bash
curl http://localhost:3001/v1/users/me \
  -H "Authorization: Bearer <access_token>"
```

The API's `AuthSyncInterceptor` auto-creates a `users` row on first authenticated request.

### Chapter operations (requires auth + chapter)

Most endpoints need `Authorization` + `x-chapter-id` headers. Create a chapter first:
```bash
curl -X POST http://localhost:3001/v1/chapters \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Chapter","greek_letters":"ΑΒΓ","university":"Test University"}'
```

Then use the chapter ID:
```bash
curl http://localhost:3001/v1/events \
  -H "Authorization: Bearer <token>" \
  -H "x-chapter-id: <chapter_id>"
```

### Web dashboard (GUI)

Open `http://localhost:3000` in browser. Auth flows go through Supabase — the sign-in flow is currently in development. Use Supabase Studio (`http://127.0.0.1:54323`) to inspect data directly.

---

## CI parity checklist

Before pushing, verify these pass locally (mirrors the CI pipeline):

1. `npm run lint` → `CI / lint-and-typecheck`
2. `npm run check-types` → `CI / lint-and-typecheck` (includes `apps/api` via `tsc -p tsconfig.build.json`, same program as `nest build`)
3. `npm run build -w apps/api` → `CI / lint-and-typecheck` (full `nest build`; catches issues `tsc --noEmit` alone might miss)
4. `docker build -f apps/api/Dockerfile .` → `CI / api-docker-build` (optional locally; needs Docker)
5. `npm run test -w apps/api` → `CI / api-tests` (the job also runs the E2E suite,
   `npm run test:e2e -w apps/api` — run it too when API wiring changes)
6. `npm run test -w apps/web` → `CI / web-tests` (Vitest / jsdom unit suite; the
   Playwright visual tests under `tests/visual/**` are excluded by
   `apps/web/vitest.config.ts` and run separately — see item 12).
   The same job also runs the shared packages web consumes that nothing else
   covers: `npm run test -w packages/hooks`,
   `npm run test -w packages/chat-core`, and
   `npm run test -w packages/chat-integrations`. Run those too when you touch
   `packages/**` — the job's path filter covers that glob, so a change there
   exercises those suites. `web-tests` is a required check (ADR-15 2026-08-19
   amendment).
7. The shared-package and landing unit suites → `CI / lint-and-typecheck`. The job runs
   `npm run test -w apps/landing` plus `-w @repo/validation`, `@repo/color`, `@repo/formatting`,
   `@repo/chapter-theme`, `@repo/theme`, and `@repo/api-sdk` — the canonical roster is the
   `lint-and-typecheck` entry in
   [`scripts/ci/lib/required-checks.mjs`](../../../scripts/ci/lib/required-checks.mjs), the one home
   for the check names and for what each one validates, kept as a comment beside its array entry so
   it lands in the diff of any change that edits the entry. The `lint-and-typecheck` row in
   `docs/internal/ops/GITHUB_BRANCH_PROTECTION_RUNBOOK.md` § Required Status Checks is a hand-kept
   copy that nothing asserts — `check:doc-tables` used to compare copies like it, and was deleted
   with the other docs gates — so read `required-checks.mjs` over that row, and
   `.github/workflows/ci.yml` when you need the exact step. Run the suites for whatever you
   touched. Not covered by items 1–2: the root has no `test` script and `turbo.json` declares no
   `test` task, so nothing else runs them.
8. `npm run test -w apps/mobile` → `CI / mobile-validate` (Vitest; likewise not
   reached by the mobile lint or typecheck steps)
9. `npm run check:api-contract` → `CI / api-contract-check`
10. `npm run check:migration-safety` → `CI / migration-safety`
11. `npm run check:npm-audit` → `CI / dependency-audit` (npm audit gate: fails on
   any high/critical advisory not allowlisted in
   `scripts/npm-audit-allowlist.json`; needs registry network — append
   `-- --soft-network` to warn instead of fail when offline. Most likely to
   fire on dependency/lockfile PRs, or when a new advisory was published
   upstream since the last CI run)
12. `npm run test:floor -w apps/web` → `CI / web-responsive-floor` (every
   dashboard route without horizontal scroll at 375px). A **required** check
   (#1152): it stores no baseline and compares no pixels, so there is nothing to
   drift and nothing to regenerate. It runs the whole
   `apps/web/tests/visual/` directory, so a new spec added there joins this gate
   by default — see
   [`apps/web/tests/visual/README.md`](../../../apps/web/tests/visual/README.md).

   There is no `test:visual` / `web-visual-regression` step any more. That
   advisory snapshot job, its spec and its sixteen baselines were deleted:
   baselines pinned to CI's Chromium build drifted with every bump, so the red X
   was usually answered by regenerating the fixture. **Never re-add a
   `--update-snapshots` step to a checklist** — there are no baselines to update.

13. **Vercel-parity production build** → `CI / web-production-build` (**required**).
   Builds `apps/web` and `apps/landing` on a devDependency-pruned tree, which is
   the only place anything runs the program `next build` type-checks in
   production. Two production outages came from this gap (#1331, #1372) and both
   were invisible to every other check.

   ```sh
   npm ci --omit=dev
   npx turbo run build --filter=web --filter=landing
   npm ci            # restore the dev tree afterwards
   ```

   Two traps, both of which produced a false pass while this job was being
   written:
   - **`apps/web/.env.local`.** `next build` prerenders `/chat`, which
     constructs a Supabase browser client, so the build needs `NEXT_PUBLIC_*`
     set. The cloud sandbox's bringup writes that file, so a local run passes
     using env CI does not have. Move it aside, or export the stand-ins from
     [`apps/web/playwright.config.ts`](../../../apps/web/playwright.config.ts).
   - **Stale `packages/*/dist` and the turbo cache.** A previous dev-tree build
     leaves both behind, so the package builds can be cache hits and never
     exercise the pruned tree. Add `--force` when you want to be sure.

   Neither is exotic: a local run is only evidence when it fails for the reason
   CI would.

---

## Updating this skill

When you discover new testing patterns, fixtures, or gotchas:
1. Add them to the relevant section above.
2. If a new test utility or shared mock factory is created, document it under "Mocking pattern".
3. If new CI checks are added, update the "CI parity checklist" and "Quick reference" sections.
