# Contributing

This guide defines how we work on Frapp: branch workflow, commit messages, and spec-driven development. **`spec/` is the source of truth for intended behavior; code is the source of truth for current behavior.** Disagreement is a tracked bug — see [`AGENTS.md`](../../AGENTS.md) § Spec vs code.

## 1. Branching model

The branch model — `main` as the only long-lived branch and what a merge to it deploys,
`feature/*` and `hotfix/*` off it, the `production` branch retired in #1340, and the flow
from feature PR to a named-commit production deploy — lives in
[`CONTRIBUTING.md`](../../CONTRIBUTING.md) § Branch Model. The gates that deploy passes
through: [`docs/internal/ops/DEPLOYMENT.md`](../internal/ops/DEPLOYMENT.md) § How Deployments Are Gated.

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
   - `spec/product/` — high-level product view (folder of topic files; start at `README.md`)
   - `spec/behavior/` — feature behavior and edge cases (folder of topic files; start at `README.md`)
   - `spec/architecture/README.md` — system/data model
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
- Production: no PR. Dispatch **Deploy production** with a SHA that is already on `main`.
- **Never** another feature branch. `pull_request.branches` is only `[main]`, so a
  stacked PR skips CI and a squash-merge can show MERGED while `origin/main` never receives the
  work. Playbook: [`docs/internal/ci-cd/AGENT_INFRA.md`](../internal/ci-cd/AGENT_INFRA.md#ci-branch-filters-never-target-a-feature-branch)
  (incidents #1120, #1123–#1125). Re-land by cherry-pick onto `origin/main`.

## 5. Linting, types, and tests

Before pushing:

```bash
npm run lint        # read-only, every workspace
npm run lint:api    # optional API-only lint run (read-only; fix with `npm run lint:api:fix`)
npm run check-types
npm test            # in apps/api
```

These work **from a clean checkout** — `npm install && npm run check-types` is enough, with no
manual package build first. The shared packages under `packages/` publish their types as
`dist/index.d.ts`, and `dist/` is gitignored, so a consumer that resolves the `types` condition
(`apps/api`, via `NodeNext`) cannot see them until those packages are built. Root `turbo.json`
handles that by making `check-types` and `lint` depend on `^build`:

```jsonc
"lint":        { "dependsOn": ["^build"] },
"check-types": { "dependsOn": ["^build"] }
```

Depending on `^check-types` / `^lint` instead is the trap: turbo then orders the tasks correctly but
never produces the `dist/` outputs they read, so a fresh clone fails with `TS2307: Cannot find module
'@repo/validation'` (and friends) until you manually run `npx turbo run build --filter='./packages/*'`.
`apps/web` masks it — `moduleResolution: "Bundler"` picks the `import` condition and resolves straight
to source — so the breakage shows up only in `apps/api`. The CI job `clean-checkout-typecheck` guards
this: it installs and runs both checks with nothing prebuilt, so a regression here fails there while
every other job (all of which prebuild the packages) stays green.

This applies to the **root** scripts, which go through turbo. A single-workspace invocation such as
`npm run check-types -w apps/api` bypasses turbo and runs `tsc` directly, so on a cold clone it still
fails until the packages exist — run the root script once (or `npx turbo run build --filter='./packages/*'`)
before reaching for the `-w` form.

Type-checking runs TypeScript 7's native `tsc`. The package named `typescript` is the TypeScript
6 compiler API (`npm:@typescript/typescript6`), which Nest, `typescript-eslint`, and `ts-jest`
still import. Do not replace that alias with `typescript@7` — see
[`docs/internal/ci-cd/AGENT_INFRA.md`](../internal/ci-cd/AGENT_INFRA.md) § TypeScript 7.

`npm run lint` is **read-only** in every workspace — it reports violations and never edits your
files, so it is safe in CI and in read-only audits. To apply ESLint's auto-fixes in `apps/api`, run
the explicit fix script instead:

```bash
npm run lint:api:fix        # or: npm run lint:fix -w apps/api
```

`apps/api` is the only workspace with a fix script; everywhere else, resolve the reported
violations by hand (or with your editor's ESLint integration).

Shared React lint (`@repo/eslint-config/next-js` and `react-internal`) takes an **allowlist**
from `eslint-plugin-react-hooks` v7 `recommended` (core Rules of Hooks plus every
compiler rule in that preset). New compiler rules that appear in a later plugin
bump stay `"off"` until a dedicated cleanup — see
[`docs/internal/ci-cd/AGENT_INFRA.md`](../internal/ci-cd/AGENT_INFRA.md) § eslint-plugin-react-hooks 7.

Keep `--fix` out of any `lint` script. Under `apps/api`'s config `prettier/prettier` is an
**error**, and every Prettier violation is auto-fixable — so a `lint` script carrying `--fix`
repairs the error, exits `0`, and the failure never reaches CI (the repaired file is discarded
with the runner).

In CI, we also run:

- `npm run lint`
- `npm run check-types`
- `npm run build`
- API unit **and E2E** tests (the `api-tests` job runs both; the E2E suite boots the app with a
  mocked Supabase client — no live services)

## 6. Documentation obligations

- If you change **behavior** — update the appropriate topic file under `spec/behavior/`.
- If you change **data model** — update `spec/architecture/README.md`.
- If you change **developer workflow** — update the relevant file under **`docs/guides/`** (or another path under `docs/` if it is operator-only).

> **Warning:** Out-of-date documentation is a real bug. Spec-vs-code disagreement is a tracked bug, not silent discretion — file it or fix the stale side in the same PR. When in doubt, fix the docs in the same PR as the implementation change.

### What CI checks

No check requires you to touch a doc — the one that did was deleted in #1597 because it could only see that *some* doc moved, not whether it was the right one, so it was cheapest to satisfy with filler. What CI does check is that cited paths resolve, files sit in a declared home, and hand-copied rosters match their source.

See [`docs/internal/ci-cd/DOCS_CI.md`](../internal/ci-cd/DOCS_CI.md).
