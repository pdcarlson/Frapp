# Specification index

**`spec/`** is the source of truth for **intended** product behavior, architecture, environments,
and UI expectations. **Code** is the source of truth for **current** behavior. Disagreement is a
tracked bug to file, not something to silently resolve by picking whichever loaded first — see
[`AGENTS.md`](../AGENTS.md) § Spec vs code. This tree is purely topical and canonical — work
tracking and delivery sequencing live in **GitHub Issues** (see
[`docs/internal/ci-cd/GITHUB_PM.md`](../docs/internal/ci-cd/GITHUB_PM.md)), not here. Developer
workflows and runbooks live under **`docs/`** — start at [`docs/README.md`](../docs/README.md) and
[`docs/guides/README.md`](../docs/guides/README.md).

## Core

Which spec directory owns which kind of change is stated once, in
[`docs/internal/DOCUMENTATION_CONVENTIONS.md` § Where things go](../docs/internal/DOCUMENTATION_CONVENTIONS.md#where-things-go).
This index does not restate it: every topic tree under `spec/` routes from its own `README.md` —
[`product/`](product/README.md), [`behavior/`](behavior/README.md),
[`architecture/`](architecture/README.md), [`environments/`](environments/README.md),
[`ui/`](ui/README.md).

Canonical engineering principles are a file rather than a tree: [`engineering.md`](engineering.md).

Security implementation notes live under [`docs/internal/security/`](../docs/internal/security/README.md).

---

## Active work

Initiatives that build on this spec — currently the **chat-rework** effort plus Analytics, Pricing &
billing, and Agent-infrastructure — are tracked in **GitHub Issues** as `[Epic]` parent issues with
sub-issues, not here. See [`docs/internal/ci-cd/GITHUB_PM.md`](../docs/internal/ci-cd/GITHUB_PM.md)
for the model and how agents reach it (GitHub MCP). Status (shipped / queued) lives in the tracker;
this index intentionally carries no status table.
