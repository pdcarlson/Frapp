# Chunk 09 — Members directory + custom fields rendering

**Depends on:** Chunk 02 (custom field schema), Chunk 07 (custom field editor).
**Unblocks:** improves the "Pay" / "Assign task" / "Award points" flows in Chunk 10.

## Read first

1. `docs/internal/redesign/master-plan.md` — *Module catalog* (members is always-on).
2. `chapter_custom_fields` schema and visibility semantics (Chunk 02).
3. Existing members page (if any): `apps/web/app/(dashboard)/members/**`.
4. Existing invite endpoint (if any): grep `invite` in `apps/api`.

## Branch

`claude/redesign-chunk-09-members` — from `main`.

## Goal

Rebuild the members directory around the always-on `members` module. Custom fields render per chapter, respecting visibility. Invite flow that lands in `#chapter-audit` and DMs the inviter on accept.

## Tasks

1. **Directory page:**
   - Table view + card view toggle.
   - Search across name + email + custom-field values (visibility-scoped).
   - Filters: role, class/line/cohort (uses `vocab()`), status.
   - Click row → slideout detail panel.
2. **Member detail slideout:**
   - Core fields (name, email, role, joined date).
   - Custom fields rendered per chapter. Visibility check on the client (and on the server in the query — never trust client-only filtering for `sensitive` fields).
   - Custom role assignment dropdown (from Chunk 07's custom roles).
3. **Invite flow:**
   - Single email + bulk CSV upload.
   - On send: write to `chapter_audit_log` (member-visible) → `#chapter-audit` message.
   - On accept: DM the inviter (`chat-send` with `kind="system_audit"` to the inviter's DM channel) — "Alex Chen accepted your invite."
4. **Spec updates:** `spec/ui-web-dashboard.md` (members surface + slideout + invite flow), `spec/behavior.md` (custom field visibility enforcement on server).

## Verification

- [ ] On a chapter with a custom field "Hometown" (visibility: chapter): all members see Hometown on every member's detail panel.
- [ ] On a chapter with a custom field "GPA" (visibility: president): non-president members see no GPA field; president sees it.
- [ ] On a chapter with a custom field "Phone" (visibility: self): each member sees their own phone but no one else's.
- [ ] Invite 3 emails → 3 invites sent, one audit message in `#chapter-audit`.
- [ ] Accept one invite → inviter receives a DM "Alex Chen accepted your invite."
- [ ] Assign a custom role "Webmaster" (from Chunk 07) to a member → role appears on their detail panel.
- [ ] Two-archetype check: NPHC chapter showing "Line" filter instead of "Class".

## Handoff

- Branch `claude/redesign-chunk-09-members`. PR title `Chunk 09 — Members + custom fields rendering`.
- Update `STATUS.md`.
