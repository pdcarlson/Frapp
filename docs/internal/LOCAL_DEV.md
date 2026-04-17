# Local development

**Canonical run command (after bootstrap + Infisical login):** from the repo root,

```bash
npm run dev:stack
```

This is what `scripts/local-dev-setup.sh` prints at the end. For step-by-step setup, see **[`docs/guides/getting-started.md`](../guides/getting-started.md)**. This file is the **single place** for alternatives (per-app terminals, no Infisical, mobile, Turbo quirks, URLs).

Bootstrap Supabase + deps: [`scripts/local-dev-setup.sh`](../../scripts/local-dev-setup.sh) from the repo root.

## Infisical (primary path)

Root scripts wrap apps with `npx infisical run --env=local --path=/` so secrets come from Infisical’s **`local`** environment — no committed `.env.local` files.

1. **One-time CLI auth:** `npx infisical login` (from repo root is fine).
2. **Populate `local` in Infisical** with values that match local Supabase (`npx supabase status -o env`) plus Stripe/Sentry and other keys listed in [`ENV_REFERENCE.md`](./ENV_REFERENCE.md). Full setup: [`SECRETS_MANAGEMENT.md`](./SECRETS_MANAGEMENT.md).

If `infisical run` fails (no session, wrong project, or API key without `local` access), use the **fallback** below.

## Ports and URLs

| Service         | Port  | URL                        |
| --------------- | ----- | -------------------------- |
| Web             | 3000  | http://localhost:3000      |
| API             | 3001  | http://localhost:3001      |
| Swagger         | —     | http://localhost:3001/docs |
| Landing         | 3002  | http://localhost:3002      |
| Supabase Studio | 54323 | http://127.0.0.1:54323     |

## Per-app commands (only if you are not using `dev:stack`)

| App     | With Infisical        | Without Infisical               |
| ------- | --------------------- | ------------------------------- |
| API     | `npm run dev:api`     | `npm run start:dev -w apps/api` |
| Web     | `npm run dev:web`     | `npm run dev -w apps/web`       |
| Landing | `npm run dev:landing` | `npm run dev -w apps/landing`   |

## `dev:stack` vs separate terminals

- **`npm run dev:stack`** — default; one `infisical run` runs API + web + landing via `concurrently` (prefixed, color-coded logs). Ctrl+C stops all three app processes (plus the parent).
- **Separate `npm run dev:*`** — use when you want one process per terminal or to run a subset.

`npm run dev` at the root runs **Turbo `dev` only for workspaces that define a `dev` script** (web, landing). The API uses `start:dev`, not `dev`, so it is **not** included in plain `turbo run dev`. Use `dev:stack` or run the API explicitly.

## Mobile

```bash
npm run dev:mobile
```

Requires Expo Go on a device or emulator; not usable on typical headless VMs.

## Fallback without Infisical

Build `.env.local` per app using `npx supabase status -o env` and [`ENV_REFERENCE.md`](./ENV_REFERENCE.md). Then run the “Without Infisical” commands in the table above. NestJS reads `.env.local` then `.env`.

## SWC builder for API dev server

The API has `@swc/cli` and `@swc/core` as devDependencies, enabling the `--builder swc` flag for `nest start`. This transpiles without type-checking, which is useful when the default tsc watcher is blocked by transient type errors. Usage:

```bash
npx -w apps/api nest start --watch --builder swc
```

For type safety, run `npm run check-types` separately. Cloud agent instructions in [`AGENTS.md`](../../AGENTS.md) reference this workaround.

## Web visual regression suite

`apps/web/playwright.config.ts` boots `npm run dev` with benign fallbacks for
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and
`NEXT_PUBLIC_API_URL` when no real values are in the shell. Real values always
win — the defaults are only used to let CI capture baselines without
credentials. See [`apps/web/tests/visual/README.md`](../../apps/web/tests/visual/README.md)
for the rationale and for how to refresh snapshots locally.

`apps/web/proxy.ts` (Next.js 16 middleware) reads Supabase env per request and
falls back to passthrough when the vars are missing, so the module is safe to
import in the visual-regression environment.

## Related docs

- [`SECRETS_MANAGEMENT.md`](./SECRETS_MANAGEMENT.md) — Infisical project, syncs, login
- [`ENV_REFERENCE.md`](./ENV_REFERENCE.md) — variable list per app
- [`AGENTS.md`](../../AGENTS.md) — agent-oriented repo rules (short index)
