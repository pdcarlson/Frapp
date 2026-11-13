import { FRAPP_CREST_PATH, FRAPP_CREST_VIEW_BOX } from "@repo/theme/crest";

/**
 * The crest as a glyph in the colour of the text around it. Decoration: every
 * place that draws it says "Ask Frapp" in words beside it.
 *
 * Only Ask's front doors draw the crest this way (#4702, Paul 2026-11-13),
 * and there it takes the chapter accent. The mark itself stays the fixed gold
 * raster everywhere else (`auth/signet-mark.tsx`, `spec/ui/brand-identity.md`
 * §2).
 */
export function FrappCrest({ className }: { className?: string }) {
  return (
    <svg
      viewBox={FRAPP_CREST_VIEW_BOX}
      className={className}
      fill="currentColor"
      focusable="false"
      aria-hidden="true"
    >
      <path d={FRAPP_CREST_PATH} />
    </svg>
  );
}
