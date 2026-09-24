---
name: api-development
description: >
  Build or modify NestJS API endpoints, services, repositories, DTOs, guards, or the OpenAPI
  contract artifacts. Use when working under `apps/api/src/`, `packages/api-sdk/`, or
  `packages/validation/` — covers the layered architecture, the new-endpoint checklist, the
  per-route auth/guard chain, Supabase repository conventions, and contract regeneration.
---

# API Development

The rules and gotchas for `apps/api` that the code alone won't show you. For depth (error
handling, observability, performance patterns, DTO validation rules), see
[`docs/guides/api-architecture.md`](../../../docs/guides/api-architecture.md).

## Architecture

`apps/api/src/` is layered, and outer layers may import inner ones but never the reverse:
Interface → Application → Infrastructure → Domain.

| Layer | Directory | Holds |
|-------|-----------|-------|
| Interface | `interface/` | Controllers, DTOs, guards, interceptors, decorators, filters |
| Application | `application/services/` | Business logic; must not import `interface/` |
| Infrastructure | `infrastructure/` | Supabase repositories, Stripe, storage, notifications; must not import `application/` or `interface/` |
| Domain | `domain/` | Entities, repository and adapter interfaces, constants; imports no other layer |
| Modules | `modules/` | Nest wiring only |

dependency-cruiser enforces this (`npm run check:dep-cruiser -- --workspace apps/api`, rules in
`scripts/dependency-cruiser.cjs`, required CI check `dependency-cruiser`). It also requires code
outside `domain/` to import the domain through the `#domain/*` subpath (declared in
`apps/api/package.json` `imports`), never by a relative `../../domain/...` path. The
pre-existing violations are grandfathered in `scripts/dependency-cruiser-known-violations.json`.
That file only shrinks, so any new violation fails.

## Adding a new endpoint

Use the `task` feature as the reference, since it follows every convention below:
`domain/entities/task.entity.ts`, `domain/repositories/task.repository.interface.ts`,
`infrastructure/supabase/repositories/supabase-task.repository.ts`,
`application/services/task.service.ts`, `interface/dtos/task.dto.ts`,
`interface/controllers/task.controller.ts`, `modules/task/task.module.ts`, and the spec beside each.

1. Add the entity, and export it from `domain/entities/index.ts`.
2. Add the repository interface and its injection token.
3. Add the Supabase repository and its tenant-scope spec (see the [`testing`](../testing/SKILL.md)
   skill). For a new table, update `database.types.ts` first (see below).
4. Add the service. It injects the repository by token, and its spec mocks the repository.
5. Add the DTOs. Every property needs a real class-validator constraint behind any
   `@IsOptional()`/`@ValidateIf()` gate, because `dto-constraint-coverage.spec.ts` fails otherwise.
   Zod schemas in `@repo/validation` are client UX, not enforcement, so a rule that matters
   server-side must also be on the DTO.
6. Add the controller with the guard chain below. When spreading a DTO into a write, put
   server-owned keys (`chapter_id`, `created_by`) last so they win.
7. Wire the module and import it in `app.module.ts`.
8. Regenerate the contract (see below).

### Repository conventions

- Use `.maybeSingle()` for a lookup that may miss, because it returns `null` where `.single()`
  throws. `.single()` is fine after an insert or update that `.select()`s its row.
- Always `if (error) throw error;`. Return `data ?? []` for lists.
- Write methods take `TablesInsert<'table'>` / `TablesUpdate<'table'>` and pass them to
  `.insert()` / `.update()` with no cast and no `@ts-expect-error`. `as never`, `as any`,
  `as unknown as …` and the expanded `Database['public']['Tables'][…]['Insert']` all erase the
  same checking. `no-as-never.spec.ts` catches them at the write call (`as const` is allowed,
  since it narrows rather than erases). It is a text scan with gaps, listed in its own docblock, so
  it is a backstop and doesn't mean a cast is fine where it doesn't look.
- Domain interfaces stay `Partial<Entity>`, because domain must not import `Database`.
- Inject the client as `FrappSupabaseClient` (built with `createClient<Database>` in
  `supabase.provider.ts`), never the bare `SupabaseClient` from `@supabase/supabase-js`. The bare
  type erases the schema types at the injection site, and that applies to services, guards,
  workers, and health as much as repositories. `no-as-never.spec.ts` fails a repository that
  injects the bare type.
- Don't extract a generic base repository. Each repository keeps its own queries.
- Lookups that take a chapter plus another string are chapter-first (`findByName(chapterId, name)`).
  Both are `string`, so a transposition type-checks and silently matches nothing.

### Module exports

Add `exports:` only in the change that adds a module which injects the provider. `AppModule`
importing a module to register its controllers doesn't make it a consumer. An unneeded export
claims a dependency that doesn't exist. The exception is a `@Global()` module: its exports reach
every injector without an import, so `SupabaseModule` exporting `SUPABASE_CLIENT` is load-bearing
even though nothing imports it.

### Contract regeneration

After changing any controller or DTO:

```bash
npm run openapi:export -w apps/api
npm run generate -w packages/api-sdk
```

Commit the source, `apps/api/openapi.json`, and `packages/api-sdk/src/types.ts` together.
`npm run check:api-contract` regenerates both and fails on any difference.

## Auth and guard chain

Only `CustomThrottlerGuard` is global (`APP_GUARD` in `app.module.ts`). You apply the auth guards
per controller or per route with `@UseGuards()`, so a route missing one has no protection from
that layer. Each guard reads what the previous one set, so keep this order:

```text
SupabaseAuthGuard      validates the JWT, sets request.supabaseUser
→ AuthSyncInterceptor  (only where needed) syncs the users row, sets request.appUser
→ ChapterGuard         chapter from the JWT active_chapter_id claim, x-chapter-id only as a
                       fallback (a disagreement is 403 chapter.context.mismatch); checks
                       membership, sets request.member and request.chapterId; gates writes on
                       subscription status and @RequireModule
→ PermissionsGuard     checks @RequirePermissions against the member's roles
→ handler
```

The usual form is class-level `@UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)`
with a class-level `@RequirePermissions(...)` baseline, plus handler-level permissions for
stricter routes. `PermissionsGuard` merges class and handler `@RequirePermissions` lists, so the
union must be satisfied. `@RequireAnyOfPermissions` on both class and handler is evaluated as two
separate OR-groups.

Every route that returns or touches chapter data needs a permission decorator, reads included. A
`@Get()` without one leaks chapter data, and review treats it as a finding.

`AuthSyncInterceptor` goes only where the first request must create the `users` row. It is
class-level on the user, invite, notification and analytics controllers, and per-route on the
pre-chapter chapter routes (create, onboard, list, activate). Grep
`@UseInterceptors(AuthSyncInterceptor)` for the current list.

### Custom decorators

All live in `interface/decorators/`.

| Decorator | Effect |
|-----------|--------|
| `@CurrentUser('id')`, `@CurrentChapterId()` | Read `request.appUser` / `request.chapterId` |
| `@RequirePermissions(...)` / `@RequireAnyOfPermissions(...)` | `PermissionsGuard` metadata (all-of / one-of) |
| `@RequireModule('key')` | `ChapterGuard` rejects writes when the chapter has disabled that paid module. Reads still pass. Use it only for toggleable paid modules |
| `@FreeTier()`, `@GraceBlocked()`, `@SubscriptionExempt()` | Subscription write-gating in `ChapterGuard`. `@SubscriptionExempt()` is only for billing recovery and member safety, and `subscription.decorator.spec.ts` pins the roster. Semantics: api-architecture.md §2 "Subscription enforcement" |
| `@ThrottleExpensiveWrite()`, `@ThrottleFanOutWrite()`, `@ThrottleExpensiveRead()` | Per-route rate limits (below) |

### Special cases

- `/health` has no guards. `HealthController` injects `SUPABASE_CLIENT` itself.
- `GET /v1/client-policy` has no guards: the mobile app asks it before sign-in whether its build is still
  served (#2526). It reads `X-Client-Version` and returns no chapter or user data.
- `POST /v1/chapters` and the other pre-chapter routes use `SupabaseAuthGuard` +
  `AuthSyncInterceptor` only, because no chapter exists yet.
- `POST /v1/webhooks/stripe` has no guard. `WebhookController.handleStripeWebhook` verifies the
  signature itself through `IBillingProvider.constructWebhookEvent` on the raw body and answers
  `401` when that throws. It carries `@SkipThrottle({ read: true, write: true })` because Stripe
  delivers from a shared IP pool that the throttler would otherwise 429.

## Database changes

1. `npx supabase migration new my_change_name` creates
   `supabase/migrations/{14-digit timestamp}_{snake_case}.sql`.
2. Enable RLS on every new table: `ALTER TABLE my_table ENABLE ROW LEVEL SECURITY;`.
3. Apply locally with `npx supabase db push --local`.
4. Add an entry for the migration to both
   [`DB_PROMOTION_RUNBOOK.md`](../../../docs/internal/ops/DB_PROMOTION_RUNBOOK.md) and
   [`DB_ROLLBACK_PLAYBOOK.md`](../../../docs/internal/ops/DB_ROLLBACK_PLAYBOOK.md), in the entry
   shape each one states. `check:migration-safety` fails on a migration missing from either (see
   the [`testing`](../testing/SKILL.md) skill for reading its failures).
5. Update `database.types.ts` by hand, as described next.

More: [`docs/guides/database.md`](../../../docs/guides/database.md).

### Keeping `database.types.ts` in sync

`apps/api/src/infrastructure/supabase/database.types.ts` is hand-maintained. It builds the
`Database` interface from the domain entities, so piping `supabase gen types` over it would detach
the schema types from `domain/entities`. You can diff against the generator's output for
reference, but edit the file by hand.

A new table needs a row interface in `domain/entities/` (exported from the barrel) and a
`TableDefinition<YourRow>` entry under `Database['public']['Tables']`. An RPC also needs a
`Functions` entry with `Args` and `Returns`. `returns setof <table>` maps to `YourEntity[]`, and a
`text` parameter the caller may omit is `string | null`, because Postgres function parameters are
nullable.

Constraints to know before you fight the compiler:

- `Row` is written `{ [K in keyof Row]: Row[K] }` on purpose. PostgREST constrains rows to
  `Record<string, unknown>`, and an `interface` has no implicit index signature. Passing the entity
  directly makes `Database` fail postgrest-js's `GenericSchema` constraint silently, and then no
  query is type-checked at all. The mapped type flattens the interface into an object type that
  has the index signature.
- `Insert` and `Update` use the same trick (`{ [K in keyof Row]?: Row[K] }`), which is what lets
  writes go uncast while `Partial<Entity>` stays assignable. `database.types.insert-check.ts` is
  the compile-only proof. If `GenericSchema` degrades, its `@ts-expect-error` goes unused and
  `nest build` fails.
- Insert/upsert payload types must be type aliases, not interfaces, for the same reason (see
  `DuesConfig` in `chapter-config.service.ts`).
- Every `*.repository.ts` under `apps/api/src` follows this, including the module-local ones.
  `no-as-never.spec.ts` and `tenant-scope-coverage.spec.ts` both find repositories through
  `#test/helpers/repository-corpus`, so a new one joins both ledgers wherever it lives. Both pin
  the repository count, so adding one means raising `EXPECTED_REPOSITORY_COUNT` in that helper
  (and the `covered` count in `tenant-scope-coverage.spec.ts`, unless it lands with a
  `TENANT_SCOPE_BACKLOG` reason). Direct service-layer writes use the same
  `TablesInsert` / `TablesUpdate` types.

## Rate limiting

`app.module.ts` registers two buckets: `read` (GET, HEAD, OPTIONS) at 100 requests per 60s and
`write` (everything else) at 30 per 60s. Both count per endpoint per caller, not app-wide.
`CustomThrottlerGuard` runs before the auth chain and reads the bearer token itself.

- For stricter limits, use the profiles in `interface/decorators/throttle-profiles.decorator.ts`
  and match the profile to the HTTP method, because a `read` profile on a POST is silently inert.
  When you add one, add a row to `spec/behavior/README.md` § Per-route rate limits and a case to
  `custom-throttler.guard.spec.ts`.
- To opt out, use `@SkipThrottle({ read: true, write: true })`. A bare `@SkipThrottle()` skips
  nothing.

Full treatment: [`api-architecture.md` § Rate limiting](../../../docs/guides/api-architecture.md#rate-limiting).

`PointsService` also caps point adjustments per admin per hour, from chapter config rather than a
constant ([`points.md` § Anti-Fraud](../../../spec/behavior/points.md#anti-fraud) owns the scoping
and the default). Don't hardcode the default in a guard, an assertion, or user-facing copy, and
don't stack a throttle profile on `POST /v1/points/adjust`.
