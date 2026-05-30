# Chunk 12 — Marketing site refresh + free tier signup CTA

**Depends on:** Chunk 03 (wizard) — the signup CTA hands off into the wizard.
**Unblocks:** —

## Read first

1. `spec/redesign-context.md` — *Product positioning*.
2. `apps/landing/` — existing marketing site structure.
3. `spec/ui-landing.md`.
4. Chunk 01 theme tokens (bone/bronze/ink) — apply the same palette.

## Branch

`claude/redesign-chunk-12-marketing` — from `main`.

## Goal

Align the marketing site with the chat-first positioning and route signups directly into the Chunk 03 onboarding wizard.

## Tasks

1. **Hero rewrite:**
   - Headline: "Chapter chat that just works. Free."
   - Sub: "Add ops when you're ready."
   - Primary CTA: "Start your chapter" → routes to `/sign-up` → wizard.
2. **Apply bone/bronze/ink palette** consistently across the site.
3. **Reposition the features section** so chat is the headline and ops modules are a secondary "what's possible when you upgrade" grid.
4. **Pricing section:**
   - "Free forever" tier: chat + members + announcements + audit log.
   - "Chapter Pro" tier (price TBD per master plan open questions): all ops integrations + 14-day trial.
5. **Trust signals:** member-visible audit log, real free tier, chapter-controlled customization.
6. **Spec updates:** `spec/ui-landing.md` (hero, features, pricing copy).

## Verification

- [ ] Marketing site renders with bone/bronze/ink palette.
- [ ] Primary CTA on hero routes to the wizard (Chunk 03).
- [ ] Pricing section accurately reflects the free/paid split from the master plan.
- [ ] Screenshots in light + dark mode.
- [ ] Lighthouse score not worse than the existing site (run before/after).

## Handoff

- Branch `claude/redesign-chunk-12-marketing`. PR title `Chunk 12 — Marketing refresh`.
- Status tracking: the issue's open/closed state is the status — close it via `Closes #N`. When this chunk ships, flip its row in the `spec/README.md` roadmap table (the source-of-truth status table). No project-board move.
