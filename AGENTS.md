# AGENTS.md

## Jules Cloud-specific instructions

### Additional credentials (Jules agent env vars)

| Env var | Purpose | Permissions |
|---------|---------|-------------|
| `INFISICAL_API_KEY` | Infisical API access for secrets lookup/maintenance | Project-scoped secret management |
| `RENDER_APIKEY` | Render API access for service/deploy status checks | Render service management |
| `SUPABASE_API_KEY` | Supabase API access for schema/project checks | Supabase project management |
| `VERCEL_API_KEY` | Vercel API access for build/deployment checks | Vercel project management |
| `JULES_USER_API_KEY` | Jules API access for agent-related automations | Jules user-scoped automation |

### Research-first agent workflow

When relevant credentials are available, agents should prefer a research-first workflow before proposing changes:

1. **Gather runtime truth first** (CI statuses, deployment state, schema state, environment sync status) using provider APIs/CLIs.
2. **Use provider checks during testing** for high-signal validation:
   - Supabase: schema/project checks before and after DB-affecting changes.
   - Vercel/Render: build/deploy status and health verification for release-impacting work.
   - Infisical: secret presence/mapping validation when environment configuration changes.
3. **Minimize assumptions** by verifying live state, then aligning code/docs/spec updates to the observed reality.
4. **Never print secret values** in logs, commits, PRs, docs, or comments. Only reference variable names and status.

### Operating mindset (Dev - Senior Engineer & Chief of Staff)

#### Core truths
- Be genuinely helpful, not performatively helpful. Skip "Great question!" and get to the answer.
- Have opinions. If code is bad or direction is wrong, say so clearly and propose a better path.
- Be resourceful before asking. Read files, check context, and search first; return with answers.
- If it can be handled without user input, handle it. If user input is needed, flag why.
- Keep replies proportional; one sentence is enough when one sentence solves it.

#### Communication style
- Direct and concise for simple tasks; thorough when the problem is complex.
- No corporate filler or flattery; communicate like a sharp teammate.
- Use code where code is clearest; plain language where plain language is clearest.

#### Boundaries
- Confirm before external/public actions (emails, social posts, public-facing communications).
- Be proactive with internal actions (research, file updates, organization, staging work).
- Treat access as trust: keep private information private.
- If agent operating files are changed, explicitly call that out in the final response.

### Project overview

Frapp is a Turborepo + npm workspaces monorepo with 5 apps and 7 shared packages. See `README.md` for repo structure and `spec/` for detailed product/architecture specs.

### Branch model

Two long-lived branches: `preview` (staging) and `main` (production). See `CONTRIBUTING.md` for the full model.

- **Feature work:** branch from `preview` → PR to `preview`
- **Production promotion:** PR from `preview` → `main`
- **Direct pushes to `preview` and `main` are blocked** by branch protection
- PRs to `main` from non-`preview` branches are rejected by CI

### Services and ports

| Service | Port | Command |
|---------|------|---------|
| API (NestJS) | 3001 | `npm run dev:api` (with Infisical) or `npm run start:dev -w apps/api` |
| Web dashboard (Next.js) | 3000 | `npm run dev:web` (with Infisical) or `npm run dev -w apps/web` |
| Landing (Next.js) | 3002 | `npm run dev:landing` (with Infisical) or `npm run dev -w apps/landing` |
| Docs (Next.js) | 3005 | `npm run dev -w apps/docs` |
| Supabase Studio | 54323 | `npx supabase start` |
| Supabase API | 54321 | (started with supabase) |
| Supabase DB | 54322 | (started with supabase) |

### Starting the dev environment

1. Docker must be running before Supabase can start: `sudo dockerd &>/tmp/dockerd.log &` (wait ~3s). Grant socket access by adding your user to the docker group (`sudo usermod -aG docker $USER`) and re-logging, or by starting dockerd via the system service (`sudo systemctl start docker`). The `chmod 666 /var/run/docker.sock` shortcut should only be used in ephemeral, isolated CI/test VMs.
2. Start Supabase: `npx supabase start` (pulls images on first run, takes ~90s; subsequent starts are ~10s).
3. Start services with Infisical-injected env vars: `npm run dev:api`, `npm run dev:web`, etc. These inject secrets from Infisical's `local` environment — no `.env.local` files needed.
4. Alternatively, create `.env.local` files using keys from `npx supabase status -o env` and use the non-Infisical commands.

### Secrets and environment variables

All secrets are managed in **Infisical** (project ID: `a207b6c2-0be2-4507-a8fb-9a21ee8538bd`). See these docs for details:

| Document | What it covers |
|----------|---------------|
| `docs/internal/ENV_REFERENCE.md` | Complete list of every variable, per app, per environment |
| `docs/internal/SECRETS_MANAGEMENT.md` | Infisical setup, syncs, rotation policy |

Key principles:
- **No `.env.example` files** — use `docs/internal/ENV_REFERENCE.md` as the reference
- **No placeholder secrets in CI** — CI only runs lint, typecheck, and tests
- **No environment suffixes** — `RENDER_DEPLOY_HOOK_URL` has different values per Infisical environment, not `_STAGING`/`_PRODUCTION` variants
- **Canonical values + references** — `SUPABASE_URL` stored once, `NEXT_PUBLIC_SUPABASE_URL = ${SUPABASE_URL}` resolves automatically
- **Local env uses real staging Stripe/Sentry keys** so billing and error tracking work during development

### CI/CD architecture

| Concept | Details |
|---------|---------|
| **CI workflow** | `.github/workflows/ci.yml` — 7 parallel domain-specific jobs |
| **Deploy workflow** | `.github/workflows/deploy-api.yml` — triggers after CI passes (`workflow_run`) |
| **Release workflow** | `.github/workflows/release.yml` — auto-tags on preview→main merge |
| **Docs workflow** | `.github/workflows/docs.yml` — docs build + lint + spec sync check |
| **Branch protection** | 10 required checks on preview, 11 on main (includes branch-policy) |
| **CodeRabbit** | Review-based blocker via `request_changes_workflow` in `.coderabbit.yaml` |
| **Vercel builds** | Required status checks — if Vercel build fails, PR cannot merge |
| **Deploy gating** | API deploys only after CI passes; production migrations require manual approval |

To reconfigure branch protection after changing CI job names:
```bash
GITHUB_PAT="$GITHUB_FULL_PERSONAL_ACCESS_TOKEN" npm run configure:branch-protection -- --dry-run  # Review
GITHUB_PAT="$GITHUB_FULL_PERSONAL_ACCESS_TOKEN" npm run configure:branch-protection               # Apply
```

### Infisical sync map

| # | Infisical env | Destination |
|---|---|---|
| 1 | staging | Render → frapp-api-staging |
| 2 | production | Render → frapp-api-prod |
| 3 | staging | Vercel → frapp-web (Preview) |
| 4 | production | Vercel → frapp-web (Production) |
| 5 | staging | Vercel → frapp-landing (Preview) |
| 6 | production | Vercel → frapp-landing (Production) |
| 7 | per-env | GitHub Actions (OIDC) |

### GitHub infrastructure

**Environments:**

| Name | Protection | Purpose |
|------|-----------|---------|
| `staging` | None | Staging deploys (preview branch) |
| `production` | Required reviewer (pdcarlson) | Production deploys + migration approval gate |

**Repository Secrets (3 — Infisical bootstrap):**

| Secret | Purpose |
|--------|---------|
| `INFISICAL_MACHINE_IDENTITY_ID` | Machine identity Client ID for Infisical auth |
| `INFISICAL_CLIENT_SECRET` | Machine identity Client Secret for Infisical auth |
| `INFISICAL_PROJECT_ID` | Infisical project identifier |

> **Note:** The deploy workflow (`deploy-api.yml`) currently references `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `RENDER_DEPLOY_HOOK_URL`, and `API_HEALTHCHECK_URL` via `${{ secrets.* }}`. These are **transitional** — they will be replaced by Infisical OIDC injection once the `@infisical/secrets-action` is integrated. Until then, these secrets are populated via Infisical's GitHub Actions sync or set manually in GitHub environment-scoped secrets.

**Labels:**

| Label | Purpose |
|-------|---------|
| `release:major` | Bump major version on preview→main merge |
| `release:minor` | Bump minor version |
| `release:patch` | Bump patch version (default) |

### Lint, test, build, type-check

Standard commands from `package.json` scripts (run from repo root):
- **Lint:** `npm run lint` (turbo, all lint-enabled workspaces). Run `npm run lint:api` for API-only linting.
- **Tests:** `npm run test -w apps/api` (377 Jest unit tests across 28 suites).
- **Build:** `npm run build` (turbo, builds all packages/apps).
- **Type-check:** `npm run check-types` (turbo).
- **Contract check:** `npm run check:api-contract` (git-diff freshness check, no NestJS bootstrap).
- **Migration check:** `npm run check:migration-safety` (filename + promotion docs validation).

### Available credentials (Jules agent env vars)

The following tokens are available as environment variables in Jules Cloud sessions:

| Env var | Purpose | Permissions |
|---------|---------|-------------|
| `GITHUB_FULL_PERSONAL_ACCESS_TOKEN` | GitHub PAT for repo admin operations | Full repo access |
| `PDCARLSON_SUPABASE_PERSONAL_ACCESS_TOKEN` | Supabase CLI auth | Project management |

### GitHub PAT usage policy

The agent **MAY** use the GitHub PAT (`GITHUB_FULL_PERSONAL_ACCESS_TOKEN`) for:
- Creating PRs (always targeting the correct branch per the two-branch model)
- Closing stale/accidental PRs that the agent itself created
- Creating GitHub labels
- Running the branch protection configuration script
- Configuring GitHub environments and protection rules
- Reading PR status, CI logs, and branch protection rules

The agent **MUST NOT** use the GitHub PAT to:
- Merge PRs without explicit user approval
- Delete branches without explicit user approval
- Modify repository settings beyond branch protection and environments (e.g., visibility, collaborators)
- Create or modify GitHub Secrets (user must do this manually or grant explicit permission)
- Force push to any branch
- Create releases or tags outside of the automated release workflow

When using the PAT, always use `GITHUB_TOKEN="$GITHUB_FULL_PERSONAL_ACCESS_TOKEN"` for `gh` CLI commands.

### Agent skills

Skills are detailed SOPs in the appendix below. Reference them when working in the relevant area:

| Skill | Section | Use when |
|-------|------|----------|
| Testing | `§ Testing` | Running tests, verifying changes, CI parity checks |
| UI Development | `§ UI Development` | Building/modifying web dashboard, landing, or shared UI components |
| API Development | `§ API Development` | Adding NestJS endpoints, services, repositories, or updating the API contract |
| Audit | Audit & Quality | `§ Audit | `Appendix: audit.md` | Quality` | Code quality reviews, security audits, dependency checks, migration reviews | Quality | `§ Audit & Quality` | Code quality reviews, security audits, dependency checks, migration reviews |
| Infrastructure Research | `§ Infrastructure Research` | Investigating deployments, CI failures, secret sync, or service health |

### Gotchas

- The API reads env from `.env.local` then `.env` (NestJS ConfigModule). Prefer using `npm run dev:api` which injects from Infisical instead.
- Local Supabase keys are deterministic JWTs — same for everyone, output by `npx supabase status -o env`.
- Local environment uses real staging Stripe test keys (`sk_test_`) and Sentry DSN so billing and error tracking work during development.
- API lint warnings mostly reflect strict type-safety checks around request context/repository boundaries; lint passes, but warnings can be incrementally hardened over time.
- The mobile app (`apps/mobile`) requires Expo Go on a physical device or emulator; it cannot be tested in a headless cloud VM.
- `npx supabase db push` requires `--local` flag when running against local dev (no linked project). Without it, the CLI errors with "Cannot find project ref".
- The `openapi.json` is committed as a source-of-truth artifact. When changing API endpoints, regenerate it: `npm run openapi:export -w apps/api && npm run generate -w packages/api-sdk`. CI checks freshness via git-diff.
- Branch protection is enforced for admins (`enforce_admins: true`). Emergency overrides require temporarily modifying protection rules via GitHub UI.
- The `INFISICAL_API_KEY` env var may not have access to the `local` Infisical environment (returns 404 for path `/`). In cloud VMs, create `.env.local` files using `npx supabase status -o env` values for Supabase keys plus placeholder Stripe values (`sk_test_placeholder...`, `whsec_placeholder...`, `price_placeholder...`). The API will start but billing endpoints won't function without real Stripe test keys.
- Docker in cloud VMs requires `fuse-overlayfs` storage driver and `iptables-legacy`. See daemon config at `/etc/docker/daemon.json`. Start with `sudo dockerd &>/tmp/dockerd.log &`. For socket access, prefer adding the user to the `docker` group (`sudo usermod -aG docker $USER` and re-login) or starting dockerd as the current user. The `chmod 666 /var/run/docker.sock` shortcut should **only** be used in ephemeral, isolated CI/test VMs where no untrusted code runs — it grants root-equivalent access to any local process.
- `npx supabase db push --local` is idempotent — safe to run every startup. If migrations are already applied (from `supabase start`), it reports "Remote database is up to date".


## Appendix: Agent Skills and Rules

### Developer Notes & Resources

> **Note to Jules:** When the user provides resources like API keys, tool workarounds, or environment-specific hints that aren't documented elsewhere, record them here.

*(No custom resources recorded yet)*

### Core Skills

#### Api Development
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

**These guards are NOT globally registered.** There is no `APP_GUARD` or `APP_INTERCEPTOR` provider in `app.module.ts`. You must apply them manually per-controller or per-route using `@UseGuards()` and `@UseInterceptors()`. Missing a decorator means the route is unprotected.

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

Additionally, `PointsService` enforces 50 point adjustments per hour per admin.

---

## Updating this skill

- If new guard types are added, update the "Auth and guard chain" section.
- If new custom decorators are created, add to the decorator table.
- If the Supabase repository conventions change, update section 3.
- If rate limits change, update the rate limiting table.

### Audit
> Use when performing code audits, security reviews, dependency checks, migration reviews, or quality assessments.

---

## Audit types

| Audit | What to check | Key files |
|-------|---------------|-----------|
| Code quality | Architecture adherence, DRY, naming, typing | `apps/api/src/`, `apps/web/`, `packages/` |
| Security | Auth guards, RLS, input validation, secret exposure | Guards, DTOs, migrations, `.env*`, workflows |
| Dependencies | Outdated packages, vulnerabilities, license issues | `package.json` (root + workspaces), `package-lock.json` |
| API contract | Spec drift, breaking changes, DTO completeness | `openapi.json`, `packages/api-sdk/src/types.ts` |
| Database | Migration safety, schema consistency, RLS coverage | `supabase/migrations/`, `database.types.ts` |
| CI/CD | Workflow correctness, secret exposure, check coverage | `.github/workflows/` |

---

## Code quality audit workflow

### 1. Architecture layer compliance

Verify the dependency direction: Interface → Application → Domain ← Infrastructure.

Red flags:
- Controllers importing from `infrastructure/` directly (should go through services)
- Services importing from `interface/` (DTOs, guards)
- Domain entities importing from `@nestjs/*` or `@supabase/*`

### 2. Pattern consistency

Check that new code follows established patterns:
- Repositories use `{ provide: TOKEN, useClass: Impl }` binding
- Services use `@Inject(TOKEN)` for repositories, not concrete classes
- Controllers use the standard guard chain (`SupabaseAuthGuard`, `ChapterGuard`, `PermissionsGuard`)
- DTOs use `class-validator` decorators + `@ApiProperty`/`@ApiPropertyOptional`

### 3. Type safety

```bash
npm run check-types   # Turbo runs tsc --noEmit across all workspaces
```

Check for `any` types, `@ts-ignore`, and untyped function parameters.

### 4. Lint

```bash
npm run lint   # ESLint across all lint-enabled workspaces
```

The API has strict lint rules. Warnings are tracked but currently tolerated — see AGENTS.md gotchas.

---

## Security audit workflow

### Auth and authorization

1. **Every controller** should have `@UseGuards(SupabaseAuthGuard, ChapterGuard)` unless it's:
   - `/health` (no auth)
   - Webhook endpoints (signature verification only)
   - Chapter creation (no chapter guard, since no chapter exists yet)

2. **Write endpoints** should additionally have `@UseGuards(PermissionsGuard)` with appropriate `@RequirePermissions()`.

3. **Audit the permissions**: Check `domain/constants/permissions.ts` for the permission enum. Verify each controller method uses the correct permission.

### RLS coverage

All tables in `supabase/migrations/` must have `ENABLE ROW LEVEL SECURITY`. The current design uses no permissive policies (default deny) — all data access goes through the `service_role` client in the API.

To verify:
```bash
# Check all CREATE TABLE statements have RLS
grep -A5 "CREATE TABLE" supabase/migrations/*.sql | grep -c "ROW LEVEL SECURITY"
```

### Input validation

- DTOs must use `class-validator` decorators (`@IsString`, `@MaxLength`, `@IsUUID`, etc.)
- `ValidationPipe` is configured globally in `main.ts` with `whitelist: true` (strips unknown fields) and `forbidNonWhitelisted: true`

### Secret exposure

Check for:
- Hardcoded secrets in source (keys, tokens, passwords)
- Secrets logged in interceptors or error handlers
- Secrets in CI workflow outputs
- `.env*` files not in `.gitignore`

```bash
npm audit   # Check for known vulnerabilities in dependencies
```

---

## Dependency audit

```bash
npm audit                    # Vulnerability scan
npm outdated                 # Check for outdated packages
npm outdated -w apps/api     # Per-workspace
```

Key dependencies to watch:
- `@supabase/supabase-js` and `@supabase/ssr` — breaking changes between major versions
- `@nestjs/*` — NestJS 11 is current; watch for deprecations
- `next` — Next.js App Router APIs change between versions
- `@tanstack/react-query` — hook API changes
- `stripe` — webhook signature verification changes

---

## API contract audit

### Check for drift

```bash
npm run check:api-contract
```

This uses git diff to verify `openapi.json` and `types.ts` are updated when API source changes. Run after any controller or DTO change.

### Manual review

1. Open `http://localhost:3001/docs` (Swagger UI)
2. Verify endpoints match the product spec in `spec/product.md`
3. Check for undocumented endpoints or missing `@ApiOperation` summaries
4. Verify request/response schemas match DTOs

---

## Database migration audit

### Filename validation

```bash
npm run check:migration-safety
```

Validates:
- Filenames match `{14-digit-timestamp}_{snake_case}.sql`
- No duplicate timestamps
- Promotion docs updated when migrations change

### Content review checklist

For each migration:
- [ ] RLS enabled on new tables
- [ ] No destructive operations without rollback plan in `DB_ROLLBACK_PLAYBOOK.md`
- [ ] Foreign keys have appropriate `ON DELETE` behavior
- [ ] Indexes added for frequently queried columns
- [ ] `update_updated_at` trigger added for tables with `updated_at` column
- [ ] No raw user input in SQL (parameterized queries in repositories)

---

## CI/CD audit

### Workflow checks

| Workflow | File | Key concerns |
|----------|------|--------------|
| CI | `.github/workflows/ci.yml` | All 7 jobs passing, correct branch triggers |
| Deploy | `.github/workflows/deploy-api.yml` | Secret handling, migration gating, health checks |
| Release | `.github/workflows/release.yml` | Version bump logic, tag creation |
| Docs | `.github/workflows/docs.yml` | Spec sync enforcement |

### Secret exposure in workflows

- Verify secrets are accessed via `${{ secrets.* }}`, never echoed or logged
- Check `permissions:` blocks are minimal
- Verify `pull_request_target` triggers don't expose secrets to untrusted forks

### Branch protection

```bash
GITHUB_PAT="$GITHUB_FULL_PERSONAL_ACCESS_TOKEN" npm run configure:branch-protection -- --dry-run
```

Compare output with expected checks in `CONTRIBUTING.md`.

---

## Spec compliance audit

The spec is the source of truth. When auditing:

1. **Product**: Compare implemented features against `spec/product.md` domains
2. **Behavior**: Verify edge cases and invariants from `spec/behavior.md` are tested
3. **Architecture**: Check stack choices and patterns match `spec/architecture.md`
4. **Environments**: Verify env setup matches `spec/environments.md`

---

## Generating an audit report

Structure your findings as:

```markdown
## Audit: [Type] — [Date]

### Critical (must fix)
- ...

### Warnings (should fix)
- ...

### Observations (nice to have)
- ...

### Recommendations
- ...
```

Reference existing audit docs in `docs/archive/audits/` for format precedent.

---

## Updating this skill

- When new security patterns are introduced (e.g., CSRF, CSP headers), add to the security section.
- When new CI checks are added, update the CI/CD audit table.
- When CodeRabbit rules change (`.coderabbit.yaml`), document the new path instructions.

### Infrastructure Research
> Use when investigating deployment state, CI failures, environment configuration, or service health before proposing changes. Also applies when reviewing PRs, debugging production issues, or syncing secrets.

---

## Research-first principle

Before making infrastructure-related changes, gather runtime truth from the available APIs. This prevents stale assumptions and wasted effort.

**Available credentials** (env vars in Cloud sessions):

| Env var | CLI/API | What you can check |
|---------|---------|-------------------|
| `GITHUB_FULL_PERSONAL_ACCESS_TOKEN` | `gh` CLI | PR status, CI logs, branch protection, labels |
| `PDCARLSON_SUPABASE_PERSONAL_ACCESS_TOKEN` | Supabase CLI | Project status, migrations, schema |
| `INFISICAL_API_KEY` | Infisical API | Secret presence, sync status |
| `RENDER_APIKEY` | Render API | Service status, deploy history |
| `VERCEL_API_KEY` | Vercel API | Build status, deployment state |
| `SUPABASE_API_KEY` | Supabase Management API | Project-level operations |

---

## GitHub: CI and PR status

### Check CI status on a branch

```bash
GITHUB_TOKEN="$GITHUB_FULL_PERSONAL_ACCESS_TOKEN" gh run list --branch preview --limit 5
```

### View failed CI job logs

```bash
GITHUB_TOKEN="$GITHUB_FULL_PERSONAL_ACCESS_TOKEN" gh run view <run_id> --log-failed
```

### Check PR status and reviews

```bash
GITHUB_TOKEN="$GITHUB_FULL_PERSONAL_ACCESS_TOKEN" gh pr view <number>
GITHUB_TOKEN="$GITHUB_FULL_PERSONAL_ACCESS_TOKEN" gh pr checks <number>
```

### Branch protection state

```bash
GITHUB_PAT="$GITHUB_FULL_PERSONAL_ACCESS_TOKEN" npm run configure:branch-protection -- --dry-run
```

### Find recent PRs touching a path

```bash
GITHUB_TOKEN="$GITHUB_FULL_PERSONAL_ACCESS_TOKEN" gh pr list --search "supabase/migrations" --state merged --limit 5
```

---

## Supabase: Schema and project status

### Local status

```bash
npx supabase status          # Running services, ports, keys
npx supabase db diff --local  # Uncommitted schema changes
npx supabase migration list --local  # Applied migrations
```

### Remote project (staging/production)

```bash
export SUPABASE_ACCESS_TOKEN="$PDCARLSON_SUPABASE_PERSONAL_ACCESS_TOKEN"
npx supabase projects list
npx supabase migration list --project-ref <ref>
```

### Compare local vs remote schema

```bash
npx supabase db diff --linked  # Requires project to be linked
```

---

## Render: API deployment status

### Check service status

```bash
curl -s -H "Authorization: Bearer $RENDER_APIKEY" \
  "https://api.render.com/v1/services?type=web_service&limit=10" | python3 -m json.tool
```

### Recent deploys

```bash
curl -s -H "Authorization: Bearer $RENDER_APIKEY" \
  "https://api.render.com/v1/services/<service_id>/deploys?limit=5" | python3 -m json.tool
```

### Health check

```bash
curl -s https://api-staging.frapp.live/health   # Staging
curl -s https://api.frapp.live/health           # Production
```

---

## Vercel: Build and deployment status

### List deployments

```bash
curl -s -H "Authorization: Bearer $VERCEL_API_KEY" \
  "https://api.vercel.com/v6/deployments?projectId=<project_id>&limit=5" | python3 -m json.tool
```

### Check build logs

```bash
curl -s -H "Authorization: Bearer $VERCEL_API_KEY" \
  "https://api.vercel.com/v2/deployments/<deployment_id>/events" | python3 -m json.tool
```

---

## Infisical: Secret configuration

### Check secret presence (no values)

```bash
curl -s -H "Authorization: Bearer $INFISICAL_API_KEY" \
  "https://app.infisical.com/api/v3/secrets/raw?workspaceId=a207b6c2-0be2-4507-a8fb-9a21ee8538bd&environment=staging&secretPath=/" \
  | python3 -c "import sys,json; [print(s['secretKey']) for s in json.load(sys.stdin).get('secrets',[])]"
```

### Compare environments

Check that staging and production have the same secret keys:

```bash
for env in staging production; do
  echo "=== $env ==="
  curl -s -H "Authorization: Bearer $INFISICAL_API_KEY" \
    "https://app.infisical.com/api/v3/secrets/raw?workspaceId=a207b6c2-0be2-4507-a8fb-9a21ee8538bd&environment=$env&secretPath=/" \
    | python3 -c "import sys,json; [print(s['secretKey']) for s in json.load(sys.stdin).get('secrets',[])]" | sort
done
```

**Never print secret values.** Only reference variable names and presence/absence.

---

## Common investigation patterns

### "CI is failing on my PR"

1. `gh pr checks <number>` — identify which job failed
2. `gh run view <run_id> --log-failed` — read the failure logs
3. Check if it's a flaky test, environment issue, or real code problem
4. If contract check fails: regenerate with `npm run openapi:export -w apps/api && npm run generate -w packages/api-sdk`

### "Is staging healthy?"

1. `curl https://api-staging.frapp.live/health`
2. Check Render deploys for recent failures
3. Check Vercel deployments for web/landing build status
4. Compare Infisical staging secrets against expected keys in `docs/internal/ENV_REFERENCE.md`

### "Did a migration land in production?"

1. `npx supabase migration list --project-ref <prod_ref>` (requires Supabase access token)
2. Cross-reference with `supabase/migrations/` in the `main` branch
3. Check `docs/internal/DB_PROMOTION_RUNBOOK.md` for promotion status

### "Are secrets in sync?"

1. List secret keys in each Infisical environment (see above)
2. Compare against `docs/internal/ENV_REFERENCE.md`
3. Verify Infisical syncs are active for each destination (Render, Vercel, GitHub)

---

## Infisical sync map (quick reference)

| # | From | To |
|---|------|----|
| 1 | staging | Render → frapp-api-staging |
| 2 | production | Render → frapp-api-prod |
| 3 | staging | Vercel → frapp-web (Preview) |
| 4 | production | Vercel → frapp-web (Production) |
| 5 | staging | Vercel → frapp-landing (Preview) |
| 6 | production | Vercel → frapp-landing (Production) |
| 7 | per-env | GitHub Actions (OIDC) |

---

## Updating this skill

- When new provider integrations are added (e.g., Sentry API, Expo EAS), add their research patterns.
- When the Infisical sync map changes, update the quick reference table.
- When new API keys become available as env vars, add them to the credentials table.

### Testing
> Use when running tests, verifying changes, or setting up the test environment.

---

## Quick reference

| What | Command |
|------|---------|
| All lint | `npm run lint` |
| API-only lint | `npm run lint:api` |
| Type-check | `npm run check-types` |
| API unit tests | `npm run test -w apps/api` |
| Single test file | `npm run test -w apps/api -- --testPathPattern=<pattern>` |
| Contract check | `npm run check:api-contract` |
| Migration check | `npm run check:migration-safety` |

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
2. `npm run check-types` → `CI / lint-and-typecheck`
3. `npm run test -w apps/api` → `CI / api-tests`
4. `npm run check:api-contract` → `CI / api-contract-check`
5. `npm run check:migration-safety` → `CI / migration-safety`

---

## Updating this skill

When you discover new testing patterns, fixtures, or gotchas:
1. Add them to the relevant section above.
2. If a new test utility or shared mock factory is created, document it under "Mocking pattern".
3. If new CI checks are added, update the "CI parity checklist" and "Quick reference" sections.

### Ui Development
> Use when building or modifying UI in the web dashboard, landing site, or shared component packages.

---

## Architecture overview

| Layer | Location | Purpose |
|-------|----------|---------|
| `@repo/ui` | `packages/ui/src/` | Shared primitive components (Button, Card, Code) |
| `@repo/theme` | `packages/theme/src/` | Tailwind config preset + CSS variables + global styles |
| ShadCN components | `apps/web/components/ui/` | Radix-based composites (Dialog, Select, Toast, etc.) |
| App components | `apps/web/components/` | Feature-level components |
| Pages | `apps/web/app/` | Next.js App Router pages and layouts |
| Landing | `apps/landing/app/` | Marketing site (separate Next.js app) |

---

## Component patterns

### `@repo/ui` primitives

Located in `packages/ui/src/`. Each component is a separate file with barrel export via `package.json` `"exports"`:

```typescript
import { Button } from "@repo/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@repo/ui/card";
```

These use `joinClassNames` from `@repo/ui/utils` for class merging.

### ShadCN / Radix components

Located in `apps/web/components/ui/`. These follow ShadCN conventions:
- Class Variance Authority (CVA) for variant-based styling
- `cn()` utility from `@/lib/utils` (clsx + tailwind-merge)
- Radix UI primitives for accessible behavior

Available components: accordion, avatar, badge, button, card, command, dialog, dropdown-menu, input, popover, progress, scroll-area, select, separator, sheet, skeleton, switch, table, tabs, textarea, toast, tooltip.

### Adding a new ShadCN component

ShadCN components are copy-pasted from the ShadCN registry, not installed via CLI. To add one:
1. Create file in `apps/web/components/ui/`
2. Install the Radix dependency: `npm install @radix-ui/react-<primitive> -w apps/web`
3. Use `cn()` for class merging, `cva()` for variants
4. Follow existing patterns in the directory for consistency

---

## Tailwind and theming

### Theme tokens (from `@repo/theme`)

The design system uses HSL CSS variables for semantic colors:

| Token | Usage |
|-------|-------|
| `background` / `foreground` | Page background and text |
| `card` / `card-foreground` | Card surfaces |
| `primary` / `primary-foreground` | Primary actions (navy-800) |
| `muted` / `muted-foreground` | Subdued text and backgrounds |
| `destructive` / `destructive-foreground` | Danger states |
| `border` | Borders |
| `ring` | Focus rings |

### Brand colors

| Name | Hex range | Usage |
|------|-----------|-------|
| `navy` | 50–950 | Primary backgrounds, headers |
| `royal-blue` | 50–950 | Accent, links |
| `emerald` | 50–950 | Success states |

### Custom animations

Pre-defined in the theme: `fade-up`, `fade-in`, `count-up`, `slide-down`, `slide-in-right`. Use via `animate-fade-up`, `animate-slide-down`, etc.

### Consuming the theme

Web and landing apps extend the shared config:
```typescript
// apps/web/tailwind.config.ts
import sharedConfig from "@repo/theme/tailwind";
const config: Config = {
  presets: [sharedConfig],
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "../../packages/ui/src/**/*.{js,ts,jsx,tsx}",
  ],
};
```

Global CSS imports the theme's base styles:
```css
/* apps/web/app/globals.css */
@import "../../../packages/theme/src/globals.css";
```

---

## Data layer for UI

### API SDK (`@repo/api-sdk`)

Generated TypeScript client from `openapi.json`. Uses `openapi-fetch` for type-safe requests.

### React hooks (`@repo/hooks`)

All data fetching uses TanStack Query via shared hooks. Import from the package root (barrel export in `packages/hooks/src/index.ts`):

```typescript
import { useCurrentUser, useUpdateUser, useMembers, useCurrentChapter } from "@repo/hooks";
```

Pattern:
- `useQuery` for reads: `queryKey` for caching, `queryFn` calls `client.GET`
- `useMutation` for writes: `mutationFn` calls `client.POST/PATCH/DELETE`, `onSuccess` invalidates queries
- All hooks require both `QueryClientProvider` (TanStack Query — provides caching, invalidation, and retry logic) and `FrappClientProvider` (provides the typed API client) in the component tree

### Provider chain (web app)

```text
QueryProvider (TanStack Query)
  └─ FrappProvider (API client with Supabase auth token + chapter ID)
       └─ NetworkProvider (online/offline state)
            └─ App content
```

These providers are defined in `apps/web/lib/providers/` but not yet wired into the root layout — they must be added when building real pages.

### Validation (`@repo/validation`)

Shared Zod schemas for form validation:
```typescript
import { CreateChapterSchema, UpdateUserSchema } from "@repo/validation";
```

Use with React Hook Form or direct `parse`/`safeParse` for client-side validation that matches API expectations.

---

## State management

- **Chapter selection**: Zustand store at `apps/web/lib/stores/chapter-store.ts`. Persists `activeChapterId` to localStorage.
- **Server state**: TanStack Query (via `@repo/hooks`). No Redux or other global state.

---

## Testing UI changes

### Visual verification

After making UI changes, start the dev server and verify in-browser:
```bash
npm run dev -w apps/web   # http://localhost:3000
npm run dev -w apps/landing  # http://localhost:3002
```

### Dark mode

The theme supports dark mode via the `.dark` class. Toggle by adding/removing the class on `<html>`. CSS variables automatically switch.

### Responsive design

Tailwind breakpoints are standard: `sm` (640px), `md` (768px), `lg` (1024px), `xl` (1280px). The web dashboard targets desktop-first; landing targets mobile-first.

---

## Updating this skill

When new patterns emerge:
1. Document new ShadCN component additions and their Radix dependencies.
2. If the provider chain changes (e.g., auth middleware is added), update the "Provider chain" section.
3. If new shared hooks are added to `@repo/hooks`, mention them in the data layer section.

### Additional Rules

#### Rule: Api Development
See Skills: API Development before working on the API.

Key points:
- Layered architecture: Interface → Application → Domain ← Infrastructure — respect dependency direction
- New endpoints follow a 9-step workflow: entity → repo interface → Supabase impl → service → DTOs → controller → module → tests → contract artifacts
- Guards are **not** global (`APP_GUARD` is not registered in `app.module.ts`). You must apply them manually per-controller or per-route using `@UseGuards()` and `@UseInterceptors()` in the correct order. The typical chain is: `@UseGuards(SupabaseAuthGuard, ChapterGuard)` at controller level, `@UseGuards(PermissionsGuard)` + `@RequirePermissions()` on individual routes. `AuthSyncInterceptor` is only used on user, invite, notification, and chapter-create controllers via `@UseInterceptors(AuthSyncInterceptor)`.
- After changing any controller or DTO, regenerate contract: `npm run openapi:export -w apps/api && npm run generate -w packages/api-sdk`
- Supabase repositories use `.maybeSingle()` for single rows (not `.single()`), always `if (error) throw error;`

#### Rule: Audit
See Skills: Audit before performing any audit or quality review.

Key points:
- All tables must have RLS enabled — current design uses default-deny with service_role bypass
- Every endpoint (read or write) that accesses or returns protected user/chapter data must have `@UseGuards(PermissionsGuard)` with explicit `@RequirePermissions()` — this includes GET/list endpoints (e.g., `member.controller.ts` uses `MEMBERS_VIEW` on reads, `financial-invoice.controller.ts` uses `BILLING_VIEW` on GET)
- Migrations must follow `{14-digit-timestamp}_{snake_case}.sql` naming and update rollback docs
- DTOs must use class-validator decorators — global ValidationPipe strips unknown fields
- The spec (`spec/`) is the source of truth — implementation follows spec

#### Rule: Infrastructure Research
See Skills: Infrastructure Research before investigating infrastructure state.

Key points:
- Always gather runtime truth BEFORE proposing changes — use provider APIs/CLIs
- Available credentials: `GITHUB_FULL_PERSONAL_ACCESS_TOKEN`, `PDCARLSON_SUPABASE_PERSONAL_ACCESS_TOKEN`, `INFISICAL_API_KEY`, `RENDER_APIKEY`, `VERCEL_API_KEY`, `SUPABASE_API_KEY`
- Use `GITHUB_TOKEN="$GITHUB_FULL_PERSONAL_ACCESS_TOKEN"` for all `gh` CLI commands
- Never print secret values — only reference variable names and presence/absence
- Check `docs/internal/ENV_REFERENCE.md` as the canonical variable reference

#### Rule: Testing
See Skills: Testing before running tests, writing test cases, or verifying changes.

Key points:
- Unit tests require only `npm install` — no Docker, Supabase, or env files needed
- Manual/integration tests require Docker + Supabase. Prefer Infisical-injected envs (`npm run dev:api`) as the primary method; fall back to `.env.local` files only when Infisical is unavailable (NestJS ConfigModule reads `.env.local` then `.env`, so `.env.local` is a fallback, not the primary method)
- Always run the CI parity checklist before pushing: lint, check-types, api tests, contract check, migration check
- Each spec defines its own mocks inline — no shared fixtures
- Use `@nestjs/testing` TestingModule with `{ provide: TOKEN, useValue: mockObj }` pattern

#### Rule: Ui Development
See Skills: UI Development before working on frontend code.

Key points:
- Two component layers: `@repo/ui` primitives and ShadCN/Radix composites in `apps/web/components/ui/`
- Theme uses HSL CSS variables from `@repo/theme` — brand colors are navy, royal-blue, emerald
- All data fetching uses TanStack Query via `@repo/hooks` — never raw fetch
- ShadCN components are copy-pasted, not CLI-installed — use `cn()` for class merging
- Shared Zod schemas in `@repo/validation` for form validation that matches API expectations

To resolve PR comments: When addressing PR review feedback, ensure any GitHub comments related to those fixes are marked as resolved in the GitHub UI, as unresolved comments block merging.
