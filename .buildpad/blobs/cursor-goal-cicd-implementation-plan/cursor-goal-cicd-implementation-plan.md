# Cursor /goal + CI/CD implementation plan

Goal: figure out how to execute the combined docs+code refactor using Cursor's cloud agents alongside Claude Code, and update CI/CD to support it. **Cursor is a one-project tool, not a daily driver** — no permanent .cursor/ folder, no lasting footprint. Lucky break: AGENTS.md is already what Cursor reads automatically, so we don't need any Cursor-specific config files at all — put anything Cursor needs to know in AGENTS.md (which helps Claude Code too) or directly in each goal's prompt text, ephemeral.

**Real audit findings (Aug 19) — three hard blockers before any Cursor goal touches this repo:**

1. **docs-spec-sync will hard-block almost every Cursor PR.** It's a required check with zero exemptions besides dependabot — any PR touching non-doc files without touching docs/spec fails, permanently, no admin override. Every planned Cursor goal (date-fn merge, MIME consolidation, query-key migration, etc.) is a pure-code change. Must fix this gate first (e.g. a label-based or explicit "no doc change needed" exemption, per the earlier docs research) or literally nothing Cursor produces can merge.

2. **Zero review applies to Cursor's pushes.** The only review gate on `main` is a Claude-Code-specific local pre-push hook (Cursor won't run it), and `main` requires no human approval either. Right now a Cursor PR would get no review at all, human or AI, unless done by hand. Decision needed: either manually review every Cursor-originated PR before merge (no code change, just a personal rule), or temporarily require human approval on main during this project.

3. **The 33 Supabase repositories have zero tests — pull that consolidation out of the Cursor-goal bucket entirely.** Confirmed by the audit as the single highest-risk item: TypeScript can't catch a wrong `.eq()` column or a dropped tenant filter, and only 7 of 33 repos have any indirect coverage via one cross-tenant e2e spec. Do this piece in supervised Claude Code, or add real tests first — not as an autonomous fire-and-forget goal.

Also: promote `web-tests` to a required check before any goal touches `packages/hooks` (currently a red hook-test suite still merges); tell any agent explicitly never to regenerate Playwright visual snapshots locally (baselines are pinned to CI's Chromium, a local regen silently corrupts the fixture); coverage is currently unmeasurable repo-wide (broken tooling, two separate causes) — not a blocker, but can't sanity-check a big refactor's impact until fixed.

**Good news:** everything else is unusually solid. Clean checkout runs all 3,796 tests with zero credentials needed — genuinely ready for a cloud agent on the mechanical axis. No merge queue exists (pr-base-sync.yml is a hand-rolled agent-wake substitute, capped at 20 PRs), but that's a lower-priority gap given the planned cap of 3-5 concurrent goals.

---

**Correction on terminology:** Cursor's cloud/PR-opening feature is actually called "Cloud Agents" (formerly Background Agents); "/goal" is a separate CLI durability primitive ("continues across idle/headless runs"). They're complementary, not the same thing — worth confirming hands-on whether durable-goal behavior actually applies inside the cloud-agent PR flow before relying on it.

**Research verdict:** split by task shape, inverted from the usual split since here the judgment work is docs and the mechanical work is code:
- Claude Code (local, supervised): all doc/AGENTS.md judgment work, deciding which incidents graduate to ADRs vs rules, authoring the 2 new skills, and all shared-foundation/gate-defining changes (Wave 0) — now also including the Supabase repository work per the audit above.
- Cursor cloud agents (isolated, fire-and-forget): the disjoint mechanical consolidation jobs — date-fn merge, MIME allowlist merge, dead package deletion, shim-import rewrite, query-key call-site migration, route-DTO backfill in batches — each fenced to its own files with an explicit test-pass stop condition in the prompt.

**Sequencing:** Wave 0 (you, serialized) fixes the docs-spec-sync gate, decides the review policy, wires the 4 new CI gates, and builds the shared factories first. Wave 1 (parallel Cursor goals from merged main, cap 3-5) does the disjoint mechanical jobs. Wave 2 (batched Cursor goals) does the DTO backfill ~10 routes at a time.

**Gate rollout reality check:** dependency-cruiser and the SDK-drift check both have real baseline mechanisms and can be hard gates immediately. The ESLint response-schema rule has no native baseline — set to "warn" first, backfill via Wave 2, then flip to "error." jscpd has no clone-level baseline — use a repo-wide duplication-percentage threshold that only ratchets down, kept advisory at first.

**Cost control:** Cursor has no per-run or per-goal cost/time cap, only a monthly spend limit plus manual cancellation — real runaway-bill reports exist ($28→$500 in 3 days). Set a conservative monthly spend limit (~$50-75) before starting.

**Also needed:** merge queue must trigger on `merge_group` (not just pull_request) or required checks never fire; job names must be unique and match exactly across workflows or checks silently block merges.