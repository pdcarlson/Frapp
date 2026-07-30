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
| [**`/diff-review`**](../../../.claude/skills/diff-review/SKILL.md) | **agent or human** | The project's own skill. An agent runs it unprompted when the gate fires. |
| **`/code-review`** | **human only** | The bundled command. Richer — cloud `ultra` mode, `--fix`, `--comment`. |

`/code-review` is **author-locked against model invocation**: `disableModelInvocation` is hardcoded at
its registration site inside the Claude Code binary (it has no file on disk), and that lock resolves
*before* user settings, clamping the skill to `user-invocable-only` at best. Only a human typing
`/code-review` can run it — the runtime `userTypedThisTurn` condition is the sole escape hatch.

> **That lock is the entire reason `/diff-review` exists.** Do not try to "simplify" this by adding a
> `skillOverrides` entry for `code-review` — it is a verified no-op, and removing `/diff-review` would
> leave every agent session stalled at the gate waiting for a human keystroke.

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
- The `git push` match is a heuristic over a free-form shell string. It now also catches
  `git -C <dir> push`, and refuses to exempt a compound command that merely contains `--dry-run` —
  both previously pushed **completely ungated**. The cost is that a non-push command that merely
  *mentions* `git push` can be blocked; re-run it, or use the bypass.

The hook is a tool-level Claude Code hook and is **independent of git's own hooks**: it does not run git,
does not touch `--no-verify`, and does not interfere with the git-level
[`.githooks/pre-commit`](../../../.githooks/pre-commit) gitleaks secret scan.

## Troubleshooting

- **Push wasn't blocked / no review prompt:** the hook only acts on commands containing `git push`. If
  `git push` ran without a prompt, a sentinel for this HEAD already exists this session (review already
  gated it) — that's expected. Hooks load at session start; if you edited the hook mid-session, start a
  fresh session (or run `/diff-review` before pushing).
- **Stuck in a re-prompt loop:** shouldn't happen (sentinel is written on the deny). If it does, check
  that the sentinel directory is writable and that `git rev-parse HEAD` succeeds in the repo.
- **Need to bypass for an emergency push:** run `/diff-review`, or re-issue the push (the second attempt
  for the same HEAD is allowed). There is no server-side merge gate to satisfy.
- **`/diff-review` isn't offered as a skill:** its frontmatter regressed — `disable-model-invocation`
  must be absent from `.claude/skills/diff-review/SKILL.md`. Skills load at session start, so a fresh
  session is needed after adding or editing one.

## Rationale & history

See **ADR-14** and its **2026-06-04 amendment** in [`spec/architecture/README.md`](../../../spec/architecture/README.md)
for why the CI reviewer (CodeRabbit → self-hosted Claude Action → removed) was retired in favor of this
local gate, and the trade-offs (no server-side enforcement, no inline GitHub comments; acceptable for a
solo, agent-authored project).
