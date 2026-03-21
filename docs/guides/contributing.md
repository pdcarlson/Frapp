# Contributing

This guide defines how we work on Frapp: branch workflow, commit messages, and the spec-first development process.

## 1. Branching model

We use a two-environment branch model:

- `main` — pre-production integration branch (deployed to Vercel Preview domains and staging infrastructure)
- `production` — production branch (deployed to production environments)
- `feature/*` — short-lived branches for individual features and fixes

Typical flow:

1. Branch from `main` into `feature/*`.
2. Open a PR from `feature/*` to `main`.
3. Validate behavior in staging/preview environments.
4. Open a promotion PR from `main` to `production` for production release.

Example feature branch names:

- `feature/backwork-redaction-ui`
- `feature/events-rbac`
- `feature/docs-consistency-audit`

## 2. Commit messages

Use conventional commits with a short scope when helpful:

```text
type(scope): description
```

Examples:

- `feat(api): add service hours endpoints`
- `refactor: switch api auth to supabase`
- `docs(guides): add docker guide`

Types:

- `feat` — new user-visible feature
- `fix` — bug fix
- `refactor` — code change that doesn't alter behavior
- `docs` — documentation only
- `chore` — tooling, config, or misc maintenance

## 3. Spec-first development

Frapp is explicitly **spec-driven**:

1. Update specs in `spec/` first:
   - `spec/product.md` — high-level product view
   - `spec/behavior.md` — feature behavior and edge cases
   - `spec/architecture.md` — system/data model
2. Only then implement the behavior in:
   - `apps/api` (API)
   - `apps/web` / `apps/mobile` (UI)
3. Update **`docs/`** (e.g. [`docs/guides/`](README.md)) when developer-facing workflow or setup changes.

> **Note:** If you ever notice the implementation and specs diverging, treat it as a bug. Either update the code to match the spec, or revise the spec and document the change.

## 4. Pull requests

When opening a PR:

- Link to the relevant spec sections you implemented.
- Describe changes in terms of **behavior** and **domains** (e.g. "Backwork upload metadata", not "added 3 columns").
- List test coverage: unit tests, E2E, and any manual scenarios you ran.
- Call out any follow-up work or tech debt explicitly.
- Fill out the **Docs / Spec impact** section (from the PR template). If you claim "None", reviewers should treat that as a strong assertion.

PR targets:

- Feature work: `feature/*` → `main`
- Production promotion: `main` → `production`

## 5. Linting, types, and tests

Before pushing:

```bash
npm run lint
npm run lint:api    # optional API-only lint run
npm run check-types
npm test            # in apps/api
```

In CI, we also run:

- `npm run lint`
- `npm run check-types`
- `npm run build`
- API unit tests and (eventually) E2E against a fresh Supabase instance

## 6. Documentation obligations

- If you change **behavior** — update `spec/behavior.md`.
- If you change **data model** — update `spec/architecture.md`.
- If you change **developer workflow** — update the relevant file under **`docs/guides/`** (or another path under `docs/` if it is operator-only).

> **Warning:** Out-of-date documentation is a real bug. When in doubt, fix the docs in the same PR as the implementation change.

### CI enforcement (`scripts/check-docs-impact.mjs`)

PRs that change files **outside** `docs/`, `spec/`, and `apps/docs/` must also change **at least one** file under **`docs/`**, **`spec/`**, or **`apps/docs/`**. Prefer updating **`docs/`** (e.g. `docs/guides/`) and **`spec/`**; touching `apps/docs/` alone also passes the check but the docs site content is frozen.

See also [`docs/internal/DOCS_CI.md`](../internal/DOCS_CI.md) for rationale and optional future tightening of the gate.
