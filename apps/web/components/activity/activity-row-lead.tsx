import { NAV_GLYPHS } from "@repo/theme/nav-glyphs";
// The pure row model, not the hooks barrel: nothing here reads the API.
import {
  ACTIVITY_GLYPH_NAV,
  type ActivityRow,
} from "@repo/hooks/activity-rows";
import { NavGlyph } from "@/components/layout/nav-glyphs";
import { buttonVariants } from "@/components/ui/button";
import { UnreadDot } from "@/components/shared/unread-dot";
import { cn } from "@/lib/utils";

/** The tile both leads share: 40px, so a row with either is the same height. */
const LEAD_TILE =
  "flex h-10 w-10 shrink-0 items-center justify-center rounded-sm border border-border bg-surface-1";

/**
 * What leads an Activity row (#4173): the date for an event, month over day
 * as a calendar draws it, else its kind's glyph (`ACTIVITY_GLYPH_NAV`, from the
 * shared nav set), the way Teams' Activity marks each row.
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
          {row.dateBlock.month}
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
      <NavGlyph
        paths={NAV_GLYPHS[ACTIVITY_GLYPH_NAV[row.glyph]]}
        className="h-5 w-5"
      />
    </span>
  );
}

/**
 * A badge that asks the member to act (`Vote`, `Confirm`, `Approve`,
 * `Check in`), drawn as the action it opens rather than as a status, so it
 * reads apart from `To do` or `Required` (#4173). It is not its own control:
 * the whole row is the hit target, and this names what the row opens to. The
 * tinted button's recipe, since the accent belongs to the one action that
 * matters (`components.md` §3), drawn from `buttonVariants` so it follows the
 * recipe, at a badge's height so the row keeps its own.
 */
export function ActivityAsk({ label }: { label: string }) {
  return (
    <span
      className={cn(
        buttonVariants({ variant: "tinted", size: "sm" }),
        "pointer-events-none h-7 shrink-0 px-2.5 text-caption pointer-coarse:h-7",
      )}
    >
      {label}
    </span>
  );
}

/**
 * The unread mark (#4405, `spec/behavior/activity.md` § Unread): the
 * dashboard's `UnreadDot` in a slot of its own before the lead, as the
 * notification drawer's rows draw it and Linear's and GitHub's inboxes do,
 * and "Unread:" before the title for a screen reader.
 */
export function ActivityUnreadDot({ unread }: { unread: boolean }) {
  return (
    <>
      <UnreadDot unread={unread} />
      {unread ? <span className="sr-only">Unread: </span> : null}
    </>
  );
}
