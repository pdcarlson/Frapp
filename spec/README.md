# Specification index

**`spec/`** is the normative source for product behavior, architecture, environments, UI expectations, security notes, and focused test specifications. Developer workflows and runbooks live under **`docs/`**—start at [`docs/README.md`](../docs/README.md) and [`docs/guides/README.md`](../docs/guides/README.md).

## Core

| Document                             | Purpose                               |
| ------------------------------------ | ------------------------------------- |
| [`product.md`](product.md)           | Features, flows, surfaces             |
| [`behavior.md`](behavior.md)         | Rules, edge cases, invariants         |
| [`architecture.md`](architecture.md) | Stack, data model, auth, API patterns |
| [`environments.md`](environments.md) | Local, staging, production; CI/CD     |

## UI

| Document                                       | Purpose                     |
| ---------------------------------------------- | --------------------------- |
| [`ui-brand-identity.md`](ui-brand-identity.md) | Brand and identity          |
| [`ui-landing.md`](ui-landing.md)               | Marketing site              |
| [`ui-web-dashboard.md`](ui-web-dashboard.md)   | Admin web app               |
| [`ui-assets.md`](ui-assets.md)                 | Assets and sync             |
| [`ui-resilience.md`](ui-resilience.md)         | Resilience and empty states |

## Security

| Document                                                           | Purpose            |
| ------------------------------------------------------------------ | ------------------ |
| [`security-path-traversal.md`](security-path-traversal.md)         | Path traversal     |
| [`security-content-validation.md`](security-content-validation.md) | Content validation |

## Other root specs

| Document                                       | Purpose                    |
| ---------------------------------------------- | -------------------------- |
| [`points.controller.md`](points.controller.md) | Points controller behavior |

## Test specs (`spec/tests/`)

Implementation-focused test and coverage notes. **Naming is mixed** (some `*.spec.md`, some `*.md`); new files should prefer `*.spec.md`. See [`docs/internal/DOCUMENTATION_CONVENTIONS.md`](../docs/internal/DOCUMENTATION_CONVENTIONS.md).

Files include: `alumni.controller.spec.md`, `attendance-controller.md`, `attendance-service.spec.md`, `backwork-controller.md`, `backwork-service.spec.md`, `billing-controller.spec.md`, `billing-service.md`, `chapter-controller.md`, `chapter-service.md`, `chat.service.spec.md`, `chat-service-optimization.md`, `coverage-improvements.md`, `financial-invoice-controller.spec.md`, `invite-member-dialog.spec.md`, `invite.controller.md`, `invite.service.md`, `notification.service.spec.md`, `rbac.controller.md`, `report.controller.spec.md`, `search-service.md`, `study.controller.spec.md`, `task-controller.md`, `use-attendance.spec.md`, `use-members.md`.
