# Linear as the canonical PM system

Canonical, version-controlled design + provisioning runbook for adopting **Linear** as Frapp's
project-management system, per **ADR-16** (`spec/architecture/README.md`). Linear becomes the source of
truth for planning/status; GitHub issues stay the executable layer synced two-way to Linear.

> **Status: rails only (this PR).** The in-repo backlog at [`../../backlog/`](../../backlog/README.md) is
> **still the source of truth** and stays operational until the **cut-over** (a tracked follow-up issue).
> Nothing here is live until the user runs the [provisioning runbook](#provisioning-runbook) below.
> Do not delete `docs/backlog/` or repoint `/triage` `/status` `/next-task` until the cut-over.

---

## The model

```
Linear (canonical: planning, status, board)  ⇄  GitHub issues (executable layer)  →  PRs (Closes #N)
        ▲ Claude + Cursor via MCP                   ▲ Cursor files/maintains `suggestion` issues
        ▲ automations via GraphQL API               ▲ agents read here when Linear MCP is unavailable
```

- **Linear is canonical** for what to work on and its status. Humans plan on the board; agents read/write
  Linear via its MCP server.
- **GitHub issues remain the executable layer.** Each tracked Linear issue links to a GitHub issue (and
  its PR). PRs still close GitHub work with `Closes #N`; Linear's GitHub integration transitions the
  linked Linear issue automatically (see [mapping](#state-and-label-mapping)).
- **GitHub issues are the fallback read surface.** Any MCP server (including Linear's) can drop
  mid-session. Because the integration keeps GitHub issues in sync, an agent that loses Linear MCP can
  still read status from GitHub issues and close work via `Closes #N`. This is the deliberate robustness
  hedge in ADR-16.

### Three-actor access

| Actor | Reaches Linear via | Notes |
| --- | --- | --- |
| **Claude Code** (this cloud agent) | Linear hosted **MCP** `https://mcp.linear.app/mcp` (OAuth 2.1) | No `gh` CLI / no GitHub Projects MCP here — MCP is the only path. Falls back to the GitHub MCP's issue tools if Linear MCP is down. |
| **Cursor** (background agents) | Linear **MCP** (same endpoint) **and/or** GraphQL **API** key | The Suggestion Triage automation keeps using `gh` against GitHub issues; Linear ingests them via sync (unchanged this PR). |
| **GitHub** | Linear's **native GitHub integration** (the GitHub App) | Two-way link/sync of PRs, branches, status, comments, assignee. |

---

## State and label mapping

GitHub issue lifecycle ↔ Linear workflow state (defaults; tune per the team's Linear workflow):

| GitHub | Linear workflow state |
| --- | --- |
| open, unstarted | Backlog / Todo |
| open, branch or draft PR linked | In Progress |
| PR merged / issue closed `completed` | Done |
| closed `not planned` | Canceled |
| closed `duplicate` (+ `duplicate_of`) | Canceled, linked to the canonical |

**Magic words (in a PR title/body or commit):** `Closes`/`Fixes`/`Resolves ABC-123` links and, on merge,
auto-transitions Linear issue `ABC-123` to Done. The Linear issue ID can also be put in the **branch
name** or **PR title** to auto-link before merge. GitHub's own `Closes #N` continues to close the GitHub
issue; the two are complementary — link the GitHub issue to its Linear issue once and the rest syncs.

**Labels** (preserve the existing GitHub taxonomy as Linear labels so Cursor's flow is unaffected):

| GitHub label | Linear |
| --- | --- |
| `suggestion` | Label `suggestion` — **the Cursor-owned marker** (see ownership boundary) |
| `area:<x>` | Label group `area/<x>` |
| `severity:<x>` | Label group `severity/<x>` (or map to Linear priority) |
| `agent-ready` | Label `agent-ready` |
| `stale` | Label `stale` |
| `bug` / `enhancement` / `data` / `security` / `ci` / `blocked` | same-named Linear labels |

---

## Ownership boundary (carries over verbatim)

The Cursor-vs-human ownership rule from [`../../../.cursor/skills/suggestion-triage.md`](../../../.cursor/skills/suggestion-triage.md)
is unchanged by adopting Linear:

> Cursor (and any suggestion-triage run) may only modify issues it owns — those carrying the
> **`suggestion`** label. Everything else — human-filed work, epics, planning items — is **read-only** to
> the automation, on **both** GitHub and Linear.

Because the `suggestion` label syncs to Linear, the same gate works on both sides: the automation never
edits or closes a non-`suggestion` Linear issue, and a human's Linear-native planning items (which never
carry `suggestion`) are protected by construction.

---

## Provisioning runbook

**All steps are user actions — they cannot be performed from the cloud sandbox** (no SaaS account
creation, no browser OAuth, no GitHub-App install from here). Do them on your own machine/browser.

1. **Create the Linear workspace** (or use an existing one). Create a team for Frapp; note its issue
   identifier prefix (e.g. `FRAP`).
2. **Install Linear's GitHub integration** on `pdcarlson/Frapp`:
   Linear → Settings → Integrations → GitHub → Connect, then authorize the GitHub App on the repo.
   Enable PR/branch linking and two-way issue sync. Docs: <https://linear.app/docs/github-integration>
   · Marketplace: <https://github.com/marketplace/linear>
3. **Add the Linear MCP server to Claude Code** (so this agent can read/write Linear):
   ```bash
   claude mcp add --transport http linear-server https://mcp.linear.app/mcp
   # then open a Claude Code session and run /mcp to complete the OAuth flow
   ```
   (For Claude Code **on the web**, add the same server in the web environment's MCP config so cloud
   sessions get it — the repo doesn't declare MCP servers; the environment injects them.)
4. **Add the Linear MCP server to Cursor** — Cursor → Settings → MCP, click the Linear one-click install
   or add to `.cursor/mcp.json` (project) / `~/.cursor/mcp.json` (global). A ready-to-copy block is in
   [`.mcp.json.example`](../../../.mcp.json.example).
5. **Mint a Linear API key** for any non-MCP automation (e.g. scripts):
   Linear → Settings → Account → Security & access → Personal API keys. Scope it (Read/Write/Create
   issues as needed). API: GraphQL at `https://api.linear.app/graphql`, header `Authorization: <API_KEY>`
   (personal keys take **no** `Bearer` prefix; OAuth tokens do). Docs: <https://linear.app/developers/graphql>
   Store the key as an environment secret (never commit it); follow the secret rules in `AGENTS.md`.
6. **Smoke-test the sync:** create a Linear issue, put its ID in a test branch/PR title, confirm the link
   appears on both sides and the issue transitions on merge.

When steps 1–6 are done, start the **cut-over** (next section).

---

## Cut-over (the follow-up — do NOT do it in the rails PR)

Tracked as a dedicated follow-up issue. Checklist the follow-up must cover:

- Import the open GitHub issues into Linear (Linear's GitHub-issue import / the integration), preserving
  the `suggestion`/`area`/`severity`/`agent-ready`/`stale` taxonomy as Linear labels.
- Repoint the agent tooling: `/triage` (retire or re-aim at Linear↔GitHub drift), `/status` and
  `/next-task` (read Linear via MCP, or a generated snapshot), and the SessionStart hook.
- Decide the agent-facing read surface if Linear MCP is unavailable (GitHub issues, or a generated
  read-only snapshot committed to the repo).
- Flip the doctrine: update `AGENTS.md`, `docs/internal/DOCUMENTATION_CONVENTIONS.md`, and
  `docs/backlog/_meta/conventions.md`; then **freeze/delete** `docs/backlog/` (git history is the archive).
- Decide whether Cursor's Suggestion Triage should file directly into Linear (separate follow-up) or keep
  filing GitHub `suggestion` issues that sync in.
- Verify two-way sync end-to-end before declaring the backlog retired.

---

## Sources

- Linear MCP server (endpoint, Claude Code / Cursor setup, OAuth): <https://linear.app/docs/mcp>
- Linear GitHub integration (magic words, branch/PR linking, two-way sync): <https://linear.app/docs/github-integration>
- Linear GraphQL API (endpoint, API keys, auth header): <https://linear.app/developers/graphql>
