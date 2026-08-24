# Claude Code Routines

Canonical, version-controlled spec for Frapp's scheduled backlog agents, which run as **Claude Code
Routines** (claude.ai/code → the Frapp environment → **Routines**). Routines are configured in the
UI (config-as-code isn't supported), so this file is the source of truth you copy into the UI. Keep
it in sync when you change a routine. History of how backlog automation got here: ADR-16 and its
amendments in [`spec/architecture/README.md`](../../../spec/architecture/README.md); the
Linear-to-GitHub migration record is [#680](https://github.com/pdcarlson/Frapp/issues/680).

There are **four** routines — two staggered daily, two weekly. Three write to **GitHub Issues**
on `pdcarlson/Frapp` (Linear is retired); the fourth writes docs:

| # | Routine | Skill (behavior contract) | When |
| --- | --- | --- | --- |
| 1 | **Issue Curator** | [`.claude/skills/issue-curator/SKILL.md`](../../../.claude/skills/issue-curator/SKILL.md) | daily 08:00 ET |
| 2 | **Issue Triage** | [`.claude/skills/issue-triage/SKILL.md`](../../../.claude/skills/issue-triage/SKILL.md) | daily 09:00 ET (~1h after #1) |
| 3 | **PR Follow-ups** | [`.claude/skills/pr-followups/SKILL.md`](../../../.claude/skills/pr-followups/SKILL.md) | weekly Mon 07:00 ET (a full hour before #1–2 that morning) |
| 4 | **Docs Upkeep** | [`.claude/skills/docs-upkeep/SKILL.md`](../../../.claude/skills/docs-upkeep/SKILL.md) | weekly Wed 07:00 ET |

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
audits the `fp=human/…` blocker issues any agent session may file under the
[`file-follow-up`](../../../.claude/skills/file-follow-up/SKILL.md) skill, and
republishes the **"PR Follow-ups — Human Action List"** tracking issue; running it on Monday
*before* #1–2 means that same morning's curator/triage passes maintain and rank what it filed. Also weekly, on a different day, **Docs Upkeep** sweeps a rotating fifth of the docs corpus,
verifies its claims against code and providers, and **fixes what is wrong in a docs-only PR** — the
one routine that repairs rather than files, because docs debt filed as an issue reliably ages
instead of getting done. The routine prompts are thin — the real rules live in the skill files,
which the routine session loads from the repo.

> **Hard rule (see `AGENTS.md`):** all issues are **opened on GitHub with the `triage` label**.
> Work is **closed via PRs** (`Fixes #N`, native close-on-merge) or an explicit
> `issue_write` close with the right `state_reason`. These routines never write to Linear (retired)
> and never touch product code — their single repo-write permission is the
> [self-maintenance](#self-maintenance-the-update-themselves-contract) docs-only PR. **Docs Upkeep
> is the one exception to the *scope* of that PR, never to the product-code ban:** its whole job is
> editing `docs/` and `spec/`, on the same never-self-merged terms.

## Shared ownership boundary (all routines)

The five routine-facing skills ([`issue-curator`](../../../.claude/skills/issue-curator/SKILL.md),
[`issue-triage`](../../../.claude/skills/issue-triage/SKILL.md),
[`pr-followups`](../../../.claude/skills/pr-followups/SKILL.md),
[`docs-upkeep`](../../../.claude/skills/docs-upkeep/SKILL.md), and the tracker angle in
[`diff-review`](../../../.claude/skills/diff-review/SKILL.md)) **point here** instead of restating
this block. Policy detail: [`GITHUB_PM.md` → Ownership boundary](GITHUB_PM.md#ownership-boundary-organize-broadly-destroy-narrowly).

1. **Issues live on GitHub Issues** (this repository). Linear is retired — never write to it,
   never treat it as a fallback, never open a Linear issue.
2. **Destructive writes** (close, mark-duplicate, re-body, including adding an Agent brief) are
   allowed **only** on issues carrying the **`suggestion`** label. Confirm with `issue_read
   get_labels` before every such write; if `suggestion` is absent, SKIP and log. Human-filed and
   planning issues are strictly read-only for destructive actions.
3. **Never modify product code. Never open feature PRs.** Repo writes are docs-only, never merged
   by the routine, at most one PR per run, and confined to a path allowlist:
   - Routines 1–3: the [self-maintenance PR](#self-maintenance-the-update-themselves-contract),
     restricted to the routine's own skill files and this runbook.
   - **Routine 4 (Docs Upkeep):** its sweep PR, over `docs/**`, `spec/**`, the root guides, and
     its own skill directory — editing those *is* its job
     ([`docs-upkeep`](../../../.claude/skills/docs-upkeep/SKILL.md), ADR-16 amendment 6). The
     product-code ban binds it exactly as it binds the others.
4. **GitHub MCP only.** If it is unavailable, stop and report — no `gh`, no REST, no scratch file.
   Routine 4 is the exception: it writes a PR rather than issues, so an unavailable MCP does not
   block its sweep. It stops and reports if **git push** fails.
5. **`issue_write` labels replace the whole set.** Always send the union of existing labels plus
   the change.

Triage (only) may *organize* any `triage` item (priority, `Blocked by`, promote). That exception
is spelled in the triage skill; it does not widen destructive writes.

---

## Tracker access (shared by all routines)

Routine sessions run in the Frapp Claude Code web environment, whose harness **pre-approves the
GitHub MCP** (`mcp__github__*`) — the same path `/next` uses. No API key, no REST, no secrets to
manage (shell access to `api.github.com` is session-dependent and cannot be relied on). Each run
starts by loading the
GitHub MCP tool schemas (via `ToolSearch`, e.g.
`select:mcp__github__list_issues,mcp__github__issue_read,mcp__github__issue_write,mcp__github__add_issue_comment,mcp__github__search_issues`)
and verifying access (e.g. `issue_read` on a known issue resolves). **If the MCP is unavailable,
the routine stops and reports — there is no fallback tracker.** Routine 4 writes no issues, so this
section does not gate it; see rule 4 of the
[ownership boundary](#shared-ownership-boundary-all-routines).

> **No MCP read path returns a body faithfully — never source a body rewrite from one.**
> `issue_read`, `list_issues` **and** `search_issues` all strip HTML comments (the `fp=` dedup and
> `pr-followups-state` markers), strip tags including JSX inside ` ```tsx ` fences, and
> entity-escape `'` `"` `&` `>`. `search_issues` was the lossless exception until it regressed on
> all three vectors — confirmed 2026-08-20 against #357, #697 and #1086. Rewriting a body from any
> of them deletes content without any error, and because markers are how the routines recognise
> their own issues across runs, the damage surfaces a run later as a duplicate filing or a reset
> watermark. **The damage is read-only: stored bodies are intact and nothing needs back-filling.**
> So: **append a comment instead of rewriting**, or author the replacement body yourself; a rewrite
> sourced from a read needs the narrow escape hatch in
> [`GITHUB_PM.md` → Reading a body you intend to rewrite](GITHUB_PM.md#reading-a-body-you-intend-to-rewrite-mcp-read-fidelity),
> which is the canonical statement of this rule. Two consequences worth stating here: the `fp=`
> marker is now a **visible line, not an HTML comment**, and the `fp=` **lookup is healthy** —
> `search_issues` resolves fingerprints precisely, so dedup needs no redesign. Since it matches
> semantically rather than by number, still confirm the returned `number` is the issue you meant.
> Each skill states the rule for its own writes.

**Label roster** (auto-created on first use; re-verify with `issue_read get_labels` on a labeled
issue if anything looks off):

- **State:** `triage` · `in-progress` · `in-review` (Backlog = open with none of these)
- **Priority:** `P1` (urgent) · `P2` (high) · `P3` (medium) · `P4` (low) — exactly one per
  triaged issue
- **Ownership / lifecycle:** `suggestion` · `stale` · `human` (in use on #1146; **decorative
  only — it is not a hold mechanism**. The human-action hold is recognised by the `[human]` /
  `[pr-followup][human]` title prefix or the `**Human action required — hold in triage` body
  opener, per [`GITHUB_PM.md`](GITHUB_PM.md#labels-and-priority-lean-taxonomy); `/next` §0.2 reads
  the *title*. So a `human`-labelled issue whose title carries no prefix is held by its `triage`
  label alone, and promoting it would expose it to `/next` — the #709 failure mode. Whether this
  label should become a fourth recognised hold form is an open question for the owner, not a
  routine's call)
- **Area:** `area:api` · `area:web` · `area:db` · `area:deps` · `area:security` · `area:ci` ·
  `area:docs` · `area:product` · `area:ux` · `area:research` · `area:dx` (created in use rather
  than declared — it carries no label description; see #1049 and #1059. Rostered 2026-08-18 so
  routines stop reading it as a typo; its scope is the owner's to define) · `area:infra`
  (same story, rostered 2026-08-21 — in use on #1138, #1148, #1235 and #1240 for
  branch-protection, repo-settings and staging-environment work that is neither `area:ci` nor
  `area:dx`; carries no label description, and its scope is likewise the owner's to define) ·
  `area:mobile` (same story again, rostered 2026-08-24 — in use on #1237 for `apps/mobile`
  work that `area:ux` does not distinguish from the web surface; carries no label description,
  and its scope is likewise the owner's to define. Note the asymmetry it exposes: `area:web`
  is rostered but `area:mobile` was not, so mobile work had no home label while web did)
- **Scope:** `scope:production` — work that only becomes relevant once a production environment
  exists (owner decision 2026-08-10; see
  [`GITHUB_PM.md` → Labels and priority](GITHUB_PM.md#labels-and-priority-lean-taxonomy) and the
  [decision record on #814](https://github.com/pdcarlson/Frapp/issues/814#issuecomment-5245093672) —
  the decision lives in that comment, not #814's rebuilt-each-run body). Parked **by choice**, not
  blocked and not stale: routines must not mark these `stale`, must not raise their priority for
  age, and must not re-file duplicates of them.
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
| Schedule | Curator **daily 08:00 ET**; Triage **daily 09:00 ET**; PR Follow-ups **weekly Mon 07:00 ET**; Docs Upkeep **weekly Wed 07:00 ET** | If the UI takes cron in UTC: `0 12 * * *`, `0 13 * * *`, `0 11 * * 1`, and `0 11 * * 3` during EDT (shift +1h when ET returns to EST). Docs Upkeep sits on Wednesday so it never shares a morning with the PR Follow-ups batch. Daily/weekly cadence — no per-PR trigger. Flip PR Follow-ups to twice weekly with `0 11 * * 1,4` if a week's batch runs long. |
| Model | **Daily routines: Opus 5** (`claude-opus-5`). **Weekly routines: Fable 5** (`claude-fable-5`). | Cadence sets the tier, not the routine. The dailies (Curator, Triage) carry the tracker and run often enough that a weaker judgement call compounds; the weeklies (PR Follow-ups, Docs Upkeep) do bounded, evidence-heavy passes. Owner convention, 2026-08-21. |
| Autofix on PR create | **Off** for Curator, Triage and PR Follow-ups. **On** for Docs Upkeep. | Not an inconsistency. The first three barely open PRs — only self-maintenance — so autofix would mostly be dormant, and a tracker routine repairing its own CI unattended is out of its lane. Docs Upkeep opens a docs-only PR every run, and the failures it is likeliest to hit (`doc-paths`, `doc-tables`, `link-check`) are docs problems in its own scope that its own sweep caused. Handing those back as a red PR would contradict the routine's premise, which is that it repairs rather than files. |
| Session | fresh session per run | Each run re-reads its skill from `main` — no state carried between runs; the tracker itself is the memory (markers, labels, comments). |
| Access | **GitHub MCP** (pre-approved by the environment) | Plus the repo itself for the curator's engineering/spec lenses. No secrets needed. |
| Connectors | Per-routine, set in the Routines UI. **GitHub is not one of them** — it comes from the environment, so it needs no connector and adding one is not the fix for a missing `mcp__github__*` tool. | Attach only what the routine actually verifies against — the provider connectors [`infrastructure-research`](../../../.claude/skills/infrastructure-research/SKILL.md) uses. A routine can use every tool from an attached connector, **including writes, without prompting**, so an unrelated one is standing write access nothing in this runbook governs. The live per-routine list is in the UI; this file deliberately does not copy it. |

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

**Routine 4 — "Docs Upkeep"** (weekly Wed 07:00 ET):

```text
You are the Docs Upkeep agent for the Frapp repository — you keep the documentation true. Invoke
the docs-upkeep skill (.claude/skills/docs-upkeep/SKILL.md) and follow it EXACTLY: pick this
week's slice by the rotation the skill defines (do NOT carry state between runs), read every file
in it, and verify the claims that a machine can settle — commands against package.json, CI jobs
and required checks against .github/workflows and configure-branch-protection.mjs, env var names
against the codebase, paths via check-doc-paths, provider state via infrastructure-research. FIX
what is wrong, in one docs-only PR restricted to the skill's path allowlist, and prefer deleting a
duplicated fact and linking to its canonical home over syncing two copies. NEVER open an
area:docs issue — this routine repairs, it does not file; anything not fixable in a docs edit goes
in the run report instead. Never modify product code, never rewrite an ADR in place, never merge
your own PR. Zero changes is a perfectly good outcome — never manufacture edits to show work. Say
"unverified" rather than guessing when a provider is unreachable. Where this prompt and the skill
disagree, the skill wins. End with the run report the skill specifies, leading with the slice and
the "found but not fixable" list.
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
6. Repeat for **"Docs Upkeep"**, scheduled **weekly Wed 07:00 ET**, with the **Docs Upkeep**
   prompt.
7. Enable all four.
8. **One-time migration step (2026-08) — treat as urgent, not housekeeping:** the three
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
- **Docs Upkeep:** run it once manually. Confirm it reports which slice it took (group index +
  week number) and opens **at most one** docs-only PR, touching only the corpus its skill defines
  — `docs/`, `spec/`, `.claude/skills/**/*.md`, any `AGENTS.md`, root `CONTRIBUTING.md` /
  `README.md`. Confirm it opens **no** `area:docs` issue, leaves product code untouched, and that
  the PR passes `doc-paths`, `docs-spec-sync` and `link-check`. **A clean slice means no PR at
  all** — a report saying so is a pass, not a failure. Run it again the same week → the **same**
  slice (the rotation is derived from `date -u +%V` and the corpus, not random).
- Confirm all schedules show a next-run time.

## Self-maintenance (the "update themselves" contract)

**This section is the binding contract — the skills defer to it.** All routines end each run
by verifying their own contract against reality — the label roster above,
the commands their lenses run, the links and file paths they cite, and whether new surfaces (a new
epic, label, spec area, or MCP tool) should change their behavior. On drift:

- **Mechanical drift** → the routine opens a **docs-only PR** restricted to
  `.claude/skills/issue-curator/`, `.claude/skills/issue-triage/`,
  `.claude/skills/pr-followups/`, `.claude/skills/docs-upkeep/`, and this file, on a `claude/…`
  branch through the normal pre-push review gate. At most one per run; the routine never merges it —
  a human does.
- **Judgment-laden drift** → the routine files a `suggestion` issue (`area:docs`) describing the
  change instead. **Routine 4 does not do this** — it is forbidden from opening `area:docs` issues
  at all, and reports judgement-laden drift to the owner in its run report instead (ADR-16
  amendment 6, and the reasoning in
  [`docs-upkeep`](../../../.claude/skills/docs-upkeep/SKILL.md)).

For routines 1–3 this is their **only** permitted repo write. Routine 4 also has its sweep PR,
per rule 3 of the [ownership boundary](#shared-ownership-boundary-all-routines).

> **A `.claude/`-only self-maintenance PR cannot merge — always pair it with this file.**
> `docs-spec-sync` is a **required** check under `enforce_admins: true`, and
> `scripts/check-docs-impact.mjs` classifies a path as documentation only when it starts with
> `docs/` or `spec/` (`const DOCS_OR_SPEC = ["docs/", "spec/"]`). `.claude/` matches neither, so a PR
> touching only a `SKILL.md` reads to the gate as "code changed, no docs updated" and fails it.
> Dependabot is the only *authorship*-keyed exemption; the `no-doc-change-needed` label applies here
> too, though for self-maintenance the pairing below is usually the better answer. Every
> `.claude/skills/` change merged to date has carried a
> `docs/` file alongside it (#1075 is the pattern: skill + `GITHUB_PM.md` + `AGENTS.md`). Since this
> file is both inside the allowed path set and under `docs/`, updating it alongside the skill
> satisfies the gate — and usually should anyway, because a rule worth changing in a skill is
> normally a rule this contract or [`GITHUB_PM.md`](GITHUB_PM.md) also states. Verified 2026-08-19
> against `.github/workflows/docs.yml` and `.github/workflows/ci.yml`; #810 tracks teaching the gate
> about `.claude/` so this workaround stops being necessary.

## Maintenance

- Behavior changes go in the routines' `.claude/skills/*/SKILL.md` files; only re-paste a routine
  prompt if the prompt block itself changes.
- Keep the label roster above current if the taxonomy changes (self-maintenance automates the
  check).
- Environment notes: [`spec/environments/README.md`](../../../spec/environments/README.md#claude-code-routines-environment).
