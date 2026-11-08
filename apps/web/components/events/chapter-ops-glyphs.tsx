/**
 * Signet duotone glyphs for the Chapter Ops family — events, study hours and
 * study zones. Tasks and service hours were in it until their dialog titles
 * lost their glyphs (components.md § Chrome weight); they draw none from here.
 *
 * Every glyph here draws the shared two-tone set (`@repo/theme/nav-glyphs`,
 * `spec/ui/design-system/iconography.md` §1.1) except the re-exported
 * `SearchGlyph`, which keeps the §1 stroke recipe until #3491. The
 * intent → glyph map lives in `iconography.md` §6.2.4 and MUST be updated in
 * the same PR as any change here (§6.3).
 *
 * One file for three screens rather than three files, because they share
 * their intents rather than partitioning them: the map pin marks an event's
 * location, a study session's zone and a zone row alike, and every one of these
 * screens is reached from the nav's Chapter section or from Settings (Study
 * zones, since the Admin section folded into Settings in #2946). Splitting it
 * would put the same re-export in three places, which is the drift
 * `ui/typography.ts` was hoisted to stop.
 *
 * **Six of the seven are re-exports, and that is the point.** `nav-glyphs.tsx`
 * already draws these intents for the sidebar, and a second copy of the same
 * path data is exactly the drift §1 rule 1 bans — the Directory family states
 * the same rule for its two shared silhouettes.
 *
 * **Control furniture stays Lucide**, as it does in the shell, in chat and in
 * the Directory family (§6.2.2, §6.2.3). That is `Loader2`, `AlertCircle`,
 * `AlertTriangle`, `Trash2`, `Pencil`, `Plus` and `Save`, plus — and this is the line
 * worth stating, because this family has more of them than any other — every
 * pair that names a *control's own action* rather than a domain object:
 * `Play`/`Pause`/`Square` on the study timer, `Eye`/`EyeOff` on its tracking
 * state, `Power`/`PowerOff` on a zone's enable toggle, and
 * `CheckCircle2`/`XCircle`/`Undo2` on approve, reject and withdraw. A verb on a
 * button is furniture; the thing the row is *about* is an intent.
 */

import { NAV_GLYPHS } from "@repo/theme/nav-glyphs";
import type { DuotoneGlyphProps } from "@/components/ui/duotone";
import { NavGlyph } from "@/components/layout/nav-glyphs";

export {
  DirectoryGlyph,
  EventsGlyph,
  PointsGlyph,
  RolesGlyph,
  SearchGlyph,
  StudyZonesGlyph,
} from "@/components/layout/nav-glyphs";

export type ChapterOpsGlyphProps = DuotoneGlyphProps;

/**
 * An event's schedule row.
 *
 * Replaces Lucide's `Clock3` on the event detail sheet, where it sits beside
 * the date row's `EventsGlyph` and the Study zones and Points rows, so it is
 * drawn from the same shared two-tone set (`@repo/theme/nav-glyphs`, Phosphor
 * `clock`) rather than a second recipe.
 */
export function ScheduleGlyph(props: ChapterOpsGlyphProps) {
  return <NavGlyph paths={NAV_GLYPHS.schedule} {...props} />;
}
