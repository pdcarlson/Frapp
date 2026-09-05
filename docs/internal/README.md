# Internal docs

Operations, infrastructure, and agent/CI reference. Grouped by area.

- **Conventions:** [`DOCUMENTATION_CONVENTIONS.md`](DOCUMENTATION_CONVENTIONS.md) — the placement map
  and the documentation standard (read before adding any doc). It is a convention the docs angle in
  `diff-review` reviews, not a rule CI enforces.
- **Admin:** [`ADMIN_DASHBOARD.md`](ADMIN_DASHBOARD.md)

Which subfolder of `docs/internal/` owns which kind of change is stated once, in
[`DOCUMENTATION_CONVENTIONS.md` § Where things go](DOCUMENTATION_CONVENTIONS.md#where-things-go).
This index does not restate it; it only routes: [`ops/`](ops/), [`ci-cd/`](ci-cd/),
[`mobile/`](mobile/), [`quality/`](quality/), [`environment/`](environment/README.md),
[`security/`](security/README.md), and `services/` — which has no index of its own, so its two files
are named here: [`chapter-service-perf.md`](services/chapter-service-perf.md) and
[`report-service-perf.md`](services/report-service-perf.md).

Design-system guidance moved to [`spec/ui/design-system/`](../../spec/ui/design-system/README.md) (Signet restructure).

Work status is tracked in **GitHub Issues** (see [`ci-cd/GITHUB_PM.md`](ci-cd/GITHUB_PM.md)), not here.
Developer-facing guides live in [`../guides/`](../guides/README.md).
