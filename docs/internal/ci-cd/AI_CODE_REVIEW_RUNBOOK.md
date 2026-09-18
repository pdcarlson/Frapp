# AI Code Review Runbook

> **The CI Claude review was removed (2026-06-04, ADR-14 amendment).** There is no longer a
> `claude-review.yml` workflow, a `claude-review-gate` required check, a `CLAUDE_CODE_OAUTH_TOKEN`
> secret, or a `.github/claude-review/` rubric. The **merge-quality gate** happens **locally, before
> the push** — that is what this runbook documents.
>
> **Update (2026-09-18) — PROPOSED, NOT YET IN FORCE. Do not operate from this section yet.**
> **CodeRabbit is being retired by owner decision — assume none going forward.** What remains open is
> the replacement: the harness below is under reconsideration, because Codex ships a purpose-built
> `codex review` subcommand that `openai/codex-action` cannot reach, and this repo's own Codex
> reviewer is already installed and merely out of quota. See § Open issues in ADR-14's 2026-09-18
> amendment before acting. The description that follows is a proposal, not the live state.
>
> a CI reviewer exists again, but it is **advisory and blocks nothing** —
> [`.github/workflows/codex-review.yml`](../../../.github/workflows/codex-review.yml), Muse Spark 1.3
> via OpenRouter, posting one PR comment. It is deliberately **not** a required check and is absent
> from `scripts/ci/lib/required-checks.mjs`. It replaces CodeRabbit, which was removed the same day.
> A red or missing Codex comment never blocks a merge; the local gate below still does the gating.
> See § Advisory CI review.

## What runs now

Review is a **repository-managed Git `pre-push` gate**, not a CI job or an agent-provider hook.
[`.githooks/pre-push`](../../../.githooks/pre-push) is enabled by the root `prepare` script through
[`scripts/setup-git-hooks.mjs`](../../../scripts/setup-git-hooks.mjs), alongside the existing secret
scan. Once installed, the same Git hook runs for local Codex, cloud agents, and humans.

Git gives the hook every proposed ref update. Each non-deletion update must have evidence at
`.cache/diff-review/<PUSHED_COMMIT_SHA>`; annotated tags are peeled to their commit. This is stronger
than checking the currently checked-out HEAD: explicit refspecs and multi-ref pushes cannot borrow a
marker from another commit. `/diff-review` writes the marker for the reviewed HEAD. Address every
finding, commit any fixes, review the new commit, then push.

**Why not Codex project hooks?** Verified against the installed Codex CLI 0.144.0-alpha.4 on
2026-09-16: `PreToolUse` hooks can block Codex-issued shell commands when they return a valid block
response, but they are tool-level (not Git- or human-level), trust can be bypassed, and the available
hook configuration exposes no fail-closed-on-crash/timeout guarantee. Claude and Cursor hooks have
the same provider-specific coverage problem. The Git hook therefore owns enforcement; provider
configs no longer duplicate it.

This is consistent default-path enforcement, **not an unconditional server-side gate**. Git aborts a
push when an installed `pre-push` hook exits nonzero, but a user can deliberately use
`git push --no-verify`, change `core.hooksPath`, or skip installation. There is no attempt-count
release: retrying a denied push can never create evidence. Cursor built-ins (`/review`, Bugbot) are
not canonical and do not write the marker.

### Which review skill

Two skills satisfy this gate, and the difference matters:

| Skill | Who can run it | Notes |
|---|---|---|
| [**`/diff-review`**](../../../.claude/skills/diff-review/SKILL.md) | **agent or human, always** | The project's own skill. An agent runs it unprompted when the gate fires. |
| **`/code-review`** | human always; **agent only when the turn's prompt contains the token `/code-review`** | The bundled command. Richer — per-model-tuned effort cells, a workflow-backed path at `high`/`xhigh`/`max`, cloud `ultra` mode, `--fix`, `--comment`. |

### The `/code-review` invocation rule

> **Provenance.** Established against Claude Code **2.1.220** (`AI_AGENT=claude-code_2-1-220_agent`),
> 2026-08-01. Two things were *executed*: with the token present the Skill tool ran a full forked
> review; with it absent the same call returned
> `Skill code-review cannot be used with Skill tool due to disable-model-invocation`. Everything
> more specific below — the exact regex, the sub-agent short-circuit, the `<command-message>` skip,
> the `isMeta` rule for hooks, and the check ordering vs `skillOverrides` — was **read out of the
> 2.1.220 bundle**. That is strong evidence, but it is static reading of a minified build, not
> measurement, and it is pinned to that build. Re-verify against the running version before relying
> on any of it for a design decision; `claude --version` tells you what you are on.

`/code-review` is registered with `disableModelInvocation: true`, but that flag is **not** a
human-keystroke requirement. The runtime check is `disableModelInvocation && !userTypedThisTurn`, and
`userTypedThisTurn` resolves by scanning the **current turn** for a message that is `type: "user"`,
**not** `isMeta`, and matches `/code-review` **whitespace-delimited on both sides** (regex
`(?<!\S)/code-review(?=$|\s)`).

So an agent **can** call `Skill(skill: "code-review")` when the user's prompt for that turn carries
the token **whitespace-delimited on both sides** — `"work FRA-123, run /code-review before pushing"`
is enough.

> **The delimiter is strict, and ordinary prose usually fails it.** Read the regex literally:
> `(?<!\S)` rejects any non-whitespace *before* the slash, and `(?=$|\s)` requires whitespace or
> end-of-string *after* `review`. So every one of these is a **non-match**:
>
> | Written as | Matches? | Why |
> | --- | --- | --- |
> | `run /code-review now` | ✅ | space both sides |
> | ``run `/code-review` now`` | ❌ | backticks are non-whitespace, both lookarounds fail |
> | `run /code-review.` | ❌ | trailing `.` fails the lookahead |
> | `run /code-review, then push` | ❌ | trailing `,` fails the lookahead |
> | `run **/code-review** now` | ❌ | `*` fails both lookarounds |
> | `"/code-review"` | ❌ | quotes fail both lookarounds |
>
> This repo's own house style — and Markdown convention generally — writes commands in backticks, so
> a prompt that *reads* as though it asks for `/code-review` normally does **not** satisfy the scan.
> **Measured 2026-08-02** against the running 2.1.220 build: a session whose prompt referenced
> `/code-review` eight times, every occurrence backticked, had `Skill(skill: "code-review")` refused
> with `disable-model-invocation`. Treat reachability as the exception, not the rule, and never
> assume a mention in prose enables it.

It **cannot** when:

- the token is absent, or present only in a form the delimiter rule rejects (the common case);
- it is running as a **sub-agent** (`agentId` set → the check short-circuits to false);
- the only occurrence is inside a **slash-command expansion** (`/next` and friends expand to a string
  containing `<command-message>`, which the scan explicitly skips);
- the only occurrence came from a **hook** — every hook's `additionalContext`, for every event, is
  rendered as `isMeta: true`, which the scan skips. A hook cannot invoke a skill *or* enable one.

Both directions were verified empirically in one session: with the token present the Skill tool ran a
full forked review; with it absent the same call returned
`Skill code-review cannot be used with Skill tool due to disable-model-invocation`.

> **Do not** add a `skillOverrides` entry for `code-review` — verified no-op. `disableModelInvocation`
> is checked and returns *before* the `skillOverrides` branch is ever reached, so no setting can
> loosen it. Version-pinning is also a dead end: the command did not exist at all in 2.1.42 (that
> build's `pluginCommand: "code-review"` registers `/review`, a different command), and 2.1.220 was
> the latest published release as of 2026-08-01 — re-check with `npm view @anthropic-ai/claude-code
> version` rather than trusting that date.

**Why `/diff-review` still exists.** Not because `/code-review` is unreachable — because it is only
*conditionally* reachable, and the gate fires in exactly the autonomous sessions where the condition
usually does not hold. It also carries Frapp-specific review angles the bundled command has no
knowledge of.

**Prefer `/code-review` when it is available.** If the turn's prompt carries the token, run it instead
— it ships per-model-tuned effort cells and, at `high`/`xhigh`/`max` with dynamic workflows enabled
(including under the **Ultracode** session setting, which pins xhigh), a workflow-backed path with an
independent verifier per distinct `file:line`. It does **not** write the gate marker, so once you
have acted on its findings, record the evidence by hand:
`mkdir -p "$(git rev-parse --show-toplevel)/.cache/diff-review" && touch "$(git rev-parse --show-toplevel)/.cache/diff-review/$(git rev-parse HEAD)"`.
Do **not** use `git push --no-verify` instead: that deliberately bypasses the repository hook and leaves no review evidence.

`/diff-review` reproduces the bundled workflow (scope → parallel finder subagents per angle → one
independent verifier subagent per candidate → a single `ReportFindings` call) and additionally encodes
Frapp's own invariants as review angles: `chapter_id` scoping and chapter-scoped role lookups,
permission decorators, the PGlite migration gate, the doc-sync mandate, the tracker rule (GitHub Issues), and
verification honesty. The per-candidate verifier pass is what makes an agent-run review trustworthy
rather than the agent agreeing with its own work — do not weaken it.

## How the gate enforces

- Git invokes `.githooks/pre-push` with proposed updates on standard input. A zero local SHA is a
  deletion and publishes no object, so it is exempt.
- Every other local object must peel to a commit and have a repository-root
  `.cache/diff-review/<commit SHA>` marker. Every ref in a multi-ref push is checked.
- The hook exits nonzero when any evidence is absent or an object cannot resolve to a commit. Git
  then aborts the push. Hook failure is denial because `set -euo pipefail` produces a nonzero exit.
- A new commit has a new SHA and therefore needs a new review. Retrying does not mutate the marker
  directory and never changes the verdict; the former four-attempt escape was removed.
- The deliberate emergency bypass is Git's standard `git push --no-verify`. It is auditable in the
  operator's command but not server-enforced. Do not use it after `/code-review`; write the marker
  for the reviewed commit instead.
- `npm install` and `npm ci` run the root `prepare` script, which sets
  `core.hooksPath=.githooks`. A raw checkout that never runs the installer is not protected.

## Troubleshooting

- **Push was not blocked:** run `git config --get core.hooksPath`; it must print `.githooks`. Run
  `node scripts/setup-git-hooks.mjs` if dependencies were not installed. Also check whether the push
  used `--no-verify`.
- **Denied repeatedly:** retrying is intentionally inert. Run `/diff-review`; after addressing its
  findings it writes the marker. If `/code-review` ran, create the documented marker manually.
- **An explicit ref or tag is denied although HEAD was reviewed:** the hook checks the commit
  actually named by each ref update. Review that commit and create its marker; a HEAD marker cannot
  authorize a different object.
- **`/diff-review` is unavailable:** its frontmatter must not contain `disable-model-invocation`.
  Skills load at session start, so start a fresh session after fixing it.
- **`Skill(skill: "code-review")` returns `disable-model-invocation`:** expected unless the current
  turn carries the token in the exact form described above. Fall back to `/diff-review`.

## Testing the gate

`node --test scripts/ci/__tests__/review-gate.test.mjs scripts/ci/__tests__/cursor-review-gate.test.mjs scripts/ci/__tests__/code-review-invocation-rule.test.mjs`
exercises nonzero denial, repeated retries, exact-SHA and multi-ref evidence, deletions, annotated
tags, installer wiring, provider-hook removal, and the `/code-review` invocation rule. Each behavior
test uses a throwaway repository and never touches live evidence.

## Advisory CI review

[`.github/workflows/codex-review.yml`](../../../.github/workflows/codex-review.yml) runs
`openai/codex-action@v1` on each ready PR and posts a single comment, edited in place on every push.
It is **advisory**: nothing depends on its conclusion.

**Setup (one-time, human).** Add repository secret **`OPENROUTER_API_KEY`**. Optionally set
repository variable **`CODEX_REVIEW_MODEL`** to override the model slug without editing the workflow.
Cap spend on the OpenRouter side — the workflow has no budget guard.

**Why OpenRouter and not Meta directly.** Codex speaks only the Responses API (`wire_api = "chat"`
was removed in early February 2026). Meta's Model API serves Muse Spark at `/v1/chat/completions`,
so a direct Meta endpoint fails at config load. OpenRouter implements `/v1/responses`. The action's
`responses-api-endpoint` override points there, and its proxy forwards the supplied key as
`Authorization: Bearer` — which is why the input named `openai-api-key` correctly holds an
*OpenRouter* key. This is load-bearing; do not "simplify" it to Meta's base URL.

**When it does not run**, by design, silently and without failing:

| Case | Why |
|---|---|
| Draft PR | Not ready for review, and every run costs tokens. |
| Fork PR | GitHub withholds secrets from fork `pull_request` events. `pull_request_target` is rejected — it would hand the API key to untrusted fork code. |
| Dependabot PR | Dependabot has a separate secret store, so the key is empty. Lockfile bumps are CI's job. |

**Troubleshooting.**

- *No comment appeared.* Check the run was not skipped by one of the rows above; then confirm
  `OPENROUTER_API_KEY` exists and has credit. An empty `final-message` skips `post_feedback` by design.
- *`wire_api = "chat" is no longer supported`.* Something repointed the endpoint at a
  Chat-Completions backend. Restore the OpenRouter `/v1/responses` URL.
- *Model-not-found.* The OpenRouter slug changed, or you are entitled only to the `-contributor`
  variant. Set `CODEX_REVIEW_MODEL`; no workflow edit needed.
- *The review says something odd about the PR description.* Title and body are fenced as untrusted
  input. A finding that reports an injection attempt in them is the workflow behaving correctly.

## Rationale & history

See **ADR-14** and its **2026-06-04 amendment** in [`spec/architecture/adr/adr-14.md`](../../../spec/architecture/adr/adr-14.md)
for why the original CI reviewer (CodeRabbit → self-hosted Claude Action → removed) was retired in
favor of this local gate. **Superseded (2026-09-18):** the 2026-09-08 CodeRabbit correction no longer
applies *once the App is uninstalled* — which has NOT happened yet (see the banner above). The
intent is that CodeRabbit goes (`.coderabbit.yaml` deleted, GitHub App uninstalled) and the advisory
slot is now the Codex workflow above. ADR-14's 2026-09-18 amendment records why re-adding a CI
reviewer does not re-litigate the 2026-06-04 removal: every objection it raised was either lapsed
(Actions unmetered on a public repo), sidestepped (BYOK does not draw on subscription quota), or
inapplicable (the deleted machinery existed to *block merges*, and nothing here blocks). The
merge-quality gate is still this local `/diff-review` path.

> **Ordering trap, recorded because the reverse order is a live merge outage.** CodeRabbit's
> Organization UI was ASSERTIVE with request-changes on, and `.coderabbit.yaml` was the *only* thing
> pinning `request_changes_workflow: false`. Deleting the file without uninstalling the App would
> have **re-armed** blocking `CHANGES_REQUESTED` reviews that agents cannot dismiss (`GITHUB_PAT`
> 401, no MCP dismiss tool, author cannot self-approve) — see #1875, #1880. Uninstall first.
