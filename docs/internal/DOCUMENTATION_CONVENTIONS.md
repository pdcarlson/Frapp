# Documentation conventions — placement map

The **authoritative** guide to where docs/spec changes go. Read this before adding or moving any doc.
The goal: keep `docs/` and `spec/` clean and navigable, and stop the structure from drifting when
agents satisfy the docs-sync CI gate. Enforced (in part) by [`scripts/check-docs-structure.mjs`](../../scripts/check-docs-structure.mjs).

## Hard rules

1. **Never create a new top-level file** in `docs/` or `spec/`, and never invent a new top-level
   folder. Put the change in the **relevant existing** doc/spec (see the map below).
2. **Satisfy the docs-sync gate by updating the relevant doc — never by dropping a stray file.**
   `scripts/check-docs-impact.mjs` only checks that *some* doc/spec changed; it is on you to edit the
   *right* one.
3. **Do not generate one-off narrative markdown** (audits, PR-consolidation writeups, "NOTES",
   "STATUS", thread-resolution maps, migration plans). That kind of file is what this restructure
   removed. Durable facts go in the canonical doc; ephemeral work goes in a GitHub issue / the backlog.
4. **Work status is not a doc.** It lives in **Linear** (team **Frapp Live**), reached via the native
   Linear MCP — see [`ci-cd/LINEAR_PM.md`](ci-cd/LINEAR_PM.md). A new initiative → a Linear **Project**.
   Don't track status in `docs/` or `spec/`.
5. **One canonical place per fact.** Elsewhere, link to it (path + heading). If two docs must
   summarize, one paragraph max, then link out.

## Where things go

| Kind of change | Canonical home |
| -------------- | -------------- |
| Product behavior, rules, flows, invariants | `spec/behavior/<topic>.md` (or `<topic>/README.md` if it has 2+ files) |
| Product features, surfaces, positioning, module catalog | `spec/product/` |
| Architecture, data model, API patterns, ADRs | `spec/architecture/README.md` |
| Engineering principles | `spec/engineering.md` |
| Environments, CI/CD model | `spec/environments/README.md` |
| UI requirements (web, landing, brand, assets, resilience) | `spec/ui/` |
| How to run locally / test / contribute | `docs/guides/` |
| Ops runbooks (DB, incidents, branch protection, deploy) | `docs/internal/ops/` |
| CI / agent infra / automations | `docs/internal/ci-cd/` |
| Design-system (typography, icons, microcopy, brand assets) | `docs/internal/design-system/` |
| Mobile testing / smoke | `docs/internal/mobile/` |
| Accessibility / PR-review process | `docs/internal/quality/` |
| Env reference / secrets / local-dev / cloud sandbox / agent credentials | `docs/internal/environment/` |
| Security implementation notes / fixes log | `docs/internal/security/` |
| Visual prototype reference | `docs/internal/design-reference/` |
| Per-service performance notes | `docs/internal/services/` |
| Work status / planning | **Linear** (team Frapp Live) — not a doc; see [`ci-cd/LINEAR_PM.md`](ci-cd/LINEAR_PM.md) |

## Satisfying the docs-sync gate (`scripts/check-docs-impact.mjs`)

It fails when a PR changes a path outside `docs/`/`spec/` without also changing at least one path under
them. Pick the **relevant** canonical home above:

- **API / domain:** `spec/architecture/README.md` and/or the topic under `spec/behavior/`; add a
  contributor note in `docs/guides/api-architecture.md` or `database.md` only if needed.
- **UI:** the relevant file under `spec/ui/` and/or `docs/internal/design-system/`.
- **Infra / CI:** `spec/environments/README.md` and/or `docs/internal/ci-cd/`, or a focused ops runbook.
- **Mechanical / non-user-visible:** a short note in the nearest existing related doc is enough — do
  not create a new file for it.

Root-level files like `AGENTS.md` / `CONTRIBUTING.md` count as outside `docs/`/`spec/` and still need a
`docs/` or `spec/` change in the same PR when edited.

## See also

- Folder map: [`docs/README.md`](../README.md)
- Docs gate behavior: [`ci-cd/DOCS_CI.md`](ci-cd/DOCS_CI.md)
- Work tracking (Linear): [`ci-cd/LINEAR_PM.md`](ci-cd/LINEAR_PM.md) · ADR-16 in [`../../spec/architecture/README.md`](../../spec/architecture/README.md)
