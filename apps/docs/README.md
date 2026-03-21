# Frapp Docs Site (`apps/docs`)

Public documentation shell for Frapp (`docs.frapp.live`). **Guide content is frozen here**; canonical markdown lives in [`docs/guides/`](../../docs/guides/README.md) at the repo root.

## Local development

From repo root:

```bash
npm run dev -w apps/docs
```

Docs URL: `http://localhost:3005`

## Common commands

```bash
# Build
npm run build -w apps/docs

# Lint
npm run lint -w apps/docs
```

## Content structure

- `app/guides/*` — MDX routes that link to canonical guides under `docs/guides/*.md` (content freeze).
- `app/docs/[slug]` — renders Markdown docs sourced from `spec/`.
- `components/navigation.ts` — sidebar and mobile nav structure.

## Deployment

- Vercel config: `apps/docs/vercel.json`
- Branch model:
  - `main` → staging docs domain
  - `production` → production docs domain
