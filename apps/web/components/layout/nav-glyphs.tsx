/**
 * Glyphs for the dashboard shell: sidebar nav and top-bar controls.
 *
 * The sidebar glyphs (and the Settings rail's Roles, Study zones and Reports)
 * draw the shared nav set in `@repo/theme/nav-glyphs`, the same shapes the
 * mobile tab bar and More hub draw, so one destination has one silhouette on
 * both surfaces. That set is two-tone: a silhouette at 20% of the glyph's hue
 * (30% when active) under a full-strength outline
 * (`spec/ui/design-system/iconography.md` §1). It replaced the hand-drawn
 * 1.6px-stroke set, whose 6% white fill disappeared on charcoal and left the
 * nav reading as plain outlines.
 *
 * The top-bar controls (search, notifications, menu) still use the stroke
 * recipe in `components/ui/duotone.tsx`, as do the in-screen glyph families.
 * The intent → glyph map lives in `iconography.md` §6.2 and MUST be updated in
 * the same PR as any change here.
 */

import {
  GLYPH_BACK_OPACITY,
  GLYPH_VIEW_BOX,
  NAV_GLYPHS,
  type DuotoneGlyphPaths,
} from "@repo/theme/nav-glyphs";
import {
  Svg,
  detail,
  fillProps,
  stroke,
  type DuotoneGlyphComponent,
  type DuotoneGlyphProps,
} from "@/components/ui/duotone";

/** The props every shell glyph takes: a class for size and the active state. */
export type NavGlyphProps = DuotoneGlyphProps;
export type NavGlyphComponent = DuotoneGlyphComponent;

/* ── Sidebar nav intents ─────────────────────────────────────────────────── */

/**
 * Draws one entry of the shared nav set: the silhouette in the glyph's own hue
 * at reduced opacity, then the outline at full strength. Both follow
 * `currentColor`, so the row's text color (muted, or the accent when active)
 * paints the glyph.
 */
function NavGlyph({
  paths,
  className,
  active,
}: NavGlyphProps & { paths: DuotoneGlyphPaths }) {
  return (
    <svg
      viewBox={GLYPH_VIEW_BOX}
      className={className}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d={paths.back}
        opacity={active ? GLYPH_BACK_OPACITY.active : GLYPH_BACK_OPACITY.rest}
      />
      <path d={paths.front} />
    </svg>
  );
}

export function ChatGlyph(props: NavGlyphProps) {
  return <NavGlyph paths={NAV_GLYPHS.chat} {...props} />;
}

export function EventsGlyph(props: NavGlyphProps) {
  return <NavGlyph paths={NAV_GLYPHS.events} {...props} />;
}

export function TasksGlyph(props: NavGlyphProps) {
  return <NavGlyph paths={NAV_GLYPHS.tasks} {...props} />;
}

export function PointsGlyph(props: NavGlyphProps) {
  return <NavGlyph paths={NAV_GLYPHS.points} {...props} />;
}

export function StudyGlyph(props: NavGlyphProps) {
  return <NavGlyph paths={NAV_GLYPHS.study} {...props} />;
}

export function ServiceGlyph(props: NavGlyphProps) {
  return <NavGlyph paths={NAV_GLYPHS.service} {...props} />;
}

export function PollsGlyph(props: NavGlyphProps) {
  return <NavGlyph paths={NAV_GLYPHS.polls} {...props} />;
}

export function DocumentsGlyph(props: NavGlyphProps) {
  return <NavGlyph paths={NAV_GLYPHS.documents} {...props} />;
}

export function BackworkGlyph(props: NavGlyphProps) {
  return <NavGlyph paths={NAV_GLYPHS.backwork} {...props} />;
}

export function DirectoryGlyph(props: NavGlyphProps) {
  return <NavGlyph paths={NAV_GLYPHS.directory} {...props} />;
}

export function BillingGlyph(props: NavGlyphProps) {
  return <NavGlyph paths={NAV_GLYPHS.billing} {...props} />;
}

export function RolesGlyph(props: NavGlyphProps) {
  return <NavGlyph paths={NAV_GLYPHS.roles} {...props} />;
}

export function StudyZonesGlyph(props: NavGlyphProps) {
  return <NavGlyph paths={NAV_GLYPHS.studyZones} {...props} />;
}

export function ReportsGlyph(props: NavGlyphProps) {
  return <NavGlyph paths={NAV_GLYPHS.reports} {...props} />;
}

export function SettingsGlyph(props: NavGlyphProps) {
  return <NavGlyph paths={NAV_GLYPHS.settings} {...props} />;
}

/* ── Top-bar controls ────────────────────────────────────────────────────── */

export function SearchGlyph({ className, active }: NavGlyphProps) {
  return (
    <Svg className={className}>
      <circle cx="10.5" cy="10.5" r="6.2" {...stroke} {...fillProps(active)} />
      <path d="M15.2 15.2l4.3 4.3" {...detail} />
    </Svg>
  );
}

export function NotificationsGlyph({ className, active }: NavGlyphProps) {
  return (
    <Svg className={className}>
      <path
        d="M12 3a6 6 0 016 6v3.2l1.4 2.8H4.6L6 12.2V9a6 6 0 016-6z"
        {...stroke}
        {...fillProps(active)}
      />
      <path d="M9.8 18a2.3 2.3 0 004.4 0" {...detail} />
    </Svg>
  );
}

export function MenuGlyph({ className }: NavGlyphProps) {
  // A hamburger has no silhouette to fill; its three rules are all detail
  // strokes, so this one is legitimately stroke-only under the recipe.
  return (
    <Svg className={className}>
      <path d="M4 7h16M4 12h16M4 17h16" {...detail} />
    </Svg>
  );
}
