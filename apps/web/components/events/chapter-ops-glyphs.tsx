/**
 * Signet duotone glyphs for the Chapter Ops family — events, tasks, study
 * hours, service hours and study zones.
 *
 * Recipe and the shared `Svg` / `stroke` / `detail` / `fillProps` primitives:
 * `components/ui/duotone.tsx` (`spec/ui/design-system/iconography.md` §1). The
 * intent → glyph map lives in `iconography.md` §6.2.4 and MUST be updated in
 * the same PR as any change here (§6.3).
 *
 * One file for five screens rather than five files, because the five share
 * their intents rather than partitioning them: the map pin marks an event's
 * location, a study session's zone and a zone row alike, and every one of these
 * screens is reached from the nav's Chapter and Admin sections. Splitting it
 * would put the same re-export in five places, which is the drift
 * `ui/typography.ts` was hoisted to stop.
 *
 * **Eight of the nine are re-exports, and that is the point.** `nav-glyphs.tsx`
 * already draws these intents for the sidebar, and a second copy of the same
 * path data is exactly the drift §1 rule 1 bans — the Directory family states
 * the same rule for its three shared silhouettes.
 *
 * **Control furniture stays Lucide**, as it does in the shell, in chat and in
 * the Directory family (§6.2.2, §6.2.3). That is `Loader2`, `AlertCircle`,
 * `AlertTriangle`, `Trash2`, `Plus` and `Save`, plus — and this is the line
 * worth stating, because this family has more of them than any other — every
 * pair that names a *control's own action* rather than a domain object:
 * `Play`/`Pause`/`Square` on the study timer, `Eye`/`EyeOff` on its tracking
 * state, `Power`/`PowerOff` on a zone's enable toggle, and
 * `CheckCircle2`/`XCircle`/`Undo2` on approve, reject and withdraw. A verb on a
 * button is furniture; the thing the row is *about* is an intent.
 */

import { Svg, detail, stroke, fillProps } from "@/components/ui/duotone";
import type { DuotoneGlyphProps } from "@/components/ui/duotone";

export {
  DirectoryGlyph,
  EventsGlyph,
  PointsGlyph,
  RolesGlyph,
  SearchGlyph,
  ServiceGlyph,
  StudyZonesGlyph,
  TasksGlyph,
} from "@/components/layout/nav-glyphs";

export type ChapterOpsGlyphProps = DuotoneGlyphProps;

/**
 * An event's schedule row.
 *
 * Replaces Lucide's `Clock3` on the event detail sheet, where it sits beside
 * the date row's `EventsGlyph` — so the two are drawn on one grid rather than
 * borrowed from two packs. The face is the silhouette and the hands are
 * detail, which keeps the duotone split on the shape a reader actually
 * identifies the glyph by.
 */
export function ScheduleGlyph({ className, active }: ChapterOpsGlyphProps) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="12" r="8.2" {...stroke} {...fillProps(active)} />
      <path d="M12 7.4V12l3.2 1.9" {...detail} />
    </Svg>
  );
}
