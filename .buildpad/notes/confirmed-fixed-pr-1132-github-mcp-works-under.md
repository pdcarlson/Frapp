**CONFIRMED FIXED (PR #1132):** GitHub MCP works under Claude Code — 5 real issues filed in one session (#1133-#1138) with no errors. The outage was specific to the Cursor session/environment, not a repo-wide or account-wide problem. Cursor stays retired (see decision below); Claude Code is the whole workflow now, not just judgment work. This note's job is done — kept for history below.

---

**Prior state, kept for history:** MCP was down in nearly every Cursor session across two full review batches (20+ PRs total) and kept leaving debt unfiled, caught only by manual canvas reconciliation each time. The chronic outage plus a discovered squash-merge-to-wrong-branch footgun (#1120/#1123 initially, traced further to #1124/#1125 in the full audit) triggered the decision to drop Cursor entirely on 2026-08-20. A dedicated Claude Code cleanup pass (PR #1132) then confirmed all the "missing" code was actually recovered, added a real CI mechanism (`pr-base-guard.yml`) instead of relying on a playbook alone, and filed every backlogged issue in one session.

---

Older history (Aug 19-20, `.buildpad/` sync gap): Paul committed the full Buildpad canvas into the repo under `.buildpad/`, synced periodically via git. Treat `.buildpad/` as planning/research background, not a spec source of truth. Prompts that name a specific canvas document should verify it's actually present in `.buildpad/` on `main` before relying on it — this gap hit twice (PR #1082, #1083) before the fix became standard practice.