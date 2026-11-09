# PR babysitting: wake signals and CI-failure triage

Facts for wake signals, CI-failure triage, CI branch filters, the CI-wake watchdog, and base-branch sync. Router: [`agent-infra.md`](agent-infra.md). Cite this file and a heading, never `§N`.

Why the babysit loop needs more than `subscribe_pr_activity`, and what each layer covers. Root
cause on record: during the 2026-08-06 GitHub Actions outage, PR #659's `secret-scan` job died in
runner setup ("Failed to resolve action download info. Error: Service Unavailable" — the job's only
step was "Set up job"), six sibling jobs were cancelled without ever getting a runner, and the
watching session was never woken — the PR sat silent for ~2h until a human noticed.

## CI branch filters: never target a feature branch

`on.pull_request.branches` on `ci.yml`, `docs.yml`, and `links.yml` is `[main]`.
GitHub matches that list against the PR **base**, not the head. A PR whose base is another
feature branch therefore never runs CI, Docs checks, or Links. GitHub still allows a
squash-merge; the UI shows MERGED; the commits exist only on the base feature branch.
`origin/main` is unchanged. `pr-base-sync.yml` only sweeps PRs targeting `main`, and
`ci-wake.yml` never fires because CI never ran — the babysit loop is blind.

Incidents: #1120 and #1123–#1125 were squash-merged into stacked feature branches. GitHub
marked each MERGED; none reached `main`; CI never ran. Recovery is cherry-pick onto current
`origin/main` and a new PR whose base **is** `main` (the #1122 / #1127 / #1128 pattern).

**Playbook** (GitHub MCP down, opening area PRs, or any PR-opening path):

1. **Never open a PR whose base is not `main`.** Since #1340 `main` is the only long-lived
   branch, so it is also the only legal base — there is no promotion PR any more, and no
   sanctioned second base. Production is reached by dispatching **Deploy production** with
   a SHA, not by opening a PR.
2. **Never squash-merge into a feature branch** to "land" a stacked slice. GitHub's MERGED
   badge is not evidence the work is on `main`.
3. **If it already happened:** cherry-pick the slice onto current `origin/main` and open a
   new PR targeting `main`. Do not restack onto another feature branch. Confirm the new PR
   actually runs CI (required checks present, not all skipped or missing).

**The mechanism (2026-08-20): `pr-base-guard.yml`.** The playbook above is a rule agents
must remember, and #1124 and #1125 landed the same way #1120 and #1123 did *after* the
first two were noticed — so the rule alone demonstrably does not hold. The guard is a
single job on `on: pull_request` with **no** `branches:` filter, which is what lets it see
the PRs every other workflow is blind to. It passes on `main` and fails otherwise, with the
retarget instructions in the log.

Why this and not the alternatives:

- **Widening `ci.yml`'s filter to all branches** would make CI *run* on a stacked PR, but
  running CI was never the actual protection — GitHub would still show MERGED, and the
  commits would still not be on `main`. It also re-runs the full matrix (Docker build
  included) on every stacked push, for PRs that must not be merged at all. Wrong lever,
  real cost.
- **A scheduled sweep for "MERGED but not an ancestor of `main`"** detects the damage after
  it is done and needs its own alert-issue plumbing and a window to be wrong about. The
  guard refuses the PR before anyone can press the button.

Known limit, deliberately not papered over: a red check does not *block* a merge unless it
is a required check, and branch protection on `main` cannot make a check required on a PR
whose base is a feature branch. So the guard converts a **silent** failure into a **loud**
one — a PR that used to carry zero checks now carries one red X — but a determined merge
can still override it. Making `PR base guard / base-branch` required on `main` is a
branch-protection change and is tracked separately; it is not what closes this gap.

**There used to be a sibling check here, and it is worth knowing why it is gone.**
`ci.yml`'s `branch-policy` job guarded the *head* of a `production` PR
(`base_ref == 'production'` → head must be `main`), where `pr-base-guard` guards the *base*
of every PR. The two composed, and this section used to warn against merging them as
"duplicates". #1340 deleted `branch-policy` along with the branch it policed — not as a
tidy-up, but because the assertion moved: `scripts/ci/validate-deploy-sha.mjs` now runs
`git merge-base --is-ancestor <sha> origin/main` before any production deploy, which
enforces the same "only main-derived code reaches production" rule at the point where it
actually matters. `pr-base-guard` is unaffected and still the only workflow that sees a
feature-base PR.

Verifying the guard: it is pure shell over one payload field, so it is exercised by the
incident bases directly — `main` exits 0; `cursor/...` (the incidents' feature-branch bases), `main-ish`, `release/1.0`, and an
empty ref all exit 1 (fails closed on anything unrecognised). `production` now exits 1 too,
which is correct: since #1340 a PR targeting it is a mistake. It also passed on its own PR
(#1132, check run `base-branch`), which is the end-to-end proof that a no-`branches`
workflow does fire.

#962 is adjacent and **not** this bug:
GitHub honours `Fixes #N` only on merge into the **default** branch, so a stacked PR can
ship via its parent and still leave issues open. This section is the worse case — the work
never reaches `main` and CI never ran.

## Wake coverage

| Signal | Fires on | Misses |
| ------ | -------- | ------ |
| PR-activity webhook (`subscribe_pr_activity`) | CI **failure**, **successful check-suite rollups** (observed 2026-08-21 — see below), comments, reviews | cancelled, timed-out, merge-conflict — all silent |
| `CI wake` watchdog comment (`ci-wake.yml`) | exactly three things, and it is worth being precise because most of this list is *silent* on attempts 1-2: (a) a **deliberate** cancellation — a run cancelled after some job had started, or with the jobs/runs/annotations API down so it cannot be told from an infra one or a timeout; (b) a **job that ran to its `timeout-minutes`** (verdict `timed-out`, naming the job and its limit), which GitHub concludes `cancelled` and only the job's check-run annotation tells apart (#3162), never requeued because it is usually a hang a re-run meets again, even beside an infra failure that would otherwise be; (c) an **infra failure the auto-requeue did not absorb**, i.e. the re-queue call failed or the 3-attempt cap is spent. A run-level `timed_out`, `startup_failure`, `stale`, and a cancel where no job ever started all classify as infra-failure and are requeued first, so they say nothing until that runs out | outages that kill the watchdog run itself; a wake comment that fails to post (a `::warning::` on the run with GitHub's status and message); merge-conflict; review-state changes. **Deliberately silent:** success and real failures (the webhook carries both), any infra failure that WAS requeued (the fresh attempt's own completion is the wake), `skipped`/`neutral`/`action_required`, and superseded runs |
| `PR base sync` wake comment (`pr-base-sync.yml`) | `main` moving while this PR is conflicted with it, or behind it and un-updateable for a reason specific to this PR (a fork head, a one-off API error) — the comment says which and what to do | base moves while the sweep run itself dies; PRs past the sweep's 20-PR cap this round (logged; the sweep processes least-recently-updated first, so deferred PRs rotate to the front of a later sweep); unknown mergeability (skipped fail-safe, deliberately silent); an auto-merge PR held behind while another holds the update slot (deliberately silent, so its session doesn't merge `main` and restart the race; #3599); a wake comment that fails to post (a `::warning::` on the run with GitHub's status and message, and the run stays green; the next push to `main` retries it, #3019) |
| `PR base sync` alert issue | a missing or rejected app token — the one cause that is repo-wide rather than per-PR | anything per-PR (those comment); a sweep where nothing was behind, which proves nothing either way and deliberately leaves an open alert open |
| Retired — do not call `send_later` | — | Entire layer. Unusable unattended on the cloud surface (prompts the owner every call). Do not re-add it to `permissions.allow`. |

Layered conclusion: the webhook is the fast path for CI outcomes and human comments, the watchdog
comment covers the terminal states the webhook has no event for once a re-queue has stopped being an
option, and the base-sync comment is the fast path for base moves and merge conflicts. **Arm those
three; they never prompt.**

> **The success half of that webhook row was OBSERVED on 2026-08-21, on PR
> #1171 itself.** It began as a docs-verified claim
> about the Claude Code harness's `subscribe_pr_activity` contract, and it is load-bearing — the sole
> justification for `shouldComment: false` on the `success` verdict in `scripts/ci/ci-wake.mjs` — so
> it was written down with a confirmation trigger rather than asserted. The trigger fired on the
> first push:
>
> - The session watching #1171 received **four** `check_suite.completed` envelopes for head
>   `29b5a45`, each carrying `"conclusion":"success"` — one per workflow suite. Green CI does wake a
>   subscribed session.
> - Those arrived as their own events, distinct from the `issue_comment.created` envelopes carrying
>   the three `CI wake` comments on the same head, so the success delivery does **not** depend on
>   this watchdog's comments. That independence is the part that matters, because it is what survives
>   this change removing them.
>
> **The silent half was confirmed on the first push after the merge**, PR
> #1172, 2026-08-21. Three `CI wake` runs fired for
> that push — one per watched workflow — and all three completed `success` while the PR ended with
> **zero comments**. The watchdog did not fail to run; it ran and chose silence, in its own words
> (run 1934, Actions run `32506252734`):
>
> ```
> [ci-wake] CI #32505950228 attempt 1: success → success (All jobs green.)
> [ci-wake] no wake needed on #1172
> ```
>
> Same repo, hours apart, the comparison is clean: on #1171 the old build put a comment on the
> thread within ~10s of each of those same suites reporting green, three per push. The three
> comments still on #1171 are the last ones this watchdog will ever post for a green run.
>
> Rollback, should the webhook's success coverage ever regress: restore `shouldComment: true` for
> the `success` verdict in `classifyRun`. Keep the clear-stale path either way — it is what stops a
> red wake outliving the failure it described.

The webhook's success coverage is the reason the watchdog stopped commenting on green runs. Before
that, every push put three fresh comments on the PR (CI, Docs checks, Links) restating what the
checks UI and the webhook had both already said, and the delete-then-create cadence re-notified on
each one — so the wake that *was* worth reading arrived indistinguishable from two that were not.
A watchdog whose output gets skimmed is not a watchdog. Silence is now the signal that nothing
needs a human or an agent.

One consequence to keep in mind when reading a thread: a wake comment that is *gone* does not mean
nobody looked. Success and real failures both clear this workflow's wake, so an empty thread is the
normal state of a healthy PR — check the checks UI, not the comment history, for what CI did. The self-wake would be the only *complete*
net — it is the one layer that misses nothing — but it prompts the owner on every call, so on the
cloud surface it is not usable unattended and is deliberately not armed (below). The coverage it
would have added is a known, accepted gap, not an oversight.
`api.github.com` is readable from a sandbox over the direct route; which route to use, and why, is
under [`agent-infra.md` → The `api.github.com` route rule](agent-infra.md#the-apigithubcom-route-rule). That changes what is *readable*, not what is *polled*. An awake agent can read GitHub
directly for ground truth, but nothing in this sandbox runs while the session is asleep, so
background polling of GitHub still cannot be relied on and the coverage gap argument is unchanged.
Treat GitHub as reachable only while awake, through the MCP tools; direct REST only for the
settings reads the MCP has no tool for.

**Do not call `send_later` on the cloud surface, and do not try to fix it from the
repo.** Directly observed (2026-08-08): it **still prompted the owner** through every allow-list
spelling then present. Those 21 entries were later removed so they would stop being misread as
permission. The likely mechanism is the ceiling rule
([`agent-infra.md` → Applied permission allows](agent-infra.md#applied-permission-allows)) — the harness's `--allowed-tools` snapshot contains no
`mcp__Claude_Code_Remote__*` entry at all — but that rule is a working hypothesis, and the
practical conclusion does not depend on it: **more allow entries have already been tried and did
not work.** Do not re-add them.

Two earlier claims about this tool are corrected: on this surface the call does **not** dead-end in
`-32003`, and approval is **not** converted to a denial — the owner approved and the call succeeded,
returning a live trigger id. It simply *asks*, and asking is what disqualifies it from unattended
runs — not failing. Owner's standing preference (2026-08-08): don't call it. The other three layers
carried PR #743 unaided — three `CI wake` comments (CI, Docs checks, Links) plus the merge
notification, none of which prompted. Anything genuinely needing a schedule is a scheduled task
created with `create_trigger` and bound to a session, as the routines are ([`routines.md`](routines.md));
that call doesn't ask the owner each time the way `send_later` does. If a session does call it and it prompts, say so once, never
re-arm, and never ship a settings change to "fix" it — that would be the fourth attempt at a fix
that has already failed three times.

## What the watchdog does (`scripts/ci/ci-wake.mjs`)

- **Classifies** the completed run. *Infra failure*: every failed job died before its first
  repo-defined step (runner-phase steps only — the outage signature); a `cancelled` run counts
  only when **no job ever started a step** (never got a runner), so a deliberate human/agent
  cancellation of a running job is commented but never resurrected; a run-level `timed_out` /
  `startup_failure` / `stale` counts too. *Timed out*: a started job that was cancelled for
  running to its `timeout-minutes`. GitHub has no `timed_out` job conclusion, so the watchdog
  reads each started, cancelled job's check-run annotations for "The job has exceeded the
  maximum execution time of …" (hence `checks: read`). It is commented with the job and its
  limit and never requeued, including when it sits beside an infra failure that would otherwise
  be (a re-run re-runs the hung job too); an annotation it can't read falls back to the
  deliberate-cancel wake, or to an un-requeued one for that infra failure, saying a timeout
  can't be ruled out. *Code failure*: any job failed in a real step —
  classified, logged, and then deliberately **not** commented on, because `failure` is the one
  conclusion the PR-activity webhook has always delivered.
  *Superseded*: a newer run of the same workflow exists for the branch (repush; `ci.yml`'s
  `cancel-in-progress` cancels the old run on every push) — stays fully silent, no re-run, no
  comment. Classification **fails closed**: if the jobs or runs API errors mid-classification,
  the run is reported as unclassified and never called "infra", never requeued — an API blip
  must not relabel a real code failure as infrastructure.
- **Auto-requeues infra failures** via `rerun-failed-jobs` (falling back to plain `rerun` for
  cancelled-only runs), capped at **3 total attempts** per run id. The cap is mandatory: per
  GitHub's documented `workflow_run` semantics, a re-run creates a new attempt of the same run
  and fires `workflow_run: completed` again when it finishes, and GITHUB_TOKEN's recursion guard
  does **not** stop this loop (it only blocks *creating* new runs) — so an uncapped loop would
  retry to GitHub's 50-attempt ceiling. Prior art: vercel/next.js `retry_test.yml` uses exactly
  this trigger + `run_attempt` guard. These are docs-verified claims (2026-08-06), not yet
  observed in this repo — confirm on the first post-merge firing.
- **Upserts one wake comment per workflow** on the open PR — but only for a deliberate cancellation,
  a job timeout, or for an infra failure (from any of `failure` / `cancelled` / `timed_out` / `startup_failure` /
  `stale`) that the auto-requeue did **not** absorb. Note the `failure`-conclusion infra case is in
  that set: the webhook did fire, but only this watchdog knows the failure was the 2026-08-06
  "Failed to resolve action download info" shape and that the automatic retry is not coming. It deletes that workflow's previous marker comments
  (`<!-- frapp-ci-wake:<workflow name> -->`) and posts a fresh one, so a green `Links` wake can
  never erase a red `CI` wake. Open-state is checked via the pulls API (a merged/closed PR gets no
  wake), and the head-owner comes from the run's head repo so fork PRs resolve. Delete-then-create,
  never edit-in-place — comment edits deliver webhook `action=edited`, which created-only listeners
  (the agent wake path) never see.
- **Clears its own wake on every other informative verdict.** Success, a code failure, an
  unclassified failure and a requeued infra failure all delete this workflow's marker comment
  without posting anything. This half is load-bearing and easy to lose: while success always
  commented, the fresh success comment is what *overwrote* the previous red one. Take the comment
  away without taking the delete with it and a "cancelled" wake sits on a PR that has been green
  for a week. `ignored` conclusions (`skipped` / `neutral` / `action_required`) and superseded runs
  clear nothing — they carry no verdict, so erasing a live wake on their say-so would be a guess.
- Runs with minimal action surface (checkout only, preinstalled runner Node, no `npm ci`) so the
  watchdog itself has the least possible exposure to the action-download infra failures it absorbs.
  It is best-effort by design. Nothing now covers the case where the watchdog run itself dies —
  the self-wake that used to backstop it prompts and was retired (see "Wake coverage"), so that
  gap is accepted and a human notices instead. Keeping this workflow's surface minimal is
  therefore load-bearing, not just tidy.
- Scope note vs. AI review: there is no CI-side AI reviewer at all any more — the advisory
  `codex-review.yml` was removed 2026-09-21 (see `ai-code-review-runbook.md`), so nothing posts
  review findings on a PR. That never changed THIS watchdog in any case: the wake comment is machine
  signaling about CI state, and a healthy PR still carries no wake comment at all.

Because `workflow_run` executes the **default branch's** copy of the workflow and script, changes
to either take effect only after merging to `main` — they cannot be exercised from the PR that
introduces them (unit tests + this doc are the pre-merge verification).

## Base-branch sync (`scripts/ci/pr-base-sync.mjs`)

Branch protection on `main` sets `strict: true`, so every merge to `main` outdates every other
open PR. `pr-base-sync.yml` fires on each push to `main` (and, for the auto-merge slot below, on
each of this repo's PR CI completions and on a 15-minute schedule) and sweeps open PRs targeting it —
sequentially, capped at 20 per sweep with the remainder logged (never silently truncated), and
listed **least-recently-updated first**: acting on a PR bumps its `updated_at` to the back of the
next sweep's order, so a deferred PR rotates to the front instead of being starved behind the same
busy twenty. Per PR, after bounded polling of GitHub's lazily-computed `mergeable` flag:

- **Conflicted** → one `<!-- frapp-base-sync -->` wake comment telling the watching agent session
  to `git fetch origin main && git merge origin/main`, resolve, and push. The one exception is a
  conflict whose resolution is mechanical (#3783): a PR whose only change is new
  `apps/mobile/store/shipped-builds.json` entries, as every Deploy production record PR is. With
  the app token minted, the sweep pushes that merge itself (`main`'s registry plus the branch's new
  entries, as a two-parent merge commit through the git data API, never forced) and posts no
  comment. It counts as an update, so it takes the auto-merge update slot like one
  (`scripts/ci/resolve-registry-conflict.mjs`). Anything else it refuses, and the PR gets the
  comment.
- **Behind and clean** (measured with the compare API's `behind_by`, not `mergeable_state`, which
  reports `blocked` over `behind`) → auto-updated via `PUT …/update-branch` with
  `expected_head_sha`, **only when the base-sync app token minted**. Pushes made with the default
  `GITHUB_TOKEN` do not create workflow runs (GitHub's recursion guard), so an update through it
  would strand required checks at "Expected" with no CI ever running — strictly worse than not
  updating. On a fork head, or when the update call fails for a reason specific to that PR, the
  wake comment asks the agent to merge `main` itself — the agent's own push triggers CI normally.
  GitHub invalidates `mergeable` lazily, so a sweep racing the base push can read a stale `true`
  for a freshly-conflicted PR; when the update-branch call then fails with a conflict message, the
  sweep posts the **conflict** wake (not the behind one), so the agent always gets resolution
  guidance when it will need it.
- **Behind, and auto-update is off repo-wide** (no token minted, the API rejects it with 401/403, or
  update-branch is 5xx-ing / unreachable) → the PR **still gets its wake**, and the *diagnosis* goes
  to one `incident` alert issue instead. The distinction is the whole point: the wake carries
  "merge `origin/main` yourself", which is what unblocks that PR and is its session's only signal
  that the base moved; the diagnosis ("no app token was minted") is a repo-level fact its reader
  cannot act on, and repeating it on twenty threads is the noise. So the per-PR reason for these
  cases just points at the issue. The alert is **P2, not P1**: PRs still merge, they just need
  `Update branch` pressed by hand — where the repo was before this sweep existed.
  - **Stalled** stops the sweep calling update-branch. A call that never answers costs the full
    two-minute write ceiling, and the alert is written after the loop, inside the job's 10-minute
    timeout, so a stalled endpoint used to run the job out before the alert. After
    `UPDATE_BRANCH_STALLS_BEFORE_STOP` (two) calls in a row run to that ceiling, every later behind
    PR gets the same wake without a call. Only a stall counts: a reset or a DNS failure answers at
    once and costs nothing, and any other outcome restarts the count, so an isolated stall doesn't
    stop the updates that would otherwise outrank it (#2973).
  - A **secondary rate limit** is deliberately not in that set. GitHub answers it with 403, the same
    status as a dead token, and a sequential twenty-push sweep is exactly the shape to trip one — so
    a rate-limited 403 skips fail-safe rather than filing a P2 accusing a working credential.
  - The alert is written **only on a state change**: an already-open one is left alone. `raiseAlert`
    comments on every raise, which suits `deploy-alert.mjs` (it fires per failed deploy) and not this
    sweep (it fires per merge to `main`), so raising unconditionally would relocate the fan-out from
    N PRs to one issue rather than remove it.
  - It closes on a real `update-branch` success, or on a sweep that held a token and blocked on
    nothing. That second condition is deliberate: this repo merges about one PR at a time, so the
    usual sweep has no *other* open PR to update, and an alert gated on a same-sweep success would
    stay open for weeks after the fix. A sweep with **no** token and nothing behind proves nothing
    and never closes it (the "a no-op run never closes an open alert" rule under
    [`agent-infra.md` → Deploy visibility](agent-infra.md#deploy-visibility-scriptscideploy-alertmjs)).
- **Behind, clean, auto-merge on, and another PR holds the update slot** → **held**: no update and
  no wake comment, only a log line, and any stale base-sync wake from an earlier sweep is deleted
  (#3599). Updating a PR cancels the CI running on its old head, and under `strict: true` only an
  up-to-date green PR can merge. When the sweep updated every auto-merge PR on every push, they
  raced: the fastest CI merged and restarted the rest, so on a busy afternoon a PR whose CI outlasted
  the gap between merges (`mobile-validate` finishes about nine minutes after a sync) never merged.
  Now one auto-merge PR at a time holds the slot (`pickSlotOrder`), and only it is updated. Its
  merge is a push to `main`, which passes the slot on. A held PR's session should leave it alone:
  merging `main` into it starts the race again. It can tell it is held because auto-merge is on, the
  PR stays behind, and it has no base-sync comment. A held PR's stale comment is deleted, and
  anything the session must act on (a conflict, an update that failed) gets a fresh one from the
  next push sweep.
  - **Who holds it.** An up-to-date PR in flight keeps it, meaning one of three things. Its required
    checks ([`required-checks.mjs`](../../scripts/ci/lib/required-checks.mjs)) are running. Or they
    haven't reported yet and its head was pushed under 15 minutes ago, going by its earliest check
    suite: right after an update, the new head has no check runs while CI cancels the old run, and
    that cancelled run's completion fires a slot sweep. Or they all passed under 5 minutes ago, so
    auto-merge is about to act. This check fails safe: a same-repo auto-merge PR whose compare fails
    even after a retry, or an up-to-date one whose checks, or (with checks not yet reported) whose
    push time, can't be read, also counts as in flight, and an unresolved mergeability doesn't
    exclude it, because right after an update all of these often can't be read yet. Otherwise the sweep tries the behind PRs in turn until one updates.
    First come those whose checks are still running, which is almost always the holder knocked
    behind by a merge the queue didn't cause, so it keeps the slot. Then the rest, lowest number
    first.
  - **Who is queued.** A clean, same-repo auto-merge PR whose required checks haven't failed. A red PR
    (a failed or cancelled required check) isn't queued and is updated as before, so a fix on `main`
    still reaches it. A behind PR whose checks can't be read, even after a retry, waits behind a
    holder and is tried only after every PR whose checks could be read. A PR whose compare call failed
    is skipped for that sweep. Without `checks: read` every read fails, so up-to-date auto-merge PRs
    hold the slot and behind ones are tried in number order. `pr-base-sync-workflow.test.mjs` pins
    the permission. The slot governs up to 10 auto-merge PRs, lowest numbers first, assessed from every
    open PR, not only the 20-PR slice, because updating the holder moves it to the back of the list.
    Queued PRs count against the 20 (the job's ten minutes don't grow) but take no place in the
    least-recently-updated rotation, so at least 10 other PRs are processed each sweep.
  - **When a PR can't take the slot**, it gets the per-PR treatment above (a wake, or alert evidence),
    and the sweep tries the next. So a holder nobody is watching can't block the queue. When none can
    be updated, nothing is held: every behind PR gets its wake, as before #3599. The push sweep fills
    the slot before its pass over the other PRs, because that pass can take minutes. A 422 whose message
    says the head moved (`expected_head_sha` lost to a concurrent sweep or a push) keeps the slot and
    posts no wake. Any other 422 is a failure like the rest.
  - **The slot-only sweep.** A holder that goes red, or turns green without merging, never pushes. So
    the workflow also runs on `workflow_run: completed` of `CI` and `Migration drift gate` (together
    they emit every required check), for this repository's PRs only, and on a 15-minute
    schedule. The schedule exists because the completion fires inside the grace that keeps a holder
    in flight, and no event marks the end of that grace. It's a backstop, not a bound: ADR-24
    measured a `*/15` schedule in this repo running at a median gap of 3.1 h. In this mode
    (`mode: "checks"`) the sweep fills the slot the same way, with two differences. It reads
    lazily: it compares each auto-merge PR first, reads checks only for up-to-date ones (plus the
    push time for those whose checks haven't reported), and stops at the first one in flight. With a
    holder running it costs a list call, a compare per auto-merge PR up to the holder, and those
    reads for the up-to-date ones among them, all on the repository's shared `GITHUB_TOKEN`
    budget. And its writes are few. It deletes the updated PR's stale wake. It wakes a PR it
    couldn't update for a reason specific to that PR (a 4xx other than those below), if the PR has
    no base-sync comment yet, so a failure that repeats on every completion wakes the session once.
    It closes an open token alert when an update goes through. A rejected token (401/403), a rate
    limit or a stall stops the sweep with no wake; a 5xx, no answer or a conflict gets no wake and
    the sweep tries the next PR. The push sweep diagnoses all of these. It never raises the alert:
    the base did not move, and that job belongs to the push sweep. Push sweeps and slot sweeps run in separate concurrency
    groups, so a slot sweep never cancels a push sweep midway through its wakes. Completions the job
    skips (`main`'s own CI, a fork's) go to a third group. The two kinds can still overlap. When both
    pick the same PR, the head-moved rule absorbs it. When they pick different PRs at the same
    moment, two run CI at once, which is the narrow residue of the original race.
  - **The alert** isn't closed by a push sweep that updated nothing and held (or lost a head-moved
    race on) any PR, because "hit no failure" would prove nothing about the PRs it didn't try. A
    sweep that updates a branch, push or slot-only, still closes it.
  - **Known gaps.** A PR made conflicted by a merge the sweep raced (the stale-`mergeable` read above)
    is held rather than tried, so its conflict wake comes from the next push sweep, not this one. And
    a green auto-merge PR that never merges (waiting on something outside the required-check roster)
    takes the slot again whenever it is first in line, holding the queue for a CI run plus the merge
    grace plus the wait for the next scheduled sweep, each time. A red auto-merge PR is updated by
    the per-PR pass, as before #3599, and while its new CI runs it counts as in flight, so a PR that
    stays red costs the queue about one CI run per merge.
  - Merge queue is the platform version of this (option 3 in #3599). It needs a branch-protection
    change, which is the owner's call.
- **Already in sync** → any stale base-sync wake comment is deleted and the sweep stays silent.
  Unknown mergeability (API error, `mergeable` never resolves) is skipped fail-safe: never
  blind-updated, never falsely accused of conflicts; the next base move re-sweeps.

Comment mechanics match `ci-wake.mjs` (shared helpers): delete-then-create so created-only webhook
listeners fire on every base move, one live comment per PR. Like the CI wake watchdog it is
best-effort and **not** a required check; a successful auto-update posts no comment at all — CI
runs on the updated head, and a failure there reaches the watching session through the webhook.

### The token

`PR_BASE_SYNC_TOKEN` is a **GitHub App installation token**, minted per run by
`actions/create-github-app-token@v3` in `pr-base-sync.yml` from two secrets that belong in the
`automation` environment: `PR_BASE_SYNC_APP_CLIENT_ID` and `PR_BASE_SYNC_APP_PRIVATE_KEY` (#2518,
#2583; [`agent-infra.md` § GitHub environments and bootstrap secrets](agent-infra.md#github-environments-and-bootstrap-secrets)). An App was chosen over the
fine-grained PAT this originally specified for two reasons: an installation token has no expiry
for a human to renew on a calendar reminder (it is minted fresh each run and expires in an hour),
and it is not tied to one person's account, so it survives that person's PAT policy, their token
cleanup, and their leaving. The cost is one more action download on a workflow whose header
otherwise claims a checkout-only surface — an accepted, deliberate widening, kept as small as it
can be.

Setup was human-only and is closed as #689: the
App is created under the owner's GitHub account with repository permissions **Contents: Read and
write** and **Pull requests: Read and write** (nothing else), installed on this repository only,
with its client ID and a generated private key stored as the two secrets above. To rotate the key:
generate a new one on the App, update `PR_BASE_SYNC_APP_PRIVATE_KEY`, delete the old key — no PR,
and nothing tied to a personal account changes. The mint step carries `continue-on-error: true` on
purpose — with the secrets absent it fails, and a red workflow would be exactly the noise this sweep
exists to remove; instead the token comes out empty and the alert issue explains why.

The App has a second consumer: `_mobile-build.yml`'s `record` job mints a token from the same pair,
with the same two permissions, to open the `shipped-builds.json` PR after a store build (#3111;
[`mobile.md` § 6.6](../ops/deployment/mobile.md#66-store-submission)). Rotating the key changes
nothing there. Narrowing the App's permissions, uninstalling it or replacing it breaks that job's
mint too: its summary then lists the uploads to record by hand.

**Confirmed end to end on 2026-08-21T17:28Z**, on the first behind PR the sweep ever encountered.
This closes the one claim the design rested on and could not check from a session: that an App
installation token's pushes **create workflow runs**, where `GITHUB_TOKEN`'s do not (GitHub's
documented recursion guard). `docs.github.com` is blocked by the cloud sandbox's egress proxy, so
that half stayed docs-verified until a real sweep exercised it. It has now been observed directly:

```
17:27:53  #1174 merges to main → PR base sync run 157 fires
17:28:02  Mint base-sync app token — success
17:28:09  [pr-base-sync] #1172: behind by 1 — auto-updated via update-branch
17:28:10  Token revoked
17:28:15  CI run 32508320750 starts on the new head          ← the load-bearing observation
17:28:24  check suites begin reporting success on 2fb22e4
```

The resulting head commit `2fb22e4` is authored by `frapp-base-sync[bot]` ("Merge branch 'main'
into …") with no human, no agent and no comment on the thread, and CI ran on it. Under
`GITHUB_TOKEN` those required checks would have sat at "Expected" indefinitely — strictly worse than
not updating, which is why the pre-App code refused to try. An earlier sweep
(run 156, Actions run `32504830354`) had already shown the mint
half: `PR_BASE_SYNC_TOKEN: ***`, `(auto-update enabled)`, and `Token revoked` at cleanup.

**If this ever regresses** — a sweep reports `auto-updated via update-branch` and the PR's required
checks then sit at "Expected" with no run — the fallback is a fine-grained PAT (contents +
pull-requests write) stored directly as `PR_BASE_SYNC_TOKEN`, replacing the mint step. Nothing else
in the sweep changes; the script reads one env var either way.

### Why the App is safe on a public repo

Reviewed 2026-08-21, because this repo is public and the App holds `contents: write`. No finding;
the App is a net improvement on the PAT route it replaced — a one-hour token, revoked at job end and
scoped to one repository, against a credential bound to a person's account at the 90-day expiry
#689 specified. (That PAT was never created, so
this compares against a design, not against something that ran.) What makes it safe:

- **`pr-base-sync.yml` triggers only on `push` to `main`**, so it runs only on commits that already
  reached the default branch. A fork PR cannot trigger it, and untrusted code never executes in a
  job holding the App credentials. _Amended 2026-11-08 (#3599), outside this review:_ it now also
  triggers every 15 minutes on `schedule` (which, like `push`, runs on `main`), and on
  `workflow_run: completed` of `CI` and `Migration drift gate`. `workflow_run` executes
  the **default branch's** copy of the workflow and the script, checks out `main`, and reads no
  artifact or event payload (the script sees only `GITHUB_EVENT_NAME`), so the "only `main`'s code
  runs with the key" property holds. A fork PR can still fire the event (and could name a workflow
  of its own `CI`), so the job `if:` skips any completion whose head repository isn't this one; see
  item 2 of the list below.
- **No `pull_request_target` exists anywhere in `.github/`** — the trigger that would hand full
  secrets to a job running untrusted PR code.
- **No script-injection surface.** The workflow had exactly four `${{ }}` interpolations: three
  secrets and `steps.app-token.outputs.token`. None is event data. _Amended 2026-11-08 (#3599):_ the
  concurrency group and the job `if:` now also read `github.event_name`,
  `github.event.workflow_run.event` and `head_repository.full_name`. The first two are values
  GitHub sets, and the repository name is only compared, so the group never contains PR-authored
  text and none of it reaches a shell. `run:` is a fixed command with no interpolation at all, and no workflow in this repo puts `github.event.*` inside a `run:`.
  Neither `pr-base-sync.mjs` nor `ci-wake.mjs` shells out (no `exec`, `spawn`, or `child_process`,
  transitively through their only imports); all network I/O is `fetch`, and the sole other host
  call is `readFileSync` on `GITHUB_EVENT_PATH`.
- **The token reaches exactly one API call in the whole repo**: `PUT /repos/{repo}/pulls/{n}/
  update-branch` (`updatePrBranch` in `scripts/ci/pr-base-sync.mjs`). Every other write in these
  watchdogs — wake comments, the alert issue — goes through the job's own `GITHUB_TOKEN`, not the
  App. So the credential's blast radius is "merge a PR's base into that PR's head"; **no code path
  writes to `main`**, and that is a property of the code, checkable by grepping for `updateToken`,
  rather than a property of live settings. Fork heads are skipped explicitly, and the token is
  scoped to this repository, so it could not push to a fork either way.
- Branch protection is a second layer, deliberately **not** the argument — and as of 2026-09-02 the
  reason is narrower than it was. `scripts/configure-branch-protection.mjs` declares `enforce_admins:
  true` and `restrictions: null`, and: (a) that script now reads live protection back and diffs it (`npm run
  configure:branch-protection:verify` exits non-zero on any difference) — a **shipped capability of
  the script**, not something #1383 delivered: that stage-5 issue asked for the read-back, is still
  open, and its body still describes the script as PUT-only, so cite the capability rather than the
  issue. **That read is available to a session**, contrary to what this bullet used to say: it called the read "session-dependent" and
  therefore treated the whole layer as not-verifiable-from-a-session, which the route rule under
  [`agent-infra.md` → The `api.github.com` route rule](agent-infra.md#the-apigithubcom-route-rule) corrects — `GET /repos/{owner}/Frapp/branches/main/protection` returns 200 direct
  (21 required contexts as the roster stood at that read, since reduced by #1637 and by the
  docs-gate retirement; read `ALL_REQUIRED_CHECKS` rather than any count quoted here. Plus
  `strict: true`, `enforce_admins: true`, `required_linear_history: true`,
  `required_pull_request_reviews: null`, measured 2026-09-02) and the verify script exits 0 from
  this sandbox, printing "No changes — live protection already matches this roster." So live `main`
  matches every field that diff compares as of 2026-09-02 — the drift
  `docs/ops/github-branch-protection-runbook.md` records (12 contexts against 17 intended)
  was closed by a run on 2026-08-21. Exit 0 is still not "live matches the roster in full":
  `LOCK_DEPENDENT_FLAGS` excludes `allow_fork_syncing` from the diff while `lock_branch` is
  `false`, so a divergence on that one key stays invisible to a green `:verify`
  (#1580 closed the divergence that existed;
  the exclusion remains). Canonical state, including the roster's current context count:
  [`github-branch-protection-runbook.md`](../ops/github-branch-protection-runbook.md) § Step 1 —
  read it rather than the dated counts above, and do not add new ones here. What survives is
  that a read is a **dated snapshot**, not a standing guarantee: nothing stops `main` drifting again
  between applies, so re-run the verify rather than trusting this date; (b) `restrictions: null` means the push-restriction
  allowlist is **disabled**, which is not the same as "nothing can bypass"; and (c) `bypass_actors`
  live in repository **rulesets**, a layer nothing in this repo configures — `GET
  /repos/{owner}/Frapp/rulesets` returns 200 and reports **one** ruleset (2026-09-02), whose
  contents nobody has read, so a ruleset naming this App would still defeat the claim and nothing
  here rules that out. Treat "the App cannot reach `main`" as resting on the bullet above, which is
  a property of the code.

The residual risk is the private key. One protection is GitHub not passing secrets to
fork-triggered `pull_request` runs. The other is the `automation`
environment's `main`-only branch rule (#2583, set 2026-09-23): a workflow added on a branch to echo
the key is refused the environment. Before that the key was a repository secret, which any such
workflow could read. **Four
changes would break the first, and none should ever be made:**

1. Adding a `pull_request_target` workflow that checks out PR-head code.
2. Adding a `workflow_run` workflow that carries the App key **without a fork guard**.
   `workflow_run` also runs base-repo code with secrets off a fork-PR-derived event; today
   `ci-wake.yml` uses it with no fork guard, which is safe only because it carries `GITHUB_TOKEN` and
   never the key (`deploy-staging.yml` does guard, on `head_repository.full_name`). _Amended
   2026-11-08 (#3599):_ `pr-base-sync.yml` itself now runs on `workflow_run`, guarded the
   `deploy-staging.yml` way. Its job `if:` requires `head_repository.full_name == github.repository`,
   and its concurrency group keeps fork and `main` completions out of the slot group. Keep that
   guard: without it, a fork could add its own workflow named `CI` and fire the App-token job at
   will.
3. Interpolating untrusted event data (a PR title, branch name, or comment body) into a `run:`
   block in any workflow that holds secrets.
4. Widening the App beyond this repository or beyond its two permissions.

One exposure this review does not eliminate: `pr-base-sync.yml` pins `actions/checkout` and
`actions/create-github-app-token` by **mutable major tag**, and the second is the action that
receives the private key. A compromised tag executes in exactly the job that holds it. Both are
`actions/*`, and mutable major tags are this repo's prevailing convention (a handful of third-party
actions aside — `docker/*`, `dorny/paths-filter`, `lycheeverse/lychee-action`), so this is not a
deviation — but it is the shortest path to the key, and SHA-pinning at least the token minter is
the cheapest hardening available if that trade is ever revisited. Count the workflows with
`ls .github/workflows/*.yml` rather than trusting a number written here.

One pre-existing property this rests on: `main` requires **zero** approving reviews — and since
#1340 it is the only branch, so there is no branch anywhere that requires one ([`CONTRIBUTING.md` § PR review requirement policy](../../CONTRIBUTING.md#pr-review-requirement-policy)).
So "only reviewed code runs with the App token" is really "only code merged by someone with
write access" — fine for a single-maintainer repo, and the thing to revisit first if
collaborators are ever added. Note this is about the App token, not about what ships: the
production deploy still requires a human to approve the `production` environment.
