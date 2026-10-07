# Internal docs

Environment reference and the documentation conventions. Grouped by area.

- **Conventions:** [`DOCUMENTATION_CONVENTIONS.md`](DOCUMENTATION_CONVENTIONS.md) — the placement map
  and the documentation standard (read before adding any doc). It is a convention the docs angle in
  `diff-review` reviews, not a rule CI enforces.

Which subfolder of `docs/internal/` owns which kind of change is stated once, in
[`DOCUMENTATION_CONVENTIONS.md` § Where things go](DOCUMENTATION_CONVENTIONS.md#where-things-go).
This index does not restate it; it only routes: [`environment/`](environment/README.md).
Operations runbooks live in [`../ops/`](../ops/), CI and agent-infra notes in [`../ci-cd/`](../ci-cd/),
security notes in [`../security/`](../security/README.md), and the report-service performance note in
[`../performance/reports.md`](../performance/reports.md).

Design-system guidance moved to [`spec/ui/design-system/`](../../spec/ui/design-system/README.md) (Signet restructure).

Work status is tracked in **GitHub Issues** (see [`../ci-cd/github-pm.md`](../ci-cd/github-pm.md)), not here.
Developer-facing guides live in [`../guides/`](../guides/README.md).
