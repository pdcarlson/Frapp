# Backlog conventions

How the in-repo backlog works. The backlog lives at [`docs/backlog/`](../README.md) and is the
**single source of truth** for work status across Frapp.

## Model

**Frapp → projects → work units → GitHub issues.**

- A **project** is a scoped, usually temporary initiative (e.g. the chat-rework). Each project is a
  single markdown file in [`projects/`](../projects/). Nothing but project files goes in `projects/`.
- A **work unit** is a row in a project's work-units table, mapped to a GitHub **issue**.
- Anything not tied to a project lives in [`general.md`](./general.md), the un-projected backlog.
- Templates, conventions, and the general backlog live here in `_meta/` so `projects/` stays clean.

## Source-of-truth rule (repo wins)

The backlog is authoritative. **GitHub issues mirror it, never the reverse.** When the two disagree,
the repo is correct and the GitHub issue is brought into line — relabel / retitle / reopen / close the
issue to match the backlog. The `/triage` command (and the SessionStart hook) reconcile drift in this
direction automatically.

Status model (solo project): an issue's **open/closed state is its status**. There is no "In Review"
stage and no GitHub Projects board. PRs close their issue with `Closes #N`.

## Adding a new project

1. Copy [`_TEMPLATE.md`](./_TEMPLATE.md) to `projects/<slug>.md`.
2. Fill the header (status, epic, spec links) and the work-units table from **verified** issues.
3. Add a row for the project in the root [`README.md`](../README.md) projects table.

## Seeding / editing rule

Only ever populate work-unit rows from **verified GitHub data** — never invent or infer an issue
number or title. An incomplete-but-true backlog beats a complete-but-fabricated one; if data can't be
verified, leave a `<!-- TODO: seed remaining -->` marker instead of guessing.

## What does NOT go here

Canonical product/behavior/architecture spec lives in [`spec/`](../../../spec/), not in the backlog.
The backlog tracks *work*; it links out to the real spec a unit implements. Don't paste spec content
into project files.
