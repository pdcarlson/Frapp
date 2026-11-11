import { NAV_GLYPHS, type DuotoneGlyphPaths } from "@repo/theme/nav-glyphs";
import type { ActivityGlyph, ActivityRow } from "@repo/hooks";
import { NavGlyph } from "@/components/layout/nav-glyphs";
import { cn } from "@/lib/utils";

/**
 * Each kind's glyph, from the shared nav set, so a row draws the same shape as
 * the place its record lives (`iconography.md` §6.2): a task the Tasks glyph,
 * hours the Service glyph. `confirm` and `link` were added for Activity
 * (#4173).
 */
const GLYPH_PATHS: Record<ActivityGlyph, DuotoneGlyphPaths> = {
  task: NAV_GLYPHS.tasks,
  confirm: NAV_GLYPHS.confirm,
  hours: NAV_GLYPHS.service,
  poll: NAV_GLYPHS.polls,
  event: NAV_GLYPHS.events,
  document: NAV_GLYPHS.documents,
  backwork: NAV_GLYPHS.backwork,
  link: NAV_GLYPHS.link,
};

/** The tile both leads share: 40px, so a row with either is the same height. */
const LEAD_TILE =
  "flex h-10 w-10 shrink-0 items-center justify-center rounded-sm border border-border bg-surface-1";

/**
 * What leads an Activity row (#4173): the date for an event, as a calendar
 * draws it, else its kind's glyph, the way Teams' Activity marks each row.
 * Both are neutral: colour on this page is for what asks something of the
 * member (`ActivityAsk`) and for status, never for a kind.
 */
export function ActivityRowLead({ row }: { row: ActivityRow }) {
  if (row.dateBlock) {
    return (
      <span
        className={cn(LEAD_TILE, "flex-col gap-0.5")}
        aria-hidden="true"
        data-testid="activity-date-block"
      >
        <span className="text-caption font-semibold uppercase leading-none text-muted-foreground">
          {row.dateBlock.weekday}
        </span>
        <span className="text-label font-bold leading-none tabular-nums text-foreground">
          {row.dateBlock.day}
        </span>
      </span>
    );
  }
  return (
    <span
      className={cn(LEAD_TILE, "text-muted-foreground")}
      aria-hidden="true"
      data-glyph={row.glyph}
    >
      <NavGlyph paths={GLYPH_PATHS[row.glyph]} className="h-5 w-5" />
    </span>
  );
}

/**
 * A badge that asks the member to act (`Vote`, `Confirm`, `Approve`,
 * `Check in`), drawn as the action it opens rather than as a status, so it
 * reads apart from `To do` or `Required` (#4173). It is not its own control:
 * the whole row is the hit target, and this names what the row opens to. The
 * tinted button's recipe, since the accent belongs to the one action that
 * matters (`components.md` §3).
 */
export function ActivityAsk({ label }: { label: string }) {
  return (
    <span className="inline-flex h-7 shrink-0 items-center rounded-xs border border-accent-border bg-accent-subtle px-2.5 text-caption font-bold text-accent-text">
      {label}
    </span>
  );
}
