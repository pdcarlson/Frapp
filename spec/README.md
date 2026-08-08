# Specification index

**`spec/`** is the normative source for product behavior, architecture, environments, and UI
expectations. It is purely topical and canonical — work tracking and delivery sequencing live in
**GitHub Issues** (see [`docs/internal/ci-cd/GITHUB_PM.md`](../docs/internal/ci-cd/GITHUB_PM.md)),
not here. Developer workflows and runbooks live under **`docs/`** — start at
[`docs/README.md`](../docs/README.md) and [`docs/guides/README.md`](../docs/guides/README.md).

## Core

| Document | Purpose |
| -------- | ------- |
| [`product/`](product/README.md) | Features, flows, surfaces, positioning, modules |
| [`behavior/`](behavior/README.md) | Rules, edge cases, invariants (per topic) |
| [`architecture/`](architecture/README.md) | Stack, data model, auth, API patterns, ADRs |
| [`environments/`](environments/README.md) | Local, staging, production; CI/CD |
| [`engineering.md`](engineering.md) | Canonical engineering principles |

## UI

| Document | Purpose |
| -------- | ------- |
| [`ui/`](ui/README.md) | Brand identity, web dashboard, landing, assets, resilience |

Security implementation notes live under [`docs/internal/security/`](../docs/internal/security/README.md).
Documentation-placement conventions: [`docs/internal/DOCUMENTATION_CONVENTIONS.md`](../docs/internal/DOCUMENTATION_CONVENTIONS.md).

---

## Active work

Initiatives that build on this spec — currently the **chat-rework** effort plus Analytics, Pricing &
billing, and Agent-infrastructure — are tracked in **GitHub Issues** as `[Epic]` parent issues with
sub-issues, not here. See [`docs/internal/ci-cd/GITHUB_PM.md`](../docs/internal/ci-cd/GITHUB_PM.md)
for the model and how agents reach it (GitHub MCP). Status (shipped / queued) lives in the tracker;
this index intentionally carries no status table.
