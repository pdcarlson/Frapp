# Claude Code Routines

Canonical, version-controlled spec for Frapp's scheduled backlog agents, which run as **Claude Code
Routines** (claude.ai/code → the Frapp environment → **Routines**). Routines are configured in the
UI (config-as-code isn't supported), so this file is the source of truth you copy into the UI. Keep
it in sync when you change a routine. History of how backlog automation got here: ADR-16 and its
amendments in [`spec/architecture/README.md`](../../../spec/architecture/README.md).

There are **two** routines, staggered daily, both writing to **Linear** (never GitHub):

| # | Routine | Skill (behavior contract) | When |
| --- | --- | --- | --- |
| 1 | **Linear Issue Curator** | [`.claude/skills/linear-curator/SKILL.md`](../../../.claude/skills/linear-curator/SKILL.md) | daily 08:00 ET |
| 2 | **Linear Triage** | [`.claude/skills/linear-triage/SKILL.md`](../../../.claude/skills/linear-triage/SKILL.md) | daily 09:00 ET (~1h after #1) |

The curator **creates and maintains** `suggestion` issues in Linear's **Triage** inbox. An hour
later the triage routine works **both** the **Triage inbox** (prioritize, bucket, backfill Agent
briefs, dedup, promote to Backlog) **and the existing Backlog** (set sane Priorities in batches —
the main job, since `/next` ranks by Priority and ignores projects — and projectify only suggestions
that *clearly* fit) — feeding clean, ranked work to
[`/next`](../../../.claude/commands/next.md). The routine prompts are thin — the real rules live in
the two skill files, which the routine session loads from the repo.

> **Hard rule (see `AGENTS.md`):** all issues are **opened in Linear**, never GitHub. Work is
> **closed via GitHub PRs** (`Fixes FRA-N`); the Linear–GitHub integration keeps the two in sync.
> These routines never create GitHub issues and never touch product code — their single repo-write
> permission is the [self-maintenance](#self-maintenance-the-update-themselves-contract) docs-only PR.

---

## Linear access (shared by both routines)

Routine sessions run in the Frapp Claude Code web environment, which **injects the native Linear
MCP** — the same path `/next` uses. No API key, no GraphQL helper, no secrets to manage. Each run
starts by loading the Linear MCP tool schemas (via `ToolSearch`) and verifying access (e.g.
`get_team` resolves for **Frapp Live**). **If the MCP is unavailable, the routine stops and reports —
there is no fallback tracker.**

**ID cache (team Frapp Live — verified live 2026-08-03; re-verify with `get_team` /
`list_issue_statuses` / `list_issue_labels` / `list_projects` if anything 404s — always passing
`team:"Frapp Live"`: a bare `list_issue_labels` returns only workspace-level labels and silently
omits the team-scoped `suggestion` + `area:*` labels, which reads as false drift).**

- **Team:** `314e108b-1046-47b3-86de-03f652b75cd3` (key **FRA**)
- **Workflow states:** Triage `a2850363-b7df-4b73-bb9e-d604d84952cd` · Backlog `050d7e98-8ea1-48a2-97d9-5bd64dc6b8b5` · Todo `6429dc31-4dfc-46de-a6b7-df15541e64b2` · In Progress `e511d65d-a745-4bb3-908c-b63ae593daf6` · In Review `6c8ebd0f-b5dd-4f20-8dec-949092a679f0` (type *started* — counts as active) · Done `5b7a5d31-a5b4-4c49-842c-703da7ea6b79` · Canceled `9d624417-4aea-4de7-b42a-841952247f53` · Duplicate `fd6c1d6d-c32c-403f-a079-5d450547153f`
- **Labels:** `suggestion` `8a66aaf4-4ce1-4d60-85f4-124ae9a3d797` · `stale` `870f55fc-bb9e-4f71-8c63-506a75d00992` · `area:api` `b017cbf3-26cb-4433-88a0-9df9a13293c3` · `area:web` `361c705a-e706-45c4-8b8f-be45f0d11bc9` · `area:db` `2e4dad0b-54ff-4c1a-96d8-b0cc98e45f4b` · `area:deps` `85425714-0935-42c3-8439-2aa8c4e649e4` · `area:security` `ef7dabf6-0525-4b4b-b746-206626e2baf8` · `area:ci` `faa1a134-cac7-42dd-af29-fa37231622c4` · `area:docs` `e9a453c0-b22d-4b8b-b030-9fe9521dd145` · `area:product` `774ebfda-efeb-4d0d-b642-c674c723abcd` · `area:ux` `181da3c2-75a4-400b-9c66-cf80921b4f7e` · `area:research` `5b970893-cecc-4a7d-9cf7-c2990d05db1c` (Linear's default `Bug`/`Feature`/`Improvement` labels also exist; the routines don't use them)
- **Projects:** Chat rework `f791b8ee-ba4f-4e93-8543-c8eec06ab43e` · AI features `aab3d43d-480c-4727-9bf7-c9f8d6feafba` · Pricing & billing `bbcfce89-54ff-4b56-b791-2c34c463f459` · Analytics `e0978d9a-8376-4a92-ade7-0fd4e5216b12` · Platform `54493732-d789-4dbb-a161-90190ef951ec` · Security `1726c786-ef16-474c-91cf-b397e2b726d6`

Priority scale: **1 Urgent · 2 High · 3 Medium · 4 Low**. The MCP tools accept `FRA-N` identifiers
for reads; writes go through `save_issue` / `save_comment`.

---

## Settings (per routine, set in the Routines UI)

| Setting | Value | Notes |
|---|---|---|
| Environment | the Frapp Claude Code web environment (`pdcarlson/Frapp`) | Routine sessions clone the repo and load `.claude/` skills from the default branch (`main`) at run time. |
| Schedule | Curator **daily 08:00 ET**; Triage **daily 09:00 ET** | If the UI takes cron in UTC: `0 12 * * *` and `0 13 * * *` during EDT (shift +1h when ET returns to EST). Daily cadence — no per-PR trigger. |
| Model | **Fable** (`claude-fable-5`) | Quality scales with reasoning; use the strongest available model. |
| Session | fresh session per run | Each run re-reads its skill from `main` — no state carried between runs; Linear itself is the memory (markers, labels, comments). |
| Access | **Linear MCP** (injected by the environment) | Plus the repo itself for the curator's engineering/spec lenses. No secrets needed — `LINEAR_API_KEY` is **not** used. |

---

## Labels (Linear)

The taxonomy lives in Linear (see [`LINEAR_PM.md`](LINEAR_PM.md#labels-and-priority-lean-taxonomy)).
Routines use: **`suggestion`** (ownership/dedup/lifecycle anchor), one **`area:<x>`**
(`api`/`web`/`db`/`deps`/`security`/`ci`/`docs`/`product`/`ux`/`research`), and **`stale`** (aging,
can't-prove-resolved). **Severity is the native Priority**, not a label. `type:<gap|improvement|idea>`
is description metadata, not a label. Per-issue execution hints (`depth:` / `model:` / `ultracode:`)
are description metadata too — the **Agent brief**, specified in
[`LINEAR_PM.md` → Agent briefs](LINEAR_PM.md#agent-briefs-depth--model--ultracode).

---

## Routine prompts (copy-paste)

The Routines UI takes a prompt per routine. Keep it thin — it points the session at its skill file,
which holds the real rules. Paste these verbatim.

**Routine 1 — "Linear Issue Curator"** (daily 08:00 ET):

```text
You are the Linear Issue Curator for the Frapp repository — a meticulous engineer and product
thinker who keeps the Linear backlog healthy and high-signal, not just growing. Invoke the
linear-curator skill (.claude/skills/linear-curator/SKILL.md) and follow it EXACTLY: first MAINTAIN
the existing `suggestion` issues in Linear (Done/Canceled only when code or spec/ PROVES it, else
mark `stale`; dedup; refresh drifted bodies; split oversized), then DISCOVER a few high-value new
items across all four lenses (engineering, spec gaps, creative/Projects, runtime signals) and file
them into Linear's TRIAGE inbox via the native Linear MCP, each with an Agent brief (err on
depth:deep). Only ever modify `suggestion`-labeled issues you own — never touch human/planning
issues. NEVER create a GitHub issue; never modify product code (the skill's docs-only
self-maintenance PR is the sole exception). Filing zero new issues is a perfectly good outcome. If
the Linear MCP is unavailable, stop and report. Where this prompt and the skill disagree, the skill
wins. End with the run report the skill specifies.
```

**Routine 2 — "Linear Triage"** (daily 09:00 ET):

```text
You are the Linear Triage agent for the Frapp repository — you keep the board clean so /next always
has good work to pull. Invoke the linear-triage skill (.claude/skills/linear-triage/SKILL.md) and
follow it EXACTLY: process Linear's TRIAGE inbox — dedup, set a Project only where one clearly
fits, set a Priority (required to leave Triage), backfill Agent briefs on `suggestion`-owned items
(err on depth:deep), add blocked-by relations, and promote clearly-actionable items — including
well-formed human-filed ones — to BACKLOG; hold ambiguous items and genuine human decisions in
Triage with a short comment. Then groom a ~25-issue Backlog
batch: sane Priorities first, briefs backfilled, projects only for clear fits. You may organize ANY
Triage item (project/estimate/filling an absent priority — never overwrite a human-set priority),
but only cancel, mark-duplicate, or re-body `suggestion`-owned issues. Use the native Linear MCP;
if it is unavailable, stop and report. NEVER create a GitHub issue; never modify product code (the
skill's docs-only self-maintenance PR is the sole exception). Where this prompt and the skill
disagree, the skill wins. End with the board-health report the skill specifies.
```

---

## How to create them (UI)

1. Open **claude.ai/code** → the Frapp environment → **Routines** → **New routine** → name it
   **"Linear Issue Curator"**.
2. Schedule daily **08:00 ET**; model **Fable**; environment `pdcarlson/Frapp` (`main`).
3. Paste the **Curator** prompt from [Routine prompts](#routine-prompts-copy-paste) above.
4. Repeat for **"Linear Triage"**, scheduled **09:00 ET**, with the **Triage** prompt.
5. Enable both.
6. **One-time teardown of the predecessor:** deactivate the two legacy automations of the same
   names in the retired Cursor dashboard (cursor.com/agents) and revoke their `LINEAR_API_KEY`
   secret — until then they keep firing daily (their skill files no longer exist on `main`) and
   race these Routines with unguarded writes. Delete this step once done.

> Routine sessions read the skills from `main` at run time — merge the branch that adds
> `.claude/skills/linear-curator/` and `.claude/skills/linear-triage/` before enabling them.

## Verify

- **Curator:** run it once manually. Confirm new issues land in **Linear Triage** titled
  `[suggestion] …` with `suggestion` + `area:*` + a Priority + an **Agent brief** + the hidden `fp=`
  marker; run it again → **no duplicates** (legacy `cursor-suggestion` markers also count as
  matches); confirm it Done/Cancels/refreshes/`stale`s existing `suggestion` issues and leaves every
  non-`suggestion` issue untouched (ownership gate holds). **No GitHub issue is created.**
- **Triage:** run it once manually. Confirm Triage items get a Priority (and a Project only where
  one clearly fits) and clearly-actionable ones move to Backlog; ambiguous items and genuine
  human decisions stay in Triage with a comment; nothing human-owned is canceled or re-bodied; the
  run ends with the board-health report.
- Confirm both schedules show a next-run time.

## Self-maintenance (the "update themselves" contract)

**This section is the binding contract — the two skills defer to it.** Both routines end each run
by verifying their own contract against reality — the ID cache above,
the commands their lenses run, the links and file paths they cite, and whether new surfaces (a new
Project, label, spec area, or MCP tool) should change their behavior. On drift:

- **Mechanical drift** → the routine opens a **docs-only PR** restricted to
  `.claude/skills/linear-curator/`, `.claude/skills/linear-triage/`, and this file, on a `claude/…`
  branch through the normal pre-push review gate. At most one per run; the routine never merges it —
  a human does.
- **Judgment-laden drift** → the routine files a `suggestion` issue (`area:docs`) describing the
  change instead.

This is the routines' **only** permitted repo write.

## Maintenance

- Behavior changes go in the two `.claude/skills/linear-*/SKILL.md` files; only re-paste a routine
  prompt if the prompt block itself changes.
- Keep the ID cache above current if states/labels/projects change (self-maintenance automates the
  check).
- Environment notes: [`spec/environments/README.md`](../../../spec/environments/README.md#claude-code-routines-environment).
