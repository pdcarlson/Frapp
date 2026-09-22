---
description: Claim the next viable unit of tracker work — one GitHub issue, or a small coherent batch — as In Progress before touching it, complete it, and keep the tracker in sync — safe to run in several sessions at once
argument-hint: "[123 ...] [--plan-only N]"
---

Claim one unit of work (usually one GitHub issue on `pdcarlson/Frapp`, sometimes a small coherent
batch), ship it as one PR, and leave the tracker cleaner than you found it. Several sessions run
this at once. The Phase 0 claim protocol keeps them off each other's work, so it runs before
anything expensive.

Policy lives in [`GITHUB_PM.md`](../../docs/internal/ci-cd/GITHUB_PM.md); this file is the
procedure. Where they disagree, `GITHUB_PM.md` wins and this file is the bug. A rule that every
`/next` run and other skills both need belongs there, linked from here.

## Invariants

**Claim before you think.** Selection and claim come first; verification runs against work you
already own. A claim is two reversible writes, while two agents building the same issue is waste
nobody can undo.

**Don't start in plan mode.** Phase 0 writes to the tracker, and plan mode forbids writes. If a plan
is demanded, the §1.2 verification comment on the issue is the plan. Plan mode belongs only on a
§1.3 veto.

**The GitHub MCP is the only tracker path.** If any `mcp__github__*` tracker call fails, stop and
report: no unclaimed work, no `gh`, REST, other tracker, or scratch file, no deferred writes. REST's
narrow carve-outs
([`GITHUB_PM.md` → How agents reach the tracker](../../docs/internal/ci-cd/GITHUB_PM.md#how-agents-reach-the-tracker))
never cover listing, searching, filing, labeling, closing, or commenting. Load schemas first:
`ToolSearch("select:mcp__github__list_issues,mcp__github__issue_read,mcp__github__issue_write,
mcp__github__add_issue_comment,mcp__github__search_issues,mcp__github__search_pull_requests")`.

**Ownership is per run, not per turn.** From your `AGENT-CLAIM` until the PR is open, you own every
issue you claimed. Ending a turn mid-run needs only a heartbeat. Ending the run (you won't resume
this work in this session) needs an `AGENT-RELEASE` or `AGENT-HANDOFF` on each still-held issue as
your last action before responding. The Exits table lists every run-ending situation; if yours isn't
there, the run isn't ending. An issue left silently In Progress is blocked for every other session
until its lease expires.

**One coherent unit per invocation.** One branch, one coherent, revertible PR; what varies is how
many issues it closes. Batch only when every member independently clears §0.2, would be a
shippable PR by itself, and the set reads as one change: same root cause, same subsystem, or
mechanical kin a reviewer would want in one diff. If the PR body would need an unrelated section per
issue, those are separate runs. The `MAX_BATCH` caps bound elective batching. An inseparable
parent+sub-issue unit ("add column" + "use column") is claimed whole regardless of member count, but
its combined estimate still counts: past 8 it is an E4 conversation, not a silent claim. An
unestimated member may join only when it is honestly small: it counts as 2 toward the ceiling, a
batch takes at most one, and one you can't size runs solo. Estimates (the optional
`Estimate: <fibonacci>` body line) gate batching, never candidacy.

**Nothing discovered is dropped.** A defect, drift, or coverage gap you notice mid-run is fixed now
or filed. Fix it now when it sits in or next to the surface you're touching, doesn't change the PR's
revert story, and wouldn't itself trip a §1.3 veto (destructive DDL, auth/RLS, and billing are never
drive-bys); note it in the PR body. Otherwise file it (`issue_write` create, labels `triage` + a
priority + one `area:<x>`, `file:line` evidence, an Agent brief when you can). A fixed defect that
deserves its own record (user-visible, security, anything someone would search the tracker for) is
filed and claimed into the unit: same `CLAIM_ID`, claim comment and all. This record-keeping claim
sits outside `MAX_BATCH` and the estimate ceiling, which cap planned scope, and it is the only time a
`triage` issue is claimable. Needing a second one means the unit was mis-scoped: finish, and say so
in the PR.

**Ultracode changes how thoroughly a step is done, never which steps run or what is written to the
tracker.** The opt-in is `ultracode` in this command's arguments or a session-level ultracode
reminder; the harness never emits that reminder on a slash-command turn, so the argument alone
counts. When opted in, run the named fan-out points with the Workflow tool: §1.1, §1.2, Phase 3's
lens pass, and Phase 2's narrow exception. Everything else stays inline, and without the opt-in the
fan-out points run inline in the same order. A Workflow launch that prompts or is refused is tool
unavailability, not an opt-out: run that step inline instead of waiting on an approval. A subagent
that errors or returns nothing is a check not run; redo it inline. Fan-outs are for independent,
context-heavy reading; don't spawn subagents to re-check your own work.

**Honor the issue's Agent brief**, an `### Agent brief` section in the description or in a triage
comment (`` `depth:<skim|standard|deep>` · `model:<fable|any>` · `ultracode:<yes|no>` ``; policy in
[`GITHUB_PM.md` → Agent briefs](../../docs/internal/ci-cd/GITHUB_PM.md#agent-briefs-depth--model--ultracode)).
`depth` sets how hard to dig, never which steps run, and `/diff-review` is never reduced. An absent
brief or `depth:` field means `deep`, the widest verification and review you can run; `skim` means
each step's floor suffices. `model:` and `ultracode:` are spin-up hints for whoever launches
sessions, which `--plan-only` carries into its prompts.

**Evidence of live work** is a live claim comment, a branch named in one, or a linked PR
(`search_pull_requests` for the issue number / `Fixes #N`), never assignees or labels: migrated
issues carry stale assignees, and an `in-progress` label can outlive its session.

**Label writes replace the whole set.** `issue_write`'s `labels` field overwrites the issue's labels,
so every label change below means: read the set (`issue_read get_labels`), apply the delta, write
back the full union.

## Constants

| Name | Value |
| --- | --- |
| `CLAIM_ID` | 8 hex chars (`openssl rand -hex 4`), generated **once** per run, reused in every comment you post |
| `MAX_BATCH` | **3 elective members** per claimed unit, combined estimate **≤ 8**; any single issue ≥ 5 runs solo. Inseparable parent+sub-issue units are exempt from the member cap (not the ceiling); record-keeping claims sit outside both |
| `LEASE` | **4 hours**, renewed by every heartbeat |
| `ORPHAN_AGE` | **72 hours** — an `in-progress` issue with *no* claim comment, no linked PR and no activity this long is abandoned |
| Sentinels | `AGENT-CLAIM` `AGENT-RECLAIM` `AGENT-HEARTBEAT` `AGENT-RELEASE` `AGENT-HANDOFF` `AGENT-STALE-FLAG` — always the comment's first line |

A claim is **live** when its `claim_id` has no later `AGENT-RELEASE` carrying the same id and its
lease hasn't expired. Measure lease age from server time: the `created_at` that
`issue_read get_comments` returns for the claim comment or its newest `AGENT-HEARTBEAT`, never a
timestamp written inside a comment body (the author's own clock). The MCP can't edit comments, so
every heartbeat is a fresh comment. One `claim_id` may appear on several issues (a batch), but
liveness is always judged per issue, in that issue's own comment stream: an `AGENT-RELEASE` on one
member releases that member only. Taking over is different: a `Batch:` line in a dead claim
obligates the whole batch (§0.7).

## Modes

- **`/next`**: the full flow.
- **`/next 123 [124 …]`**: skip ranking (§0.3–0.4) but still claim and verify (§0.5–0.6) each named
  issue, since it may already be held. Several numbers claim as one batch under the same caps and
  coherence test; if the set doesn't honestly batch, say so and ask rather than silently splitting
  it or shipping an incoherent PR. `triage` issues are never claimable in any mode (except the
  record-keeping claim above), and §0.2 condition 5 applies here too: a human naming a `[human]`
  item doesn't make it agent-doable. If you lose the race on a named issue, report who holds it and
  don't fall back to ranking; the human picked issues, not a category. Losing one member of a named
  batch doesn't abandon the rest: proceed with what you won (subject to §0.5's coherence escape)
  and report the loss.
- **`ultracode`** anywhere in the arguments: the Workflow opt-in (see Invariants).
- **`/next --plan-only N`**: rank and emit N ready-to-paste `/next <number>` prompts, then stop.
  Write nothing to the tracker (no claims, no sweep, no advisory comments); each claim happens when
  its session starts. Carry each issue's Agent brief into its prompt: prefix `ultracode ` when the
  brief says `ultracode:yes` (either spelling opts in), and append a one-line note when it names a
  `model:` so the launcher picks the right model. Group issues that pass the batching test into one
  prompt (`/next 123 124`) at plan time, so the session layer and in-run batching don't fight over
  them.

**Inside a Workflow, the orchestrator claims and subagents don't.** A parallel fan-out starts N
agents in the same second, the worst input for a claim race. Run Phase 0 in the orchestrator,
sequentially, once per unit, then hand each subagent one issue number or one pre-composed batch.
After the fan-out, reconcile every issue you claimed, even when the workflow fails, because a
subagent that errored, timed out, or returned nothing looks exactly like one that died, and its claim
leaks:

- `in-review` with a PR: leave it.
- `in-progress` with a branch: post `AGENT-HANDOFF` on its behalf.
- `in-progress` with nothing: `AGENT-RELEASE` `session-ending`, remove the label (back to Backlog).

## Phase 0 — select and claim

Nothing here is delegated, and housekeeping (§0.7) waits until you hold a claim: every second
between reading the backlog and writing the claim is race window.

**0.1 — Generate `CLAIM_ID`.** One `openssl rand -hex 4`, reused all run.

**0.2 — Build the candidate set.** `list_issues(owner:"pdcarlson", repo:"Frapp", state:OPEN)`,
requesting the `title`, `labels`, `updated_at`, and `body` fields and paging as needed. Condition 5
reads the title; if it's missing, that condition silently passes everything. An issue is a candidate
when all hold:

1. No state label (`triage`, `in-progress`, `in-review`) and no `routine-state` label. `triage`
   items need promotion and a priority first (who may promote them:
   [`GITHUB_PM.md` → Ownership boundary](../../docs/internal/ci-cd/GITHUB_PM.md#ownership-boundary-organize-broadly-destroy-narrowly));
   `in-review` means a PR is waiting on a human; `routine-state` issues are routine infrastructure,
   never work.
2. No live claim comment (`issue_read get_comments`; skip the read for issues not updated within
   `LEASE`).
3. No open blocker surviving §1.1 — a `Blocked by #N` body line whose #N is still open.
4. No linked PR in any state other than closed-unmerged (`search_pull_requests` for the issue
   number; a PR counts only when it names the issue number). An open PR means the work is in flight:
   note the drift, suggest `in-review`, skip. A merged PR on a still-open issue means it already
   shipped: report it, change nothing. A closed, unmerged PR doesn't disqualify: claim it and record
   `Prior art: PR #NNN (closed, unmerged)` in the claim comment.
5. No human-action hold: no `[human]` tag anywhere in the title's leading run of `[...]` tags,
   matched case-insensitively (`[pr-followup][human] …` is held), and no body opening
   `**Human action required — hold in triage`. No agent session can do these. The forms are defined
   in [`GITHUB_PM.md` → Labels and priority](../../docs/internal/ci-cd/GITHUB_PM.md#labels-and-priority-lean-taxonomy).

Epics are candidates like anything else. The hazard is closing one early, which Phase 4 guards, so
don't add an epic filter here. Surface each candidate's `Estimate:` line and Agent brief in the
shortlist as sizing context; neither is a filter.

**0.3 — Rank.** Reclaimable started work from §0.7 first, since finishing beats starting. Then by
priority label (`P1`→`P4`, no priority label last), tie-broken by lower issue number. Never skip an
issue for being unestimated, small, or large; prefer the most valuable viable work, including large,
high-impact issues. The order is deterministic so concurrent agents agree on it and the claim
resolves collisions. To keep sessions from colliding in lockstep, start at the candidate whose index
is the first hex digit of your `CLAIM_ID` modulo 3 (0, 1, or 2) and walk from there, wrapping to the
top.

**0.4 — Auto-pick.** Take the candidate your walk starts at and go. Then scan the remaining candidates for members that
batch with it under the invariant's test, within the caps, and compose the batch now. A batch is
fixed at claim time and only shrinks (lost races, per-member vetoes); it grows only through the
record-keeping claim. Don't ask which issue to work: the ranking is the answer. Ask only when the
ranking can't decide: no candidate clears §0.2 (report why; don't settle for a worse issue), or the
top two are genuinely tied and materially different in kind. Announce the pick, the batch if any,
and the runners-up without waiting for permission.

**0.5 — Claim it.** GitHub has no compare-and-swap (`issue_write` is last-write-wins), so the claim
is the comment, the only append-only, server-ordered record, and the `in-progress` label is a
projection of it. For each candidate in order:

1. `issue_read get_comments`; skip it if a live claim exists.
2. Post the claim comment (`add_issue_comment` with `AGENT-CLAIM`, or `AGENT-RECLAIM` for a §0.7
   takeover).
3. Then add the `in-progress` label (read-modify-write the full set).
4. Verify (§0.6). Lost: yield and take the next candidate.

Comment before label, always: if the session dies between the two writes, the issue keeps a live
claim that the §0.2 filter honours. Walk until you win or the list is exhausted (cap 8). If every
attempt lost to a live claim, report "backlog saturated with active agents"; if you ran out of
candidates, say that instead. They are different problems with different fixes.

A batch claims sequentially in global rank order: the §0.3 order every session agrees on, not your
staggered walk, which only chose the first member. Total-order acquisition keeps two batching
sessions from deadlocking over opposite ends of the same set. Post every member's claim before
implementing anything; both §0.6 verifies cover every member. A lost race yields that member only:
release it `lost-race` with labels untouched, shrink the batch, continue. Never abandon won members
over a lost one, and never top up a shrunk batch after implementation has begun. The one exception
(the coherence escape): if the lost member was the batch's point, an anchor whose dependents can't
ship alone, release the survivors too, each per its Exits row, and continue with whatever still
stands alone. Never rebuild a lost member's content in your own branch; its winner is building it.

**0.6 — Verify, twice.** Once right after the label write, and again right before the first repo
mutation in Phase 2; the second costs one read and is all that stands between you and a replica-lag
collision. Wait at least 15s after posting the claim before the first verify, so you aren't reading
your own stale view. Both times, rebuild the live-claim set from `issue_read get_comments`, and
re-apply the `in-progress` label once if something clobbered it (twice means contested: yield).
Then:

| Situation | Action |
| --- | --- |
| Yours is the only live claim | **Proceed** |
| Another live claim is strictly earlier by server `created_at` | **Yield** |
| Another live claim is strictly later | **Proceed** — do not yield |
| Identical `created_at` | Lexicographically smallest `claim_id` wins |
| Identical `created_at` *and* `claim_id` | Both yield; re-run with a fresh id |

Yield only to a strictly earlier live claim; "yield whenever another claim exists" deadlocks, since
both agents see both comments and both back off. On a loss, post the `lost-race` release, leave the
labels alone (the winner wants `in-progress` on), skip that issue for this run, and return to §0.5
with the next candidate.

**0.7 — Sweep leaked claims (after your own claim is verified).** Over `in-progress` issues only;
`in-review` is never swept.

- Live claim: leave it alone.
- Expired lease, no linked PR in any state but closed-unmerged, and no branch pushed within `LEASE`
  (`git ls-remote --heads origin`; a push counts as a heartbeat): reclaimable. It enters §0.3 at the
  top and must still clear §0.2 conditions 3, 4, and 5, so a dead session's claim can't launder a
  `[human]` item past the hold. Take it with `AGENT-RECLAIM`, then wait a full read cycle and re-read
  before mutating anything.
- No claim comment at all, no linked PR, `updated_at` older than `ORPHAN_AGE`: post
  `AGENT-STALE-FLAG` and remove the `in-progress` label (back to Backlog). Don't pick it up this run.
- Batch reclaim is all-or-nothing. A claim carrying a `Batch:` line marks a shared branch. To take
  over any member, post `AGENT-RECLAIM` on every listed member (global rank order, one fresh claim
  id) before touching the branch. If any member's reclaim loses to a live claim, release the ones you
  took (`lost-race`) and walk away; two owners on one batch branch is the damage this prevents.

Never take over an issue with an open linked PR: two branches would diverge on one issue. At most 2
demotions per run, so a logic bug can't sweep the board; report the rest. Skip any issue whose newest
sentinel comment is an `AGENT-STALE-FLAG` (no `AGENT-CLAIM`/`AGENT-RECLAIM`/`AGENT-HEARTBEAT` newer
than the flag), so repeated runs don't stack flags.

## Phase 1 — verify the work is still real

Under a batch this phase runs per member, each with its own verdicts and verification comment. A
live blocker or a veto on one member excises that member and the rest continue. Never ask mid-batch:
blocking on AskUserQuestion while holding sibling claims starves them. Release a vetoed member
`out-of-scope` with the open question in the release comment, and carry the question to your
end-of-run report. §1.3's release-then-ask flow applies only when the veto covers the whole unit (a
solo run, or every member). If the excised member was the batch's point, release the others too,
each per its own Exits row.

**1.1 — Blocked-by verification.** `Blocked by #N` lines go stale: blockers merge and nobody edits the
body. Check each blocker (cap 6) against the repo and git history, not the tracker. Under ultracode
each check is a [`claim-verifier`](../agents/claim-verifier.md) on the claim "#N still blocks this
issue", returning `{blockerId, resolved, evidence, confidence}`; run them as a fan-out. Otherwise
run the same checks inline and stop at the first confirmed live blocker. A blocker is resolved only
on evidence (a REFUTED verdict); PLAUSIBLE is still blocked. Still blocked: release
`blocked-discovered`, remove `in-progress` (back to Backlog), take the next rank.

**1.2 — Spec-vs-code verification.** The most expensive autonomous failure is building something
already built, or building against a spec that no longer describes the code. Three checks, all
required. Under ultracode run them as a parallel fan-out and wait for all three before implementing;
otherwise run them inline:

1. **Already done?** A `claim-verifier` on "this issue's work is already done" →
   `{alreadyDone: none|partial|full, evidence, residual}`
2. **Spec drift.** A `claim-verifier` over the description's statements, returning each one no
   longer true → `{claim, reality, severity}`
3. **Surface area.** Files, patterns to follow, tests that must change, destructive? →
   `{files, patterns, tests, destructive}`. This is exploration, not verification; a general
   subagent or inline read.

Read AGENTS.md and the spec files the issue links. If the issue and the spec conflict, the spec wins.
Scale thoroughness by the brief's `depth` (the floor is always all three); `deep` also reads the
surrounding subsystem and runtime evidence, not just the named files. Post the result to the issue
with `add_issue_comment`; that comment is the plan.

If `alreadyDone: full`: post the evidence, close the issue as `completed` (`issue_write` state
closed, state_reason completed), release `superseded`, and report. Don't ask; it is one click to
undo. A duplicate closes as `duplicate` with `duplicate_of` the canonical issue.

**1.3 — Vetoes: the complete list of stop-and-ask points.** If one fires, release the claim first
(human deliberation is unbounded, and holding a claim through it starves siblings), then ask with
AskUserQuestion. Re-claiming after approval means running §0.5 and §0.6 in full with a fresh
`CLAIM_ID`: approval authorizes the work, not the claim, and the issue was free the whole time.

- **E1 — a one-way door on product intent.** Terminology that will propagate, public API/route
  naming, pricing/billing/legal copy, or something the user explicitly deferred to themselves. Test:
  if this is wrong, does fixing it after merge cost more than a follow-up PR? Ordinary visual and
  editorial choices are not E1: implement them consistent with existing screens and flag them in the
  PR.
- **E2 — destructive or irreversible.** Dropping or renaming columns/tables, data backfills, auth/RLS
  changes, deleting a public route or API, anything touching billing. An additive schema change (new
  nullable column, new table) is fine as a migration file committed to the PR; applying any
  migration directly to a hosted project is always E2.
- **E3 — the issue no longer describes reality:** a high-severity drift item, or
  `alreadyDone: partial`.
- **E4 — scope explosion:** surface area beyond ~8 files, or crossing a shared type, the auth layer,
  or the schema, when the issue read as small (estimate ≤2, or unestimated and small-sounding).
- **E5 — nothing viable.** Report why.

Everything else you decide yourself. Ask about intent, never about execution: anything recoverable by
reading the resulting PR (design, internal naming, which helper, how to test) is yours. All vetoes
fire before implementation begins; a run goes end to end or stops early, never interrupting
half-built work.

If an issue turns out to be two unrelated efforts, ship the coherent slice you can verify and file
self-contained follow-ups (`issue_write` create, labels `triage` + a priority + `area:<x>`) for the
rest.

## Phase 2 — implement

Run the second verify (§0.6) before the first file write.

Branch from `main` as `claude/<slug>`; in a harness-managed cloud session, the session's assigned
branch always wins. That branch is the **unit branch**. Make focused commits locally and don't
push yet: the pre-push gate owns the first push (Phase 3). Name the branch in a heartbeat on the first commit, because local work is
invisible to the reclaim rules and the comment stream is your only liveness beacon.

Write the code yourself, inline and sequentially. Parallel writers on one working tree collide
(same-file edits, duplicated helpers, one agent importing a symbol another just renamed) with no
cheap merge step. One narrow exception, requiring all three: §1.2 found ≥3 file groups with no
shared imports or symbols, each with its own tests, and the issue is genuinely large. Then, under
ultracode, fan the groups out with an explicit file allowlist per agent, each returning
`{group, filesTouched, testsAdded, neededOutsideAllowlist}`. A non-empty `neededOutsideAllowlist` is
the collision detector: you handle it, and agents never reach across. Every integrating edit (shared
types, exports, wiring) is yours. Codemod-shaped work passes this test; feature work usually doesn't.

Heartbeat into the tracker, not to the user; nobody is watching this session. Post a one-line
`AGENT-HEARTBEAT` (same `claim_id`) on every issue you hold at each checkpoint: verification done,
first commit, each meaningful commit, before and after any long-running command, PR opened, and
whenever you'd otherwise go quiet. Re-read each issue at each heartbeat. If someone closed it, or a
later `AGENT-RECLAIM` superseded you on your only member, stop and ask. Superseded on one member of a
batch: treat it as a lost race, excise it per §0.5's coherence escape, keep its commits out of what
you push (revert them, or name them in the release comment for the reclaimer), and continue.

Verify end to end: run the tests and the app.

## Phase 3 — review at push, the single gate

Run [`/diff-review`](../skills/diff-review/SKILL.md), always and unreduced. The pre-push hook
([`.githooks/pre-push`](../../.githooks/pre-push)), the only pre-PR review gate, refuses a push
until `.cache/diff-review/<PUSHED_COMMIT_SHA>` exists, and `/diff-review` writes it. Don't try
`/code-review`: a `/next` turn is a slash-command expansion, which its invocation scan skips, so it
is always refused here.

Address every finding: fix it, or file a self-contained `triage` follow-up with a reason. A
post-review commit changes HEAD and invalidates the marker, so re-run `/diff-review` after it; the
review always covers exactly what you push. Never push around the gate (`--no-verify`), and never
delete, revert, stash, or gitignore a file to make it pass. If the gate objects to a file, review the
file.

A batch of 2 or more runs `/diff-review` at `xhigh`: it concentrates several issues' surface under
one fixed findings cap, and batching must not dilute per-issue depth.

Under ultracode, layer a lens pass on top of `/diff-review`, never instead of it: no human reads the
diff before the PR, and a frozen diff is the safest thing here to parallelize. Launch five
[`diff-finder`](../agents/diff-finder.md) agents on the unit branch's diff, one per lens: correctness and edge cases; security (authz, injection, secrets, Supabase RLS);
acceptance-criteria conformance; repo conventions and simplification; test adequacy. Size each
lens's budget by the brief's `depth` (the floor is all five; `deep` or no brief earns the widest).
Then one `claim-verifier` per candidate. Fix CONFIRMED, drop REFUTED, and put PLAUSIBLE in the PR
body under *Flagged for review*; that valve is what lets a run finish instead of stopping to ask.

The *Flagged for review* block is a record, not an ask. Anything on it that needs Paul to act or
decide (a dashboard toggle, a credential, an unmet acceptance criterion you are shipping around) also
goes to him as a question, per [`file-follow-up`](../skills/file-follow-up/SKILL.md): AskUserQuestion
when it is a decision and you hold no sibling claims, your end-of-run report otherwise, or whenever
blocking on a prompt would stall the run. Still write the block; the PR Follow-ups routine harvests
it into the Human Action List. If Paul is present and the action is small, ask on the spot; file it
unless he clears it then and there.

## Phase 4 — ship and sync

If the unit changed a fact a doc asserts, update that doc in this same PR; the §1.2 drift items are
the minimum list, per member. Put files in their canonical home per
[`DOCUMENTATION_CONVENTIONS.md`](../../docs/internal/DOCUMENTATION_CONVENTIONS.md). Never drop a
stray file or append an unrelated note to make a change look documented; if the unit changed nothing
a doc describes, change no doc ([`DOCS_CI.md`](../../docs/internal/ci-cd/DOCS_CI.md)).

Push and open the PR with one `Fixes #N` line per member in the PR body. GitHub ignores closing
keywords in the title, and a prose mention doesn't close. The body covers what changed, why, which
acceptance criteria each member satisfies, the *Flagged for review* list, and any step you reduced
or skipped. Each member's §1.2 drift items get their own fix or an explicit note that none was
needed; nothing mechanical catches a batch that documents only one of its issues.

**Never `Fixes` a parent with open children.** Before writing each line, `issue_read get` the member.
When it reports `has_children: true` and any child is still open, write `Part of #N` instead and say
which slice this PR delivers: `Fixes #<parent>` would close the epic on merge with its remaining
slices unwritten, and a merge is irreversible in a way a claim never was. `Fixes` is correct again
when `sub_issues_summary` shows `completed >= total`, or when every open child is a member of this
PR. Gate on `has_children`: `sub_issues_summary` is returned only when children exist, so a
`total > completed` check on a missing summary fails open.

Move every member to In Review: swap `in-progress` for `in-review` (read-modify-write) and comment
the PR link on each, naming any step you reduced or skipped. Don't post `AGENT-RELEASE`; the open PR is the marker now. Babysit the PR to
merge-ready per [`AGENTS.md`](../../AGENTS.md) § Autonomous PR lifecycle. On merge, GitHub closes
each `Fixes`-named issue as `completed`; where it didn't, close it yourself (`issue_write` state
closed + `completed`) and remove any leftover `in-review` label. The issue's state is the status;
there are no manual board moves.

**After a merge, the run may loop.** When a PR merges, or the whole unit exits as `superseded` or
`blocked-discovered`, and your context is still healthy (roughly under two-thirds spent, no
compaction yet), return to Phase 0 with a fresh `CLAIM_ID`. Reset the branch whose PR just merged
(`git fetch origin main && git checkout -B <that branch> origin/main`; never `checkout -B` a branch
whose PR is still open) and claim the next unit. The loop never runs past a human: `user-aborted`,
`plan-rejected`, or any release that leaves a question with Paul ends the run. It is for ranked runs
only; a named-issue run (`/next 123`) ends when its unit ships, because the human picked the scope.
Otherwise end and leave the next unit to a fresh session; a degraded session claiming new work is
worse than an idle board.

**Pipelining: at most two open PRs, same context bar as the loop.** While a PR is open you may claim
the next unit on a fresh from-`main` branch named `<unit-branch>-p2`; this line is the standing grant
for the suffixed branch. Never branch B from A.

- Review the ref you push. The hook checks every exact pushed commit, including explicit refspecs
  and worktrees, so a marker for another branch can't authorize it. Keep the branch checked out so
  `/diff-review` scopes and records the intended HEAD.
- Commit WIP before every branch switch, so a babysit fix on PR A never pulls B's half-built work
  into review scope (`/diff-review` includes dirty-tree changes) or lands on the wrong branch.
- Migrations in both PRs: pick non-colliding version prefixes up front. Branch protection's
  `strict: true` re-runs the checks after the first merge, so expect an
  `update_pull_request_branch` and fresh CI on the surviving PR; the gate doesn't ask you to
  re-review `main`'s merge delta.
- The [`AGENTS.md`](../../AGENTS.md) babysit obligations read plural: subscribe per PR, read wake
  comments per PR, and evaluate stop conditions over the set.

## Exits

`/next` usually runs unattended, alongside other sessions. Keep working through everything that
doesn't need Paul: the claim, the plan comment, opening the PR, and each green check are not
stopping points. Put status notes in the same message as your next tool call. A summary announcing
the next step, an offer to continue, or a list of decisions you could make yourself is not a stop:
make the call, record it in the PR, and keep going. The valid stops are the rows below, the §1.3
vetoes, and Phase 2's closed-or-superseded check. When the run ends, your final message is the run
report: each PR link, each held issue's exit, anything reduced or skipped, and every open question
for Paul.

Act before you respond. Releasing an issue that has committed work is worse than leaving it claimed,
because the next agent restarts from zero on top of it: work exists → hand off, never release. Under
a batch every row applies per member; a release or handoff on one member never speaks for another,
and the run ends only when every still-held member has its exit action.

| Situation | Action |
| --- | --- |
| Turn ends, run continues | Heartbeat only (every held issue) — no release |
| Blocker confirmed live | `AGENT-RELEASE` `blocked-discovered`, remove `in-progress` (→ Backlog) |
| Veto fired, waiting on the user | `AGENT-RELEASE` (`out-of-scope`, or `plan-rejected`), remove `in-progress` |
| User changed the subject | `AGENT-RELEASE` `user-aborted`, remove `in-progress` |
| Issue underspecified | `AGENT-RELEASE` `blocked-discovered`, remove `in-progress` **and** add **`triage`** back (keep a priority label), with an explanation |
| Already shipped | Close as `completed`, `AGENT-RELEASE` `superseded` |
| Lost the race | `AGENT-RELEASE` `lost-race`, **labels untouched** — a batch shrinks and continues |
| Batch member vetoed / blocked | Release **that member** per its row above (a veto's question travels in the release comment + end-of-run report, never a mid-batch ask); the rest continues |
| Batch member superseded by a live `AGENT-RECLAIM` | Excise per §0.5's coherence rule — its commits stay out of your push; if the batch no longer coheres, release the rest per their rows |
| Context nearly exhausted, work exists | `AGENT-HANDOFF` `session-ending`, labels untouched, claim left live |
| GitHub MCP unavailable | Stop and report. No claim, no work, no fallback tracker |
| PR opened | Neither — **every member** → `in-review`, babysit to merge; the run may then loop or pipeline per Phase 4 |
| Session ending, PR open **and** pipelined unit claimed | PR'd members stay `in-review`; each unshipped member exits per its own row (work exists → handoff) |

`Reason` is a closed set: `plan-rejected` · `user-aborted` · `lost-race` · `blocked-discovered` ·
`out-of-scope` · `superseded` · `session-ending`.

## Comment templates

Post literally, substituting bracketed values; the sentinel is always the first line.

**AGENT-CLAIM** — posted *before* the label change.

```text
🤖 AGENT-CLAIM `claim:a3f19c2e`

**Claimed by:** `/next` session `a3f19c2e` (acting as Paul Carlson; Claude Code)
**Branch:** `claude/fix-signup-redirect` (local until review passes)
**Batch:** solo — or: #100 · #101 · #102 (one claim comment per member, same claim id; this lease renews on this issue's own comment stream)
**Prior art:** none
**Heartbeat:** 2026-08-03T14:22:07Z — lease 4h, renewed by AGENT-HEARTBEAT comments

_Other agents: taken while this lease is live. If it has expired AND there is no linked
PR AND no branch pushed within the lease, post an AGENT-RECLAIM before starting._
```

**AGENT-HEARTBEAT** — the lease renewal; the newest one with this claim id is the lease clock.

```text
🤖 AGENT-HEARTBEAT `claim:a3f19c2e` — still working #100. Branch `claude/fix-signup-redirect` @ `9f2a1c0`.
```

**AGENT-RELEASE** — `Labels:` reads `NOT CHANGED — claim <id> holds it` for `lost-race`.

```text
🤖 AGENT-RELEASE `claim:a3f19c2e`

**Reason:** plan-rejected
**Labels:** `in-progress` removed — back to Backlog
**Work left behind:** none — no commits, no branch, no PR
**Batch:** releasing #100 only; #101 · #102 remain claimed under `a3f19c2e` — omit when solo

#100 is free. Any agent may claim it.
```

**AGENT-RECLAIM** — a reclaim is a claim, and §0.6 applies to it identically.

```text
🤖 AGENT-RECLAIM `claim:c1d90a55`

**Reclaiming from:** claim `a3f19c2e`, last heartbeat 2026-06-11T09:14Z — or: no AGENT-CLAIM found
**Evidence:** lease expired; no linked PR; no branch pushed; no activity since 2026-06-11
**Batch:** taking the whole batch #100 · #101 · #102 per §0.7 (this comment posted on every member) — omit when solo
**Continuing from:** nothing on disk — starting fresh — or: branch `claude/<slug>` @ `9f2a1c0`

Taking this over. If the original agent is alive, post AGENT-RELEASE — this claim supersedes.
```

**AGENT-HANDOFF** — work exists and the session is ending.

```text
🤖 AGENT-HANDOFF `claim:a3f19c2e`

**Reason:** session-ending (context exhausted mid-implementation)
**Labels:** `in-progress` kept — claim left LIVE intentionally
**Branch:** `claude/fix-signup-redirect` @ `9f2a1c0` (pushed / local only)
**Batch:** #100 · #101 — both handed off; this comment posted on each — omit when solo
**Done:** schema migration + API route   **Remaining:** client wiring, tests
**Takeover:** allowed — post AGENT-RECLAIM per §0.7's all-or-nothing batch rule (every member, before touching the branch) and continue here. Do NOT restart from scratch.
```

**AGENT-STALE-FLAG** — the §0.7 demotion. Keep the closing line as written; it tells the owner
nothing but labels changed.

```text
🤖 AGENT-STALE-FLAG

**`in-progress`** since 2026-06-11 with no agent claim, no linked PR, and no activity for 53
days. Under the /next claim protocol that is an abandoned claim, so I am removing the label and
returning it to the **Backlog** to be picked up normally.

If you are actively working this, re-add the label and post an AGENT-CLAIM (or just say so here).

_Swept by /next. Only labels changed — no code, branches, or PRs were touched._
```
