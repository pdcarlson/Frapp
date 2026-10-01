# Scheduled backlog agents

The version-controlled spec for Frapp's five scheduled agents. Routines are configured in a UI, not
as code, so this file is what you copy into it: settings, prompts, and the rules every routine
shares. The prompts are thin; the behavior contract is each routine's skill, which the session reads
from `main` at run time.

Each routine runs as a Claude Code Routine ([claude.ai/code/routines](https://claude.ai/code/routines)).
A Routine belongs to one claude.ai account and draws on that account's usage and daily run cap.
Since 2026-09-30 they live on the Frapp work account, the same account Frapp's cloud sessions run
under, rather than the owner's personal one; the five were recreated there in the UI that day,
and the personal account's copies were switched off before any new one fired, so no routine ran
on two schedulers.
Editing a prompt block or a Settings row here changes nothing that runs until the live Routine is
updated, and that update belongs after the PR changing it merges, since the run reads its skill from `main`.
In a session the owner is attending, an agent can update a Routine an agent created with
`update_trigger`; `list_triggers` shows how each was created (`created_via`: UI-created Routines
read `http_api`), and `update_trigger` refuses the rest ("Agents can only update routines they
created"). A Routine created in the UI, which is all
five, can only be edited there, so hand the owner the new text. Whenever the live Routine isn't
updated in the same session, which includes every scheduled run, file a `[human]` issue carrying
the new prompt text or setting and the PR it waits on. Decision record: ADR-16 amendments 4–10 in
[`spec/architecture/adr/adr-16.md`](../../spec/architecture/adr/adr-16.md).

| # | Routine | Skill (behavior contract) | When (ET) | What it does |
| --- | --- | --- | --- | --- |
| 1 | **Issue Curator** | [`issue-curator`](../../.claude/skills/issue-curator/SKILL.md) | weekly Fri 08:07 | Maintains the agent-owned `suggestion` issues; files a few new ones into `triage` |
| 2 | **Issue Triage** | [`issue-triage`](../../.claude/skills/issue-triage/SKILL.md) | daily 09:07, an hour after #1 on Fridays | Works the `triage` inbox and a Backlog batch: priorities (what [`/next`](../../.claude/commands/next.md) ranks by), briefs, dedup, promotion |
| 3 | **PR Follow-ups** | [`pr-followups`](../../.claude/skills/pr-followups/SKILL.md) | weekly Mon 07:07, before #1–2 so that morning's passes see what it filed | Files what recent PRs left for a human; republishes the "PR Follow-ups — Human Action List" |
| 4 | **Docs Upkeep** | [`docs-upkeep`](../../.claude/skills/docs-upkeep/SKILL.md) | weekly Wed 07:07 | Fixes a rotating fifth of the docs corpus in one docs-only PR (repairs rather than files, because filed docs debt ages) |
| 5 | **Hygiene Scan** | [`hygiene-scan`](../../.claude/skills/hygiene-scan/SKILL.md) | daily 23:07, the evening before, so it runs first each day | Fixes one bounded hygiene theme in one product-code PR; files the rest |

The personal account also held a sixth Routine, "Next steps" (hourly `/next`), disabled since
2026-09-05 and deliberately not recreated on 2026-09-30. Don't bring it back: it would claim and
ship backlog work, product code included, which is outside the ownership boundary below.

## Shared ownership boundary (all routines)

The routine skills and the tracker angle of [`diff-review`](../../.claude/skills/diff-review/angles.md)
point here instead of restating these rules. Policy detail:
[`github-pm.md` → Ownership boundary](github-pm.md#ownership-boundary-organize-broadly-destroy-narrowly).

1. **Issues live on GitHub Issues** (this repository). Open every issue with the `triage` label;
   close work through a PR (`Fixes #N`) or an explicit `issue_write` close with the right
   `state_reason`. Never write to Linear: it is retired, nothing reads it, and it is not a fallback.
2. **Destructive writes** (close, mark duplicate, re-body, including adding an Agent brief) are
   allowed only on issues labeled `suggestion`, because routines own only what agents filed;
   human-filed and planning issues are read-only to them for these actions. Confirm the label with
   `issue_read get_labels` before each such write; if it's absent, skip and log.
3. **No product code (routine 5 excepted) and no feature PRs.** Repo writes are at most one PR
   per run, never merged by the routine (a human merge is what licenses an unattended write), and
   confined to a path allowlist:
   - Routines 1–3: the [self-maintenance PR](#self-maintenance-the-update-themselves-contract), on
     its allowlist.
   - Routine 4 (Docs Upkeep): its sweep PR over the corpus its skill defines (`docs/**`, `spec/**`,
     `.claude/skills/**/*.md`, every tracked `AGENTS.md`, root `CONTRIBUTING.md` and `README.md`),
     ADR-16 amendment 6. The product-code ban binds it.
   - Routine 5 (Hygiene Scan): the one routine the product-code ban does not bind (ADR-16
     amendment 7). Its fix PR edits `apps/**` and `packages/**`, and in `scripts/**` only dead code
     and stale allowlist entries, never a check, CI or deploy script's logic, under the fix rules in
     its skill. It never opens feature PRs, never touches migrations, CI workflows, dependency
     versions or a frozen surface's visuals, and keeps at most one PR open at a time.
4. **GitHub MCP only; if it is unavailable, stop and report.** The MCP is auditable and its writes
   are lossless, so no routine lists, searches, reads, files, labels, closes or comments on an issue
   or PR over `gh` or REST, or parks tracker work in a scratch file, and a missing MCP is a full
   stop, not a prompt to find another route. REST is allowed for two reads only, neither of them
   tracker work: provider settings the MCP has no tool for (branch protection, environments,
   rulesets, repo visibility, vulnerability alerts), and the body-fidelity verification read that
   [`github-pm.md`](github-pm.md#reading-a-body-you-intend-to-rewrite-mcp-read-fidelity) licenses.
   Neither lifts the stop rule. Routines 4 and 5 write a PR rather than issues, so a missing MCP
   doesn't block their sweep or scan: push the branch, report its name, and stop. They stop and
   report if `git push` fails.
5. **`issue_write` labels replace the whole set.** Send the union of the existing labels and your
   change.
6. **Comment once, not once per run.** Read the existing comments (`issue_read get_comments`)
   before commenting. The MCP can't edit comments, and a standing comment is already in force for
   `/next`, which reads it, so if a prior run said the same thing and it's still accurate, stay
   silent and put it in the run report. Post again only with genuinely new information, leading
   with the new part and referencing the standing comment. This binds every comment a routine
   writes. Triage's procedure:
   [`issue-triage` → Comment once](../../.claude/skills/issue-triage/SKILL.md#comment-once-not-once-per-run).
7. **A `Blocked by #N` comment doesn't gate `/next`.** The blocker filter in
   [`next.md`](../../.claude/commands/next.md) §0.2 reads `Blocked by #N` body lines only (an
   Agent brief, by contrast, is read from comments too). So on an issue rule 2 won't let you
   re-body, a blocker can be reported but not enforced: comment it, then list the issue in the run
   report as needing an owner body edit.

Triage alone may organize any `triage` item (priority, `Blocked by`, promotion), as its skill
spells out. That doesn't widen destructive writes.

## Tracker access (shared by all routines)

Routine sessions run in the Frapp Claude Code web environment, which exposes a GitHub MCP, the same
path `/next` uses, with no keys to manage. Start each run by loading the GitHub MCP tool schemas
(named like `mcp__github__issue_read`; don't hard-code the prefix) and confirming access with an
`issue_read` on a known issue. If the MCP is unavailable, stop and report: there is no fallback
tracker. Routines 4 and 5 are the exception in rule 4.

Direct REST to `api.github.com` is reachable from these sandboxes (a 403 on a proxied `curl` says
nothing about the PAT; see [`agent-infra.md` → Work status](agent-infra.md#work-status)),
and rule 4 limits it to the two reads it names.

Whether an MCP read is faithful enough to rewrite a body from is a measurement that has flipped
several times, so read the current table in
[`github-pm.md` → Reading a body you intend to rewrite](github-pm.md#reading-a-body-you-intend-to-rewrite-mcp-read-fidelity)
rather than remembering it, and re-run its probe against fixture #1736 before any bulk rewrite. Two
things hold whatever it says: the `fp=` marker you write is a visible line, not an HTML comment, and
`search_issues` finds fingerprints reliably but matches semantically, so confirm the returned
`number` is the issue you meant.

Reads accept issue numbers (`issue_read`, `list_issues`, `search_issues`); writes go through
`issue_write` (create/update/close) and `add_issue_comment`. Epics use native sub-issues
(`sub_issue_write`, `issue_read get_sub_issues`).

### Label roster

This is the only copy; [`github-pm.md`](github-pm.md#labels-and-priority-lean-taxonomy) links here
and keeps only the tracker rules built on these labels. Labels auto-create on first use (verified
2026-08-08), so a typo'd label is a real label; if one looks off, check it with
`issue_read get_labels` on a labeled issue.

- **State:** `triage` · `in-progress` · `in-review` (Backlog = open with none of these)
- **Priority:** `P1` (urgent, drop everything) · `P2` (high) · `P3` (medium) · `P4` (low), exactly
  one per triaged issue. Absent means unprioritized, which `/next` ranks last.
- **Ownership / lifecycle:** `suggestion` · `stale` · `human`. `suggestion` marks what the
  routines own, so it's the boundary for destructive writes
  ([rule 2](#shared-ownership-boundary-all-routines)). `stale` marks an aging suggestion that
  can't be proven resolved; it stays open. `human` (in use on #1146) is
  decorative, not a hold mechanism. The human-action hold is the `[human]` /
  `[pr-followup][human]` title prefix or the `**Human action required — hold in triage` body
  opener, per [`github-pm.md`](github-pm.md#labels-and-priority-lean-taxonomy), and `/next` §0.2
  checks those, not labels. So a `human`-labelled issue with no prefix is held by its `triage`
  label alone, and promoting it exposes it to `/next`. Whether `human` should become a fourth
  recognised hold form is the owner's call, not a routine's.
- **Parked:** `parked`, off the beta and v1 path on purpose. The 2026-09-23 board recomposition
  put every open issue under the beta epic #2558 or the v1 epic #2523, parked it, or closed it.
  #2523's index comment gives each parked issue's reason: after v1, waiting on a measured trigger,
  hygiene with no release gate, or waiting on an owner decision.
  - **Who sets it:** the owner adds and removes it, or a session acting on the owner's decision.
    No routine does either, and no routine reads a missing or present `parked` as drift.
  - **What it holds:** `/next` skips a parked issue in every mode, however high its priority, and
    never reclaims one (§0.2 condition 1, §0.7). Issue-triage Pass B doesn't groom it (owner
    decision 2026-09-23, #2565). The Issue Curator doesn't mark it `stale` for age, since it sits
    idle on purpose. The way back onto the path is the owner removing the label.
  - **What it isn't:** a board state, or `scope:production` (below), whose "parked by owner
    decision" wording predates this label and whose rules are its own. `parked` sits on top of
    whatever state the issue is in, so a parked issue can also carry `triage` and a priority.
    Parked hygiene items stay reachable through the Hygiene Scan, which finds its work in the code
    and may close the parked suggestion its fix covers.
- **Area:** `area:api` · `area:web` · `area:db` · `area:deps` · `area:security` · `area:ci` ·
  `area:docs` · `area:product` · `area:ux` · `area:research`, plus the labels below, which were
  created in use rather than declared. They carry no label description and their scope is the
  owner's to define; they are rostered, not re-bucketed, so routines stop reading them as typos.
  Where one overlaps another label rather than partitioning it, whether that's intended is the
  owner's call, not a routine's.
  - `area:dx`: see #1049 and #1059.
  - `area:infra`: branch-protection, repo-settings and staging-environment work that is neither
    `area:ci` nor `area:dx` (#1138, #1148, #1235, #1240).
  - `area:mobile`: `apps/mobile` work that is neither `area:ux` nor `area:api` (#1237).
  - `area:chat`: chat dispatch work spanning `packages/chat-core` and its call sites (#1499). It
    overlaps the surface labels, since chat ships on web, mobile and the API (#1499 alone touches
    `packages/chat-core` plus `apps/web` and `apps/mobile` call sites), so an issue can reasonably
    carry `area:chat` and a surface label.
  - `area:ops`: Supabase Auth custom-domain work (#2125). It sits closest to `area:infra`, which
    already covers staging-environment and provider-settings work, so the two aren't cleanly
    separated; whether `area:ops` stays or folds into `area:infra` is open.
  - `area:landing`: `apps/landing` PostHog module work (#2150). It overlaps `area:web`, which could
    also claim `apps/landing`; whether landing keeps its own label is open.
  - `area:testing`: first used for the jsdom 30.1 Radix-overlay hold (#2451, lifted with jsdom
    30.1.1). It overlaps on two axes: test infrastructure is already filed under `area:ci` (#2450
    `test:cov` runs nowhere, #827 no Supabase stack for the integration suite), and a missing spec
    under its surface label (#2456 and #2282 are `area:mobile`). Whether a third home helps or
    splits one class three ways is open.
- **Scope:** `scope:production`: work that only becomes relevant once a production environment
  exists (owner decision 2026-08-10; the
  [decision record on #814](https://github.com/pdcarlson/Frapp/issues/814#issuecomment-5245093672)
  lives in that comment, not #814's rebuilt-each-run body). Parked by choice, not blocked
  and not stale: don't mark these `stale`, raise their priority for age, or re-file duplicates.
  Since 2026-08-30 the premise no longer holds: production is live (`frapp-prod`, deployed by
  `deploy-production.yml`; [ADR-20](../../spec/architecture/adr/adr-20.md)), so don't read the
  label as evidence that a production-shaped risk is theoretical. Redefining its scope is the
  owner's call, tracked in #2542.
- **Routine infrastructure:** `routine-state` (cross-run state stores, never work; `/next` and the
  routines skip them)
- **Live alerts:** `incident` (filed and closed by the CI watchdogs, assigned to the owner; never
  claimed as work, see [`github-pm.md` → The model](github-pm.md#the-model))
- **Legacy:** `bug`, `Improvement` and `release:*` persist on old issues; don't add them to new
  issues. On PRs, `release:*` is live: every PR should carry one (Dependabot's carry none), and a
  PR with no label counts as `release:patch` in the production version bump
  ([`agent-infra.md` → Release labels](agent-infra.md#release-labels)).

## Run record (all routines)

A Routine's own run status can't be trusted to show a run that didn't do its job. On 2026-09-17
three routines died about 7 seconds after firing and wrote nothing, and on 2026-09-30 Hygiene Scan
read `SUCCEEDED` while its session had stopped at Phase 0 on a sandbox bringup failure
([#2358](https://github.com/pdcarlson/Frapp/issues/2358)). Neither reached the owner. So every run,
whatever its outcome, ends with one record the repository can see:

1. **As your last tracker write**, comment once on
   [#2966](https://github.com/pdcarlson/Frapp/issues/2966) (*Routine runs — heartbeat*,
   `routine-state`) with `add_issue_comment`. The first line is the record, and the line after it
   says in one sentence what the run did or why it stopped:

   ```text
   routine-run: v1 routine=<slug> outcome=<done|stopped>
   ```

   `<slug>` is your skill's directory name: `issue-curator`, `issue-triage`, `pr-followups`,
   `docs-upkeep` or `hygiene-scan`.
2. **`done`** means the run did its job, and a run with nothing to do did its job: a clean slice,
   an empty inbox, no PR because nothing was worth fixing. A single check you couldn't run is
   still `done`; name it on the second line.
3. **`stopped`** means the run ended before doing its job: the sandbox failed to come up, a
   protected resource blocked it, or a guard turned the run's main
   writes off. Post the record before your run report.
4. **One record per run**, manual runs included. It is exempt from rule 6's comment-once, because
   each run is new information. Never post one for a run you didn't make, or to clear an alert.

Without the GitHub MCP, or in a session that couldn't load its skill (and so never read this
rule), no record is posted, and the missing record is the signal. Never post one any other way:
`gh` or REST under the owner's token would read as a real record. The daily
**Routine heartbeat** workflow reads these comments and raises an `incident` alert when a routine's
latest scheduled run has no record or a `stopped` one; the rules are in
[`scripts/ci/routine-heartbeat.mjs`](../../scripts/ci/routine-heartbeat.mjs), and the alert's row is
in [`alert-routing.md`](../ops/alert-routing.md#automated-github-issue-alerts). Only
comments from the owner's account count, because the repository is public.

## Settings (per routine, set in the Routines UI)

Enter times in ET. The Routines form takes local time and converts it
([Routines docs](https://code.claude.com/docs/en/routines#add-a-schedule-trigger)); `list_triggers`
shows the stored result as UTC cron. The docs don't say whether a stored schedule follows
daylight saving, so after ET returns to EST in November, check that each `cron_expression` moved
an hour later in UTC; if it didn't, re-enter the times. The form offers only hourly, daily,
weekdays and weekly presets; anything else needs `/schedule update` in a local CLI, which a cloud
session can't run, so every schedule here is a preset. Each time sits a few minutes past the hour
because a run scheduled on the hour can start several minutes late.

| Setting | Value | Notes |
|---|---|---|
| Environment | The Frapp Claude Code web environment | Sessions clone the repo and load `.claude/` skills from `main`. |
| Schedule | Curator weekly Fri 08:07; Triage daily 09:07; PR Follow-ups weekly Mon 07:07; Docs Upkeep weekly Wed 07:07; Hygiene Scan daily 23:07 (all ET) | The Curator went from daily to weekly on 2026-09-30 (owner decision): its discovery output had thinned, the inbox was mostly `[human]` items, and the account's usage is better spent on coding sessions. Docs Upkeep is on Wednesday so it never shares a morning with PR Follow-ups. The heartbeat watchdog keeps its own copy of each schedule as `list_triggers` stores it (UTC), in the `ROUTINES` table of [`routine-heartbeat.mjs`](../../scripts/ci/routine-heartbeat.mjs), entered as the EDT times' UTC so that daylight saving can only make a fire later, which the watchdog allows for; a schedule change, or a Routine switched off, moves that table too, or the heartbeat alerts. If a PR Follow-ups batch runs long, split it across two weekly Routines rather than one custom schedule. |
| Model | All five: Opus 5.5 (`claude-opus-5-5`) | Owner decision, 2026-09-22. |
| Autofix on PR create | Off for Curator, Triage and PR Follow-ups. On for Docs Upkeep and Hygiene Scan. | The first three open a PR only for self-maintenance; the other two open one on most runs. |
| Session | Fresh session per run | Each run re-reads its skill from `main`. |
| Access | GitHub MCP | Plus the repo itself for Hygiene Scan's gates. Routines run in the same Frapp environment as interactive sessions, so they carry its variables and allowlist ([`AGENT_CREDENTIALS.md`](../internal/environment/AGENT_CREDENTIALS.md), [`CLOUD_SANDBOX.md`](../internal/environment/CLOUD_SANDBOX.md#whats-configured-in-the-web-ui)). |
| Connectors | Issue Curator, PR Follow-ups and Docs Upkeep: Sentry, Supabase, Vercel, Render, PostHog. Issue Triage and Hygiene Scan: none. | These three read provider state: the Curator's runtime-signals and `/audit` lenses, PR Follow-ups' close-on-proof audit of `[human]` items (Sentry and PostHog settings among them), and `infrastructure-research`. A run missing one reports that source as unavailable. Attach nothing else: a connector is standing access for an unattended run, write tools included (the Supabase connector can run SQL against production). The form attaches every connector on the account by default, so remove the rest when creating a Routine; on the work account that means Stripe, Resend, Claude Docs and `visualize` everywhere, and all of them for Triage and Hygiene Scan. The repository is public, so a run reads text strangers wrote (PR comments, and production error text via Sentry); every write-capable connector attached is a tool that text could try to steer. GitHub is the MCP and the repository attachment, not a connector. |
| Completion notification | No push (owner decision, 2026-09-30); PR Follow-ups emails | Each run ends with a report meant for the owner, read in the run's session. |

## Routine prompts (copy-paste)

Paste these verbatim, one per routine. Each names the role, hands off to the skill, and carries only
the limits that must hold whatever the skill says.

**Routine 1 — "Issue Curator"** (weekly Fri 08:07 ET):

```text
You are the Issue Curator for the Frapp repository: you keep the agent-owned `suggestion` issues on
GitHub accurate and add a few high-value new ones. Invoke the issue-curator skill
(.claude/skills/issue-curator/SKILL.md) and follow it; where the skill and this prompt disagree, the
skill wins. If you can't load the skill, report that and stop rather than improvising from this
prompt.

These limits hold regardless:
- Do all tracker work through the GitHub MCP. If it is unavailable, stop and report; gh, REST and
  scratch files are not fallbacks.
- Close, mark duplicate or rewrite the body only of issues labeled `suggestion`.
- Never write to Linear; it is retired.
- Never modify product code. Your only repo write is the skill's docs-only self-maintenance PR,
  and you never merge it.

The run is done when every in-scope `suggestion` issue has its action and discovery has filed its
few new issues into `triage` or found none worth filing. This runs unattended: keep working through
everything that doesn't need the human, and put any status note in the same message as your next
tool call. End earlier only if nothing more can move without the human or a protected resource
blocks you. Your final message is the run report the skill specifies.
```

**Routine 2 — "Issue Triage"** (daily 09:07 ET):

```text
You are the Issue Triage agent for the Frapp repository: you keep the `triage` inbox and the
Backlog correctly prioritized and briefed so /next always has good work to pull. Invoke the
issue-triage skill (.claude/skills/issue-triage/SKILL.md) and follow it; where the skill and this
prompt disagree, the skill wins. If you can't load the skill, report that and stop rather than
improvising from this prompt.

These limits hold regardless:
- Do all tracker work through the GitHub MCP. If it is unavailable, stop and report; gh, REST and
  scratch files are not fallbacks.
- You may organize any `triage` item (priority, Blocked by lines, promotion) but never overwrite a
  human-set priority. Close, mark duplicate or rewrite the body only of issues labeled `suggestion`.
- Never write to Linear; it is retired.
- Never modify product code. Your only repo write is the skill's docs-only self-maintenance PR,
  and you never merge it.

The run is done when every inbox item is promoted or held with a reason and a Backlog batch is
groomed. This runs unattended: keep working through everything that doesn't need the human, and
put any status note in the same message as your next tool call. End earlier only if nothing more
can move without the human or a protected resource blocks you. Your final message is the
board-health report the skill specifies.
```

**Routine 3 — "PR Follow-ups"** (weekly Mon 07:07 ET):

```text
You are the PR Follow-ups harvester for the Frapp repository: you make sure work a PR left for a
human becomes a tracked GitHub issue, and you keep the "PR Follow-ups — Human Action List" current.
Invoke the pr-followups skill (.claude/skills/pr-followups/SKILL.md) and follow it; where the skill
and this prompt disagree, the skill wins. If you can't load the skill, report that and stop rather
than improvising from this prompt.

These limits hold regardless:
- Do all tracker work through the GitHub MCP. If it is unavailable, stop and report; gh, REST and
  scratch files are not fallbacks.
- Close, mark duplicate or rewrite the body only of issues labeled `suggestion`.
- Never write to Linear; it is retired.
- Never modify product code. Your only repo write is the skill's docs-only self-maintenance PR,
  and you never merge it.

The run is done when earlier items are audited, this week's harvest is filed into `triage` (zero
new issues is a fine outcome), and the tracking issue is republished. This runs unattended: keep
working through everything that doesn't need the human, and put any status note in the same
message as your next tool call. End earlier only if nothing more can move without the human or a
protected resource blocks you. Your final message is the run report the skill specifies.
```

**Routine 4 — "Docs Upkeep"** (weekly Wed 07:07 ET):

```text
You are the Docs Upkeep agent for the Frapp repository: you keep this week's slice of the docs true
by fixing what is wrong in one docs-only PR. Invoke the docs-upkeep skill
(.claude/skills/docs-upkeep/SKILL.md) and follow it; where the skill and this prompt disagree, the
skill wins. If you can't load the skill, report that and stop rather than improvising from this
prompt.

These limits hold regardless:
- Edit only the docs corpus the skill defines; never modify product code.
- At most one PR per run, and never merge it.
- Use the GitHub MCP for tracker and PR work, never gh or REST. If it is unavailable, push the
  branch, report its name, and stop. If git push fails, stop and report.
- Never write to Linear; it is retired.

The run is done when the slice is swept and either the PR is open with your own CI failures fixed,
or the slice was clean and there is no PR. This runs unattended: keep working through everything
that doesn't need the human, and put any status note in the same message as your next tool call.
End earlier only if nothing more can move without the human or a protected resource blocks you.
Your final message is the run report the skill specifies.
```

**Routine 5 — "Hygiene Scan"** (daily 23:07 ET):

```text
You are the Hygiene Scan agent for the Frapp repository: each day you fix one bounded, verified
hygiene theme across the codebase in one product-code PR that a human merges. Invoke the
hygiene-scan skill (.claude/skills/hygiene-scan/SKILL.md) and follow it; where the skill and this
prompt disagree, the skill wins. If you can't load the skill, report that and stop rather than
improvising from this prompt.

These limits hold regardless:
- You are the one routine that edits product code, within the skill's limits. Never touch
  migrations, CI workflows or dependency versions, and never push with --no-verify; the pre-push
  hook is the review gate.
- One PR per run, at most one open Hygiene Scan PR at a time, and never merge it.
- Use the GitHub MCP for tracker and PR work, never gh or REST. If it is unavailable, push the
  branch, report its name, and stop. Close, mark duplicate or rewrite the body only of issues
  labeled `suggestion`.
- Never write to Linear; it is retired.

The run is done when at most one Hygiene Scan PR (one theme, or one small batch as the skill
allows) is open, or you've written down why there is none; the rest is filed or in the ledger; and
the ledger comment is posted. This runs unattended: keep working through everything that doesn't
need the human, and put any status note in the same message as your next tool call. End earlier
only if nothing more can move without the human or a protected resource blocks you. Your final
message is the run report the skill specifies.
```

## How to create them (UI)

1. For each routine in the table at the top: [claude.ai/code/routines](https://claude.ai/code/routines)
   → **New routine**. Name it as in the table (e.g. "Issue Curator"), paste its prompt from
   [Routine prompts](#routine-prompts-copy-paste), pick the model in the prompt box, add repository
   `pdcarlson/Frapp`, select environment **Frapp**, set its schedule, remove every connector its
   Connectors row doesn't list, and take the remaining settings from
   [Settings](#settings-per-routine-set-in-the-routines-ui). A routine's `.claude/skills/<name>/`
   must be on `main` before you enable it, since that's where the session reads it.
2. Enable all five, and confirm each shows a next-run time.

Create routines in the UI. One created with `create_trigger` from an agent session can come out with
no repository and no connectors attached (Docs Upkeep did, on 2026-09-22), and a run without the repo
can't load its skill; check both before enabling it.

## Verify

Run each routine once manually, then again, and check:

- **Every routine:** each run adds exactly one [run record](#run-record-all-routines) to #2966,
  `outcome=done` unless the run really stopped.

- **Curator:** new issues land in `triage`, titled `[suggestion] …`, with `suggestion` + `area:*` +
  a priority + an Agent brief + the visible `fp=` marker. The second run files no duplicates
  (legacy HTML-comment markers, `agent-suggestion` or an older prefix with the same `fp=` grammar,
  count as matches). Existing `suggestion` issues get closed, refreshed or `stale`d; no other issue
  is touched; nothing reaches Linear.
- **Triage:** inbox items get a priority, and clearly actionable ones lose `triage`; ambiguous items
  and genuine human decisions stay in triage with a comment; nothing human-owned is closed or
  re-bodied; the run ends with the board-health report.
- **PR Follow-ups:** items land in `triage` titled `[pr-followup] …` / `[pr-followup][human] …`,
  with `suggestion` + `area:*` + a priority + a "How to do it" section + the `fp=pr-followup/…`
  marker. The "PR Follow-ups — Human Action List" issue exists with a fresh `pr-followups-state`
  marker. The second run files no duplicates, and earlier items close only with cited proof.
- **Docs Upkeep:** the report names its slice (group index and ISO week); it opens at most one PR,
  touching only its corpus, and that PR passes `link-check`; it opens no `area:docs` issue and no
  product code. A clean slice with no PR is a pass. A second run in the same week takes the same
  slice (the rotation comes from `date -u +%V` and the corpus).
- **Hygiene Scan:** the report leads with the PR link (or "no PR" and why), then its grounding
  (standards read, gate baselines, ledger and open PR checked) and the day's slice (group index and
  day of year). At most one PR, on `claude/hygiene-scan-YYYY-MM-DD`, whose body names the rule each
  fix restores and the verification run; it touches no `supabase/migrations/**`,
  `.github/workflows/**`, dependency versions or `apps/landing` visuals. Filed issues carry
  `triage` + `suggestion` + one `area:*` + a priority + an Agent brief + a visible `fp=hygiene/…`
  marker, and the "Hygiene Scan — ledger" issue (`routine-state`) gains exactly one comment. A
  second run the same day takes the same slice, opens no second PR, and files no duplicates. A run
  that fixes nothing and says why is a pass.

## Self-maintenance (the "update themselves" contract)

The skills defer to this section. Each routine ends its run by checking its own contract against
reality: the label roster, the commands its lenses run, the paths and links it cites, and whether a
new surface (an epic, label, spec area or MCP tool) should change its behavior. On drift:

- **Mechanical drift:** one docs-only PR per run on a `claude/…` branch, through the normal pre-push
  review gate, restricted to `.claude/skills/issue-curator/`, `.claude/skills/issue-triage/`,
  `.claude/skills/pr-followups/`, `.claude/skills/docs-upkeep/`, `.claude/skills/hygiene-scan/`,
  and this file. A human merges it, never the routine.
- **Judgment-laden drift:** a `suggestion` issue (`area:docs`) describing the change. Docs Upkeep
  never opens `area:docs` issues (ADR-16 amendment 6), so it puts this in its run report instead.

The PR targets `main`. Before ending the run, wait for its checks to finish, fix any failure your
change caused, and report anything still red or still pending, since no session watches the PR afterwards (Autofix is off for
routines 1–3). For routines 1–3 this PR is their only repo write. Docs Upkeep and Hygiene Scan fold
self-maintenance into their sweep or fix PR rather than opening a second one.

A `.claude/`-only PR needs no companion `docs/` change; the `docs-spec-sync` gate that forced one was
removed in #1597. Update this file alongside a skill only when the rule lives in both.

## Maintenance

- Behavior changes go in the skills. Change a prompt block here only when the prompt itself must
  change, then update the live Routine as the top of this file describes, since nothing reads this
  file at run time.
- Keep the [label roster](#label-roster) current. It is the only copy:
  [`github-pm.md`](github-pm.md#labels-and-priority-lean-taxonomy),
  [`file-follow-up`](../../.claude/skills/file-follow-up/SKILL.md) and
  [`issue-curator`](../../.claude/skills/issue-curator/SKILL.md) link here instead of restating
  it, because a duplicated roster drifts and can't carry the scope caveats the entries have.
  Adding a label is a one-place edit; renaming or redefining one also touches the skills that use
  it by name.
- Point a routine's lens commands at the command CI gates on, not the underlying tool. A routine
  files issues from a check's output, so a command that reports more than the gate blocks on turns
  accepted decisions back into new issues: use `npm run check:npm-audit` (the `dependency-audit`
  job's gate, which honours `scripts/npm-audit-allowlist.json`), not bare `npm audit`.
- Environment notes: [`spec/environments/README.md`](../../spec/environments/README.md#scheduled-backlog-agents).
