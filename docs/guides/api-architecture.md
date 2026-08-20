# API Architecture

This guide explains the NestJS architecture used by the Frapp API and how to add new modules safely.

## 1. Layered architecture

The API in `apps/api` follows a strict layered structure:

- **Interface layer**: controllers, DTOs, guards, interceptors, exception filters
- **Application layer**: services (use-cases, orchestration)
- **Infrastructure layer**: Supabase repositories, external adapters (Stripe, Expo Push, Storage)
- **Domain layer**: entities, repository interfaces, shared business rules

For list query parameters named `limit` (or similar caps), keep `@IsInt()` on the query DTO so non-integers still fail validation, document the effective 1–200 range in `@ApiPropertyOptional` (`minimum` / `maximum`), and **clamp** out-of-range integers in the application service using the shared constants in `apps/api/src/domain/constants/list-query-limits.ts`. That way HTTP clients get predictable pages without a 400 for a slightly high `limit`, while OpenAPI still documents the bounded page size.

### Never trust the client

The global `ValidationPipe` runs `whitelist: true` + `forbidNonWhitelisted: true` (`apps/api/src/main.ts`), so an unexpected property is rejected with a 400 rather than silently dropped. Two conventions keep that baseline honest:

**Every request-DTO property needs a real constraint, not just a gate.** A property with no decorators at all is safe — whitelisting strips it before a service ever sees it. The dangerous shape is a property carrying only `@IsOptional()` / `@ValidateIf()` / `@Allow()`: the gate is enough to survive whitelisting, and then nothing checks the value. Put a type check behind every gate, and a range/length/enum bound wherever the column has a real domain — money and point amounts get bounds on **both** sides, and ids that reach a uuid column get `@IsUUID()` so a malformed value is a 400 at the edge instead of a 500 from Postgres. `apps/api/src/interface/dtos/dto-constraint-coverage.spec.ts` enforces **the gate rule** automatically across every DTO — it walks the directory, so a new `*.dto.ts` is covered the moment it lands, and it fails in CI naming the offending property. The other two rules on this line (bounds on both sides, `@IsUUID()` for uuid-backed ids) are **not** derived: the same file pins them with a hand-maintained table of specific properties, so adding a uuid-backed `@IsString()` id or an unbounded amount elsewhere passes CI. Add a row when you add such a field — and when you find one that is missing, that is a real bug, not a test-maintenance chore.

**Server-decided keys go last in a write payload.** Controllers that build a write by spreading a DTO alongside values the server owns (`chapter_id`, `created_by`, `uploader_id`) must order it so the server's values win:

```ts
// correct — the server's chapter scoping cannot be overridden
return this.eventService.create({ ...dto, chapter_id: chapterId, created_by: createdBy });

// wrong — safe only until CreateEventDto grows a `chapter_id` property
return this.eventService.create({ chapter_id: chapterId, ...dto });
```

Whitelisting already blocks a hostile `chapter_id` today, so the ordering is a second line rather than the only one — but it is the line that still holds if a DTO later grows one of those property names, which would otherwise turn into a cross-tenant write with nothing to catch it.

The two halves need two different tests, because the ordering is **unreachable over HTTP**: whitelisting rejects a colliding key before the controller runs, so an end-to-end request cannot tell `{ ...dto, chapter_id }` from `{ chapter_id, ...dto }`. `apps/api/test/mass-assignment.e2e-spec.ts` covers the whitelisting half (and imports `VALIDATION_PIPE_OPTIONS` from `apps/api/src/interface/pipes/validation-pipe.options.ts`, the same object `main.ts` uses, so loosening a flag there fails that suite rather than a local copy of it). `apps/api/src/interface/controllers/write-payload-ordering.spec.ts` covers the ordering half by calling the controller methods directly with a DTO that carries the hostile key — the shape a future DTO change would produce. Both were verified to fail when their respective regression is reintroduced.

Zod schemas in `packages/validation` are shared with the web and mobile forms for UX. They are **not** enforcement — a curl request never runs them — so any rule that matters server-side must also exist on the DTO. The package is on Zod 4; `z.record` takes a key schema and a value schema (`z.record(z.string(), z.boolean())`). The one-argument form was Zod 3 and does not type-check.

For optional boolean **query** parameters, validate with `@IsBooleanQueryString()` from `apps/api/src/interface/decorators/is-boolean-query-string.decorator.ts` so the allowed literals stay aligned with OpenAPI (`true`, `false`, `1`, `0`) and are not tied to `class-validator`'s `@IsBooleanString()` / `validator.isBoolean` behavior. Controllers must not coerce with `=== 'true'` alone — use `parseBooleanQueryParam` from `apps/api/src/interface/utils/query-boolean.ts` so the service receives the same truth value the client was allowed to send. Query DTO fields should be typed as `BooleanStringQueryValue` (exported from the same module) so TypeScript matches what validation accepts.

```text
src/
  main.ts
  app.module.ts

  interface/
    controllers/
    dtos/
    guards/
    interceptors/
    filters/

  application/
    services/

  infrastructure/
    supabase/
      repositories/
    billing/
    notifications/
    storage/

  domain/
    entities/
    repositories/
    adapters/
    constants/permissions.ts
```

> **Note:** Controllers only handle HTTP concerns (routing, status codes, DTOs). They never talk to Supabase directly — they call application services instead.

## 2. Guards and interceptors

Every protected endpoint runs through a consistent guard chain:

1. **SupabaseAuthGuard** — validates the JWT from Supabase Auth.
2. **ChapterGuard** — verifies the `x-chapter-id` header and membership in that chapter.
3. **PermissionsGuard** — checks permission metadata against the user's roles. When both the controller class and the route handler declare `@RequirePermissions(...)`, the guard **merges** them: the union of both lists must be satisfied (AND semantics across every listed permission). `@RequireAnyOfPermissions` on handler and class is evaluated as **two separate OR-groups** when both are present (the caller must match at least one permission in each group).

### Subscription enforcement (ChapterGuard)

`ChapterGuard` also gates writes on the chapter's `subscription_status`, implementing the billing lifecycle in [`spec/behavior/billing.md`](../../spec/behavior/billing.md) and [`spec/product/onboarding.md`](../../spec/product/onboarding.md). Reads (`GET`/`HEAD`/`OPTIONS`) are always allowed; the write rules are:

- **`active`** — all writes allowed.
- **`incomplete`** — only `@FreeTier()` routes (the chat / members / **invites** free wedge) may write; other writes return `chapter.subscription.required` (403).
- **`past_due`** — a **3-day grace window** keyed off the `chapters.past_due_since` timestamp:
  - **Within grace:** reads and non-invite `@FreeTier()` writes continue; **invite/create** routes marked `@GraceBlocked()` return `chapter.subscription.invite_blocked` (403); paid-ops writes return `chapter.subscription.write_locked` (403).
  - **After grace:** hard read-only lock — **all** writes (including `@FreeTier()`) return `chapter.subscription.write_locked` (403).
  - A null `past_due_since` is treated as within grace (safe default; the billing webhook re-establishes the clock).
- **`canceled`** — hard read-only lock for every write (`chapter.subscription.canceled`, 403), even `@FreeTier()`.

Route markers live in `src/interface/decorators/subscription.decorator.ts`: `@FreeTier()` (free wedge), `@GraceBlocked()` (free-tier route that must still be blocked during `past_due`, e.g. invite create), and `@SubscriptionExempt()` (bypass entirely, e.g. billing recovery endpoints). The `past_due_since` clock is set/cleared on Stripe webhook transitions in `BillingService` (set only on the into-`past_due` transition, so repeated events don't reset it; cleared on recovery).

Interceptors:

- **RequestIdInterceptor** — attaches/propagates `x-request-id`.
- **LoggingInterceptor** — structured JSON logging with latency and status code.
- **(Future) AuthSyncInterceptor** — syncs Supabase Auth metadata into our `users` table.

### Rate limiting

`CustomThrottlerGuard` is registered as the global `APP_GUARD`, so it runs **before** the chain above — that is why it reads the bearer token itself (verifying the HS256 signature) instead of using `request.supabaseUser`, which is not populated yet.

Two named buckets are registered in `AppModule`: `read` at 100/min and `write` at 30/min. The guard's `handleRequest` gates them by method, so `read` applies to `GET`/`HEAD`/`OPTIONS` and `write` to everything else.

**These are per-endpoint, not app-wide.** The storage key is `sha256(ClassName-HandlerName-throttlerName-tracker)`, so each handler counts independently for each caller. It is a common misreading of the config — worth knowing before you reason about a limit.

**Stricter per-route limits** live in `src/interface/decorators/throttle-profiles.decorator.ts` as three named profiles, applied at the handler:

| Profile | Limit | For |
| --- | --- | --- |
| `@ThrottleExpensiveWrite()` | 5/min | Full-chapter aggregation, export rendering, bulk token minting. |
| `@ThrottleFanOutWrite()` | 10/min | Cheap request, expensive consequence — chapter-wide push, signed storage URLs, credential guesses. |
| `@ThrottleExpensiveRead()` | 20/min | Reads whose database cost is superlinear in caller input. |

The canonical list of which routes carry which profile is [`spec/behavior/README.md` § Per-route rate limits](../../spec/behavior/README.md#per-route-rate-limits).

When you throttle a new route:

- **Match the profile to the HTTP method.** A `read` profile on a `POST` route is silently inert — the `read` bucket is method-gated off, so the route quietly keeps the 30/min default. `custom-throttler.guard.spec.ts` asserts the increment call count precisely to catch this.
- **Add a row to the table in that spec section**, and a case to the table-driven suite in `custom-throttler.guard.spec.ts`. The suite names real controller handlers, so a decorator deleted in a later refactor fails the build rather than silently restoring the default.
- **Prefer overriding `read`/`write` to registering a new named throttler.** A new named bucket is registered globally and therefore runs on every route in the app; keeping it off the other handlers means teaching `CustomThrottlerGuard` another gating rule.
- **Do not stack a throttle on a route that already has a domain-level limit.** `POST /v1/points/adjust` enforces 50 adjustments/hour inside `PointsService`; a second control with different semantics on the same route makes the effective limit unreadable.

Opting a route **out** requires the named-key form — `@SkipThrottle({ read: true, write: true })`. A bare `@SkipThrottle()` sets only the `default` key, which matches neither registered bucket, and skips nothing. `POST /v1/webhooks/stripe` is the only route that does this; its abuse control is Stripe signature verification.

## 3. Adding a new module

Example: adding a `polls` module.

1. **Domain layer**
   - Create `src/domain/entities/poll.entity.ts` with a TypeScript interface representing the table.
   - Create `src/domain/repositories/poll.repository.ts` defining an interface (e.g. `IPollRepository`).

2. **Infrastructure layer**
   - Implement `SupabasePollRepository` in `src/infrastructure/supabase/repositories/poll.repository.ts`.
   - Use the shared `SupabaseClient` provider to query the `polls` table.

3. **Application layer**
   - Add `PollService` in `src/application/services/poll.service.ts`.
   - Inject `IPollRepository` and implement use-cases: `createPoll`, `vote`, `closePoll`, `listPollsForChannel`.

4. **Interface layer**
   - Add DTOs in `src/interface/dtos/poll.dto.ts`.
   - Add a controller in `src/interface/controllers/poll.controller.ts`.
   - Decorate endpoints with `@UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)` and `@RequirePermissions(...)` as needed (for example `polls:create` to post a poll, `polls:view_all` for `GET /v1/polls` chapter-wide aggregates).

   **Dashboard list endpoints (reference):** `GET /v1/polls` lists polls for the chapter (aggregate tallies; optional `channel_id`, `active`, `limit`). `GET /v1/points/transactions` lists chapter `point_transactions` for the Points Audit UI (`user_id`, `category`, `flagged`, `before`, `limit`). Both are chapter-scoped via `ChapterGuard`; those routes add `@RequirePermissions(polls:view_all)` / `@RequirePermissions(points:view_all)` on the handler **in addition to** the controller baseline `members:view` (merged by `PermissionsGuard`). The chapter-wide polls list is **not** on the default Member role (Treasurer, Vice President, Secretary, and President have it via seeds or wildcard); chapters can still grant `polls:view_all` through custom roles. Full behavior and query semantics: [`spec/behavior/points.md`](../../spec/behavior/points.md) and [`spec/behavior/polls.md`](../../spec/behavior/polls.md).

5. **Module wiring**
   - Create `PollModule` in `src/modules/poll/poll.module.ts`, providing controller, service, and repository implementation.
   - Import `PollModule` into `AppModule`.

> **Tip:** Always start new features by updating the **specs** (`spec/product/`, `spec/behavior/`, `spec/architecture/README.md`). The API implementation should follow, not lead, the spec.

## 4. Error handling

We use a global `AllExceptionsFilter` to normalize error responses:

- Shape: `{ statusCode, error, message, requestId }`
- All unhandled exceptions are logged with the request ID.
- 5xx errors are reported to Sentry with full context.

When adding new modules:

- Throw Nest's `HttpException` (e.g. `BadRequestException`, `ForbiddenException`) for expected errors.
- Let unexpected errors bubble up to the exception filter so they're logged and reported.

## 5. Observability hooks

The API surface is instrumented for observability:

- Structured logging with request ID, user ID, chapter ID, method, path, status, latency.
- `/health` endpoint used by load balancers and uptime checks.
- Sentry integration in the Nest bootstrap.

When you add new modules:

- Reuse existing logging patterns in services and repositories.
- Do not add ad-hoc `console.log` — use the injected logger or rely on the interceptors.

## 6. Performance patterns for services

When a service does repeated membership checks in hot loops, prefer a `Set` lookup over nested `Array.includes` calls.

Example: attendance auto-absent filtering now precomputes `required_role_ids` into a `Set` before iterating members, reducing per-check lookup cost from O(K) to O(1) while keeping behavior unchanged.

### Independent reads in loops

When a service loads the **same shape** of related rows for many parent records (for example, all `poll_votes` rows for each poll on a chapter list), prefer **one batched repository query** (for example `.in('message_id', ids)` on PostgREST) and group results in memory. Issuing one query per parent—even via `Promise.allSettled`—still creates N+1 HTTP calls to PostgREST and can exhaust connection pools under large limits. **`PollService.listPolls`** follows this: it calls `IPollVoteRepository.findByMessages` once per request and aggregates counts (and optional `userVotes`) in memory. If that batch read throws, the handler still returns the poll list with zero vote tallies (degraded response) but logs the failure with Nest’s `Logger` so operators can diagnose storage or connectivity issues.

`SupabasePollVoteRepository.findByMessages` paginates with `.range()` (1000-row pages) so heavy chapters do not hit PostgREST default row caps and return incomplete vote tallies. Pages are ordered by primary key `id` so offset pagination stays deterministic when rows change between requests (avoids skipped or duplicated rows affecting tallies).

After that batch load, aggregate tallies in **one pass** over the child rows (for example a `Map<messageId, Map<optionIndex, count>>` for poll votes) instead of nested filters per parent per option, which scales with polls × options × votes.

Use `Promise.allSettled` when the child reads are genuinely separate resources or failure domains and batching is not available; isolate failures per entry so the rest of the list still returns.

### List queries: filter before `limit`

When a list applies a domain filter (for example, “active only”) and a `limit`, express the filter in the database query so it runs before the row cap. Filtering in application code after the database has truncated the page can return fewer than `limit` rows even when more matching rows exist beyond the cutoff.

If the repository already applied that filter for pagination, avoid repeating the same time-based predicate in the service with a fresh clock: two instants can disagree at the expiry boundary and still produce a short page. It is fine to compute per-row display fields (for example `isExpired` for the response) from the returned rows without re-applying the list filter.

### Bulk Insert Optimizations

When performing multiple database insertions concurrently (e.g., via `Promise.allSettled` or `Promise.all`), there is a significant performance penalty due to N+1 network requests. Instead, utilize the Supabase JavaScript client's native support for bulk array inserts:

```ts
// BAD: N+1 sequential/concurrent requests
await Promise.allSettled(items.map((i) => repo.create(i)));

// GOOD: Single bulk atomic request
await repo.createMany(items);
```
