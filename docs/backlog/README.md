# Frapp backlog

**The single source of truth for work status across Frapp.** Work is organized as
**Frapp → projects → work units → GitHub issues**. GitHub issues *mirror* this backlog; when the two
disagree, **the repo wins** and the issue is brought into line (run `/triage`).

> Status model (solo project): an issue's **open/closed state is its status** — no "In Review" stage,
> no GitHub Projects board. PRs close their issue with `Closes #N`.

## Projects

| Project | Status | Epic | Progress |
| ------- | ------ | ---- | -------- |
| [Chat rework](projects/chat-rework.md) | active | [#426](https://github.com/pdcarlson/Frapp/issues/426) | 6 of 12 chunks shipped (01–06); 07 in progress (07a/07b/07c/07d shipped; 07e queued); 10b/10c shipped; rest of 08–12 queued |
| [Analytics](projects/analytics.md) | active | [#431](https://github.com/pdcarlson/Frapp/issues/431) | pipeline (#464) shipped; opt-out toggle (#466) shipped (Settings → Privacy); salt mgmt (#465) + membership/opt-out enforcement (#551) queued |
| [Pricing & billing](projects/billing.md) | queued | [#429](https://github.com/pdcarlson/Frapp/issues/429) | 0 of 4 units (blocked on pricing analysis) |
| [Agent infrastructure](projects/agent-infra.md) | active | [#401](https://github.com/pdcarlson/Frapp/issues/401) | research done (4 spikes closed); ADR-12 landed (#401 closed); PGlite RLS-smoke CI job shipped (#531, subsumes #356/#360); #532/#533 + #423 follow-up queued |

Un-projected work lives in [`_meta/general.md`](_meta/general.md) — includes the AI (#427), Vault
(#428), Save/Pin+Bookmark (#430), and Spec-maintenance (#432) feature epics plus the general backlog.

## Overall

- **240 open issues** across the repo (verified via API search on 2026-05-31, after this triage run
  closed 15 and concurrent merges closed #466; see the caveat in `general.md`).
- **8 epics:** #401 (closed — ADR-12 landed), #426, #427, #428, #429, #430, #431, #432 (7 still open).
- Run [`/status`](../../.claude/commands/) for a live per-project + overall rollup, and [`/triage`](../../.claude/commands/)
  (also runs at session start) to reconcile GitHub into this backlog.

## How this folder works

- [`projects/`](projects/) — one markdown file per project. **Nothing else goes here.**
- [`_meta/`](_meta/) — [`_TEMPLATE.md`](_meta/_TEMPLATE.md) (copy to start a project),
  [`general.md`](_meta/general.md) (un-projected backlog), [`conventions.md`](_meta/conventions.md)
  (the full rules: repo-wins, seeding, how to add a project).

Canonical product/behavior/architecture spec lives in [`spec/`](../../spec/), not here — the backlog
tracks *work* and links out to the real spec a unit implements.
