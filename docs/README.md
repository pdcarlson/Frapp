# Documentation index

Developer guides and operator runbooks. Product and architecture truth lives in **[`spec/`](../spec/README.md)**; work tracking lives in **GitHub Issues** (see [`internal/ci-cd/GITHUB_PM.md`](internal/ci-cd/GITHUB_PM.md)).

## Folders

| Area | Path | Use for |
| ---- | ---- | ------- |
| **Guides** | [`guides/`](guides/README.md) | Contributor docs: getting started, testing, API/database overview, env config, Docker, deployment |
| **Internal** | [`internal/`](internal/README.md) | Operations, CI/CD, design system, mobile, quality, environment, security, services, and the design reference |
| **Performance** | [`performance/`](performance/README.md) | Ad-hoc performance investigations and optimization notes |
| **Hooks** | [`hooks/`](hooks/README.md) | Conventions and tests for `packages/hooks` |

## Internal subfolders

| Topic | Path |
| ----- | ---- |
| Operations & runbooks | [`internal/ops/`](internal/ops/DEPLOYMENT.md) |
| CI/CD & automations | [`internal/ci-cd/`](internal/ci-cd/DOCS_CI.md) |
| Design system | [`internal/design-system/`](internal/design-system/UI_UX_SYSTEM.md) |
| Mobile | [`internal/mobile/`](internal/mobile/MOBILE_TESTING.md) |
| Quality | [`internal/quality/`](internal/quality/PR_REVIEW_PROCESS.md) |
| Environment & secrets | [`internal/environment/`](internal/environment/ENV_REFERENCE.md) |
| Security | [`internal/security/`](internal/security/README.md) |
| Design reference (prototype) | [`internal/design-reference/`](internal/design-reference/README.md) |
| Service performance notes | [`internal/services/`](internal/services/chapter-service-perf.md) |

## Conventions

What to update in a PR, and where docs vs. spec belong: **[`docs/internal/DOCUMENTATION_CONVENTIONS.md`](internal/DOCUMENTATION_CONVENTIONS.md)**.

The docs/spec CI gate (a change outside `docs/` or `spec/` must also touch one of them) is described in [`internal/ci-cd/DOCS_CI.md`](internal/ci-cd/DOCS_CI.md).
