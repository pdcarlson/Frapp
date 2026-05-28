# Testing

This guide documents how we test the Frapp API using Jest and NestJS testing utilities.

## 1. Test types

We use three main test layers:

- **Unit tests** — services, guards, interceptors (mocking repositories and Supabase)
- **Integration tests** — hitting real endpoints in a running API against local Supabase
- **E2E tests** — supertest-based flows (e.g. auth → create chapter → add member)

All tests live under `apps/api/src/**` for unit tests and `apps/api/test/**` for E2E.

## 2. Jest setup

Jest is configured in `apps/api/package.json` with scripts:

- `npm run test` — unit tests
- `npm run test:watch` — watch mode
- `npm run test:e2e` — E2E tests (uses `test/jest-e2e.json`)

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

The **`lint-and-typecheck`** job in the **GitHub Actions** workflow `.github/workflows/ci.yml` runs ESLint, TypeScript, **`npm run check:brand-assets`**, and (on pull requests) **`scripts/check-docs-impact.mjs`** so non-doc code changes must include related `docs/` or `spec/` updates in the same PR.

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
    "^.+\\.(t|j)s$": "ts-jest"
  }
}
```

Basic example (`apps/api/test/app.e2e-spec.ts`):

```ts
import request from "supertest";
import { INestApplication } from "@nestjs/common";

describe("Health (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    // create Nest application against real Supabase (local or staging)
  });

  it("/health (GET)", async () => {
    const res = await request(app.getHttpServer()).get("/health");
    expect(res.status).toBe(200);
  });
});
```

## 7. Coverage expectations

For the API we aim for:

- **Core services and guards** — high coverage (happy path + key error paths)
- **Integration/E2E** — at least one end-to-end flow per major domain

> **Warning:** Do not chase 100% coverage at the expense of meaningful tests. Focus on critical business rules, security boundaries, and regressions we've actually seen.

### Stripe Billing Service Tests
Unit tests for `StripeBillingService` (`apps/api/src/infrastructure/billing/stripe.service.ts`) isolate the Stripe client using `jest.mock('stripe')` and manually mock-inject nested client instances for properties like `.customers` and `.checkout.sessions`.
