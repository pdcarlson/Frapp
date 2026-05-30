# Chunk 01 — Foundation (design bundle + theme + shell)

**Depends on:** nothing. This is the first chunk.
**Unblocks:** every subsequent chunk.

## Read first

1. `docs/internal/redesign/README.md` and `spec/redesign-context.md` (whole thing).
2. `AGENTS.md` at the repo root.
3. Current shell to replace: `apps/web/components/layout/dashboard-shell.tsx`.
4. Current theme to rewrite: `packages/theme/src/{globals.css,tokens.ts,tailwind.config.ts}`.
5. Existing brand spec to update: `spec/ui-brand-identity.md`, `spec/ui-web-dashboard.md`.
6. **`spec/redesign-context.md` → *Engineering principles*.** Non-negotiable for every chunk; the bullets below are this chunk's specific applications.

## Engineering principles applied here

- **Shell nav rows are semantic interactives, not `<div>`s.** Use `<button type="button">` for items that change client state (`setRoute`, modal opens) and the framework's `Link` (or `<a href>`) for items that navigate. The prototype's `design-handoff/project/shell.jsx` uses `<div>` with click handlers — do not port that pattern. Active styling stays the same; just move it to the semantic element.
- **Soft-disabled / "soon" nav items use `aria-disabled="true"` and `tabIndex={-1}`.** Hard-disabled items use the native `disabled` attribute on `<button>`.
- **Root layout sets `<html lang="en">`.** Verify `apps/web/app/layout.tsx` (or equivalent) has the attribute; add it if missing.
- **Monospace: use a system stack, not a bundled webfont.** `--font-mono` resolves to `ui-monospace, SFMono-Regular, …, monospace` — no font to load, so the "monospace must be loaded" principle is satisfied for free. This was the decision on PR #229; don't reintroduce Geist Mono (the prototype's `logos.html` references it without loading it — that's a prototype gap, not a target). See master plan → *Theming model* → "Monospace decision."

## Branch

`claude/redesign-chunk-01-foundation` — branch from `main`.

## Goal

Land the in-repo design reference, rewrite the theme tokens to the bone/bronze/ink palette, and rebuild the dashboard shell with a chapter-led sidebar, BETA badge, and chat as the default route. No data layer changes yet. No actual chat UI yet — `/chat` can be a stub.

## Tasks

1. **Confirm the design bundle is present.**
   - The bundle already lives at `design-handoff/` in the repo (palette, shell, org-config, settings prototypes, chat transcript). Skim `design-handoff/README.md` and the chat transcript at `design-handoff/chats/chat1.md` before you start — intent often lives in the chat, not the prototype.
   - If for some reason `design-handoff/` is missing, stop and ask the user how to source it (re-fetch from claude.ai/design ID `uUVhoSAtPSXszJas884LAw`, or upload). Don't guess at design choices.

2. **Rewrite theme tokens.**
   - `packages/theme/src/globals.css` — replace the palette with the bone/bronze/ink + role hues from `design-handoff/project/styles.css` (lines 1–200). Keep existing variable names; swap values only.
   - `packages/theme/src/tokens.ts` — update typography (display 24 / title 18 / section 14 / eyebrow 11 / body 14) and radii (xs 3 / sm 5 / md 7 / lg 9 / xl 12).
   - Add ledger-line and eyebrow utility classes to `packages/theme/src/` (look at `design-handoff/project/styles.css` for the pattern).
   - **Do not** rewrite `packages/theme/src/accent.ts` — it stays as the WCAG utility, reused later by `packages/chapter-theme/`.

3. **Rebuild the dashboard shell.**
   - Rewrite `apps/web/components/layout/dashboard-shell.tsx`:
     - Drop the "Frapp / Operations Console" header.
     - Lead the sidebar with `<ChapterLockup>`: crest of Greek letters on accent square + chapter name + designation + school short. New component at `apps/web/components/layout/chapter-lockup.tsx`.
     - Add `<BetaBadge>` at `apps/web/components/layout/beta-badge.tsx` supporting four styles: `sidebar_pill | breadcrumb_pill | top_banner | corner_badge`. Hardcode `{enabled: true, style: "sidebar_pill"}` for now — Chunk 8 wires it to `chapters.beta_config`.
   - Restructure nav into sections per `design-handoff/project/shell.jsx`. **Rename the top nav item from "Home" to "Chat" and make `/chat` the default landing route** for authenticated users.
   - Create a stub `apps/web/app/(dashboard)/chat/page.tsx` that renders a placeholder — real chat lands in Chunk 4.

4. **Update spec docs.**
   - `spec/ui-brand-identity.md`: new palette + typography + radii. Note that chapter theming overlays on top (described in `spec/redesign-context.md`).
   - `spec/ui-web-dashboard.md`: sidebar lockup, BETA badge spec, default route change.
   - `spec/product/positioning.md`: add the "chat is the spine" positioning statement (one short section pointing at the redesign context).

## Verification

- [ ] `npm install` clean from root.
- [ ] `npm run dev` boots `apps/web` without TypeScript errors.
- [ ] Sign in (use an existing test chapter). Sidebar leads with `<ChapterLockup>`; palette is bone/bronze; BETA pill visible at the bottom of the sidebar.
- [ ] Default landing after sign-in is `/chat` (stub page is OK).
- [ ] Screenshot the dashboard in light + dark mode — attach both to the PR.
- [ ] `npm run lint` and `npm run typecheck` pass.

## Handoff

- Commit on the chunk branch with messages like `feat(theme): swap to bone/bronze/ink palette` / `feat(shell): chapter-led sidebar with BETA badge` / `chore(design): land in-repo design reference`.
- Push: `git push -u origin claude/redesign-chunk-01-foundation`.
- Open a PR titled `Chunk 01 — Foundation: theme + shell + design reference`. PR body: link to `spec/behavior/branding/chunks/01-foundation.md` and tick the verification checklist.
- Status tracking: the issue's open/closed state is the status — close it via `Closes #N`. On merge, flip Chunk 01's row to `shipped` in the `spec/README.md` roadmap table (the source-of-truth status table). No project-board move.
