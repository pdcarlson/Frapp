# Internal docs

Operations, infrastructure, agent/CI reference, and design-system guidance. Grouped by area.

- **Conventions:** [`DOCUMENTATION_CONVENTIONS.md`](DOCUMENTATION_CONVENTIONS.md) — the authoritative
  placement map for where docs/spec changes go (read before adding any doc).
- **Admin:** [`ADMIN_DASHBOARD.md`](ADMIN_DASHBOARD.md)

| Area | Folder | Contents |
| ---- | ------ | -------- |
| Ops / runbooks | [`ops/`](ops/) | DB promotion/rollback, incident response, branch protection, alert routing, deploy |
| CI / agent infra | [`ci-cd/`](ci-cd/) | docs-sync CI, agent infra, Cursor automations, AI code review |
| Design system | [`design-system/`](design-system/) | UI/UX system, typography, iconography, microcopy, brand assets, UX writing |
| Mobile | [`mobile/`](mobile/) | mobile testing + smoke checklist |
| Quality | [`quality/`](quality/) | accessibility protocol, PR review process |
| Environment | [`environment/`](environment/) | **Claude Code cloud sandbox (primary dev env)**, local dev, env reference, secrets management, agent credentials |
| Security | [`security/`](security/) | upload validation, path traversal, fixes log |
| Services | [`services/`](services/) | per-service performance notes |
| Design reference | [`design-reference/`](design-reference/) | visual prototype bundle (palette, JSX, screenshots) |

Work status is tracked in **Linear** (team Frapp Live — see [`ci-cd/LINEAR_PM.md`](ci-cd/LINEAR_PM.md)), not here.
Developer-facing guides live in [`../guides/`](../guides/README.md).
