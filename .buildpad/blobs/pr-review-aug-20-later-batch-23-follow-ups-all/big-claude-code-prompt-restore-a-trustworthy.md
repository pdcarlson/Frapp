Run this in Claude Code, local, supervised, one session, take your time. This is a "get back to ground truth" pass, not feature work. Do not start any new feature/refactor work until this is done and reported back. GitHub MCP should be live in this session — verify that first and stop to report if it isn't.

---

## Context

Cursor was just retired from this project after two things: (1) GitHub MCP was down in nearly every Cloud Agent session over the last two days, causing a steady stream of unfiled follow-up issues, and (2) PR #1127 revealed a real footgun — at least two PRs (#1120, #1123) were squash-merged by Cursor into stacked *feature* branches instead of `main`. GitHub displayed them as "Merged," which looked identical to a real merge, but the commits never reached `origin/main` and CI never even ran on them (the `pull_request` trigger is scoped to `branches: [main, production]` only, so a PR targeting a feature branch is invisible to CI). This was only caught because a human happened to notice. **We do not currently know the true state of `main` with confidence.** Fix that first.

## Step 1 — Establish ground truth on `main`

1. Check out `origin/main` fresh, do not trust any PR's "Merged" badge or description as proof something landed.
2. For the `eslint-plugin-react-hooks` v7 compiler-rule rollout specifically (the highest-risk item, spanning PRs #1108, #1119, #1120, #1122, #1123, #1124, #1125, #1127): read `packages/eslint-config/react-hooks.js` on real `main` right now and report exactly which rules are enabled vs held off, with actual finding counts from running lint. Do not rely on any PR description's claimed rule list — verify by running `npm run lint -w apps/web` and `npm run lint -w apps/mobile` with each rule's severity temporarily bumped to check for hidden findings if needed.
3. Search for orphaned branches that may contain real, uncommitted-to-main work: `cursor/realtime-compiler-lint-on-main-611b` and `cursor/forms-compiler-lint-on-main-611b` are named explicitly in #1127 as containing the realtime and forms/`set-state-in-effect`/`refs` compiler fixes, never landed on `main`. Check if these branches still exist (locally after fetch, or on the remote). If they exist and their diffs are still valid against current `main`, either open a normal PR from them targeting `main`, or cherry-pick the same way #1127 did. If the branches are gone or stale/conflicting, redo the underlying work fresh against current `main` (the original PR descriptions for #1124 and #1125 describe exactly what changed — use those as the spec, but re-verify against real current code, don't blind-apply an old diff).
4. While you're at it: audit every other Cursor-authored PR merged in the last two days for the same squash-into-feature-branch footgun, not just the two we already caught. For each one, confirm the merge commit SHA it claims is actually an ancestor of current `origin/main` (`git merge-base --is-ancestor <sha> origin/main`). List every PR checked and its verified status (confirmed on main / NOT on main, needs recovery).

## Step 2 — Fix the detection gap itself

The reason #1120/#1123 went unnoticed is that CI silently skips PRs targeting non-`main`/`production` branches. Decide and implement a fix so this can't happen silently again — options to consider: widen the `pull_request.branches` trigger, or add a lightweight scheduled/periodic check that flags any PR marked "Merged" whose commit isn't an ancestor of `main` within some window. Pick whichever is simplest and actually closes the gap; document the choice in `docs/internal/ci-cd/AGENT_INFRA.md`.

## Step 3 — Check on in-flight work from before the Cursor retirement

Two things were queued as Cursor background-agent goals right before the retirement decision: (a) Wave 1 item 8 — moving `use-org-config`, `use-custom-roles`, `use-custom-fields` into `@repo/hooks`, and (b) an investigation into whether `supabase-notification.repository.ts` is correctly tenant-scoped (blocking item 5, the query-key migration). Check whether either produced a branch or PR. If yes, evaluate and finish/land it properly (verifying it's actually on `main`, per Step 1's lesson). If no, they're still open — pick them up yourself as part of normal work after this cleanup, no need to do them in this same session unless time allows.

## Step 4 — File the backlog now that MCP works

Confirm GitHub MCP is actually live (file a real test comment/issue first if unsure). Then:
1. File the "Align mobile tutorial replay with spec" issue (draft text saved on the Buildpad canvas, PR-review blob — read `.buildpad/` for the exact text, or reconstruct from #1121's PR body if the canvas copy is stale).
2. Post the hygiene comment on epic #937 clearing the stale "Blocked by #958" note.
3. Confirm whether issue #342's suggested-fix text was ever corrected (it should point at `inspectUploadFile("image", file)` / `MAX_UPLOAD_LABEL`, not the old PNG/JPG/WebP/2MB rule). If not, post the correction.
4. File any new issues for whatever Step 1's audit turns up that isn't fixed in this same session.

## Step 5 — Small fixes, no decisions needed

1. `supabase-task.repository.spec.ts` seeds `status: 'PENDING'`, not a real `TaskStatus` value — fix to a correct enum value that preserves the test's intent.
2. `spec/behavior/events.md` still documents the check-in mint route as POST; code is GET (`attendance.controller.ts`) — correct the spec.

## Step 6 — Report back

End with a clean, verified status table: every open thread from the last two days of PRs (#1108 through #1127), its true state on `main` (verified, not assumed), and what if anything is still open. This report is the new source of truth — supersedes any earlier canvas notes that took a PR description's word for what landed.

**Full test plan for whatever you touch:** `npm run check-types`, `npm run lint` (both apps, 0 warnings), scoped tests for anything fixed, `check:dep-cruiser`, `check-docs-impact.mjs`. Do not mark anything done without the verification proof (lint output, `git merge-base` check, etc.) — that's the whole point of this pass.