### ADR-14: Code review — CodeRabbit → self-hosted Claude review GitHub Action (2026-06-01)

**Decision (2026-06-01):** Replace CodeRabbit with a self-hosted automated PR review running `anthropics/claude-code-action@v1` in GitHub Actions, gated by a required `claude-review-gate` check.

**Removed 2026-09-05.** The Decision, Rationale, Consequences and the 2026-06-01 / 2026-06-03 amendments described the CI reviewer's machinery — the two model tiers, the gate job and its commit-status plumbing across two event shapes, the override label, the fork/draft/no-token special-casing. **Every artifact they describe was deleted on 2026-06-04** (see the amendment below), so the text was operating instructions for a workflow that does not exist. What the log is for is kept here rather than in that detail:

- **Why CodeRabbit was dropped:** on a private repo its free tier posts summary-only, rate-limited reviews; the assertive line-by-line config this repo wanted needed Pro at ~$24/dev/mo. Frapp already pays for Claude, so an OAuth-token Action added no per-token bill.
- **Alternatives rejected in the 2026-06-03 market scan**, none clearly better under the constraints (free or ≤$10/mo flat, ~100 private PR reviews/mo, CodeRabbit-like UX): CodeRabbit Pro (~$24–30/mo, over budget); Gemini Code Assist's free GitHub reviewer (free and on Google infra, but its free tier was reported sunsetting ~2026-07-17); Greptile and Cursor BugBot (per-PR pricing); Qodo/PR-Agent self-hosted (still spends Actions minutes plus per-token).
- **Why it was abandoned rather than tuned:** even reconfigured to Opus-once-on-open, it carried disproportionate machinery for a solo repo, and per-push review drained both metered Actions minutes and subscription quota. The measured driver was the imminent **Max-5× → Pro downgrade, ~80% less quota** — a plan change, so do not read "drained quota" as a property of the plan in force today.
- **Evidence that anyone rebuilding this will need, and that exists nowhere else in the tree.** The gate deliberately did **not** key on the action's exit code, because of two upstream defects: **`claude-code-action#1299`**, a permanent-red-required-check failure mode, and **`#846`**, spurious non-zero exits. The workaround was a `--json-schema` `structured_output`, with a `<!-- claude-review-verdict: important=N sha=<head_sha> -->` marker as **fallback**, and a separate gate job failing only on `important > 0`. That gate **always reported a conclusion** (so a required check never hung "pending") and passed for bot/draft/fork/no-token/skipped runs — and it is that always-reporting property, not anything upstream, that avoided both defects. Drop it when rebuilding and the required check hangs on any run where the action dies before emitting a verdict; the `sha=` was added by **#599** so a prior commit's verdict could not mask a failed run. A second trap: an `issue_comment`-triggered run's implicit check-run attaches to the **default-branch head**, not the PR head, so the gate had to post an explicit commit status to the resolved PR head SHA. And the purpose-built **`claude-code-security-review`** action was rejected as **API-key-only** — it cannot authenticate with the subscription OAuth token this repo holds, which is why the general `claude-code-action` carried a custom prompt instead.

The live rules are the 2026-08-01 amendment (local [`/diff-review`](../../../.claude/skills/diff-review/SKILL.md) gate), the 2026-09-16 amendment (that gate is enforced by [`.githooks/pre-push`](../../../.githooks/pre-push), provider-neutral), the 2026-09-18 decision amendment (CodeRabbit retirement **decided**), and the 2026-09-18 implementation amendment (the advisory BYOK `codex review` CI job is **built**, and CodeRabbit's retirement is now **executed**). The 2026-09-08 amendment (CodeRabbit comment-only) is **spent**: the App was uninstalled by the owner on 2026-09-18 and `.coderabbit.yaml` was deleted with it, so there is no CodeRabbit pin to maintain and no CodeRabbit review to keep out of the merge ruleset. The constraint it discovered outlives the vendor and is the part to carry forward: **any** automated reviewer must post plain comments and never a GitHub review event. Runbook: `docs/internal/ci-cd/AI_CODE_REVIEW_RUNBOOK.md`.

- **Amendment (2026-06-04) — the CI Claude review is removed entirely; review moves to a local pre-push gate.** The GitHub Actions reviewer (`.github/workflows/claude-review.yml`), the `claude-review-gate` required check (and its `claude-review-gate-runner` job + `evaluate-review-gate.mjs` decision logic and tests), the `.github/claude-review/` rubric + learnings, and the `CLAUDE_CODE_OAUTH_TOKEN` dependency are **all deleted**. Even reconfigured to Opus-once-on-open, the CI reviewer was not working as designed and carried disproportionate machinery (gate status plumbing across two event shapes, the override label, fork/draft/no-token special-casing, branch-protection coupling). **Replacement:** a local Claude Code **PreToolUse hook** (`.claude/hooks/pre-push-review-gate.sh`, wired in `.claude/settings.json`) gates `git push` — the first push of each branch HEAD is blocked with guidance to run the built-in **`/code-review`** skill in-session on the diff; a HEAD-keyed, session-scoped sentinel makes it deny-once-then-allow (no loop), and a new HEAD (after committing fixes) re-gates so the review always covers what is pushed. This is now the **single** pre-PR review gate (the `/next` flow no longer runs `/code-review` as a separate step — the push hook drives it once). Review sub-agents inherit the session model (Opus): the `CLAUDE_CODE_SUBAGENT_MODEL` Sonnet pin is also removed from `.claude/settings.json`. **Trade-offs:** review now happens on the author's machine before the PR exists (no server-side enforcement on merge, and no inline GitHub review comments) — acceptable for a solo project where every PR is authored by an agent that runs the gate; and a PreToolUse hook can only *instruct* Claude to run `/code-review` (it cannot invoke a skill), so the gate reliably interrupts the first push per HEAD rather than hard-blocking. `claude-review-gate` is removed from `scripts/configure-branch-protection.mjs` and de-required via `npm run configure:branch-protection`. Runbook updated: `docs/internal/ci-cd/AI_CODE_REVIEW_RUNBOOK.md`.

- **Amendment (2026-07-30) — the gate is satisfied by `/diff-review`, a project skill.** ⚠️ **The premise stated in this amendment was measured wrong; see the 2026-08-01 amendment below for the corrected rule. The conclusion — keep `/diff-review` — still holds, for different reasons.** The 2026-06-04 amendment above assumed the hook could "instruct Claude to run `/code-review`". It cannot: `/code-review` is **author-locked against model invocation**. It has no file on disk — it is a native command compiled into the Claude Code binary with `disableModelInvocation` hardcoded at its registration site, and that lock resolves *before* user settings, clamping the skill to `user-invocable-only` at best. The sole escape hatch is the runtime `userTypedThisTurn` condition, so ~~only a human physically typing `/code-review` can run it~~ (**wrong — see below**); a `skillOverrides` entry is a verified no-op. In practice every agent session stalled at the gate waiting for a keystroke. **Replacement:** [`.claude/skills/diff-review/SKILL.md`](../../../.claude/skills/diff-review/SKILL.md) — a project skill that is model-invocable (it simply omits `disable-model-invocation`) and reproduces the bundled workflow: scope the diff, fan out parallel finder subagents per angle, run **one independent verifier subagent per candidate** (`CONFIRMED`/`PLAUSIBLE`/`REFUTED`), then report once via `ReportFindings`. It additionally encodes repo-specific invariants as first-class angles — `chapter_id` scoping and chapter-scoped role lookups (load-bearing given ADR-13's application-layer-only isolation: RLS is enabled with no permissive policies and the API holds the `service_role` key that bypasses it), permission decorators, the PGlite migration gate, the doc-sync mandate, Linear-not-GitHub, and verification honesty. **Corrected 2026-09-05:** two of those angles no longer describe the skill. The tracker angle now reads the other way — issues are opened **on GitHub** with the `triage` label (Linear was retired 2026-08-08, amendment 5 of ADR-16); and the "doc-sync mandate" angle went with the coercive gate in #1597, replaced by a docs angle that reads a diff against `DOCUMENTATION_CONVENTIONS.md`. The rest of the sentence stands. Deliberately **not** named `code-review` (precedence against a native command is untraced, and a silent shadowing failure would make the gate look satisfied while nothing ran) and deliberately **not** `context: fork` (which would move `ReportFindings` into a subagent where the host UI cannot render it). **Trade-offs:** the gate is now self-certifying — the same agent writes the code and triggers its review — so the per-candidate verifier pass is what keeps it honest and must not be weakened; and we no longer inherit upstream improvements to the bundled reviewer. Humans should still prefer `/code-review`, which is richer (cloud `ultra` mode, `--fix`, `--comment`).

- **Amendment (2026-08-01) — `/code-review` is *conditionally* model-invocable; the 2026-07-30 premise was wrong.** Measured against Claude Code **2.1.220** (`AI_AGENT=claude-code_2-1-220_agent`). `disableModelInvocation` is real, but the runtime check is `disableModelInvocation && !userTypedThisTurn`, and `userTypedThisTurn` is **not** a keystroke flag: it scans the current turn for a message that is `type: "user"`, not `isMeta`, and matches the bare token `/code-review`. So an agent **can** call `Skill(skill: "code-review")` when the turn's prompt carries that token **whitespace-delimited on both sides**. ⚠️ **Precision fix (2026-08-02):** this amendment originally said "whenever the turn's prompt mentions it in prose", which overstates reachability. The regex is `(?<!\S)/code-review(?=$|\s)`, so backticks, surrounding quotes, `**bold**`, and a trailing `.` or `,` all **defeat** it — and backticking commands is this repo's own house style. Re-measured against the running 2.1.220 build: a session referencing `/code-review` eight times, every occurrence backticked, was still refused with `disable-model-invocation`. The conclusion below is unchanged and in fact strengthened — `/code-review` is reachable *less* often than the 2026-08-01 text implied, so `/diff-review` carries more of the load, not less. It **cannot** when the token is absent or only present in a rejected form, inside a sub-agent, from a slash-command expansion (skipped via `<command-message>` — so **never under `/next`**), or from a hook (all hook `additionalContext`, on every event, renders `isMeta: true`, so a hook can neither invoke a skill nor enable one). **Evidence:** both directions executed in one session — token present → a full forked review ran; token absent → `Skill code-review cannot be used with Skill tool due to disable-model-invocation`. The scan rule, the `isMeta` renderer and the check ordering were read out of the 2.1.220 bundle, not merely inferred from those two observations. **Consequence:** `/diff-review` is retained, but as *the always-reachable review* rather than *the only one* — `/code-review` is now preferred wherever it is reachable. Its remaining unique value is the Frapp-specific angle set; its generic half duplicates a harness that is tuned per model upstream (tracked separately for a measure-then-cut decision). `skillOverrides` remains a verified no-op: `disableModelInvocation` returns before that branch is reached. Version-pinning is not an escape either — the command did not exist in 2.1.42 (whose `pluginCommand: "code-review"` registers `/review`), and 2.1.220 was the latest published release at the time of writing.

- **Amendment (2026-09-08) — CodeRabbit is live again on the public repo; it must not block squash.** ADR-13's 2026-09-05 correction already noted that the private-repo reason for dropping CodeRabbit had lapsed. CodeRabbit's GitHub App is installed and Organization UI is ASSERTIVE with request-changes on, so a finding is a real `CHANGES_REQUESTED` review. A write-access reviewer in that state trips the merge ruleset (`1 review requesting changes by reviewers with write access`) even when required checks are green — measured on [#1875](https://github.com/pdcarlson/Frapp/pull/1875). Agents cannot dismiss that review (`GITHUB_PAT` 401; GitHub MCP has no dismiss tool; the PR author cannot approve their own PR). **Repo pin:** `.coderabbit.yaml` (deleted 2026-09-18, so this is a historical reference, not a link) set `reviews.request_changes_workflow: false` (comment-only, never `CHANGES_REQUESTED` / `APPROVED`) and `reviews.auto_review.drafts: false` so drafts do not consume the OSS 1-review/hour slot. The local `/diff-review` gate is still the merge-quality gate; CodeRabbit is advisory comments only. This does not reintroduce a required CI review check. ✅ **Executed 2026-09-18.** The owner uninstalled the CodeRabbit App and `.coderabbit.yaml` was deleted in the same change, in that order — the order mattered, because deleting the config while the App was installed would have dropped CodeRabbit to its unconfigured defaults, where `request_changes_workflow` is ON, reproducing the very squash block this pin existed to prevent. **This amendment is now spent**: there is no CodeRabbit App, no config, and nothing here to maintain. The *constraint* discovered here outlives the vendor either way: **any** automated reviewer must post plain comments and never a review event.

**Trigger to revisit:**

- External human (non-agent) contributors are added, or PRs start landing without having gone through the local gate → reintroduce a server-side review/check on merge.
- Claude Code makes `/code-review` invocable *unconditionally* by an agent — i.e. without the current turn's prompt carrying the token, and from inside a sub-agent — or a hook-driven subprocess route (`claude -p "/code-review"`) proves reliable → retire `/diff-review` and point the hook at the bundled reviewer. **Note the 2026-08-01 amendment does not fire this trigger**: conditional invocability is not enough, because the `/next` flow can never satisfy the condition.
- The local-only model proves too easy to skip → add a CI check that the diff was reviewed, or restore a managed Code Review service if Frapp lands on a Team/Enterprise plan.

## Amendment — 2026-09-16: provider-neutral Git enforcement

The provider-specific Claude `PreToolUse` gate and Cursor shell adapter are replaced by the
repository-managed [`.githooks/pre-push`](../../../.githooks/pre-push), installed through the root
`prepare` script. Git supplies the exact ref updates, so every published commit requires
`.cache/diff-review/<PUSHED_COMMIT_SHA>` evidence and multi-ref or explicit-ref pushes cannot borrow
HEAD's marker. The four-denial livelock release is rejected: repeated pushes never create evidence.

This corrects the 2026-06-04 amendment's provider-specific and deny-once design without erasing that
history. The new gate is provider-neutral for Codex, Claude, Cursor, and humans once installed. It is
not server-side or unconditional: Git's `--no-verify`, a changed `core.hooksPath`, or skipped
installation can bypass it. A nonzero hook result otherwise aborts the push.

## Amendment — 2026-09-18 (decision): CodeRabbit retirement decided; advisory CI review to return as a BYOK `codex review` CLI job

**Decision.** CodeRabbit is retired by owner decision. Its intended replacement is an **advisory,
comment-only CI reviewer built on the Codex CLI's first-class `codex review` subcommand**, run with
a bring-your-own-key model provider. It must never be a required check, must stay out of
[`scripts/ci/lib/required-checks.mjs`](../../../scripts/ci/lib/required-checks.mjs), and must never
post a GitHub review event. The merge-quality gate remains the local
[`.githooks/pre-push`](../../../.githooks/pre-push) + [`/diff-review`](../../../.claude/skills/diff-review/SKILL.md)
path from the 2026-08-01 and 2026-09-16 amendments.

**Both halves of this decision are now executed** (2026-09-18, same day): the workflow exists —
see the implementation amendment below — and the CodeRabbit App has been uninstalled with
`.coderabbit.yaml` deleted. What follows in this amendment is the decision and the evidence for it,
kept as the record of why; read the implementation amendment for what the reviewer actually does, and
note that several factual claims here were corrected there by execution.

### Which revisit trigger this fires: none, and that is deliberate

The **Trigger to revisit** list above states three conditions for CI review returning. **This
decision fires none of them**, and the list did not anticipate the situation:

- Trigger 1 (external human contributors, or PRs landing without the local gate) — has not happened.
- Trigger 2 (`/code-review` becomes unconditionally agent-invocable) — has not happened.
- Trigger 3 (*"the local-only model proves too easy to skip → add a CI check that the diff was
  reviewed, or restore a **managed** Code Review service if Frapp lands on a Team/Enterprise
  plan"*) — the local model has **not** proven easy to skip, and the remedy it names is a managed
  service, which is the credits path recorded at the foot of this amendment, not a self-built one.

All three triggers were written while an advisory reviewer (CodeRabbit) was present, so they only
ever asked when a *blocking* gate should return. Retiring the incumbent advisory reviewer removes
coverage none of them was guarding. That is a change of premises rather than a fired trigger, and
this amendment is recorded as acting **outside** the trigger list, not under it. The triggers
themselves are updated below so the next reader is not left to reconcile the two.

**Why this does not re-litigate the 2026-06-04 removal.** That amendment removed a **required
review gate** and the machinery that made it required: `claude-review-gate`, its commit-status
plumbing across two event shapes, the override label, and fork/draft/no-token special-casing. Every
one of those costs came from the check being *blocking*. An advisory comment-only job has none of
them. The 2026-06-04 reasoning is untouched and still governs any attempt to make CI review
blocking.

### Why the CLI, and not `openai/codex-action`

`openai/codex-action` runs `codex exec` — a generic agent that reviews only because a prompt says
so. Its README documents no subcommand input and its `codex-args` appends to `exec` only, so
`codex review` is unreachable through it. **That reachability claim rests on the action's source and
README, not on execution** — see the provenance note below.

What *was* measured is that the action's wrapper failed twice on #2396 before Codex ran at all:

- **Head `befbe9c`, human actor** — died at the action's `read_server_info` step. Its bundled
  Responses-API proxy never starts when the API key is empty, but that step runs regardless and
  throws.
- **Head `4e1638a`, after `pr-base-sync` merged main** — died in **415 ms** at the action's own
  `Check repository write access` gate: *"Actor 'frapp-base-sync[bot]' is not permitted to run this
  action … Detected permission: 'none'."* The action exposes `allow-bots` / `allow-bot-users` for
  exactly this and ran with `allow-bots: false`.

The second failure is structural, not incidental. [`pr-base-sync.yml`](../../../.github/workflows/pr-base-sync.yml)
runs on **every push to `main`** and sweeps **every open PR**, so a bot-actor rejection reddens the
whole open-PR fleet on every sweep, repeatedly. In the run log the failing step is `__run_2`,
before `__run_3 Install Codex CLI` — the wrapper rejects the actor before Codex is installed.

> **Provenance.** The run log also shows a step named `Run codex exec`, but it is listed as
> `skipped`: no Codex step executed in either run. A step *name* in a skipped job is static action
> metadata — the same class of evidence as the README, not a runtime observation. Treat "the action
> cannot reach `codex review`" as a source-level claim, and re-check it against the action's current
> version before relying on it; it is the load-bearing premise of this decision.

Installing `@openai/codex` in a workflow step and calling `codex review` removes the wrapper and
both of its failure modes.

### What `codex review` supplies, and how that was established

Verified against **Codex CLI 0.155.0** by installing `@openai/codex` and running `--help`, plus
reading the shipped `x86_64-unknown-linux-musl` binary's strings. `codex review [OPTIONS] [PROMPT]`
is documented as *"Run a code review non-interactively"*, with `--base <BRANCH>`, `--commit <SHA>`,
`--uncommitted`, `--title <TITLE>` and an optional trailing prompt for custom instructions.

> **`--profile` does NOT work on `codex review`.** The binary contains a string listing
> `codex review` among the commands `--profile` applies to, but the argument parser rejects it:
> `codex review --profile foo --base main` → `error: unexpected argument '--profile' found`.
> `-p, --profile` exists on `codex exec` only. **Select a BYOK provider with `-c` instead**
> (`-c model_provider=<id>`, `-c model_providers.<id>.base_url=…`), which `codex review` does
> accept. This is the concrete reason the rest of this section distinguishes *executed* from *read
> out of the binary*: a string in the binary asserted a capability the binary does not have.

**Prioritisation is built into the reviewer rather than coaxed out of a prompt** — this is what
preserves the ranked-findings UX CodeRabbit and the native Codex reviewer provide, which is the
stated requirement for a replacement. Read out of the binary's own review instructions (**not
executed** — no model provider is reachable from an agent sandbox): a `[P0]`–`[P3]` tag is required
at the start of each finding title, the levels are defined (`P0` universal release blocker; `P1`
urgent, fix next; `P2` ordinary defect; `P3` low impact but worth fixing), findings are ordered by
severity, and the structured form is
`findings[] { title, body, confidence_score, priority <int 0-3>, code_location { absolute_file_path, line_range { start, end } } }`
plus `overall_correctness`, `overall_explanation` and `overall_confidence_score`. `code_location`
carries file and line range, so true inline comments remain an available upgrade.

**Two competing output contracts exist in the binary, and which one `codex review` drives is
undetermined by string reading.** One block renders Markdown findings as `` `[P1] title` ``
followed by `path/to/file.rs:line` and says to emit the literal `No findings.` when nothing
qualifies, explicitly *"Do not invent a finding to fill the result."* Another ends
`OUTPUT FORMAT: ## Output schema MUST MATCH *exactly*` and *"**Do not** wrap the JSON in markdown
fences or extra prose."* `codex review` has no `--json` and no `--output-schema` (both exist on
`codex exec`; neither exists on `review`), so the implementing change **must run it once against a
real provider and record which contract it actually emits** before deciding how to post the result.

Two consequences follow, and neither may be assumed:

- **Do not plan on piping stdout verbatim into a comment.** Even if the Markdown contract wins,
  posting model output unmodified is filed as a defect in the carried-forward list below —
  uncapped against GitHub's 65536-character limit, and `@`-mentions or `owner/repo#N` strings in
  quoted diff hunks reach GitHub's notification machinery through the repo's bot. Verbatim posting
  is a thing to fix, not a shortcut this decision grants.
- **Do not treat `No findings.` as a liveness signal.** It is an instruction addressed to a model
  this amendment simultaneously records as unverified. A model that returns an empty string, a JSON
  blob, or a chatty preamble is indistinguishable from a clean review, so the implementation owes an
  explicit liveness check — a non-empty-output assertion and an exit-code check at minimum, plus the
  `routine-state` alert-issue pattern every other non-required workflow here uses. Absence of output
  must be treated as failure **by machinery**, not by assumption.

### The governing-docs injection channel is in the harness, not the prompt

The #2396 spike recorded this as a property of its own prompt — that the prompt named `AGENTS.md`
and the ADRs as authoritative, so a PR could rewrite its own reviewing instructions. **That
diagnosis is incomplete, and the correction matters:** `codex review` reads project instruction
files **natively**. Its built-in instructions direct it to *"use the root and scoped project
instruction files applicable to changed files, respecting normal project-document precedence
(`AGENTS.override.md`, `AGENTS.md`, then configured fallback filenames)"*.

So moving to `codex review` does not remove the channel — it hardcodes it, and no prompt wording
closes it. It must be closed structurally, by controlling the tree the reviewer reads.

**Mitigation (decided): purge every agent-instruction file from the checkout, then restore only the
ones that exist at the base ref.** Restoring is not enough on its own, and the obvious one-liner is
wrong in four separate ways — all four were reproduced in a throwaway repository:

1. `git checkout <base_sha> -- AGENTS.md '**/AGENTS.md'` **restores nothing and exits 1** when the
   `**/AGENTS.md` pathspec matches no file, because `git checkout -- <pathspec>` is all-or-nothing:
   one non-matching pathspec aborts the whole restore, including the root file that *did* match.
2. Restoring cannot remove a file the PR **added**. `AGENTS.override.md` outranks `AGENTS.md` in the
   precedence chain quoted above, so a PR that adds one keeps top-precedence control of the reviewer
   even after a successful restore. A newly added nested file (`apps/api/AGENTS.md`) survives too.
3. `git ls-tree` does **not** support glob pathspecs and rejects `:(glob)` magic, so enumerating the
   base ref's instruction files with a glob silently yields nothing.
4. Under `set -euo pipefail` a `grep` that matches nothing exits 1 and kills the pipeline.

This form was executed against all of the above and behaves correctly, including the fail-closed
case where the base ref has no instruction files at all:

```sh
git ls-files -z -- '*AGENTS.md' '*AGENTS.override.md' | xargs -0r rm -f
git ls-tree -r --name-only "$BASE_SHA" \
  | { grep -E '(^|/)AGENTS(\.override)?\.md$' || true; } \
  | tr '\n' '\0' | xargs -0r git checkout "$BASE_SHA" --
```

It does not cover the *"configured fallback filenames"* the precedence quote names; the implementing
change should pin those explicitly in Codex config rather than trusting the default set. The
accepted cost is that a legitimate instruction-file change is reviewed against the base ref's rules;
the local `/diff-review` gate still covers that diff, and the CI reviewer is advisory regardless.

Checkout must use `head.sha`, never `refs/pull/N/merge`: GitHub only maintains the merge ref while
the PR is mergeable, so a conflicted PR hard-fails checkout, and merge-ref lag can hand the reviewer
a tree one push behind the diff it was told to review.

### Model and provider: UNVERIFIED, deliberately not settled here

BYOK is supported by the CLI — the binary carries `model_providers`, `base_url`, `env_key`,
`wire_api` and `requires_openai_auth`, and rejects overriding built-in provider IDs (*"Built-in
providers cannot be overridden. Rename your custom provider"*). There is **no** built-in
`openrouter` preset, so the provider must be declared explicitly, and selected with `-c` rather than
`--profile` (above).

The intended model (`muse-spark-1.3` via OpenRouter) and the `/v1/responses` endpoint are recorded
as **unverified**. Both `openrouter.ai` and `api.openai.com` are egress-blocked from the authoring
sandboxes (`403` on CONNECT), so the slug, the endpoint, the `wire_api` that provider actually
speaks, and the per-PR cost are unconfirmed by the vendor — they come from search indexes. This
amendment therefore commits to the **harness**, not to the model. **No cost ceiling has been set.**
A wrong slug fails the workflow silently, and the value of `codex review` depends entirely on a
model that honours a strict output contract, so the implementing change must smoke-test the provider
against a real key — and record which of the two output contracts it emits — before the reviewer is
relied upon.

### Open issues carried forward from #2396

PR [#2396](https://github.com/pdcarlson/Frapp/pull/2396) is closed as a parked spike; its research
is preserved here. Several items below are specific to the action-based shape being abandoned.
**This list is a record, not a backlog** — per `AGENTS.md` § Tech debt protocol the tracker is the
only debt list, and the implementation issue is where these belong when that work is filed.

- No `timeout-minutes` on an unbounded agent job. Most workflows under
  [`.github/workflows/`](../../../.github/workflows/) set one; GitHub's default is 360 minutes.
- No path gate, though a substantial share of recent PRs are docs-only — four of five scheduled
  routines produce docs-only PRs by design ([`ROUTINES.md`](../../../docs/internal/ci-cd/ROUTINES.md)).
  The spike quoted "~22%", but recorded no sample window or definition of docs-only, so the figure
  is unsourced and should be re-derived rather than cited.
- Comment body uncapped against GitHub's 65536-character limit, with model output embedded verbatim,
  so `@`-mentions and `owner/repo#N` cross-references reach GitHub's notification machinery through
  the repo's bot.
- `updateComment` edits in place and GitHub sends no notification for an edit, so a finding on a
  later push can land silently.
- A hand-rolled comment upsert instead of the tested `upsertWakeComment` in
  [`scripts/ci/ci-wake.mjs`](../../../scripts/ci/ci-wake.mjs); it also introduced
  `actions/github-script@v7`, used nowhere else here. Note `issues: write` — not
  `pull-requests: write` — is the load-bearing permission for posting PR comments, measured against
  [`pr-base-sync.yml`](../../../.github/workflows/pr-base-sync.yml).
- `git log --oneline A...B` is the symmetric difference and lists base-branch commits as the change
  under review; the `git diff` above it was correctly three-dot, which is what hid the bug.
- No failure signal: skips were silent and an empty final message posted nothing, so a dead reviewer
  and a clean review were indistinguishable. See the liveness requirement above.
- `openai/codex-action@v1` is a mutable tag in the only job holding a billing credential. Moot if
  the action is dropped; the related gap — [`.github/dependabot.yml`](../../../.github/dependabot.yml)
  declares only `package-ecosystem: npm` and never updates pinned actions — is **already tracked as
  [#1540](https://github.com/pdcarlson/Frapp/issues/1540)** and must not be re-filed.
- [`AGENT_INFRA.md`](../../../docs/internal/ci-cd/AGENT_INFRA.md)'s workflow roster will need a row,
  and [`AI_CODE_REVIEW_RUNBOOK.md`](../../../docs/internal/ci-cd/AI_CODE_REVIEW_RUNBOOK.md) an
  advisory-CI-review section, **when the workflow lands**. Neither was stale when this was written:
  both described the live pre-push gate accurately, and the runbook's 2026-09-08 CodeRabbit paragraph
  was still true then. A *decision* to retire CodeRabbit was not a state change; those docs went stale
  when the App was uninstalled, not when this amendment was written. **Both were done 2026-09-18** —
  the workflow landed and the App was uninstalled the same day, so the row, the section and the
  CodeRabbit paragraph are all current as of the implementation amendment.

### Alternative not priced: paying for the native Codex reviewer

`chatgpt-codex-connector[bot]` is **already installed on this repository and is merely out of
quota** — it commented on [#2395](https://github.com/pdcarlson/Frapp/pull/2395) at
2026-09-18T18:29:49Z: *"You have reached your Codex usage limits for code reviews … you can upgrade
your account or add credits to your account and enable them for code reviews in your settings."*
That path needs no workflow, no key, no wrapper, and keeps the vendor-tuned product and its true
inline comments — and it is what trigger 3 above means by "restore a managed Code Review service".
It remains **unpriced**: pricing sits behind a dashboard unreachable from an agent sandbox, so it
needs the owner. If the BYOK smoke test fails, or its running cost exceeds the credits path, this is
the alternative to revisit first.

### Triggers to revisit, as amended 2026-09-18

These replace the three-item list above for anything concerning CI review; that list's wording
predates CodeRabbit's retirement.

- The BYOK smoke test fails, or `codex review` proves not to honour a usable output contract under a
  BYOK provider → fall back to pricing the native Codex reviewer (above).
- Running BYOK cost exceeds the credits path, once both are known → switch to the managed service.
- External human (non-agent) contributors are added, or PRs start landing without the local gate →
  reintroduce a **blocking** server-side review, under the 2026-06-04 constraints, which this
  amendment does not relax.
- `/code-review` becomes unconditionally agent-invocable → retire `/diff-review` per the original
  trigger 2, unchanged.

## Amendment — 2026-09-18 (implementation): the reviewer is built, and the output contract is settled

The 2026-09-18 decision amendment above is now implemented:
[`.github/workflows/codex-review.yml`](../../../.github/workflows/codex-review.yml) installs
`@openai/codex@0.155.0` and calls `codex review`;
[`scripts/ci/codex-review.mjs`](../../../scripts/ci/codex-review.mjs) posts the result through the
tested `upsertWakeComment` and raises a `routine-state` alert when the reviewer does not work.
It is advisory: absent from [`required-checks.mjs`](../../../scripts/ci/lib/required-checks.mjs),
plain issue comments only, and green even when the reviewer fails.

**CodeRabbit is retired, executed 2026-09-18.** The owner uninstalled the App and `.coderabbit.yaml`
was deleted in this change, in that order. The interlock was real up to that point and is worth keeping
as a record rather than a rule: deleting the config while the App was installed would have dropped
CodeRabbit to unconfigured defaults, where `request_changes_workflow` is ON, posting a write-access
`CHANGES_REQUESTED` that blocks squash on green checks and that no agent can clear (`GITHUB_PAT` 401,
no MCP dismiss tool, an author cannot self-approve). Measured on
[#1875](https://github.com/pdcarlson/Frapp/pull/1875).

An earlier revision of this amendment recorded the App as still installed, citing a
`coderabbitai[bot]` walkthrough on [#2395](https://github.com/pdcarlson/Frapp/pull/2395) at
2026-09-18T18:30:00Z. That observation was real but **pre-dated the uninstall** by a few hours, which
is the trap worth naming: a bot comment is evidence of the installation state *at the time it was
posted*, and on an OSS tier rate-limited to one review an hour, the absence of newer comments is not
evidence either way. Neither direction can be inferred from comment history — only the installations
page settles it, and only the owner can read it.

### The sandbox egress block was not the obstacle it looked like

Every earlier session recorded the output contract as unknowable because `openrouter.ai` and
`api.openai.com` are egress-blocked. **`127.0.0.1` is not.** A ~30-line Node stub speaking the
Responses API (SSE: `response.created` → `output_text.delta` → `response.completed`) was enough to
drive `codex review` end to end, offline, and every claim in this section was **executed** against
it on CLI 0.155.0. This is the technique to reuse for any future Codex-CLI question; it does not need
a key, a vendor, or egress.

**BYOK is real, and nothing forces OpenAI auth.** A custom provider id, a custom `base_url` over
plain HTTP, a custom `env_key` and a non-OpenAI model slug produced a complete review turn at
exit 0, with the CLI reporting `provider: orx`. That was the open question and the answer is yes.

### `codex review` renders the JSON itself — post its stdout, do not parse JSON

Both contracts are in the binary, and the decision amendment could not say which one `review`
drives. It drives **the strict-JSON one, and then renders it for you**:

- The schema is sent in the **system prompt**, and the request's `text.format` is **null** — so the
  contract is **prompt-enforced, never API-enforced**. No `response_format`, no `json_schema`.
- The CLI parses the model's JSON and writes **Markdown to stdout**: `overall_explanation`, then
  `Review comment:` (one finding) or `Full review comments:` (two or more), then one
  `- [P<n>] <title> — <absolute_file_path>:<start>-<end>` bullet per finding with the body indented
  beneath. The section header's wording differs between the singular and plural cases, so
  `codex-review.mjs` keys on the **bullet**, not the header.
- **stdout is the payload; the banner, warnings and turn transcript go to stderr.** So
  `codex review 2>/dev/null` is the review, and the "two competing output contracts" problem
  dissolves: neither "post stdout verbatim" nor "parse the JSON" was the right design.
- The `No findings.` Markdown contract in the binary is **not** what `review` emits. A clean review
  renders `overall_explanation` alone.

**The `@`-mention defect is confirmed, not theoretical.** A finding body containing `@octocat` and
`owner/repo#42` came through the renderer completely untouched, so posting stdout unmodified really
would reach GitHub's notification machinery through the repo's bot. `sanitizeMentions` breaks `@name`,
`#123` and `GH-123` with an empty HTML comment, and deliberately leaves fenced blocks and inline code
spans byte-identical so `suggestion` blocks stay copy-pasteable.

### Why liveness needed more than "non-empty output"

The decision amendment asked for an exit-code check and a non-empty-output assertion. Executed
behaviour shows those are **necessary but not sufficient**:

| Case | stdout | exit |
|---|---|---|
| Valid JSON, findings | rendered bullets | 0 |
| Valid JSON, no findings | the model's `overall_explanation`, alone — arbitrary prose, NOT a fixed string | 0 |
| **Model ignores the schema** | **its raw prose, verbatim** | **0** |
| Provider env key missing | `ERROR: Missing environment variable` (stderr) | **1** |
| Reserved built-in provider id, or unknown key under `--strict-config` | config error (stderr) | **1** |
| Bad CLI argument (e.g. a PR title starting with `-`) | clap arg error (stderr) | 2 |
| Unreachable `base_url` | **hangs — it retries rather than failing** | — |

Row 2 and row 3 are **byte-indistinguishable**: both are short prose at exit 0. So a clean review and
a model that ignored the contract cannot be told apart from stdout, and no amount of output-shape
checking fixes it. `codex-review.mjs` recovers the **raw pre-render model message** from the session
rollout (`CODEX_HOME/sessions/**/rollout-*.jsonl`, the `event_msg` whose `payload.type` is
`agent_message`) and validates it against the schema. That path is Codex-internal, so an unreadable
rollout yields a tri-state `null` — "no claim" — which is reported as `clean-unverified` and
**does not** raise an alert. Failing to read a rollout must never manufacture a failure, and rendered
findings are never downgraded by it.

The hanging row is why the CLI call is wrapped in `timeout 900`; `124` classifies as a failure.

**Correction, same day: the missing-key exit code is 1, not 101.** An earlier revision of this
amendment recorded 101, in five places. That number was an artifact of the probe rather than the CLI —
the command was piped into `head`, which closed stdout and aborted the process. Re-measured directly
with the key unset, the key empty, and with and without `--strict-config`: it is **1** every time.
The consequence is design-relevant, not cosmetic: **a missing credential and a config error are the
same exit code**, so neither the alert nor the runbook can route an operator by code alone.
`scripts/ci/codex-review.mjs` therefore classifies stderr (`Missing environment variable` vs
`Error loading config.toml`) and emits a distinct `missing-credential` / `config-error` verdict. This
is exactly the provenance trap the rest of this section is written to avoid, caught by review on the
implementing branch.

### Corrections to the decision amendment

- **The model slug was wrong.** `muse-spark-1.3` is not an OpenRouter id — the vendor prefix is part
  of it: **`meta/muse-spark-1.3`**. This is precisely the "a wrong slug fails the workflow silently"
  risk the decision named. Still not vendor-verified (`openrouter.ai` remains egress-blocked); it
  comes from a search index, as do the sibling `meta/muse-spark-1.3-contributor` and the 1.1/1.2
  versions.
- **`--model` is rejected too, not just `--profile`.** `codex review --model foo` →
  `error: unexpected argument '--model' found`. The model is selected with `-c model=…`, the provider
  with `-c model_provider=…`. There is no `-C`/`--cd` either: `review` works on the cwd.
- **`wire_api = "chat"` was removed in 0.155.0** — `` `wire_api = "chat"` is no longer supported ``,
  with the fix named as `responses`. So BYOK here **hard-requires** the Responses API. OpenRouter
  exposes `POST /v1/responses` at `https://openrouter.ai/api/v1` but documents it as **beta** (search
  index, not the vendor). **There is no wire-protocol fallback** if that endpoint misbehaves — this is
  now the single largest remaining risk, and it is the thing the smoke test is really testing.
- **`CODEX_HOME` is not created on demand.** A non-existent path fails with
  `Error finding codex home`, so the workflow `mkdir -p`s it.
- **`project_doc_fallback_filenames` is the key** that closes the half of the injection channel the
  purge cannot: the precedence chain's *"configured fallback filenames"* tail. Set to `[]`, with
  `--strict-config` so a renamed key fails loudly instead of failing open. The full production
  config was executed under `--strict-config` and loads clean.
- **A non-OpenAI slug always warns**: ``warning: Model metadata for `<slug>` not found. Defaulting to
  fallback metadata; this can degrade performance and cause issues.`` It is a warning, not a failure,
  and it fires for `gpt-5` too under a custom provider — so it indicates the BYOK path, **not** a bad
  slug, and must not be used as slug validation. The workflow prints stderr so it is visible.
- **The reviewer's own confirmation**: its instructions do tell it to *"use the root and scoped
  project instruction files applicable to changed files, respecting normal project-document precedence
  (`AGENTS.override.md`, `AGENTS.md`, then configured fallback filenames)"* — read out of the live
  request this session, which settles the injection analysis as fact rather than inference. The purge
  restores from the **merge base**, not the base tip, which is what keeps it diff-neutral: restored
  content matches what `codex review` diffs against, so instruction files simply do not appear in the
  review.

### The docs-only figure, re-derived

The spike's unsourced "~22%" **does not reproduce**. Measured 2026-09-18 over `origin/main`, where
docs-only means every changed path matches `*.md`, `*.mdx`, `docs/**` or `spec/**`:

- last 100 commits (2026-09-09 .. 2026-09-18): **12.0%**
- last 250 commits (2026-09-06 .. 2026-09-18): **8.8%**

So the path gate is worth having but is **not** a major cost lever, and no cost model should lean on
it. **A cost ceiling is still unset** — the budget question was answered with a model name, and
per-PR cost stays unknown while `openrouter.ai` is unreachable.

### Defects the implementing review caught, and what they generalise to

These were found by the pre-push review on the implementing branch and fixed there. They are recorded
because most are properties of `codex review` rather than of this repo's code, so anyone rebuilding
this will meet them again.

- **`--base` must be the remote-tracking ref.** `actions/checkout` with `ref: <sha>` leaves a detached
  HEAD and creates no local branch, so `main` does not resolve — and `codex review` does **not** fail
  when it cannot resolve the base. It silently falls back to a prompt asking the *model* to find the
  merge base via `main@{upstream}`, which does not resolve either. Executed against a replica of the
  runner's checkout: `--base main` sent **no merge-base SHA** and still exited 0, while
  `--base origin/main` sent the correct one. **This is the single highest-impact trap in the whole
  design** — the bare form is a green check over a review of nothing, on every PR, forever.
- **`--title` needs the `=` form.** The PR title is author-controlled and clap parses a leading `-` as
  a flag: `--title "-x fix"` exits **2** before the review starts (executed). On a public repo that
  turns a PR title into a public "the reviewer is broken" alert issue. `--title="$PR_TITLE"` fixes it.
- **`set -uo pipefail` does not disable errexit.** Actions runs the script as `bash -e {0}`, so `-e` is
  inherited; a step that means to be lenient must say `set +e` explicitly. Otherwise a failure before
  the `exit_code` write makes a failed reviewer indistinguishable from one that never ran.
- **A fence inside a finding body is indented.** `codex review` indents each body two spaces, so a
  column-anchored fence regex does not match and a sanitiser rewrites the contents of the
  ```suggestion block GitHub offers a copy button for. The bound matters in both directions: at 4+
  spaces GitHub sees an indented code block rather than a fence, so a tracker that toggles on any
  indent believes it is inside code while GitHub believes it is in prose — and the paragraph after it
  ships a live `@mention`. Closing also requires the **same** fence character and at least the
  opener's length.
- **Model output reaches GitHub through paths Actions does not mask.** Secret masking covers logs, not
  REST bodies. A credential-bearing agent whose stdout is republished to a public comment and a public
  issue needs redaction at the publishing boundary, and the `shell_environment_policy` that keeps the
  key out of the agent's environment should be pinned rather than inherited from an upstream default.
- **The alert's own sample can break its own fence.** Wrapping untrusted output in ``` lets any fence
  inside it terminate the wrapper, after which the remainder renders as live Markdown — reopening the
  notification defect on the alert path. The opener has to outgrow the longest run inside.
- **Posting the review wakes an agent.** `upsertWakeComment` deletes-then-creates precisely so GitHub
  delivers `action=created`, which is what the PR-babysitting sessions listen for. So the reviewer's
  output — model text quoting the PR's own head code — arrives at a session holding push access, from
  the repo's own trusted bot. This amendment's injection analysis closes what steers *the reviewer*;
  it never asked what the reviewer's output steers. The comment now wraps the review in an explicit
  untrusted-data delimiter naming the reviewed SHA. **Generalisation: any advisory bot that posts into
  a channel agents read is an injection path, not just an output.**
- **A boolean contract check hid real findings.** Recording only "schema-valid: yes/no" lost the
  finding *count*, so schema-valid findings that the renderer's bullet form did not match were
  reported as "clean" — with the literally false reason "schema-valid JSON with no findings" — and real
  P0s were dropped behind a green check. The count is now compared against what rendered, and a
  mismatch alerts.
- **`Number("")` is 0.** An exit code arriving empty because the step died must never coerce to
  success. It is parsed explicitly and classified as `reviewer-did-not-run`.
- **"Could not tell" must not clear an alert.** Resolving the alert on `clean-unverified` meant the one
  failure that blinds the detector (a changed rollout layout, a new CLI pin) would also close the
  standing alert and post "Recovered" on every run, forever.

### What the first live runs against OpenRouter established

The harness was proven against a stub; these are from the real provider, on PR #2405.

- **`POST https://openrouter.ai/api/v1/responses` accepts Codex's payload.** This was the largest
  open risk, because `wire_api = "chat"` was removed in 0.155.0 and there is no fallback. Both
  failures below are *semantic* refusals from the provider — a policy 404 and a cost 402 — reached
  after the request was parsed and routed to a model. The beta endpoint does not choke on the
  OpenAI-specific parameters the CLI always sends (`include: ["reasoning.encrypted_content"]`,
  `reasoning`, `prompt_cache_key`, `client_metadata`). **The endpoint risk is retired.**
- **Account data policy can exclude every endpoint for a model.** Verbatim: *"0 endpoints out of 1
  requested are available matching your guardrail restrictions and data policy … ZDR violation
  (account settings)"*. Note **"out of 1 requested"** — the slug matched an endpoint and policy then
  removed it, which is what distinguishes this from a wrong slug (zero matches). Verdict
  `provider-policy-blocked`. A more data-sharing model tier is **not** the remedy for a ZDR
  exclusion; it is likelier to be excluded for the same reason.
- **The `Model metadata not found` warning is not cosmetic, and an earlier revision of this amendment
  was wrong to imply it was.** No metadata for a BYOK slug means Codex falls back to defaults that
  reserve the model's full output width — **65536 tokens**, observed. Providers check affordability
  against that *reservation* before generating anything, so a metered key whose remaining limit is
  below it refuses every request: *"You requested up to 65536 tokens, but can only afford 9411."*
  Verdict `insufficient-credits`. Two consequences worth stating plainly:
  - **A key limit sized to expected spend does not work.** It must clear the reservation, which is
    far larger. Raising it does not raise what a review costs — a reservation is not a charge.
  - **The reservation cannot be capped from the `codex review` side.** `max_output_tokens` exists in
    the binary but is not a settable top-level config key in 0.155.0 (probed under
    `--strict-config`); `model_context_window` and `model_auto_compact_token_limit` are accepted but
    govern input context, not the output reservation.

Both were classified as a generic `reviewer-failed` telling the operator to read stderr until each
got its own signature. Their test fixtures are the real stderr, verbatim.

### Still not verified, and still needing the owner

- The smoke test itself: one real `codex review` against `meta/muse-spark-1.3` through OpenRouter's
  beta Responses endpoint, confirming a schema-honouring reply. Everything above is executed against
  a stub, which proves the **harness** and proves nothing about the **model**.
- Per-PR cost, and a ceiling to size against it.
- The credits path for the native Codex reviewer, still dashboard-only and still the first
  alternative if the smoke test fails (unchanged trigger).
- ~~The CodeRabbit App uninstall, which must precede deleting `.coderabbit.yaml`.~~ **Done 2026-09-18** — the App is uninstalled and the config is deleted.
