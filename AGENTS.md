# AGENTS.md

## Cursor Cloud-specific instructions

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
GITHUB_PAT=ghp_xxx npm run configure:branch-protection -- --dry-run  # Review
GITHUB_PAT=ghp_xxx npm run configure:branch-protection               # Apply
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

### Available credentials (Cursor agent env vars)

The following tokens are available as environment variables in Cursor Cloud sessions:

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

### Gotchas

- The API reads env from `.env.local` then `.env` (NestJS ConfigModule). Prefer using `npm run dev:api` which injects from Infisical instead.
- Local Supabase keys are deterministic JWTs — same for everyone, output by `npx supabase status -o env`.
- Local environment uses real staging Stripe test keys (`sk_test_`) and Sentry DSN so billing and error tracking work during development.
- API lint warnings mostly reflect strict type-safety checks around request context/repository boundaries; lint passes, but warnings can be incrementally hardened over time.
- The mobile app (`apps/mobile`) requires Expo Go on a physical device or emulator; it cannot be tested in a headless cloud VM.
- `npx supabase db push` requires `--local` flag when running against local dev (no linked project). Without it, the CLI errors with "Cannot find project ref".
- The `openapi.json` is committed as a source-of-truth artifact. When changing API endpoints, regenerate it: `npm run openapi:export -w apps/api && npm run generate -w packages/api-sdk`. CI checks freshness via git-diff.
- Branch protection is enforced for admins (`enforce_admins: true`). Emergency overrides require temporarily modifying protection rules via GitHub UI.
