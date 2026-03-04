# Frapp Docs Site (`apps/docs`)

Public documentation site for Frapp (`docs.frapp.live`).

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

- `app/guides/*` — curated docs pages written as MDX.
- `app/docs/[slug]` — renders Markdown docs sourced from `spec/`.
- `components/navigation.ts` — sidebar and mobile nav structure.

## Deployment

- Vercel config: `apps/docs/vercel.json`
- Branch model:
  - `preview` → staging docs domain
  - `main` → production docs domain
