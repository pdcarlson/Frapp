# design-handoff/

Visual reference bundle exported from claude.ai/design (handoff ID `uUVhoSAtPSXszJas884LAw`). Lands here so every redesign chunk can reference the same source of truth without re-fetching.

> **Not canonical.** The bundle is a *visual* reference — palette, typography, shell layout, BETA badge styles, settings rail, archetype catalog, ledger-line motifs. Product positioning, hot-path architecture, and theming model live in [`docs/internal/redesign/master-plan.md`](../docs/internal/redesign/master-plan.md). Where the bundle and the master plan disagree, the master plan wins.

## What's here

- `project/styles.css` — palette tokens, typography, radii. Source for `packages/theme/src/globals.css` (Chunk 01).
- `project/shell.jsx` — sidebar layout + nav structure. Source for `apps/web/components/layout/dashboard-shell.tsx` (Chunk 01).
- `project/org-config.jsx` — archetype catalog, role packs, module catalog. Source for `packages/org-archetypes/` (Chunk 02).
- `project/settings*.jsx` — settings rail tabs. Source for `apps/web/components/settings/**` (Chunks 06–08).
- `project/chat.jsx`, `project/home.jsx`, `project/backwork.jsx` — surface references for Chunks 04, 05, 10f.
- `project/screens*.jsx`, `project/screenshots/` — supplementary screen mockups for context.
- `project/assets/` — logo + icon SVGs.
- `chats/chat1.md` — the design conversation transcript. Read this when a design choice is ambiguous; the intent often lives in the chat rather than the final file.
- `BUNDLE_README.md` — the bundle's original README (instructions from claude.ai/design to a coding agent).

## How chunks use this

Each chunk brief under `docs/internal/redesign/chunks/` lists which files in `project/` to read first. The chat transcript is the source of intent when the prototype is ambiguous. The prototypes are HTML/CSS/JS — recreate them in the target stack (Next.js / Tailwind for web, Expo / NativeWind for mobile); don't lift the prototype's internal structure unless it happens to fit.

Screenshots in `project/screenshots/` are for human reference. Don't render the HTML in a browser or screenshot it yourself; everything you need is in the source.
