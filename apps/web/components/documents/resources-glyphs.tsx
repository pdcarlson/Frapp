/**
 * Signet duotone glyphs for the Resources & Reporting family — documents and
 * reports, plus the toolbar search glyph `/backwork` shares. (`/polls` was the
 * fourth screen until #3871 retired it.)
 *
 * Every glyph here draws the shared two-tone set (`@repo/theme/nav-glyphs`,
 * `spec/ui/design-system/iconography.md` §1.1) except three: the re-exported
 * `SearchGlyph`, which keeps the §1 stroke recipe until #3491; and `PinGlyph`
 * and `StarGlyph`, drawn here from `MARK_GLYPH_PATHS` (#3934) and filled solid
 * while on (#4289), because the set has no star and chat's pin keeps the
 * tinted recipe. The
 * intent → glyph map lives in `iconography.md` §6.2.5 and MUST be updated in
 * the same PR as any change here (§6.3).
 *
 * One file for three screens, as the Chapter Ops family does for its five: the
 * three share their intents rather than partitioning them. The document
 * silhouette marks a document row on `/documents`, the "No folder" filter
 * beside it, and the PDF a report exports to — two screens, one shape.
 *
 * **Most of them are re-exports, and that is the point.** `nav-glyphs.tsx`
 * already draws all three, and a second copy of
 * the same path data is the drift §1 rule 1 bans. Since the nav glyphs moved
 * to the shared two-tone set (`@repo/theme/nav-glyphs`, iconography.md §1.1),
 * `DocumentsGlyph` is Phosphor `file-text`, no longer the board's s12/s21 file
 * glyph, and `FolderGlyph` draws from the same set.
 *
 * **Control furniture stays Lucide** (§6.2.2, §6.2.3, §6.2.4): `Loader2`,
 * `Trash2`, `Upload`, `Download` and `RefreshCw` — every one a verb on a
 * button or a spinner, none of them the thing a row is *about*.
 *
 * Two swaps here are corrections rather than a pack change, in the sense
 * §6.2.4 uses:
 *
 * - `/polls` drew Lucide's `RefreshCcw`, which §6.2.3 recorded as "a stray
 *   second spelling of §6.2.2's `RefreshCw`". It was the last one in the tree.
 * - `/reports` marked "Generate report" with `FileSpreadsheet` and "Download
 *   PDF" with `FileText` — a spreadsheet labelling a report, and a generic
 *   page labelling the PDF. Both now name what the control produces.
 */

import { MARK_GLYPH_PATHS, NAV_GLYPHS } from "@repo/theme/nav-glyphs";
import { Svg, detail, markFillProps, stroke } from "@/components/ui/duotone";
import type { DuotoneGlyphProps } from "@/components/ui/duotone";
import { NavGlyph } from "@/components/layout/nav-glyphs";


export {
  DocumentsGlyph,
  ReportsGlyph,
  SearchGlyph,
} from "@/components/layout/nav-glyphs";

export type ResourcesGlyphProps = DuotoneGlyphProps;

/**
 * A folder, and the folder filter it names.
 *
 * The only glyph in this family that is not a re-exported nav glyph: no nav
 * intent covers a folder, because the sidebar links to Documents as a whole.
 * It sits directly beside `DocumentsGlyph` in the `/documents` folder rail (the
 * "No folder" row takes the document shape and every named folder takes this
 * one), so it is drawn from the same shared two-tone set
 * (`@repo/theme/nav-glyphs`, Phosphor `folder`) rather than a second recipe.
 *
 * `spec/behavior/chapter-docs.md` specs folders as flat and one level deep, so
 * there is deliberately no open/closed pair to swap between: a folder here is
 * a filter, and `active` recolours the one glyph as the recipe requires.
 */
export function FolderGlyph(props: ResourcesGlyphProps) {
  return <NavGlyph paths={NAV_GLYPHS.folder} {...props} />;
}

/**
 * A pin, for a folder or file an officer pinned for the whole chapter
 * (#3934). Chat's pin shape (`MARK_GLYPH_PATHS.pin`): pinning a message, a
 * channel and a document is one idea, so it is one shape. Drawn here rather
 * than re-exported because a pinned document's pin is solid (#4289,
 * `markFillProps`); the needle stays a stroke. #4292 brings chat's pin to the
 * same fill, after which this goes back to a re-export.
 */
export function PinGlyph({ className, active }: ResourcesGlyphProps) {
  return (
    <Svg className={className}>
      <path
        d={MARK_GLYPH_PATHS.pin.body}
        {...stroke}
        {...markFillProps(active)}
      />
      <path d={MARK_GLYPH_PATHS.pin.detail} {...detail} />
    </Svg>
  );
}

/**
 * A star, for a folder or file a member starred for themselves (#3934),
 * solid while starred and an outline while not (#4289), as Drive, Gmail and
 * Dropbox draw theirs. A star rather than a second pin for the reason chat's
 * `BookmarkGlyph` gives: the two sit side by side, one is chapter-wide and one
 * is private, and two similar shapes would invite pinning for everyone while
 * meaning to mark it for yourself.
 */
export function StarGlyph({ className, active }: ResourcesGlyphProps) {
  return (
    <Svg className={className}>
      <path
        d={MARK_GLYPH_PATHS.star.body}
        {...stroke}
        {...markFillProps(active)}
      />
    </Svg>
  );
}
