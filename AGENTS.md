# AGENTS.md

## Cursor Cloud-specific instructions

### Project overview

Frapp is a Turborepo + npm workspaces monorepo with 5 apps and 7 shared packages. See `README.md` for repo structure and `spec/` for detailed product/architecture specs.

### Services and ports

| Service | Port | Command |
|---------|------|---------|
| API (NestJS) | 3001 | `npm run start:dev -w apps/api` |
| Web dashboard (Next.js) | 3000 | `npm run dev -w apps/web` |
| Landing (Next.js) | 3002 | `npm run dev -w apps/landing` |
| Docs (Next.js) | 3005 | `npm run dev -w apps/docs` |
| Supabase Studio | 54323 | `npx supabase start` |
| Supabase API | 54321 | (started with supabase) |
| Supabase DB | 54322 | (started with supabase) |

### Starting the dev environment

1. Docker must be running before Supabase can start: `sudo dockerd &>/tmp/dockerd.log &` (wait ~3s). Grant socket access by adding your user to the docker group (`sudo usermod -aG docker $USER`) and re-logging, or by starting dockerd via the system service (`sudo systemctl start docker`). The `chmod 666 /var/run/docker.sock` shortcut should only be used in ephemeral, isolated CI/test VMs.
2. Start Supabase: `npx supabase start` (pulls images on first run, takes ~90s; subsequent starts are ~10s).
3. Create `.env.local` files for each app using keys from `npx supabase status -o env`. See `spec/environments.md` for the full variable list per app.
4. Start individual services with workspace commands above, or all at once with `npm run dev` (uses turbo persistent mode).

### Lint, test, build, type-check

Standard commands from `package.json` scripts (run from repo root):
- **Lint:** `npm run lint` (turbo, all lint-enabled workspaces). Run `npm run lint:api` for API-only linting.
- **Tests:** `npm run test -w apps/api` (377 Jest unit tests across 28 suites).
- **Build:** `npm run build` (turbo, builds all packages/apps).
- **Type-check:** `npm run check-types` (turbo).

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
- Reading PR status, CI logs, and branch protection rules

The agent **MUST NOT** use the GitHub PAT to:
- Merge PRs without explicit user approval
- Delete branches without explicit user approval
- Modify repository settings beyond branch protection (e.g., visibility, collaborators)
- Create or modify GitHub Secrets (user must do this manually or grant explicit permission)
- Force push to any branch
- Create releases or tags outside of the automated release workflow

When using the PAT, always use `GITHUB_TOKEN="$GITHUB_FULL_PERSONAL_ACCESS_TOKEN"` for `gh` CLI commands.

### Gotchas

- The API reads env from `.env.local` then `.env` (NestJS ConfigModule). Supabase local keys are deterministic JWTs output by `npx supabase status -o env`.
- Stripe env vars (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`) can be set to placeholders for local dev unless testing billing flows.
- API lint warnings mostly reflect strict type-safety checks around request context/repository boundaries; lint passes, but warnings can be incrementally hardened over time.
- The mobile app (`apps/mobile`) requires Expo Go on a physical device or emulator; it cannot be tested in a headless cloud VM.
- `npx supabase db push` requires `--local` flag when running against local dev (no linked project). Without it, the CLI errors with "Cannot find project ref".
