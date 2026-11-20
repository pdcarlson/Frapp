# Logos

The Frapp emblem: locked emblem B, an abstract crest in gold `#DDB844` on a charcoal `#1A1A1A` field. The three files are copied from `packages/brand-assets/assets/` in the repo, where the vector is the source every raster is rendered from.

| File | Repo source | Use |
| --- | --- | --- |
| `frapp-emblem.svg` | `signet-emblem-B.svg` | The mark on its square field. App icons and any place the mark stands alone as an icon. |
| `frapp-emblem-rounded.svg` | `signet-emblem-B-rounded.svg` | The same mark on a rounded field, for a favicon or a notification's app icon. |
| `frapp-emblem-glyph.svg` | `signet-emblem-B-glyph.svg` | The crest alone on a transparent ground, in the mark's gold. For a dark page where a field would show as a second square (the sign-in, 404 and error pages). |

Rules:

- The mark's two inks are fixed: gold `#DDB844` and field `#1A1A1A`. They are not tokens and never take a chapter's accent.
- The one exception is Ask Frapp: there the crest's outline is drawn as a one-colour glyph in `primary`, always as Ask's icon, from the path in `packages/theme/src/crest.ts`.
- Call it a crest. Never describe it as an animal or a mascot.
- Never redraw, recolour, crop or round it differently. Minimum size 16px.
- The wordmark lockup (`frapp-lockup.svg` in the repo) is not copied here: its wordmark draws in `currentColor`, which an image tile cannot show. Inline it in code so the word takes `foreground`.
