"use client";

import { useMemo, useRef } from "react";
import { Loader2, MessageSquare } from "lucide-react";
import {
  useMemberByUserId,
  useMemberDisplayNames,
  useRoles,
} from "@repo/hooks";
import { memberLabel } from "@repo/hooks/display-names";
import { resolveRoleChips } from "@repo/validation";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { SkeletonText } from "@/components/shared/async-states";
import {
  metaLine,
  RoleChip,
  stringField,
  stringIds,
  type MemberRecord,
} from "@/components/members/member-detail-rows";
import { useMessageMember } from "@/lib/chat/use-message-member";
import { initials } from "@/lib/utils";

/** How many role chips the popout shows before "+N"; the full list is a click away. */
const POPOUT_ROLE_LIMIT = 4;

/**
 * Where the popout sits: the name, photo or `@` chip that opened it. Read live
 * while the element is on the page, so the popout follows a scroll; the last
 * box it had is kept for when a re-render replaces the element, so the popout
 * never jumps to the corner of the window.
 */
export function anchorFor(element: HTMLElement): {
  contextElement: HTMLElement;
  getBoundingClientRect: () => DOMRect;
} {
  let last = element.getBoundingClientRect();
  return {
    // floating-ui's name for the node behind a virtual reference: it is how
    // the popout learns which scroll container and box to follow.
    contextElement: element,
    getBoundingClientRect: () => {
      if (element.isConnected) last = element.getBoundingClientRect();
      return last;
    },
  };
}

export type MemberPopoutAnchor = ReturnType<typeof anchorFor>;

/** Focus back on the opener, unless something else has taken it since. */
function refocusOpener(
  anchor: MemberPopoutAnchor | null,
  popout: HTMLElement | null,
) {
  const active = document.activeElement;
  const stranded =
    !active || active === document.body || !!popout?.contains(active);
  if (stranded && anchor?.contextElement.isConnected)
    anchor.contextElement.focus();
}

/**
 * A member's profile popout (#4593, item 8): a click on a sender's name or
 * photo, or on an `@` chip, opens this small card beside what was clicked, as
 * Discord's user popout and Slack's profile card do, instead of the full
 * profile sheet over the whole page. Chat stays where it was.
 *
 * The card is who they are at a glance (photo, name in their role color, the
 * class-year line, roles) and the two things a name is clicked for: Message,
 * and View profile, which opens the full `MemberDetailSheet` with their
 * contact rows and an officer's controls. It reads the same
 * `GET /v1/members/by-user/{userId}` the sheet reads, so View profile opens on
 * a warm cache. The roster's name and photo draw until that read lands, so the
 * card never opens blank.
 *
 * A Radix popover anchored to the clicked element, so Radix has no trigger to
 * hand focus back to: Escape, and a click on nothing in particular, put focus
 * back on the name that opened it here. View profile moves focus to that name
 * before the sheet opens, so the sheet's close returns there too.
 */
export function MemberPopout({
  userId,
  anchor,
  open,
  onOpenChange,
  identity,
  onViewProfile,
  side = "right",
}: {
  userId: string | null;
  anchor: MemberPopoutAnchor | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The roster's name and photo, drawn until the profile read lands. */
  identity: { name: string | null; avatarUrl: string | null } | null;
  onViewProfile: (userId: string) => void;
  /** Which side of the anchor it opens on; it flips when there is no room. */
  side?: "left" | "right";
}) {
  const memberQuery = useMemberByUserId(userId ?? "");
  const rolesQuery = useRoles();
  const { avatarTintFor, roleColorFor } = useMemberDisplayNames();

  const member =
    memberQuery.data && typeof memberQuery.data === "object"
      ? (memberQuery.data as MemberRecord)
      : null;
  const memberRoleIds = useMemo(
    () => stringIds(member?.role_ids),
    [member?.role_ids],
  );
  const roleChips = useMemo(
    () => resolveRoleChips(rolesQuery.data, memberRoleIds),
    [rolesQuery.data, memberRoleIds],
  );

  const displayName = memberLabel(
    member?.display_name ?? identity?.name,
    member?.user_id ?? userId,
  );
  const avatarUrl =
    stringField(member, "avatar_url") ?? identity?.avatarUrl ?? null;
  const meta = metaLine(member);
  const nameColor = userId ? roleColorFor(userId) : null;

  const { canMessage, startMessage, isPending } = useMessageMember(
    stringField(member, "user_id"),
    () => onOpenChange(false),
  );

  const contentRef = useRef<HTMLDivElement>(null);
  const shownChips = roleChips.slice(0, POPOUT_ROLE_LIMIT);
  const hiddenChipCount = roleChips.length - shownChips.length;

  return (
    <Popover open={open && !!userId && !!anchor} onOpenChange={onOpenChange}>
      {anchor ? <PopoverAnchor virtualRef={{ current: anchor }} /> : null}
      <PopoverContent
        side={side}
        align="start"
        sideOffset={8}
        collisionPadding={16}
        aria-label={`${displayName}'s profile`}
        className="flex w-72 flex-col gap-3 p-4"
        data-testid="member-popout"
        ref={contentRef}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          refocusOpener(anchor, contentRef.current);
        }}
      >
        <div className="flex items-center gap-3">
          <Avatar className="h-14 w-14 shrink-0" aria-hidden="true">
            {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
            <AvatarFallback
              tint={userId ? avatarTintFor(userId) : null}
              className="border border-border bg-card text-base font-bold text-muted-foreground"
            >
              {initials(displayName)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p
              className="break-words text-body font-bold leading-6 text-foreground"
              style={nameColor ? { color: nameColor } : undefined}
            >
              {displayName}
            </p>
            {meta ? (
              <p className="text-caption text-muted-foreground">{meta}</p>
            ) : null}
          </div>
        </div>

        {!member && memberQuery.isPending ? (
          <SkeletonText lines={1} />
        ) : shownChips.length > 0 ? (
          <ul aria-label="Roles" className="flex flex-wrap gap-1.5">
            {shownChips.map((chip) => (
              <RoleChip key={chip.id} chip={chip} />
            ))}
            {hiddenChipCount > 0 ? (
              <li className="inline-flex items-center px-1 text-caption text-muted-foreground">
                +{hiddenChipCount}
              </li>
            ) : null}
          </ul>
        ) : null}

        <div className="flex gap-2">
          {canMessage ? (
            <Button
              size="sm"
              className="flex-1"
              onClick={() => void startMessage()}
              disabled={isPending}
            >
              {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <MessageSquare className="h-4 w-4" aria-hidden="true" />
              )}
              Message
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="secondary"
            className="flex-1"
            onClick={() => {
              if (!userId) return;
              if (anchor?.contextElement.isConnected)
                anchor.contextElement.focus();
              onOpenChange(false);
              onViewProfile(userId);
            }}
          >
            View profile
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
