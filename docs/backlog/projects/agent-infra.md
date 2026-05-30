# Agent infrastructure (hot-path verification)

**Status:** active (research complete; implementation pending decision)
**Epic:** [#401 — cloud-agent sandbox cannot exercise the Supabase hot path](https://github.com/pdcarlson/Frapp/issues/401)
**Spec:** [`docs/internal/ci-cd/AGENT_INFRA.md`](../../internal/ci-cd/AGENT_INFRA.md); ADR to land in [`spec/architecture/`](../../../spec/architecture/)
**Updated:** 2026-05-30

> P0 program-level blocker: cloud-agent sandboxes can't apply migrations / run Edge Functions /
> observe Realtime / exercise the push worker, so chat-adjacent chunks ship with unverified runtime
> paths. Two asks: (1) CI-side pre-merge verification, (2) in-loop verification for the agent.

## Work units

> All four research spikes are **closed/completed**; each delivered a recommendation comment on #401.
> The remaining work is to pick the in-loop path + CI path, land an ADR, and document the workflow.

| Unit | Issue | State | Notes |
| ---- | ----- | ----- | ----- |
| Path A research: Supabase branches per agent session | [#411](https://github.com/pdcarlson/Frapp/issues/411) | closed | most architecturally compatible |
| Path B research: rootless Supabase stack in sandbox | [#412](https://github.com/pdcarlson/Frapp/issues/412) | closed | likely no-go on maintenance cost |
| Path C research: PGlite + Deno harness | [#413](https://github.com/pdcarlson/Frapp/issues/413) | closed | cheap supplemental win |
| Path D research: move logic out of Edge Functions | [#414](https://github.com/pdcarlson/Frapp/issues/414) | closed | revisits ADR-01 |
| **Decision + ADR + AGENT_INFRA workflow** | #401 | open | pick in-loop + CI paths; land ADR; update `AGENT_INFRA.md` |

## Notes / decisions

- #235 (Postgres-in-CI migration verification) is referenced by #401 as "subsumed / scope down to CI
  migration verification only" — confirm and re-link during triage (state UNVERIFIED in seed).
- CI-side candidates to reconcile during triage: #356 (migrations apply on fresh DB), #360 (RLS
  coverage), #322/#380 (Edge Function tests), #423 (PGlite RLS smoke), #424 (Edge Function spike).
