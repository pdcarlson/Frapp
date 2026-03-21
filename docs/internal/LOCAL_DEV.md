# Local development

How to run Frapp on your machine after Docker and Supabase are up. Bootstrap first with [`scripts/local-dev-setup.sh`](../../scripts/local-dev-setup.sh) from the repo root (see also the published guide under **Getting started** in `apps/docs`).

## Infisical (primary path)

Root scripts wrap apps with `npx infisical run --env=local --path=/` so secrets come from Infisical’s **`local`** environment — no committed `.env.local` files.

1. **One-time CLI auth:** `npx infisical login` (from repo root is fine).
2. **Populate `local` in Infisical** with values that match local Supabase (`npx supabase status -o env`) plus Stripe/Sentry and other keys listed in [`ENV_REFERENCE.md`](./ENV_REFERENCE.md). Full setup: [`SECRETS_MANAGEMENT.md`](./SECRETS_MANAGEMENT.md).

If `infisical run` fails (no session, wrong project, or API key without `local` access), use the **fallback** below.

## Ports and commands

| Service        | Port  | With Infisical              | Without Infisical                    |
| -------------- | ----- | --------------------------- | ------------------------------------ |
| API (NestJS)   | 3001  | `npm run dev:api`           | `npm run start:dev -w apps/api`      |
| Web            | 3000  | `npm run dev:web`           | `npm run dev -w apps/web`            |
| Landing        | 3002  | `npm run dev:landing`       | `npm run dev -w apps/landing`        |
| Docs           | 3005  | `npm run dev:docs`          | `npm run dev -w apps/docs`           |
| Supabase Studio | 54323 | (from `npx supabase start`) | Same                                 |

Swagger: `http://localhost:3001/docs`.

## One command vs multiple terminals

- **`npm run dev:stack`** — single terminal; one `infisical run` parents API + web + landing + docs via `concurrently` with named, color-coded log prefixes. Stopping the process stops all four. Logs are interleaved (prefixes keep them readable).
- **Separate `npm run dev:*` terminals** — clearer isolation and independent restarts; use when you only need one app.

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
