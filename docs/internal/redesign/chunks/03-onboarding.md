# Chunk 03 — Onboarding wizard + chapter directory UX

**Depends on:** Chunk 02 (merged) — needs `chapter_directory` + search endpoint + `chapters` schema.
**Unblocks:** 12 (marketing CTA targets this), improves UX for 04/05/06 testing.

## Read first

1. `docs/internal/redesign/master-plan.md` — section *Chapter directory & onboarding wizard*.
2. Existing bootstrap UI to replace: `apps/web/components/.../chapter-bootstrap.tsx` (find via `grep -ri chapter-bootstrap apps/web`).
3. Existing auth flow: `apps/web/app/(auth)/**` — understand sign-up callback hand-off.
4. `apps/api/src/modules/chapter-directory/` — endpoint contract.
5. Existing combobox primitive: `packages/ui/` or `apps/web/components/ui/` — reuse the existing one.

## Branch

`claude/redesign-chunk-03-onboarding` — from `main`.

## Goal

A 5-step wizard that turns "I just signed up" into "I'm in `#general` with my chapter set up" in under 90 seconds when the chapter is in the directory.

## Tasks

1. **`apps/web/components/onboarding/chapter-wizard.tsx`** — 5 steps:
   1. Sign up (reuse existing — wizard fires *after* sign-in).
   2. Find chapter: school + chapter combobox querying `/chapter-directory/search`. Debounced 250ms. Loading / empty / match states. Show org letters + chapter designation + university in result rows.
   3. Pick archetype: 4-card grid. Pre-selected if directory match has one.
   4. Confirm identity: form pre-filled from directory — Greek letters, designation, school short, founded year, two color pickers (dark + accent). All editable.
   5. Invite members: bulk email textarea + share invite link. Skippable.
2. **Wizard trigger** — fires on first sign-in if user has no chapters OR has a chapter where `enabled_modules` is still at the default seed (i.e., wizard wasn't completed). Replaces `chapter-bootstrap.tsx`.
3. **Manual entry path** — "Not in our directory?" link on step 2 jumps to step 4 with empty fields. Chapter is created without `directory_id`; record a row in a `chapter_directory_requests` table (one-row migration in this chunk) so we can backfill the seed later.
4. **On submit** —
   - Insert `chapters` row with branding + archetype + `directory_id` (if matched).
   - Seed default channels: `#general`, `#announcements`, `#chapter-audit`.
   - Send invites (if any). Use existing invite endpoint or extend if missing.
   - Navigate to `/chat?channel=general`. Post a one-time welcome `system_audit` message: "Welcome to <Greek letters> <designation>. Invite your chapter to get the conversation started."
5. **Spec updates** — `spec/ui-web-dashboard.md` (wizard screen + flow), `spec/behavior.md` (default channel seeding rule, manual-entry path captures a request row).

## Verification

- [ ] Sign up fresh → wizard appears → search "Sigma Phi UCLA" → autofills → submit → land in `/chat?channel=general` with welcome message visible.
- [ ] Manual path: search "Made Up Chapter Name" → "Not in our directory" → step 4 empty → fill in → submit → chapter created, `chapter_directory_requests` row written.
- [ ] Wizard does NOT appear on subsequent sign-ins for the same officer.
- [ ] Inviting 3 emails sends 3 invites (check dev mailbox or stub log).
- [ ] Mobile width (375px) renders without horizontal scroll.
- [ ] Screenshots: wizard step 2 (combobox open), step 4 (filled), final chat state.

## Handoff

- Branch: `claude/redesign-chunk-03-onboarding`. Push, open PR `Chunk 03 — Onboarding wizard`. Body: link this brief, attach screenshots, tick verification.
- Update `STATUS.md`.
