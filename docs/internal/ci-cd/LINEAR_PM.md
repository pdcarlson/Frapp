# Linear as the canonical PM system

Canonical, version-controlled design + policy for Frapp's project management on **Linear**, per
**ADR-16** and its cut-over amendment (`spec/architecture/README.md`). Linear is the source of truth for
planning and work status; GitHub issues are an executable layer that **syncs one-way into Linear**.

> **Status: live.** Work tracking lives in **Linear** (team **Frapp Live**, prefix **FRA-**). The in-repo
> `docs/backlog/` tree has been **retired** (git history is the archive); agents start work with `/next`,
> which reads Linear directly. Provisioning is done: 6 Projects created, the 7 `[Epic]` parents assigned,
> `severity:*` migrated to **Priority**, and dead suggestions closed for auto-archive. **One thing is not
> keyless:** the Cursor *background* suggestion automation has **no Linear MCP in its headless
> environment** (proven by probe), so it still files GitHub `suggestion` issues (which sync in) until its
> Linear MCP is set up — see [Cursor automation](#cursor-automation-current--target).

---

## The model

```
Linear (canonical: planning, status, board, Triage intake)
   ▲ Claude Code (web) via the injected NATIVE Linear MCP — the path /next uses
   ▲ Cursor automations (headless) via LINEAR_API_KEY → Linear GraphQL API (no MCP in that env)
   ▲ GitHub PRs close work (Fixes FRA-N); the Linear–GitHub integration keeps issues in sync
```

- **Linear is canonical** for what to work on and its status. Humans plan on the board; Claude reads/writes
  Linear through the native MCP. There is **no GitHub read-fallback** — if the MCP is down, `/next`
  stops rather than reading a stale tracker.
- **All issues are opened in Linear; never GitHub.** Work is closed via GitHub PRs (`Fixes FRA-N`, plus
  `Closes #N` for a legacy GitHub twin); the integration syncs the two.
- **Epics are Linear Projects.** The imported `[Epic]` parents (FRA-154…FRA-160) stay as parent issues
  with sub-issues, assigned to the relevant Project. **No Initiatives, no Cycles.**
- **Triage is the intake.** New work — whether a human files it, `/next` files a follow-up, or the Cursor
  automation files a suggestion — lands in the **Triage** inbox and is accepted into **Backlog** before
  `/next` will auto-start it.
- **Issues are born in Linear.** Opening work directly as a GitHub issue is **not** the path; file in
  Linear (`save_issue` into Triage).

### How agents reach Linear

| Actor | Reaches Linear via | Notes |
| --- | --- | --- |
| **Claude Code** (web) | **Native Linear MCP**, injected by the web environment | No `gh` CLI in the web sandbox; MCP is the only path. No fallback tracker. |
| **Cursor automations** (headless) | **`LINEAR_API_KEY` → Linear GraphQL API** | A probe proved the Cursor *background* environment has **no Linear MCP** and no Linear creds, so the two automations authenticate with a `LINEAR_API_KEY` (a Cursor cloud-agent secret) against `https://api.linear.app/graphql`. Transport-agnostic — if a Cursor build later exposes a Linear MCP to background agents with that key, the skills can use it. See [`CURSOR_AUTOMATIONS.md`](CURSOR_AUTOMATIONS.md). |
| **Cursor** (interactive IDE) | Cursor's native Linear integration / MCP | For a human in the IDE; not the automation path. |
| **GitHub** | Linear's **native GitHub integration** (the GitHub App) | PR/branch/status sync; PRs close issues via `Fixes FRA-N` / `Closes #N`. |

`.mcp.json.example` is a local-reference block only (plain OAuth URL, no token) for the **Claude** side.
**Do not** commit a root `.mcp.json` — the web environment already injects the Linear MCP for Claude and a
committed file would double-register it. The Cursor automations don't use it (they use the API key).

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

The Cursor automations (curator + triage) may only modify issues they own — those carrying the
**`suggestion`** label. Everything else — human-filed work, epics, Projects, planning items — is
**read-only** to the automation, on both GitHub and Linear. A pre-write label gate (`get_issue` →
confirm `suggestion` ∈ labels, else SKIP) enforces this before every mutate.

---

## Free-tier cap and auto-archive

Linear's Free plan caps **active** (non-archived) issues at **250**; **archived issues are unlimited and
don't count.** The imported suggestion backlog put the workspace near the cap.

- **Auto-archive is automatic and free** — Linear archives **Done after ~28 days** and **Canceled after
  ~7 days** by default (tunable under *Team Settings → Issue statuses & automations*). So **closing
  reclaims a slot on that schedule, with no toggle to flip.** Archived issues stay searchable.
- **Cap remediation** = close provably dead/duplicate/obsolete `suggestion` issues to **Done/Canceled**;
  they auto-archive and free slots (e.g. a Canceled issue in ~7 days). Reversible — never hard-delete.
- The **curator** automation keeps a **conservative net-new budget** plus a **cap guard** (file nothing
  when near 250, consolidate instead) so the backlog doesn't blow past the limit again.

---

## Estimates & Triage intake

- The team uses **Fibonacci estimates** (0,1,2,3,5,8,13,21). Estimates are optional context for sizing —
  `/next` surfaces an issue's estimate when shortlisting; they are **not** a filter or a gate.
- **Triage is on**, and the team **requires an explicit Priority to move an issue out of Triage.** So
  anything promoting Triage → Backlog (the Cursor triage automation, or a human/`/next`) **must set a
  Priority** first. The curator sets a Priority on every issue it files; the triage automation sets
  Priority (and may set an estimate) as it buckets and promotes.

## `/next` (the work-selection command)

[`.claude/commands/next.md`](../../../.claude/commands/next.md) is the canonical entry point: pull the
**Backlog** ranked by **Priority** (Urgent→High→Med→Low; None last), tie-break by lower FRA- number, drop
anything with an open blocked-by relation, don't auto-start Triage items, and **stop if the MCP is
unavailable** (no fallback). It keeps Linear in sync (`In Progress` on start, a `save_comment` trail, the
PR link) and opens the PR with `Fixes FRA-N`.

---

## Cursor automations (two, Linear-native via the API key)

Two staggered daily automations, both writing to **Linear** via the **`LINEAR_API_KEY`** (Linear GraphQL).
Full config + the shared Linear API primitives: [`CURSOR_AUTOMATIONS.md`](CURSOR_AUTOMATIONS.md).

1. **Linear Issue Curator** ([`.cursor/skills/linear-curator.md`](../../../.cursor/skills/linear-curator.md))
   — daily. Maintains `suggestion` issues (Done/Cancel provable, else `stale`; dedup; refresh; split), then
   discovers ≤3 net-new (conservative budget + cap guard) and files them into **Triage** with a Priority,
   one `area:<x>`, and a dedup fingerprint. Ideates against existing **Projects** as well as codebase gaps.
2. **Linear Triage** ([`.cursor/skills/linear-triage.md`](../../../.cursor/skills/linear-triage.md))
   — ~1h later. Processes the **Triage** inbox: dedup, set **Project** + **Priority**, add relations, and
   promote clearly-actionable work to **Backlog** for `/next`. Organizes broadly; cancels/dedups only
   `suggestion`-owned issues; surfaces human-filed items rather than auto-deciding them.

**Ownership** (both): destructive actions only on `suggestion`-labeled issues; human/planning issues are
read-only. **Never create GitHub issues; never touch code.** Issues are born in Linear.

---

## Maintainer actions (provisioning / activation)

These need a human (account/UI access the cloud sandbox doesn't have):

1. **Linear MCP into the web environment** — so cloud Claude sessions inherit it (done; `/next` uses it).
2. **`LINEAR_API_KEY` into Cursor cloud agents** — a Linear personal API key as a Cursor secret, for the
   two automations (done). Stand up the **Linear Issue Curator** and **Linear Triage** automations per
   [`CURSOR_AUTOMATIONS.md`](CURSOR_AUTOMATIONS.md) and run each once to verify they create/organize issues
   in Linear unattended (no GitHub issues created).
3. **GitHub App** installed on `pdcarlson/Frapp` (done) — keeps issues/PRs in sync; PRs close work.
4. **Team Settings:** **Triage** on with *require explicit prioritization* (done); **Estimates** =
   Fibonacci (done); **Cycles OFF**. Auto-archive runs by default (28d Done / 7d Canceled) under *Issue
   statuses & automations* — tune if desired.
5. **Delete orphaned labels** in the Linear UI once empty (`enhancement` after the fold, plus already-done
   `agent-ready` / `severity:*` / `blocked`) — the MCP/API can't delete labels.

---

## Sources

- Linear MCP server (endpoint, Claude Code / Cursor setup, OAuth): <https://linear.app/docs/mcp>
- Linear GitHub integration (magic words, branch/PR linking, sync): <https://linear.app/docs/github-integration>
