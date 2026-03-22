# Skill: Audit & Quality Review

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

To verify (per migration file, each `CREATE TABLE` must have a matching `ALTER TABLE … ENABLE ROW LEVEL SECURITY` in the same file):

```bash
python3 <<'PY'
import glob
import re
from pathlib import Path

# Matches: create table [public.]users ( ... ) — quoted or unquoted identifiers
create_re = re.compile(
    r"""
    CREATE\s+TABLE\s+
    (?:IF\s+NOT\s+EXISTS\s+)?
    (?:(?P<schema>[a-zA-Z0-9_]+)\.)?
    (?:"(?P<qname>[a-zA-Z0-9_]+)"|(?P<uname>[a-zA-Z0-9_]+))
    \s*\(
    """,
    re.IGNORECASE | re.VERBOSE,
)


def rls_pattern(table: str) -> re.Pattern:
    esc = re.escape(table)
    return re.compile(
        rf'ALTER\s+TABLE\s+(?:[a-zA-Z0-9_]+\.)?(?:"{esc}"|{esc})\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY',
        re.IGNORECASE,
    )

root = Path("supabase/migrations")
failed = False
for path in sorted(glob.glob(str(root / "*.sql"))):
    text = Path(path).read_text(encoding="utf-8")
    tables = []
    for m in create_re.finditer(text):
        name = m.group("qname") or m.group("uname")
        tables.append(name)
    if not tables:
        continue
    for t in tables:
        if not rls_pattern(t).search(text):
            print(f"MISSING RLS: {path} table {t}")
            failed = True
        else:
            print(f"OK: {path} table {t}")
if failed:
    raise SystemExit(1)
PY
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

Implemented by `scripts/check-migration-safety.mjs`. It validates **only**:

- Filenames match `{14-digit-timestamp}_{snake_case}.sql`
- No duplicate timestamps
- Promotion docs updated when migrations change

It does **not** inspect migration SQL for RLS. For per-table RLS coverage, use the **RLS coverage** section above and its Python verification script.

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
| Docs | `.github/workflows/docs.yml` (`docs-spec-sync` job) | Spec sync enforcement |

### Secret exposure in workflows

- Verify secrets are accessed via `${{ secrets.* }}`, never echoed or logged
- Check `permissions:` blocks are minimal
- Verify `pull_request_target` triggers don't expose secrets to untrusted forks

### Branch protection

```bash
npm run configure:branch-protection -- --dry-run
```

(`configure-branch-protection` reads `GITHUB_PAT` — export it per [`docs/internal/GITHUB_BRANCH_PROTECTION_RUNBOOK.md`](../../docs/internal/GITHUB_BRANCH_PROTECTION_RUNBOOK.md).)

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
