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
| Docs            | 3005  | http://localhost:3005      |
| Supabase Studio | 54323 | http://127.0.0.1:54323     |

## Per-app commands (only if you are not using `dev:stack`)

| App     | With Infisical        | Without Infisical               |
| ------- | --------------------- | ------------------------------- |
| API     | `npm run dev:api`     | `npm run start:dev -w apps/api` |
| Web     | `npm run dev:web`     | `npm run dev -w apps/web`       |
| Landing | `npm run dev:landing` | `npm run dev -w apps/landing`   |
| Docs    | `npm run dev:docs`    | `npm run dev -w apps/docs`      |

## `dev:stack` vs separate terminals

- **`npm run dev:stack`** — default; one `infisical run` runs API + web + landing + docs via `concurrently` (prefixed, color-coded logs). Ctrl+C stops all four.
- **Separate `npm run dev:*`** — use when you want one process per terminal or to run a subset.

`npm run dev` at the root runs **Turbo `dev` only for workspaces that define a `dev` script** (web, landing, docs). The API uses `start:dev`, not `dev`, so it is **not** included in plain `turbo run dev`. Use `dev:stack` or run the API explicitly.

## Mobile

```bash
npm run dev:mobile
```

Requires Expo Go on a device or emulator; not usable on typical headless VMs.

## Fallback without Infisical

Build `.env.local` per app using `npx supabase status -o env` and [`ENV_REFERENCE.md`](./ENV_REFERENCE.md). Then run the “Without Infisical” commands in the table above. NestJS reads `.env.local` then `.env`.

## Related docs

- [`SECRETS_MANAGEMENT.md`](./SECRETS_MANAGEMENT.md) — Infisical project, syncs, login
- [`ENV_REFERENCE.md`](./ENV_REFERENCE.md) — variable list per app
- [`AGENTS.md`](../../AGENTS.md) — agent-oriented repo rules (short index)
