"use client";

import { useId, useMemo } from "react";
import {
  memberLabel,
  useChannelMembers,
  useMemberDisplayNames,
} from "@repo/hooks";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { EYEBROW } from "@/components/ui/typography";
import { Skeleton } from "@/components/shared/async-states";
import { AvatarPresenceDot } from "@/components/members/presence-dot";
import { useChapterPresenceContext } from "@/lib/providers/chapter-presence-provider";
import type { PresenceStatus } from "@/lib/realtime/presence-status";
import { cn, initials } from "@/lib/utils";

/** One row of the list, joined from the channel read, the roster and presence. */
export interface ChannelMemberRow {
  userId: string;
  name: string;
  avatarUrl: string | null;
  roleColor: string | null;
  roleRank: number | null;
  /** `null` until presence has resolved: no dot, and no claim of Offline. */
  status: PresenceStatus | null;
}

export interface ChannelMemberGroup {
  key: PresenceStatus | "all";
  label: string;
  rows: ChannelMemberRow[];
}

const GROUP_LABELS: Record<PresenceStatus, string> = {
  online: "Online",
  idle: "Idle",
  offline: "Offline",
};

/**
 * Role rank first (lower `display_order` ranks higher, a member with no role
 * last), then name, so officers lead each group as they do on the Roles page.
 */
function compareRows(a: ChannelMemberRow, b: ChannelMemberRow): number {
  const rankA = a.roleRank ?? Number.POSITIVE_INFINITY;
  const rankB = b.roleRank ?? Number.POSITIVE_INFINITY;
  if (rankA !== rankB) return rankA - rankB;
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

/**
 * Online, then Idle, then Offline, each sorted by {@link compareRows}; empty
 * groups are dropped. Before presence resolves every status is `null`, and the
 * rows come back as one unlabelled-by-status "Members" group rather than all
 * claiming Offline, which would be a statement about each member sourced from
 * our own unfinished join (`presence-dot.tsx`).
 */
export function groupChannelMembers(
  rows: readonly ChannelMemberRow[],
): ChannelMemberGroup[] {
  if (rows.every((row) => row.status === null)) {
    return rows.length
      ? [{ key: "all", label: "Members", rows: [...rows].sort(compareRows) }]
      : [];
  }
  return (["online", "idle", "offline"] as const).flatMap((status) => {
    const inGroup = rows
      .filter((row) => (row.status ?? "offline") === status)
      .sort(compareRows);
    return inGroup.length
      ? [{ key: status, label: GROUP_LABELS[status], rows: inGroup }]
      : [];
  });
}

/**
 * Who can read the open channel, Discord-style (#3536): grouped by presence,
 * officers first within each group, names in their role color.
 *
 * Read-only rows. Nothing here is a control yet, so the rows are list items
 * rather than buttons, and the list is announced by its heading.
 *
 * `channelId: null` draws the skeleton: the shell mounts the column before the
 * channel list resolves, so the timeline does not lose 240px a beat after
 * first paint. `enabled: false` also holds the skeleton without reading, for a
 * column CSS has hidden below 1280px.
 */
export function ChannelMemberList({
  channelId,
  enabled = true,
}: {
  channelId: string | null;
  enabled?: boolean;
}) {
  const headingId = useId();
  const membersQuery = useChannelMembers(channelId, { enabled });
  const roster = useMemberDisplayNames();
  const { byId, avatarFor, roleColorFor } = roster;
  const presence = useChapterPresenceContext();

  const groups = useMemo(() => {
    const rows: ChannelMemberRow[] = (membersQuery.data ?? []).map(
      (member) => ({
        userId: member.user_id,
        // `memberLabel`, never a drop: a member who never set a name (or whose
        // roster row is missing) still reads the channel, so they are listed
        // as "Member 2f4a1c" like every other member surface (#2422).
        name: memberLabel(byId[member.user_id], member.user_id),
        avatarUrl: avatarFor(member.user_id),
        roleColor: roleColorFor(member.user_id),
        roleRank: member.role_rank,
        status: presence.isReady ? presence.statusOf(member.user_id) : null,
      }),
    );
    return groupChannelMembers(rows);
  }, [membersQuery.data, byId, avatarFor, roleColorFor, presence]);

  // Names come from the roster, so a list without them is not ready either;
  // a failure of either read gets the error, and Retry reruns whichever failed.
  const failed = membersQuery.isError || roster.isError;
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
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        {failed ? (
          <div className="space-y-2 px-2 py-4 text-center text-caption text-muted-foreground">
            <p>Couldn&apos;t load members.</p>
            <button
              type="button"
              onClick={() => {
                if (membersQuery.isError) void membersQuery.refetch();
                if (roster.isError) roster.refetch();
              }}
              className="font-semibold text-foreground underline-offset-2 hover:underline"
            >
              Retry
            </button>
          </div>
        ) : loading ? (
          <MemberListSkeleton />
        ) : (
          groups.map((group) => <MemberGroup key={group.key} group={group} />)
        )}
      </div>
    </section>
  );
}

function MemberGroup({ group }: { group: ChannelMemberGroup }) {
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
          <MemberRow key={row.userId} row={row} />
        ))}
      </ul>
    </div>
  );
}

/**
 * 32px, the size scale's list row (foundations §9). An offline member is
 * dimmed as Discord dims them, but only where contrast is not at stake: the
 * avatar fades, and a name without a role color drops to the muted text step.
 * A role-colored name keeps its full color, because the palette was
 * contrast-checked at full strength and an opacity would undo that.
 */
function MemberRow({ row }: { row: ChannelMemberRow }) {
  const offline = row.status === "offline";
  return (
    <li
      data-presence={row.status ?? undefined}
      className="flex h-8 items-center gap-2 rounded-md px-2"
    >
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
      {row.status ? (
        <span className="sr-only">, {GROUP_LABELS[row.status]}</span>
      ) : null}
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
