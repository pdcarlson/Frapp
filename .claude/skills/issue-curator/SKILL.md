---
name: issue-curator
description: >
  Run the Issue Curator routine (1 of 5) — maintain the `suggestion` GitHub issues the agents own
  (close what's provably done, mark stale, dedup, refresh, split), then discover a few high-value
  new issues and file them into the `triage` inbox with an Agent brief. Use when the scheduled
  "Issue Curator" routine fires, or when asked to curate or groom the suggestion backlog.
---

# Issue Curator (routine 1 of 5)

Keep the `suggestion` backlog healthy and high-signal rather than just growing. Each run first
maintains the open `suggestion` issues (one action each), then discovers a few high-value new
issues and files them into the `triage` inbox, within the net-growth budget. The
[`issue-triage`](../issue-triage/SKILL.md) routine runs about an hour later and prioritizes and
promotes what lands there, so propose a priority but leave inbox grooming, re-bucketing, and
Backlog promotion to it.

## Ownership boundary

The shared contract is
[`ROUTINES.md` → Shared ownership boundary](../../../docs/internal/ci-cd/ROUTINES.md#shared-ownership-boundary-all-routines)
and [→ Tracker access](../../../docs/internal/ci-cd/ROUTINES.md#tracker-access-shared-by-all-routines):
GitHub MCP only (stop and report if it's unavailable), Linear is retired, no product code, comment
once. On top of that:

- Destructive writes happen only on `suggestion`-labeled issues. Check with `issue_read
  get_labels` before each write; if `suggestion` is absent, skip and log it. This routine applies
  the gate to organizational writes too (re-label, split): it owns only `suggestion` issues.
  Epics, planning items, and anything a human filed are read-only. Link to them freely.
- When a suggestion duplicates a non-`suggestion` issue, close your suggestion as `duplicate`
  with `duplicate_of` the other one. Leave the other issue alone, apart from at most one
  back-reference comment.
- `issue_write`'s `labels` field replaces the whole set, so always send the union of the existing
  labels plus your change.
- Never print secret values.
- The only repo write this routine makes is the [self-maintenance](#self-maintenance-update-yourself)
  PR.

## Phase 1 — Maintenance

Start with the marker-count guard in
[`GITHUB_PM.md`](../../../docs/internal/ci-cd/GITHUB_PM.md#marker-count-guard-so-the-next-regression-surfaces-in-one-run).
Then list the open `suggestion` issues and give each exactly one action, grounded in current code
and `spec/`. Two groups are different:

- Skip issues whose marker starts `fp=pr-followup/` or `fp=human/` entirely. The weekly
  [`pr-followups`](../pr-followups/SKILL.md) routine owns them, and a human action can't be
  proven done from code.
- `scope:production` issues are parked by owner decision (see the roster in ROUTINES.md), not
  aging. Never mark them `stale`, raise their priority for age, or file duplicates of them.

| What you can prove from code or spec | Action |
| --- | --- |
| The behavior now exists | Close `completed`, commenting with the proving path (and PR if known) |
| Code or spec moved on, so it's moot | Close `not_planned`, commenting why |
| Duplicate of another `suggestion` | Close the newer or worse-specified one as `duplicate` with `duplicate_of` the canonical, and comment the link. Touch the canonical only for a back-link |
| Still valid, but refs or context drifted | Correct the body when the fidelity probe is green; comment when it's red or you can't run it. Keep the `fp=` marker, add an [Agent brief](#agent-brief) if missing, leave open |
| Nothing provable, and it looks aged | Add `stale` plus a short comment ("no longer matches X as of <date>; confirm or close"). Leave open |
| Accurate and active | Leave untouched |

A close needs proof you can point at; when in doubt, mark `stale` instead, because a wrong close
silently drops real work. When the proof is a direct citation, cite it and close. When it rests on
inference (behavior spread across modules, "superseded" judged from a redesign), you can hand the
close to a `claim-verifier` agent (`.claude/agents/claim-verifier.md`), batching the run's
inferred closes into one, and close only on CONFIRMED. Don't spin one up for a close you can
already cite.

**Body rewrites.** Whether an MCP read is safe to rewrite from is a measurement that has flipped
before. The table, the probe, and the fallback when it's red live in
[`GITHUB_PM.md` → Reading a body you intend to rewrite](../../../docs/internal/ci-cd/GITHUB_PM.md#reading-a-body-you-intend-to-rewrite-mcp-read-fidelity).
This routine refreshes and splits bodies, so it's the most exposed to a regression: re-run the
probe against fixture #1736 before a refresh pass, and say in the run report that you did.

- Put anything additive (a note, a finding, an Agent brief) in `add_issue_comment`. Rewrite only
  when the body is wrong; that keeps issues readable whatever the probe says.
- When you write a body, confirm the `fp=` marker line is in what you sent. Without it, the next
  run re-files the issue as net-new.
- Legacy markers are HTML comments (`<!-- agent-suggestion: v1 fp=… -->`, or an older prefix with
  the same `fp=` grammar) and still valid. A marker you can't see is "unknown", never "absent", so never
  re-file on that basis alone. When you refresh a body for another reason, promote the marker to
  the visible form. Don't rewrite a body only to change the marker.

**Splits.** Split an oversized suggestion into native sub-issues only when each child is
independently executable. Each child is a full suggestion: its own `suggestion` and `area:<x>`
labels, `fp=` marker, and Agent brief. The parent keeps a checklist. Create a child with
`issue_write`'s `parent_issue_number`, or attach it with `sub_issue_write`, whose `sub_issue_id`
is the child's internal id (from the `issue_write` result or `issue_read get`), not its number.

## Phase 2 — Discovery

Surface high-value work the project doesn't track yet, across the whole codebase, the spec, the
UX, and the runtime, not just whatever prompted the run.

### Net-growth budget

The budget is what keeps the backlog lean. GitHub has no issue cap, so this is the only throttle,
and it exists for signal quality: `/next` ranks this backlog, and filler buries real work.

- Prefer refreshing an existing near-match over filing a new issue.
- File at most about 3 net-new suggestions per run. When more than 40 `suggestion` issues are
  open, cap at about 2 and spend the run consolidating.
- Filing zero is valid and common, and a run that nets negative is a good outcome. Don't lower the
  bar to produce output.
- You can fan the search out (a subagent per area is worth it when an area means heavy reading,
  such as spec-vs-code), but every candidate still passes dedup, the quality bar, and the cap.
  More finders never means more filings.

### Where to look

- **Engineering gaps.** Run the [`/audit`](../audit/SKILL.md) playbook: `npm run check-types`,
  `npm run lint`, `npm run check:npm-audit`, `npm run check:api-contract`,
  `npm run check:migration-safety`. None needs a manual package build first. `check:api-contract`
  regenerates the contract artifacts when API files changed; discard those edits
  (`git checkout -- .`) and never commit them. Beyond the checks, look for weak tests on complex logic, N+1 or in-memory
  aggregation, large unsplit modules, auth-guard and RLS gaps, secret exposure, and CI holes.
  - Use `npm run check:npm-audit` (the CI `dependency-audit` gate), not bare `npm audit`. The raw
    report counts per package and ignores the time-boxed, issue-tracked allowlist in
    `scripts/npm-audit-allowlist.json`, so filing from it duplicates advisories already tracked.
    File from the gate's output.
- **Product gaps.** Compare `spec/product/`, `spec/behavior/`, `spec/architecture/`, and
  `spec/ui/` against the code: unbuilt or partial features, missing cross-surface flows,
  unimplemented invariants, edge cases, and anti-fraud rules. Ground every idea in the spec or in
  evidence; don't invent unscoped features.
- **Next steps and research.** Beyond fixing what's broken, propose concrete forward work (a
  spike, a short design doc, a metric to add). Ideate against the open epics as well as the code,
  and attach work that advances an epic as its sub-issue. Label forward-looking items
  `area:research`. Epics are titled both `[Epic] <name>` and
  `Epic: <name>`, so match both, or find them by structure (`has_children: true`), which doesn't
  depend on the title. Judge whether an epic still needs proposals from its merged PRs rather
  than its sub-issue checkboxes, since lane issues often stay open after their PRs merge.
- **Runtime signals** (best effort). Live evidence makes these the highest-signal issues.
  - Sentry MCP: new or growing error clusters, and regressions on recent releases. Read the
    organization slug, projects, and region from
    [`ALERT_ROUTING.md`](../../../docs/internal/ops/ALERT_ROUTING.md). A wrong slug returns 403,
    which looks like a revoked grant, so call `find_organizations` before recording Sentry as
    unreachable.
  - Supabase MCP: `get_advisors` security and performance findings from both hosted projects.
    Their advisor sets differ (some extensions exist on production only), so reading one misses
    findings. Take both from [`.github/environments.json`](../../../.github/environments.json)
    (read via `scripts/ci/lib/environments.mjs`), match its `supabaseProjectName` entries against
    `list_projects`, and attribute each finding to its environment.
  - GitHub MCP: repeated CI failures or flaky jobs on recent `main` runs. A deploy workflow
    triggered by `workflow_run` fails without turning any PR check red. Read its job log
    (`get_job_logs`), and check for an open `incident` on it before filing anything.
  - Render MCP: `list_deploys` (`limit: 5`) for `frapp-api-staging` and `frapp-api-prod`. A
    green `Deploy API` run only means Render accepted the hook, not that the build succeeded.
    Pass `workspaceId` on every call; the id is in
    [`AGENT_CREDENTIALS.md`](../../../docs/internal/environment/AGENT_CREDENTIALS.md). Resolve
    each service's `srv-…` id with `list_services` rather than from memory
    ([`infrastructure-research`](../infrastructure-research/SKILL.md) has the recipe). A failed
    staging deploy already raises an `incident` (`verify-deployments.yml`), so look there first.
    File only a failure that no later deploy has fixed: a deploy that ended failed
    (`build_failed`, `update_failed`) and is newer than the service's `live` one. An in-progress
    deploy is neither. Production deploys are dispatched by hand, so an old
    `live` production commit is expected, not a finding. A Render build log can hold a live
    secret (#2432), so quote only the error line, never raw log output.
  - Vercel MCP: `get_runtime_errors` (`since: "7d"`) for `frapp-web` and `frapp-landing`. It
    requires `teamId` (from `list_teams`), and the project ids come from `list_projects`. It is
    the web dashboard's only error signal while the web Sentry DSN is unset (#970). One
    transient error doesn't make an issue; a recurring cluster does.

  Cite the evidence (error ID, advisor name, run link) in the issue. If a tool is absent or
  genuinely refuses, skip that source and note it in the run report; never guess runtime state.
  A refusal that asks you to have a human confirm or pick something, such as Render's "ask the
  user which workspace to use", is a refusal too. An unattended run has no human to ask, so skip
  the source rather than choosing for them.
  An error caused by an argument you supplied is your bug, so fix the argument before recording
  the source as unavailable.

## Filing a new issue

Every issue this routine creates has:

- Title `[suggestion] <imperative title>`.
- Labels: `triage` (the inbox), `suggestion` (the ownership and dedup anchor), exactly one
  `area:<x>` from the roster in
  [`ROUTINES.md` → Tracker access](../../../docs/internal/ci-cd/ROUTINES.md#tracker-access-shared-by-all-routines),
  and a priority `P1`–`P4`. Read the roster itself rather than a remembered list, since several
  entries carry scope notes and some overlap. A routine suggestion is usually `P3` or `P4`; keep
  `P1`/`P2` for security, data loss, and broken core flows, because `/next` ranks by priority.
- An [Agent brief](#agent-brief), always.
- Optionally, a parent epic when it clearly belongs to one.
- A body in the [template](#description-template), ending with the visible `fp=` marker line.

**Dedup.** The fingerprint is `fp=<area>/<slug(title)>`, anchored to `file=<primary-path>` (no
line number). Prefer a distinctive slug; two or three specific words beat a generic phrase.

1. `search_issues` (open and closed) for the `fp=` string. The matcher is semantic, so a hit
   counts only if the returned body contains the literal `fp=` string, and its `number` is the
   issue you mean. Skipping on a topical near-match is a false skip, which is silent and worse
   than a duplicate.
2. Legacy comment-form markers count as matches but can be invisible to search, so no hit is weak
   evidence. Also search the finding's key terms.
3. Search the key terms against `[human]` titles too. If an open `fp=human/` blocker already
   tracks the same action (dashboard toggles and advisor findings are the usual overlap), skip:
   a promotable twin would send `/next` into a wall the held issue already documents.
4. On a real match, skip, or refresh the open issue.

Embed the marker as a visible line, `` `agent-suggestion: v1 fp=<area>/<slug> file=<path>` ``,
not an HTML comment. MCP reads have dropped HTML comments before, which hid markers from the read
and the search index alike.

### Agent brief

The brief tells the executing agent how hard to dig. Field meanings and how `/next` honors them
are in
[`GITHUB_PM.md` → Agent briefs](../../../docs/internal/ci-cd/GITHUB_PM.md#agent-briefs-depth--model--ultracode),
which wins where the two disagree.

```markdown
### Agent brief
`depth:<skim|standard|deep>` · `model:<fable|any>` · `ultracode:<yes|no>`
<one line on where the depth should go — what to verify, which subsystem to load>
```

Err toward `depth:deep`. Suggest `model:fable` and `ultracode:yes` for cross-cutting,
architectural, security-sensitive, or subtle-correctness work, and `model:any` otherwise.

### Description template

```markdown
### Summary
<one sentence>

### Category
`area:<x>` · `type:<gap|improvement|idea>` · priority:<P1|P2|P3|P4>

### Agent brief
`depth:<skim|standard|deep>` · `model:<fable|any>` · `ultracode:<yes|no>`
<one line on where the depth should go>

### Location
`path/to/file.ext:line`  (or `spec/...` for product/behavior items)

### Description
<what's wrong, missing, or worth pursuing>

### Rationale & impact
<why it matters — tie product/behavior items to the spec or the user; cite live evidence for runtime signals>

### Suggested fix / first step
<concrete next step; for ideas, the smallest spike>

### Acceptance criteria
- [ ] <objectively verifiable outcome>

---

`agent-suggestion: v1 fp=<area>/<slug> file=<primary-path>`

_Filed by the Issue Curator routine. Edit freely; keep the `fp=` line above — it is the dedup key,
and it must stay a visible line (an HTML comment has repeatedly been invisible to the MCP read)._
```

`type:` is body metadata, not a label.

## Self-maintenance (update yourself)

At the end of the run, check this file against the repo: the label roster in
[`ROUTINES.md`](../../../docs/internal/ci-cd/ROUTINES.md), the engineering-gap commands in
`package.json`, the paths and links named here, and any new epic, label, spec area, or MCP tool
that discovery should use. Act on drift at most once per run, under the contract in
[`ROUTINES.md` → Self-maintenance](../../../docs/internal/ci-cd/ROUTINES.md#self-maintenance-the-update-themselves-contract),
which sets the allowed paths and limits: mechanical drift gets the docs-only PR, and
judgment-laden drift gets a `suggestion` (`area:docs`, usually `depth:standard`).

## How the run ends

This runs unattended. Work through maintenance and discovery without stopping to summarize or
offer options, and put any status note in the same message as your next tool call. End the run
when every in-scope suggestion has its action and discovery has used or declined its budget, or
when nothing more can move (the GitHub MCP is unavailable, or the marker-count guard failed and
body writes are off). The final message is the run report:

- Marker-count guard result, and whether you ran the fidelity probe before body writes.
- Maintenance: each issue touched, with its action (closed `completed` / `not_planned` /
  `duplicate`, refreshed, commented, `stale`, split).
- Filed: new issue numbers, plus candidates skipped as duplicates (with the matching issue).
- Runtime sources skipped, and why.
- Self-maintenance PR or `area:docs` suggestion, if any.
- Anything the next run should know.
