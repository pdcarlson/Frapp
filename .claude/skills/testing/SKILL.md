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
| API E2E tests (mocked Supabase, no live services) | `npm run test:e2e -w apps/api` |
| Web unit tests (Vitest / jsdom) | `npm run test -w apps/web` |
| Mobile unit tests (Vitest) | `npm run test -w apps/mobile` |
| Shared validation tests (Vitest) | `npm run test -w @repo/validation` |
| Shared hooks tests (Vitest / jsdom) | `npm run test -w packages/hooks` |
| Shared UI tests (Vitest) | `npm run test -w packages/ui` |
| Single test file | `npm run test -w apps/api -- --testPathPattern=<pattern>` |
| PGlite migration validator | `npm run check:pglite-migrations` |
| Contract check | `npm run check:api-contract` |
| Migration check | `npm run check:migration-safety` |
| Web dashboard screenshots (Playwright) | `npm run test:visual -w apps/web` |

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

Prefer Infisical-injected envs as the primary method:
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

Repositories and adapters are mocked via `jest.fn()` on each method. No shared mock factories — each spec defines its own fixtures inline.

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
# Single file (via npm workspace flag)
npm run test -w apps/api -- --testPathPattern="event.service"

# Pattern match
npm run test -w apps/api -- --testPathPattern="billing"
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

Validates migration filenames match `{14-digit-timestamp}_{snake_case}.sql` and that promotion docs
([`docs/internal/ops/DB_PROMOTION_RUNBOOK.md`](../../../docs/internal/ops/DB_PROMOTION_RUNBOOK.md),
[`docs/internal/ops/DB_ROLLBACK_PLAYBOOK.md`](../../../docs/internal/ops/DB_ROLLBACK_PLAYBOOK.md))
are updated alongside migration changes.

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
   `apps/web/vitest.config.ts` and run separately — see item 11).
   The same job also runs the two shared packages web consumes:
   `npm run test -w packages/hooks` and `npm run test -w packages/ui`. Run those
   too when you touch `packages/**` — the job's path filter covers that glob, so
   a change there gates on all three suites
7. `npm run test -w @repo/validation` → `CI / lint-and-typecheck` (Vitest; the
   package is consumed by the API, web, and mobile, so a regression here reaches
   all three). Not covered by items 1–2: the root has no `test` script and
   `turbo.json` declares no `test` task, so nothing else runs it.
8. `npm run test -w apps/mobile` → `CI / mobile-validate` (Vitest; likewise not
   reached by the mobile lint or typecheck steps)
9. `npm run check:api-contract` → `CI / api-contract-check`
10. `npm run check:migration-safety` → `CI / migration-safety`
11. `npm run test:visual -w apps/web` → `CI / web-visual-regression` (after
   intentional dashboard layout changes, refresh Linux baselines from
   `apps/web` with `CI=true npx playwright test --update-snapshots` so they
   match the job's single-worker Playwright run; see
   [`apps/web/tests/visual/README.md`](../../../apps/web/tests/visual/README.md))

---

## Updating this skill

When you discover new testing patterns, fixtures, or gotchas:
1. Add them to the relevant section above.
2. If a new test utility or shared mock factory is created, document it under "Mocking pattern".
3. If new CI checks are added, update the "CI parity checklist" and "Quick reference" sections.
