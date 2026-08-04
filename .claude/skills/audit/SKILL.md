---
name: audit
description: >
  Perform code quality reviews, security audits, dependency checks, API contract audits, database
  migration reviews, or CI/CD audits on this repo. Use when asked to audit, security-review, or
  assess quality of the codebase, when checking RLS/guard coverage or dependency vulnerabilities,
  and as the engineering-gaps lens of scheduled routines like the Linear curator.
---

# Audit & Quality Review

> Read before performing code audits, security reviews, dependency checks, migration reviews, or
> quality assessments — whether interactively or as a read-only pass inside a scheduled routine
> (e.g. the [Linear curator](../linear-curator/SKILL.md)'s engineering-gaps lens). In read-only
> runs, findings are filed to Linear rather than fixed in place, and any edits made by
> `lint --fix` are throwaway (`git checkout -- .`) — never commit them.

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

On a fresh sandbox, build shared packages first (`npx turbo run build --filter=./packages/*`) so
workspace type-checks resolve against built outputs.

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

2. **Every endpoint — read or write — that accesses or returns protected user/chapter data** must
   additionally have `@UseGuards(PermissionsGuard)` with explicit `@RequirePermissions()` (or
   `@RequireAnyOfPermissions()`). This includes GET/list endpoints — e.g. `member.controller.ts`
   uses `MEMBERS_VIEW` on reads, and `financial-invoice.controller.ts` lists own invoices for
   members but requires `billing:view` to list all or read others' invoices. Class-level defaults
   are fine where they keep behavior consistent; route-level `@RequirePermissions` is **merged**
   with the class list by `PermissionsGuard`, so both apply.

3. **Audit the permissions**: Check `domain/constants/permissions.ts` for the permission enum. Verify each controller method uses the correct permission.

### RLS coverage

All tables in `supabase/migrations/` must have `ENABLE ROW LEVEL SECURITY`. The current design uses no permissive policies (default deny) — all data access goes through the `service_role` client in the API.

To verify (per migration file, each `CREATE TABLE` must have a matching `ALTER TABLE … ENABLE ROW LEVEL SECURITY` in the same file):

```bash
python3 <<'PY'
import glob
import re
from pathlib import Path

# Matches: create table [schema.]name ( ... ) — schema and name quoted or unquoted
create_re = re.compile(
    r"""
    CREATE\s+TABLE\s+
    (?:IF\s+NOT\s+EXISTS\s+)?
    (?:
      (?:"(?P<qschema>[a-zA-Z0-9_]+)"|(?P<uschema>[a-zA-Z0-9_]+))\.
    )?
    (?:"(?P<qname>[a-zA-Z0-9_]+)"|(?P<uname>[a-zA-Z0-9_]+))
    \s*\(
    """,
    re.IGNORECASE | re.VERBOSE,
)


def rls_pattern(schema, table):
    """Match ENABLE RLS for the same table as CREATE (qualified ALTER or unqualified, Frapp-style)."""
    esc_t = re.escape(table)
    ident = rf'(?:"{esc_t}"|{esc_t})'
    if schema:
        esc_s = re.escape(schema)
        qualified = (
            rf"ALTER\s+TABLE\s+{esc_s}\.{ident}\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY"
        )
        # Migrations often use `alter table users` without repeating the schema
        unqualified = (
            rf"ALTER\s+TABLE\s+{ident}\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY"
        )
        return re.compile(rf"(?:{qualified}|{unqualified})", re.IGNORECASE)
    return re.compile(
        rf"ALTER\s+TABLE\s+(?:[a-zA-Z0-9_]+\.)?{ident}\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY",
        re.IGNORECASE,
    )

root = Path("supabase/migrations")
failed = False
for path in sorted(glob.glob(str(root / "*.sql"))):
    text = Path(path).read_text(encoding="utf-8")
    tables = []
    for m in create_re.finditer(text):
        sch = m.group("qschema") or m.group("uschema")
        name = m.group("qname") or m.group("uname")
        tables.append((sch, name))
    if not tables:
        continue
    for sch, t in tables:
        label = f"{sch}.{t}" if sch else t
        if not rls_pattern(sch, t).search(text):
            print(f"MISSING RLS: {path} table {label}")
            failed = True
        else:
            print(f"OK: {path} table {label}")
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

For **transitive CVEs**, prefer the root `overrides` block in [`/package.json`](../../../package.json) (established in #245 / [`docs/internal/security/SECURITY_FIXES.md`](../../../docs/internal/security/SECURITY_FIXES.md)) over per-workspace upgrades. Pin to the patched range cited by the advisory, then `rm package-lock.json && npm install` so the lockfile rebuilds against the new graph — a plain `npm install` will keep the old resolution.

---

## API contract audit

### Check for drift

```bash
npm run check:api-contract
```

This uses git diff to verify `openapi.json` and `types.ts` are updated when API source changes. Run after any controller or DTO change.

### Manual review

1. Open `http://localhost:3001/docs` (Swagger UI)
2. Verify endpoints match the product spec under `spec/product/`
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
- [ ] No destructive operations without rollback plan in [`docs/internal/ops/DB_ROLLBACK_PLAYBOOK.md`](../../../docs/internal/ops/DB_ROLLBACK_PLAYBOOK.md)
- [ ] Foreign keys have appropriate `ON DELETE` behavior
- [ ] Indexes added for frequently queried columns
- [ ] `update_updated_at` trigger added for tables with `updated_at` column
- [ ] No raw user input in SQL (parameterized queries in repositories)

---

## CI/CD audit

### Workflow checks

| Workflow | File | Key concerns |
|----------|------|--------------|
| CI | `.github/workflows/ci.yml` | All required CI jobs passing, correct branch triggers |
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

(`configure-branch-protection` reads `GITHUB_PAT` first, with aliases tolerated (`GITHUB_TOKEN`, `GH_PAT`, `GH_TOKEN`) — export it per [`docs/internal/ops/GITHUB_BRANCH_PROTECTION_RUNBOOK.md`](../../../docs/internal/ops/GITHUB_BRANCH_PROTECTION_RUNBOOK.md).)

Compare output with expected checks in `CONTRIBUTING.md`.

---

## Spec compliance audit

The spec is the source of truth — implementation follows spec. When auditing:

1. **Product**: Compare implemented features against domains under `spec/product/`
2. **Behavior**: Verify edge cases and invariants from topics under `spec/behavior/` are tested
3. **Architecture**: Check stack choices and patterns match [`spec/architecture/README.md`](../../../spec/architecture/README.md)
4. **Environments**: Verify env setup matches [`spec/environments/README.md`](../../../spec/environments/README.md)

---

## Reporting findings

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

**Do not commit one-off audit markdown to the repo** — per
[`docs/internal/DOCUMENTATION_CONVENTIONS.md`](../../../docs/internal/DOCUMENTATION_CONVENTIONS.md),
narrative audit writeups are exactly the kind of file the docs restructure removed. Deliver the
report in the conversation (or run output), fold durable facts into the canonical doc, and file
actionable findings as **Linear** issues.

---

## Updating this skill

- Document new security patterns (e.g., CSRF, CSP headers) in the security section as they land.
- Update the CI/CD audit table whenever new CI checks are added.
