"use client";

import Link from "next/link";
import { Bell, CheckCheck, Loader2 } from "lucide-react";
import {
  useMarkNotificationRead,
  useNotifications,
} from "@repo/hooks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { asArray } from "@/lib/utils";
import { useRealtimeTable } from "@/lib/realtime/use-realtime-table";
import { useFrappUser } from "@/lib/auth/use-frapp-user";

type DashboardNotificationDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type Notification = {
  id: string;
  chapter_id: string;
  user_id: string;
  title: string;
  body: string;
  data?: {
    target?: {
      screen?: string;
      channelId?: string;
      messageId?: string;
      eventId?: string;
      taskId?: string;
      invoiceId?: string;
    };
    priority?: "URGENT" | "NORMAL" | "SILENT";
  } | null;
  read_at: string | null;
  created_at: string;
};

function formatTime(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString();
}

/**
 * Map a notification target payload to an in-app dashboard path.
 *
 * The mobile app uses the same payload shape (see spec/behavior §7) but
 * sends users to native screens. The web versions of those screens are
 * only subset; we fall back to `/home` when a screen isn't yet built so
 * links never dead-end.
 */
function deepLinkFor(notification: Notification): string {
  const target = notification.data?.target;
  if (!target) return "/home";
  switch (target.screen) {
    case "chat":
      return "/home"; // Chat ships in a later slice.
    case "events":
      return "/events";
    case "points":
      return "/points";
    case "billing":
      return "/billing";
    case "tasks":
      return "/tasks";
    case "service":
      return "/service";
    case "profile":
      return "/profile";
    default:
      return "/home";
  }
}

export function DashboardNotificationDrawer({
  open,
  onOpenChange,
}: DashboardNotificationDrawerProps) {
  const frappUser = useFrappUser();
  const notificationsQuery = useNotifications();
  const markRead = useMarkNotificationRead();

  // Live updates: any notification INSERT for the current user (and
  // UPDATE when it's marked read elsewhere) refreshes the list.
  useRealtimeTable({
    table: "notifications",
    filter: frappUser.userId ? `user_id=eq.${frappUser.userId}` : undefined,
    invalidate: [["notifications"]],
    enabled: Boolean(frappUser.userId),
  });

  const notifications = asArray<Notification>(notificationsQuery.data).sort(
    (a, b) => (a.created_at < b.created_at ? 1 : -1),
  );
  const unreadCount = notifications.filter((n) => !n.read_at).length;

  async function handleMarkRead(notification: Notification) {
    if (notification.read_at) return;
    try {
      await markRead.mutateAsync(notification.id);
    } catch {
      // Silent — the mark-read button re-enables automatically since the
      // query invalidation will re-fetch. The user can retry by clicking.
    }
  }

  async function markAllRead() {
    const unread = notifications.filter((n) => !n.read_at);
    await Promise.allSettled(unread.map((n) => markRead.mutateAsync(n.id)));
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Bell className="h-4 w-4" />
            Notifications
            {unreadCount > 0 ? (
              <Badge variant="destructive" className="ml-1">
                {unreadCount}
              </Badge>
            ) : null}
          </SheetTitle>
          <SheetDescription>
            Chapter activity, billing alerts, and point changes for your
            account. Click a card to jump to the source.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {notifications.length} total
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={unreadCount === 0 || markRead.isPending}
              onClick={() => void markAllRead()}
            >
              <CheckCheck className="h-4 w-4" />
              Mark all read
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void notificationsQuery.refetch()}
              disabled={notificationsQuery.isFetching}
            >
              {notificationsQuery.isFetching ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              Refresh
            </Button>
          </div>
        </div>

        <div className="mt-3 flex-1 overflow-y-auto">
          {notificationsQuery.isPending ? (
            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading notifications...
            </div>
          ) : notificationsQuery.isError ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              Couldn&apos;t load notifications. Retry in a moment.
            </div>
          ) : notifications.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              No notifications yet. Chapter activity, billing alerts, and
              point changes will appear here.
            </div>
          ) : (
            <ul className="space-y-3">
              {notifications.map((notification) => {
                const isRead = Boolean(notification.read_at);
                return (
                  <li key={notification.id}>
                    <Link
                      href={deepLinkFor(notification)}
                      onClick={() => {
                        void handleMarkRead(notification);
                        onOpenChange(false);
                      }}
                      className={`block rounded-md border p-3 transition hover:bg-muted ${
                        isRead
                          ? "border-border bg-card"
                          : "border-primary/40 bg-primary/5"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-semibold">
                          {notification.title}
                        </p>
                        <Badge variant={isRead ? "outline" : "secondary"}>
                          {isRead ? "Read" : "New"}
                        </Badge>
                      </div>
                      {notification.body ? (
                        <p className="mt-1 text-sm text-muted-foreground">
                          {notification.body}
                        </p>
                      ) : null}
                      <p className="mt-2 text-xs text-muted-foreground">
                        {formatTime(notification.created_at)}
                      </p>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
