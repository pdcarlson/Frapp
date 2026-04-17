"use client";

import {
  CalendarDays,
  CircleDollarSign,
  Star,
  Users,
  type LucideIcon,
} from "lucide-react";
import {
  useBillingStatus,
  useEvents,
  useLeaderboard,
  useMembers,
} from "@repo/hooks";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useChapterStore } from "@/lib/stores/chapter-store";

type StatStatus = "idle" | "loading" | "ready" | "error";

type StatDefinition = {
  id: string;
  label: string;
  value: string;
  detail: string;
  icon: LucideIcon;
  status: StatStatus;
};

function asNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return 0;
}

function formatCount(count: number): string {
  return count.toLocaleString();
}

export function OverviewStatCards() {
  const activeChapterId = useChapterStore((s) => s.activeChapterId);
  const enabled = Boolean(activeChapterId);

  const membersQuery = useMembers();
  const eventsQuery = useEvents();
  const billingQuery = useBillingStatus();
  const leaderboardQuery = useLeaderboard("month");

  const membersArray = Array.isArray(membersQuery.data) ? membersQuery.data : [];
  const eventsArray = Array.isArray(eventsQuery.data) ? eventsQuery.data : [];
  const leaderboardArray = Array.isArray(leaderboardQuery.data)
    ? leaderboardQuery.data
    : [];

  const now = Date.now();
  const upcomingEvents = eventsArray.filter((event) => {
    const raw = (event as { start_time?: string }).start_time;
    if (!raw) return false;
    const date = new Date(raw);
    return date.getTime() >= now;
  }).length;

  const totalPointsThisMonth = leaderboardArray.reduce(
    (sum, entry) => sum + asNumber((entry as { total?: number }).total),
    0,
  );

  const billingStatus =
    (billingQuery.data as { subscription_status?: string } | undefined)
      ?.subscription_status ?? "unknown";

  function derive(query: {
    isPending: boolean;
    isFetching: boolean;
    isError: boolean;
    data: unknown;
  }): StatStatus {
    if (!enabled) return "idle";
    if (query.isPending) return "loading";
    if (query.isError) return "error";
    if (query.data === undefined && query.isFetching) return "loading";
    return "ready";
  }

  const stats: StatDefinition[] = [
    {
      id: "members",
      label: "Active members",
      value:
        enabled && derive(membersQuery) === "ready"
          ? formatCount(membersArray.length)
          : "—",
      detail:
        derive(membersQuery) === "error"
          ? "Couldn't load chapter members."
          : "Directory entries for this chapter",
      icon: Users,
      status: derive(membersQuery),
    },
    {
      id: "events",
      label: "Upcoming events",
      value:
        enabled && derive(eventsQuery) === "ready"
          ? formatCount(upcomingEvents)
          : "—",
      detail:
        derive(eventsQuery) === "error"
          ? "Couldn't load chapter events."
          : `From ${formatCount(eventsArray.length)} total on the calendar`,
      icon: CalendarDays,
      status: derive(eventsQuery),
    },
    {
      id: "points",
      label: "Points awarded this month",
      value:
        enabled && derive(leaderboardQuery) === "ready"
          ? formatCount(totalPointsThisMonth)
          : "—",
      detail:
        derive(leaderboardQuery) === "error"
          ? "Leaderboard unavailable — check permissions."
          : "Rolling 30-day total across the chapter",
      icon: Star,
      status: derive(leaderboardQuery),
    },
    {
      id: "billing",
      label: "Subscription status",
      value: enabled ? billingStatus.replace("_", " ") : "—",
      detail:
        derive(billingQuery) === "error"
          ? "Billing status unavailable — requires billing:view."
          : "Live Stripe subscription state",
      icon: CircleDollarSign,
      status: derive(billingQuery),
    },
  ];

  return (
    <section
      className="grid gap-4 md:grid-cols-2 xl:grid-cols-4"
      aria-label="Chapter statistics"
    >
      {stats.map((stat) => (
        <Card key={stat.id}>
          <CardHeader className="pb-3">
            <CardDescription className="flex items-center justify-between">
              <span>{stat.label}</span>
              <stat.icon className="h-4 w-4 text-primary" />
            </CardDescription>
            <CardTitle className="text-3xl tracking-tight">
              {stat.status === "loading" ? (
                <span className="inline-block h-8 w-20 animate-pulse rounded bg-muted" />
              ) : (
                stat.value
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">{stat.detail}</p>
          </CardContent>
        </Card>
      ))}
    </section>
  );
}
