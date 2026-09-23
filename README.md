# Signet

**Chat is the spine.** Signet is a multi-tenant chat app for Greek-letter organizations in which
every other capability — events, tasks, dues, points, polls — is a *chat integration*, surfaced
inline in the conversation rather than parked behind its own nav tab. Chat itself is free,
unlimited, and non-optional: it is the default landing route on web and mobile.

Tiers, audience, vocabulary, and the rest of the positioning live in
[`spec/product/positioning.md`](spec/product/positioning.md).

## Modules are chat integrations

An ops module ships as the same four surfaces rather than as a bespoke feature:

- a **slash command** in the composer — the primary way members create and act on artifacts;
- one or more **rich message renderers**, keyed off the artifact `kind`;
- a **system channel** (`#events`, `#dues`, …) where the module's system messages land;
- an **optional dashboard view** — only when a calendar, kanban, or leaderboard materially adds
  something, and always secondary to chat.

Modules are gated per chapter, and the gating rules have qualifiers worth reading before you write a
check against them — absence is not disablement, and the always-on lock is a UI lock. They are
stated once, in [`spec/behavior/integrations.md`](spec/behavior/integrations.md) § Module Gating.

Which modules exist is `MODULE_CATALOG` in
[`packages/org-archetypes`](packages/org-archetypes); the pattern and the invariants every renderer
must honour are in [`spec/behavior/integrations.md`](spec/behavior/integrations.md). Those two
disagree today — the spec's prose roster omits two modules that ship slash commands, tracked as
[#2468](https://github.com/pdcarlson/Frapp/issues/2468) — so read the catalog as the mechanism and
the spec as the pattern.

## AI

Signet's AI surface (Q&A, summarization, drafting) is built on **authoritative sources only**, and
that is the product decision rather than an implementation detail — a smaller AI that is reliably
right instead of a bigger one that is frequently embarrassing.

Stable prose is indexed and retrieved: meeting minutes and transcripts, uploaded chapter documents,
and formal announcements. Live structured data — officer roster, events, dues amounts, points
balances, attendance — is **never embedded**; the model reads it at answer time through the same
permission-guarded API endpoints the rest of the product uses, so structured answers are correct
when given and inherit the caller's permissions. In v1 the chapter chat sits deliberately outside
the corpus — casual channels are not indexed, and DMs never are regardless of channel settings —
with a v2+ revisit explicitly reserved. Vault documents are excluded by default, and every answer
must cite its source inline.

**It is specified, not shipped.** There is no `ai` module in `apps/api`. On web the ✦ Ask entry is
a shell with no engine behind it. On mobile Ask exists only when a build flag is set, and then it is
a sheet that answers from a synthetic corpus. With the flag off, which is the default, there is no
Ask at all: no ✦ pill, no sheet, and a `frapp://ask` link redirects to Chat home. Nothing in this
repo sets that flag (a test fails if an `eas.json` profile does), and an EAS production build
refuses to build with it on, so a store binary cannot ship Ask; preview and development builds
are not fenced ([`ENV_REFERENCE.md`](docs/internal/environment/ENV_REFERENCE.md)). Scope, non-goals, the citation
mechanism, and how the mock deliberately differs from the real contract:
[`spec/behavior/ai.md`](spec/behavior/ai.md).

## Repository Structure

```
apps/
  api/        — NestJS backend (REST + WebSockets)
  web/        — Next.js admin dashboard (app.frapp.live)
  mobile/     — Expo mobile app (iOS + Android)
  landing/    — Next.js marketing site (frapp.live)
packages/     — shared workspaces (`@repo/*`): API SDK, chat hot path, theme, hooks, validation, …
spec/         — Product spec, behavior spec, architecture, environments
supabase/     — Supabase project config + migrations
docs/         — Developer guides and runbooks (no Next.js docs app)
```

The per-package inventory lives in
[`spec/architecture/README.md` § 4](spec/architecture/README.md#4-shared-packages), not here. The
hand-written copy this file used to carry had drifted on two of its fourteen entries, which is the
argument against keeping a second one.

## Tech Stack

Turborepo + npm workspaces. NestJS (TypeScript, strict) on the API; Next.js App Router with Tailwind
and ShadCN UI on web and landing; Expo / React Native with Expo Router and RN `StyleSheet` on
mobile. Postgres, auth, storage, and realtime are all Supabase. Billing is Stripe; push is the Expo
Push Service; CI/CD is GitHub Actions with Vercel and EAS.

The canonical table is
[`spec/architecture/README.md` § 1](spec/architecture/README.md#1-high-level-stack).

## A note on the two names

The product is **Signet**. Code identifiers, the root npm package name, the Expo `slug`, the iOS
bundle id (`live.frapp.mobile`), and the domains are all still `frapp` — and that split is a binding
rule, not an oversight: prose says Signet, identifiers stay `frapp` until the deferred rename. It is
stated once, in [`spec/ui/brand-identity.md`](spec/ui/brand-identity.md), which also says the
rename's own tracking belongs in GitHub Issues rather than in a doc. Treat the two names as one
product, and do not "fix" a `frapp` identifier on sight.

## Spec-Driven Development

All product decisions, behavior rules, and architecture are documented in the `spec/` directory:

- **[spec/product/](spec/product/README.md)** — Features, user flows, surfaces, onboarding.
- **[spec/behavior/](spec/behavior/README.md)** — Rules, edge cases, invariants, error handling.
- **[spec/architecture/README.md](spec/architecture/README.md)** — Stack, data model, auth, storage, API contracts.
- **[spec/environments/README.md](spec/environments/README.md)** — Local, staging, production setup; CI/CD.

**`spec/` is the source of truth for intended behavior. Code is the source of truth for current behavior.** Disagreement between them is a tracked bug to file, not something an agent silently resolves by picking whichever loaded first. See [`AGENTS.md`](AGENTS.md) § Spec vs code.

**Documentation map (guides + runbooks + how they relate to spec):** [docs/README.md](docs/README.md).

## Quick Start

**Bootstrap Supabase + deps (WSL/Linux, Docker running):**

```bash
bash scripts/local-dev-setup.sh
```

If local Supabase containers are stuck or exited: `bash scripts/local-dev-setup.sh --reset-supabase`. If Postgres fails with **incompatible data directory** (e.g. after a CLI / `major_version` bump), wipe local volumes once: `bash scripts/local-dev-setup.sh --reset-supabase-data`. Full walkthrough: [docs/guides/getting-started.md](docs/guides/getting-started.md) and `bash scripts/local-dev-setup.sh --help`.

**Run all app dev servers (default):** from the repo root, after `npx infisical login` once — see [docs/internal/environment/SECRETS_MANAGEMENT.md](docs/internal/environment/SECRETS_MANAGEMENT.md):

```bash
npm run dev:stack
```

Per-app commands, no-Infisical fallback, mobile, and URLs: **[docs/internal/environment/LOCAL_DEV.md](docs/internal/environment/LOCAL_DEV.md)** (single reference for anything beyond `dev:stack`).

See [spec/environments/README.md](spec/environments/README.md) for environment model and variables.
