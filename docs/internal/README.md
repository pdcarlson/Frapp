# Internal docs

Operations runbooks, environment reference, and the other internal notes (the documentation conventions, the admin dashboard). Grouped by area.

- **Conventions:** [`DOCUMENTATION_CONVENTIONS.md`](DOCUMENTATION_CONVENTIONS.md) — the placement map
  and the documentation standard (read before adding any doc). It is a convention the docs angle in
  `diff-review` reviews, not a rule CI enforces.
- **Admin:** [`ADMIN_DASHBOARD.md`](ADMIN_DASHBOARD.md)

Which subfolder of `docs/internal/` owns which kind of change is stated once, in
[`DOCUMENTATION_CONVENTIONS.md` § Where things go](DOCUMENTATION_CONVENTIONS.md#where-things-go).
This index does not restate it; it only routes: [`ops/`](ops/) and
[`environment/`](environment/README.md). CI and agent-infra notes live in [`../ci-cd/`](../ci-cd/),
security notes in [`../security/`](../security/README.md), and performance notes in
[`../performance/`](../performance/README.md).

Design-system guidance moved to [`spec/ui/design-system/`](../../spec/ui/design-system/README.md) (Signet restructure).

Work status is tracked in **GitHub Issues** (see [`../ci-cd/github-pm.md`](../ci-cd/github-pm.md)), not here.
Developer-facing guides live in [`../guides/`](../guides/README.md).
