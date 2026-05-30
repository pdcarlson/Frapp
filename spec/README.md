# Specification index

**`spec/`** is the normative source for product behavior, architecture, environments, and UI
expectations. It is purely topical and canonical — work tracking and delivery sequencing live in the
backlog at [`docs/backlog/`](../docs/backlog/README.md), not here. Developer workflows and runbooks
live under **`docs/`** — start at [`docs/README.md`](../docs/README.md) and
[`docs/guides/README.md`](../docs/guides/README.md).

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

Initiatives that build on this spec — currently the **chat-rework** project (the chat-first product,
delivered as chunks) plus Analytics, Billing, and Agent-infra — are tracked in the in-repo backlog:

- [`docs/backlog/projects/chat-rework.md`](../docs/backlog/projects/chat-rework.md) — chunk delivery + status
- [`docs/backlog/README.md`](../docs/backlog/README.md) — all projects + overall progress

Status (shipped / queued) lives in the backlog, mirrored by GitHub issue open/closed state. This index
intentionally carries no status table.
