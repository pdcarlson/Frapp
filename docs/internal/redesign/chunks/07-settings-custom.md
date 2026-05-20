# Chunk 07 — Settings: Theme + Roles + Fields + Workflows + Dues

**Depends on:** Chunk 06 (settings shell + tabs scaffolded).
**Unblocks:** 08, 09 (member directory needs custom-field schema definitions ready).

## Read first

1. `docs/internal/redesign/master-plan.md` — *Theming model*, *Data model* (custom fields, roles, workflows, dues_config tables).
2. `packages/chapter-theme/` (from Chunk 02) — `derivePalette()` for the live preview.
3. `design-handoff/project/settings*.jsx` — visual reference for Roles, Fields, Workflows, Dues tabs.

## Branch

`claude/redesign-chunk-07-settings-custom` — from `main`.

## Goal

Ship the customization-heavy settings tabs that make chapters feel like the product fits them: full chapter theming, role pack + custom roles, custom field editor, workflow toggles, dues configuration.

## Tasks

### Theme tab (new vs original design)

1. Two color pickers: **dark** (sidebar / headers) and **accent** (chat self-bubble / mentions / CTAs).
2. Live preview panel renders: sidebar swatch, chat bubble swatch, mention pill swatch, primary button swatch.
3. Inline WCAG warnings when a token fails AA 4.5:1 against bone or ink (use `packages/theme/src/accent.ts`).
4. Save → `POST /chapters/:id/theme-palette` (Chunk 02 endpoint) → server recomputes `theme_palette` → client refetches via `useChapterTheme()` and applies CSS vars immediately. No full reload.

### Roles tab — 3 sub-tabs

5. **Pack** (read-only): the archetype's role pack table. Adding members to roles happens in the Members directory (Chunk 09).
6. **Matrix**: capabilities × roles permission matrix. Visual only here; edit happens via custom roles below.
7. **Custom**: create/edit `chapter_custom_roles`. Inputs: label, rank, capabilities (multi-select), core (boolean — if false, can be deleted).

### Fields tab

8. Editable table over `chapter_custom_fields`. Columns: label, type, required, visibility (self/chapter/exec/president), sensitive.
9. "Add field" modal with type-specific config (text → max length; select → options; date → no extra; …).

### Workflows tab

10. Toggle list per `chapter_workflows`. Each enabled workflow can configure its threshold (numeric input).

### Dues tab

11. Cadence picker (monthly / per-semester / per-quarter — 3 buttons).
12. Amounts grid: active member / new member / alumni.
13. Conditional sections: installments allowed (toggle + count), grace period (days), late fee (cents), scholarship pool (cents).
14. Writes to `chapter_dues_config` (singleton row per chapter).

### Audit + spec

15. Every save in this chunk writes a `chapter_audit_log` row → `#chapter-audit` message.
16. Spec updates: `spec/ui-web-dashboard.md` (Theme, Roles, Fields, Workflows, Dues tab specs), `spec/behavior.md` (custom field visibility scoping rules — re-confirm self/chapter/exec/president semantics).

## Verification

- [ ] Change chapter accent color in Theme tab → entire UI re-themes (sidebar, chat self bubble, mention pills) within one render. No reload required.
- [ ] Try a low-contrast accent (e.g. `#FFF5DC` on bone) → see WCAG warning surface, but save still succeeds with the falling-back tokens.
- [ ] Add a custom field "Hometown" (type: text, visibility: chapter, required: false). It does NOT yet show in the Members directory — that's Chunk 09's verification — but the row exists in DB.
- [ ] Add a custom role "Webmaster" with capabilities `[chat:moderate, settings:view]`. Verify the row writes; assigning to a member happens in Chunk 09.
- [ ] Enable a workflow with threshold 3 → row writes with `enabled=true, threshold=3`.
- [ ] Set dues to monthly $50 active / $25 new / $10 alumni → row writes to `chapter_dues_config`.
- [ ] Audit messages for each of the above appear in `#chapter-audit`.
- [ ] Repeat color-change test on an NPHC chapter to confirm theme derivation is archetype-agnostic.

## Handoff

- Branch `claude/redesign-chunk-07-settings-custom`. PR title `Chunk 07 — Settings: Theme + Roles + Fields + Workflows + Dues`.
- Update `STATUS.md`.
