# Frapp Bugbot Rules

- Treat `docs/` and `spec/` as part of the source of truth. Flag any non-doc code, CI, tooling, or config change that does not update related documentation or spec files in the same PR.
- Protect the branch model: feature work targets `main`, and promotion PRs target `production` from `main` only.
- Be strict about deploy safety: if workflow names, required checks, or promotion gates change, the matching runbooks and branch-protection automation must change in the same PR.
- Flag any suggestion that would weaken secret handling, authentication, authorization, or migration safety.

## Triggering Bugbot safely

- **Preferred manual trigger:** post a top-level PR comment with `bugbot run`.
- Legacy alias `cursor review` still works but is being phased out because the word "cursor" collides with the background-agent mentions below.
- **Never** post `@cursor` or `@cursoragent` on a PR unless you explicitly want to spawn a Cursor background agent — that is a separate, billed product that will run a full cloud agent over the PR diff. It is distinct from Bugbot. Use `@cursor remember [fact]` only when you want to teach Bugbot a learned rule.
- Trigger phrases work only as top-level comments, not as replies inside an existing review thread.

Full runbook: [`docs/internal/BUGBOT_RUNBOOK.md`](../docs/internal/BUGBOT_RUNBOOK.md).
