# Testing

This guide documents how we test the Frapp API using Jest and NestJS testing utilities.

## 1. Test types

We use three main test layers:

- **Unit tests** — services, guards, interceptors (mocking repositories and Supabase)
- **Integration tests** — service queries issued against a **real** PostgREST on the local Supabase
  stack (see §6a)
- **E2E tests** — supertest-based flows (e.g. auth → create chapter → add member)

All tests live under `apps/api/src/**` for unit tests and `apps/api/test/**` for E2E and
integration.

The three layers answer different questions, and the middle one exists because of a defect the
other two structurally cannot catch. Unit and E2E specs both mock the Supabase client, so they
prove how a response is *mapped* but never whether PostgREST would accept the request that
produced it. #746 was an ambiguous embed that made `POST /v1/reports/attendance` return 500 in
every environment since the initial schema, with a green suite throughout. Integration tests are
where request *shape* is proven.

## 2. Jest setup

Jest is configured in `apps/api/package.json` with scripts:

- `npm run test` — unit tests
- `npm run test:watch` — watch mode
- `npm run test:e2e` — E2E tests (uses `test/jest-e2e.json`)
- `npm run test:ai-evals` — adversarial AI evals (uses `test/ai-evals/jest-ai-evals.json`)
- `npm run test:integration` — live-PostgREST integration tests (uses
  `test/integration/jest-integration.json`); **not run in CI** — see §6a

All three CI suites run in the **`api-tests`** job (`.github/workflows/ci.yml`) — it runs
`npm run test -w apps/api`, then `npm run test:e2e -w apps/api`, then
`npm run test:ai-evals -w apps/api`. `api-tests` is a merge-blocking required check (see
`scripts/configure-branch-protection.mjs`), so all three gate PRs to `main`/`production` without a
separate status. The E2E specs override the Supabase client with mocks (see §6) and the evals are
pure fixtures, so the job is deterministic and needs no live database or secrets.

Each suite needs its own config because their file patterns don't overlap: unit jest is
`rootDir: "src"` matching `*.spec.ts`, E2E matches `*.e2e-spec.ts` under `test/`, and the evals match
`*.eval-spec.ts` under `test/ai-evals/`. A file in the wrong place runs in no suite at all.

The typical Nest testing pattern:

```ts
import { Test } from "@nestjs/testing";
import { ChapterService } from "../chapter.service";

describe("ChapterService", () => {
  it("creates a chapter", async () => {
    const module = await Test.createTestingModule({
      providers: [
        ChapterService,
        { provide: "IChapterRepository", useValue: mockChapterRepo },
        { provide: "IRoleRepository", useValue: mockRoleRepo },
      ],
    }).compile();

    const service = module.get(ChapterService);
    const chapter = await service.createChapter(/* dto */);
    expect(chapter).toBeDefined();
  });
});
```

## 3. Service tests

For each Phase 1 service (`auth`, `user`, `chapter`, `member`, `rbac`, `invite`) we aim to cover:

- Happy-path operations (create, update, list, etc.)
- Error cases (not found, forbidden, invalid state)
- Edge cases (duplicate creation, role changes, invite expiry)

Mocks:

- **Repositories** — plain objects with Jest mock functions (e.g. `jest.fn().mockResolvedValue(...)`).
- **External adapters** — mocked Stripe/Expo clients where relevant.

In `apps/api/src/application/services/points.service.spec.ts`, keep shared `PointTransaction` fixtures consistent across leaderboard and list tests (for example, transactions that should aggregate under `user-2` must use that `user_id`). `PointsService.listTransactions` forwards to `findByChapterFiltered` without re-filtering in memory, so mocks for user-scoped lists must only return rows for the requested user when asserting on `user_id`.

When unit tests mock `createMany` results for `DEFAULT_SYSTEM_ROLES`, derive stable mock role IDs from role **names** (or match the service’s `find((r) => r.name === 'President')` pattern) instead of array indices. `DEFAULT_SYSTEM_ROLES` grows when new system roles are added; index-based IDs like `` `role-${i}` `` or `` `slice(1)` `` plus renumbered IDs drift from production behavior and break assertions.

> **Tip:** Keep business logic in services small and focused. This makes unit tests much easier to write and maintain.

## 4. Guards and interceptors

Guards to test:

- `SupabaseAuthGuard` — valid vs. invalid/missing JWT
- `ChapterGuard` — correctly accepts members of a chapter and rejects non-members
- `PermissionsGuard` — honors wildcard (`*`) and specific permissions

Interceptors:

- `RequestIdInterceptor` — attaches `x-request-id` when missing and forwards when present
- Logging interceptor — ensures it logs request/response metadata (can be smoke-tested)

## 5. CI parity (lint job)

The **`lint-and-typecheck`** job in the **GitHub Actions** workflow `.github/workflows/ci.yml` runs ESLint, TypeScript, the `apps/landing` and `@repo/validation` unit suites, **`npm run check:brand-assets`**, and (on pull requests, except Dependabot's) **`scripts/check-docs-impact.mjs`** so non-doc code changes must include related `docs/` or `spec/` updates in the same PR. The Dependabot exemption matches the one in `docs.yml`; both are explained in [`docs/internal/ci-cd/AGENT_INFRA.md`](../internal/ci-cd/AGENT_INFRA.md). The validation suite includes a Zod 4 runtime smoke (`packages/validation/src/index.spec.ts`) for record maps plus the string-check, coerce, passthrough, and strict APIs the package still uses. The `z.record(key, value)` TypeScript arity is enforced by `tsc` on `packages/validation/src/index.ts`, not by that spec (specs are excluded from the package `tsc`).

The **`api-tests`** job runs **three** suites after building shared packages: the unit suite (`npm run test -w apps/api`), the E2E suite (`npm run test:e2e -w apps/api`), and the adversarial AI evals (`npm run test:ai-evals -w apps/api`). Because the E2E specs mock Supabase (§6) and the evals are pure fixtures, the job stays deterministic in GitHub Actions and requires no external services.

The evals run unconditionally rather than path-gated. Spec §13 requires them on any change to prompts, retrieval or the tool registry; running them always is a superset, and costs ~1.5s against the minutes a separate job's checkout and install would burn (ADR-15). Their behavioural half currently **skips** — no agent exists yet — so a green `api-tests` is not evidence any agent was graded; see [`docs/internal/security/ai-prompt-injection.md`](../internal/security/ai-prompt-injection.md) and `apps/api/test/ai-evals/README.md`.

## 5a. Chat hot-path tests (ADR-11 / #416)

The chat hot path (send + react) moved from Supabase Edge Functions into the NestJS `ChatController` in #416 (per ADR-11). The Deno test harness under `supabase/functions/_tests/` and the `edge-fn-tests` CI job retired with it; the same coverage now lives in the standard API Jest tier:

- **`apps/api/src/application/services/chat.service.spec.ts`** — pins the wiring of `sendMessage` (idempotent insert on `client_message_id`, dedup-as-success on the partial unique index, Realtime broadcast emit) and `recordMessageAction` (atomic dedup on the `chat_message_actions` unique index, vote-action UPSERT per ADR-07, no false-positive dedup on non-23505 errors).
- **`apps/api/src/application/services/chat-access.spec.ts`** — pins the `canAccessChannel` predicate matrix (channel types, role-gated permissions, read-only / `announcements:post` gate).

Both run under `npm run test -w apps/api`. There's no separate Deno tier to install or maintain.

## 6. E2E scaffolding

E2E config file: `apps/api/test/jest-e2e.json`:

```json
{
  "moduleFileExtensions": ["js", "json", "ts"],
  "rootDir": ".",
  "testEnvironment": "node",
  "testRegex": ".e2e-spec.ts$",
  "transform": {
    "^.+\\.(t|j)s$": ["ts-jest", { "tsconfig": { "module": "commonjs", "moduleResolution": "node", "resolvePackageJsonExports": false } }]
  },
  "moduleNameMapper": {
    "^@repo/org-archetypes$": "<rootDir>/../../../packages/org-archetypes/src/index.ts",
    "^@repo/chapter-theme$": "<rootDir>/../../../packages/chapter-theme/src/index.ts"
  }
}
```

**Why the `commonjs` transform + `moduleNameMapper`:** booting the full `AppModule` in an E2E spec
pulls in the `@repo/org-archetypes` and `@repo/chapter-theme` workspace packages, which are
`"type": "module"`. Their `require` export condition points at ESM `dist/index.js`, which the
CommonJS Jest runtime can't load (`Unexpected token 'export'`). The mapper resolves them to their
TypeScript source and the `module: commonjs` ts-jest override compiles every transformed file —
including those package sources — to CommonJS. All three `tsconfig` keys are load-bearing: ts-jest
shallow-merges over `apps/api/tsconfig.json` (which sets `module`/`moduleResolution: nodenext` and
`resolvePackageJsonExports: true`), so `moduleResolution: node` and `resolvePackageJsonExports: false`
must be set together with `module: commonjs` or TypeScript errors with `TS5098`. The unit suite
(`package.json` `jest` config) doesn't need this because the specs that touch these two packages
`jest.mock()` them directly (they're pure helper functions) rather than transforming their ESM `dist`.

E2E specs build the Nest app from `AppModule` but **mock external dependencies** rather than hitting a
live backend: the Supabase client is overridden via the `SUPABASE_CLIENT` provider token (see
`apps/api/test/helpers/supabase-mock.factory.ts` / `createSupabaseMock()`), and auth/chapter/permission
guards are replaced with stubs. UUID-typed DTO fields (`@IsUUID()`) must use RFC-4122-valid UUIDs in
fixtures (correct version/variant nibbles) or the `ValidationPipe` rejects the request with `400`.

Because `AppModule`'s `ConfigModule.forRoot` runs `validateEnv` (`src/config/env.validation.ts`) at
import time, the suite needs the required env vars (`SUPABASE_URL`, `STRIPE_SECRET_KEY`, …) present or
every spec throws `Missing required environment variables` on boot. `test/setup-e2e.ts` (wired via
`setupFiles`) sets non-empty dummy defaults — only when unset, so a real local `.env.local` still
wins — keeping the suite hermetic in CI with no secrets or live services. The values are never used
(Supabase + Stripe are mocked per spec).

Basic example (`apps/api/test/app.e2e-spec.ts`):

```ts
import request from "supertest";
import { INestApplication } from "@nestjs/common";

describe("Health (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    // create the Nest app from AppModule with a mocked SUPABASE_CLIENT provider
    // (see createSupabaseMock) and stubbed guards — no live Supabase needed
  });

  it("/health (GET)", async () => {
    const res = await request(app.getHttpServer()).get("/health");
    expect(res.status).toBe(200);
  });
});
```

## 6a. Live-PostgREST integration suite (#749)

`apps/api/test/integration/` holds specs that talk to a **real** Supabase stack instead of a mock.
Run them with:

```bash
npm run test:integration -w apps/api
```

They need a local stack (`scripts/cloud-sandbox-up.sh` in a cloud session,
`scripts/local-dev-setup.sh` on a laptop — see
[`CLOUD_SANDBOX.md`](../internal/environment/CLOUD_SANDBOX.md)). Without one they **skip cleanly**
rather than failing: `test/integration/global-setup.ts` probes PostgREST once before any worker
starts and records the answer in an env var that `describeIntegration()` reads. The probe issues a
real service-role read rather than a liveness ping, so a stack that answers but has no DML grants
for `service_role` (the #703/#725 state) also skips instead of failing 12 tests with a confusing
error.

**These do not run in CI, deliberately.** CI has no PostgREST — `pglite-migrations` applies
migrations to Postgres-in-WASM, and `api-tests` is hermetic. Adding the suite to a CI job without a
stack would produce a permanently-skipped green check, which reads as coverage that isn't there.
Standing up a full Supabase stack in CI is its own piece of work.

**What belongs here:** assertions only a real server can answer — that embeds resolve, that FK
hints name the right relationship, that a filter is applied server-side, that paging survives the
server's `max_rows`. **What doesn't:** response mapping, error branches, business rules. Those are
cheaper and clearer as unit tests, and this suite is the slow one.

Two conventions make the tests meaningful rather than decorative:

- **Seed two chapters with overlapping data** (`test/integration/report-fixture.ts`). A fixture
  where the chapters share nothing cannot distinguish a chapter-scoped query from an unscoped one.
  The report fixture gives both chapters a member in common, same-named roles with different ids,
  and attendance whose `marked_by` is never the attendee — so a query that loses `!inner`, or that
  embeds `users` through the wrong foreign key, returns *wrong rows* rather than merely fewer.
- **Seed past whatever boundary the code is supposed to handle.** A limit that is never crossed is
  a limit that is never tested. The report fixture deliberately exceeds two: `max_rows` (1,000) with
  1,100 service entries, and `ID_CHUNK_SIZE` (100) with 123 members. Both counts are exported
  constants, so a spec asserts against the boundary rather than a magic number.
- **Fixtures own their teardown and are run-tagged.** `seedReportFixture` returns a `cleanup()` and
  calls it itself if seeding throws halfway. Chapter deletes cascade to everything except `users`,
  which are found by a per-run tag in their email — so two concurrent runs on one stack don't
  delete each other's rows.

Verify a new spec has teeth by breaking the code it covers and confirming it fails. The report specs
were checked that way, against `report.service.ts`:

| Mutation | Tests that fail |
| --- | --- |
| `users!event_attendance_user_id_fkey` → `…_marked_by_fkey` | 2 |
| `events!inner (…)` → `events (…)` | 3 |
| `fetchAllPages` stops after one page | 1 (1,000 rows returned against 1,100 seeded) |
| `chunkIds` returns only its first chunk | 1 |

The last one is why the fixture seeds 123 members. At the 3 members it originally had, the chunking
test passed under that mutation — it asserted a real property against data too small to exhibit it.

## 7. Coverage expectations

For the API we aim for:

- **Core services and guards** — high coverage (happy path + key error paths)
- **Integration/E2E** — at least one end-to-end flow per major domain

> **Warning:** Do not chase 100% coverage at the expense of meaningful tests. Focus on critical business rules, security boundaries, and regressions we've actually seen.

### Stripe Billing Service Tests
Unit tests for `StripeBillingService` (`apps/api/src/infrastructure/billing/stripe.service.ts`) isolate the Stripe client using `jest.mock('stripe')` and manually mock-inject nested client instances for properties like `.customers` and `.checkout.sessions`.
