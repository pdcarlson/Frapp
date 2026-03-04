# Frapp API (`apps/api`)

NestJS backend for Frapp.

## Responsibilities

- Authenticated, chapter-scoped REST API (`/v1/*`)
- Permission enforcement (AuthGuard → ChapterGuard → PermissionsGuard)
- Domain services (events, points, billing, chat, tasks, service hours, etc.)
- OpenAPI export used to generate `@repo/api-sdk`

## Local development

From repo root:

```bash
npm run start:dev -w apps/api
```

Service URLs:

- API: `http://localhost:3001`
- Swagger: `http://localhost:3001/docs`
- Health: `http://localhost:3001/health`

## Environment

Copy `apps/api/.env.example` to `apps/api/.env.local` and provide Supabase + Stripe values.

The API reads env in this order:

1. `.env.local`
2. `.env`

## Common commands

```bash
# Build
npm run build -w apps/api

# Unit tests
npm run test -w apps/api

# E2E tests
npm run test:e2e -w apps/api

# Lint
npm run lint -w apps/api

# Export OpenAPI spec
npm run openapi:export -w apps/api
```

## Related docs

- Deployment runbook: `docs/DEPLOYMENT.md`
- Environment spec: `spec/environments.md`
- Architecture spec: `spec/architecture.md`
- Behavior spec: `spec/behavior.md`
