### ADR-23: Multi-agent budget — one big review, everything else small, explicit effort (2026-09-23)

**Decision:** Keep the discover-or-code, then verify-independently loop, but spend agents in one place.

- **`/diff-review` is the only fan-out allowed to be big.** It is the review gate on every push, so
  it runs through the saved workflow [`frapp-review`](../../../.claude/workflows/frapp-review.js),
  whose shape is fixed in code. No other review (a `/next` lens pass, an ad-hoc adversarial
  re-review of a fix) is layered on top of it.
- **Finders bundle angles.** One `diff-finder` holds two or more angles: 4 finders at `high` instead
  of one per angle, 2 on a small diff or a re-review of fix commits.
- **One verifier per deduped candidate, a second only on REFUTED.** The first `claim-verifier`
  checks whether the failure scenario reproduces. Only if it says `REFUTED` does a second one, on a
  materiality lens, look independently. The candidate is kept unless both say `REFUTED`.
- **A re-review covers only what changed.** After a fix commit, the gate reviews the commits since
  the last reviewed one, with two finders. `scripts/diff-review-scope.mjs` decides, trusting only
  markers the gate wrote with a kind (`full` or `delta`) on commits of this branch. A merge since
  the last review means a full review again, because a merge can hide a change from any diff.
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
  angle definitions and reporting.
- `/next` under ultracode drops its separate five-lens pass. Acceptance criteria and test adequacy
  became one extra finder inside the gate, run in its own worktree so it can mutate source to prove
  a test bites (#2414).
- `skipWorkflowUsageWarning` was removed from `.claude/settings.json`. The CLI reads it only from
  user, local, flag and policy settings, so the project value never did anything.

**Trigger to revisit:** A review that follows these rules misses a defect that the old shape would
have caught, or a Claude Code release changes how effort, the size guideline or saved workflows
behave. Tracking: #2482.
