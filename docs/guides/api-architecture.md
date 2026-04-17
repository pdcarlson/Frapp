# API Architecture

This guide explains the NestJS architecture used by the Frapp API and how to add new modules safely.

## 1. Layered architecture

The API in `apps/api` follows a strict layered structure:

- **Interface layer**: controllers, DTOs, guards, interceptors, exception filters
- **Application layer**: services (use-cases, orchestration)
- **Infrastructure layer**: Supabase repositories, external adapters (Stripe, Expo Push, Storage)
- **Domain layer**: entities, repository interfaces, shared business rules

For list query parameters named `limit` (or similar caps), validate the allowed range on the query DTO with `class-validator` (for example `@Min(1)` and `@Max(200)`) and set matching `minimum` / `maximum` on `@ApiPropertyOptional` so OpenAPI reflects the same contract as the validation pipe.

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
3. **PermissionsGuard** — checks `@RequirePermissions()` metadata against the user's roles.

Interceptors:

- **RequestIdInterceptor** — attaches/propagates `x-request-id`.
- **LoggingInterceptor** — structured JSON logging with latency and status code.
- **(Future) AuthSyncInterceptor** — syncs Supabase Auth metadata into our `users` table.

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

5. **Module wiring**
   - Create `PollModule` in `src/interface/modules/poll.module.ts`, providing controller, service, and repository implementation.
   - Import `PollModule` into `AppModule`.

> **Tip:** Always start new features by updating the **specs** (`spec/product.md`, `spec/behavior.md`, `spec/architecture.md`). The API implementation should follow, not lead, the spec.

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

When a service loads related rows for many parent records (for example, vote tallies for each poll in `PollService.listPolls`), use `Promise.allSettled` over the per-parent queries so work runs concurrently instead of awaiting inside a sequential `for` loop. On rejection for one parent, handle that entry in isolation (for example, empty tallies) so other polls still return.

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
