/*
 * The locked emblem B crest, in one place.
 *
 * The path is `@repo/theme/crest`'s, copied there from
 * `packages/brand-assets/assets/signet-emblem-B-glyph.svg`, which is the vector
 * source every raster in that package is rendered from. Until #4702 this file
 * held its own copy; the product then needed the shape too, and two copies of
 * a locked mark is one too many.
 *
 * **Why it is a module rather than a literal at each call site.** The mark is
 * LOCKED (`spec/ui/brand-identity.md` §2, `spec/ui/assets.md` §1), so a copy
 * that drifts is a brand defect rather than a formatting one. The token cutover
 * inlined it in two files, which agreed; slice 3 needed a third for the social
 * card and extracted instead of adding one. The geometry now has a single home
 * and the three surfaces that draw it read from here.
 *
 * **The fill is the literal `#DDB844` the vector carries, never
 * `var(--primary)`.** Wiring the mark to the accent slot is the one lock a
 * reskin is most likely to break by accident, and on this surface the two values
 * happen to be identical today (D1) — which is exactly what would make the
 * mistake invisible. The mark never takes theme or chapter accent.
 *
 * `SIGNET_CREST_PATH` is exported separately because `app/opengraph-image.tsx`
 * renders through Satori, which lays out its own JSX tree and takes the raw `d`.
 */

import { FRAPP_CREST_PATH } from "@repo/theme/crest";

/**
 * The `d` attribute of the single path in `signet-emblem-B-glyph.svg`. It is
 * the one copy in `@repo/theme/crest`, which the dashboard and the phone draw
 * from too and which `crest.spec.ts` there holds to the vector file.
 */
export const SIGNET_CREST_PATH = FRAPP_CREST_PATH;

/** The fill the vector carries. Never the accent slot; see the note above. */
export const SIGNET_CREST_GOLD = "#DDB844";

/**
 * The crest as decoration. Every call site so far pairs it with text that
 * already names the brand, so it announces nothing of its own.
 */
export function SignetCrest({ className }: { className: string }) {
  return (
    <svg
      viewBox="0 0 1024 1024"
      className={className}
      role="presentation"
      focusable="false"
      aria-hidden="true"
    >
      <path fill={SIGNET_CREST_GOLD} d={SIGNET_CREST_PATH} />
    </svg>
  );
}
