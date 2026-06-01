# PM → Linear (project-management migration)

**Status:** active
**Epic(s):** — (tracked by ADR-16, not a feature epic)
**Spec:** ADR-16 in [`spec/architecture/README.md`](../../../spec/architecture/README.md) + [`docs/internal/ci-cd/LINEAR_PM.md`](../../internal/ci-cd/LINEAR_PM.md)
**Updated:** 2026-06-01

> Adopt **Linear** as Frapp's canonical PM system and retire the in-repo backlog (staged: rails first,
> cut-over after the maintainer provisions Linear). Also evolves the Cursor Suggestion Triage automation
> from additive-only to additive + maintenance, with a hard "only touch `suggestion`-labeled issues"
> ownership guardrail. This backlog stays the source of truth until the cut-over (#611) completes.

## Work units

> The backlog is the **source of truth** for status (until the Linear cut-over). `State` mirrors the
> GitHub issue's open/closed state; PRs close issues via `Closes #N`.

| Unit | Issue | State | Depends on | Notes |
| ---- | ----- | ----- | ---------- | ----- |
| Cursor triage maintenance + Linear rails | [#610](https://github.com/pdcarlson/Frapp/issues/610) | in progress | — | This PR. Maintenance pass + ownership gate + budget in `.cursor/skills/suggestion-triage.md`; ADR-16 + `LINEAR_PM.md` + `.mcp.json.example`. Closes on merge. |
| Linear cut-over (import, repoint tooling, retire backlog) | [#611](https://github.com/pdcarlson/Frapp/issues/611) | open | #610 + user provisioning | Cut-over checklist in `LINEAR_PM.md`; blocked on Linear workspace/GitHub-app/MCP OAuth (user action). |
| Cursor files into Linear (decision) | [#612](https://github.com/pdcarlson/Frapp/issues/612) | open | #611 | Optional: keep GitHub-as-intake vs file directly into Linear; preserve dedup + ownership gate. |

## Notes / decisions

- **Decisions (2026-06-01, with maintainer):** tool = **Linear**; source-of-truth model = **Linear
  fully canonical, retire the in-repo backlog**; Cursor close-policy = **close only provable, else mark
  `stale`**; ownership guardrail = **`label:suggestion` only**; sequencing = **rails now, user wires it,
  cut-over is a follow-up**.
- **Why staged:** a cloud sandbox can't create the Linear workspace, install the GitHub App, or complete
  MCP OAuth — those are user actions in the `LINEAR_PM.md` runbook. Retiring the backlog before Linear is
  live would strand the project with no tracker, so #610 keeps it operational.
- **Robustness hedge (ADR-16):** GitHub issues remain the synced, always-available read/execute surface
  so agents aren't blocked when the Linear MCP server is unavailable.
