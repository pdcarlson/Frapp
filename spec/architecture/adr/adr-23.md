### ADR-23: Multi-agent budget — one big review, everything else small, explicit effort (2026-09-23)

**Decision:** Keep the discover-or-code, then verify-independently loop, but spend agents in one place.

- **`/diff-review` is the only fan-out allowed to be big.** It is the review gate on every push, so
  it runs through the saved workflow [`frapp-review`](../../../.claude/workflows/frapp-review.js),
  whose shape is fixed in code. No other review (a `/next` lens pass, an ad-hoc adversarial
  re-review of a fix) is layered on top of it. **Corrected 2026-09-24:** only a branch's first
  review, and a re-review large enough to count as new work, runs the workflow now; see
  [amendment 1](#adr-23-amendment-1--the-first-round-is-the-thorough-one-2026-09-24).
- **Finders bundle angles.** One `diff-finder` holds two or more angles: 4 finders at `high` instead
  of one per angle, 2 on a small diff or a re-review of fix commits. **Corrected 2026-09-24:** every
  workflow round adds the acceptance-and-tests finder, and a fix-round re-review has no finders
  (amendment 1).
- **One verifier per deduped candidate, a second only on REFUTED.** The first `claim-verifier`
  checks whether the failure scenario reproduces. Only if it says `REFUTED` does a second one, on a
  materiality lens, look independently. The candidate is kept unless both say `REFUTED`.
  **Corrected 2026-09-24:** candidates at the same line go to one verifier together, with a verdict
  for each (amendment 1).
- **A re-review covers only what changed.** After a fix commit, the gate reviews the commits since
  the last reviewed one, with two finders. `scripts/diff-review-scope.mjs` decides, trusting only
  markers the gate wrote with a kind (`full` or `delta`) on commits of this branch. A merge since
  the last review means a full review again, because a merge can hide a change from any diff.
  **Corrected 2026-09-24:** a small re-review is now inline, with no finders; a merge of `main` no
  longer forces a full review, and a marker records only that a review ran (amendment 1).
- **Everything else stays small.** `workflowSizeGuideline: "medium"` in `.claude/settings.json`
  tells the model to keep workflows under 10 agents; it is advisory text, not a cap. The repo adds
  at most 5 agents per fan-out step, which nothing enforces. Verification outside the gate is one
  opinion per claim, with up to 5 claims batched into one `claim-verifier`. Ultracode doesn't lift
  either limit.
- **Every workflow agent sets its effort:** `medium` by default, `high` for finders and hard
  judgment, never `xhigh`. Procedure: [`multi-agent` skill](../../../.claude/skills/multi-agent/SKILL.md).

**Rationale:** One ultracode session on 2026-09-22 spent far more than its outputs needed, mostly
on verification. Per-workflow totals from the harness task notifications:

| Run | Agents | Subagent tokens |
|---|---|---|
| Implement 2 tracks, then review | 75 | ~5.6M |
| Review of a 35-file mobile diff | 79 | ~5.4M |
| Review of a 5-file API fix | 36 | ~1.9M |
| Each fix-and-re-review round | ~18 | ~1.2M |
| One fix round with "adversarial" re-review (6 finders, 2 verifiers per candidate) | 51 | ~2.5M |

The 79-agent review was 8 finders (one per angle, up to 6 candidates each), 2 verifiers per
candidate on different lenses, and a gap sweep: 8 + 35 × 2 + 1. All 35 candidates survived, so the
second verifier changed no outcome there. The verifiers did split on roughly 2 to 4 real low or
medium findings per review, and the keep-if-either rule saved them. A single verifier that drops on
REFUTED would have lost about half of those.

Escalating only on REFUTED keeps them. Under keep-if-either, the second vote can change the outcome
only when the first is REFUTED, so running it only then makes the same keep-or-drop call on every
candidate, provided the same two verifiers vote and the second doesn't see the first verdict. The
cost is about 1 + (refute rate) verifiers per candidate instead of 2; on the 79-agent review, about
39 instead of 70. The verifiers are not quite the same: they now run at `medium` and `high` effort
where the 2026-09-22 pair inherited `xhigh`, so per-vote recall is unmeasured. That is the first
thing to check if the trigger below fires.

Two facts about the harness (Claude Code 2.1.280, read from the CLI bundle and its docs) shaped
the rest:

- *The harness's own review is leaner.* Its bundled `/code-review` never uses more than one
  verifier per deduped candidate. For Opus-family models it now runs medium and high as a single
  inline pass with no verifiers at all (its 2.1.274 changelog: "leaner inline review prompts …
  instead of spawning many review subagents"). What pushed counts up was the harness's ultracode
  guidance ("token cost is not a constraint", a "3–5 vote adversarial pass" for thorough asks),
  which this repo's instructions outrank.
- *Ultracode pins the session to `xhigh`, and subagents inherit it.* Opus 5.5 defaults to `medium`.
  Measured 2026-09-23 from the `"effort"` field in subagent transcripts: a workflow `agent()` with
  `effort: 'medium'` ran at medium, and a `claim-verifier` launched with `effort: 'high'` ran at
  high. Without it, every workflow agent and every Agent-tool launch ran at xhigh. Agent files can
  declare `effort` too, but they load at session start, so whether that field beats ultracode's
  xhigh was not measured.

**Alternatives rejected:**

- *Two verifiers per candidate, always.* It makes the same decisions as escalation at about twice
  the verifier cost.
- *A strict single vote (REFUTED drops it).* It is the cheapest, but it loses real split-verdict
  findings.
- *`workflowSizeGuideline: "large"` (under 50).* It would loosen every workflow to fit the one
  review that legitimately needs more. The gate's size is fixed by `frapp-review.js` instead.
- *A PreToolUse hook on `Workflow`.* A hook can't count the agents a script will spawn, and a named
  workflow call doesn't expose its script to the hook.
- *`CLAUDE_WORKFLOW_NAME_ONLY`.* It limits the tool to bundled workflows, which would drop
  `frapp-review`, and a settings file can't set it.
- *The `+500k` turn budget.* Nothing in 2.1.280 sets it, so its ceiling never triggers.
- *The "Large workflow" warning.* It fires at 25 agents or 1.5M projected tokens, but it only shows
  in the UI, never reaches the model, and is hidden under ultracode.

**Consequences:**

- A second copy of the review shape is a defect. `frapp-review.js` owns the bundles, caps and
  verify rule; the [`diff-review` skill](../../../.claude/skills/diff-review/SKILL.md) owns the
  angle definitions and reporting. **Corrected 2026-09-24:** the angle definitions moved to
  [`angles.md`](../../../.claude/skills/diff-review/angles.md) beside the skill, so finders read
  them without the procedure.
- `/next` under ultracode drops its separate five-lens pass. Acceptance criteria and test adequacy
  became one extra finder inside the gate, run in its own worktree so it can mutate source to prove
  a test bites (#2414). **Corrected 2026-09-24:** that finder now runs in every workflow round, not
  only under ultracode (amendment 1).
- `skipWorkflowUsageWarning` was removed from `.claude/settings.json`. The CLI reads it only from
  user, local, flag and policy settings, so the project value never did anything.

**Trigger to revisit:** A review that follows these rules misses a defect that the old shape would
have caught, or a Claude Code release changes how effort, the size guideline or saved workflows
behave. Tracking: #2482.

#### ADR-23 amendment 1 — the first round is the thorough one (2026-09-24)

**Decision:** A branch gets one thorough review. Every later round reviews only what changed, and a
small round is reviewed inline.

- **First round (`mode: full`):** one shape, with no effort levels, no ultracode variant and no cap
  on reported findings. It runs 4 bundled finders (2 under 150 changed lines) and the
  acceptance-and-tests finder in its own worktree. Each flagged line then gets one `claim-verifier`,
  and a second lens only on REFUTED. The gap sweep, which ran only at `xhigh`, is gone.
- **Later rounds (`mode: delta`):** under 300 changed lines since the last reviewed commit, the agent
  reviews the delta inline against the same angles, with no subagents. At 300 lines or more it is new
  work, and it gets the workflow with 2 finders plus the acceptance-and-tests finder.
  `package-lock.json` and `openapi.json` don't count toward the 300. The number lives in
  `INLINE_MAX_LINES` in `scripts/diff-review-scope.mjs`.
- **Merges of `main` carry the review.** The delta is HEAD against the last reviewed commit with the
  current `main` merged in (`git merge-tree --write-tree`). It holds fix commits and any hand edit
  inside a merge commit, and none of `main`'s own changes. Where the two conflict, the merged tree
  keeps git's conflict markers, so the delta shows the resolution itself, including one that took a
  side whole. A merge never forces a full review.
- **The hook accepts a commit that adds nothing unreviewed.** With no marker, `.githooks/pre-push`
  asks `scripts/diff-review-scope.mjs --check`, which passes a commit already on `origin/main` or one
  whose delta is empty. A base sync then needs no review at all. That replaces the `merged` marker
  kind; a marker now records only that a review ran. The script trusts a marker only on the
  branch's own first-parent line, and never an empty one: those predate kinds and were written by
  `touch` after reviews that could cover part of the branch.
- **Candidates at one line are verified together**, by one verifier returning a verdict per finding.
  That replaces the streaming dedup chain and the workflow's verify-only mode.

**Rationale:** On 2026-09-24 Paul reported that the gate burned usage before every PR and re-ran
when it didn't need to. The marker is per commit, so every fix commit launched a workflow re-review:
by the 2026-09-23 shape, 2 finders plus a verifier for each of up to 12 candidates. Every merge of
`main` reset the branch to a full review: 4 to 6 finders (under ultracode, the acceptance finder
and the gap sweep) plus a verifier for each of up to 46 candidates. Those counts are derived from the shape, not measured on a run; the only measured
re-review cost is the pre-ADR ~18 agents and ~1.2M tokens in the table above. Babysitting one PR
through CI fixes, review comments and base syncs could run the workflow half a dozen times. Most of those runs reviewed code that had
already passed a review, or a few lines written to answer one. #2490 also recorded that #2487's own
review rounds went mostly to the machinery it added (marker kinds, merge semantics, dedup edge
cases), so this amendment removes more machinery than it adds.

**What it gives up:**

- A fix round loses its independent verifier. The agent reviews its own fix. That is acceptable
  because the fix answers a finding that was already verified, is under 300 lines by construction,
  and still has to pass CI. The independent pass stays where it decides the most, on the first round.
- A clean merge of `main` is trusted. A semantic break between `main` and a branch that merges
  cleanly as text is left to CI (types and tests), as it already was for any PR that `main` moved
  under.
- Sessions without ultracode now run the acceptance-and-tests finder in every workflow round (one
  more finder). Ultracode sessions lose the gap sweep (one fewer finder, plus its verifiers).
- `/next` no longer runs a batch of issues at `xhigh`. That rule existed because a full review
  reported at most a fixed number of findings, so several issues would share one cap. The cap is
  gone, so every surviving finding is reported however many issues the batch holds. One
  acceptance-and-tests finder still covers every member's criteria, with 6 candidates.

**Alternatives rejected:**

- *#2490 option 2: delete the workflow and keep a one-line heuristic.* Paul asked to keep a thorough
  first round.
- *Cheaper workflow re-reviews (one finder per fix round).* Every push would still launch an agent
  fan-out. The cost lay in how many rounds ran, not how big each one was.
- *Comparing the branch's patch-id before and after a merge.* It says only whether the branch's net
  change moved, not what moved, so a merge with any fix on top would fall back to a full review.
  `merge-tree` gives the diff to review.

**Trigger to revisit:** a defect that reaches `main` through a commit reviewed inline, and that a
workflow round would plausibly have caught, or a break that hid in a clean merge of `main` and that
CI missed. Tracking: #2490.
