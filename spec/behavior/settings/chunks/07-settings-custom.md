# Chunk 07 — Settings: Theme + Roles + Fields + Workflows + Dues

**Depends on:** Chunk 06 (settings shell + tabs scaffolded).
**Unblocks:** 08, 09 (member directory needs custom-field schema definitions ready).

## Read first

1. `spec/redesign-context.md` — *Theming model*, *Data model* (custom fields, roles, workflows, dues_config tables).
2. `packages/chapter-theme/` (from Chunk 02) — `derivePalette()` for the live preview.
3. `design-handoff/project/settings*.jsx` — visual reference for Roles, Fields, Workflows, Dues tabs.
4. **`spec/redesign-context.md` → *Engineering principles*.** Non-negotiable for every chunk; the bullets below are this chunk's specific applications.

## Engineering principles applied here

- **Roles → Matrix sub-tab columns derive from the active role pack at render time.** The matrix's column key list comes from `pack.roleKeys` (or the equivalent shape on the archetype's `ROLE_PACK`), with a guarded fallback to the archetype-default keys via the Chunk 02 helpers. The prototype's `settings-roles.jsx` hardcodes the column array — do not port that. Adding a custom role on the Custom sub-tab must extend the matrix's columns without a code change.
- **Dues tab numeric inputs guard-parse.** Replace `+e.target.value` / `set("baseAmount", +e.target.value)` patterns with a guarded parse: `const n = Number(e.target.value); if (Number.isFinite(n) && n >= 0) set("baseAmount", n);` (or preserve the previous value on invalid intermediate state). Applies to: cadence amounts (active / new-member / alumni), installment count, grace days, late fee cents, scholarship pool cents. Storing `NaN` is forbidden.
- **Custom field "options" lists deep-clone when added to a chapter** (covered by Chunk 02's helpers — verify your editor uses them rather than spreading the seed). Editing one chapter's options must never mutate another chapter's options.
- **All sub-tab form inputs are wrapped in semantic `<label>` / `<button>` / `<input>`** — no `<div role="button">`. The Theme tab's color pickers, the Roles tab's capability multi-select, and the Workflows tab's threshold input all use native form controls (or a wrapper that exposes the same a11y contract).
- **Theme tab live preview computes from the current form state, not a window global.** The `derivePalette({dark, accent})` call runs from the controlled component's state — no `window.PALETTE_DRAFT` or similar shortcut.

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
16. Spec updates: `spec/ui-web-dashboard.md` (Theme, Roles, Fields, Workflows, Dues tab specs), `spec/behavior/settings/README.md` (custom field visibility scoping rules — re-confirm self/chapter/exec/president semantics).

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
- Status tracking: the issue's open/closed state is the status — close it via `Closes #N`. When this chunk ships, flip its row in the project board (`docs/internal/board/chat-redesign.md`) — the source of truth. No GitHub Projects board.
