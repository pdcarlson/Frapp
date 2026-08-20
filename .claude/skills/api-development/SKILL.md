---
name: api-development
description: >
  Build or modify NestJS API endpoints, services, repositories, DTOs, guards, or the OpenAPI
  contract artifacts. Use when working under `apps/api/src/`, `packages/api-sdk/`, or
  `packages/validation/` — covers the layered architecture, the 9-step new-endpoint workflow,
  the per-route auth/guard chain, Supabase repository conventions, and contract regeneration.
---

# API Development

> Use when building or modifying NestJS API endpoints, services, repositories, or the contract artifacts.

---

## Architecture

The API follows a layered architecture in `apps/api/src/`:

| Layer | Directory | Contains |
|-------|-----------|----------|
| **Interface** | `interface/` | Controllers, DTOs, guards, interceptors, decorators, filters |
| **Application** | `application/services/` | Business logic and orchestration |
| **Infrastructure** | `infrastructure/` | Supabase repositories, Stripe, storage, notifications |
| **Domain** | `domain/` | Entities, repository interfaces, adapter interfaces, constants |
| **Modules** | `modules/` | NestJS module wiring (thin glue) |

Dependencies flow inward: Interface → Application → Domain ← Infrastructure. Respect the
dependency direction — outer layers may import inner ones, never the reverse.

For the in-depth treatment (error handling, observability hooks, service performance patterns),
see [`docs/guides/api-architecture.md`](../../../docs/guides/api-architecture.md).

---

## Adding a new endpoint (full workflow)

### 1. Define the entity

`domain/entities/<name>.entity.ts` — plain TypeScript interface matching the DB table:

```typescript
export interface Widget {
  id: string;
  chapter_id: string;
  name: string;
  created_at: string;
}
```

### 2. Define the repository interface

`domain/repositories/<name>.repository.interface.ts`:

```typescript
export const WIDGET_REPOSITORY = 'WIDGET_REPOSITORY';

export interface IWidgetRepository {
  findByChapterId(chapterId: string): Promise<Widget[]>;
  create(data: Partial<Widget>): Promise<Widget>;
}
```

### 3. Implement the Supabase repository

`infrastructure/supabase/repositories/supabase-<name>.repository.ts`:

```typescript
@Injectable()
export class SupabaseWidgetRepository implements IWidgetRepository {
  constructor(@Inject(SUPABASE_CLIENT) private readonly supabase: FrappSupabaseClient) {}

  async findByChapterId(chapterId: string): Promise<Widget[]> {
    const { data, error } = await this.supabase
      .from('widgets')
      .select('*')
      .eq('chapter_id', chapterId);
    if (error) throw error;
    return data ?? [];
  }
}
```

Conventions:
- Single row: `.maybeSingle()` (returns `null`), not `.single()` (throws)
- Always `if (error) throw error;`
- Return `data ?? []` for lists, `data` for singles
- Write methods take `TablesInsert<'widgets'>` / `TablesUpdate<'widgets'>`
  and pass them to `.insert()` / `.update()` with no `as never`. Domain
  interfaces stay `Partial<Widget>`. Do not extract a generic base
  repository for this.

### 4. Write the service

`application/services/<name>.service.ts`:

```typescript
@Injectable()
export class WidgetService {
  constructor(@Inject(WIDGET_REPOSITORY) private readonly widgetRepo: IWidgetRepository) {}

  async list(chapterId: string): Promise<Widget[]> {
    return this.widgetRepo.findByChapterId(chapterId);
  }
}
```

### 5. Create DTOs

`interface/dtos/<name>.dto.ts` — class-validator + Swagger decorators:

```typescript
export class CreateWidgetDto {
  @ApiProperty()
  @IsString()
  @MaxLength(255)
  name: string;
}
```

### 6. Create the controller

`interface/controllers/<name>.controller.ts`:

```typescript
@ApiTags('Widgets')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard)
@Controller('widgets')
export class WidgetController {
  constructor(private readonly widgetService: WidgetService) {}

  @Get()
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.WIDGETS_VIEW)
  @ApiOperation({ summary: 'List widgets' })
  async list(@CurrentChapterId() chapterId: string) {
    return this.widgetService.list(chapterId);
  }

  @Post()
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.WIDGETS_CREATE)
  @ApiOperation({ summary: 'Create a widget' })
  async create(@CurrentChapterId() chapterId: string, @Body() dto: CreateWidgetDto) {
    return this.widgetService.create(chapterId, dto);
  }
}
```

### 7. Wire the module

`modules/<name>/<name>.module.ts`:

```typescript
@Module({
  controllers: [WidgetController],
  providers: [
    WidgetService,
    { provide: WIDGET_REPOSITORY, useClass: SupabaseWidgetRepository },
  ],
  exports: [WidgetService],
})
export class WidgetModule {}
```

Import in `app.module.ts`.

### 8. Write tests

`application/services/<name>.service.spec.ts` — mock the repository:

```typescript
const mockRepo = { findByChapterId: jest.fn(), create: jest.fn() };
const module = await Test.createTestingModule({
  providers: [
    WidgetService,
    { provide: WIDGET_REPOSITORY, useValue: mockRepo },
  ],
}).compile();
```

### 9. Update contract artifacts

After changing **any** controller or DTO, regenerate the contract:

```bash
npm run openapi:export -w apps/api
npm run generate -w packages/api-sdk
```

Commit source + `openapi.json` + `types.ts` together. CI rejects mismatches.

---

## Auth and guard chain

**Auth-related guards are not globally registered.** `app.module.ts` does not use `APP_GUARD` for Supabase, chapter, or permissions; you apply those per-controller or per-route with `@UseGuards()` and `@UseInterceptors()`. **Exception:** `CustomThrottlerGuard` is registered globally for HTTP rate limiting (read vs write buckets by HTTP method). Missing an auth decorator means the route is unprotected by that layer.

Recommended per-route pattern (applied in this order):

```text
Bearer token → SupabaseAuthGuard (validates JWT, sets request.supabaseUser)
             → AuthSyncInterceptor (syncs to users table, sets request.appUser)
             → ChapterGuard (validates x-chapter-id + membership, sets request.member, request.chapterId)
             → PermissionsGuard (checks @RequirePermissions against member's roles)
             → Controller
```

### How to apply

- **Controller-level** (most common): `@UseGuards(SupabaseAuthGuard, ChapterGuard)` on the class
- **Route-level permissions**: `@UseGuards(PermissionsGuard)` + `@RequirePermissions(...)` on individual methods
- **AuthSyncInterceptor**: Applied via `@UseInterceptors(AuthSyncInterceptor)` — class-level on the user, invite, notification, and analytics controllers, and per-route on the pre-chapter chapter routes (create, onboard, list, activate). Only needed where user auto-sync is required on first request; `grep @UseInterceptors(AuthSyncInterceptor)` for the current list.

**Every route that returns or accesses protected chapter data needs an explicit
`@RequirePermissions(...)` / `@RequireAnyOfPermissions(...)` — including GET/list routes.** Reads
leak chapter data just as writes corrupt it; a `@Get()` without a permission decorator is a
finding, not a convenience. Use class-level defaults where it keeps behavior consistent:
route-level `@RequirePermissions` is **merged** with the class-level list by `PermissionsGuard`
(the union of both must be satisfied), so both apply. See
[`docs/guides/api-architecture.md`](../../../docs/guides/api-architecture.md) §2 for the full
merge semantics (including `@RequireAnyOfPermissions` OR-groups) and ChapterGuard's
subscription-status write gating.

**Order matters.** `SupabaseAuthGuard` must run before `ChapterGuard` (which needs `request.supabaseUser`). `ChapterGuard` must run before `PermissionsGuard` (which needs `request.member`).

### Custom decorators

| Decorator | Returns | Source |
|-----------|---------|--------|
| `@CurrentUser()` | `{ id: string }` | `request.appUser` |
| `@CurrentChapterId()` | `string` | `request.chapterId` |
| `@RequirePermissions(...)` | — | Sets metadata for PermissionsGuard |
| `@RequireAnyOfPermissions(...)` | — | OR-logic variant |

### Special cases

- `/health` — no guards at all
- `POST /v1/chapters` — `SupabaseAuthGuard` + `AuthSyncInterceptor` only (no chapter exists yet)
- `POST /v1/billing/webhook` — `StripeWebhookGuard` (signature verification, no JWT)

---

## Database changes

When adding a table or column:

1. `npx supabase migration new my_change_name`
2. Write SQL in `supabase/migrations/<timestamp>_my_change_name.sql`
3. Enable RLS: `ALTER TABLE my_table ENABLE ROW LEVEL SECURITY;` (all tables must have RLS)
4. Apply locally: `npx supabase db push --local`
5. Add the row type to `apps/api/src/infrastructure/supabase/database.types.ts` — see "Keeping `database.types.ts` in sync" below. **Do not** pipe `supabase gen types` over this file; it is hand-maintained.
6. Update [`docs/internal/ops/DB_ROLLBACK_PLAYBOOK.md`](../../../docs/internal/ops/DB_ROLLBACK_PLAYBOOK.md) with rollback strategy
7. Filename format: `{14-digit timestamp}_{snake_case}.sql`

### Keeping `database.types.ts` in sync

`database.types.ts` is **hand-maintained**, not generated. It composes the
`Database` interface out of the domain entities rather than restating every
column, so `supabase gen types typescript --local > …` would overwrite that
structure and detach the schema types from `domain/entities`. Use the
generator's output as a *reference* to diff against if you like, but edit the
file by hand.

Adding a table means two edits, sometimes three:

1. A row interface in `apps/api/src/domain/entities/`, exported from the
   barrel (`index.ts`).
2. A `TableDefinition<YourRow>` entry under `Database['public']['Tables']`.
3. For an RPC, an entry under `Functions` with its `Args` and `Returns`.
   `returns setof <table>` maps to `YourEntity[]`; function parameters are
   nullable in Postgres, so a `text` parameter the caller may omit is
   `string | null`.

Two constraints worth knowing before you fight the compiler:

* **`Row` is written as `{ [K in keyof Row]: Row[K] }`, deliberately.**
  PostgREST constrains every row to `Record<string, unknown>`, and a
  TypeScript `interface` gets no implicit index signature. Passing the
  entity directly makes `Database` silently fail postgrest-js's
  `GenericSchema` constraint — at which point the client degrades to
  permissive typing and *every* query stops being checked, with no error to
  tell you. The mapped type flattens the interface into an anonymous object
  type, which does get the index signature.
* **`Insert` and `Update` use the same mapped-type trick**
  (`{ [K in keyof Row]?: Row[K] }`), not `Record<string, unknown>`. The
  untyped index signature is why every `.insert()` / `.update()` needed
  `as never`. Repository write methods take `TablesInsert<'table'>` /
  `TablesUpdate<'table'>` (exported from `database.types.ts`) and pass
  them to PostgREST with no cast. Domain interfaces stay `Partial<Entity>`
  — domain must not import `Database`. That shape is assignable to the
  table Insert/Update types, so the infrastructure method still
  `implements` the domain interface. `database.types.insert-check.ts` is
  the compile-only proof: a typed insert is accepted, a mistyped column
  (`{ title: 123 }`) is rejected. If GenericSchema silently degrades, that
  `@ts-expect-error` becomes unused and `nest build` fails.
* **Insert/upsert payload types must be type aliases, not interfaces**, for
  the same reason. `DuesConfig` in `chapter-config.service.ts` carries a
  comment to this effect.
* **Do not introduce a generic base repository.** Each repository keeps
  its own query logic. The type wiring is per-call: parameterize the
  write method, leave the rest of the class alone. Every repository under
  `infrastructure/supabase/repositories/` follows this; `no-as-never.spec.ts`
  fails the suite if the file count drifts, a file injects a bare
  `SupabaseClient`, or an `as never` write cast returns. Direct
  service-layer writes (chapter config, custom fields/roles, chapter-create
  channel seed, onboarding, chat-bridge, scheduled-jobs) use the same
  `TablesInsert` / `TablesUpdate` locals.

Consumers only get the checking if they declare the injected client as
`FrappSupabaseClient` and construct it with `createClient<Database>(...)`.
Annotating it as the bare `SupabaseClient` from `@supabase/supabase-js`
erases the schema types at the injection site — that applies to services,
guards, workers, and health as well as repositories.

---

## Rate limiting

Configured in `app.module.ts`:

| Throttle | Limit | Window |
|----------|-------|--------|
| Read | 100 req | 60s |
| Write | 30 req | 60s |

Additionally, `PointsService` enforces 50 point-adjustments per hour per admin.

---

## Updating this skill

- If new guard types are added, update the "Auth and guard chain" section.
- If new custom decorators are created, add to the decorator table.
- If the Supabase repository conventions change, update section 3.
- If rate limits change, update the rate limiting table.
