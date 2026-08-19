# Prompt-level guidance for long-horizon, context-heavy Cursor consolidation goals

**Bottom line up front.** For a detailed, ranked consolidation queue, the reliability pattern that the evidence supports is: **commit the audit as a plain markdown plan file in the repo (not under `.cursor/`), have each goal prompt point the agent at only its relevant section and instruct it to read that first, then work through an agent-maintained checklist with a verification gate at every sub-step, ending in a hard "prove zero remaining references" definition-of-done.** Do not inline the full audit into the prompt — long inputs measurably degrade recall (the "lost in the middle" effect drops accuracy >20% when key detail lands mid-context [arxiv](https://arxiv.org/abs/2307.03172), and controlled tests show reasoning accuracy falling from ~0.92 to ~0.68 as inputs grow even a few thousand tokens [tmls](https://www.tmls.nyc/research/context-rot-mechanistic)). Cursor compounds this: on long runs it silently compresses older turns into a lossy summary, and Cursor itself warns "the agent's knowledge can degrade after summarization" [cursor](https://cursor.com/blog/dynamic-context-discovery) — which is exactly when a multi-hour agent forgets your file-fence and stop conditions. Every mitigation below is aimed at keeping the *active* working set small and the *durable* plan/progress on disk. None of it requires permanent Cursor-specific config: AGENTS.md and a scratch `REFACTOR-PLAN.md` are both tool-neutral repo files you can delete when the project ends.

---

## 1. Inline vs. reference file: commit the audit as a plan file, don't paste it into the prompt

**The evidence is one-directional here.** Detailed, high-precision content (your file:line citations, exact function names, per-item counts) is precisely the kind of material that suffers most when buried in a large prompt. Two independent effects apply:

- **Position ("lost in the middle"):** models use information at the very start and very end of their input far more reliably than the middle; forcing relevant evidence into the middle can cost >20% accuracy versus best-case placement [arxiv](https://arxiv.org/abs/2307.03172) [stanford](https://cs.stanford.edu/~nfliu/papers/lost-in-the-middle.arxiv2023.pdf). A 10-item audit pasted inline puts items 4–7 squarely in the dead zone.
- **Length ("context rot"):** accuracy declines as total input grows *even when the evidence is fixed and well-placed*, driven by attention dilution — a fixed attention budget spread over more tokens [trychroma](https://research.trychroma.com/context-rot) [tmls](https://www.tmls.nyc/research/context-rot-mechanistic). Distractors (the other 9 items when the agent is working item 1) make this worse [trychroma](https://research.trychroma.com/context-rot).

**The documented fix is externalized, just-in-time context.** The canonical vendor pattern is a file the agent reads at session start — Claude Code's `CLAUDE.md` is loaded into context every session for exactly this , and Anthropic's explicit guidance is to keep that file *concise* and push detail into scoped files that load only when relevant, because the file consumes tokens like anything else [claude](https://code.claude.com/docs/en/memory). Manus generalizes this to "the file system as ultimate context" — the agent reads and writes files on demand as external memory rather than holding everything in the window [manus](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus). Anthropic frames the same move as structured note-taking / "agentic memory" persisted outside the context window and pulled back when needed [anthropic](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents).

**How Cursor specifically reads files — this shapes your mechanics:**
- Cursor auto-reads `AGENTS.md` at the project root (and nested ones) and applies it as rules alongside `.cursor/rules` [cursor](https://cursor.com/docs/cli/using) [cursor](https://cursor.com/docs/rules). Put your *cross-cutting invariants* (test/lint/typecheck commands, "never touch files outside the fenced set," PR expectations) here — it's tool-neutral and helps Claude Code too.
- **A plain `.md` file inside `.cursor/rules` is ignored** — only `.mdc` rule files are read there [cursor](https://cursor.com/docs/rules). So your `REFACTOR-PLAN.md` should live at repo root or a normal docs path, *not* in `.cursor/`. This also keeps it tool-neutral and deletable, matching your "no permanent Cursor config" requirement.
- You force a specific file into context with an `@`-mention in the prompt (`@REFACTOR-PLAN.md`, `@src/utils/date.ts`) [cursor](https://cursor.com/docs/agent/prompting). This is the reliable "read this first" lever.
- **Caveat:** the `@filename` cross-include *inside* `.mdc` rule files is reported broken ("doesn't work yet," confirmed by Cursor staff) [cursor](https://forum.cursor.com/t/does-file-syntax-works-in-mdc-rules/135663). Don't rely on a rule file pulling in your plan; `@`-mention the plan directly in the goal prompt instead.
- **Cursor does not document an enforced "read this, then act" ordering** beyond `@`-mentions and the plan-approval flow [cursor](https://cursor.com/docs/agent/prompting). So you enforce ordering with explicit prompt steps, not a platform guarantee.

**Concrete recommendation.** Commit a scratch `REFACTOR-PLAN.md` containing the full ranked queue with all file:line detail. Each goal prompt then carries only: (a) an `@`-mention of the plan, (b) an instruction to read *only its assigned section*, (c) the file fence, and (d) the stop/verify conditions inline (short, high-value, and placed at the *end* of the prompt where recall is strongest). This keeps each goal's active prompt small while the precision detail stays on disk to be pulled just-in-time. Delete the file when the project ends — no residue.

---

## 2. Keeping a long goal from drifting: an agent-maintained progress file + per-step verification

Drift over a long run is real and well-documented, both in principle and in Cursor specifically. Practitioners report agents "forgetting hard constraints" and re-asking for already-provided info after roughly **30–40 turns** ^[reddit](https://www.reddit.com/r/AI_Agents/comments/1ttgkg9/my_agent_kept_forgetting_things_midconversation/ "r/AI_Agents on Reddit: My agent kept \"forgetting\" things ..."), and on Cursor cloud agents specifically, users report "context collapse, scope drift, and failure to honor explicit stop constraints," which a reply attributes directly to older turns being "compressed into a running summary — constraints fade" [cursor](https://forum.cursor.com/t/agent-with-confusion-hallucinations-and-mutiny-100-broken/168293). This is the mechanism to design against.

**Technique A — have the agent maintain its own progress/checklist file (the "recitation" pattern).** This is the single most-cited long-horizon durability technique. Manus creates and *constantly rewrites* a `todo.md`, checking off items step by step, specifically to "recite" the plan into the end of the context so the global goal stays in recent attention and to "avoid lost-in-the-middle issues" and reduce goal misalignment [manus](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus). The community independently converged on the same habit: the "Ralph loop" tracks progress in `progress.txt` and checkpoints each phase for overnight runs [reddit](https://www.reddit.com/r/ClaudeCode/comments/1r4kdfk/how_to_run_claude_code_contionously_till_the_task/); others use a `tasks.md` with acceptance criteria that Claude ticks off [reddit](https://www.reddit.com/r/ClaudeCode/comments/1uf1pib/claude_code_keeps_wandering_off_on_big_projects/) or move feature files from `features/` to `features/implemented` as an audit trail [reddit](https://www.reddit.com/r/ClaudeCode/comments/1v91nk4/what_task_tracker_are_you_using_with_claude_code/).

**Cursor gives you three native hooks for this**, so you don't have to invent it:
- **Plan Mode** produces an editable markdown plan; plans save to your home dir by default and can be "Save to workspace" into `.cursor/plans/` [cursor](https://cursor.com/docs/agent/plan-mode) [cursor](https://cursor.com/blog/agent-best-practices). (Note: that path *is* under `.cursor/` — for your no-residue goal, prefer a plain-path progress file.)
- Cursor's agent maintains a structured todo list with per-item `status` (`pending | in_progress | completed | cancelled`) via its ACP protocol [cursor](https://cursor.com/docs/cli/acp) — the checklist is a first-class object, though a forum report notes the panel sometimes fails to populate [cursor](https://forum.cursor.com/t/to-do-lists-not-appearing-in-agent-mode-despite-feature-enabled/114317), so don't depend on the UI; instruct the file explicitly.
- Cursor's *own* long-running-agent example uses a hook that reads/writes a persistent `.cursor/scratchpad.md` and drives continuation with a `followup_message`, e.g. "Update `.cursor/scratchpad.md` with DONE when complete" [cursor](https://cursor.com/blog/agent-best-practices) — a direct template you can adapt to a plain-path file.

Example phrasing to drop into a goal prompt:
> "Before starting, create `REFACTOR-PROGRESS.md` listing each of the N target files from the plan section as an unchecked item. After you finish each file, check it off in that file with a one-line note of what changed and the test result. If you are ever unsure what remains, re-read `REFACTOR-PROGRESS.md` and continue from the first unchecked item. Do not consider the goal complete until every item is checked."

**Technique B — verification at every sub-step, not only at the end.** The documented anti-pattern is "looks done"; the fix is to give the agent a *runnable* pass/fail check it must satisfy before advancing [claude](https://code.claude.com/docs/en/best-practices). Anthropic describes three escalating gating modes: run-and-iterate inside one prompt, set the check as a `/goal` condition that a separate evaluator re-runs **after every turn**, or enforce it with a deterministic Stop hook [claude](https://code.claude.com/docs/en/best-practices). For a consolidation queue, bind the check to *each item*, not the whole run:
> "After migrating each file, run `pnpm typecheck && pnpm test --filter <package>`. Do not move to the next file until it passes. If it fails after 3 fix attempts, revert that file, mark it BLOCKED in `REFACTOR-PROGRESS.md`, and continue with the next item."

This per-item gate both prevents late-run drift (the goal is re-anchored every item) and stops one bad item from cascading — the community's exact argument for step-by-step over batch: the token cost of catching a mistake *after* it propagates through many changes is far higher than checking after each [reddit](https://www.reddit.com/r/ClaudeCode/comments/1rte8cq/whats_better_when_applying_a_lot_of_changes/).

---

## 3. One large multi-item goal vs. several small goals

**The decision rule that emerges: split by dependency and blast radius, not by convenience.** The consistent practitioner verdict for a long change-list is *not* one mega-prompt. Advice converges on batching ~5–7 related changes per session with a clear outcome each [reddit](https://www.reddit.com/r/ClaudeCode/comments/1rte8cq/whats_better_when_applying_a_lot_of_changes/), and warns that mega-prompts waste tokens because the model re-parses the whole project and you re-spend to fix what broke [reddit](https://www.reddit.com/r/ClaudeCode/comments/1rte8cq/whats_better_when_applying_a_lot_of_changes/). Anthropic frames the split by task characteristic: compaction suits long back-and-forth, structured note-taking suits *iterative development with milestones* (your case), and multi-agent suits parallel exploration — and multi-agent pays a real cost (~15× tokens for its research system, justified only by a 90.2% quality gain on hard research tasks) [anthropic](https://www.anthropic.com/engineering/multi-agent-research-system). Smaller, task-focused agents were also found more reliable in practice because "failures were more contained and easier to debug" [reddit](https://www.reddit.com/r/AI_Agents/comments/1q0ud51/is_it_one_big_agent_or_subagents/).

**Applied to your ranked queue:**
- **One goal per *independent* consolidation item** (date-fn merge, MIME allowlist merge, dead-package deletion) — these touch disjoint files and have clean per-item test gates. This is the default.
- **One goal covering *several* items only when they're genuinely the same mechanical shape and disjoint from each other**, worked via the progress-file checklist (§2) so each is individually verified. This is reasonable up to ~5–7 items; beyond that, context accumulation and drift risk rise faster than the coordination savings.
- **Never** bundle items with internal dependencies into one undifferentiated goal without explicit internal gating (§5).
- **Batch the truly repetitive backfill** (e.g. route-DTO backfill) into goals of ~10 units each, as your prior plan already concluded — repetitive, objective, and cheap to re-run.

The tell that a goal is too big: if you can't write a single, checkable stop condition that proves the *whole* goal is done, it's actually several goals.

---

## 4. Definition-of-done for consolidation refactors: force "prove zero stragglers," don't accept "I migrated everything"

This is where refactor goals differ most from feature goals, and where agents most often declare false victory. The documented techniques all replace self-assessment with a mechanical, zero-tolerance check.

**Call-site completeness — the core move is a re-run search that must return nothing.** The established pattern: preview all matches first (`rg "oldFn" --type ts`, count affected files), do the migration, then **re-run the identical search and require zero matches** as the completion criterion — "should return nothing" [pocketcmds](https://pocketcmds.com/skills/ripgrep/ripgrep-replace-refactor). For structural (not text) matches, `ast-grep scan` exits `0` when no rule matches and `1` when any match remains (at error severity), giving you an exit-code-based "old pattern must be zero-match" gate [ast-grep](https://ast-grep.github.io/reference/cli/scan.html). AST-based codemods (ast-grep `--update-all`, jscodeshift's `forEach`/`replaceWith` over the whole matched collection) operate over *every* match in the tree, not a sample [ast-grep](https://ast-grep.github.io/reference/cli) [jscodeshift](https://jscodeshift.com/build/api-reference/) — worth telling the agent to prefer over hand-editing when the pattern is regular.

**Typecheck as a completeness signal, not just a correctness one.** The strongest guarantee for "every caller migrated" is to *delete the old export and let the compiler enumerate the stragglers* — "periodically try removing the code… to have your compiler show you the remaining uses" [viktorstanchev](https://viktorstanchev.com/posts/how-to-break-up-a-large-code-refactor/). TypeScript's `noEmit` typecheck is the automated gate for this . A boundary lint rule (`no-restricted-imports` on the old module path) makes *any* leftover importer fail the build permanently, converting "partial migration" from a silent state into a red gate [eslint](https://eslint.org/docs/latest/rules/no-restricted-imports).

**Before/after behavior preservation.** The definition of a done refactor is that "the test suite that passed before should pass after, unchanged" — and the corollary is "no safety net, no refactor" [sourcegraph](https://sourcegraph.com/blog/code-refactoring-techniques). Require the agent to record the pre-change test result and the post-change result, plus a `git diff` review step as reviewable evidence [pocketcmds](https://pocketcmds.com/skills/ripgrep/ripgrep-replace-refactor).

**A copy-pasteable DoD block for a consolidation goal:**
> "Definition of done — all must hold before opening the PR:
> 1. A single shared implementation exists in `packages/date-utils`; all 27 duplicate definitions are deleted.
> 2. Every call site is migrated. Prove it: run `rg 'formatDate|fmtDate|toDisplayDate' --type ts` and confirm zero matches outside `packages/date-utils`. Paste the command output into the PR description.
> 3. `pnpm typecheck` passes with the old exports removed (a missing migration is a compile error).
> 4. `pnpm test` passed before your changes and passes after, unchanged. State both results.
> 5. `git diff` reviewed for unintended edits.
> If any check fails after 3 attempts, open a **draft** PR describing exactly what remains — do not open a normal PR."

The explicit "paste the command output" requirement is what forces verification over belief — the community's recurring complaint is agents saying "done" when the task is not ^[reddit](https://www.reddit.com/r/ClaudeCode/comments/1rwd8fa/why_ai_coding_agents_say_done_when_the_task_is/ "r/ClaudeCode on Reddit: Why AI coding agents say \"done\" when the ...").

---

## 5. Chaining dependent goals in Cursor: prefer merge-then-new-goal; gate internal dependencies explicitly

**The refactoring order for extract→migrate→delete is well established:** introduce the new abstraction, move callers over *one at a time* validating as you go, and delete the old implementation only "when its reference count hits zero" [sourcegraph](https://sourcegraph.com/blog/code-refactoring-techniques) [jhall](https://jhall.io/archive/2024/02/28/incremental-refactoring/). Old and new should coexist during migration (branch-by-abstraction), never add-and-remove in one step [viktorstanchev](https://viktorstanchev.com/posts/how-to-break-up-a-large-code-refactor/).

**Two valid ways to express this in Cursor, with a clear default:**

*Option A — one goal, ordered checklist with internal gates (best when the three phases are small and tightly coupled).* Because a long single run risks summarization drift (§2), make the phase boundaries hard gates in the prompt:
> "Phase 1: create the shared module and its tests. STOP and verify: the module compiles (`pnpm typecheck`) and its own tests pass. Do not proceed to Phase 2 until both pass.
> Phase 2: migrate every caller (see DoD zero-match check). Do not proceed to Phase 3 until zero callers reference the old implementations and full test suite passes.
> Phase 3: delete the old implementations. Verify typecheck + tests still pass."

*Option B — separate sequential goals, each started after the prior PR merges (best when phases are large or you want review between them).* This is the more robust default, and Cursor's model makes it clean: **each cloud agent clones from a starting ref, so an agent started before a dependency merges literally cannot see that code** — you sequence by merging Phase 1's PR, then starting Phase 2's goal from updated `main` (via `startingRef`) [cursor](https://cursor.com/docs/cloud-agent/api/endpoints). This was the recommendation in your prior plan and it holds.

**Cursor's chaining primitives (documented):**
- You can send **follow-up runs to an existing durable agent** — `POST /v1/agents/{id}/runs` reuses "the agent's current conversation and workspace state" [cursor](https://cursor.com/docs/cloud-agent/api/endpoints). But **only one run can be active per agent** (a run while another is active returns `409 agent_busy`) [cursor](https://cursor.com/docs/cloud-agent/api/endpoints), and cancel is terminal ("to continue the conversation, create a new run on the same agent") [cursor](https://cursor.com/docs/cloud-agent/api/endpoints). So follow-ups are strictly sequential.
- `startingRef` sets the base branch/SHA; `prUrl` attaches to an existing PR and *overrides* `startingRef`; `workOnCurrentBranch=true` pushes directly to the starting ref instead of a new `cursor/…` branch [cursor](https://cursor.com/docs/cloud-agent/api/endpoints). These are your levers for "start Phase 2 from Phase 1's branch" if you don't want to merge in between.
- **The `/goal` durability primitive is CLI-only in the docs** — it "continues the goal across idle and headless runs" and is gated/rolling out [cursor](https://cursor.com/docs/cli/changelog), but no Cursor doc couples `/goal` to the cloud-agent PR flow. Treat the cloud-agent surface as standard Cloud Agents with tightly-scoped prompts, not as durable `/goal` runs, until you verify durability applies there hands-on.

**Recommendation:** use Option B (merge-then-next-goal) as the default for the extract/migrate/delete dependency, because it gives you a human review checkpoint at each dependency boundary and sidesteps single-run summarization drift. Reserve Option A (one goal, internal gates) for small tightly-coupled trios where the whole thing finishes well before context pressure sets in.

---

## 6. Long-run degradation and cost: what actually breaks, and the mitigations

**What degrades and roughly when.** Beyond the 30–40-turn forgetting threshold ^[reddit](https://www.reddit.com/r/AI_Agents/comments/1ttgkg9/my_agent_kept_forgetting_things_midconversation/ "r/AI_Agents on Reddit: My agent kept \"forgetting\" things ..."), the deeper failure mode on *very* long runs is "summaries of summaries" — one operator found that by day 3 the agent was "making decisions based on summaries of summaries," and the fix that worked was **forcing periodic reload from the raw task spec** rather than carrying compressed context forward [reddit](https://www.reddit.com/r/AI_Agents/comments/1skur2q/has_anyone_run_an_agent_longer_than_a_week_what/) (single-anecdote but mechanistically consistent with the vendor findings). Advertised context windows also have an "effective length" well below nominal — reports place the usable region of a 1M-token window with a clear break around 300–400K [tmls](https://www.tmls.nyc/research/context-rot-mechanistic) (secondary source; treat as directional). Cursor's version of all this is its **lossy summarization step at window overflow**, which it explicitly warns degrades agent knowledge [cursor](https://cursor.com/blog/dynamic-context-discovery); its own remedy is to start a new conversation when effectiveness drops [cursor](https://cursor.com/docs/agent/prompting) [cursor](https://www.reddit.com/r/cursor/comments/1r1veb4/context_rot_in_cursor_whats_working_to_avoid/).

**Mitigations, in priority order for your use case:**
1. **Keep each goal short enough to finish before summarization triggers** — the strongest lever. This is the real argument for §3's per-item goals and §5's Option B.
2. **Progress file + reload-from-source (§2)** — the documented recovery for both interruption and summary-drift is to re-read the raw plan/progress file, not the compressed history [reddit](https://www.reddit.com/r/AI_Agents/comments/1skur2q/has_anyone_run_an_agent_longer_than_a_week_what/) [claude](https://code.claude.com/docs/en/memory). Anthropic's "memory tool" formalizes this: session 2 reads `/memories` first and re-reads far fewer source files, keeping peak context bounded [claude](https://platform.claude.com/cookbook/tool-use-context-engineering-context-engineering-tools).
3. **Compaction with a structured handoff, if a goal must be long.** Compaction summarizes near the limit and continues in a fresh window; in Anthropic's cookbook it cut a run's peak from ~335K to ~169K tokens [claude](https://platform.claude.com/cookbook/tool-use-context-engineering-context-engineering-tools). Codex's compaction is explicitly a "handoff memo" preserving "current progress and key decisions… remaining TODOs, and clear next steps" [justin3go](https://justin3go.com/en/posts/2026/04/09-context-compaction-in-codex-claude-code-and-opencode) — the content contract to mimic in your progress file.
4. **Phase splitting / checkpointing** (§5 Option B) — the community "Ralph loop" checkpoints each phase in `progress.txt` specifically to avoid mid-run context-limit failures [reddit](https://www.reddit.com/r/ClaudeCode/comments/1r4kdfk/how_to_run_claude_code_contionously_till_the_task/).

**Cost growth over long runs.** The dominant cost driver on long autonomous coding runs is not code output — one careful tracking exercise found ~90% of token cost is cache reads/writes that accumulate with conversation length, and the biggest lever is shorter conversations / fewer turns [reddit](https://www.reddit.com/r/ClaudeAI/comments/1s27dex/i_tracked_exactly_where_claude_code_spends_its/). A hands-on writeup describes the same compounding ("message 50 costs more than message 5… because it re-reads the entire history," calling long sessions "token furnaces") [buildtolaunch](https://buildtolaunch.substack.com/p/claude-code-token-optimization) (single source). This reinforces the earlier finding that **Cursor has no per-run cost cap — only a monthly spend limit and manual cancellation** — so short, fenced goals are your cost control as much as your quality control. Set the conservative monthly spend limit before starting.

---

## Putting it together: a reusable goal-prompt skeleton

A single template that combines all of the above for one consolidation item:

> **Context:** Read `@REFACTOR-PLAN.md`, section "[Item name]" ONLY. That section lists the exact files, function names, and counts. Do not read or act on other sections.
>
> **Scope fence:** You may only modify files under `[target package]` and the importing files listed in that section. Do not touch anything else. If the task seems to require editing files outside this set, stop and open a draft PR explaining why.
>
> **Progress tracking:** Create `REFACTOR-PROGRESS.md` listing every target file as an unchecked item. Check each off with a one-line note + test result after finishing it. If unsure what remains, re-read this file and continue from the first unchecked item.
>
> **Per-step gate:** After each file, run `[typecheck] && [scoped test]`. Don't advance until it passes; after 3 failed attempts, revert that file, mark it BLOCKED, and continue.
>
> **Definition of done (all required, paste evidence into the PR):** [the §4 DoD block — zero-match search output, typecheck with old exports removed, before/after test results, git diff reviewed].
>
> **Stop condition:** When every item is checked and all DoD checks pass, open the PR. If anything remains, open a DRAFT PR listing exactly what's left. Never claim done without the zero-match proof.

Keep the plan detail in `REFACTOR-PLAN.md`, keep cross-tool invariants in `AGENTS.md`, and put the short high-value stop/verify conditions at the *end* of each prompt where recall is strongest. Delete `REFACTOR-PLAN.md` and `REFACTOR-PROGRESS.md` at project end — nothing Cursor-specific persists.

---

## Where more research would most change this

Two open items are worth a hands-on check before you commit budget. First, **whether Cursor's `/goal` durability actually applies inside the cloud-agent PR flow** — the docs describe it only for the CLI [cursor](https://cursor.com/docs/cli/changelog), so if you're counting on "durable, cross-idle, headless" goals in the exact surface you'll use, confirm it empirically on one throwaway goal rather than assuming. Second, **Cursor's summarization trigger point in practice** — Cursor confirms summarization happens and warns it's lossy [cursor](https://cursor.com/blog/dynamic-context-discovery), but doesn't publish the token threshold; running one deliberately long goal and watching when the "Summarized conversation" context category appears would tell you exactly how many files per goal you can safely bundle (§3) before drift risk climbs.