---
name: file-follow-up
description: >
  File out-of-scope, deferred, or blocked work as a GitHub issue a fresh agent can execute cold —
  including proven human-only blockers. Use when work surfaces that does not belong in the current
  PR, when verification is blocked, when a review finding is deferred, or when something has been
  proven to need the human (environment/network policy, missing credential, dashboard-only toggle,
  purchase, product decision).
---

# File follow-up work as a GitHub issue

Cloud-agent VMs are ephemeral and a single PR shouldn't balloon, so when work surfaces that doesn't
belong in the current PR, **file it as a GitHub issue** (`issue_write` create, labels `triage` +
one `area:<x>` + a priority). Issues are completed by AI agents, so write each one to be executed
cold by a fresh agent.

Policy (labels, states, Agent briefs, ownership): [`GITHUB_PM.md`](../../../docs/internal/ci-cd/GITHUB_PM.md).
This skill is the agent playbook.

## Proven human-only blockers

The moment you have **proven** something needs the human — an environment/network-policy change
only the owner can make, a missing credential or external account, a dashboard-only toggle, a
purchase or product decision — file a GitHub issue before moving on.

- *Proven* means at least one real attempt with the failure output in hand, not a guess.
- *Needs the human* means no agent session could do it either — if a better-provisioned agent
  session could (Docker, creds, a different harness), that's ordinary blocked work, not a `[human]`
  one.

**Format:** title **`[human] <imperative action>`**, labels `triage` + `suggestion` + one
`area:<x>` + a priority. Body opens with `**Human action required — hold in triage; not for /next.**`
followed by what you tried, the exact error/output as proof, and precisely what the human must do
(exact setting/secret/file names), ending with
a visible `` `agent-suggestion: v1 fp=human/<slug> source=<session|pr#N|issue#N>` `` line — a
visible line, not an HTML comment, which every MCP read deletes (hiding it from the search index
too).

The weekly **PR Follow-ups** routine owns the `fp=human/` namespace: it audits these against
reality, publishes every open one on the **Human Action List**, and closes them on proof — the
`suggestion` label is what permits that close, so never omit it. Never work around a blocker
silently, never leave it only in chat, and never make the next session re-discover it.

## Filing is necessary but not sufficient — end the run by *asking*

An issue is durable, but it is not an interruption, and a blocker only the owner can clear does
nothing until the owner sees it. When a run hits one:

1. **Keep building everything that does not depend on it.** Do not stall the whole unit on a
   blocker that gates one acceptance criterion.
2. **File the issue as you go**, per the hard rule above.
3. **Put it to the owner as an explicit question in your end-of-run report** — the last thing
   they read, phrased as a decision or an action with the exact steps, and `AskUserQuestion` when
   a choice is involved. **Not** as a subsection of a long PR body: a *Flagged for review* block
   is a record, not an ask, and it will be read after merge if at all.

One interruption per run, at a predictable moment. If the owner is present and the blocker is
small, asking on the spot beats all of this.

## When to file

- A **proven human-only blocker** — per the hard rule above.
- Deferred / out-of-scope work discovered mid-task (data backfills, follow-up refactors).
- **Blocked verification** — when the sandbox can't run something (Docker/Supabase won't start,
  missing external creds), file an issue so the gap is tracked. **Never check a verification box
  you couldn't actually run** — say it's blocked and link the issue.
- Review findings you're not fixing in the current PR (with a reason).
- A bug or security hole found outside the current scope.
- Cross-cutting prerequisites or blockers.

**Don't file** for trivial nits you can fix in the current PR (just fix them), or duplicates —
search first (`search_issues`, open **and** closed) before creating.

## How to write one (so an agent can execute it)

- **Meta block:** a **priority label** (`P1` urgent / `P2` high / `P3` medium / `P4` low),
  `Blocked by #N` lines where relevant, originating PR, one `area:<x>` label, and an **Agent
  brief** (`depth:` / `model:` / `ultracode:` — err on `depth:deep`; policy in
  [`GITHUB_PM.md`](../../../docs/internal/ci-cd/GITHUB_PM.md#agent-briefs-depth--model--ultracode)).
- **Problem/context:** what's wrong and why it matters, with exact file paths + line refs.
- **Acceptance criteria:** an objectively verifiable checkbox list.
- **Implementation notes:** constraints, helpers to reuse, gotchas.
- **Definition of done:** "PR linked with `Fixes #N`, criteria met, CI green."

`area:<x>` groups by surface (`api`/`web`/`db`/`ci`/`security`/`ux`/`product`/`research`/`docs`/`deps`).
Express dependencies as a **`Blocked by #N`** body line, not a label.

## Lifecycle (short)

File with `triage` → accepted to **Backlog** (label removed, priority confirmed) → an agent
claims it via `/next` → PR with `Fixes #N`. Express blockers as `Blocked by #N` lines so an
issue isn't started until they're resolved.

Scheduled routines 1–3 have a narrower write surface (`suggestion`-labeled issues only; no
product-code PRs) — [`ROUTINES.md` → Shared ownership boundary](../../../docs/internal/ci-cd/ROUTINES.md#shared-ownership-boundary-all-routines).
[`docs-upkeep`](../docs-upkeep/SKILL.md) (routine 4) differs on both counts: it opens docs-only
PRs and files nothing here except a proven human-only blocker.
**This skill is used from feature work; it does not put you under that product-code ban.**
