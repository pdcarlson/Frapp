---
description: Claim the next viable unit of tracker work — one GitHub issue, or a small coherent batch — as In Progress before touching it, complete it, and keep the tracker in sync — safe to run in several sessions at once
argument-hint: "[123 ...] [--plan-only N]"
---

Work tracking lives in **GitHub Issues** on `pdcarlson/Frapp` (issue numbers like `#123`), reached
via the **GitHub MCP** — the canonical hub. New issues are created with the `triage` label; PRs
close work with `Fixes #N` (native close-on-merge, one line per issue). Policy lives in
[`GITHUB_PM.md`](../../docs/internal/ci-cd/GITHUB_PM.md); this file is procedure. Where they
disagree, the doc wins and this file is the bug.

Claim one **unit** of work — usually a single issue, sometimes a small coherent batch — complete it,
and leave the tracker cleaner than you found it. **Several sessions run this at once** — the claim
protocol in Phase 0 is what keeps them off each other's work, so it comes before anything expensive.

## Invariants

**Claim before you think.** The old flow verified first and marked In Progress later; that window is
exactly how two agents end up building the same issue. Selection and claim now happen first, and
verification runs against work you already own. Claiming is two reversible calls — churn is cheap and
honest; overlap is not.

**Do not start in plan mode.** Phase 0 writes to the tracker and plan mode forbids writes. If a plan
is demanded before work begins, the Phase 1.2 verification comment posted to the issue *is* the
plan — it lands where a sibling agent or Paul will actually see it. Plan mode belongs only on a §1.3
veto, where a human is genuinely about to be asked something.

**GitHub Issues is canonical and has no fallback.** If any `mcp__github__*` tracker call fails,
**stop and say so**. Do not proceed unclaimed, do not substitute Linear (retired) or a scratch
file, do not defer the writes. No claim means no work. The MCP is the only sanctioned tracker
path — shell access to `api.github.com` is session-dependent; never fall back to `gh`/REST. Load
schemas first, e.g.
`ToolSearch("select:mcp__github__list_issues,mcp__github__issue_read,mcp__github__issue_write,
mcp__github__add_issue_comment,mcp__github__search_issues,mcp__github__search_pull_requests")`.

**Ownership is per run, not per turn.** From `AGENT-CLAIM` until the PR is open, you own exactly the
issues you claimed — every one of them. Ending a *turn* mid-run needs only a heartbeat. Ending the
*run* — you will not resume this work in this session — requires an `AGENT-RELEASE` or
`AGENT-HANDOFF` **per still-held issue** as your last action before responding. The Exits table is
the complete list of run-ending situations; if yours is not there, the run is not ending. An issue
left silently In Progress is a bug you introduced, and a batch gives you N chances to introduce it.

**One coherent unit per invocation — usually one issue, sometimes a small batch.** The unit of
shipping never changes: **one branch, one coherent, revertible PR.** What may vary is how many issues
that PR closes. Batch only when every member independently clears §0.2 and the set reads as *one
change* — same root cause, same subsystem, or mechanical kin a reviewer would want in one diff.
Caps — they bound **elective** batching: `MAX_BATCH` members, combined estimate ≤ 8; any single
issue estimated ≥ 5 (or reading that large) runs solo. An inseparable parent+sub-issue unit ("add
column" + "use column") is claimed whole regardless of member count — it was never elective — but
its combined estimate still counts: past 8 that is an E4 conversation, not a silent claim. An
unestimated member may join only when it is honestly small: count it as **2** toward the ceiling,
batch at most one unestimated member, and if you cannot size it, it runs solo. Estimates (the
optional `Estimate: <fibonacci>` body line) gate *batching*, never candidacy. Batching is for
coherence, not throughput: if the PR body would need an unrelated section per issue, those are
separate runs — that parallelism belongs at the session layer. The old test still applies per
member — *would this be a shippable, revertible PR by itself?* — it just no longer forces "separate
sessions" when the pieces are small and belong together.

**Nothing discovered is dropped.** Any defect, drift, or missing coverage you notice mid-run has
exactly two exits: **fix it now** — when it sits within or adjacent to the surface you are already
touching, doesn't change the PR's revert story, **and would not itself trip a §1.3 veto** (an
E2-class change — destructive DDL, auth/RLS, billing — is never a drive-by; file it) — or **file
it** (`issue_write` create → labels `triage` + a priority + one `area:<x>`, with `file:line`
evidence and an Agent brief when you can write one). A drive-by fix small enough to review as part
of the diff needs no issue — note it in the PR body. A fixed defect that warrants its own record
(user-visible behavior, security, anything someone would later search the tracker for) gets filed
**and claimed into the batch** — same `CLAIM_ID`, claim comment and all. A record-keeping claim
records work already done, so it sits **outside** `MAX_BATCH` and the estimate ceiling, which cap
*planned scope at composition time* — on a solo run it simply makes the PR a two-issue PR. Filing a
second one is a signal the unit was mis-scoped: finish, and say so in the PR. That record-keeping
claim on an issue you *just self-filed* is the sole exception to "triage is never claimable", which
otherwise governs auto-starting inbox work. Everything else is filed and left for the board.
Silence is the only failure mode.

**Ultracode changes how thoroughly a step is done — never which steps happen, and never what gets
written to the tracker.** Each fan-out below is specified as independent checks with named outputs:
with the **Workflow** tool, run them as a fan-out; without it, run them inline in the same order. A
plain `/next` must still work end to end. Never make a decision depend on a subagent's return shape.

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
[`GITHUB_PM.md` → Agent briefs](../../docs/internal/ci-cd/GITHUB_PM.md#agent-briefs-depth--model--ultracode)).
`depth` sets how hard to dig, never which steps run: every phase below still happens and
`/diff-review` is never reduced. `deep` — **or an absent brief or `depth:` field, which means
deep** — warrants the widest verification and review fan-out you can run; `standard` is the ordinary path; `skim` means
the floors of each step suffice (the issue is mechanical — don't inflate it). `model:` and
`ultracode:` are spin-up hints for whoever launches sessions, not runtime switches — a running
session never changes model; `--plan-only` carries them into its emitted prompts.

**Never report a step you did not run.** If you reduced scope or skipped a check, say so in both the
issue comment and your reply. Never claim a test, migration, or app run you didn't actually execute.

**Assignees and label state tell you nothing about live work.** Migrated issues carry stale
assignees, and an `in-progress` label can outlive a dead session. The only evidence of live work is
a **live claim comment**, a branch named in one, or a linked PR (`search_pull_requests` for the
issue number / `Fixes #N`).

**Label writes replace the whole set.** `issue_write`'s `labels` field overwrites the issue's
labels. Every label change below means: read the current labels (`issue_read get_labels`), apply
the delta, write back the full union. Never send only the label you're adding.

## Constants

| Name | Value |
| --- | --- |
| `CLAIM_ID` | 8 hex chars (`openssl rand -hex 4`), generated **once** per run, reused in every comment you post |
| `MAX_BATCH` | **3 elective members** per claimed unit, combined estimate **≤ 8**; any single issue ≥ 5 runs solo. Inseparable parent+sub-issue units are exempt from the member cap (not the ceiling); record-keeping claims sit outside both |
| `LEASE` | **4 hours**, renewed by every heartbeat |
| `ORPHAN_AGE` | **72 hours** — an `in-progress` issue with *no* claim comment, no linked PR and no activity this long is abandoned |
| Sentinels | `AGENT-CLAIM` `AGENT-RECLAIM` `AGENT-HEARTBEAT` `AGENT-RELEASE` `AGENT-HANDOFF` `AGENT-STALE-FLAG` — always the comment's first line |

A claim is **live** when its `claim_id` has no later `AGENT-RELEASE` carrying the same id **and**
its lease has not expired. Lease age is measured from server time — the `created_at` that
`issue_read get_comments` returns for the claim comment or its newest `AGENT-HEARTBEAT` — never
from a timestamp written inside a comment body, which is the author's own clock. (The GitHub MCP
cannot edit comments, so heartbeats are always fresh `AGENT-HEARTBEAT` comments; the newest one
with your `claim_id` is the lease clock.) One `claim_id` may appear on several issues at once (a
batch); liveness is always judged **per issue, in that issue's own comment stream** — an
`AGENT-RELEASE` posted on one member releases that member only, and sweepers never need to look
past the issue they are inspecting **to judge liveness**. *Taking over* is different: a `Batch:`
line in a dead claim obligates the whole batch (§0.7's all-or-nothing rule).

## Modes

**`/next`** — the full flow.

**`/next 123 [124 …]`** — skip ranking (§0.3–0.4); still claim and verify (§0.5–0.6) per named
issue, since a named issue may already be held. Several numbers claim as one batch — the caps and
the coherence test still apply, and if the named set doesn't honestly batch, say so in your reply and
ask rather than silently splitting or silently shipping an incoherent PR. Backlog issues are
claimable as usual; **`triage`-labeled issues never are, in any mode** (sole exception: the
record-keeping claim in "Nothing discovered is dropped"). If you lose the race on a named issue,
**report who holds it** — do not fall back to ranking, because the human picked the issues, not a
category. Losing one member of a named batch does not abandon the rest: proceed with what you won —
subject to §0.5's coherence escape when the lost member was the batch's point — and report the loss.

**`/next --plan-only N`** — rank and emit N ready-to-paste `/next <number>` prompts, then stop.
**Write nothing to the tracker** — no claims, no sweep, no advisory comments. This is how you spin
up a batch of sessions without leaking N claims: each claim happens when its session actually
starts. Carry each issue's Agent brief into its emitted prompt: prefix the prompt with `ultracode `
when the brief says `ultracode:yes` (the pasted turn then starts with `ultracode`, not `/`, so the
harness scan fires and supplies the session-level reminder the opt-in paragraph above accepts — the
prefix and argument spellings are equivalent opt-ins, not competitors), and append a one-line note
when it names a `model:` so the launcher picks the right session model. An emitted prompt may name
a batch (`/next 123 124`) when the ranked issues batch under the invariant's test — group at plan
time, so the session layer and in-run batching don't fight over the same related issues.

**Inside a Workflow, the orchestrator claims and subagents do not.** A `parallel()` fan-out starts N
agents in the same second — the worst possible input for a claim race. Run Phase 0 in the
orchestrator, sequentially, once per issue; then hand each subagent one issue number or one
pre-composed batch — the batch decision is the orchestrator's, made at claim time, never a
subagent's. A deterministic
partition beats optimistic claiming whenever a coordinator exists. **After the fan-out, reconcile
every issue you claimed** — a subagent that errored, timed out, or returned nothing is
indistinguishable from one that died, and its claim leaks exactly like FRA-38 did in the Linear
era. `in-review` with a PR → leave it; `in-progress` with a branch → post `AGENT-HANDOFF` on its
behalf; `in-progress` with nothing → `AGENT-RELEASE` `session-ending` and back to Backlog (remove
the label). Reconcile even when the workflow fails.

## Phase 0 — select and claim

Nothing here is delegated: a subagent re-fetches the same list and widens the window this protocol
exists to close. Every second between reading the backlog and writing the claim is race window, so
housekeeping (§0.7) waits until after you hold the claim.

**0.1 — Generate `CLAIM_ID`.** One `openssl rand -hex 4`, reused all run.

**0.2 — Build the candidate set.** `list_issues(owner:"pdcarlson", repo:"frapp", state:OPEN)` —
request the `labels` field and page as needed. An issue is a candidate when **all** hold:

1. It carries **no state label** (`triage`, `in-progress`, `in-review` all disqualify — `triage`
   needs a human-accepted promotion and a priority first; `in-review` means a PR is already
   waiting on a human) and **no `routine-state` label** (routine infrastructure — e.g. the
   "PR Follow-ups — Human Action List" tracking issue — is never work to claim).
2. No live claim comment (`issue_read get_comments`; skip the read for issues untouched since
   before `LEASE`).
3. No open blocker surviving §1.1 — a `Blocked by #N` body line whose #N is still open.
4. No linked PR in any state other than closed-unmerged (`search_pull_requests` for the issue
   number). An **open** PR means the work is already in flight — note the drift, suggest
   `in-review`, skip. A **merged** PR on a still-open issue is already shipped — report it, change
   nothing. A **closed, unmerged** PR does not disqualify: claim it and record
   `Prior art: PR #NNN (closed, unmerged)` in the claim comment. Treat a PR as authoritative only
   when it names the issue number.

Read the body with `issue_read get` where the list is thin. Surface each candidate's **`Estimate:`**
line and its **Agent brief** line (`depth:` / `model:` / `ultracode:`, when present) as sizing
context in the shortlist — neither is a filter.

**0.3 — Rank.** Reclaimable started work from §0.7 first — finishing beats starting. Then by
**priority label** (`P1`→`P2`→`P3`→`P4`; **no priority label last**), tie-broken by **lower issue
number**. Estimates are sizing context and never a filter: never skip an issue for being
unestimated, small, or large, and **don't shy away from larger, high-impact issues** — prefer the
most valuable viable work. The ordering is deterministic so concurrent agents agree on it and the
claim resolves the collision. To keep five sessions from colliding in lockstep, **start at the
candidate whose index is the first hex digit of your `CLAIM_ID` modulo 3** (so 0, 1, or 2) and walk
from there, wrapping to the top.

**0.4 — Auto-pick.** Take rank 1 and go. **Batch extension:** having picked rank 1, scan the
remaining candidates for members that batch with it under the invariant's test — same root cause,
same subsystem, mechanical kin — respecting the caps. Compose the batch **now**, before claiming: a
batch is fixed at claim time and only ever shrinks (lost races, per-member vetoes); it never grows
mid-run except through the record-keeping claim in "Nothing discovered is dropped". Do **not** ask
which issue to work — that is the babysitting this command exists to remove, and the ranking is
already the answer. Ask only when the ranking cannot decide: no candidate clears §0.2 (report why —
do not settle for a worse issue), or the top two are genuinely tied and materially different in
kind. Announce the pick — and the batch, if any — and the runners-up; you are not asking permission.

**0.5 — Claim it.** GitHub has **no compare-and-swap** — `issue_write` is last-write-wins and cannot
be a lock. The comment stream is the only append-only, server-ordered structure available, so **the
claim is the comment; the `in-progress` label is a projection of it.** For each candidate in rank
order:

1. `issue_read get_comments` — skip if a live claim exists.
2. **Post the claim comment first** (`add_issue_comment` with `AGENT-CLAIM`, or `AGENT-RECLAIM`
   for a §0.7 takeover).
3. Then add the **`in-progress`** label (read-modify-write the full label set).
4. **VERIFY (§0.6).** Lost → yield and take the next candidate.

Comment before label, always: if the session dies between the two writes, the issue keeps a live
claim and the §0.2 filter still honours it. Walk until you win or the list is exhausted (cap 8). If
every attempt lost to a *live* claim, report **"backlog saturated with active agents"**; if you
simply ran out of candidates, say that instead — different problems, different fixes.

A batch claims **sequentially in global rank order** — the deterministic §0.3 order every session
agrees on, not your staggered walk, which applies only to where the *first* member came from.
Total-order acquisition is what keeps two batching sessions from deadlocking over opposite ends of
the same set. Post **all** of the batch's claims before starting any implementation; both §0.6
verifies then cover **every** member. A lost race on one member yields that member only — release
`lost-race`, labels untouched, shrink the batch, continue. Never abandon won members over a lost
one, and never "top up" a shrunk batch with a fresh candidate after implementation has begun. One
exception to shrink-and-continue: if the **lost member was the batch's point** — an anchor whose
dependents cannot ship alone — the survivors no longer cohere; release them too, each per its own
Exits row, and continue with whatever still stands alone. Never rebuild a lost member's content in
your own branch: its race winner is building it concurrently, and that is the double-build this
protocol exists to prevent.

**0.6 — Verify, twice.** Once immediately after the label write, and again immediately before the
**first repo mutation** in Phase 2 — the second costs one read and is all that stands between you and
a replica-lag collision. Wait ≥15s after posting the claim before the first verify, so you are not
reading your own stale view. Both times, rebuild the live-claim set from `issue_read get_comments`,
and re-apply the `in-progress` label once if something clobbered it (twice means contested — yield).
Then:

| Situation | Action |
| --- | --- |
| Yours is the only live claim | **Proceed** |
| Another live claim is strictly earlier by server `created_at` | **Yield** |
| Another live claim is strictly later | **Proceed** — do not yield |
| Identical `created_at` | Lexicographically smallest `claim_id` wins |
| Identical `created_at` *and* `claim_id` | Both yield; re-run with a fresh id |

Yield only to a **strictly earlier** live claim. "Yield whenever another claim exists" deadlocks —
both agents see both comments and both back off. On a loss: post the lost-race release, **leave the
labels alone** (the winner wants `in-progress` on — reverting it is the most commonly botched step
here), skip that issue for this run, and start over at §0.5 with the next candidate.

**0.7 — Sweep leaked claims (after your own claim is verified).** Housekeeping for the next agent, so
it never runs ahead of your claim. Over **`in-progress`** only — **`in-review` is never swept**:

- **Live claim** → leave it alone.
- **Expired lease, no linked PR in any state but closed-unmerged, and no branch pushed within `LEASE`**
  (`git ls-remote --heads origin` — a push counts as a heartbeat) → reclaimable. It enters §0.3 at the
  top of the ranking and must still clear §0.2's blocker and PR criteria. Taking it needs an
  `AGENT-RECLAIM`; then wait a full read cycle *and re-read* before mutating anything.
- **No claim comment at all, no linked PR, `updated_at` older than `ORPHAN_AGE`** → post
  `AGENT-STALE-FLAG` and remove the `in-progress` label (back to Backlog). Do **not** pick it up
  this run.
- **Batch reclaim is all-or-nothing.** A claim comment carrying a `Batch:` line marks a shared
  branch. To take over any member, post `AGENT-RECLAIM` on **every** listed member — global rank
  order, one fresh claim id — before touching the branch; if any member's reclaim loses to a live
  claim, release the ones you took (`lost-race`) and walk away. Two owners on one batch branch is
  the exact damage this rule prevents.

Never take over an issue with an open linked PR: two branches diverging on one issue is the exact
damage this prevents. **At most 2 demotions per run** — a logic bug must not sweep the board; report
the rest. Skip any issue whose newest sentinel comment is an `AGENT-STALE-FLAG` — i.e. no
`AGENT-CLAIM`/`AGENT-RECLAIM`/`AGENT-HEARTBEAT` is newer than the flag (the comment stream is the
observable record; there is no label-change timeline to read) — so ten runs don't post ten flags.

## Phase 1 — verify the work is still real

Under a batch, this phase runs **per member**: each issue gets its own §1.1/§1.2 verdicts and its
own verification comment. A live blocker fires per member — **excise that member** (release it per
the Exits table) and continue with the rest. A **veto** on one member is handled differently from
§1.3's solo flow: never block on AskUserQuestion while holding sibling claims — that starvation is
exactly what §1.3's release-first design exists to avoid. Excise the vetoed member (release
`out-of-scope`, writing the open question into the release comment), **carry the question to your
end-of-run report**, and continue the rest. §1.3's release-then-ask flow applies when the veto
covers the whole unit — a solo run, or every member — in which case release everything first, then
ask. And in every case: if the excised member was the batch's point, release the others too, each
per its own row.

**1.1 — Blocked-by verification.** `Blocked by #N` lines go stale: blockers get merged and nobody
edits the body. Answer *"is this actually still blocked?"* against the repo and git history, not
against the tracker — one check per blocker (cap 6), each returning `{blockerId, resolved,
evidence, confidence}`. Fan out with `pipeline` under Ultracode; inline otherwise, stopping at the
first confirmed live blocker. Still blocked → release `blocked-discovered`, remove `in-progress`
(back to Backlog), take the next rank.

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
files. Post the result to the issue with `add_issue_comment` — that comment is the plan.

If **`alreadyDone: full`**: post the evidence, close the issue as **`completed`** (`issue_write`
state closed, state_reason completed), release `superseded`, and report. Don't ask; it is one click
to undo. Duplicates: close as **`duplicate`** with `duplicate_of` the canonical.

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
**file self-contained follow-ups** (`issue_write` create, labels `triage` + a priority + `area:<x>`)
for the rest.

## Phase 2 — implement

**Run the second verify (§0.6) now**, before the first file write.

Branch from `main` as `claude/<slug>` — in a harness-managed cloud session, the session's assigned
branch. Either way, that branch is this file's **unit branch**. Focused commits. **Commit locally; do not push yet** — the
pre-push gate owns the first push (Phase 3). Record the branch name in a heartbeat comment on the
first commit: local work is invisible to the reclaim rules, and the claim comment stream, not a
remote branch, is your liveness beacon.

Write the code yourself, inline and sequential. Parallel writers on one working tree collide — same-file
edits, duplicated helpers, one agent importing a symbol another just renamed — with no cheap merge
step. **One narrow exception**, requiring all three: §1.2 found ≥3 file groups with no shared imports
or symbols, each with its own tests, and the issue is genuinely large. Then `pipeline` the groups with
an explicit **file allowlist per agent**, each returning `{group, filesTouched, testsAdded,
neededOutsideAllowlist}`. A non-empty `neededOutsideAllowlist` is the collision detector — you handle
it; agents never reach across. Every integrating edit (shared types, exports, wiring) is yours.
Codemod-shaped work passes this test; feature work usually does not.

**Heartbeat into the tracker, not to the user** — under session fan-out nobody is watching this
session. Post an **`AGENT-HEARTBEAT`** comment (same `claim_id`) on **every issue you hold** — one
per batch member — at each checkpoint: verification done, first commit, each meaningful commit,
before and after any long-running command, PR opened, and any time you would otherwise go quiet.
(The GitHub MCP cannot edit comments, so each heartbeat is a fresh comment; the newest one is the
lease clock. Keep them terse — one line — so the thread stays readable.) Heartbeating all members
keeps every issue's own comment stream authoritative — sweepers and §0.2 readers never have to
follow a pointer to some "primary" member. **Re-read each issue at each heartbeat**: if someone
closed it, or a later `AGENT-RECLAIM` superseded you on your only member, stop and ask. Superseded
on **one member of a batch** → treat it as a lost race: excise the member per §0.5's coherence
rule, keep its commits out of what you push (revert them, or name them in the release comment for
the reclaimer), and continue the rest.

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

Address every finding: fix it, or file a self-contained `triage` follow-up with a reason.
**Committing fixes changes HEAD, which invalidates the marker and re-gates the push — so re-run
`/diff-review` after any post-review commit.** The review always covers exactly what you push. Never
push around the gate, and **never delete, revert, stash, or gitignore a file to make it pass** — if
the gate objects to a file, review the file.

Autonomy removes the human's eyes from the diff, so under Ultracode this gets **more** budget, not
less — and a frozen diff has zero write contention, making it the safest thing here to parallelize.
Size each lens's budget by the brief's `depth` as well — the floor is always all five lenses;
`deep` (or no brief) earns the widest budget per lens. A batch concentrates several issues' surface
under one review with a fixed findings cap, so **any batch of ≥ 2 runs `/diff-review` at `xhigh`** —
per-issue depth must not be silently diluted by batching.
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

Push and open the PR with **`Fixes #N`** in the PR **body** — the literal magic word, not a prose
mention, and the body specifically: **GitHub ignores closing keywords in the PR title** — **one
line per batch member**. GitHub's close-on-merge handles multiple `Fixes` lines natively; each
named issue closes as `completed` when the PR merges. Body: what changed, why, which
acceptance criteria **each member** satisfies, and the *Flagged for review* list. Doc-sync is per
member too: the gate is PR-level and binary, so nothing mechanical catches a batch that documents
only one of its issues — each member's §1.2 drift items get their docs touch.

Move **every member** to **In Review**: swap its `in-progress` label for **`in-review`**
(read-modify-write) and `add_issue_comment` the PR link on each. Do **not** post an
`AGENT-RELEASE` — the open PR is the marker now, and the claim comments stay as the record of who
did the work. **Babysit the PR to merge-ready per [`AGENTS.md`](../../AGENTS.md) § Autonomous PR
lifecycle**: arm and re-arm the `send_later` self-wake, triage each red check infra-vs-code before
pushing a "fix" (the `CI wake` comment says which — re-run infra, patch code), address and resolve
review threads. On merge, GitHub closes each `Fixes`-named issue as `completed`; for any member
where it didn't fire, `issue_write` state closed + `completed` yourself. Remove a closed member's
`in-review` label if GitHub left it (labels survive closing — harmless, but tidy). Solo project:
the issue's state is the status — no manual board moves.

**After the merge, the run may loop.** `/next` ships one coherent unit per PR — not one per
session. When a PR merges — or the whole unit exits as `superseded` or `blocked-discovered`,
releases that answer *this unit can't ship* — and your context is still healthy (roughly: under
two-thirds spent, no compaction yet), you may return to Phase 0 with a **fresh `CLAIM_ID`**: restart
**the branch whose PR just merged** from `origin/main` (`git fetch origin main && git checkout -B
<that branch> origin/main`) — never `checkout -B` a branch whose PR is still open — and claim the
next unit. The loop never runs past a human: `user-aborted`, `plan-rejected`, or any release that
leaves a question with Paul ends the run. And it is for **ranked** runs only: a named-issue run
(`/next 123`) ends when its named unit ships — the human picked the scope; don't self-extend it
into ranking. Otherwise end and let a fresh session take it — a degraded session claiming new work
is worse than an idle board.

**Pipelining — at most two open PRs, same context bar as the loop.** Babysit wall-time is idle
time; while a PR is open — and only while under the loop's context-health bar — you may claim the
next unit on a **fresh from-`main` branch** named `<unit-branch>-p2` (never branch B from A — the
branch model is from-`main` only, and this line is the standing grant for the suffixed branch,
approved with this doctrine's PR). Each hard rule below closes a verified hazard, not a
hypothetical:

- **Check out the branch you push.** The pre-push gate resolves the *checked-out* HEAD, not the
  pushed ref — pushing a non-checked-out ref either slips an unreviewed diff through or burns the
  gate's livelock budget toward an UNREVIEWED release. No worktrees for the same reason: the marker
  and the check would key on different roots.
- **Commit WIP before every branch switch**, so a babysit fix on PR A never pulls B's half-built
  work into review scope (`/diff-review` includes dirty-tree changes) or lands on the wrong branch.
  Each `/diff-review` covers exactly one branch's HEAD.
- **Migrations in both PRs → pick non-colliding version prefixes up front.** Branch protection's
  `strict: true` re-runs the collision check after the first merge; expect an
  `update_pull_request_branch` + fresh-CI cycle on the surviving PR, and don't try to re-review
  `main`'s own merge delta — the gate doesn't ask for it.
- The [`AGENTS.md`](../../AGENTS.md) babysit obligations read **plural**: one re-armed self-wake
  whose check covers *all* open PRs, a `subscribe_pr_activity` per PR, stop conditions evaluated
  over the set.

## Exits

Act **before** you respond. Releasing an issue that has committed work is worse than leaving it
claimed, because the next agent restarts from zero on top of it: work exists → hand off, never
release. Under a batch, every row applies **per member** — a release or handoff on one member never
speaks for another, and a run ends only when every still-held member has its exit action.

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

**Claimed by:** Claude Code `/next` session `a3f19c2e` (acting as Paul Carlson)
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

**AGENT-RECLAIM** — a reclaim *is* a claim: §0.6 applies to it identically.

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

**AGENT-STALE-FLAG** — the §0.7 demotion. Keep the closing line verbatim; it is load-bearing for trust.

```text
🤖 AGENT-STALE-FLAG

**`in-progress`** since 2026-06-11 with no agent claim, no linked PR, and no activity for 53
days. Under the /next claim protocol that is an abandoned claim, so I am removing the label and
returning it to the **Backlog** to be picked up normally.

If you are actively working this, re-add the label and post an AGENT-CLAIM (or just say so here).

_Swept by /next. Only labels changed — no code, branches, or PRs were touched._
```

If blocked on a decision that's mine, stop and ask with AskUserQuestion.
