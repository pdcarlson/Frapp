# Skill: API Development

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

Dependencies flow inward: Interface → Application → Domain ← Infrastructure.

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

```bash
npm run openapi:export -w apps/api
npm run generate -w packages/api-sdk
```

Commit source + `openapi.json` + `types.ts` together. CI rejects mismatches.

---

## Auth and guard chain

**Auth-related guards are not globally registered.** `app.module.ts` does not use `APP_GUARD` for Supabase, chapter, or permissions; you apply those per-controller or per-route with `@UseGuards()` and `@UseInterceptors()`. **Exception:** `ThrottlerGuard` is registered globally for HTTP rate limiting (read vs write buckets scoped by HTTP method in `ThrottlerModule.forRoot`). Missing an auth decorator means the route is unprotected by that layer.

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
- **AuthSyncInterceptor**: Applied via `@UseInterceptors(AuthSyncInterceptor)` — currently only on user, invite, notification, and chapter-create controllers. Only needed where user auto-sync is required on first request.

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
5. Update `database.types.ts`: `npx supabase gen types typescript --local > apps/api/src/infrastructure/supabase/database.types.ts`
6. Update `docs/internal/DB_ROLLBACK_PLAYBOOK.md` with rollback strategy
7. Filename format: `{14-digit timestamp}_{snake_case}.sql`

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
