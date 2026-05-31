# Agent infrastructure (hot-path verification)

**Status:** active (decision recorded as ADR-12; implementation follow-ups filed)
**Epic:** [#401 — cloud-agent sandbox cannot exercise the Supabase hot path](https://github.com/pdcarlson/Frapp/issues/401)
**Spec:** [`docs/internal/ci-cd/AGENT_INFRA.md`](../../internal/ci-cd/AGENT_INFRA.md); decision in [ADR-12](../../../spec/architecture/README.md)
**Updated:** 2026-05-31

> P0 program-level blocker: cloud-agent sandboxes can't apply migrations / run Edge Functions /
> observe Realtime / exercise the push worker, so chat-adjacent chunks ship with unverified runtime
> paths. Two asks: (1) CI-side pre-merge verification, (2) in-loop verification for the agent.

## Work units

> All four research spikes are **closed/completed**; each delivered a recommendation comment on #401.
> The decision is recorded as **[ADR-12](../../../spec/architecture/README.md)** (C+D default substrate,
> A opt-in escape hatch, B rejected). Implementation is now split into three follow-up units below.

| Unit | Issue | State | Notes |
| ---- | ----- | ----- | ----- |
| Path A research: Supabase branches per agent session | [#411](https://github.com/pdcarlson/Frapp/issues/411) | closed | adopted as opt-in escape hatch |
| Path B research: rootless Supabase stack in sandbox | [#412](https://github.com/pdcarlson/Frapp/issues/412) | closed | rejected (maintenance/flakiness) |
| Path C research: PGlite + Deno harness | [#413](https://github.com/pdcarlson/Frapp/issues/413) | closed | adopted as CI + in-loop substrate |
| Path D research: move logic out of Edge Functions | [#414](https://github.com/pdcarlson/Frapp/issues/414) | closed | adopted as strategic direction (ADR-11) |
| **Decision + ADR-12 + AGENT_INFRA workflow** | [#401](https://github.com/pdcarlson/Frapp/issues/401) | open | closes on the ADR-12 PR (`Closes #401`) |
| Impl: PGlite migration + RLS CI job (Path C) | [#531](https://github.com/pdcarlson/Frapp/issues/531) | shipped | RLS smoke tier added to `pglite-migrations` (every-table-RLS invariant + chat hot-path posture). Subsumes #356 (fresh-DB apply, already shipped) + #360 (RLS-enabled coverage); #235 subsumed → CI-only. #423 (authenticated enforcement smoke) is the follow-up |
| Impl: Path A SessionEnd teardown + scoped MCP allowlist | [#532](https://github.com/pdcarlson/Frapp/issues/532) | open | opt-in branch-per-session; off by default |
| Impl: continue Edge→NestJS hot-path migration | [#533](https://github.com/pdcarlson/Frapp/issues/533) | open | follow-on to ADR-11/#425; relates #417/#470 |

## Notes / decisions

- **ADR-12** (`spec/architecture/README.md`) records the decision: C (PGlite) + D (NestJS logic) are
  the default substrate (CI + in-loop, no daemon); A (Supabase branch/session) is the opt-in escape
  hatch with SessionEnd teardown and denylisted MCP writes by default; B (rootless stack) is rejected.
- #235 (Postgres-in-CI migration verification) is **subsumed → CI migration verification only** (per
  #401); the PGlite CI job (#531) owns it. #356 (migrations on fresh DB) and #360 (RLS-enabled
  coverage) shipped with #531 — the `pglite-migrations` job applies every migration to fresh PGlite
  and asserts the every-table-RLS invariant + chat hot-path posture, so both are closed. #423
  (authenticated-role RLS *enforcement* smoke — `SET ROLE authenticated` + real JWT) stays open as the
  follow-up: it's a distinct capability partly in tension with ADR-11's "presence, not enforcement"
  scope and narrow in today's policy-less default-deny schema.
- Still un-reconciled CI candidates (separate from the ADR-12 follow-ups): #322/#380 (Edge Function
  tests), #424 (Edge Function deprecation spike) — revisit alongside the Edge→NestJS migration (#533).
