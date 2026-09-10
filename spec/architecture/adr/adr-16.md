### ADR-16: Project management — retire the in-repo backlog, adopt Linear as canonical (2026-06-01)

**Decision (2026-06-01):** Adopt **Linear** as Frapp's canonical project-management system and retire the in-repo markdown backlog (`docs/backlog/`).

**Removed 2026-09-05.** The Decision, Rationale, Consequences, Trigger to revisit and amendments 1–3 described operating Linear: the cut-over steps, the MCP probe results, Cursor's key-led automation, and how the 250-issue cap bound on active rather than Backlog issues. **Linear was retired on 2026-08-08** (amendment 5 below) and the workspace is gone, so none of it describes anything that exists. Kept, because it is the part nobody can reconstruct:

- **Why the flat-file backlog was retired:** diff-able and agent-readable, but a poor human PM surface — no board, no prioritisation UI, manual reconciliation, and it went stale as fast as the code.
- **Alternative rejected:** GitHub Projects, which had been rejected once before and was unreachable from the cloud agent (no Projects MCP tool, no `gh` CLI in the web sandbox).
- **The escape hatch it named, never evaluated:** the deleted Trigger to revisit listed "cost or team changes make a different tool (or **self-hosted Plane**) preferable". Plane was the direction to move *toward* if cost changed — it was never assessed and never rejected. Do not read it as ruled out.
- **The risk that materialised:** the decision recorded MCP availability as its main risk and mitigated it by keeping GitHub Issues as a synced always-available surface. That mitigation is what made the 2026-08-08 retirement cheap — Linear's MCP write tools requiring a manual permission step per call is what finally forced it.
- **Dated measurements the deleted amendments carried**, kept because they are evidence rather than narration. Amendment 3's cap finding, verified via `/next` on **2026-06-03**: the workspace held **276 non-archived issues — 260 Backlog, ~2 active** — and issue creation still succeeded at 276, which is how the 250 cap was established as binding on *active* (Started + Unstarted) rather than on the Backlog. Amendment 2's probe established that a headless Cursor background agent had **no Linear MCP and no injected credentials**, which is the only reason a `LINEAR_API_KEY` (a Cursor cloud-agent secret, used against `https://api.linear.app/graphql`) was ever minted — it is dead and marked for revocation in [`AGENT_CREDENTIALS.md`](../../../docs/internal/environment/AGENT_CREDENTIALS.md). Amendment 1 also recorded a non-Linear fact: `/triage`, `/status` and `/next-task` were deleted and replaced by `/next`.

Work tracking today is **GitHub Issues** — see amendment 5 and [`GITHUB_PM.md`](../../../docs/internal/ci-cd/GITHUB_PM.md).

**Read amendments 4–9 below with one caveat each way.** Amendments **5–7 and 9 are current**. Amendment **8 is not as originally written**: its Cursor-primary / Claude-fallback / later-teardown operating model is reversed by **amendment 9**. Amendment **4 is not as originally written**: it predates the Linear retirement by five days, so it still calls the routines "Linear Issue Curator"/"Linear Triage", names `.claude/skills/linear-curator/` and `linear-triage/` (renamed since to `issue-curator/` and `issue-triage/`), and its "Unchanged and reaffirmed" bullet states *"issues are born in Linear, never GitHub"* — **which amendment 5 explicitly reverses**. **Corrected 2026-09-09:** the other surviving claim — that automations live only on Claude Code Routines and Cursor was retired — was reversed by **amendment 8**. **Corrected 2026-09-10:** amendment 8 then ranked Cursor primary and scheduled Claude teardown; **amendment 9** reverses that ranking. What remains historically true of amendment 4 is the 2026-08-03 move of scheduled agents onto Claude Code Routines (still a live scheduled path). It also cites amendments 1–3 by number in four places; those are removed, and what they said is: (1) the original keyless MCP access model, (2) a `LINEAR_API_KEY`/GraphQL exception to it, and (3) that Linear's 250-issue cap bound on *active* (Started + Unstarted) issues rather than Backlog — a cap that no longer applies to anything, GitHub Issues having none.

#### ADR-16 amendment 4 — backlog automations move to Claude Code Routines; Cursor retired (2026-08-03)

**Corrected 2026-09-09 (amendment 8); corrected again 2026-09-10 (amendment 9):** "Cursor was retired" is no longer true — Cursor Cloud is a first-class agent environment. Amendment 8 then made it *primary* with Claude as fallback pending teardown; amendment 9 reverses that ranking. Both Cursor Cloud and Claude Code are independent first-class environments. Claude Code Routines remain a live scheduled path. Linear stays retired (amendment 5) — this correction does not restore Linear or `LINEAR_API_KEY`. The rest of this amendment is the 2026-08-03 historical record of the move onto Claude Routines.

The two backlog automations no longer run on Cursor. Development has consolidated on Claude Code, so
the **Linear Issue Curator** and **Linear Triage** flows now run as scheduled **Claude Code
Routines** — fresh cloud sessions in the same web environment as interactive work, on the same
staggered daily cadence.

- **Keyless again — amendment 1's access model is restored.** Routine sessions inherit the
  environment's injected **native Linear MCP**, so amendment 2's `LINEAR_API_KEY`/GraphQL exception
  (a workaround for a headless sandbox with no MCP) is retired along with the platform that required
  it. The key can be revoked; if the MCP is unavailable at fire time the routine stops and reports —
  no key fallback.
- **Behavior contracts moved into the repo's skill layer:** `.claude/skills/linear-curator/SKILL.md`
  and `.claude/skills/linear-triage/SKILL.md`; the `.cursor/` tree is deleted and the task playbooks
  it held migrated to `.claude/skills/` as well. Runbook + paste-ready Routine prompts:
  [`docs/internal/ci-cd/ROUTINES.md`](../../../docs/internal/ci-cd/ROUTINES.md) (formerly
  `CURSOR_AUTOMATIONS.md`; amendment 1–2 links repoint there).
- **Amplified in the move:** a fourth curator discovery lens (live runtime signals — Sentry, Supabase
  advisors, CI — through the MCPs the environment injects); a per-issue **Agent brief**
  (`depth:` / `model:` / `ultracode:`, defaulting to `depth:deep`) that the curator writes, triage
  backfills, and `/next` honors when scaling verification and review depth (policy:
  `LINEAR_PM.md`, now [`GITHUB_PM.md` → Agent briefs](../../../docs/internal/ci-cd/GITHUB_PM.md#agent-briefs-depth--model--ultracode));
  a triage board-health report each run; and a bounded **self-maintenance contract** — each routine
  verifies its own config against the live workspace and may open a **docs-only PR restricted to its
  own skill files and runbook**, the routines' only permitted repo write.
- **Unchanged and reaffirmed:** issues are born in Linear, never GitHub; the `suggestion` ownership
  boundary with the pre-write label gate; the conservative net-new budget and the active-scoped cap
  guard (amendment 3); routines never touch product code.
- Legacy `<!-- cursor-suggestion: … -->` dedup markers in existing issue bodies stay valid (dedup
  matches on the `fp=` string); new filings embed `agent-suggestion`, and old bodies upgrade
  opportunistically when refreshed. *(Superseded 2026-08-20 on form only: the marker is now a
  **visible line** rather than an HTML comment, because the GitHub MCP read has repeatedly deleted
  comments — hiding the marker from the search index too. That has since recovered (2026-09-05) but
  the visible-line form stays, because the defect has flipped four times and a visible line costs
  nothing. The `fp=` grammar and the dedup rule are unchanged, and comment-form markers remain
  valid. See [`GITHUB_PM.md` → Reading a body you
  intend to rewrite](../../../docs/internal/ci-cd/GITHUB_PM.md#reading-a-body-you-intend-to-rewrite-mcp-read-fidelity).)*

#### ADR-16 amendment 5 — Linear retired; GitHub Issues becomes canonical (2026-08-08)

**Decision:** retire Linear entirely and make **GitHub Issues** on `pdcarlson/Frapp` the canonical
tracker. Owner-approved 2026-08-08, conditional on a viability test that passed: GitHub issue
writes from a **fresh** cloud sandbox ran prompt-free (owner-observed — the only valid instrument
for permission behavior), because the cloud harness pre-approves the whole GitHub MCP
(`mcp__github__*` in its `--allowed-tools`). Linear's write tools, by contrast, prompted in every
cloud session, and three shipped workarounds (#667 server-level allows, #669 connector-UUID
allows, #676 PreToolUse auto-allow hook) failed — each with an invalid verification claim, since
an agent cannot observe permission prompts. Decision record, probe table, and migration mapping:
[#680](https://github.com/pdcarlson/Frapp/issues/680).

- **This reverses amendment 4's "issues are born in Linear, never GitHub" rule**: issues are now
  born on GitHub with the `triage` label. Board states become label conventions
  (`triage`/`P1`–`P4`/`in-progress`/`in-review` + native `state_reason` on close); epics use
  native sub-issues; `Fixes #N` closes work on merge with no sync layer at all.
- **Migration shape:** all 206 open GitHub issues were already 1:1 twins of open Linear issues
  (the June import + one-way GitHub→Linear sync); the 60 Linear-born issues without twins were
  recreated on GitHub; priority labels were applied across the open set. Nothing was closed by
  the migration.
- **Carried over unchanged:** the `suggestion` ownership boundary and pre-write label gate, the
  Agent brief, the `fp=` dedup markers, the conservative net-new budget, the three Routines
  (renamed **Issue Curator** / **Issue Triage** / PR Follow-ups; skills at
  `.claude/skills/issue-curator/`, `.claude/skills/issue-triage/`), and the `/next` claim
  protocol (claims are still comments; GitHub comments are append-only and server-timestamped).
  Amendment 3's 250-active cap accounting is moot — GitHub has no cap.
- Policy doc: [`GITHUB_PM.md`](../../../docs/internal/ci-cd/GITHUB_PM.md) (replaces `LINEAR_PM.md`);
  runbook: [`ROUTINES.md`](../../../docs/internal/ci-cd/ROUTINES.md).

#### ADR-16 amendment 6 — a fourth Routine, and the first that fixes instead of files (2026-08-21)

**Context:** amendment 5 carried over *three* Routines, all of which file GitHub issues and none of
which edit docs. Documentation drift was left to `check-our-docs`, a mid-task habit with the
coverage of whatever a session happened to read, so the low-traffic runbooks a cold session most
needs were never swept. Routing that debt to the tracker instead did not work: well over half of
all `area:docs` issues ever filed were still open, roughly a third of the open ones were
five-minute fixes on the day they were filed, and several had never been touched since.

**Corrected 2026-09-05:** `check-our-docs` was retired. The paragraph above records what was true
on 2026-08-21; that responsibility now sits in the documentation standard
([`DOCUMENTATION_CONVENTIONS.md`](../../../docs/internal/DOCUMENTATION_CONVENTIONS.md)) and in the
docs angle of [`diff-review`](../../../.claude/skills/diff-review/SKILL.md).

**Decision:** add a fourth Routine, **Docs Upkeep** (`.claude/skills/docs-upkeep/`), weekly on
Wednesday. It sweeps a calendar-derived rotating fifth of `docs/` and `spec/`, verifies the claims
a machine can settle, and **fixes them in a docs-only PR**. It is explicitly forbidden from opening
`area:docs` issues — anything not fixable in a docs edit goes in its run report to the owner.

**What this changes and what it does not.** It widens the *scope* of the self-maintenance docs-only
PR from a routine's own skill files to `docs/`, `spec/` and the root guides. It does **not** relax
the product-code ban, the never-self-merge rule, the one-PR-per-run cap, or the pre-push review
gate. It inverts the report-don't-fix posture scheduled routines had inherited (from the
retired `check-our-docs` skill's §"Inside a scheduled routine" — see the Context above) and
[`audit`](../../../.claude/skills/audit/SKILL.md)'s read-only posture **for this routine only**; the
other three still file rather than fix. **Corrected 2026-09-05:** this amendment also said "ADRs
stay append-only — the routine may not rewrite one to match today's code." That carve-out is
revoked (ADR-18); ADRs are ordinary docs, and this routine corrects a wrong one in place like any
other.

- Runbook: [`ROUTINES.md`](../../../docs/internal/ci-cd/ROUTINES.md).

#### ADR-16 amendment 7 — a fifth Routine, and the first that edits product code (2026-09-02)

**Context:** amendment 6 left four Routines that between them keep the tracker and the docs
honest and never touch product code. Code hygiene had the problem docs had before amendment 6:
the Curator's engineering lens *files* it, and filed hygiene ages. The repo has no dead-code
tooling at all; its anti-pattern catalogue (the rule sections of `spec/engineering.md`) is
enforced only by whoever happens to be reading; `dependency-cruiser` carries seven grandfathered
violations that "exist to shrink"; and `jscpd` is a repo-wide percentage that only ratchets down
when someone consolidates. A first scheduled sweep landed with #1539 as a skill plus eight fixes,
without a runbook entry or an ADR, so the docs contradicted the repo: `ROUTINES.md` still said
four routines under a product-code ban that the fifth skill on `main` broke. Its fixes also showed
what an ungrounded sweep does: it traded one domain-layer import for a try/catch at four sites,
three of them byte-identical (then filed #1538 to dedupe those three), restyled a line of the
frozen `apps/landing`
surface on the strength of an "established idiom" that exists nowhere in the repo, and moved a file
out of a grandfathered violation without shrinking the baseline.

**Decision:** add a fifth Routine, **Hygiene Scan** (`.claude/skills/hygiene-scan/`, replacing the
#1539 skill), daily at 06:00 ET on **Fable 5.1**. It grounds itself first — the engineering
standard, the tech-debt protocol, the Signet-vs-legacy line, the app skill for the day's area, the
gates and their baselines, the ledger of prior runs — then reads a calendar-derived fifth of the
codebase *whole*, never just the recent diff, questioning legacy shapes rather than patching
around them, and **fixes one bounded, verified theme in a product-code PR** that a human merges.
What it will not fix unattended it files through `file-follow-up` (capped per run) or records in a
`routine-state` ledger issue so the next run does not re-litigate it.

**What this changes and what it does not.** It lifts the product-code ban **for this routine
only**, and only for repair: whole-pattern fixes that delete what they replace, leave the codebase
net simpler, and are proven by typecheck, lint, the workspace tests and the gates that cover the
change. It keeps every other rule — never self-merge, one PR per run, at most one open PR at a
time, the pre-push review gate, no migrations, no CI workflows, no dependency bumps, no visual
change on a frozen surface, no behaviour change except a bug fix carried by a failing-then-passing
test and called out on its own. It also makes the first exception to the 2026-08-21 "cadence sets
the tier" model convention: this daily routine runs on the top tier because editing product code
unattended is where a weaker judgement is most expensive.

- Runbook: [`ROUTINES.md`](../../../docs/internal/ci-cd/ROUTINES.md).

#### ADR-16 amendment 8 — Cursor Cloud is the primary agent environment (2026-09-09)

**Corrected 2026-09-10 (amendment 9):** Cursor-primary / Claude-fallback / teardown #2028 is no longer the operating model. Both harnesses are independent and first-class. The rest of this amendment is the 2026-09-09 historical record of adding Cursor Cloud as a shipping environment (fail-closed review gate, `.cursor/environment.json` contract, paste-ready Automations).

**Decision (as of 2026-09-09, superseded by amendment 9):** make **Cursor Cloud** Frapp's primary agent environment and retire Claude Code as *primary*. Claude files (`.claude/**`, `scripts/cloud-sandbox-up.sh`) stay in-tree as fallback until Automations are observed and a later teardown PR in the same epic (#2017, teardown #2028).

This reverses amendment 4's "Cursor retired" operating model. It does **not** reverse amendment 5: GitHub Issues stays canonical; Linear stays retired; do not restore `LINEAR_API_KEY`.

**What is true as of this amendment (verified against the repo and Cursor docs, 2026-09-09; Prompt 2 rework the same day after #2043 landed on `main`):**

- Interactive work: Cursor Cloud. Public contract: [`.cursor/environment.json`](../../../.cursor/environment.json) (`install` `scripts/cursor-agent-install.sh`, `start` `scripts/cursor-cloud-up.sh`, terminals `scripts/cursor-cloud-terminal.sh` — #2043). Skills currently live under `.claude/skills/` (Cursor loads that tree). Moving them to `.cursor/skills/` is a gated later step — not this change. `/next` on Cursor is [`.cursor/commands/next.md`](../../../.cursor/commands/next.md) pointing at the existing procedure.
- Pre-push review gate: **`/diff-review`**. Cursor Cloud loads project [`.cursor/hooks.json`](../../../.cursor/hooks.json) (`beforeShellExecution`, `failClosed: true`; Cursor defaults fail-open). A thin adapter reuses `.claude/hooks/pre-push-review-gate.sh`. Evidence marker `.cache/diff-review/<HEAD_SHA>`. Cursor built-ins (`/review`, Bugbot) are not the gate. Runbook: [`AI_CODE_REVIEW_RUNBOOK.md`](../../../docs/internal/ci-cd/AI_CODE_REVIEW_RUNBOOK.md).
- PR babysit: harness-owned. Do not freeze subscribe/PR tool names in this ADR or in `AGENTS.md`. Wake-path *facts* (CI wake comments, base-sync) live in [`pr-babysitting.md`](../../../docs/internal/ci-cd/pr-babysitting.md).
- Scheduled agents: **intended** runtime is Cursor Automations. Paste-ready specs live in [`ROUTINES.md`](../../../docs/internal/ci-cd/ROUTINES.md). They are **not live** until a human pastes them (#2024) and a run is observed (#2027). Cron Automations default to no repository — every code-writing automation must attach this repo. Hygiene Scan must not be enabled without a healthy repo-backed stack.
- Egress: production-withholding allowlist is a dashboard decision (#2025). Canonical host list stays in [`CLOUD_SANDBOX.md`](../../../docs/internal/environment/CLOUD_SANDBOX.md). Do not invent hosts; do not put secrets in `environment.json`.
- Secrets: user secrets are unavailable during Cursor Builds; `DOCKERHUB_*` must be environment/team secrets.

**Alternatives rejected:** a dual-path hold with Claude remaining primary while Cursor is "also supported" — the review-gate hole on Cursor is a fail-open push path, so Cursor must own the gate if it is the session that ships. Silent deletion of `.claude/**` in the same change — Cursor still loads `.claude/skills` and `start` still calls `cloud-sandbox-up.sh`. Making Bugbot the review gate. Restoring Linear. Prescribing this harness's subscribe/PR tool names in `AGENTS.md`.

**Trigger to revisit (superseded 2026-09-10):** Cursor Automations observed healthy (#2027) → teardown PR (#2028) may delete Claude-only surfaces without leaving a dual skill tree. Skills move `.claude/skills` → `.cursor/skills` is gated on the owner confirming the Prompt 1 `/env setup` chat is finished. Amendment 9 cancels that teardown path.

#### ADR-16 amendment 9 — Cursor Cloud and Claude Code are independent first-class agent environments (2026-09-10)

**Decision:** reverse amendment 8's "Cursor is primary / Claude is fallback / later teardown" operating model. **Cursor Cloud and Claude Code are independent, first-class agent environments.** Neither is primary. Neither is a fallback pending deletion. Claude files (`.claude/**`, SessionStart, `scripts/cloud-sandbox-setup.sh`) stay. Cursor files (`.cursor/environment.json`, fail-closed hooks, `scripts/cursor-cloud-up.sh`) stay. Shared bringup (`scripts/cloud-sandbox-up.sh`) stays shared. Skills stay under `.claude/skills/` because both harnesses load that tree — do not copy into `.cursor/skills/` and do not delete `.claude/**`.

This does **not** reverse amendment 5: GitHub Issues stays canonical; Linear stays retired; do not restore `LINEAR_API_KEY`.

**What is true as of this amendment:**

- Interactive work: either harness. Cursor public contract: [`.cursor/environment.json`](../../../.cursor/environment.json) (`install` `scripts/cursor-agent-install.sh`, `start` `scripts/cursor-cloud-up.sh`, terminals `scripts/cursor-cloud-terminal.sh` — #2043). Claude public contract: Claude web Setup script (`scripts/cloud-sandbox-setup.sh`) plus SessionStart ([`.claude/hooks/session-start.sh`](../../../.claude/hooks/session-start.sh)). Both wait on `.cloud-sandbox-up.done`. Agent instructions: [`AGENTS.md`](../../../AGENTS.md).
- Pre-push review gate: **`/diff-review`**, same evidence marker (`.cache/diff-review/<HEAD_SHA>`). Cursor adapter: [`.cursor/hooks.json`](../../../.cursor/hooks.json) `beforeShellExecution` with `failClosed: true`. Claude adapter: `.claude/hooks/pre-push-review-gate.sh` via `.claude/settings.json` `PreToolUse`. Each session that ships owns its adapter. Cursor built-ins (`/review`, Bugbot) are not the gate. Runbook: [`AI_CODE_REVIEW_RUNBOOK.md`](../../../docs/internal/ci-cd/AI_CODE_REVIEW_RUNBOOK.md).
- Scheduled agents: Claude Code Routines remain a live scheduled path. Cursor Automations remain paste-ready in [`ROUTINES.md`](../../../docs/internal/ci-cd/ROUTINES.md) for a Cursor scheduled path. Do not run the same routine on both at once (they would double-file). There is no planned Claude Routines disable and no planned `.claude/**` teardown.
- Skills home: `.claude/skills/` is the single skill tree. Cursor loads it. Moving to `.cursor/skills/` is not planned.
- Egress: production-withholding allowlist is a dashboard decision on whichever harness you use (#2025 for Cursor). Canonical host list stays in [`CLOUD_SANDBOX.md`](../../../docs/internal/environment/CLOUD_SANDBOX.md).

**Alternatives rejected:** restoring amendment 4's "Cursor retired / Claude-only". Keeping Cursor-primary with Claude as a temporary fallback (#2017 / #2028). Silent deletion of either tree. Dual-running Curator/Triage on both scheduled platforms. Restoring Linear. Making Bugbot the review gate.

**Trigger to revisit:** none scheduled. Revisit only if one harness stops being able to ship independently.
