/**
 * Signet duotone glyphs for the Resources & Reporting family — documents,
 * backwork, polls and reports.
 *
 * Recipe and the shared `Svg` / `stroke` / `detail` / `fillProps` primitives:
 * `components/ui/duotone.tsx` (`spec/ui/design-system/iconography.md` §1). The
 * intent → glyph map lives in `iconography.md` §6.2.5 and MUST be updated in
 * the same PR as any change here (§6.3).
 *
 * One file for four screens, as the Chapter Ops family does for its five: the
 * four share their intents rather than partitioning them. The document
 * silhouette marks a document row on `/documents`, the "No folder" filter
 * beside it, and the PDF a report exports to — two screens, one shape.
 *
 * **Four of the five are re-exports, and that is the point.** `nav-glyphs.tsx`
 * already draws all four of this family's nav intents, and a second copy of
 * the same path data is the drift §1 rule 1 bans. It is also the one family
 * where the reference settles the geometry directly: `DocumentsGlyph`'s path
 * is the file glyph `canvas-screens.dc.html` draws on s12 and s21, so the
 * document rows on `/documents` now draw the shape the board draws.
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

import { Svg, detail, fillProps, stroke } from "@/components/ui/duotone";
import type { DuotoneGlyphProps } from "@/components/ui/duotone";

export {
  BackworkGlyph,
  DocumentsGlyph,
  PollsGlyph,
  ReportsGlyph,
} from "@/components/layout/nav-glyphs";

export type ResourcesGlyphProps = DuotoneGlyphProps;

/**
 * A folder, and the folder filter it names.
 *
 * The only glyph in this family drawn rather than re-exported: no nav intent
 * covers a folder, because the sidebar links to Documents as a whole. It sits
 * directly beside `DocumentsGlyph` in the `/documents` folder rail — the "No
 * folder" row takes the document shape and every named folder takes this one —
 * so the two are drawn on one grid rather than borrowed from two packs, which
 * is why Lucide's `FolderOpen` could not stay.
 *
 * The body is the silhouette and the tab fold is detail, keeping the duotone
 * split on the shape a reader identifies a folder by.
 *
 * `spec/behavior/chapter-docs.md` specs folders as flat and one level deep, so
 * there is deliberately no open/closed pair to swap between: a folder here is
 * a filter, and `active` recolours the one glyph as the recipe requires.
 */
export function FolderGlyph({ className, active }: ResourcesGlyphProps) {
  return (
    <Svg className={className}>
      <path
        d="M3.8 6.9A1.9 1.9 0 015.7 5h3.5l2 2.5h7.1A1.9 1.9 0 0120.2 9.4v7.7A1.9 1.9 0 0118.3 19H5.7a1.9 1.9 0 01-1.9-1.9z"
        {...stroke}
        {...fillProps(active)}
      />
      <path d="M3.8 10.2h16.4" {...detail} />
    </Svg>
  );
}
