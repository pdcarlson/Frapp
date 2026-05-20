# Chat-first redesign — execution plan

This directory is the single source of truth for the in-progress redesign of `apps/web` (and downstream `apps/mobile`, `apps/landing`) into a chat-first chapter platform. It exists so any fresh Claude Code session — including cloud agents that start in a clean container — can pick up the work without losing context.

> **Why this matters:** cloud-agent VMs are ephemeral. Anything written to `/root/.claude/plans/` or other home-directory paths is lost when the container is reclaimed. Plans must live in the repo to survive across sessions.

## Read order for a fresh session

1. **`master-plan.md`** — product positioning, system architecture (hot vs cold path, Edge Functions, optimistic+offline chat client), theming model, full chunk list. Treat this as canonical context.
2. **The specific chunk brief you've been assigned** (`chunks/NN-*.md`). Each chunk brief is a self-contained prompt: read these files, build this, verify like this, commit & push to this branch.
3. **`AGENTS.md`** at the repo root and the linked playbooks (`.cursor/skills/`). Standard operating context — branch model, doc-sync mandate, secrets policy.
4. Files explicitly listed under the chunk's "Read first" section.

Do **not** start coding from a vague "redesign Frapp" prompt. Always work a specific chunk. If you don't know which chunk to start, work the lowest-numbered chunk whose dependencies are complete.

## Chunk dependency graph

```
01 Foundation (theme + shell)
   ↓
02 Data model + Edge Function scaffold
   ↓
03 Onboarding wizard ─────────┐
   ↓                          │
04 Chat foundation + hot path │
   ↓                          │
05 Chat integrations + push   │
   ↓                          │
06 Settings shell ────────────┘ (uses 02's data model)
   ↓
07 Settings customization (Theme + Roles + Fields + Workflows + Dues)
   ↓
08 Settings Beta + Audit + ops-setup nudges
   ↓
09 Members directory + custom fields rendering
   ↓
10 Ops integrations (10a Events → 10h Onboarding pathway, mostly parallelizable after 05)
   ↓
11 Mobile chat parity (depends on 04 + 05)
   ↓
12 Marketing site refresh (depends on 03 for signup CTA)
```

Chunks 10a–10h can be parallelized across sessions once Chunk 5 is shipped. Everything else is sequential.

## Operating conventions for chunk sessions

- **Branch per chunk.** Create `claude/redesign-chunk-NN-<slug>` from `main`. Never push directly to `main` or `production`.
- **Read the spec docs the chunk lists before writing code.** Each chunk lists specific `spec/*.md` and `docs/*` files that constrain its work.
- **Update spec docs in the same PR.** Frapp's doc-sync mandate requires every non-doc PR to update at least one file under `docs/` or `spec/`. The chunk briefs list which specs each chunk should touch.
- **Verification is non-negotiable.** Each chunk has a verification checklist. Don't open a PR with the checklist incomplete; surface what didn't work in the PR body instead of pretending it did.
- **Reference this plan in your PR body.** `Implements docs/internal/redesign/chunks/NN-<slug>.md.` That keeps the trail back to the master plan.
- **If you make a scope decision that diverges from this plan, edit the plan in the same PR.** The plan is the source of truth, not your in-flight assumptions.

## Status tracking

`STATUS.md` (peer to this README) tracks which chunks are: not started / in progress / shipped. Update it when you start a chunk and when you merge it. Treat it as the at-a-glance dashboard for the redesign.

## When the plan is wrong

The plan is a forecast, not a contract. If a chunk's assumptions don't survive contact with the code, push back: edit the chunk brief, edit the master plan, leave a note in `STATUS.md`, and pick up from the corrected plan. Future sessions will read what you left, not what was originally written.
