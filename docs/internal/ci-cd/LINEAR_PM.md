# Linear as the canonical PM system

Canonical, version-controlled design + policy for Frapp's project management on **Linear**, per
**ADR-16** and its cut-over amendment (`spec/architecture/README.md`). Linear is the source of truth for
planning and work status; GitHub issues are an executable layer that **syncs one-way into Linear**.

> **Status: live.** Work tracking lives in **Linear** (team **Frapp Live**, prefix **FRA-**). The in-repo
> `docs/backlog/` tree has been **retired** (git history is the archive); agents start work with `/next`,
> which reads Linear directly. Provisioning is done: 6 Projects created, the 7 `[Epic]` parents assigned,
> `severity:*` migrated to **Priority**, and dead suggestions closed for auto-archive. **One thing is not
> keyless:** the Cursor *background* automations have **no Linear MCP in their headless environment**
> (proven by probe), so they write to Linear with a **`LINEAR_API_KEY`** via the GraphQL API — see
> [Cursor automations](#cursor-automations-two-linear-native-via-the-api-key).

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
| **Cursor automations** (headless) | **`LINEAR_API_KEY` → Linear GraphQL API** | A probe proved the Cursor *background* environment has **no Linear MCP** and no Linear creds, so the two automations authenticate with a `LINEAR_API_KEY` (a Cursor cloud-agent secret) against `https://api.linear.app/graphql`. Transport-agnostic — if a Cursor build later exposes a Linear MCP to background agents, the skills can use it instead. See [`CURSOR_AUTOMATIONS.md`](CURSOR_AUTOMATIONS.md). |
| **Cursor** (interactive IDE) | Cursor's native Linear integration / MCP | For a human in the IDE; not the automation path. |
| **GitHub** | Linear's **native GitHub integration** (the GitHub App) | PR/branch/status sync; PRs close issues via `Fixes FRA-N` / `Closes #N`. |

`.mcp.json.example` is a local-reference block only (plain OAuth URL, no token) for the **Claude** side.
**Do not** commit a root `.mcp.json` — the web environment already injects the Linear MCP for Claude and a
committed file would double-register it. The Cursor automations don't use it (they use the API key).

---

## Opening and closing work (Linear ↔ GitHub)

Issues are **opened in Linear** (never GitHub). The **common** close path is the **PR that does the work**;
Linear's GitHub integration (the GitHub App on `pdcarlson/Frapp`) keeps linked issues/PRs in sync (status,
branch, comments, assignee). Agents may also **close an issue directly** — as a duplicate, stale, or
obsolete — without a PR; prefer closing on the **GitHub** side when the issue has a GitHub presence (sync
carries it to Linear), and close Linear-native issues in Linear (Done/Canceled).

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

Linear's Free plan caps **active** issues at **250** — and **"active" is a precise Linear term**: per
Linear's docs ([Default team pages](https://linear.app/docs/default-team-pages)), Active means the
**Started + Unstarted** status categories (here **In Progress** + **Todo**), and **explicitly not Backlog,
Completed, or Canceled**. So **Backlog and archived issues do *not* count toward the 250** — the Backlog is
effectively unbounded for our purposes.

> **Measured 2026-06-03 (this workspace, Free plan):** 276 *non-archived* issues — **260 Backlog**, ~2
> active (Started+Unstarted), 1 Triage, 10 Done, 3 Canceled — and **new-issue creation still succeeds**
> (FRA-280 was filed at 276 non-archived). Being well over 250 non-archived with creation working *proves*
> the cap binds on **active**, not on total / non-archived / Backlog. (Linear's billing copy says "250
> issues" unqualified, but their Active-vs-Backlog definition and our live workspace both show Backlog is
> exempt.)

- **The binding number is *active*, and `/next` keeps it tiny** — each session holds **one** claim at a
  time (`In Progress`, then `In Review` once its PR is open), so active tracks the number of concurrent
  sessions plus open PRs: a handful, even when work is fanned out across parallel agents. The claim
  protocol's stale sweep also returns leaked `In Progress` issues to Backlog, which *lowers* active.
  There is no realistic risk of hitting 250 active.
- **Backlog stays lean by *choice*, not platform limit** — a high-signal, groomable Backlog is a
  *quality* goal (so `/next` ranks real work first), not cap avoidance. See the curator's net-new budget below.
- **Auto-archive is automatic and free** — Linear archives **Done after ~28 days** and **Canceled after
  ~7 days** by default (tunable under *Team Settings → Issue statuses & automations*); archived issues stay
  searchable. This keeps the *board* tidy; it is **not** load-bearing for the cap (active is already far below 250).
- The **curator** automation keeps a **conservative net-new budget** plus a **cap guard that counts
  *active* (Started+Unstarted)** — not the Backlog or the open-`suggestion` set — so it never throttles
  filing just because the Backlog is large.

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
**Backlog** (and **Todo**) ranked by **Priority** (Urgent→High→Med→Low; None last), tie-break by lower
FRA- number, drop anything with an open blocked-by relation, don't auto-start Triage items, and **stop if
the MCP is unavailable** (no fallback). It keeps Linear in sync (`In Progress` on start, a `save_comment`
trail, the PR link) and opens the PR with `Fixes FRA-N`.

**`/next` claims an issue before it touches anything, so several sessions can run it concurrently.** This
is the design that lets work fan out across parallel agents without two of them building the same issue.

- **The claim is a comment; the workflow state is a projection of it.** Linear has no compare-and-swap —
  `save_issue` is last-write-wins and cannot be used as a lock. `/next` posts an `AGENT-CLAIM` carrying a
  run-unique `claim_id`, *then* moves the issue to **In Progress**, then re-reads the stream and yields to
  any **strictly earlier** live claim. Contests resolve on Linear's server `createdAt`, never on a
  timestamp written into a comment body. Yielding only to a strictly earlier claim is what keeps two
  agents from both backing off.
- **Claim first, verify second.** Selection and claim happen before the expensive verification, which
  then runs against work the agent already owns. The old order — verify, then mark In Progress — left a
  minutes-long window in which two agents could both pick the same issue.
- **Assignee is not a claim signal.** Every issue in Frapp Live is assigned to Paul Carlson, including
  every issue an agent is actively working, and `gitBranchName` is auto-suggested on every issue whether
  or not a branch exists. The only evidence of live work is a live claim comment, a branch named in one,
  or a linked PR.
- **Leases and leaked claims.** A claim carries a **4-hour** lease renewed by editing the claim comment at
  each checkpoint. An expired lease with no linked PR and no recently pushed branch may be taken over with
  an `AGENT-RECLAIM`. An issue In Progress for over **72 hours** with no claim comment and no linked PR is
  abandoned: `/next` posts an `AGENT-STALE-FLAG` and returns it to **Backlog** without picking it up, at
  most twice per run. (FRA-38 and FRA-290 sat In Progress from June to August under the old command —
  leaked claims are the observed failure mode this replaces, not a hypothetical.)
- **Autonomy.** `/next` auto-picks rank 1 rather than asking which issue to work, and asks only about
  **intent** — one-way doors on product naming or copy, destructive or irreversible changes, a spec that
  no longer matches reality, scope explosion, or nothing viable. Anything recoverable by reading the
  resulting PR is the agent's call. `/next --plan-only N` emits N ready-to-paste `/next FRA-xxx` prompts
  and writes nothing to Linear, so a batch of sessions can be spun up without leaking N claims.
- **Ending a run.** A run ends by opening a PR and moving to **In Review**, or by posting an
  `AGENT-RELEASE` (back to Backlog, or Triage with a Priority if underspecified) or an `AGENT-HANDOFF`
  (work exists; the claim stays live for a successor). Reasons are a closed set: `plan-rejected`,
  `user-aborted`, `lost-race`, `blocked-discovered`, `out-of-scope`, `superseded`, `session-ending`. An
  issue left silently In Progress is a bug.

Procedure lives in `.claude/commands/next.md`; this section is policy. Where they disagree, this document
wins.

---

## Cursor automations (two, Linear-native via the API key)

Two staggered daily automations, both writing to **Linear** via the **`LINEAR_API_KEY`** (Linear GraphQL).
Full config + the shared Linear API primitives: [`CURSOR_AUTOMATIONS.md`](CURSOR_AUTOMATIONS.md).

1. **Linear Issue Curator** ([`.cursor/skills/linear-curator.md`](../../../.cursor/skills/linear-curator.md))
   — daily. Maintains `suggestion` issues (Done/Cancel provable, else `stale`; dedup; refresh; split), then
   discovers ≤3 net-new (conservative budget + cap guard) and files them into **Triage** with a Priority,
   one `area:<x>`, and a dedup fingerprint. Ideates against existing **Projects** as well as codebase gaps.
2. **Linear Triage** ([`.cursor/skills/linear-triage.md`](../../../.cursor/skills/linear-triage.md))
   — ~1h later. Two jobs: **(A)** process the **Triage** inbox (dedup, set Project + Priority, promote to
   Backlog), and **(B)** groom the existing **Backlog** in ~25-issue batches — set a sane **Priority**
   (the main job, since `/next` ranks by Priority and ignores projects) and assign a **Project** only when
   a suggestion *clearly* fits one (most suggestions stay projectless by design — no force-bucketing).
   Organizes broadly; cancels/dedups only `suggestion`-owned issues; surfaces human-filed items rather than deciding them.

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
