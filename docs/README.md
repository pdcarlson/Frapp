# Documentation index

Developer guides and operator runbooks. Product and architecture truth lives in **[`spec/`](../spec/README.md)**; work tracking lives in **GitHub Issues** (see [`internal/ci-cd/GITHUB_PM.md`](internal/ci-cd/GITHUB_PM.md)).

## Folders

Which directory owns which kind of change — across `docs/`, `docs/internal/` and `spec/` — is stated
once, in [`docs/internal/DOCUMENTATION_CONVENTIONS.md` § Where things go](internal/DOCUMENTATION_CONVENTIONS.md#where-things-go).
This index does not restate it; it only routes:
[`guides/`](guides/README.md), [`internal/`](internal/README.md), [`mobile/`](mobile/),
[`performance/`](performance/README.md), [`hooks/`](hooks/README.md).

The design system (tokens, components, iconography, microcopy, accent engine) lives in **[`spec/ui/design-system/`](../spec/ui/design-system/README.md)**.

## Conventions

What to update in a PR, and where docs vs. spec belong: **[`docs/internal/DOCUMENTATION_CONVENTIONS.md`](internal/DOCUMENTATION_CONVENTIONS.md)**.

The docs CI checks — what they do and do not enforce — are described in [`internal/ci-cd/DOCS_CI.md`](internal/ci-cd/DOCS_CI.md). None of them require a PR to touch a doc.

The other quality gates are in
[`internal/ci-cd/QUALITY_GATES.md`](internal/ci-cd/QUALITY_GATES.md), which also records *why* each
one is required, advisory, or `warn`. This index does not enumerate them — a second copy of that
roster drifts, and the last one did: it dropped required gates and listed one that is not a gate.

Tech debt found in the rebuild (legacy Frapp → the Signet design system; the product is named Frapp, ADR-25) is tracked as **GitHub Issues**, not in a doc — see [`AGENTS.md` § Tech debt protocol](../AGENTS.md#tech-debt-protocol) for what to do when you find orphaned or contradictory code.
