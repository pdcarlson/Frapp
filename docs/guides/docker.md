# Docker (API)

This guide explains the Frapp API Dockerfile and local container workflows.

## 1. API Dockerfile overview

The NestJS API lives in `apps/api/` and is built with a multi-stage Dockerfile at `apps/api/Dockerfile`.

Because this is a monorepo (workspaces + shared packages), the **build context is the repo root**.

Key points:

- **deps stage**: installs the workspace dependencies needed to build the API.
- **builder stage**: compiles shared packages + the API to `dist/`.
- **prod-deps stage**: installs production-only dependencies.
- **runner stage**: slim runtime image that runs as a **non-root** `frapp` user.
- Exposes port **3001** and defines a `/health` **HEALTHCHECK**.

## 2. .dockerignore

Because the build context is the **repo root**, the **root** `.dockerignore` keeps the image small and builds fast:

The file is [`.dockerignore`](../../.dockerignore) (not copied here); it excludes the frontend apps, tests, specs and Markdown, among other things.

We rely on the builder stage to compile TypeScript and only copy `dist/` into the runtime image.

## 3. Local container testing

From the repo root:

```bash
docker build -f apps/api/Dockerfile -t frapp-api .
```

To run the container against your local Supabase instance:

```bash
docker run --rm -p 3001:3001 \
  -e SUPABASE_URL=http://host.docker.internal:54321 \
  -e SUPABASE_SERVICE_ROLE_KEY=... \
  -e STRIPE_SECRET_KEY=... \
  -e STRIPE_WEBHOOK_SECRET=... \
  -e STRIPE_PRICE_ID=... \
  frapp-api
```

Then hit:

- `http://localhost:3001/health`

> **Tip:** Use `host.docker.internal` so the API container can talk to Supabase running on your host machine (`npm run supabase -- start`).

## 4. docker-compose (optional convenience)

At the repo root we maintain a minimal [`docker-compose.yml`](../../docker-compose.yml) for the API (build context, port 3001, Supabase and Stripe env passthrough, a healthcheck on `/health`). It is not copied here; the file is the source.

Usage:

```bash
docker compose up --build api
```

## 5. Production deployment target

The API runs on **Google Cloud Run** ([`cloud-run.md`](../ops/deployment/cloud-run.md), since 2026-11-17).

- The deploy job builds `apps/api/Dockerfile` with the monorepo root as the build context.
- Required env vars reach the service from Infisical through Google Secret Manager, never through the console.
- Staging (deployed from `main`) and production (deployed from a named commit) are separate Google Cloud projects.

For the full rollout checklist (including current status and pending items), use the repository runbook: `docs/ops/deployment/`.

> **Note:** We deliberately avoid containerizing the Next.js apps and Supabase. Next.js deploys best on Vercel, and Supabase Cloud manages its own Postgres/Auth/Storage/Realtime stack.
