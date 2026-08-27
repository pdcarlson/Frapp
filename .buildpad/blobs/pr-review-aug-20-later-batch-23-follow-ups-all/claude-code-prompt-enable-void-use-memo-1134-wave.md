Run this in Claude Code, local, supervised. Two independent, decision-free items. Confirm GitHub MCP is live at the start (it should be) — file any new debt as real issues as you find it, don't just note it in a PR description.

---

**Explicitly do NOT touch:** #1133 (mobile tutorial replay) and #1135 (notification feed scoping). Both are correctly blocked on a product decision from Paul. Leave them open exactly as filed — do not pick a direction, do not start the notification repository fix, do not build a mobile replay control. They'll get picked up once decided.

## Task 1 — #1134: enable `void-use-memo`

This is a `recommended-latest` compiler rule (not in the `recommended` set #1108-#1125 already closed out), currently off, with zero findings on current `main` per the issue. Verify that's still true (findings can shift as code changes), then enable it in `packages/eslint-config/react-hooks.js` at upstream severity. If it turns out not to be clean anymore, don't force it — report the findings and leave it off, file/update the issue with what changed.

## Task 2 — #1137: move 3 portable hooks into `@repo/hooks`

Read the issue in full first — it has the exact scope, blockers, and collision warnings. Read `REFACTOR-PLAN.md:836` too, but re-verify every file:line claim against current `main` before acting on it (the plan predates #1117/#1126, which moved code around).

Summary: move `use-org-config`, `use-custom-roles`, `use-custom-fields` from `apps/web/lib/hooks/` into `packages/hooks/src`, update every call site to import from `@repo/hooks`, add `@repo/validation` as a `packages/hooks` dependency (needed by all three). Move `use-org-config.test.tsx` with its subject. Do NOT move `use-subscription-write-state` or `use-chapter-theme` — the issue explains why they're not portable.

Run this task alone, not interleaved with anything else in the same session that touches `packages/hooks/package.json`, its `index.ts` barrel, or `analytics-provider.tsx` — the issue documents real collision risk with items 5/7/1 if run concurrently, but since nothing else is running right now, that's just a note for the future, not a blocker today.

**Definition of done:** zero remaining imports from the old `apps/web/lib/hooks/use-org-config` etc. paths (repo-wide search, paste the zero-match proof), `@repo/validation` declared in `packages/hooks/package.json`, the moved test passes unmodified, `npm run check:dep-cruiser` shows 0 new violations, `npm run check-types` and both app lints green at `--max-warnings 0`.

## Report back

For each task: what changed, test results, and whether it's ready to merge or needs a decision. If you spot new debt while in here, file it as a real GitHub issue (MCP is confirmed working) rather than just mentioning it in the PR body — that's the whole point of switching back to Claude Code.