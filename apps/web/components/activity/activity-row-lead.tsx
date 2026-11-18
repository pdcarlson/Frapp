"use client";

import { createContext, useContext } from "react";
import { NAV_GLYPHS } from "@repo/theme/nav-glyphs";
// The pure row model, not the hooks barrel: nothing here reads the API. The
// roster is read by the page, which hands faces down (`ActivityFaces`).
import {
  ACTIVITY_GLYPH_NAV,
  activityDetailParts,
  type ActivityRow,
} from "@repo/hooks/activity-rows";
import type { ActivityFace } from "@repo/hooks";
import { NavGlyph } from "@/components/layout/nav-glyphs";
import { FaceWithBadge } from "@/components/shared/face-with-badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { buttonVariants } from "@/components/ui/button";
import { UnreadDot } from "@/components/shared/unread-dot";
import { cn, initials } from "@/lib/utils";

/**
 * Resolves a row's `faceId` on the chapter roster (#4402, item 4). The page
 * provides it from `useActivityFaces`; without a provider, and for an id the
 * roster doesn't hold (a member who left), a row leads with its glyph.
 */
export const ActivityFaces = createContext<
  (userId: string) => ActivityFace | null
>(() => null);

/** The tile both leads share: 40px, so a row with either is the same height. */
const LEAD_TILE =
  "flex h-10 w-10 shrink-0 items-center justify-center rounded-sm border border-border bg-surface-1";

/**
 * What leads an Activity row (#4173): the date for an event, month over day
 * as a calendar draws it; the face of who the row is from, with its kind's
 * glyph small on the corner, as Teams' and Slack's Activity draw the actor
 * (#4402, item 4); else the kind's glyph alone (`ACTIVITY_GLYPH_NAV`, from
 * the shared nav set). All are neutral apart from the member's own tint:
 * colour on this page is for what asks something of the member
 * (`ActivityAsk`) and for status, never for a kind. Decoration: the title
 * says what the row is, and the detail names the person, except on a poll,
 * whose detail is its channel, so a poll's poster is said to a screen reader
 * here ("From Olive Officer.").
 */
export function ActivityRowLead({ row }: { row: ActivityRow }) {
  const faceFor = useContext(ActivityFaces);
  const face = !row.dateBlock && row.faceId ? faceFor(row.faceId) : null;
  if (face) {
    return (
      <>
        {row.kind === "poll" && face.name ? (
          <span className="sr-only">From {face.name}. </span>
        ) : null}
        <FaceWithBadge
          size={40}
          avatarUrl={face.avatarUrl}
          name={face.name}
          tint={face.tint}
          data-glyph={row.glyph}
          data-testid="activity-face"
          badgeProps={{ "data-testid": "activity-face-glyph" }}
          badge={<NavGlyph paths={NAV_GLYPHS[ACTIVITY_GLYPH_NAV[row.glyph]]} />}
        />
      </>
    );
  }
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

/** How many faces a task for everyone shows before "+N", as on the phone. */
const FACE_STACK_MAX = 3;

/**
 * Whom a task for everyone went to (#5538, the phone's row since #5492): up
 * to three of the members the read previews (overdue first), each tucked
 * under the one before with the face badge's hairline edge, then "+N" for
 * the rest, as Slack's and GitHub's avatar stacks count the others. A member
 * the roster no longer holds is left out and counted in "+N". Decoration:
 * the row says who it went to and how many are done.
 */
export function ActivityFaceStack({
  ids,
  total,
}: {
  ids: string[];
  total: number;
}) {
  const faceFor = useContext(ActivityFaces);
  const faces = ids
    .map((id) => ({ id, face: faceFor(id) }))
    .filter(
      (entry): entry is { id: string; face: ActivityFace } =>
        entry.face !== null,
    )
    .slice(0, FACE_STACK_MAX);
  if (faces.length === 0) return null;
  const more = total - faces.length;
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center"
      data-testid="activity-face-stack"
    >
      {faces.map(({ id, face }, index) => (
        <Avatar
          key={id}
          className={cn("h-6 w-6 border border-border", index > 0 && "-ml-2")}
          data-testid="activity-face-stack-face"
        >
          {face.avatarUrl ? <AvatarImage src={face.avatarUrl} alt="" /> : null}
          <AvatarFallback tint={face.tint}>
            {initials(face.name)}
          </AvatarFallback>
        </Avatar>
      ))}
      {more > 0 ? (
        <span className="ml-1 text-caption font-semibold tabular-nums text-muted-foreground">
          {`+${more}`}
        </span>
      ) : null}
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

/**
 * A row's second line. A closing time or due time less than a day away
 * (`row.soon`, "closes in 2 hours") is drawn in the warning tone, so what
 * runs out soon reads apart from what runs out next week (#4402, item 4).
 */
export function ActivityRowDetail({ row }: { row: ActivityRow }) {
  if (!row.detail) return null;
  const { lead, soon } = activityDetailParts(row);
  return (
    <span className="block truncate text-caption text-muted-foreground">
      {lead}
      {lead && soon ? " · " : null}
      {soon ? (
        <span
          className="font-semibold text-warning"
          data-testid="activity-soon"
        >
          {soon}
        </span>
      ) : null}
    </span>
  );
}
