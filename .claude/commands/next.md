---
description: Claim the next viable Linear issue as In Progress before touching it, complete it, and keep Linear in sync — safe to run in several sessions at once
argument-hint: "[FRA-123] [--plan-only N]"
---

Work tracking lives in **Linear** (team **Frapp Live**, prefix **FRA-**), reached via the **native
Linear MCP** — the canonical hub. New issues are created in Linear; PRs close work with `Fixes FRA-N`
(and `Closes #N` for an issue that has a GitHub twin — closure syncs GitHub→Linear). Policy lives in
[`LINEAR_PM.md`](../../docs/internal/ci-cd/LINEAR_PM.md); this file is procedure. Where they disagree,
the doc wins and this file is the bug.

Claim one issue, complete it, and leave the tracker cleaner than you found it. **Several sessions run
this at once** — the claim protocol in Phase 0 is what keeps them off each other's work, so it comes
before anything expensive.

## Invariants

**Claim before you think.** The old flow verified first and marked In Progress later; that window is
exactly how two agents end up building the same issue. Selection and claim now happen first, and
verification runs against work you already own. Claiming is two reversible calls — churn is cheap and
honest; overlap is not.

**Do not start in plan mode.** Phase 0 writes to Linear and plan mode forbids writes. If a plan is
demanded before work begins, the Phase 1.2 verification comment posted to the issue *is* the plan —
it lands where a sibling agent or Paul will actually see it. Plan mode belongs only on a §1.3 veto,
where a human is genuinely about to be asked something.

**Linear is canonical and has no fallback.** If any `mcp__Linear__*` call fails, **stop and say so**.
Do not proceed unclaimed, do not substitute GitHub issues or a scratch file, do not defer the writes.
No claim means no work. Load schemas first, e.g. `ToolSearch("select:mcp__Linear__list_issues,
mcp__Linear__get_issue,mcp__Linear__list_comments,mcp__Linear__save_issue,mcp__Linear__save_comment")`.

**Ownership is per run, not per turn.** From `AGENT-CLAIM` until the PR is open, you own exactly one
issue. Ending a *turn* mid-run needs only a heartbeat. Ending the *run* — you will not resume this
issue in this session — requires an `AGENT-RELEASE` or `AGENT-HANDOFF` as your last action before
responding. The Exits table is the complete list of run-ending situations; if yours is not there, the
run is not ending. An issue left silently In Progress is a bug you introduced.

**One issue per invocation.** The unit is one branch and one independently revertible PR. Never claim
a batch — parallelism belongs at the session layer, which is what this protocol is for. Sole
exception: sub-issues that cannot ship alone ("add column" + "use column", where the first is dead
code). Test: *would each be a shippable, revertible PR by itself?* Yes → separate sessions. No → claim
the parent and those sub-issues as one unit, one branch, one PR.

**Ultracode changes how thoroughly a step is done — never which steps happen, and never what gets
written to Linear.** Each fan-out below is specified as independent checks with named outputs: with
the **Workflow** tool, run them as a fan-out; without it, run them inline in the same order. A plain
`/next` must still work end to end. Never make a decision depend on a subagent's return shape.

**`ultracode` in this command's arguments IS the Workflow opt-in.** The harness `ultracode` scan
runs only on the human-typed, pre-expansion prompt and skips any input starting with `/` (read out
of the 2.1.220 build like the Phase 3 `/code-review` rule — re-verify on newer builds), so on a
slash-command turn (`/next ultracode`) no system-reminder will ever confirm ultracode. Do not read
the missing reminder as "not opted in" and quietly downgrade to plain Agent calls. When the
arguments carry `ultracode`, or a session-level ultracode reminder is present, run the specified
fan-outs — §1.1, §1.2, Phase 3, and Phase 2's narrow exception when it qualifies — with the
**Workflow** tool on this file's authority. Workflow launches auto-approve (`.claude/settings.json`
allows the tool and pre-accepts the usage warning). If a launch prompts or is refused anyway (older
build, ignored setting), that is tool unavailability, not an opt-out: run that fan-out inline per
the invariant above — never sit waiting on an approval. Cost stays bounded because the fan-out
points are enumerated and capped; everything not named as a fan-out stays inline in every mode.

**Honor the issue's Agent brief.** The description may carry an `### Agent brief` section —
`` `depth:<skim|standard|deep>` · `model:<fable|any>` · `ultracode:<yes|no>` `` (policy:
[`LINEAR_PM.md` → Agent briefs](../../docs/internal/ci-cd/LINEAR_PM.md#agent-briefs-depth--model--ultracode)).
`depth` sets how hard to dig, never which steps run: every phase below still happens and
`/diff-review` is never reduced. `deep` — **or an absent brief or `depth:` field, which means
deep** — warrants the widest verification and review fan-out you can run; `standard` is the ordinary path; `skim` means
the floors of each step suffice (the issue is mechanical — don't inflate it). `model:` and
`ultracode:` are spin-up hints for whoever launches sessions, not runtime switches — a running
session never changes model; `--plan-only` carries them into its emitted prompts.

**Never report a step you did not run.** If you reduced scope or skipped a check, say so in both the
Linear comment and your reply. Never claim a test, migration, or app run you didn't actually execute.

**The assignee tells you nothing.** Every issue is assigned to Paul Carlson, including every issue an
agent is actively working. `gitBranchName` tells you nothing either — Linear auto-suggests it on every
issue whether or not a branch exists. The only evidence of live work is a live claim comment, a branch
named in one, or a linked PR.

## Constants

| Name | Value |
| --- | --- |
| `CLAIM_ID` | 8 hex chars (`openssl rand -hex 4`), generated **once** per run, reused in every comment you post |
| `LEASE` | **4 hours**, renewed by every heartbeat |
| `ORPHAN_AGE` | **72 hours** — an In Progress issue with *no* claim comment, no linked PR and no activity this long is abandoned |
| Sentinels | `AGENT-CLAIM` `AGENT-RECLAIM` `AGENT-HEARTBEAT` `AGENT-RELEASE` `AGENT-HANDOFF` `AGENT-STALE-FLAG` — always the comment's first line |

A claim is **live** when its `claim_id` has no later `AGENT-RELEASE` carrying the same id **and** its
lease has not expired. Lease age is measured from server time — the `createdAt`/`updatedAt` that
`list_comments` returns for the claim comment or its newest `AGENT-HEARTBEAT` — never from a
timestamp written inside a comment body, which is the author's own clock.

## Modes

**`/next`** — the full flow.

**`/next FRA-123`** — skip ranking (§0.3–0.4); still claim and verify (§0.5–0.6), since a named issue
may already be held. Backlog *and* Todo are claimable as usual; **Triage never is, in any mode**. If
you lose the race, **stop and report who holds it** — do not fall back to ranking, because the human
picked this issue, not a category.

**`/next --plan-only N`** — rank and emit N ready-to-paste `/next FRA-xxx` prompts, then stop. **Write
nothing to Linear** — no claims, no sweep, no advisory comments. This is how you spin up a batch of
sessions without leaking N claims: each claim happens when its session actually starts. Carry each
issue's Agent brief into its emitted prompt: prefix the prompt with `ultracode ` when the brief says
`ultracode:yes` (the pasted turn then starts with `ultracode`, not `/`, so the harness scan fires
and supplies the session-level reminder the opt-in paragraph above accepts — the prefix and
argument spellings are equivalent opt-ins, not competitors), and append a one-line note when it
names a `model:` so the launcher picks the right session model.

**Inside a Workflow, the orchestrator claims and subagents do not.** A `parallel()` fan-out starts N
agents in the same second — the worst possible input for a claim race. Run Phase 0 in the
orchestrator, sequentially, once per issue; then hand each subagent one issue key. A deterministic
partition beats optimistic claiming whenever a coordinator exists. **After the fan-out, reconcile
every issue you claimed** — a subagent that errored, timed out, or returned nothing is
indistinguishable from one that died, and its claim leaks exactly like FRA-38 did. In Review with a
PR → leave it; In Progress with a branch → post `AGENT-HANDOFF` on its behalf; In Progress with
nothing → `AGENT-RELEASE` `session-ending` and back to Backlog. Reconcile even when the workflow fails.

## Phase 0 — select and claim

Nothing here is delegated: a subagent re-fetches the same list and widens the window this protocol
exists to close. Every second between reading the backlog and writing the claim is race window, so
housekeeping (§0.7) waits until after you hold the claim.

**0.1 — Generate `CLAIM_ID`.** One `openssl rand -hex 4`, reused all run.

**0.2 — Build the candidate set.** `list_issues(team:"Frapp Live", state:"Backlog")`, and `"Todo"` if
populated. An issue is a candidate when **all** hold:

1. State is **Backlog** or **Todo**. Never **Triage** — those need a human accept and an explicit
   Priority before they are startable. Never a started, completed or canceled state; **In Review**
   means a PR is already waiting on a human.
2. No live claim comment (`list_comments`; skip the read for issues untouched since before `LEASE`).
3. No open blocked-by relation surviving §1.1.
4. No linked PR in any state other than closed-unmerged. An **open** PR means the work is already in
   flight — note the state/PR drift, suggest In Review, skip. A **merged** PR on a non-Done issue is
   already shipped — report it, change nothing. A **closed, unmerged** PR does not disqualify: claim
   it and record `Prior art: PR #NNN (closed, unmerged)` in the claim comment. Treat a PR as
   authoritative only when it is linked to the issue *and* names the issue key.

Read relations and links with `get_issue` where the list is thin. Surface each candidate's **estimate**
(Fibonacci) and its **Agent brief** line (`depth:` / `model:` / `ultracode:`, when present) as sizing
context in the shortlist — neither is a filter.

**0.3 — Rank.** Reclaimable started work from §0.7 first — finishing beats starting. Then by
**Priority** (Urgent→High→Med→Low; **None last**), tie-broken by **lower FRA- number**. Estimates are
sizing context and never a filter: never skip an issue for being unestimated, small, or large, and
**don't shy away from larger, high-impact issues** — prefer the most valuable viable work. The
ordering is deterministic so concurrent agents agree on it and the claim resolves the collision. To
keep five sessions from colliding in lockstep, **start at the candidate whose index is the first hex
digit of your `CLAIM_ID` modulo 3** (so 0, 1, or 2) and walk from there, wrapping to the top.

**0.4 — Auto-pick.** Take rank 1 and go. Do **not** ask which issue to work — that is the babysitting
this command exists to remove, and the ranking is already the answer. Ask only when the ranking cannot
decide: no candidate clears §0.2 (report why — do not settle for a worse issue), or the top two are
genuinely tied and materially different in kind. Announce the pick and the runners-up; you are not
asking permission.

**0.5 — Claim it.** Linear has **no compare-and-swap** — `save_issue` is last-write-wins and cannot be
a lock. The comment stream is the only append-only, server-ordered structure available, so **the claim
is the comment; the workflow state is a projection of it.** For each candidate in rank order:

1. `list_comments` — skip if a live claim exists.
2. **Post the claim comment first** (`AGENT-CLAIM`, or `AGENT-RECLAIM` for a §0.7 takeover).
3. Then `save_issue(id:"FRA-N", state:"In Progress")`, assigning it to me if unassigned.
4. **VERIFY (§0.6).** Lost → yield and take the next candidate.

Comment before state, always: if the session dies between the two writes, the issue keeps a live claim
and the §0.2 filter still honours it. Walk until you win or the list is exhausted (cap 8). If every
attempt lost to a *live* claim, report **"backlog saturated with active agents"**; if you simply ran
out of candidates, say that instead — different problems, different fixes.

**0.6 — Verify, twice.** Once immediately after the state write, and again immediately before the
**first repo mutation** in Phase 2 — the second costs one read and is all that stands between you and
a replica-lag collision. Wait ≥15s after posting the claim before the first verify, so you are not
reading your own stale view. Both times, rebuild the live-claim set from `list_comments`, and re-apply
In Progress once if something clobbered it (twice means contested — yield). Then:

| Situation | Action |
| --- | --- |
| Yours is the only live claim | **Proceed** |
| Another live claim is strictly earlier by server `createdAt` | **Yield** |
| Another live claim is strictly later | **Proceed** — do not yield |
| Identical `createdAt` | Lexicographically smallest `claim_id` wins |
| Identical `createdAt` *and* `claim_id` | Both yield; re-run with a fresh id |

Yield only to a **strictly earlier** live claim. "Yield whenever another claim exists" deadlocks —
both agents see both comments and both back off. On a loss: post the lost-race release, **leave the
workflow state alone** (the winner wants it In Progress — reverting it is the most commonly botched
step here), skip that issue for this run, and start over at §0.5 with the next candidate.

**0.7 — Sweep leaked claims (after your own claim is verified).** Housekeeping for the next agent, so
it never runs ahead of your claim. Over **In Progress** only — **In Review is never swept**:

- **Live claim** → leave it alone.
- **Expired lease, no linked PR in any state but closed-unmerged, and no branch pushed within `LEASE`**
  (`git ls-remote --heads origin` — a push counts as a heartbeat) → reclaimable. It enters §0.3 at the
  top of the ranking and must still clear §0.2's blocker and PR criteria. Taking it needs an
  `AGENT-RECLAIM`; then wait a full read cycle *and re-read* before mutating anything.
- **No claim comment at all, no linked PR, `updatedAt` older than `ORPHAN_AGE`** → post
  `AGENT-STALE-FLAG` and move it to **Backlog**. Do **not** pick it up this run.

Never take over an issue with an open linked PR: two branches diverging on one issue is the exact
damage this prevents. **At most 2 demotions per run** — a logic bug must not sweep the board; report
the rest. Skip any issue already carrying an `AGENT-STALE-FLAG` newer than its last state change, so
ten runs don't post ten flags.

## Phase 1 — verify the work is still real

**1.1 — Blocked-by verification.** Linear's relations go stale: blockers get merged and nobody flips
the relation. Answer *"is this actually still blocked?"* against the repo and git history, not against
Linear — one check per blocker (cap 6), each returning `{blockerId, resolved, evidence, confidence}`.
Fan out with `pipeline` under Ultracode; inline otherwise, stopping at the first confirmed live
blocker. Still blocked → release `blocked-discovered`, state back to **Backlog**, take the next rank.

**1.2 — Spec-vs-code verification.** The most expensive autonomous failure is building something
already built, or building against a spec that no longer describes the codebase. Three checks, none
optional, `parallel` under Ultracode (a barrier is right — you cannot implement on partial verdicts):

1. **Already done?** → `{alreadyDone: none|partial|full, evidence, residual}`
2. **Spec drift** — every statement in the description no longer true → `{claim, reality, severity}`
3. **Surface area** — files, patterns to follow, tests that must change, destructive? → `{files,
   patterns, tests, destructive}`

Read AGENTS.md and the real spec files the issue links to. **If the issue and the spec conflict, the
spec wins.** Scale the three checks' thoroughness by the brief's `depth` (the floor is always all
three): `deep` means also reading the surrounding subsystem and runtime evidence, not just the named
files. Post the result to the issue with `save_comment` — that comment is the plan.

If **`alreadyDone: full`**: post the evidence, set the issue **Done** (and if it has a GitHub twin,
close that twin on GitHub so the integration syncs the closure — Linear→GitHub close-sync is less
reliable than the reverse), release `superseded`, and report. Don't ask; it is one click to undo.
Duplicates: `save_issue` state→**Canceled** with `duplicateOf` the canonical.

**1.3 — Vetoes: the complete list of stop-and-ask points.** If one fires, **release the claim first** —
human deliberation is unbounded and holding a claim through it starves siblings — then ask with
AskUserQuestion. **Re-claiming after approval means running §0.5 and §0.6 in full with a fresh
`CLAIM_ID`**: approval authorizes the work, not the claim, and the issue was free the whole time.

- **E1 — a one-way door on product intent.** Terminology that will propagate, public API/route naming,
  pricing/billing/legal copy, or something the user explicitly deferred to themselves. Test: *if this
  is wrong, does fixing it after merge cost more than a follow-up PR?* Ordinary visual and editorial
  choices are **not** E1 — implement them consistent with existing screens and flag them in the PR.
- **E2 — destructive or irreversible.** Dropping or renaming columns/tables, data backfills, auth/RLS
  changes, deleting a public route or API, anything touching billing. Additive schema change (new
  nullable column, new table) is fine **as a migration file committed to the PR**; applying any
  migration directly to a hosted project is always E2.
- **E3 — the issue no longer describes reality:** a high-severity drift item, or `alreadyDone: partial`.
- **E4 — scope explosion:** surface area beyond ~8 files, or crossing a shared type, the auth layer, or
  the schema, when the issue read as small (estimate ≤2, or unestimated and small-sounding).
- **E5 — nothing viable.** Report why.

Everything else you decide yourself. The line is **ask about intent, never about execution**: anything
recoverable by reading the resulting PR — design, internal naming, which helper, how to test — is
yours. All vetoes fire **before implementation begins**; a run goes end to end or stops early, never a
mid-flight interrupt on half-built work.

If an issue turns out to be genuinely two unrelated efforts, ship the coherent slice you can verify and
**file self-contained follow-ups into Triage** (`save_issue` state Triage **with a Priority** — Linear
requires one to leave Triage) for the rest.

## Phase 2 — implement

**Run the second verify (§0.6) now**, before the first file write.

Branch from `main` as `claude/<slug>`. Focused commits. **Commit locally; do not push yet** — the
pre-push gate owns the first push (Phase 3). Record the branch name in your claim comment on the first
commit: local work is invisible to the reclaim rules, and the claim comment, not a remote branch, is
your liveness beacon.

Write the code yourself, inline and sequential. Parallel writers on one working tree collide — same-file
edits, duplicated helpers, one agent importing a symbol another just renamed — with no cheap merge
step. **One narrow exception**, requiring all three: §1.2 found ≥3 file groups with no shared imports
or symbols, each with its own tests, and the issue is genuinely large. Then `pipeline` the groups with
an explicit **file allowlist per agent**, each returning `{group, filesTouched, testsAdded,
neededOutsideAllowlist}`. A non-empty `neededOutsideAllowlist` is the collision detector — you handle
it; agents never reach across. Every integrating edit (shared types, exports, wiring) is yours.
Codemod-shaped work passes this test; feature work usually does not.

**Heartbeat into Linear, not to the user** — under session fan-out nobody is watching this session.
Edit your claim comment (`save_comment` with its `id`) to bump `Heartbeat:` at each checkpoint:
verification done, first commit, each meaningful commit, before and after any long-running command, PR
opened, and any time you would otherwise go quiet. One claim comment per issue per session — edit it,
never spam new ones; if editing fails, post `AGENT-HEARTBEAT` with the same `claim_id`. **Re-read the
issue at each heartbeat**: if someone moved it to Done or Canceled, or a later `AGENT-RECLAIM`
superseded you, stop and ask.

Verify end-to-end — run the tests and the app. Never claim a step you didn't run.

## Phase 3 — review at push, the single gate

**Run [`/diff-review`](../skills/diff-review/SKILL.md). Always, unreduced.** The pre-push review-gate
hook ([`.claude/hooks/pre-push-review-gate.sh`](../hooks/pre-push-review-gate.sh)) blocks a push until
`.cache/diff-review/<HEAD_SHA>` exists, and `/diff-review` is what writes it. **Do not bother trying
`/code-review`:** its model invocation is waived only when the turn's prompt carries `/code-review`
whitespace-delimited on both sides, and a `/next` turn is a slash-command expansion, which the scan
skips — so it is refused 100% of the time here, even if you typed the token as an argument to `/next`.
It also does not write the marker. There is no separate CI review and no duplicate step — this hook is
the only pre-PR review gate.

Address every finding: fix it, or file a self-contained Triage follow-up with a reason. **Committing
fixes changes HEAD, which invalidates the marker and re-gates the push — so re-run `/diff-review`
after any post-review commit.** The review always covers exactly what you push. Never push around the
gate, and **never delete, revert, stash, or gitignore a file to make it pass** — if the gate objects
to a file, review the file.

Autonomy removes the human's eyes from the diff, so under Ultracode this gets **more** budget, not
less — and a frozen diff has zero write contention, making it the safest thing here to parallelize.
Size each lens's budget by the brief's `depth` as well — the floor is always all five lenses;
`deep` (or no brief) earns the widest budget per lens.
Layer an **additional** fan-out *on top of* `/diff-review` (never instead of it): five lenses in
`parallel` — correctness and edge cases; security (authz, injection, secrets, Supabase RLS);
acceptance-criteria conformance; repo conventions and simplification; test adequacy — each returning
`{file, line, severity, claim, suggestedFix}`. Then one skeptic per finding, tasked with *disproving*
it by reading the actual code → `{verdict: CONFIRMED|REFUTED|NEEDS_HUMAN, evidence}`. Fix
**CONFIRMED**; put **NEEDS_HUMAN** in the PR body under *Flagged for review* — that valve is what lets
a run finish instead of stopping to ask. Its sub-agents inherit the session model.

## Phase 4 — ship and sync

Update the related real spec/docs **in this same PR** — doc-sync requires it, and the §1.2 drift items
are the minimum list. Put files in their canonical home per
[`DOCUMENTATION_CONVENTIONS.md`](../../docs/internal/DOCUMENTATION_CONVENTIONS.md); **never drop a
stray file to satisfy the gate.**

Push and open the PR with **`Fixes FRA-N`** in the title or body — the literal magic word, not a prose
mention (add `Closes #<github>` if the issue has a GitHub twin). Body: what changed, why, which
acceptance criteria it satisfies, and the *Flagged for review* list.

Move the issue to **In Review** and `save_comment` the PR link with a two-line summary. Do **not** post
an `AGENT-RELEASE` — the open PR is the marker now, and the claim comment stays as the record of who
did the work. **Babysit the PR to merge-ready per [`AGENTS.md`](../../AGENTS.md) § Autonomous PR lifecycle**: arm
and re-arm the `send_later` self-wake, triage each red check infra-vs-code before pushing a "fix"
(the `CI wake` comment says which — re-run infra, patch code), address and resolve review threads. On
merge, Linear auto-transitions FRA-N to **Done**; if it didn't fire, `save_issue(id:"FRA-N",
state:"Done")`. Solo project: the issue's state is the status — no manual board moves.

Then stop. `/next` ships one issue and ends — do not start another.

## Exits

Act **before** you respond. Releasing an issue that has committed work is worse than leaving it
claimed, because the next agent restarts from zero on top of it: work exists → hand off, never release.

| Situation | Action |
| --- | --- |
| Turn ends, run continues | Heartbeat only — no release |
| Blocker confirmed live | `AGENT-RELEASE` `blocked-discovered`, state → Backlog |
| Veto fired, waiting on the user | `AGENT-RELEASE` (`out-of-scope`, or `plan-rejected`), state → Backlog |
| User changed the subject | `AGENT-RELEASE` `user-aborted`, state → Backlog |
| Issue underspecified | `AGENT-RELEASE` `blocked-discovered`, state → **Triage** (set a Priority), with an explanation |
| Already shipped | State → Done, `AGENT-RELEASE` `superseded` |
| Lost the race | `AGENT-RELEASE` `lost-race`, **state untouched** |
| Context nearly exhausted, work exists | `AGENT-HANDOFF` `session-ending`, state untouched, claim left live |
| Linear MCP unavailable | Stop and report. No claim, no work, no fallback tracker |
| PR opened | Neither — state → In Review, babysit to merge |

`Reason` is a closed set: `plan-rejected` · `user-aborted` · `lost-race` · `blocked-discovered` ·
`out-of-scope` · `superseded` · `session-ending`.

## Comment templates

Post literally, substituting bracketed values; the sentinel is always the first line.

**AGENT-CLAIM** — posted *before* the state change.

```text
🤖 AGENT-CLAIM `claim:a3f19c2e`

**Claimed by:** Claude Code `/next` session `a3f19c2e` (acting as Paul Carlson)
**Branch:** `claude/fix-signup-redirect` (local until review passes)
**Prior art:** none
**Heartbeat:** 2026-08-03T14:22:07Z — lease 4h, renewed on every heartbeat

_Other agents: taken while this lease is live. If it has expired AND there is no linked
PR AND no branch pushed within the lease, post an AGENT-RECLAIM before starting._
```

**AGENT-HEARTBEAT** — only when editing the claim comment fails; otherwise edit it in place.

```text
🤖 AGENT-HEARTBEAT `claim:a3f19c2e`

Still working FRA-100 — lease renewed. Branch `claude/fix-signup-redirect` @ `9f2a1c0`.
```

**AGENT-RELEASE** — `State restored to:` reads `NOT CHANGED — claim <id> holds it` for `lost-race`.

```text
🤖 AGENT-RELEASE `claim:a3f19c2e`

**Reason:** plan-rejected
**State restored to:** Backlog
**Work left behind:** none — no commits, no branch, no PR

FRA-100 is free. Any agent may claim it.
```

**AGENT-RECLAIM** — a reclaim *is* a claim: §0.6 applies to it identically.

```text
🤖 AGENT-RECLAIM `claim:c1d90a55`

**Reclaiming from:** claim `a3f19c2e`, last heartbeat 2026-06-11T09:14Z — or: no AGENT-CLAIM found
**Evidence:** lease expired; no linked PR; no branch pushed; no activity since 2026-06-11
**Continuing from:** nothing on disk — starting fresh — or: branch `claude/<slug>` @ `9f2a1c0`

Taking this over. If the original agent is alive, post AGENT-RELEASE — this claim supersedes.
```

**AGENT-HANDOFF** — work exists and the session is ending.

```text
🤖 AGENT-HANDOFF `claim:a3f19c2e`

**Reason:** session-ending (context exhausted mid-implementation)
**State:** In Progress — claim left LIVE intentionally
**Branch:** `claude/fix-signup-redirect` @ `9f2a1c0` (pushed / local only)
**Done:** schema migration + API route   **Remaining:** client wiring, tests
**Takeover:** allowed — post AGENT-RECLAIM and continue on this branch. Do NOT restart from scratch.
```

**AGENT-STALE-FLAG** — the §0.7 demotion. Keep the closing line verbatim; it is load-bearing for trust.

```text
🤖 AGENT-STALE-FLAG

**In Progress** since 2026-06-11 with no agent claim, no linked PR, and no activity for 53
days. Under the /next claim protocol that is an abandoned claim, so I am returning it to
**Backlog** to be picked up normally.

If you are actively working this, move it back and post an AGENT-CLAIM (or just say so here).

_Swept by /next. Only the workflow state changed — no code, branches, or PRs were touched._
```

If blocked on a decision that's mine, stop and ask with AskUserQuestion.
