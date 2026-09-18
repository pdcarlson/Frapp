# AI Code Review Runbook

> **The merge-quality gate is local, before the push.** The CI Claude review was removed
> (2026-06-04, ADR-14 amendment): there is no `claude-review.yml` workflow, no `claude-review-gate`
> required check, no `CLAUDE_CODE_OAUTH_TOKEN` secret and no `.github/claude-review/` rubric, and
> nothing has reinstated a blocking CI review.
>
> Since 2026-09-18 there **is** an advisory CI reviewer — [`codex-review.yml`](#advisory-ci-review-codex-reviewyml),
> comment-only, blocking nothing. It does not satisfy or replace the gate below; read it as a second
> opinion on the PR, not as the thing that lets you push.

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

## Advisory CI review (`codex-review.yml`)

Since 2026-09-18 there is **also** a CI-side reviewer. It does not change anything above: the
merge-quality gate is still the local `pre-push` + `/diff-review` path, and this job blocks nothing.

[`.github/workflows/codex-review.yml`](../../../.github/workflows/codex-review.yml) installs
`@openai/codex@0.155.0` and runs the CLI's first-class `codex review` subcommand against a
bring-your-own-key provider (OpenRouter). [`scripts/ci/codex-review.mjs`](../../../scripts/ci/codex-review.mjs)
posts the result as **one plain PR comment** marked `<!-- frapp-codex-review -->`, upserted through
`upsertWakeComment` so a new review replaces the previous one rather than stacking.

**What makes it advisory, and what must not change:**

| Invariant | Why |
|---|---|
| Not in [`required-checks.mjs`](../../../scripts/ci/lib/required-checks.mjs) | Advisory means blocking nothing. Do not add it. |
| Plain comments, **never** a review event | A write-access `CHANGES_REQUESTED` blocks squash on green checks and no agent can clear it (#1875). |
| `issues: write`, not `pull-requests: write` | `issues` is the permission that posts a PR comment, measured against `pr-base-sync.yml`. |
| The script always exits 0 | A reviewer problem raises one `routine-state` alert issue instead of reddening CI. |
| Checkout is `head.sha` | `refs/pull/N/merge` does not exist on a conflicted PR and can lag a push. |

**Skipped runs are deliberate:** drafts, fork PRs (`pull_request` withholds secrets from forks, so
the reviewer could only fail), and docs-only PRs. Docs-only is measured across the whole PR diff, not
the last push, so a PR that ever touched code keeps getting reviewed.

### Reading the output

`codex review` sends a strict-JSON schema in its system prompt, **parses the reply itself**, and
renders Markdown to **stdout** — the banner, warnings and transcript go to **stderr**. So stdout is
the payload. Findings arrive as `- [P<0-3>] <title> — <path>:<start>-<end>` with the body indented
beneath; a clean review prints only the model's one-line `overall_explanation`, which is model-written
prose and not a fixed string.

Severity **ordering is requested, not guaranteed.** It is an instruction in the binary's review
prompt, read out of the binary and never executed, and the schema it belongs to is prompt-enforced
rather than API-enforced — so a P3 above a P0 is the model ignoring the prompt, not a bug in the
renderer or in `codex-review.mjs`.

Before posting, the script rewrites runner-absolute paths to repo-relative, breaks `@mentions` /
`#123` / `GH-123` outside code so quoted diff hunks cannot notify anyone through the repo's bot, and
caps the body at GitHub's 65536-character limit. Fenced blocks and inline code spans are left
byte-identical so `suggestion` blocks stay copy-pasteable.

**Treat findings as advisory opinion.** The output schema is **prompt-enforced, not API-enforced**
(`text.format` is null in the request), so the model is not prevented from ignoring it, and the model
itself is a BYOK choice rather than a vendor-tuned reviewer. Verify before acting.

### Troubleshooting

The alert issue **"Advisory codex review is not producing reviews"** (label `routine-state`) is the
only signal, because the workflow stays green. Its verdict says what happened:

- **`missing-credential`** — the `OPENROUTER_API_KEY` repository secret is absent or empty. Exit 1,
  with `Missing environment variable` on stderr. The likeliest first failure of this workflow.
- **`config-error`** — the CLI rejected its configuration. **Also exit 1** — re-measured against CLI
  0.155.0, a missing key and a bad config key are *not* distinguishable by exit code, which is why
  the script classifies stderr. (An earlier draft of this runbook claimed `101` for the missing key.
  That number came from piping the CLI into `head`, which closed stdout and aborted the process; the
  real code is 1.)
- **`reviewer-did-not-run`** — no exit code was recorded, so a step before the CLI failed (checkout,
  install, the instruction-file purge). Read the run log, not the model.
- **`reviewer-failed`** — any other non-zero exit. `2` is a bad CLI argument; `124` means the
  900-second `timeout` fired, which is what an unreachable `base_url` looks like — the CLI retries
  rather than failing fast.
- **`empty-output`** — exit 0 with nothing on stdout. A reviewer that emits no payload is dead, not
  clean.
- **`render-mismatch`** — the model returned schema-valid findings that the script could not parse
  into bullets. Real findings are being dropped, so this is never treated as clean.
- **`contract-violation`** — the model returned prose instead of the required JSON. This is about the
  **model**, not the wiring. ADR-14's revisit trigger for it is to price the native Codex reviewer's
  credits path.
- **`clean-unverified`** — no findings, and the raw model message could not be read to confirm the
  contract. Not an error and not alerted; it is reported honestly rather than claimed as verified.

Two traps worth knowing before debugging:

- A clean review and a contract violation are **byte-indistinguishable on stdout** — both are short
  prose at exit 0. The script tells them apart by reading the raw pre-render model message out of the
  session rollout, which is why `CODEX_HOME` is set explicitly.
- ``warning: Model metadata for `<slug>` not found`` on stderr is **not** a bad-slug signal. It fires
  for any model under a custom provider, including OpenAI's own. A genuinely wrong slug fails at the
  provider, not here.

**Config gotchas, all executed against CLI 0.155.0:** `codex review` accepts neither `--profile` nor
`--model`; both the provider and the model are selected with `-c`. `wire_api = "chat"` was removed, so
a BYOK provider **must** speak the OpenAI Responses API. `CODEX_HOME` is not created on demand.
`project_doc_fallback_filenames=[]` plus `--strict-config` is what keeps the instruction-file
precedence chain from failing open.

### Why the reviewer cannot be steered by the PR it reviews

`codex review` reads `AGENTS.override.md`, `AGENTS.md` and configured fallbacks **natively** — no
prompt wording closes that channel. The workflow closes it structurally: it purges every instruction
file from the checkout, then restores only the ones present at the **merge base**. Restoring from the
merge base (not the base tip) is what keeps the purge diff-neutral, so those files simply do not
appear in the review. The accepted cost is that a legitimate instruction-file change is reviewed under
the base ref's rules — the local `/diff-review` gate still covers that diff, and this reviewer is
advisory regardless. The `project_doc_fallback_filenames=[]` setting covers the part of the precedence
chain the purge cannot reach.

### Testing

`node --test scripts/ci/__tests__/codex-review.test.mjs` covers the classifier (including the
clean-vs-violation ambiguity and the tri-state contract check), the sanitizer, path relativization,
the size cap, rollout reading, and that no review endpoint is ever called. Its fixtures are
transcribed from real CLI output, not invented.

## Rationale & history

See **ADR-14** in [`spec/architecture/adr/adr-14.md`](../../../spec/architecture/adr/adr-14.md) for
the whole arc: CodeRabbit → a self-hosted Claude review Action → removed entirely (2026-06-04
amendment) → this local gate → the advisory `codex review` job above.

**CodeRabbit is gone (2026-09-18).** The App was uninstalled by the owner and `.coderabbit.yaml`
deleted in the same change, in that order — the order mattered at the time, because deleting the
config first would have dropped CodeRabbit to unconfigured defaults where `request_changes_workflow`
is ON. There is no CodeRabbit config, App, or review to account for any more, and the two 2026-09-08
and 2026-09-18 amendments that governed it are spent.

**The one thing to carry forward outlives the vendor:** any automated reviewer here must post plain
comments and **never** a GitHub review event, because a write-access `CHANGES_REQUESTED` blocks squash
on green checks and no agent can clear it (#1875). That constraint is why the `codex review` job holds
`issues: write` rather than `pull-requests: write`.

The merge-quality gate is, as it has been since 2026-08-01, this local `/diff-review` path.
