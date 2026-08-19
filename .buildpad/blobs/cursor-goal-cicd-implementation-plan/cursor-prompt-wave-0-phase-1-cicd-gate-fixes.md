Our full Buildpad research canvas is committed in this repo under `.buildpad/` (blobs/, documents/, notes/) — Paul syncs it periodically, it is not authoritative spec, treat it as planning/research background. Before starting, find and read: the CI/CD readiness audit (search for "Frapp CI/CD & Cloud-Agent Readiness Audit" or the document titled "Cursor /goal for large refactors + CI/CD design" under `.buildpad/documents/` or `.buildpad/blobs/`) and the document titled "Master execution plan: docs, code, and CI/CD overhaul". Use `rg -l` across `.buildpad/` if the exact filename doesn't match the title.

This is Phase 1 of Wave 0 — CI/CD gate fixes only. Work interactively with me, don't just barrel through — pause and show me the diff before moving to the next item, especially item 2.

Also, while you're in here: make sure `.buildpad/` is excluded from every new tool you add today — jscpd, dependency-cruiser, and the ESLint response-schema rule should all ignore it (it's planning data, not source). Confirm it doesn't trip docs-spec-sync either way, since it's neither docs/ nor spec/ nor typical source.

1. **Fix the docs-spec-sync gate.** It currently requires every non-doc PR to also touch docs/ or spec/, with zero exemption besides dependabot — this will permanently block pure-code consolidation PRs later in this project. Add a real exemption: either a label (e.g. `no-doc-change-needed`) that bypasses the check, or scope the requirement to only fire when specific source paths change. Show me the options before implementing.

2. **Review policy decision — don't implement this one, just present it to me.** Right now `main` requires no human approval, and the only review gate that exists (a pre-push hook) is Claude-Code-specific and won't apply to work done in Cursor or by any other tool. Lay out the actual options (require 1 approval on main temporarily; port the review logic into a CI check; or accept manual review as the only gate) with the tradeoffs, and wait for me to pick before touching branch protection.

3. **Promote `web-tests` to a required check** in the branch protection script — it currently runs but doesn't block merge, and later work will touch packages/hooks, which only this suite covers.

4. **Add four new quality gates, each with the rollout posture below (don't skip the posture — wrong posture here creates a wall of red):**
   - dependency-cruiser boundary linting — hard/required gate immediately, generate the baseline file first via `--ignore-known` so existing violations are grandfathered.
   - SDK-drift check — hard/required gate immediately (regenerate the SDK and `git diff --exit-code`; layer in oasdiff for breaking-change detection). No existing-failure problem here, safe to require now.
   - `@darraghor/eslint-plugin-nestjs-typed`'s response-schema rule — add it but set to `"warn"`, not `"error"`, until the route backfill (a later phase) clears the backlog.
   - jscpd duplicate-detection — add it as advisory only, with a repo-wide duplication-percentage threshold set just above whatever the current measured level is (jscpd has no clone-level baseline, this threshold is the workaround).

5. **Fix the broken coverage tooling** — resolve the minimatch/test-exclude version collision blocking `test:cov`, and add the missing `@vitest/coverage-v8` dependency so coverage can actually be measured somewhere in the monorepo.

Show me a summary after each numbered item, not just at the end.