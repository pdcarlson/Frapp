# Linear as the canonical PM system

Canonical, version-controlled design + policy for Frapp's project management on **Linear**, per
**ADR-16** and its cut-over amendment (`spec/architecture/README.md`). Linear is the source of truth for
planning and work status; GitHub issues are an executable layer that **syncs one-way into Linear**.

> **Status: live.** Work tracking lives in **Linear** (team **Frapp Live**, prefix **FRA-**). The in-repo
> `docs/backlog/` tree has been **retired** (git history is the archive); agents start work with `/next`,
> which reads Linear directly. Provisioning is done: 6 Projects created, the 7 `[Epic]` parents assigned,
> `severity:*` migrated to **Priority**, and dead suggestions closed for auto-archive. Every actor is
> **keyless**: interactive sessions and the scheduled backlog routines alike reach Linear through the
> **native Linear MCP** injected by the Claude Code web environment — see
> [Claude Code routines](#claude-code-routines-three-linear-native-via-the-mcp).

---

## The model

```
Linear (canonical: planning, status, board, Triage intake)
   ▲ Claude Code (web) via the injected NATIVE Linear MCP — the path /next uses
   ▲ Claude Code Routines (scheduled: curator + triage + PR follow-ups) via the same injected Linear MCP
   ▲ GitHub PRs close work (Fixes FRA-N); the Linear–GitHub integration keeps issues in sync
```

- **Linear is canonical** for what to work on and its status. Humans plan on the board; Claude reads/writes
  Linear through the native MCP. There is **no GitHub read-fallback** — if the MCP is down, `/next`
  stops rather than reading a stale tracker.
- **All issues are opened in Linear; never GitHub.** Work is closed via GitHub PRs (`Fixes FRA-N`, plus
  `Closes #N` for a legacy GitHub twin); the integration syncs the two.
- **Epics are Linear Projects.** The imported `[Epic]` parents (FRA-154…FRA-160) stay as parent issues
  with sub-issues, assigned to the relevant Project. **No Initiatives, no Cycles.**
- **Triage is the intake.** New work — whether a human files it, `/next` files a follow-up, or the
  curator routine files a suggestion — lands in the **Triage** inbox and is accepted into **Backlog**
  before `/next` will auto-start it. One deliberate carve-out: a `/next` run that fixes a defect it
  discovered on its own branch may file the issue and claim it in the same breath (see the batching
  rules below) — that is record-keeping for work already underway, not auto-starting inbox work.
- **Issues are born in Linear.** Opening work directly as a GitHub issue is **not** the path; file in
  Linear (`save_issue` into Triage).

### How agents reach Linear

| Actor | Reaches Linear via | Notes |
| --- | --- | --- |
| **Claude Code** (web, interactive) | **Native Linear MCP**, injected by the web environment | No `gh` CLI in the web sandbox; MCP is the only path. No fallback tracker. |
| **Claude Code Routines** (scheduled) | The **same injected Linear MCP** — routine sessions run in the same web environment | The three backlog routines (curator + triage + weekly PR follow-ups; the harvester also reads PRs via the GitHub MCP). If the MCP is unavailable at fire time, the routine stops and reports — no key fallback. See [`ROUTINES.md`](ROUTINES.md). |
| **GitHub** | Linear's **native GitHub integration** (the GitHub App) | PR/branch/status sync; PRs close issues via `Fixes FRA-N` / `Closes #N`. |

`.mcp.json.example` is a local-reference block only (plain OAuth URL, no token). **Do not** commit a
root `.mcp.json` — the web environment already injects the Linear MCP and a committed file would
double-register it.

---

## Opening and closing work (Linear ↔ GitHub)

Issues are **opened in Linear** (never GitHub). The **common** close path is the **PR that does the work**;
Linear's GitHub integration (the GitHub App on `pdcarlson/Frapp`) keeps linked issues/PRs in sync (status,
branch, comments, assignee). Agents may also **close an issue directly** — as a duplicate, stale, or
obsolete — without a PR; prefer closing on the **GitHub** side when the issue has a GitHub presence (sync
carries it to Linear), and close Linear-native issues in Linear (Done/Canceled).

- A **Linear-native** issue is closed by a PR with the magic word **`Fixes FRA-N`** (also
  `Closes`/`Resolves FRA-N`) in the PR title/body — on merge, Linear transitions `FRA-N` to **Done**.
  A batched PR carries **one magic-word line per issue it closes**; each transitions independently.
  (Multiple references per PR are documented by Linear but were not yet observed here at adoption —
  the first batched merge verifies every member transitioned rather than assuming it.)
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
- **`suggestion`** is the routine-ownership marker (which issues the backlog routines own) — keep it.
- **`stale`** marks an aging suggestion that can't be *proven* resolved — kept, left open for review.
- **Dropped:** `agent-ready` (no longer used to gate `/next`); `blocked` (express dependencies as
  **blocked-by relations** instead); `enhancement` folds into Linear's `Improvement`.

---

## Ownership boundary (organize broadly, destroy narrowly)

The backlog routines (curator, triage, and the weekly PR follow-ups harvester) split writes into two classes:

- **Destructive writes** — cancel, mark-duplicate, re-body (including adding an Agent brief) — are
  allowed **only** on issues the routines own: those carrying the **`suggestion`** label. A
  pre-write label gate (`get_issue` → confirm `suggestion` ∈ labels, else SKIP) enforces this before
  every destructive mutate. Human-filed work is never canceled or re-bodied by a routine.
- **Organizational writes** — setting Project, estimate, blocked-by relations, promoting
  Triage → Backlog, and **filling an *absent* Priority** — are the triage routine's job **on any
  Triage item**, whoever filed it (that's what an inbox is for). A **human-set Priority is never
  overwritten**; routines correct obviously-wrong priorities only on `suggestion`-owned issues.
  Epics, Project structure, and planning items remain read-only: routines never restructure them.

The curator additionally touches only its own `suggestion` issues, full stop — its boundary is the
strict one.

---

## Free-tier cap and auto-archive

Linear's Free plan caps **active** issues at **250** — and **"active" is a precise Linear term**: per
Linear's docs ([Default team pages](https://linear.app/docs/default-team-pages)), Active means the
**Started + Unstarted** status categories (here **In Progress** + **In Review** + **Todo**), and
**explicitly not Backlog, Completed, or Canceled**. So **Backlog and archived issues do *not* count toward the 250** — the Backlog is
effectively unbounded for our purposes.

> **Measured 2026-06-03 (this workspace, Free plan):** 276 *non-archived* issues — **260 Backlog**, ~2
> active (Started+Unstarted), 1 Triage, 10 Done, 3 Canceled — and **new-issue creation still succeeds**
> (FRA-280 was filed at 276 non-archived). Being well over 250 non-archived with creation working *proves*
> the cap binds on **active**, not on total / non-archived / Backlog. (Linear's billing copy says "250
> issues" unqualified, but their Active-vs-Backlog definition and our live workspace both show Backlog is
> exempt.)

- **The binding number is *active*, and `/next` keeps it tiny** — each session holds **one claimed
  unit** at a time: usually a single issue, at most a small batch (cap 3, see below), plus up to one
  pipelined unit while a PR is open. Active therefore tracks sessions × a small constant (worst
  case ~6 per session: two 3-member units) plus open PRs — even ten concurrent sessions sit far
  below the 250-active cap. The claim
  protocol's stale sweep also returns leaked `In Progress` issues to Backlog, which *lowers* active.
  There is no realistic risk of hitting 250 active.
- **Backlog stays lean by *choice*, not platform limit** — a high-signal, groomable Backlog is a
  *quality* goal (so `/next` ranks real work first), not cap avoidance. See the curator's net-new budget below.
- **Auto-archive is automatic and free** — Linear archives **Done after ~28 days** and **Canceled after
  ~7 days** by default (tunable under *Team Settings → Issue statuses & automations*); archived issues stay
  searchable. This keeps the *board* tidy; it is **not** load-bearing for the cap (active is already far below 250).
- The **curator** routine keeps a **conservative net-new budget** plus a **cap guard that counts
  *active* (Started+Unstarted)** — not the Backlog or the open-`suggestion` set — so it never throttles
  filing just because the Backlog is large.

---

## Estimates & Triage intake

- The team uses **Fibonacci estimates** (0,1,2,3,5,8,13,21). Estimates are optional context for sizing —
  `/next` surfaces an issue's estimate when shortlisting; they are **not** a filter or a gate.
- **Triage is on**, and the team **requires an explicit Priority to move an issue out of Triage.** So
  anything promoting Triage → Backlog (the triage routine, or a human/`/next`) **must set a
  Priority** first. The curator sets a Priority on every issue it files; the triage routine sets
  Priority (and may set an estimate) as it buckets and promotes.

## Agent briefs (depth / model / ultracode)

Issues on this board are executed by agents, so an issue's description may carry a machine-readable
**Agent brief** — a `### Agent brief` section:

```markdown
### Agent brief
`depth:<skim|standard|deep>` · `model:<fable|any>` · `ultracode:<yes|no>`
<optional one line on where the depth should go>
```

- **`depth`** — how far past the literal ask the executing agent should investigate. `skim`: a
  genuinely mechanical change (rename, version bump, copy fix) — the protocol floors of each step
  suffice. `standard`: well-bounded, single-surface work. `deep`: load the surrounding subsystem,
  verify against spec **and** runtime, hunt adjacent defects, and widen review. **Default is
  `deep`** — an absent brief or field means `deep`. Calibrate by erring deeper: the cost of an agent
  over-investigating is minutes; the cost of under-investigating is a wrong PR.
- **`model`** — suggested model tier for the session that picks the issue up (`fable` for
  cross-cutting, architectural, security-sensitive, or subtle-correctness work; `any` otherwise).
  Advisory, read at session spin-up — a running session never switches models.
- **`ultracode`** — whether multi-agent orchestration is likely to pay for itself on this issue
  (wide verification surface, many independent files, adversarial review worth the tokens).

**Who writes it:** the curator files every suggestion with a brief; the triage routine backfills
and corrects briefs on `suggestion`-owned issues. **Human-filed issues get a brief only from a
human** — agents never re-body them, and an absent brief simply reads as `depth:deep`. **Who reads
it:** `/next` honors `depth` when scaling verification and review (never skipping steps, never
shrinking `/diff-review`), and surfaces `model:`/`ultracode:` at session spin-up — `--plan-only`
prefixes an emitted prompt with `ultracode` when the brief says `ultracode:yes`.

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
- **Agent briefs are honored, not required.** `/next` surfaces the issue's
  [Agent brief](#agent-briefs-depth--model--ultracode) as sizing context when shortlisting (like the
  estimate) and honors it after claiming, per that section's "who reads it" rules. No brief means
  `depth:deep`.
- **Autonomy.** `/next` auto-picks rank 1 rather than asking which issue to work, and asks only about
  **intent** — one-way doors on product naming or copy, destructive or irreversible changes, a spec that
  no longer matches reality, scope explosion, or nothing viable. Anything recoverable by reading the
  resulting PR is the agent's call. `/next --plan-only N` emits N ready-to-paste `/next FRA-xxx` prompts
  and writes nothing to Linear, so a batch of sessions can be spun up without leaking N claims.
- **Batching, discovery, and pipelining.** A run claims one coherent **unit**: usually a single
  issue, at most a small batch (**cap 3 elective members, combined estimate ≤ 8**; any issue
  estimated ≥ 5 runs solo; an inseparable parent+sub-issue unit is exempt from the member cap but
  not the ceiling) of same-root-cause, same-subsystem, or mechanically-kin issues that ship as
  **one branch, one PR** with one `Fixes FRA-N` line per member. Claims are posted per member —
  same `claim_id`, global rank order, all before implementation — and races or vetoes excise
  members rather than aborting the batch wholesale; when the excised member was the batch's point,
  each remaining member is released per its own exit row (what is never permitted is shipping an
  incoherent rump, or rebuilding a lost member against its race winner). Any defect discovered
  mid-run is **fixed in-branch or filed to Triage with a Priority — never dropped**; a fixed defect
  that warrants its own record is filed *and* claimed into the batch so the PR closes it
  (record-keeping claims sit outside the caps, which bound planned scope). After a merge, a
  context-healthy session may loop to claim its next unit; while babysitting an open PR — under the
  same context bar — it may pipeline **at most one** additional unit on a fresh from-`main` branch.
  Procedure, caps, and the verified pipelining hazards live in `.claude/commands/next.md`.
- **Ultracode scales depth, not scope.** `/next ultracode` runs the command's enumerated fan-out points
  (blocker verification, spec-vs-code verification, the pre-push review lenses, and — only when its
  three qualifying conditions hold — the command's narrow parallel-implementation exception) as
  multi-agent **Workflow** orchestrations instead of inline checks — same steps, same Linear writes,
  more independent eyes per step. The command text itself is the opt-in: the harness `ultracode`
  keyword scan runs only on the human-typed, pre-expansion prompt and skips any input starting with
  `/` (read out of the 2.1.220 build, same provenance discipline as the `/code-review` rule —
  re-verify on newer builds), so it never fires on a slash-command turn and the agent must not wait
  for a system-reminder to confirm it. Workflow launches auto-approve via `.claude/settings.json`
  (see [`AGENT_INFRA.md`](AGENT_INFRA.md) "Claude Code project settings"); a launch that prompts or
  is refused anyway falls back inline — same steps, same writes. Plain `/next` stays inline and cheap.
- **Ending a run.** A run ends by opening a PR and moving **every claimed member** to **In Review**
  (after which it may loop or pipeline per the batching bullet), or by posting an `AGENT-RELEASE`
  (back to Backlog, or Triage with a Priority if underspecified) or an `AGENT-HANDOFF` (work exists;
  the claim stays live for a successor) — **per member**: a release on one batch member frees that
  member only. Reasons are a closed set: `plan-rejected`, `user-aborted`, `lost-race`,
  `blocked-discovered`, `out-of-scope`, `superseded`, `session-ending`. An issue left silently In
  Progress is a bug.

Procedure lives in `.claude/commands/next.md`; this section is policy. Where they disagree, this document
wins.

---

## Claude Code routines (three, Linear-native via the MCP)

Three **Claude Code Routines** — two staggered daily, one weekly — all writing to **Linear** via the
**native Linear MCP** injected by the web environment (keyless — no `LINEAR_API_KEY`). Full config +
paste-ready prompts: [`ROUTINES.md`](ROUTINES.md).

1. **Linear Issue Curator** ([`.claude/skills/linear-curator/SKILL.md`](../../../.claude/skills/linear-curator/SKILL.md))
   — daily. Maintains `suggestion` issues (Done/Cancel provable, else `stale`; dedup; refresh; split), then
   discovers ≤3 net-new (conservative budget + cap guard) across four lenses — engineering gaps, spec
   gaps, creative/Projects, and live runtime signals (Sentry/Supabase advisors/CI, when available) — and
   files them into **Triage** with a Priority, one `area:<x>`, an **Agent brief**, and a dedup fingerprint.
2. **Linear Triage** ([`.claude/skills/linear-triage/SKILL.md`](../../../.claude/skills/linear-triage/SKILL.md))
   — ~1h later. Two jobs: **(A)** process the **Triage** inbox (dedup, set Project + Priority, backfill
   Agent briefs, promote to Backlog), and **(B)** groom the existing **Backlog** in ~25-issue batches —
   set a sane **Priority** (the main job, since `/next` ranks by Priority and ignores projects) and assign
   a **Project** only when a suggestion *clearly* fits one (most suggestions stay projectless by design —
   no force-bucketing). Organizes broadly; cancels/dedups only `suggestion`-owned issues; surfaces
   human-filed items rather than deciding them. Ends with a board-health report.
3. **PR Follow-ups** ([`.claude/skills/pr-followups/SKILL.md`](../../../.claude/skills/pr-followups/SKILL.md))
   — weekly, Monday before the daily pair. Audits previously harvested items against reality (close only
   on proof), sweeps recent + progressively older PRs for human-action and deferred items ("Flagged for
   review" sections, agent-stated TODOs, unresolved review threads), researches how each gets done, and
   files them into **Triage** (`[pr-followup]` / `[pr-followup][human]`, `suggestion`-labeled,
   `fp=pr-followup/…` dedup markers). Human-action items stay held in Triage; agent-doable ones flow to
   `/next` via the normal pipeline. Publishes the **"PR Follow-ups — Human Action List"** Linear document
   from live issue state — check-off is issue state, not a list kept anywhere else.

**Ownership** (all three): destructive actions only on `suggestion`-labeled issues; human/planning issues are
read-only. **Never create GitHub issues; never touch product code** — the sole repo-write exception is
the docs-only self-maintenance PR defined in [`ROUTINES.md`](ROUTINES.md), which is how the routines keep
their own contracts current. Issues are born in Linear.

---

## Maintainer actions (provisioning / activation)

These need a human (account/UI access the cloud sandbox doesn't have):

1. **Linear MCP into the web environment** — so cloud Claude sessions (interactive and routine alike)
   inherit it (done; `/next` uses it).
2. **Stand up the three Routines** — create the **Linear Issue Curator**, **Linear Triage**, and
   **PR Follow-ups** Routines per [`ROUTINES.md`](ROUTINES.md) and run each once to verify they
   create/organize issues in Linear unattended (no GitHub issues created). No secrets needed — the old `LINEAR_API_KEY`
   automation secret is retired and can be revoked.
3. **GitHub App** installed on `pdcarlson/Frapp` (done) — keeps issues/PRs in sync; PRs close work.
4. **Team Settings:** **Triage** on with *require explicit prioritization* (done); **Estimates** =
   Fibonacci (done); **Cycles OFF**. Auto-archive runs by default (28d Done / 7d Canceled) under *Issue
   statuses & automations* — tune if desired.
5. **Delete orphaned labels** in the Linear UI once empty (`enhancement` after the fold, plus already-done
   `agent-ready` / `severity:*` / `blocked`) — the MCP/API can't delete labels.

---

## Sources

- Linear MCP server (endpoint, Claude Code setup, OAuth): <https://linear.app/docs/mcp>
- Linear GitHub integration (magic words, branch/PR linking, sync): <https://linear.app/docs/github-integration>
