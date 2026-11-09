"use client";

import { useId, useMemo, useState } from "react";
import {
  MEMBER_SEARCH_THRESHOLD,
  filterChannelMembers,
  groupChannelMembersByRole,
  memberLabel,
  useChannelMembers,
  useMemberDisplayNames,
  type ChannelMemberRoleGroup,
} from "@repo/hooks";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { EYEBROW } from "@/components/ui/typography";
import { Skeleton } from "@/components/shared/async-states";
import {
  AvatarPresenceDot,
  CustomStatusLine,
} from "@/components/members/presence-dot";
import { useChapterPresenceContext } from "@/lib/providers/chapter-presence-provider";
import {
  presenceLabel,
  type PresenceStatus,
} from "@/lib/realtime/presence-status";
import { FOCUS_RING_OFFSET } from "@/components/ui/focus";
import { cn, initials } from "@/lib/utils";

/** One row of the list, joined from the channel read, the roster and presence. */
export interface ChannelMemberRow {
  userId: string;
  name: string;
  avatarUrl: string | null;
  roleColor: string | null;
  roleRank: number | null;
  /** The highest role's id, the group this row sits in. */
  roleId: string | null;
  roleName: string | null;
  /** `null` until presence has resolved: no dot, and no claim of Offline. */
  status: PresenceStatus | null;
  /** The member's custom status line (#3845), or `null`. */
  line: string | null;
}

export type ChannelMemberGroup = ChannelMemberRoleGroup<ChannelMemberRow>;

/**
 * Who can read the open channel, Discord-style (#3536): grouped under each
 * reader's highest role, in role order, names A to Z and in their role color
 * (`groupChannelMembersByRole`, shared with the mobile sheet). Presence only
 * paints the dot and dims an offline avatar: it never moves a row, so the list
 * holds still when presence arrives (principles.md P4.4). Past
 * {@link MEMBER_SEARCH_THRESHOLD} readers a search field filters by name.
 *
 * A row opens that member's profile (#3726), the same sheet a click on a
 * sender's name or an `@` chip opens, so each row is a button inside its list
 * item and the list is announced by its heading. Without `onOpenProfile` the
 * rows are plain list items.
 *
 * `channelId: null` draws the skeleton: the shell mounts the column before the
 * channel list resolves, so the timeline does not lose 240px a beat after
 * first paint. `enabled: false` also holds the skeleton without reading, for a
 * column CSS has hidden below 1280px.
 */
export function ChannelMemberList({
  channelId,
  enabled = true,
  onOpenProfile,
}: {
  channelId: string | null;
  enabled?: boolean;
  /** Opens a member's profile by `users.id`. */
  onOpenProfile?: (userId: string) => void;
}) {
  const headingId = useId();
  const membersQuery = useChannelMembers(channelId, { enabled });
  const roster = useMemberDisplayNames();
  const { byId, avatarFor, roleColorFor } = roster;
  const presence = useChapterPresenceContext();

  const [query, setQuery] = useState("");
  // A search belongs to the channel it was typed in: switching channels
  // starts the next list unfiltered (adjusting state on a prop change during
  // render, not in an effect, so no frame draws the old filter).
  const [queryFor, setQueryFor] = useState(channelId);
  if (queryFor !== channelId) {
    setQueryFor(channelId);
    setQuery("");
  }

  const rows = useMemo<ChannelMemberRow[]>(
    () =>
      (membersQuery.data ?? []).map((member) => ({
        userId: member.user_id,
        // `memberLabel`, never a drop: a member who never set a name (or whose
        // roster row is missing) still reads the channel, so they are listed
        // as "Member 2f4a1c" like every other member surface (#2422).
        name: memberLabel(byId[member.user_id], member.user_id),
        avatarUrl: avatarFor(member.user_id),
        roleColor: roleColorFor(member.user_id),
        roleRank: member.role_rank,
        roleId: member.role_id ?? null,
        roleName: member.role_name ?? null,
        status: presence.isReady ? presence.statusOf(member.user_id) : null,
        line: presence.isReady ? presence.lineOf(member.user_id) : null,
      })),
    [membersQuery.data, byId, avatarFor, roleColorFor, presence],
  );
  const searchable = rows.length > MEMBER_SEARCH_THRESHOLD;
  const trimmed = searchable ? query.trim() : "";
  const groups = useMemo(
    () => groupChannelMembersByRole(filterChannelMembers(rows, trimmed)),
    [rows, trimmed],
  );

  // Names come from the roster, so a list without them is not ready either.
  // A read fails the list only when it has nothing to draw: TanStack keeps
  // the last good data through a failed refetch, so a background blip leaves
  // the list up rather than swapping it for an error. Retry reruns only what
  // failed.
  const membersFailed = membersQuery.isError && membersQuery.data === undefined;
  const rosterFailed = roster.isError && !roster.hasData;
  const failed = membersFailed || rosterFailed;
  const loading =
    !channelId || !enabled || membersQuery.isPending || roster.isPending;

  return (
    <section
      aria-labelledby={headingId}
      className="flex min-h-0 flex-1 flex-col"
    >
      <h2 id={headingId} className="sr-only">
        Members
      </h2>
      {searchable && !failed && !loading ? (
        <div className="px-2 pt-3">
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && query) {
                event.preventDefault();
                event.stopPropagation();
                setQuery("");
              }
            }}
            placeholder={`Search ${rows.length} members`}
            aria-label="Search members"
            className="h-8 px-2.5 pointer-coarse:h-11"
          />
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        {failed ? (
          <div className="space-y-2 px-2 py-4 text-center text-caption text-muted-foreground">
            <p>Couldn&apos;t load members.</p>
            <button
              type="button"
              onClick={() => {
                if (membersFailed) void membersQuery.refetch();
                if (rosterFailed) roster.refetch();
              }}
              className="font-semibold text-foreground underline-offset-2 hover:underline"
            >
              Retry
            </button>
          </div>
        ) : loading ? (
          <MemberListSkeleton />
        ) : groups.length === 0 && trimmed ? (
          <p
            role="status"
            className="px-2 py-4 text-center text-caption text-muted-foreground"
          >
            No one named &ldquo;{trimmed}&rdquo;
          </p>
        ) : (
          groups.map((group) => (
            <MemberGroup
              key={group.key}
              group={group}
              onOpenProfile={onOpenProfile}
            />
          ))
        )}
      </div>
    </section>
  );
}

function MemberGroup({
  group,
  onOpenProfile,
}: {
  group: ChannelMemberGroup;
  onOpenProfile?: (userId: string) => void;
}) {
  const labelId = useId();
  return (
    <div className="pb-3">
      <p
        id={labelId}
        className={cn("px-2 pb-1 text-muted-foreground", EYEBROW)}
      >
        {group.label}
        <span className="ml-1.5 tabular-nums">{group.rows.length}</span>
      </p>
      <ul aria-labelledby={labelId}>
        {group.rows.map((row) => (
          <MemberRow
            key={row.userId}
            row={row}
            onOpen={onOpenProfile ? () => onOpenProfile(row.userId) : undefined}
          />
        ))}
      </ul>
    </div>
  );
}

/**
 * 32px on a mouse, the size scale's list row (foundations §9), and 44px on a
 * coarse pointer now that a row is a control (§2's touch floor). An offline
 * member is dimmed as Discord dims them, but only where contrast is not at
 * stake: the avatar fades, and a name without a role color drops to the muted
 * text step. A role-colored name keeps its full color, because the palette
 * was contrast-checked at full strength and an opacity would undo that.
 * `FOCUS_RING_OFFSET`: the row carries no border for `FOCUS_RING` to swap.
 */
function MemberRow({
  row,
  onOpen,
}: {
  row: ChannelMemberRow;
  onOpen?: () => void;
}) {
  const offline = row.status === "offline" || row.status === "invisible";
  const content = (
    <>
      <span className="relative shrink-0">
        <Avatar
          className={cn("h-6 w-6", offline && "opacity-50")}
          aria-hidden="true"
        >
          {row.avatarUrl ? <AvatarImage src={row.avatarUrl} alt="" /> : null}
          <AvatarFallback className="text-[10px]">
            {initials(row.name)}
          </AvatarFallback>
        </Avatar>
        <AvatarPresenceDot status={row.status} />
      </span>
      <span className="flex min-w-0 flex-col">
        <span
          className={cn(
            "min-w-0 truncate text-label",
            !row.roleColor &&
              (offline ? "text-muted-foreground" : "text-foreground"),
          )}
          style={row.roleColor ? { color: row.roleColor } : undefined}
        >
          {row.name}
        </span>
        <CustomStatusLine line={row.line} />
      </span>
      {row.status ? (
        <span className="sr-only">, {presenceLabel(row.status)}</span>
      ) : null}
    </>
  );
  const rowClass = cn(
    "flex w-full items-center gap-2 rounded-md px-2",
    row.line ? "h-10" : "h-8",
  );
  return (
    <li data-presence={row.status ?? undefined}>
      {onOpen ? (
        <button
          type="button"
          aria-haspopup="dialog"
          onClick={onOpen}
          className={cn(
            rowClass,
            "text-left transition-colors hover:bg-card-hover pointer-coarse:h-11",
            FOCUS_RING_OFFSET,
          )}
        >
          {content}
        </button>
      ) : (
        <div className={rowClass}>{content}</div>
      )}
    </li>
  );
}

function MemberListSkeleton() {
  return (
    <div aria-hidden="true" className="space-y-1 px-2">
      <Skeleton className="mb-2 h-3 w-16" />
      {["w-24", "w-32", "w-20", "w-28", "w-24", "w-16"].map((width, index) => (
        <div key={index} className="flex h-8 items-center gap-2">
          <Skeleton className="h-6 w-6 shrink-0 rounded-full" />
          <Skeleton className={cn("h-3", width)} />
        </div>
      ))}
    </div>
  );
}
