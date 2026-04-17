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
| [`ui-web-dashboard.md`](ui-web-dashboard.md)   | Admin web app (nav, screens; maps to RBAC including chapter-wide `GET /v1/polls` / Points audit list) |
| [`ui-assets.md`](ui-assets.md)                 | Assets and sync             |
| [`ui-resilience.md`](ui-resilience.md)         | Resilience and empty states |

## Security

| Document                                                           | Purpose            |
| ------------------------------------------------------------------ | ------------------ |
| [`security-path-traversal.md`](security-path-traversal.md)         | Path traversal     |
| [`security-content-validation.md`](security-content-validation.md) | Content validation |

## Test specs (`spec/tests/`)

Implementation-focused test and coverage notes. **Convention:** every file uses the **`*.spec.md`** suffix. Browse [`tests/`](tests/).

Conventions for documentation updates: [`docs/internal/DOCUMENTATION_CONVENTIONS.md`](../docs/internal/DOCUMENTATION_CONVENTIONS.md).
