# AI Code Review Runbook

> **The CI Claude review was removed (2026-06-04, ADR-14 amendment).** There is no longer a
> `claude-review.yml` workflow, a `claude-review-gate` required check, a `CLAUDE_CODE_OAUTH_TOKEN`
> secret, or a `.github/claude-review/` rubric. PR review now happens **locally, before the push**.

## What runs now

Review is a **local pre-push gate**, not a CI job:

- A Claude Code **PreToolUse hook** — [`.claude/hooks/pre-push-review-gate.sh`](../../../.claude/hooks/pre-push-review-gate.sh),
  wired under `hooks.PreToolUse` in [`.claude/settings.json`](../../../.claude/settings.json) — intercepts
  `git push`.
- A push is **blocked until the current branch HEAD has actually been reviewed**, with guidance to run a
  review skill in the same chat session on the current diff. Address every finding (fix it, or file a
  tracked Triage follow-up with a reason), then re-push.
- Review **sub-agents inherit the session model** (Opus in a normal session) — `CLAUDE_CODE_SUBAGENT_MODEL`
  is no longer pinned.

This is the **single** pre-PR review gate. The `/next` flow no longer runs review as a separate step —
the push hook drives it exactly once per HEAD.

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
**not** `isMeta`, and matches the bare token `/code-review` (regex `(?<!\S)/code-review(?=$|\s)`).

So an agent **can** call `Skill(skill: "code-review")` whenever the user's prompt for that turn
mentions the token anywhere in prose — `"work FRA-123, run /code-review before pushing"` is enough.
It **cannot** when:

- the token is absent from the turn (the common autonomous case);
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
independent verifier per distinct `file:line`. It does **not** write the gate marker, so follow it
with `FRAPP_SKIP_REVIEW_GATE=1` on the push, or write the marker by hand.

`/diff-review` reproduces the bundled workflow (scope → parallel finder subagents per angle → one
independent verifier subagent per candidate → a single `ReportFindings` call) and additionally encodes
Frapp's own invariants as review angles: `chapter_id` scoping and chapter-scoped role lookups,
permission decorators, the PGlite migration gate, the doc-sync mandate, Linear-not-GitHub, and
verification honesty. The per-candidate verifier pass is what makes an agent-run review trustworthy
rather than the agent agreeing with its own work — do not weaken it.

## How the gate enforces (and avoids livelock)

A PreToolUse hook can't observe a skill invocation directly, so the gate keys on **evidence, not
attempts**: `/diff-review` writes `.cache/diff-review/<HEAD_SHA>` (gitignored) once it has reported and
acted on findings, and the hook allows the push only when that marker exists for the current HEAD.
**Retrying a denied push does not satisfy the gate.**

> **Why not deny-once-then-allow?** That was the previous design, and it guaranteed nothing the moment
> the review became agent-invocable — two consecutive pushes cleared it with no review in between. It
> was only ever load-bearing because the required skill was human-only, so the keystroke *was* the
> enforcement. Verified by executing the hook: attempt 1 denied, attempt 2 allowed, review never ran.

- Committing fixes changes HEAD → the marker no longer matches, so the review always covers exactly what
  you push.
- **Livelock guard:** a hook must never wedge a session permanently. After **4** blocked attempts for the
  same HEAD (counter under the transcript directory, `${TMPDIR:-/tmp}` fallback), the push is allowed
  through with a loud `WARNING … This diff is UNREVIEWED` on stderr. Four, not two, so a reflexive
  immediate retry — the old passing behaviour — no longer gets through.
- **Deliberate bypass:** `FRAPP_SKIP_REVIEW_GATE=1`. This is also the path after a human runs
  `/code-review`, which does not write the marker.
- The `git push` match is a heuristic over a free-form shell string, but a deliberately narrow one:
  `git` must be in **command position** (start of string, or after `;` `&&` `||` `|` or a newline —
  newlines are normalised to `;` before matching), and only git's own **global options**
  (`-C <dir>`, `-c k=v`, `--git-dir=…`) may sit between `git` and the subcommand. So
  `grep "git push" f`, `echo "git push"`, and `git commit -m "wire up push notifications"` do **not**
  match, while `git -C <dir> push`, `cd x && git push`, a multi-line `cd x` ⏎ `git push`, and
  `git push --dry-run … && git push …` all do. The accepted gap is an env-prefixed invocation
  (`env FOO=1 git push`): a missed push costs one unreviewed branch, whereas over-matching burns the
  livelock budget and then auto-allows a real one, which is strictly worse.

The hook is a tool-level Claude Code hook and is **independent of git's own hooks**: it does not run git,
does not touch `--no-verify`, and does not interfere with the git-level
[`.githooks/pre-commit`](../../../.githooks/pre-commit) gitleaks secret scan.

## Troubleshooting

- **Push wasn't blocked / no review prompt:** most likely a marker already exists for this HEAD
  (`.cache/diff-review/<SHA>` — review already ran), or the command form wasn't matched (see the
  command-position rules above; an env-prefixed push is the known gap). Hooks load at session start,
  so if you edited the hook mid-session, start a fresh session.
- **Denied repeatedly:** that is the design — the gate wants evidence, and **re-issuing the push does
  not provide it**. Run `/diff-review`; it writes the marker as its last step. If it ran but the push
  is still denied, check the marker actually landed at **repo-root** `.cache/diff-review/<HEAD_SHA>`
  (a marker written relative to a subdirectory cwd is invisible to the hook, and gitignored so it
  won't show in `git status`), and that `git rev-parse HEAD` succeeds.
- **Push allowed with a `WARNING … UNREVIEWED` line:** the livelock guard fired after 4 blocked
  attempts, or the attempt counter could not be persisted. The diff really was not reviewed — treat
  the warning as a finding, not noise.
- **Need to bypass for an emergency push:** `FRAPP_SKIP_REVIEW_GATE=1`. Do **not** simply retry the
  push — retrying no longer satisfies the gate, and four retries burn the livelock budget so the
  fifth is released as UNREVIEWED. There is no server-side merge gate to satisfy.
- **`/diff-review` isn't offered as a skill:** its frontmatter regressed — `disable-model-invocation`
  must be absent from `.claude/skills/diff-review/SKILL.md`. Skills load at session start, so a fresh
  session is needed after adding or editing one.
- **`Skill(skill: "code-review")` returns `disable-model-invocation`:** expected whenever this turn's
  prompt does not contain the bare token `/code-review` (see the invocation rule above). Not a
  misconfiguration — fall back to `/diff-review`.

## Testing the gate

`npm run test:ci-scripts` (or `node --test scripts/ci/__tests__/review-gate.test.mjs`) — 25 cases
covering command-position matching, the `--dry-run` compound case, marker present / absent / stale,
both forms of `FRAPP_SKIP_REVIEW_GATE`, the livelock release, and the fail-closed paths for a
malformed payload, a missing interpreter, and a broken `grep`. Needs no network and no running stack.

It lives under `scripts/ci/__tests__/` **so that something actually runs it** — the `test:ci-scripts`
glob picks it up and the `ci-scripts-tests` CI job runs it on every PR. An earlier revision shipped
this as a standalone `scripts/test-review-gate.sh` wired to nothing, which is how the fail-open parse
bug it now guards against went unnoticed. Each case runs against a throwaway git repo, so the suite
never reads or writes the live `.cache/diff-review/` marker.

## Rationale & history

See **ADR-14** and its **2026-06-04 amendment** in [`spec/architecture/README.md`](../../../spec/architecture/README.md)
for why the CI reviewer (CodeRabbit → self-hosted Claude Action → removed) was retired in favor of this
local gate, and the trade-offs (no server-side enforcement, no inline GitHub comments; acceptable for a
solo, agent-authored project).
