# Frapp project board

This folder **is** Frapp's project board. It lives in git, so it survives ephemeral agent
sessions, is diffable in PRs, and can be read and updated by the agents that do the work.

**Source of truth.** This board is authoritative. GitHub issues are a *reflection* of it — when
the board and GitHub disagree, the board wins and the GitHub issue is updated to match (never the
reverse). We do **not** use the GitHub Projects (v2) board for anything; all tracking is here.

**Scope.** Frapp is the whole product. Work is organized into **projects** — scoped, usually
temporary initiatives (e.g. the chat-first redesign). A project breaks down into **work units**
(the redesign calls them *chunks*; other projects may use *milestones* or *phases*), which are
delivered as PRs and tracked against **GitHub issues**. Issues that don't belong to any project
live in the general [`backlog.md`](backlog.md) until they graduate into one.

```
Frapp (product)
└── projects (this board)
    └── work units (chunks / milestones)
        └── GitHub issues
```

**Status legend:** ✅ done · 🟡 in progress · ⚪ queued · 🔵 optional · 🗄️ archived

## Projects

| Project | Status | Progress | File |
| ------- | ------ | -------- | ---- |
| Chat-first redesign | 🟡 in progress | 5 / 12 chunks shipped | [`chat-redesign.md`](chat-redesign.md) |
| _General backlog (not a project)_ | — | — | [`backlog.md`](backlog.md) |

_Add future projects here as new rows, each with its own file (copy [`_TEMPLATE.md`](_TEMPLATE.md))._

## How this board works

- **See progress:** run `/status` — prints per-project progress and an overall Frapp headline by
  reading these files and cross-checking open GitHub issues.
- **Keep it current:** run `/triage` — pulls open GitHub issues, sorts each into a project or a
  `backlog.md` theme, reconciles new/closed issues, and (since the board is authoritative) brings
  GitHub issues into line with the board. Commits the board changes.
- **Do the work:** run `/next-task [#]` — completes an issue and updates its row here on merge.
- **Start a new project:** copy [`_TEMPLATE.md`](_TEMPLATE.md) to `docs/internal/board/<slug>.md`,
  fill in scope + work units, add a row to the Projects table above, then `/triage` to pull in its
  issues.

Process conventions for the redesign specifically (branch model, doc-sync mandate, review
checklist) live at [`../redesign/README.md`](../redesign/README.md).
