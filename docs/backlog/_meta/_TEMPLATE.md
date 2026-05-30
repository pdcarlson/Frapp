<!--
TEMPLATE — copy this file to docs/backlog/projects/<project-slug>.md to start a new project,
then delete this comment and fill in the sections. A "project" is a scoped, usually temporary
initiative (Frapp → projects → work units → GitHub issues). Keep it to ONE file per project;
this folder's parent (_meta/) is for templates/conventions/general — projects/ holds projects only.
-->

# <Project name>

**Status:** active | queued | shipped
**Epic(s):** #NNN
**Spec:** [`spec/...`](../../../spec/) — the canonical behavior/architecture this project implements
**Updated:** YYYY-MM-DD

> One-paragraph summary: what this project delivers and why it exists.

## Work units

> The backlog is the **source of truth** for status. `State` mirrors the GitHub issue's
> open/closed state — solo project, so an issue's open/closed state *is* its status (no
> "In Review" stage; PRs close issues via `Closes #N`). When the repo and GitHub disagree,
> the repo wins and the issue is brought into line (run `/triage`).

| Unit | Issue | State | Depends on | Notes |
| ---- | ----- | ----- | ---------- | ----- |
| <short name> | #NNN | open | #NNN / — | <link to the real spec section it implements> |

## Notes / decisions

- <durable decisions, dependency-graph notes, open questions worth keeping>
