# Chunk 08 — Settings: Beta + Audit + ops-setup nudges

**Depends on:** Chunk 07.
**Unblocks:** marks settings surface "complete enough" for Chunk 09+.

## Read first

1. `spec/redesign-context.md` — *Member-visible audit log* (in *Product positioning*).
2. `design-handoff/project/settings*.jsx` — Beta + Audit reference.
3. `chapter_audit_log` schema + `#chapter-audit` bridge (Chunks 02 + 05).

## Branch

`claude/redesign-chunk-08-settings-beta-audit` — from `main`.

## Goal

Finish the settings surface and add the gentle on-ramp that nudges officers toward enabling paid ops modules after they're settled in chat.

## Tasks

1. **Beta tab:**
   - Build-channel selector (stable / beta — affects which `BetaBadge` style is shown).
   - Style picker for the BETA badge (`sidebar_pill | breadcrumb_pill | top_banner | corner_badge`) with live preview.
   - Caveats table: known limitations the chapter should expect on beta builds.
   - Feedback grid: simple "send feedback" form (optional — can stub if no feedback infra exists; create a `feedback` table migration if needed).
2. **Audit tab:**
   - Paginated table of `chapter_audit_log` rows. Filters: actor, action type, date range.
   - Per-row expansion shows the `diff` JSON in a readable format.
   - `member_visible` toggle per row (president-only). Toggling re-posts or retracts the corresponding `#chapter-audit` message.
3. **Ops-setup nudge** (new component, lands on `/chat` home or as a banner in `#general`):
   - Dismissible card: "Want to track dues? Enable Dues for a 14-day trial." One per module, shown in priority order (Dues > Events > Tasks > Points).
   - Dismissed state persists per user per chapter.
   - On click, opens the Modules tab scrolled to the relevant row.

## Verification

- [ ] Toggle beta style in Beta tab → live preview updates, and the actual sidebar `BetaBadge` updates after save without reload.
- [ ] In Audit tab, toggle a row's `member_visible` off → corresponding message disappears from `#chapter-audit` for non-president members within one Realtime tick.
- [ ] Ops-setup nudge appears for a fresh chapter with no paid modules enabled. Dismissing it persists across reloads (per user per chapter).
- [ ] Enabling a module via the nudge takes you to the Modules tab with the row scrolled into view + highlighted.
- [ ] Two-archetype check: confirm nudge copy uses the right vocabulary ("recruitment" vs "rush") via `vocab()` helper.

## Handoff

- Branch `claude/redesign-chunk-08-settings-beta-audit`. PR title `Chunk 08 — Settings: Beta + Audit + nudges`.
- Move the issue to *In Review* on the *Frapp Launch* GitHub project.
