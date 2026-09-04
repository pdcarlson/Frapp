# Documentation index

Developer guides and operator runbooks. Product and architecture truth lives in **[`spec/`](../spec/README.md)**; work tracking lives in **GitHub Issues** (see [`internal/ci-cd/GITHUB_PM.md`](internal/ci-cd/GITHUB_PM.md)).

## Folders

**This file is machine-checked.** Every declared child of `docs/` and `docs/internal/` needs a row in a table
here, and a row may not name a child that is not declared — `npm run check:doc-tables`, against
`DIRECTORIES` in [`scripts/ci/lib/docs-structure.mjs`](../scripts/ci/lib/docs-structure.mjs). Add or retire a directory in
the manifest and here in the same commit; the rule itself is described in
[`DOCS_CI.md`](internal/ci-cd/DOCS_CI.md) § Rosters.

| Area | Path | Use for |
| ---- | ---- | ------- |
| **Guides** | [`guides/`](guides/README.md) | Contributor docs: getting started, testing, API/database overview, env config, Docker, deployment |
| **Internal** | [`internal/`](internal/README.md) | Operations, CI/CD, mobile, quality, environment, security, and services |
| **Performance** | [`performance/`](performance/README.md) | Ad-hoc performance investigations and optimization notes |
| **Hooks** | [`hooks/`](hooks/README.md) | Conventions and tests for `packages/hooks` |

## Internal subfolders

| Topic | Path |
| ----- | ---- |
| Operations & runbooks | [`internal/ops/`](internal/ops/DEPLOYMENT.md) |
| CI/CD & automations | [`internal/ci-cd/`](internal/ci-cd/DOCS_CI.md) |
| Mobile | [`internal/mobile/`](internal/mobile/MOBILE_TESTING.md) |
| Quality | [`internal/quality/`](internal/quality/PR_REVIEW_PROCESS.md) |
| Environment & secrets | [`internal/environment/`](internal/environment/ENV_REFERENCE.md) |
| Security | [`internal/security/`](internal/security/README.md) |
| Service performance notes | [`internal/services/`](internal/services/chapter-service-perf.md) |

The design system (tokens, components, iconography, microcopy, accent engine) lives in **[`spec/ui/design-system/`](../spec/ui/design-system/README.md)**.

## Conventions

What to update in a PR, and where docs vs. spec belong: **[`docs/internal/DOCUMENTATION_CONVENTIONS.md`](internal/DOCUMENTATION_CONVENTIONS.md)**.

The docs CI checks — what they do and do not enforce — are described in [`internal/ci-cd/DOCS_CI.md`](internal/ci-cd/DOCS_CI.md). None of them require a PR to touch a doc.

The other quality gates — dependency-cruiser boundaries, oasdiff breaking-change detection, the
`nestjs-typed` response-schema rule, jscpd duplication, and coverage — are in
[`internal/ci-cd/QUALITY_GATES.md`](internal/ci-cd/QUALITY_GATES.md), which also records *why* each
one is required, advisory, or `warn`.

Tech debt found in the Frapp → Signet rebuild is tracked as **GitHub Issues**, not in a doc — see [`AGENTS.md` § Tech debt protocol](../AGENTS.md#tech-debt-protocol-non-optional) for what to do when you find orphaned or contradictory code.
