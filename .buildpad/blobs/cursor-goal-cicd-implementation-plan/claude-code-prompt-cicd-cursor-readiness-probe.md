I'm evaluating using Cursor's /goal (cloud background agent) for large refactor work alongside our existing Claude Code workflow, and want to update our CI/CD to support it. Audit only, no changes.

1. **Current CI/CD inventory.** List every GitHub Actions workflow (or other CI config) in the repo. For each: what triggers it (PR, push, merge, schedule), what it actually checks (lint, typecheck, test, build, e2e, security scan, doc gates), and whether it's a required check on the default branch. Is there a merge queue configured? Branch protection rules, if visible in repo config?

2. **Existing automation vs. manual practice.** We previously discussed a workflow of git-worktree-per-agent, PR-per-issue, and a merge queue with CI gates for the Signet cutover. How much of that is actually encoded in CI config today vs. just something I did manually?

3. **Cursor readiness check.** Confirm there's no existing .cursor/ directory, .cursorrules, or .cursorignore in the repo. Also check: can our test suite run in a clean environment without machine-specific setup (env vars, local secrets, docker services, seeded local DB)? What would a cloud agent need provisioned to run tests/build/lint here? Flag anything that would block a cloud-hosted agent from working autonomously (things only available on my machine).

4. **Test coverage reality check.** Roughly how much of the codebase has real test coverage, especially around the areas the recent code-quality audit flagged for consolidation (API controllers/response types, the 33 Supabase repositories, the shared hooks package)? Would our current CI catch a bad autonomous refactor in those areas, or would it pass despite a real regression?

Give me a structured status report. Don't set anything up yet.