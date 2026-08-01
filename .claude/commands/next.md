---
description: Pick the next viable Linear issue with me, complete it, and keep Linear in sync
---
Work tracking lives in **Linear** (team **Frapp Live**, prefix **FRA-**), reached via the **native
Linear MCP** — the canonical hub. New issues are created in Linear; PRs close work with `Fixes FRA-N`
(and `Closes #N` for an issue that has a GitHub twin — closure syncs GitHub→Linear). See
[`docs/internal/ci-cd/LINEAR_PM.md`](../../docs/internal/ci-cd/LINEAR_PM.md).

Pick up and complete the next viable piece of work, then leave the tracker cleaner than you found it.

1. Start in plan mode. **Lean heavily on sub-agents:** launch Explore/Plan sub-agents in parallel to
   survey candidate issues and related code/specs, keeping heavy reading out of your own context. Read
   AGENTS.md and the real spec files an issue links to. **Your plan must include the required pre-PR
   `/diff-review` gate (step 7 — enforced at push by the pre-push review-gate hook) as an explicit step.**
2. Select the work from Linear (MCP). Pull the Backlog ranked by **priority**
   (Urgent→High→Med→Low; None last), tie-break by lower FRA- number:
   - `list_issues(team:"Frapp Live", state:"Backlog")` (also "Todo" if present); read relations/links
     with `get_issue` where the list is thin. Surface each candidate's **estimate** (Fibonacci) as sizing
     context in the shortlist — it informs the pick but is not a filter.
   - **Filter to genuinely unblocked:** drop anything with an open *blocked-by* relation; confirm any
     dependency is actually shipped (check merged PRs/code via a sub-agent, not just the Linear state).
   - Don't auto-start **Triage** items — surface them for human accept first.
   - If the Linear MCP is unavailable, **stop and say so** — Linear is canonical; do not fall back to
     another tracker. Retry or escalate.
3. Pick with me: shortlist the issues genuinely viable now and use AskUserQuestion to let me choose.
   **Don't shy away from larger, high-impact issues** — prefer the most valuable viable work. Only
   pre-split when it's genuinely two unrelated efforts; if an issue turns out bigger mid-flight, ship
   the coherent slice you can verify and **file self-contained follow-ups** into **Triage**
   (`save_issue` with state Triage, and set a **Priority** — Linear requires one to leave Triage) for the rest.
4. Verify the chosen issue against current code and the canonical spec; research best practices. Fix only if valid. If already resolved, set it **Done** — if it has a GitHub twin, close that twin on
   GitHub so the integration syncs the closure (Linear→GitHub close-sync is less reliable than the reverse).
   Cancel duplicates via `save_issue` state→Canceled, `duplicateOf` the canonical. If issue and spec conflict, the spec wins. Use
   AskUserQuestion for real decisions. **Delegate** independent research and self-contained
   implementation chunks to sub-agents.
5. Keep Linear in sync as you go (there is no backlog file anymore):
   - On start: `save_issue(id:"FRA-N", state:"In Progress")` and assign it to me if unassigned.
   - Leave a short trail with `save_comment(issueId:"FRA-N", …)` for decisions, the branch, and the
     PR link.
6. Branch from main as `claude/<slug>`. Focused commits. Update the related real spec/docs in the same
   PR (doc-sync requires it; put files in their canonical home per
   [`docs/internal/DOCUMENTATION_CONVENTIONS.md`](../../docs/internal/DOCUMENTATION_CONVENTIONS.md) —
   never drop a stray file to satisfy the gate). Verify end-to-end (run tests/app) — never claim a step
   you didn't run.
7. **Review happens at push — the single gate.** When you `git push`, the local pre-push review-gate
   hook ([`.claude/hooks/pre-push-review-gate.sh`](../hooks/pre-push-review-gate.sh)) blocks the first
   push of each HEAD and requires one review pass on the diff. Try `Skill(skill: "code-review")` first
   — it is the richer review and succeeds when this turn's prompt carries the bare token
   `/code-review`; if it is refused with `disable-model-invocation`, that is expected, not an error.
   Fall back to **`/diff-review`**, which you can always invoke — either way, do not stop and wait for
   a human. (`/code-review` does not write the gate marker; `/diff-review` does.) Then address every
   finding — fix it, or file a
   self-contained Triage follow-up with a reason — and re-push (committing fixes changes HEAD, which
   re-gates so the review always covers what you push). Its review sub-agents inherit the session model
   (Opus). There is no separate CI review and no duplicate step — this hook is the only pre-PR review
   gate.
8. Open the PR with **`Fixes FRA-N`** in the title/body (add `Closes #<github>` if the issue has a
   GitHub twin). On merge, Linear auto-transitions FRA-N to **Done**; if it didn't fire, set
   `save_issue(id:"FRA-N", state:"Done")`. Babysit to merge-ready (per AGENTS.md). Solo project: the
   issue's state is the status — no manual board moves.

If blocked on a decision that's mine, stop and ask with AskUserQuestion.
