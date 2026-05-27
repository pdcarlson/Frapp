# Orchestrator playbook

This is the operating manual for the **orchestrator chat** — the long-running session that watches PRs, reviews chunks, files issues, folds improvements back into briefs, and writes kickoff prompts for the next chunk. The orchestrator does not write chunk code itself; that's the cloud-agent sessions' job, scoped by chunk briefs.

## Scope discipline (read this first)

A single orchestrator session is **scoped to a span of related chunks** (e.g. "chat phases 04–05", "settings phases 06–08", "ops phases 10a–10h"). Do **not** let one orchestrator chat carry the whole redesign — context bloats, decisions drift, and the value of the in-repo plan (anyone can pick it up cold) gets quietly undermined.

Hand off to a new orchestrator at a natural boundary (a set of chunks shipped, or a clean break before a different cluster). The handoff itself is a small docs PR (this playbook + any updates to TRIAGE.md, STATUS.md, or chunk briefs) followed by a short kickoff prompt for the next orchestrator.

## Artifacts (read in this order when you start)

1. `docs/internal/redesign/README.md` — operating conventions for chunk agents (Step 0, visual-baseline discipline, ownership of state transitions).
2. `docs/internal/redesign/master-plan.md` — product positioning, hot-path architecture, theming model, and the **Engineering principles** section (governs every line of code in every chunk).
3. `docs/internal/redesign/STATUS.md` — current state of every chunk (and its known blockers / notes).
4. `docs/internal/redesign/TRIAGE.md` — automation-filed issues mapped onto chunks (or out-of-scope).
5. `docs/internal/redesign/REVIEW_CHECKLIST.md` — the per-PR review rubric.
6. `AGENTS.md` (repo root) — branch model, doc-sync mandate, GitHub-issues workflow, label taxonomy.
7. The chunk briefs you'll own (`chunks/NN-*.md`).

## Cadence — what to do at each event

### A chunk PR opens

- Pull PR metadata, files, CI status. **Verify against the diff, not the PR body.** PR bodies are claims; code is truth.
- Run REVIEW_CHECKLIST against it. Top failure modes seen so far:
  - Service-role / RLS-bypassing writes on client-supplied IDs without an authorization pre-check (Chunk 02 shipped two of these — #233, #234).
  - Read-then-insert TOCTOU dedup that 500s on the race (Chunk 02 chat-react).
  - "Verified" boxes ticked that were actually blocked by the sandbox (no Docker → no Supabase).
- Small fixes the author can apply → push back, ask them to update the branch. Larger or blocking findings → **file an issue** (agent-ready format from AGENTS.md), add it to the chunk's STATUS row, and reference it in the next chunk's brief if it gates that chunk.
- Triage CodeRabbit / automation threads: identify **stale** ones (flagged on a pre-fix commit, never marked resolved), **wrong** ones (e.g. lowercasing case-sensitive PostScript font names), and the real ones. A real CRITICAL about SQL/RLS/auth is a blocker — file it, never just ride along.

### A chunk PR merges

- Reconcile STATUS: flip the merged chunk to `shipped`. If you (the orchestrator) aren't the one merging, the **next chunk's Step 0** will reconcile it — that's by design, documented in README operating conventions.
- If scope diverged from the brief, confirm the brief/master-plan was edited in the merging PR (the plan rule). If not, file a tiny docs PR to reconcile.
- If runtime verification was BLOCKED in the sandbox, confirm the linked tracking issue exists (#235 is the canonical CI runtime-verify issue) and the verification boxes were marked blocked, not falsely ticked.
- Sweep newly-introduced patterns into future-chunk briefs if they reveal a constraint discovered late (e.g. "validation pkg already exists" was discovered post-Chunk 01 and folded into Chunk 02's brief).

### Cursor's "Suggestion Triage" automation files a batch

(Issues with labels `suggestion` + `area:*` + `severity:*`, from the bot configured in `docs/internal/CURSOR_AUTOMATIONS.md`.)

- Map each issue to a chunk (or `standalone` / `out-of-scope`) in `TRIAGE.md`. Don't let unmapped suggestion-bot issues accumulate.
- For each `severity:critical` or `severity:high` security/auth finding: verify it against the code yourself (automations can hallucinate); if real, add it as a blocking-prerequisite reference in the chunk it gates.
- The orchestrator's job is to **triage and deduplicate**, not amplify noise. Issues filed by humans/orchestrator (e.g. #233 for the Edge Function layer) and bot issues (e.g. #242 for the NestJS layer) may be complementary, not duplicates — read carefully before closing.

### A blocker is discovered mid-flight (mid-chunk-session)

- File an issue immediately (AGENTS.md issues format). Reference the originating PR/chunk. Update the chunk brief's blocker list.
- If the blocker is a security hole that's **not yet exploitable** (e.g. scaffold not wired), say so explicitly — and label/title the issue as blocking the chunk that *would* expose it (e.g. "blocks Chunk 04").

### Ready to kick off the next chunk

Write a kickoff prompt. Pattern, refined across prior chunks:

1. **Step 0 — baseline + bookkeeping:** `git fetch`/`pull` main; sanity-check the prerequisite files exist (so the agent doesn't start against stale main); reconcile STATUS (flip previous chunk to `shipped` if needed; mark current chunk `in progress`).
2. **Step 1 — read order:** README, master-plan + Engineering principles, chunk brief, REVIEW_CHECKLIST, AGENTS.md issues section, the specific surfaces the chunk touches.
3. **Step 2 — parallel Explore agents** for codebase research, one message multiple Agent calls. List the agents and what each should report.
4. **Step 3 — ambiguity handling:** explicit `AskUserQuestion` triggers; don't guess.
5. **Hard constraints** specific to the chunk (e.g. "do not call the chat-send Edge Function until #233 is resolved").
6. **Operating bar:** the chunk-specific Engineering-principle applications, restated.
7. **Verification:** the brief's checklist + the no-faking-blocked-boxes rule.
8. **Anti-shortcuts:** explicit list (no `--no-verify`, no remote Supabase mutations, one chunk per PR, edit the plan if reality disagrees).
9. **End-of-turn summary requirement.**

Hand the prompt to the user; they paste it into a fresh cloud-agent session.

## What the orchestrator does NOT do

- Write chunk code — that's the cloud-agent session's job.
- Apply migrations to remote Supabase via MCP (banned).
- File issues for trivial nits a chunk author could fix in their PR.
- Re-derive decisions already recorded in `master-plan.md` (theming, mono font as system stack, `/home` deleted in Chunk 03, etc.) — read the docs first.

## Hand-off protocol

When you're done with your scope of chunks (or the conversation has grown long enough that context cost > continuity value), hand off cleanly:

1. Update this playbook if a new operating pattern emerged worth recording.
2. Update `TRIAGE.md` with any new automation backlog.
3. Reconcile the active chunk briefs (blocker lists, scope adjustments) so the next orchestrator inherits accurate briefs.
4. Open a docs PR with the above.
5. Write a short kickoff prompt for the next orchestrator that says: which chunks they own, that they should read these artifacts in this order, and that their first concrete task is `<X>`. Keep it tight — the new orchestrator should do its own research, not inherit yours.
