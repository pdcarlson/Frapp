# Linear as the canonical PM system

Canonical, version-controlled design + policy for Frapp's project management on **Linear**, per
**ADR-16** and its cut-over amendment (`spec/architecture/README.md`). Linear is the source of truth for
planning and work status; GitHub issues are an executable layer that **syncs one-way into Linear**.

> **Status: repo cut-over complete; Linear-side provisioning finishing.** Work tracking lives in
> **Linear** (team **Frapp Live**, prefix **FRA-**), reached via the **native Linear MCP**. The in-repo
> `docs/backlog/` tree has been **retired** (git history is the archive) and agents start work with
> `/next`, which reads Linear directly. Two things are deliberately still in progress: (a) Linear-side
> **structural provisioning** — creating Projects, mapping `severity:*`→Priority, and cap remediation —
> see [Maintainer actions](#maintainer-actions-provisioning--activation); (b) the Cursor suggestion
> automation still files GitHub `suggestion` issues (which sync in), its migration to native-MCP Linear
> writes gated on a capability probe (see [Cursor automation](#cursor-automation-current--target)).

---

## The model

```
Linear (canonical: planning, status, board, Triage intake)
   ▲ Claude Code + Cursor via the NATIVE Linear MCP (OAuth; no API key, no committed config)
   ▲ GitHub issues sync ONE-WAY into Linear via the native GitHub App
```

- **Linear is canonical** for what to work on and its status. Humans plan on the board; agents read/write
  Linear through the native MCP. There is **no GitHub read-fallback** — if the MCP is down, `/next`
  stops rather than reading a stale tracker.
- **Epics are Linear Projects.** The imported `[Epic]` parents (FRA-154…FRA-160) stay as parent issues
  with sub-issues, assigned to the relevant Project. **No Initiatives, no Cycles.**
- **Triage is the intake.** New work — whether a human files it, `/next` files a follow-up, or the Cursor
  automation files a suggestion — lands in the **Triage** inbox and is accepted into **Backlog** before
  `/next` will auto-start it.
- **Issues are born in Linear.** Opening work directly as a GitHub issue is **not** the path; file in
  Linear (`save_issue` into Triage).

### How agents reach Linear (native MCP — no API key)

| Actor | Reaches Linear via | Notes |
| --- | --- | --- |
| **Claude Code** (cloud agent) | **Native Linear MCP**, injected by the web environment | No `gh` CLI in the web sandbox; MCP is the only path. No fallback tracker. |
| **Cursor** (interactive + background) | **Native Linear MCP** (Cursor is natively integrated with Linear) | Background-automation write capability is **unverified** — gated on the probe in [`CURSOR_AUTOMATIONS.md`](CURSOR_AUTOMATIONS.md#pending-native-linear-mcp-migration--capability-probe). No API key is used or committed anywhere. |
| **GitHub** | Linear's **native GitHub integration** (the GitHub App) | One-way: GitHub issue/PR state syncs **into** Linear. |

`.mcp.json.example` is a local-reference block only (plain OAuth URL, no token). **Do not** commit a root
`.mcp.json` — the web environment already injects the Linear MCP and a committed file would
double-register it.

---

## Sync direction and closing work (GitHub → Linear)

Sync is **unidirectional: GitHub → Linear** (the GitHub App is installed on `pdcarlson/Frapp`).

- A **Linear-native** issue is closed by a PR with the magic word **`Fixes FRA-N`** (also
  `Closes`/`Resolves FRA-N`) in the PR title/body — on merge, Linear transitions `FRA-N` to **Done**.
- An issue that has a **GitHub twin** is closed with **`Closes #<github>`**; the GitHub closure **syncs
  into** Linear and transitions the twin. (`/next` adds both magic words when a twin exists.)

| GitHub state | Linear workflow state |
| --- | --- |
| open, unstarted | Backlog / Todo |
| branch or draft PR linked | In Progress |
| PR merged / closed `completed` | Done |
| closed `not planned` | Canceled |
| closed `duplicate` (+ `duplicateOf`) | Canceled, linked to the canonical |

---

## Labels and priority (lean taxonomy)

- **Severity → native Priority.** `severity:critical→Urgent`, `severity:high→High`, `severity:medium→Medium`,
  `severity:low→Low`. (Imported `severity:*` labels are being migrated to Priority; the maintainer deletes
  the orphaned label group in the UI once empty.)
- **`area:<x>`** stays a label group (`api`/`web`/`db`/`ci`/`security`/`ux`/`product`/`research`/`docs`/`deps`).
  `data` is folded into `area:db`.
- **`suggestion`** is the Cursor-ownership marker — keep it.
- **`stale`** marks an aging suggestion that can't be *proven* resolved — kept, left open for review.
- **Dropped:** `agent-ready` (no longer used to gate `/next`); `blocked` (express dependencies as
  **blocked-by relations** instead); `enhancement` folds into Linear's `Improvement`.

---

## Ownership boundary (carries over)

Cursor (and any suggestion-triage run) may only modify issues it owns — those carrying the
**`suggestion`** label. Everything else — human-filed work, epics, Projects, planning items — is
**read-only** to the automation, on both GitHub and Linear. A pre-write label gate (`get_issue` →
confirm `suggestion` ∈ labels, else SKIP) enforces this before every mutate.

---

## Free-tier cap and auto-archive

Linear's Free plan caps **active** (non-Done/Canceled/Duplicate) issues at **250**. The workspace is at
or over that cap (the imported suggestion backlog is the bulk of it), so **new-issue creation is blocked
until slots are reclaimed.**

- **Only archiving** frees slots — closing to Done/Canceled does **not** (those still count until
  archived). Archiving is **automatic-only**: the maintainer enables **auto-archive** in Team Settings;
  there is no manual archive in the MCP/UI.
- **Cap remediation** (mass-triaging provably dead/duplicate/obsolete `suggestion` issues to
  Done/Canceled so auto-archive reclaims them) is **confirm-then-act** and **reversible** — never
  hard-delete; Cancel is recoverable and Linear keeps a 30-day restore.
- Going forward, the rebuilt Cursor automation keeps a **conservative net-new budget** and a cap guard
  so the backlog doesn't blow past the limit again.

---

## `/next` (the work-selection command)

[`.claude/commands/next.md`](../../../.claude/commands/next.md) is the canonical entry point: pull the
**Backlog** ranked by **Priority** (Urgent→High→Med→Low; None last), tie-break by lower FRA- number, drop
anything with an open blocked-by relation, don't auto-start Triage items, and **stop if the MCP is
unavailable** (no fallback). It keeps Linear in sync (`In Progress` on start, a `save_comment` trail, the
PR link) and opens the PR with `Fixes FRA-N`.

---

## Cursor automation (current → target)

- **Current (interim):** the single "Suggestion Triage" automation still files/maintains **GitHub**
  `suggestion` issues via `gh` (they sync into Linear). Behavior + config:
  [`CURSOR_AUTOMATIONS.md`](CURSOR_AUTOMATIONS.md) and
  [`.cursor/skills/suggestion-triage.md`](../../../.cursor/skills/suggestion-triage.md). **Recommended to
  pause** during the interim (it opens GitHub-born issues and drives the cap).
- **Target (pending the capability probe):** a **two-automation** system writing to Linear via the
  **native MCP** —
  1. a **daily creation/ideation** pass: conservative net-new budget, files into **Triage**, and ideates
     toward existing Linear **Projects** as well as codebase-at-large engineering/security gaps;
  2. a **triage** pass ~1h later: re-buckets Triage into Projects, sets **Priority**, dedups, and feeds
     the Backlog `/next` consumes.

  This rebuild is **blocked on the probe** in
  [`CURSOR_AUTOMATIONS.md`](CURSOR_AUTOMATIONS.md#pending-native-linear-mcp-migration--capability-probe).
  **No API key** — native MCP, or escalate the blocker.

---

## Maintainer actions (provisioning / activation)

These need a human (account/UI access the cloud sandbox doesn't have):

1. **Linear MCP into the web environment** — so cloud Claude sessions inherit it (already done; this
   session reaches it natively).
2. **Linear MCP into Cursor** — Settings → MCP → Linear one-click (native integration). No `.cursor/mcp.json`.
3. **GitHub App** installed on `pdcarlson/Frapp` (done) — one-way GitHub→Linear sync.
4. **Team Settings:** enable **Triage** and **auto-archive** (keep **Cycles OFF**).
5. **Run the Cursor probe** (in [`CURSOR_AUTOMATIONS.md`](CURSOR_AUTOMATIONS.md#pending-native-linear-mcp-migration--capability-probe))
   and report the matrix back → unblocks the Cursor rebuild.
6. **Delete orphaned labels** in the Linear UI once empty (`agent-ready`, `severity:*`, `blocked`) — the
   MCP can't delete labels.

---

## Sources

- Linear MCP server (endpoint, Claude Code / Cursor setup, OAuth): <https://linear.app/docs/mcp>
- Linear GitHub integration (magic words, branch/PR linking, sync): <https://linear.app/docs/github-integration>
