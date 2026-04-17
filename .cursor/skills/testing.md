# Skill: Testing

> Use when running tests, verifying changes, or setting up the test environment.

---

## Quick reference

| What | Command |
|------|---------|
| All lint | `npm run lint` |
| API-only lint | `npm run lint:api` |
| Type-check | `npm run check-types` |
| API `nest build` (Render / Docker parity) | `npm run build -w apps/api` |
| API image (optional, needs Docker) | `docker build -f apps/api/Dockerfile .` |
| API unit tests | `npm run test -w apps/api` |
| Single test file | `npm run test -w apps/api -- --testPathPattern=<pattern>` |
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

Requires Docker + Supabase. See `AGENTS.md` "Starting the dev environment" section.

Prefer Infisical-injected envs as the primary method:
```bash
sudo dockerd &>/tmp/dockerd.log &
sleep 3
npx supabase start
npx supabase db push --local
npm run dev:api     # Infisical-injected, port 3001
npm run dev:web     # Infisical-injected, port 3000
```

Fall back to `.env.local` files only when Infisical is unavailable (NestJS ConfigModule reads `.env.local` then `.env`):
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

Verifies that `openapi.json` and `packages/api-sdk/src/types.ts` are up to date when API source changes. Uses git diff — no NestJS bootstrap required.

If this fails after changing API endpoints:
```bash
npm run openapi:export -w apps/api
npm run generate -w packages/api-sdk
```

### Migration safety (`check:migration-safety`)

Validates migration filenames match `{14-digit-timestamp}_{snake_case}.sql` and that promotion docs (`DB_PROMOTION_RUNBOOK.md`, `DB_ROLLBACK_PLAYBOOK.md`) are updated alongside migration changes.

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
5. `npm run test -w apps/api` → `CI / api-tests`
6. `npm run check:api-contract` → `CI / api-contract-check`
7. `npm run check:migration-safety` → `CI / migration-safety`
8. `npm run test:visual -w apps/web` → `CI / web-visual-regression` (after
   intentional dashboard layout changes, refresh Linux baselines from
   `apps/web` with `CI=true npx playwright test --update-snapshots` so they
   match the job’s single-worker Playwright run; see
   `apps/web/tests/visual/README.md`)

---

## Updating this skill

When you discover new testing patterns, fixtures, or gotchas:
1. Add them to the relevant section above.
2. If a new test utility or shared mock factory is created, document it under "Mocking pattern".
3. If new CI checks are added, update the "CI parity checklist" and "Quick reference" sections.
