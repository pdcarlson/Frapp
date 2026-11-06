/**
 * Signet duotone glyphs for the Resources & Reporting family — documents,
 * polls and reports, plus the toolbar search glyph `/backwork` shares.
 *
 * Every glyph here draws the shared two-tone set (`@repo/theme/nav-glyphs`,
 * `spec/ui/design-system/iconography.md` §1.1) except the re-exported
 * `SearchGlyph`, which keeps the §1 stroke recipe until #3491. The
 * intent → glyph map lives in `iconography.md` §6.2.5 and MUST be updated in
 * the same PR as any change here (§6.3).
 *
 * One file for four screens, as the Chapter Ops family does for its five: the
 * four share their intents rather than partitioning them. The document
 * silhouette marks a document row on `/documents`, the "No folder" filter
 * beside it, and the PDF a report exports to — two screens, one shape.
 *
 * **Four of the five are re-exports, and that is the point.** `nav-glyphs.tsx`
 * already draws all four, and a second copy of
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

import { NAV_GLYPHS } from "@repo/theme/nav-glyphs";
import type { DuotoneGlyphProps } from "@/components/ui/duotone";
import { NavGlyph } from "@/components/layout/nav-glyphs";

export {
  DocumentsGlyph,
  PollsGlyph,
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
