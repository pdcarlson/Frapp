"use client";

import Link from "next/link";
import { useMemo } from "react";
import {
  BookOpen,
  CalendarDays,
  CircleDollarSign,
  Star,
  Users,
  type LucideIcon,
} from "lucide-react";
import {
  useBackworkResources,
  useEvents,
  useLeaderboard,
  useMembers,
  useOverdueInvoices,
} from "@repo/hooks";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { asArray, cn } from "@/lib/utils";
import { ErrorState, LoadingState } from "@/components/shared/async-states";
import { useChapterStore } from "@/lib/stores/chapter-store";

const MAX_FEED_ITEMS = 10;

type FeedItem = {
  id: string;
  icon: LucideIcon;
  iconClassName: string;
  message: string;
  timestamp: Date;
  href?: string;
};

function relativeTime(timestamp: Date, reference: Date): string {
  const deltaMs = reference.getTime() - timestamp.getTime();
  const absMs = Math.abs(deltaMs);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;

  if (absMs < minute) return "just now";
  if (absMs < hour) {
    const minutes = Math.floor(absMs / minute);
    return `${minutes} minute${minutes === 1 ? "" : "s"} ${deltaMs >= 0 ? "ago" : "from now"}`;
  }
  if (absMs < day) {
    const hours = Math.floor(absMs / hour);
    return `${hours} hour${hours === 1 ? "" : "s"} ${deltaMs >= 0 ? "ago" : "from now"}`;
  }
  if (absMs < week) {
    const days = Math.floor(absMs / day);
    return `${days} day${days === 1 ? "" : "s"} ${deltaMs >= 0 ? "ago" : "from now"}`;
  }
  return timestamp.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: timestamp.getFullYear() === reference.getFullYear() ? undefined : "numeric",
  });
}

type EventLike = {
  id?: string;
  name?: string;
  start_time?: string;
  end_time?: string;
  location?: string | null;
  is_mandatory?: boolean;
  created_at?: string;
};

type MemberLike = {
  id?: string;
  user_id?: string;
  display_name?: string | null;
  created_at?: string;
};

type LeaderboardLike = {
  user_id?: string;
  total?: number;
};

type BackworkLike = {
  id?: string;
  title?: string | null;
  course_number?: string | null;
  assignment_type?: string | null;
  created_at?: string;
};

type InvoiceLike = {
  id?: string;
  title?: string | null;
  amount?: number;
  due_date?: string;
  status?: string;
};

function buildEventItems(events: EventLike[], now: Date): FeedItem[] {
  return events
    .filter((event) => !!event.id && !!event.start_time)
    .map((event) => {
      const start = new Date(event.start_time as string);
      const upcoming = start.getTime() >= now.getTime();
      const label = upcoming ? "Upcoming event" : "Recent event";
      const name = event.name ?? "Untitled event";
      return {
        id: `event-${event.id}`,
        icon: CalendarDays,
        iconClassName: "text-primary",
        message: `${label}: ${name}${event.is_mandatory ? " (mandatory)" : ""}`,
        timestamp: start,
        href: "/events",
      } satisfies FeedItem;
    });
}

function buildMemberItems(members: MemberLike[]): FeedItem[] {
  return members
    .filter((member) => !!member.created_at)
    .map((member) => ({
      id: `member-${member.id}`,
      icon: Users,
      iconClassName: "text-emerald-600",
      message: `New member joined: ${member.display_name ?? "Unnamed member"}`,
      timestamp: new Date(member.created_at as string),
      href: "/members",
    }));
}

function buildLeaderboardItems(
  leaderboard: LeaderboardLike[],
  members: MemberLike[],
  now: Date,
): FeedItem[] {
  if (!leaderboard.length) return [];
  const nameByUser = new Map<string, string>();
  for (const member of members) {
    if (member.user_id && member.display_name) {
      nameByUser.set(member.user_id, member.display_name);
    }
  }
  return leaderboard.slice(0, 3).map((entry, index) => ({
    id: `leader-${entry.user_id ?? index}`,
    icon: Star,
    iconClassName: "text-amber-500",
    message: `${nameByUser.get(entry.user_id ?? "") ?? "A brother"} holds ${entry.total ?? 0} points`,
    timestamp: now,
    href: "/points",
  }));
}

function buildBackworkItems(items: BackworkLike[]): FeedItem[] {
  return items
    .filter((item) => !!item.created_at)
    .map((item) => ({
      id: `backwork-${item.id}`,
      icon: BookOpen,
      iconClassName: "text-indigo-500",
      message: `Backwork upload${item.course_number ? ` (${item.course_number})` : ""}: ${
        item.title ?? item.assignment_type ?? "Untitled resource"
      }`,
      timestamp: new Date(item.created_at as string),
    }));
}

function buildInvoiceItems(items: InvoiceLike[]): FeedItem[] {
  return items
    .filter((item) => !!item.due_date)
    .map((item) => ({
      id: `invoice-${item.id}`,
      icon: CircleDollarSign,
      iconClassName: "text-destructive",
      message: `Overdue invoice: ${item.title ?? "Chapter dues"}`,
      timestamp: new Date(item.due_date as string),
      href: "/billing",
    }));
}

function useActivityFeed() {
  const activeChapterId = useChapterStore((s) => s.activeChapterId);
  const enabled = Boolean(activeChapterId);
  const eventsQuery = useEvents();
  const membersQuery = useMembers();
  const leaderboardQuery = useLeaderboard("month");
  const backworkQuery = useBackworkResources();
  const invoicesQuery = useOverdueInvoices();

  const items = useMemo<FeedItem[]>(() => {
    const now = new Date();
    const events = buildEventItems(asArray<EventLike>(eventsQuery.data), now);
    const members = buildMemberItems(asArray<MemberLike>(membersQuery.data));
    const leaders = buildLeaderboardItems(
      asArray<LeaderboardLike>(leaderboardQuery.data),
      asArray<MemberLike>(membersQuery.data),
      now,
    );
    const backwork = buildBackworkItems(
      asArray<BackworkLike>(backworkQuery.data),
    );
    const invoices = buildInvoiceItems(asArray<InvoiceLike>(invoicesQuery.data));
    return [...events, ...members, ...leaders, ...backwork, ...invoices]
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, MAX_FEED_ITEMS);
  }, [
    eventsQuery.data,
    membersQuery.data,
    leaderboardQuery.data,
    backworkQuery.data,
    invoicesQuery.data,
  ]);

  const isLoading =
    enabled &&
    (eventsQuery.isPending ||
      membersQuery.isPending);
  // Only treat hard failures as errors (403s from permissions are expected
  // for roles that can't see some feeds — treat them as empty).
  const criticalError =
    enabled &&
    ((eventsQuery.error && !eventsQuery.data) ||
      (membersQuery.error && !membersQuery.data));

  return {
    enabled,
    items,
    isLoading,
    isError: Boolean(criticalError),
    retry: () => {
      void eventsQuery.refetch();
      void membersQuery.refetch();
      void leaderboardQuery.refetch();
      void backworkQuery.refetch();
      void invoicesQuery.refetch();
    },
  };
}

export function ActivityFeed() {
  const { enabled, items, isLoading, isError, retry } = useActivityFeed();
  const now = new Date();

  if (!enabled) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Recent activity</CardTitle>
          <CardDescription>
            Select an active chapter to load chapter events, members, and
            point activity.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (isLoading) {
    return <LoadingState message="Loading chapter activity..." />;
  }

  if (isError) {
    return (
      <ErrorState
        title="Activity feed unavailable"
        description="Couldn't reach the API for events or members. Retry in a moment or confirm your chapter access."
        onRetry={retry}
      />
    );
  }

  if (items.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Recent activity</CardTitle>
          <CardDescription>
            Activity will appear here as events are scheduled, members join,
            and points change.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-xl">Recent activity</CardTitle>
          <CardDescription>
            Live roll-up of events, members, points, and backwork
          </CardDescription>
        </div>
        <Badge variant="secondary">Live</Badge>
      </CardHeader>
      <div className="divide-y divide-border/70">
        {items.map((item) => {
          const body = (
            <div className="flex items-start gap-3 px-6 py-3">
              <item.icon
                className={cn("mt-0.5 h-4 w-4", item.iconClassName)}
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{item.message}</p>
                <p className="text-xs text-muted-foreground">
                  {relativeTime(item.timestamp, now)}
                </p>
              </div>
            </div>
          );
          return item.href ? (
            <Link
              key={item.id}
              href={item.href}
              className="block transition hover:bg-muted/50"
            >
              {body}
            </Link>
          ) : (
            <div key={item.id}>{body}</div>
          );
        })}
      </div>
    </Card>
  );
}
