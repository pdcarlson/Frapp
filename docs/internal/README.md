# Internal docs

Operations, infrastructure, and agent/CI reference. Grouped by area.

- **Conventions:** [`DOCUMENTATION_CONVENTIONS.md`](DOCUMENTATION_CONVENTIONS.md) — the authoritative
  placement map for where docs/spec changes go (read before adding any doc).
- **Admin:** [`ADMIN_DASHBOARD.md`](ADMIN_DASHBOARD.md)

| Area | Folder | Contents |
| ---- | ------ | -------- |
| Ops / runbooks | [`ops/`](ops/) | DB promotion/rollback, incident response, branch protection, alert routing, deploy |
| CI / agent infra | [`ci-cd/`](ci-cd/) | docs-sync CI, agent infra, Claude Code routines, AI code review |
| Mobile | [`mobile/`](mobile/) | mobile testing + smoke checklist |
| Quality | [`quality/`](quality/) | accessibility protocol, PR review process |
| Environment | [`environment/`](environment/) | **Claude Code cloud sandbox (primary dev env)**, local dev, env reference, secrets management, agent credentials |
| Security | [`security/`](security/) | upload validation, path traversal, fixes log |
| Services | [`services/`](services/) | per-service performance notes |

Design-system guidance moved to [`spec/ui/design-system/`](../../spec/ui/design-system/README.md) (Signet restructure).

Work status is tracked in **GitHub Issues** (see [`ci-cd/GITHUB_PM.md`](ci-cd/GITHUB_PM.md)), not here.
Developer-facing guides live in [`../guides/`](../guides/README.md).
