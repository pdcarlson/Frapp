### ADR-14: Code review — CodeRabbit → self-hosted Claude review GitHub Action (2026-06-01)

**Decision (2026-06-01):** Replace CodeRabbit with a self-hosted automated PR review running `anthropics/claude-code-action@v1` in GitHub Actions, gated by a required `claude-review-gate` check.

**Removed 2026-09-05.** The Decision, Rationale, Consequences and the 2026-06-01 / 2026-06-03 amendments described the CI reviewer's machinery — the two model tiers, the gate job and its commit-status plumbing across two event shapes, the override label, the fork/draft/no-token special-casing. **Every artifact they describe was deleted on 2026-06-04** (see the amendment below), so the text was operating instructions for a workflow that does not exist. What the log is for is kept here rather than in that detail:

- **Why CodeRabbit was dropped:** on a private repo its free tier posts summary-only, rate-limited reviews; the assertive line-by-line config this repo wanted needed Pro at ~$24/dev/mo. Frapp already pays for Claude, so an OAuth-token Action added no per-token bill.
- **Alternatives rejected in the 2026-06-03 market scan**, none clearly better under the constraints (free or ≤$10/mo flat, ~100 private PR reviews/mo, CodeRabbit-like UX): CodeRabbit Pro (~$24–30/mo, over budget); Gemini Code Assist's free GitHub reviewer (free and on Google infra, but its free tier was reported sunsetting ~2026-07-17); Greptile and Cursor BugBot (per-PR pricing); Qodo/PR-Agent self-hosted (still spends Actions minutes plus per-token).
- **Why it was abandoned rather than tuned:** even reconfigured to Opus-once-on-open, it carried disproportionate machinery for a solo repo, and per-push review drained both metered Actions minutes and subscription quota. The measured driver was the imminent **Max-5× → Pro downgrade, ~80% less quota** — a plan change, so do not read "drained quota" as a property of the plan in force today.
- **Evidence that anyone rebuilding this will need, and that exists nowhere else in the tree.** The gate deliberately did **not** key on the action's exit code, because of two upstream defects: **`claude-code-action#1299`**, a permanent-red-required-check failure mode, and **`#846`**, spurious non-zero exits. The workaround was a `--json-schema` `structured_output`, with a `<!-- claude-review-verdict: important=N sha=<head_sha> -->` marker as **fallback**, and a separate gate job failing only on `important > 0`. That gate **always reported a conclusion** (so a required check never hung "pending") and passed for bot/draft/fork/no-token/skipped runs — and it is that always-reporting property, not anything upstream, that avoided both defects. Drop it when rebuilding and the required check hangs on any run where the action dies before emitting a verdict; the `sha=` was added by **#599** so a prior commit's verdict could not mask a failed run. A second trap: an `issue_comment`-triggered run's implicit check-run attaches to the **default-branch head**, not the PR head, so the gate had to post an explicit commit status to the resolved PR head SHA. And the purpose-built **`claude-code-security-review`** action was rejected as **API-key-only** — it cannot authenticate with the subscription OAuth token this repo holds, which is why the general `claude-code-action` carried a custom prompt instead.

The live rules are the 2026-08-01 amendment (local [`/diff-review`](../../../.claude/skills/diff-review/SKILL.md) gate) and the 2026-09-08 amendment (CodeRabbit comment-only). Runbook: `docs/internal/ci-cd/AI_CODE_REVIEW_RUNBOOK.md`.

- **Amendment (2026-06-04) — the CI Claude review is removed entirely; review moves to a local pre-push gate.** The GitHub Actions reviewer (`.github/workflows/claude-review.yml`), the `claude-review-gate` required check (and its `claude-review-gate-runner` job + `evaluate-review-gate.mjs` decision logic and tests), the `.github/claude-review/` rubric + learnings, and the `CLAUDE_CODE_OAUTH_TOKEN` dependency are **all deleted**. Even reconfigured to Opus-once-on-open, the CI reviewer was not working as designed and carried disproportionate machinery (gate status plumbing across two event shapes, the override label, fork/draft/no-token special-casing, branch-protection coupling). **Replacement:** a local Claude Code **PreToolUse hook** (`.claude/hooks/pre-push-review-gate.sh`, wired in `.claude/settings.json`) gates `git push` — the first push of each branch HEAD is blocked with guidance to run the built-in **`/code-review`** skill in-session on the diff; a HEAD-keyed, session-scoped sentinel makes it deny-once-then-allow (no loop), and a new HEAD (after committing fixes) re-gates so the review always covers what is pushed. This is now the **single** pre-PR review gate (the `/next` flow no longer runs `/code-review` as a separate step — the push hook drives it once). Review sub-agents inherit the session model (Opus): the `CLAUDE_CODE_SUBAGENT_MODEL` Sonnet pin is also removed from `.claude/settings.json`. **Trade-offs:** review now happens on the author's machine before the PR exists (no server-side enforcement on merge, and no inline GitHub review comments) — acceptable for a solo project where every PR is authored by an agent that runs the gate; and a PreToolUse hook can only *instruct* Claude to run `/code-review` (it cannot invoke a skill), so the gate reliably interrupts the first push per HEAD rather than hard-blocking. `claude-review-gate` is removed from `scripts/configure-branch-protection.mjs` and de-required via `npm run configure:branch-protection`. Runbook updated: `docs/internal/ci-cd/AI_CODE_REVIEW_RUNBOOK.md`.

- **Amendment (2026-07-30) — the gate is satisfied by `/diff-review`, a project skill.** ⚠️ **The premise stated in this amendment was measured wrong; see the 2026-08-01 amendment below for the corrected rule. The conclusion — keep `/diff-review` — still holds, for different reasons.** The 2026-06-04 amendment above assumed the hook could "instruct Claude to run `/code-review`". It cannot: `/code-review` is **author-locked against model invocation**. It has no file on disk — it is a native command compiled into the Claude Code binary with `disableModelInvocation` hardcoded at its registration site, and that lock resolves *before* user settings, clamping the skill to `user-invocable-only` at best. The sole escape hatch is the runtime `userTypedThisTurn` condition, so ~~only a human physically typing `/code-review` can run it~~ (**wrong — see below**); a `skillOverrides` entry is a verified no-op. In practice every agent session stalled at the gate waiting for a keystroke. **Replacement:** [`.claude/skills/diff-review/SKILL.md`](../../../.claude/skills/diff-review/SKILL.md) — a project skill that is model-invocable (it simply omits `disable-model-invocation`) and reproduces the bundled workflow: scope the diff, fan out parallel finder subagents per angle, run **one independent verifier subagent per candidate** (`CONFIRMED`/`PLAUSIBLE`/`REFUTED`), then report once via `ReportFindings`. It additionally encodes repo-specific invariants as first-class angles — `chapter_id` scoping and chapter-scoped role lookups (load-bearing given ADR-13's application-layer-only isolation: RLS is enabled with no permissive policies and the API holds the `service_role` key that bypasses it), permission decorators, the PGlite migration gate, the doc-sync mandate, Linear-not-GitHub, and verification honesty. **Corrected 2026-09-05:** two of those angles no longer describe the skill. The tracker angle now reads the other way — issues are opened **on GitHub** with the `triage` label (Linear was retired 2026-08-08, amendment 5 of ADR-16); and the "doc-sync mandate" angle went with the coercive gate in #1597, replaced by a docs angle that reads a diff against `DOCUMENTATION_CONVENTIONS.md`. The rest of the sentence stands. Deliberately **not** named `code-review` (precedence against a native command is untraced, and a silent shadowing failure would make the gate look satisfied while nothing ran) and deliberately **not** `context: fork` (which would move `ReportFindings` into a subagent where the host UI cannot render it). **Trade-offs:** the gate is now self-certifying — the same agent writes the code and triggers its review — so the per-candidate verifier pass is what keeps it honest and must not be weakened; and we no longer inherit upstream improvements to the bundled reviewer. Humans should still prefer `/code-review`, which is richer (cloud `ultra` mode, `--fix`, `--comment`).

- **Amendment (2026-08-01) — `/code-review` is *conditionally* model-invocable; the 2026-07-30 premise was wrong.** Measured against Claude Code **2.1.220** (`AI_AGENT=claude-code_2-1-220_agent`). `disableModelInvocation` is real, but the runtime check is `disableModelInvocation && !userTypedThisTurn`, and `userTypedThisTurn` is **not** a keystroke flag: it scans the current turn for a message that is `type: "user"`, not `isMeta`, and matches the bare token `/code-review`. So an agent **can** call `Skill(skill: "code-review")` when the turn's prompt carries that token **whitespace-delimited on both sides**. ⚠️ **Precision fix (2026-08-02):** this amendment originally said "whenever the turn's prompt mentions it in prose", which overstates reachability. The regex is `(?<!\S)/code-review(?=$|\s)`, so backticks, surrounding quotes, `**bold**`, and a trailing `.` or `,` all **defeat** it — and backticking commands is this repo's own house style. Re-measured against the running 2.1.220 build: a session referencing `/code-review` eight times, every occurrence backticked, was still refused with `disable-model-invocation`. The conclusion below is unchanged and in fact strengthened — `/code-review` is reachable *less* often than the 2026-08-01 text implied, so `/diff-review` carries more of the load, not less. It **cannot** when the token is absent or only present in a rejected form, inside a sub-agent, from a slash-command expansion (skipped via `<command-message>` — so **never under `/next`**), or from a hook (all hook `additionalContext`, on every event, renders `isMeta: true`, so a hook can neither invoke a skill nor enable one). **Evidence:** both directions executed in one session — token present → a full forked review ran; token absent → `Skill code-review cannot be used with Skill tool due to disable-model-invocation`. The scan rule, the `isMeta` renderer and the check ordering were read out of the 2.1.220 bundle, not merely inferred from those two observations. **Consequence:** `/diff-review` is retained, but as *the always-reachable review* rather than *the only one* — `/code-review` is now preferred wherever it is reachable. Its remaining unique value is the Frapp-specific angle set; its generic half duplicates a harness that is tuned per model upstream (tracked separately for a measure-then-cut decision). `skillOverrides` remains a verified no-op: `disableModelInvocation` returns before that branch is reached. Version-pinning is not an escape either — the command did not exist in 2.1.42 (whose `pluginCommand: "code-review"` registers `/review`), and 2.1.220 was the latest published release at the time of writing.

- **Amendment (2026-09-08) — CodeRabbit is live again on the public repo; it must not block squash.** ADR-13's 2026-09-05 correction already noted that the private-repo reason for dropping CodeRabbit had lapsed. CodeRabbit's GitHub App is installed and Organization UI is ASSERTIVE with request-changes on, so a finding is a real `CHANGES_REQUESTED` review. A write-access reviewer in that state trips the merge ruleset (`1 review requesting changes by reviewers with write access`) even when required checks are green — measured on [#1875](https://github.com/pdcarlson/Frapp/pull/1875). Agents cannot dismiss that review (`GITHUB_PAT` 401; GitHub MCP has no dismiss tool; the PR author cannot approve their own PR). **Repo pin:** `.coderabbit.yaml` (**deleted 2026-09-18** — link removed, see the amendment at the foot of this file) set `reviews.request_changes_workflow: false` (comment-only, never `CHANGES_REQUESTED` / `APPROVED`) and `reviews.auto_review.drafts: false` so drafts did not consume the OSS 1-review/hour slot. The local `/diff-review` gate is still the merge-quality gate; CodeRabbit is advisory comments only. This does not reintroduce a required CI review check.

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

## Amendment — 2026-09-18: CodeRabbit removed; advisory BYOK Codex review on GitHub Actions

**Decision:** CodeRabbit is retired entirely (`.coderabbit.yaml` deleted, GitHub App uninstalled) and
replaced by [`.github/workflows/codex-review.yml`](../../../.github/workflows/codex-review.yml) —
`openai/codex-action@v1` reviewing each ready PR and posting **one advisory comment**. The local
`.githooks/pre-push` + `/diff-review` path remains the merge-quality gate; this adds no required check.

**Why this does not re-litigate the 2026-06-04 removal.** That amendment deleted the CI reviewer for
three reasons. Each was re-checked, and none survives against *this* design:

- *Metered Actions minutes.* **Lapsed.** The repo is public; ADR-13's 2026-09-05 correction records
  Actions minutes as unmetered. The compute is free.
- *Drained subscription quota.* **Sidestepped.** BYOK bills an OpenRouter account per token, not a
  ChatGPT/Codex plan. ADR-14 already warned not to read "drained quota" as a property of the plan in
  force; under BYOK the coupling does not exist at all. The measured driver was the Max-5× → Pro
  downgrade, which BYOK routes around rather than depends on.
- *Disproportionate machinery.* **Not reintroduced.** The machinery that amendment enumerated —
  the `claude-review-gate` required check, commit-status plumbing across two event shapes, the
  always-reports-a-conclusion property, the `sha=` verdict marker, the override label,
  branch-protection coupling — existed to make a review *block a merge*. Nothing here blocks: a
  failed or skipped run costs a missing comment. The two upstream defects that gate worked around
  (`claude-code-action#1299`, `#846`) are therefore not reachable, because no required check
  can hang when none exists.

**Why CodeRabbit went rather than staying as a free backstop.** Its OSS tier is free but rate-limited,
and the 2026-09-08 amendment's pin was load-bearing in a fragile way: Organization UI is ASSERTIVE
with request-changes on, so `.coderabbit.yaml` was the *only* thing preventing a write-access
`CHANGES_REQUESTED` that trips the merge ruleset (measured on
[#1875](https://github.com/pdcarlson/Frapp/pull/1875)) and that agents cannot dismiss. **Deleting the
file alone would have re-armed that failure, not disarmed it** — so the App had to be uninstalled,
and the uninstall must land *before or with* the file deletion. Ordering recorded here because the
reverse order is a live merge outage.

**Model routing — the non-obvious part.** The model is Meta's **Muse Spark 1.3**, reached **through
OpenRouter**, and the indirection is mandatory rather than preference. Codex speaks only the
Responses API: `wire_api = "chat"` was deprecated in December 2025 and removed in early February
2026. Meta's Model API serves Muse Spark at `/v1/chat/completions`, so a direct Meta `base_url`
fails at config load. OpenRouter implements `/v1/responses`, which is what makes the model reachable
from Codex at all. Implemented with the action's `responses-api-endpoint` override rather than a
`codex-home/config.toml` provider block — fewer moving parts, and the action's proxy forwards the
supplied key as `Authorization: Bearer` upstream, so the input named `openai-api-key` legitimately
carries an OpenRouter key. `CODEX_REVIEW_MODEL` (repository variable) overrides the slug without a
code change; note OpenRouter also lists a discounted `-contributor` variant with different
data-sharing terms.

**The harness is a full agent loop, and the prompt is written accordingly.** `openai/codex-action`
runs `codex exec`, which is the same agentic loop as the interactive CLI — shell execution, file
reads, iterative exploration — streaming progress to stderr and the final agent message to stdout
(that message becomes `final-message` and is what gets posted). The `permission-profile` and
`safety-strategy` inputs exist precisely because it executes commands. Two things follow, and both
are load-bearing:

- The prompt **delegates rather than dictates**. An exhaustive angle checklist is a ceiling for an
  agent that can read the tree; the repo's invariants are given as a floor to exceed, and the agent
  is pointed at `AGENTS.md` (which Codex reads natively), the ADRs and `spec/engineering.md` to
  consult for itself. An earlier draft enumerated fixed review angles — that shape suits a
  single-shot completion and wastes this harness.
- Checkout is `fetch-depth: 0`. The default shallow clone leaves `git log`, `git blame` and a real
  merge-base unavailable, so instructing the agent to trace history would fail *silently* — it
  would report on what it could see and look successful.

**Consequences.**

- First recurring per-token cost for review (previously $0). Cap it on the OpenRouter side; there is
  no spend guard in the workflow.
- Fork and Dependabot PRs are **silently skipped** — GitHub withholds secrets from both, and
  `pull_request_target` is rejected as it would expose the key to untrusted fork code. Fork PRs are a
  live case on a public repo, not hypothetical.
- PR title and body are attacker-controlled on a public repo. They are passed via the environment
  into a fenced, explicitly-untrusted block, never interpolated as `${{ }}` into a shell or prompt
  string. The upstream example workflow does interpolate them directly; that shape was deliberately
  not copied.
- **The fence delimiter is a per-run nonce, and that is load-bearing.** A static marker was built
  first and *measured escapable*: a PR body containing the literal `----- END UNTRUSTED PR BODY -----`
  closed the block early, so text after it rendered as trusted context. Sixteen random bytes from
  `/dev/urandom` are embedded in the BEGIN/END markers and quoted back to the model as the run's
  token. Anyone simplifying this back to a fixed string reopens the escape — the shell-injection
  defense (`printf` on an env var) never covered it, because this is a prompt-level break, not a
  shell-level one.
- One comment per PR, edited in place on each push rather than appended, so a `synchronize`-heavy PR
  does not bury its own thread.

**Trigger to revisit:**

- Per-token spend exceeds what the review is worth → drop to a cheaper slug via `CODEX_REVIEW_MODEL`,
  or restrict the trigger to `opened` + `ready_for_review` only.
- Muse Spark review quality proves worse than a native Codex model through the same harness → switch
  the slug; the endpoint override stays valid for any OpenRouter-served model.
- Meta's Model API ships a `/v1/responses` endpoint → the OpenRouter hop can be removed and the
  action pointed at Meta directly.
- External human contributors start opening fork PRs → the silent skip becomes a coverage hole;
  revisit with a `workflow_run`-triggered job that never checks out fork code alongside the key.
