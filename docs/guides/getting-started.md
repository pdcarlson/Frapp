# Getting Started with Frapp

This guide walks you through setting up the Frapp monorepo and running the full stack locally with Supabase.

## Prerequisites

- **Node.js** 20+
- **npm** 10+
- **Docker Desktop** (for Supabase)
- **Supabase CLI**: `npm install -g supabase` or `npx supabase --version`
- **Git**

## 1. Clone the repository

```bash
git clone git@github.com:pdcarlson/Frapp.git
cd Frapp
```

## 2. Bootstrap Docker + Supabase (recommended)

With **Docker running** (`docker info` succeeds — e.g. Docker Desktop with WSL integration, or Docker Engine on Linux):

```bash
bash scripts/local-dev-setup.sh
```

This runs `npm install`, `npx supabase start`, `npx supabase db push --local`, then optional typecheck and migration-safety checks. Flags: `--quick` skips checks; **`--reset-supabase`** runs `supabase stop` first for **this project only** (good for **stuck or exited containers**—it **keeps** Docker volumes); **`--reset-supabase-data`** stops with `supabase stop --no-backup` and **wipes local Supabase data volumes** (destructive—see `bash scripts/local-dev-setup.sh --help`). Use **`--reset-supabase-data`** when local Postgres data was created under an older major version than `supabase/config.toml` (see troubleshooting below). It does **not** stop unrelated Docker containers. If `supabase start` fails, an interactive terminal may offer a **volume-preserving** retry (not a fix for Postgres major-version mismatch). It does **not** start `dockerd`; Jules cloud VMs use `scripts/jules-setup.sh` when no Docker Desktop exists.

If `./scripts/local-dev-setup.sh` fails with `env: 'bash\r': No such file`, the file had Windows (CRLF) line endings. Prefer `bash scripts/local-dev-setup.sh`, or re-checkout after `.gitattributes` normalizes `*.sh` to LF.

If the script exits after **`[local-dev-setup] ERROR: Docker daemon is not reachable`**, read the **docker info** lines it prints (e.g. `npipe` / `dockerDesktopLinuxEngine` means Docker Desktop is not fully up). Start **Docker Desktop**, wait until the engine is running, and run `docker info` in the **same** terminal (Git Bash or WSL). If Git Bash still cannot see the daemon, use **WSL** with Docker Desktop WSL integration enabled, or **PowerShell**.

### Windows, Git Bash, and `turbo check-types`

**`@repo/brand-assets`** is SVG-only and is **not** part of the Turbo `build` / `lint` / `check-types` graph (no `scripts` in that package), so Windows/Git Bash does not spawn `npm.cmd` there. Root **`turbo.json`** still uses **`"ui": "stream"`** for reliable logs on Windows; you can set **`TURBO_UI=stream`** if you override UI.

### Postgres 17 and local Supabase volumes

Frapp pins **Postgres 17** locally via `supabase/config.toml` (`[db] major_version = 17`). Docker **volumes** from an older stack (e.g. Postgres 15) are **not** upgraded in place: Postgres will log errors such as **database files are incompatible with server** or **The data directory was initialized by PostgreSQL version X, which is not compatible with this version Y**.

- **Fix:** reset local data once, then start clean and re-apply migrations:

  ```bash
  bash scripts/local-dev-setup.sh --reset-supabase-data
  ```

  Equivalent manual steps: `npx supabase stop --no-backup`, then `npx supabase start`, then `npx supabase db push --local`. Local DB contents are recreated from migrations (anything only in local data is lost).

- **`--reset-supabase`** (without `--no-backup`) is for **stuck or exited containers**; it **does not** remove volumes and **will not** fix a Postgres major-version mismatch.

Supabase CLI: [`supabase stop`](https://supabase.com/docs/reference/cli/supabase-stop) documents **`--no-backup`** (delete data volumes after stopping) for resetting local development data between restarts.

## 3. Start local Supabase (manual alternative)

From the repo root, if you skipped the script:

```bash
npm install
npx supabase start
npx supabase db push --local
```

This spins up the local Supabase stack (Postgres, Auth, Storage, Realtime, Studio) using Docker and applies our migrations from `supabase/migrations/`.

You can open Supabase Studio at:

- `http://127.0.0.1:54323`

> **Note:** The `supabase/` directory in the repo is the single source of truth for the database schema and seed data. Never edit tables manually in Studio without also adding a migration.

> **Note:** Frapp icons and the marketing lockup are synced from `packages/brand-assets/` into each Next app on **`next build`** (`prebuild`). After changing those SVGs, run `npm run sync:brand-assets` from the repo root (or build once). See `docs/internal/BRAND_ASSETS.md` and `spec/ui-assets.md`.

## 4. Configure environment variables

**Recommended:** use **Infisical** so you do not maintain `.env.local` copies for every app.

1. From the repo root, authenticate once: `npx infisical login`.
2. Ensure the Infisical **`local`** environment is populated (Supabase values from `npx supabase status -o env`, plus keys per [`docs/internal/ENV_REFERENCE.md`](../internal/ENV_REFERENCE.md)). See [`docs/internal/SECRETS_MANAGEMENT.md`](../internal/SECRETS_MANAGEMENT.md) for project setup and syncs.

When `supabase start` finishes, it prints the local project URL and keys (`API URL`, `anon key`, `service_role key`) — use those when filling Infisical `local` or when building `.env.local` manually.

**Fallback:** create `.env.local` per app from those values and `docs/internal/ENV_REFERENCE.md`, then run the non-Infisical commands in [`docs/internal/LOCAL_DEV.md`](../internal/LOCAL_DEV.md).

> **Warning:** Never commit `.env.local` files. They contain real secrets. All staging and production secrets are managed in Infisical — see `docs/internal/SECRETS_MANAGEMENT.md`.

## 5. Run the dev servers

**Default:** from the **repo root**, with Infisical injecting secrets (`--env=local` on each `dev:*` script):

```bash
npm run dev:stack
```

This starts API, web, and landing in one terminal (prefixed logs). It matches what `scripts/local-dev-setup.sh` prints when it finishes.

**Everything else** — separate terminals per app, running without Infisical, mobile (Expo), Turbo vs API, and the URL table — lives in one place: **[`docs/internal/LOCAL_DEV.md`](../internal/LOCAL_DEV.md)**. Do not duplicate those lists in other docs; link there instead.

## 6. Verify everything is healthy

- **API health check**: `http://localhost:3001/health`
- **Web app**: `http://localhost:3000`
- **Landing**: `http://localhost:3002`
- **Supabase Studio**: `http://127.0.0.1:54323`

If `/health` responds with a JSON status and no errors appear in the API logs, your local environment is ready.
