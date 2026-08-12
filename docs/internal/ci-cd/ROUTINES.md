# Claude Code Routines

Canonical, version-controlled spec for Frapp's scheduled backlog agents, which run as **Claude Code
Routines** (claude.ai/code → the Frapp environment → **Routines**). Routines are configured in the
UI (config-as-code isn't supported), so this file is the source of truth you copy into the UI. Keep
it in sync when you change a routine. History of how backlog automation got here: ADR-16 and its
amendments in [`spec/architecture/README.md`](../../../spec/architecture/README.md); the
Linear-to-GitHub migration record is [#680](https://github.com/pdcarlson/Frapp/issues/680).

There are **three** routines — two staggered daily, one weekly — all writing to **GitHub Issues**
on `pdcarlson/Frapp` (Linear is retired):

| # | Routine | Skill (behavior contract) | When |
| --- | --- | --- | --- |
| 1 | **Issue Curator** | [`.claude/skills/issue-curator/SKILL.md`](../../../.claude/skills/issue-curator/SKILL.md) | daily 08:00 ET |
| 2 | **Issue Triage** | [`.claude/skills/issue-triage/SKILL.md`](../../../.claude/skills/issue-triage/SKILL.md) | daily 09:00 ET (~1h after #1) |
| 3 | **PR Follow-ups** | [`.claude/skills/pr-followups/SKILL.md`](../../../.claude/skills/pr-followups/SKILL.md) | weekly Mon 07:00 ET (a full hour before #1–2 that morning) |

The curator **creates and maintains** `suggestion` issues in the **`triage`** inbox. An hour later
the triage routine works **both** the **`triage` inbox** (prioritize, bucket, backfill Agent
briefs, dedup, promote to Backlog) **and the existing Backlog** (set sane priority labels in
batches — the main job, since `/next` ranks by priority — and epic-attach only suggestions that
*clearly* fit) — feeding clean, ranked work to
[`/next`](../../../.claude/commands/next.md). Weekly, the **PR Follow-ups** harvester audits its
previously filed items against reality, sweeps recent (and progressively older) PRs for
human-action and deferred items — "Flagged for review" sections, agent-stated TODOs, unresolved
review threads — researches how each gets done, files them into the **`triage`** inbox
(`[pr-followup]` / `[pr-followup][human]`, `suggestion`-labeled, `fp=pr-followup/…` markers),
audits the `fp=human/…` blocker issues any agent session may file under the AGENTS.md
proven-blocker hard rule, and
republishes the **"PR Follow-ups — Human Action List"** tracking issue; running it on Monday
*before* #1–2 means that same morning's curator/triage passes maintain and rank what it filed. The
routine prompts are thin — the real rules live in the skill files, which the routine session loads
from the repo.

> **Hard rule (see `AGENTS.md`):** all issues are **opened on GitHub with the `triage` label**.
> Work is **closed via PRs** (`Fixes #N`, native close-on-merge) or an explicit
> `issue_write` close with the right `state_reason`. These routines never write to Linear (retired)
> and never touch product code — their single repo-write permission is the
> [self-maintenance](#self-maintenance-the-update-themselves-contract) docs-only PR.

---

## Tracker access (shared by all routines)

Routine sessions run in the Frapp Claude Code web environment, whose harness **pre-approves the
GitHub MCP** (`mcp__github__*`) — the same path `/next` uses. No API key, no REST, no secrets to
manage (shell access to `api.github.com` is session-dependent and cannot be relied on). Each run
starts by loading the
GitHub MCP tool schemas (via `ToolSearch`, e.g.
`select:mcp__github__list_issues,mcp__github__issue_read,mcp__github__issue_write,mcp__github__add_issue_comment,mcp__github__search_issues`)
and verifying access (e.g. `issue_read` on a known issue resolves). **If the MCP is unavailable,
the routine stops and reports — there is no fallback tracker.**

**Label roster** (auto-created on first use; re-verify with `issue_read get_labels` on a labeled
issue if anything looks off):

- **State:** `triage` · `in-progress` · `in-review` (Backlog = open with none of these)
- **Priority:** `P1` (urgent) · `P2` (high) · `P3` (medium) · `P4` (low) — exactly one per
  triaged issue
- **Ownership / lifecycle:** `suggestion` · `stale`
- **Area:** `area:api` · `area:web` · `area:db` · `area:deps` · `area:security` · `area:ci` ·
  `area:docs` · `area:product` · `area:ux` · `area:research`
- **Routine infrastructure:** `routine-state` (cross-run state stores, never work — skipped by `/next` and by this file's routines)
- Legacy (`bug`, `Improvement`, `release:*`) persists on old issues; don't extend it.

Reads accept issue numbers (`issue_read`, `list_issues`, `search_issues`); writes go through
`issue_write` (create/update/close) and `add_issue_comment`. Epic structure uses native sub-issues
(`sub_issue_write`, `issue_read get_sub_issues`).

---

## Settings (per routine, set in the Routines UI)

| Setting | Value | Notes |
|---|---|---|
| Environment | the Frapp Claude Code web environment (`pdcarlson/Frapp`) | Routine sessions clone the repo and load `.claude/` skills from the default branch (`main`) at run time. |
| Schedule | Curator **daily 08:00 ET**; Triage **daily 09:00 ET**; PR Follow-ups **weekly Mon 07:00 ET** | If the UI takes cron in UTC: `0 12 * * *`, `0 13 * * *`, and `0 11 * * 1` during EDT (shift +1h when ET returns to EST). Daily/weekly cadence — no per-PR trigger. Flip PR Follow-ups to twice weekly with `0 11 * * 1,4` if a week's batch runs long. |
| Model | **Fable** (`claude-fable-5`) | Quality scales with reasoning; use the strongest available model. |
| Session | fresh session per run | Each run re-reads its skill from `main` — no state carried between runs; the tracker itself is the memory (markers, labels, comments). |
| Access | **GitHub MCP** (pre-approved by the environment) | Plus the repo itself for the curator's engineering/spec lenses. No secrets needed. |

---

## Routine prompts (copy-paste)

The Routines UI takes a prompt per routine. Keep it thin — it points the session at its skill file,
which holds the real rules. Paste these verbatim.

**Routine 1 — "Issue Curator"** (daily 08:00 ET):

```text
You are the Issue Curator for the Frapp repository — a meticulous engineer and product thinker who
keeps the GitHub Issues backlog healthy and high-signal, not just growing. Invoke the
issue-curator skill (.claude/skills/issue-curator/SKILL.md) and follow it EXACTLY: first MAINTAIN
the existing `suggestion` issues (close as completed/not_planned only when code or spec/ PROVES
it, else mark `stale`; dedup; refresh drifted bodies; split oversized), then DISCOVER a few
high-value new items across all four lenses (engineering, spec gaps, creative/epics, runtime
signals) and file them into the `triage` inbox via the GitHub MCP, each with an Agent brief (err
on depth:deep). Only ever modify `suggestion`-labeled issues you own — never touch human/planning
issues. NEVER write to Linear (retired); never modify product code (the skill's docs-only
self-maintenance PR is the sole exception). Filing zero new issues is a perfectly good outcome. If
the GitHub MCP is unavailable, stop and report. Where this prompt and the skill disagree, the
skill wins. End with the run report the skill specifies.
```

**Routine 2 — "Issue Triage"** (daily 09:00 ET):

```text
You are the Issue Triage agent for the Frapp repository — you keep the board clean so /next always
has good work to pull. Invoke the issue-triage skill (.claude/skills/issue-triage/SKILL.md) and
follow it EXACTLY: process the `triage`-labeled inbox — dedup, set a priority label (P1–P4,
required to leave triage), backfill Agent briefs on `suggestion`-owned items (err on depth:deep),
add Blocked-by lines, and promote clearly-actionable items — including well-formed human-filed
ones — to Backlog (remove `triage`); hold ambiguous items, genuine human decisions, and
`[pr-followup][human]` human-action items in triage (never promote those) with a short comment.
Then groom a ~25-issue Backlog batch: sane priority labels first, briefs backfilled, epic
sub-issue attachment only for clear fits. You may organize ANY triage item (priority/estimate/
blocked-by — never overwrite a human-set priority), but only close, mark-duplicate, or re-body
`suggestion`-owned issues. Use the GitHub MCP; if it is unavailable, stop and report. NEVER write
to Linear (retired); never modify product code (the skill's docs-only self-maintenance PR is the
sole exception). Where this prompt and the skill disagree, the skill wins. End with the
board-health report the skill specifies.
```

**Routine 3 — "PR Follow-ups"** (weekly Mon 07:00 ET):

```text
You are the PR Follow-ups harvester for the Frapp repository — you make sure nothing a PR left
for a human silently falls through the cracks. Invoke the pr-followups skill
(.claude/skills/pr-followups/SKILL.md) and follow it EXACTLY: first AUDIT previously harvested
`pr-followup` items against current code/config/runtime (close only on proof, else leave open),
then HARVEST human-action and deferred items from PRs updated since the last run plus a bounded
backward crawl of older PRs — Flagged-for-review sections, agent-stated TODOs and undecided
points, unresolved review threads — research each against the repo's configs and runbooks and
file it into the `triage` inbox (`[pr-followup]` / `[pr-followup][human]` titles, `suggestion` +
one `area:<x>` label, a priority label, an fp=pr-followup dedup marker, and a concrete "How to do
it" section), then PUBLISH the "PR Follow-ups — Human Action List" tracking issue from live issue
state and update its state marker. Destructive writes only on `suggestion`-labeled issues. NEVER
write to Linear (retired); never modify product code (the skill's docs-only self-maintenance PR
is the sole exception). Filing zero issues is a fine outcome. If the GitHub MCP is unavailable,
stop and report. Where this prompt and the skill disagree, the skill wins. End with the run
report the skill specifies, leading with the "Needs you" count and top 3 items.
```

---

## How to create them (UI)

1. Open **claude.ai/code** → the Frapp environment → **Routines** → **New routine** → name it
   **"Issue Curator"**.
2. Schedule daily **08:00 ET**; model **Fable**; environment `pdcarlson/Frapp` (`main`).
3. Paste the **Curator** prompt from [Routine prompts](#routine-prompts-copy-paste) above.
4. Repeat for **"Issue Triage"**, scheduled **09:00 ET**, with the **Triage** prompt.
5. Repeat for **"PR Follow-ups"**, scheduled **weekly Mon 07:00 ET**, with the **PR Follow-ups**
   prompt.
6. Enable all three.
7. **One-time migration step (2026-08) — treat as urgent, not housekeeping:** the three
   predecessor Routines were named **"Linear Issue Curator"** and **"Linear Triage"** (the
   PR Follow-ups name is unchanged) and their stored prompts still instruct writing to Linear.
   Their skill files are gone from `main`, but the prompts carry inline instructions, and the
   Linear MCP stays injected until the Linear connector is removed from claude.ai — so an
   un-re-pasted legacy firing **can still write to Linear**, and while Linear's GitHub
   integration remains connected, a Linear-side close can sync over and **close a real GitHub
   issue**. **Pause or re-paste all three Routines before their next firing** (rename the two
   Linear-named ones), or delete and recreate them. Delete this step once done.

> Routine sessions read the skills from `main` at run time — merge the branch that adds a
> routine's `.claude/skills/<name>/` directory before enabling it.

## Verify

- **Curator:** run it once manually. Confirm new issues land with the **`triage`** label, titled
  `[suggestion] …`, with `suggestion` + `area:*` + a priority label + an **Agent brief** + the
  hidden `fp=` marker; run it again → **no duplicates** (legacy `cursor-suggestion` markers also
  count as matches); confirm it closes/refreshes/`stale`s existing `suggestion` issues and leaves
  every non-`suggestion` issue untouched (ownership gate holds). **Nothing is written to Linear.**
- **Triage:** run it once manually. Confirm `triage` items get a priority label and
  clearly-actionable ones lose the `triage` label (promoted to Backlog); ambiguous items and
  genuine human decisions stay in triage with a comment; nothing human-owned is closed or
  re-bodied; the run ends with the board-health report.
- **PR Follow-ups:** run it once manually. Confirm harvested items land in the `triage` inbox
  titled `[pr-followup] …` / `[pr-followup][human] …` with `suggestion` + `area:*` + a priority
  label + a "How to do it" section + the `fp=pr-followup/…` marker; the **"PR Follow-ups — Human
  Action List"** tracking issue exists with a fresh `pr-followups-state` marker; run it again →
  no duplicates; previously filed items are only closed with cited proof.
- Confirm all schedules show a next-run time.

## Self-maintenance (the "update themselves" contract)

**This section is the binding contract — the skills defer to it.** All routines end each run
by verifying their own contract against reality — the label roster above,
the commands their lenses run, the links and file paths they cite, and whether new surfaces (a new
epic, label, spec area, or MCP tool) should change their behavior. On drift:

- **Mechanical drift** → the routine opens a **docs-only PR** restricted to
  `.claude/skills/issue-curator/`, `.claude/skills/issue-triage/`,
  `.claude/skills/pr-followups/`, and this file, on a `claude/…`
  branch through the normal pre-push review gate. At most one per run; the routine never merges it —
  a human does.
- **Judgment-laden drift** → the routine files a `suggestion` issue (`area:docs`) describing the
  change instead.

This is the routines' **only** permitted repo write.

## Maintenance

- Behavior changes go in the routines' `.claude/skills/*/SKILL.md` files; only re-paste a routine
  prompt if the prompt block itself changes.
- Keep the label roster above current if the taxonomy changes (self-maintenance automates the
  check).
- Environment notes: [`spec/environments/README.md`](../../../spec/environments/README.md#claude-code-routines-environment).
