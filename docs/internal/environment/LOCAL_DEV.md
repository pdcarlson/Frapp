# Local development

> The **primary** dev environment is the Claude Code web sandbox — see
> [`CLOUD_SANDBOX.md`](./CLOUD_SANDBOX.md). This file is the **secondary** path: running
> Frapp on a laptop/local machine.

**Canonical run command (after bootstrap + Infisical login):** from the repo root,

```bash
npm run dev:stack
```

This is what `scripts/local-dev-setup.sh` prints at the end. For step-by-step setup, see **[`docs/guides/getting-started.md`](../../guides/getting-started.md)**. This file is the **single place** for alternatives (per-app terminals, no Infisical, mobile, Turbo quirks, URLs).

Bootstrap Supabase + deps: [`scripts/local-dev-setup.sh`](../../../scripts/local-dev-setup.sh) from the repo root.

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

## Claude Code web sandbox

The primary, automated environment. Full config (setup script, env vars, network policy),
auto-bringup, and failure troubleshooting live in [`CLOUD_SANDBOX.md`](./CLOUD_SANDBOX.md).
It generates `apps/api/.env.local` so the API boots without Infisical.

## SWC builder for API dev server

The API has `@swc/cli` and `@swc/core` as devDependencies, enabling the `--builder swc` flag for `nest start`. This transpiles without type-checking, which is useful when the default tsc watcher is blocked by transient type errors. Usage:

```bash
npx -w apps/api nest start --watch --builder swc
```

For type safety, run `npm run check-types` separately. The cloud-sandbox fallback in [`CLOUD_SANDBOX.md`](./CLOUD_SANDBOX.md) also uses this.

## Web visual regression suite

`apps/web/playwright.config.ts` boots `npm run dev` with benign fallbacks for
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and
`NEXT_PUBLIC_API_URL` when no real values are in the shell. Real values always
win — the defaults are only used to let CI capture baselines without
credentials. See [`apps/web/tests/visual/README.md`](../../../apps/web/tests/visual/README.md)
for the rationale and for how to refresh snapshots locally.

When GitHub’s **`web-visual-regression`** job fails, refresh from `apps/web`
with the same **`CI=true`** Playwright uses in CI:
`CI=true npx playwright test --update-snapshots`, then commit the updated
`*-snapshots/*-linux.png` files.

**Check the browser revision first — `CI=true` alone is not enough.** Playwright
pins a Chromium build, and a baseline regenerated on any other build drifts past
the 0.01 `maxDiffPixelRatio` and is a wrong fixture even when it happens to pass.
The cloud sandbox pre-installs revision **1194** at
`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`, which Playwright 1.60 refuses to
launch; forcing it produced **8 spurious failures of 16** on routes CI passes.
Run `npx playwright install chromium` to fetch the pinned revision (1223 as of
1.60.0) before regenerating, and confirm the rest of the suite still passes.
Once on the right build, this sandbox reproduces CI's results exactly.

**When you cannot regenerate locally**, the `web-visual-regression` job uploads
`apps/web/test-results/` and `apps/web/playwright-report/` as the
`playwright-visual-results` artifact on failure (14-day retention). It contains
each failing route's `-actual.png` and `-diff.png`, rendered by CI's own browser
— download and commit the `-actual` as the new baseline, or open the bundled
HTML report with `npx playwright show-report`. Before that artifact existed, a
failure printed only image dimensions and a diff ratio, so the render itself was
unreachable (#936).

Note the job is path-gated: it runs on every push to `main`, and on pull
requests only when the `web` filter matches (`apps/web/**`, `packages/**`,
`package-lock.json`, `turbo.json`), so a docs- or API-only PR skips it.

Every regenerated baseline needs a per-route attestation in
[`apps/web/tests/visual/README.md`](../../../apps/web/tests/visual/README.md)
recording why it moved and the Chromium revision used.

`apps/web/proxy.ts` (Next.js 16 middleware) reads Supabase env per request and
falls back to passthrough when the vars are missing, so the module is safe to
import in the visual-regression environment.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| API logs `42501 permission denied for table <name>` and `/health` reports `{"database":"error"}` / `degraded`, on a bootstrap that otherwise succeeded | The pinned `supabase/postgres` image (17.6.x) ships a default ACL for role `postgres` in schema `public` granting `anon`/`authenticated`/`service_role` only `Dxtm` — the DML bits `arwd` are missing. `supabase db push` applies migrations as `postgres`, so every table inherits it. **Not** cleared by `supabase db reset --local`: a reset rebuilds from the same template, reintroducing the defect and dropping the repair | **Already handled by `local-dev-setup.sh`** — it repairs the ACLs right after `db push`. **Re-run `bash scripts/local-dev-setup.sh --quick` after any `supabase db reset --local`**, which is the usual way this reappears. Confirm with `select defaclacl from pg_default_acl where pg_get_userbyid(defaclrole)='postgres' and defaclnamespace::regnamespace::text='public' and defaclobjtype='r';` — healthy shows `anon=arwdDxtm/postgres`, broken shows `anon=Dxtm/postgres`. The repair deliberately never grants function `EXECUTE` (the RPC migrations lock that down explicitly) |
| `local-dev-setup.sh` reports a Postgres **data directory / engine major-version mismatch** and suggests `--reset-supabase-data`, but your database is fine | You were running a second Supabase stack, and the hint read *that* container's logs | Fixed — resolution requires an **exact** name match for this project and never substitutes another stack, not even when it is the only one running. If you instead see `No container named supabase_db_<project> for this project`, that is the guard working: this project's container does not exist, so no version diagnosis is offered. Stop the unrelated stack, or fix why this project's container is missing |
| `No container named supabase_db_<project> for this project` during the ACL repair | This project's container is absent or named differently, and other stacks are present | Start this project's stack, or set `project_id` in `supabase/config.toml` — the resolver reads it (falling back to the directory name), so a `project_id` gives this project an unambiguous container name. The CLI only applies a new `project_id` on the next `supabase start`, so stop and restart the stack after changing it |
| The bootstrap exits at *Repairing local Postgres default ACLs* and you need to finish anyway | Container could not be identified, or the repair failed | Set `FRAPP_SKIP_ACL_REPAIR=1` to complete the bootstrap without it. The stack still comes up; only the grants are missing, so the API boots and then fails queries with `42501`. Apply the repair by hand afterwards (see [`CLOUD_SANDBOX.md`](./CLOUD_SANDBOX.md#manual--fallback-bringup) for the SQL) |

The ACL repair and the container resolution both live in
[`scripts/lib/local-postgres-acl.sh`](../../../scripts/lib/local-postgres-acl.sh), shared with the
cloud sandbox's [`cloud-sandbox-up.sh`](../../../scripts/cloud-sandbox-up.sh) so the two bootstrap
paths cannot drift. Its behaviour is pinned by
[`local-postgres-acl.test.sh`](../../../scripts/lib/local-postgres-acl.test.sh) — hermetic (docker
is stubbed, no daemon or database needed), run it with
`bash scripts/lib/local-postgres-acl.test.sh`. **No CI job runs it yet.** Sandbox-specific failures (network policy, image registry, sentinels) are in
[`CLOUD_SANDBOX.md`](./CLOUD_SANDBOX.md#when-bringup-fails--stop-and-report).

## Related docs

- [`CLOUD_SANDBOX.md`](./CLOUD_SANDBOX.md) — Claude Code web sandbox (primary dev env)
- [`SECRETS_MANAGEMENT.md`](./SECRETS_MANAGEMENT.md) — Infisical project, syncs, login
- [`ENV_REFERENCE.md`](./ENV_REFERENCE.md) — variable list per app
- [`AGENT_CREDENTIALS.md`](./AGENT_CREDENTIALS.md) — agent/provider creds + cloud-sandbox vars
- [`AGENTS.md`](../../../AGENTS.md) — agent-oriented repo rules (short index)
