Run this yourself (Paul), not as a hands-off agent task — it likely needs you to check credentials/config outside the repo.

---

**Problem:** GitHub MCP has reported `serverStatus: error` in nearly every recent Cursor/Claude Code session (at least 10+ PRs across two review batches). The consistent workaround has been `gh pr create --draft` for PR creation, with issue filing and PR comments silently skipped since `AGENTS.md` forbids raw `gh`/REST writes as a substitute. This is generating steady manual-reconciliation work (this canvas has caught the same "unfiled issues" gap repeatedly).

**Investigate:**
1. Check the MCP server configuration (whatever config file wires GitHub MCP into Cursor/Claude Code) — is it pointing at a valid endpoint?
2. Check the GitHub token/PAT used for MCP auth — expired, wrong scopes, or rate-limited? MCP errors this consistent usually mean an auth or connectivity problem, not a transient blip.
3. Check whether this is a per-session cold-start issue (MCP needs a warm-up call that isn't happening) vs a persistent broken credential.
4. If it's a token issue: rotate/reissue it with the right scopes (repo, issues, pull_requests) and update wherever it's stored (env var, secrets manager, tool config).
5. Once fixed, verify by asking an agent to file a real test issue and comment on it in a live session.

**Why this matters now:** every session that hits this either (a) silently drops follow-up issues, or (b) burns agent time working around it with `gh`. Fixing it once is cheaper than continuing to absorb the reconciliation cost.