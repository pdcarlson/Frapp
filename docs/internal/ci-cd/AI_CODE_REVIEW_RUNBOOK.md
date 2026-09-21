# AI Code Review Runbook

> **The merge-quality gate is local, before the push.** There is **no CI-side AI reviewer of any
> kind** — no `claude-review.yml` workflow, no `claude-review-gate` required check, no
> `CLAUDE_CODE_OAUTH_TOKEN` secret, no `.github/claude-review/` rubric, no CodeRabbit, and no
> `codex-review.yml`. Nothing has reinstated a blocking CI review, and the advisory one was removed
> 2026-09-21 (see [Rationale & history](#rationale--history)). The gate below is the whole of it.

## What gates a push

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

## Rationale & history

**There is no CI-side AI reviewer, and nothing here is a CI check.** The merge-quality gate is,
as it has been since 2026-08-01, the local `/diff-review` path documented above.

Three attempts have been retired, in order:

- **CodeRabbit** — retired 2026-09-18. The App was uninstalled by the owner and `.coderabbit.yaml`
  deleted in the same change, in that order (deleting the config first would have dropped it to
  unconfigured defaults where `request_changes_workflow` is ON).
- **A self-hosted Claude review Action** (`claude-review.yml`, gated by a required
  `claude-review-gate` check) — removed 2026-06-04. There is no such workflow, no such required
  check, no `CLAUDE_CODE_OAUTH_TOKEN` secret and no `.github/claude-review/` rubric.
- **An advisory `codex review` job** (`codex-review.yml`, BYOK via OpenRouter) — shipped
  2026-09-18, removed 2026-09-21. It never completed a single review that inspected a diff: its
  live runs failed on an OpenRouter data-policy exclusion, then on an output-reservation credit
  refusal, and finally on a runner sandbox that could not start — the last of which made the model
  report it had read nothing while the harness scored the run as a verified clean review. Its
  model was never evaluated, because no run ever reached one.

**The one constraint that outlives all three.** Any automated reviewer added here must **never**
post a `CHANGES_REQUESTED` or `APPROVED` review. The first blocks squash on green checks with no
way for an agent to clear it ([#1875](https://github.com/pdcarlson/Frapp/pull/1875)); the second
would satisfy a human-review requirement nothing human looked at. A `COMMENT` review blocks and
satisfies nothing, which is the only safe shape. Any such reviewer must also stay out of
[`scripts/ci/lib/required-checks.mjs`](../../../scripts/ci/lib/required-checks.mjs).
