"use client";

import { formatPoints } from "@repo/formatting";
import type { MemberAvatarTint, MemberProfile } from "@repo/hooks";
import type { PresenceStatus } from "@repo/hooks/presence-status";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { FOCUS_RING_OFFSET } from "@/components/ui/focus";
import {
  AvatarPresenceDot,
  CustomStatusLine,
} from "@/components/members/presence-dot";
import {
  dashboardCheckboxHitAreaClassName,
  dashboardTableCheckboxClassName,
  denseGridClassName,
  gridTileButtonClassName,
  gridTileFrameClassName,
} from "@/components/shared/table-controls";
import { cn, initials } from "@/lib/utils";

export interface MemberFacts {
  name: string;
  roleName: string | null;
  joined: string | null;
  className: string | null;
  points: number;
  status: PresenceStatus | null;
  customLine: string | null;
  /** The tile's accessible name: every fact it shows, in a fixed order. */
  label: string;
}

/**
 * The Actives tab as a grid of faces (#4175), the second rendering of the
 * list the List/Grid toggle in the tab row picks.
 *
 * The card grid #2146 deleted failed three ways, and each is answered here:
 *
 * - **It showed strictly less than the row.** A tile shows every fact the row
 *   does (name, custom status, role, class, join date, email, points,
 *   presence), with the face larger, which is the one thing a grid shows
 *   better than a row.
 * - **Selection was unreachable while the bulk bar still rendered.** Every
 *   tile carries its checkbox, and the always-rendered "Select all on this
 *   page" above the grid is the same one the list uses.
 * - **A wrapper card per member.** A tile is a hairline-bordered button on the
 *   page surface, not a `--card` panel: the route still has no cards.
 *
 * The tile is the control, as the row is, with its `aria-label` restating
 * every fact; the checkbox sits outside the button, in the tile's corner, so
 * one never nests inside the other.
 */
export function MemberGrid({
  members,
  idOf,
  factsOf,
  selectedIds,
  onToggle,
  onOpen,
  avatarTintFor,
}: {
  members: readonly MemberProfile[];
  idOf: (member: MemberProfile) => string;
  factsOf: (member: MemberProfile) => MemberFacts;
  selectedIds: readonly string[];
  onToggle: (id: string, selected: boolean) => void;
  onOpen: (member: MemberProfile) => void;
  avatarTintFor: (userId: string) => MemberAvatarTint | null;
}) {
  return (
    <ul role="list" className={denseGridClassName}>
      {members.map((member) => {
        const id = idOf(member);
        const facts = factsOf(member);
        const selected = selectedIds.includes(id);
        // Role and class lead, the bounded fields; the email gets its own
        // line, since it is the field that runs long and truncates.
        const meta = [facts.roleName, facts.className]
          .filter(Boolean)
          .join(" · ");
        return (
          <li
            key={id}
            className={cn(
              "relative",
              gridTileFrameClassName,
              // The row's selected fill, on the tile.
              selected && "bg-popover",
            )}
          >
            <button
              type="button"
              onClick={() => onOpen(member)}
              aria-label={facts.label}
              className={cn(
                gridTileButtonClassName,
                !selected && "hover:bg-card-hover hover:text-foreground",
                FOCUS_RING_OFFSET,
              )}
            >
              <span className="relative">
                <Avatar className="h-14 w-14">
                  {member.avatar_url ? (
                    <AvatarImage src={member.avatar_url} alt="" />
                  ) : null}
                  <AvatarFallback
                    className="text-base"
                    tint={
                      typeof member.user_id === "string"
                        ? avatarTintFor(member.user_id)
                        : null
                    }
                  >
                    {initials(facts.name)}
                  </AvatarFallback>
                </Avatar>
                <AvatarPresenceDot status={facts.status} />
              </span>
              <span className="flex w-full min-w-0 flex-col items-center">
                <span className="w-full truncate text-sm font-semibold">
                  {facts.name}
                </span>
                <CustomStatusLine
                  line={facts.customLine}
                  className="w-full text-center"
                />
                {meta ? (
                  <span className="w-full truncate text-caption text-muted">
                    {meta}
                  </span>
                ) : null}
                {member.email ? (
                  <span className="w-full truncate text-caption text-muted">
                    {member.email}
                  </span>
                ) : null}
              </span>
              <span className="text-caption tabular-nums text-muted">
                {formatPoints(facts.points)}
                {facts.joined ? ` · joined ${facts.joined}` : null}
              </span>
            </button>
            <label
              className={cn(
                dashboardCheckboxHitAreaClassName,
                "absolute left-1 top-1",
              )}
            >
              <input
                type="checkbox"
                aria-label={`Select ${facts.name}`}
                className={dashboardTableCheckboxClassName}
                checked={selected}
                onChange={(event) => onToggle(id, event.target.checked)}
              />
            </label>
          </li>
        );
      })}
    </ul>
  );
}
