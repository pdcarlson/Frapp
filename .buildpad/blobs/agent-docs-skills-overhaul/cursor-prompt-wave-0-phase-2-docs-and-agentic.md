Important constraint before anything else: AGENTS.md, everything under spec/, and everything under .claude/ are Claude-Code-facing artifacts. You (Cursor) are just the tool editing them right now — do not add any mention of Cursor, Cursor rules, or Cursor-specific behavior anywhere in these files. Write them exactly as if Claude Code is the only tool that will ever read them.

Our full Buildpad research canvas is committed in this repo under `.buildpad/` (blobs/, documents/, notes/) — Paul syncs it periodically. Before starting, find and read the document titled "Claude Code audit: agent docs & skills structure (Aug 19)" and "Master execution plan: docs, code, and CI/CD overhaul" under `.buildpad/`. Use `rg -l` if filenames don't match titles exactly. Note: the canvas also contains unrelated product/feature research (branding, future features, etc.) — ignore anything outside what this prompt asks for, it's not part of this task.

Work through this in order, pause after each item and show me the diff — several of these are judgment calls, not mechanical fixes, and I want to weigh in before you commit to a direction.

One more item to add to the list below: add a short section to AGENTS.md noting that `.buildpad/` exists as a research/planning archive (not a spec, not authoritative, may contain stale or superseded ideas) — read the relevant file when a task references it, don't treat its contents as current product decisions unless cross-checked against actual spec/code.

1. **Rewrite AGENTS.md.** Cut the ~12 lines the audit flagged as "things I'd do correctly without being told." Collapse or delete the ~35 lines of one-off incident narration (specific past PR numbers, dated outage references, the full send_later archaeology) — keep only the durable rule that survives if you strip the story around it. Move the 62-line "filing follow-up work" section out into a skill rather than the always-loaded file. Target under ~200 lines total when done. Show me a before/after line count.

2. **Add ADR discipline as an explicit rule in AGENTS.md.** One-off incidents and decisions get logged once in an immutable, append-only ADR (never edited, only superseded) — a rule only gets promoted into AGENTS.md itself if it's genuinely recurring, still-true, and something the agent wouldn't derive on its own by reading the code.

3. **Resolve the spec-vs-code precedence contradiction.** AGENTS.md currently says code is ground truth for behavior; README.md and spec/behavior/README.md both say the spec is the single source of truth. Replace all three with one consistent formulation: spec = source of truth for intended behavior, code = source of truth for current behavior, and disagreement between them is a tracked bug to file, not something an agent silently resolves by picking whichever doc loads first.

4. **Fix spec/product/positioning.md.** Delete or rewrite its stale "Visual Identity: Modern Ivy" section (royal blue, Geist Sans, slate background) — it directly contradicts spec/ui/brand-identity.md, which is the current, correct, shipped direction. Point positioning.md at brand-identity.md instead of duplicating values.

5. **Decide spec/behavior/meetings.md's fate — ask me first, don't just pick.** It's a fully-specced but zero-built product design, and ai.md cites it as the first item in its AI corpus, which is actively misleading since nothing is built or queued. Present the two options (commit it to the roadmap, or quarantine it explicitly and fix ai.md's corpus reference) and wait for my call.

6. **De-duplicate the routine-skill boilerplate.** issue-curator, pr-followups, issue-triage, and diff-review each independently restate the same ownership boundary (issues live on GitHub, only touch suggestion-labeled issues, never modify product code, never open feature PRs). Factor this into one shared reference file the routine skills point to instead of each restating it.

7. **Add check-our-docs to the skills table in AGENTS.md** — it exists and works, it's just undocumented, so it's currently only found by auto-discovery.

8. **Write two new skills:** a Signet-surface-cutover checklist (which tokens are current vs legacy, that a cutover deletes what it replaces, which reference board is visual truth — pull the specifics from the docs audit) and a realtime-resilience skill (the rules that would have prevented the same bug being fixed twice, two weeks apart — check spec/ui/resilience.md for the substance).

9. **Sweep dead references:** the 21 permission entries in .claude/settings.json documented as inert but never removed; the stale Linear references outside the legitimate ADR ones; the stale "chunk 10a-10h" references; the "4 apps, 7 shared packages" count in README.md and AGENTS.md (it's actually 13 packages now).

10. **Resolve the next.md vs GITHUB_PM.md split-brain** — next.md's own frontmatter admits "where they disagree, the doc wins and this file is the bug." Reconcile them, and consider whether next.md (641 lines) should become a skill instead of a command.

Show me a running summary as you complete each item, and flag anything where you're not sure I want it done a certain way rather than guessing.