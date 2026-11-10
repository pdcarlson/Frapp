"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Loader2 } from "lucide-react";
import {
  CHAT_REPORTS_NOTIFICATION_SCREEN,
  DISCORD_IMPORT_NOTIFICATION_SCREEN,
  useInvalidateChatReports,
  useMarkNotificationRead,
  useMarkNotificationScreensSeen,
  useMarkNotificationsRead,
  useNotifications,
} from "@repo/hooks";
import { Button } from "@/components/ui/button";
import { FOCUS_RING } from "@/components/ui/focus";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatRelativeDayTime } from "@repo/formatting";
import { asArray, cn } from "@/lib/utils";
import { useRealtimeTable } from "@/lib/realtime/use-realtime-table";
import { useFrappUser } from "@/lib/auth/use-frapp-user";
import { chatDeepLink } from "@/lib/chat/chat-links";
import { notificationScreensForPath } from "@/lib/notifications/seen-screens";
import { usePageVisible } from "@/lib/notifications/use-page-visible";

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

/**
 * Map a notification target payload to an in-app dashboard path.
 *
 * The mobile app uses the same payload shape (see spec/behavior §7) but
 * sends users to native screens. The web versions of those screens are
 * only subset; we fall back to `/chat` when a screen isn't yet built so
 * links never dead-end.
 *
 * A chat notification's `target` never carries a `messageId` — the chat
 * push worker has never emitted one (`spec/behavior/notifications.md` §
 * Deep Linking is explicit that clients must not read one) — so this only
 * ever forwards `channelId` through `chatDeepLink`.
 */
function deepLinkFor(notification: Notification): string {
  const target = notification.data?.target;
  if (!target) return "/chat";
  switch (target.screen) {
    case "chat":
      return chatDeepLink({ channelId: target.channelId });
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
    // "Alex Smith joined" (`invite.service.ts`). It used to fall through to
    // Chat, which says nothing about a new member.
    case "members":
      return "/members";
    // The officer report queue (#2257): the API's new-report notification
    // targets it with a bare screen, and the queue lives on Chat Admin.
    case CHAT_REPORTS_NOTIFICATION_SCREEN:
      return "/chat-admin";
    // A Discord import that finished or stopped on an error, sent to the
    // admin who set it up.
    case DISCORD_IMPORT_NOTIFICATION_SCREEN:
      return "/discord-import";
    default:
      return "/chat";
  }
}

function isReportNotification(notification: Notification): boolean {
  return notification.data?.target?.screen === CHAT_REPORTS_NOTIFICATION_SCREEN;
}

export function DashboardNotificationDrawer({
  open,
  onOpenChange,
}: DashboardNotificationDrawerProps) {
  const frappUser = useFrappUser();
  const notificationsQuery = useNotifications();
  const markRead = useMarkNotificationRead();
  const markManyRead = useMarkNotificationsRead();
  const invalidateReports = useInvalidateChatReports();

  // A notification is read once the member has seen what it is about
  // (notifications.md § How an in-app row is marked read): opening Events
  // reads the event notices, as opening a channel reads its chat notices.
  // Only while the tab is showing, so a page left open in the background does
  // not read what nobody saw. The drawer is mounted with the shell, so this
  // runs on every dashboard page.
  const pathname = usePathname();
  const pageVisible = usePageVisible();
  useMarkNotificationScreensSeen(notificationScreensForPath(pathname), {
    enabled: pageVisible,
  });

  // Live updates: any notification INSERT for the current user (and
  // UPDATE when it's marked read elsewhere) refreshes the list.
  useRealtimeTable({
    table: "notifications",
    scopeId: frappUser.userId,
    invalidate: [["notifications"]],
    enabled: Boolean(frappUser.userId),
  });

  const notifications = asArray<Notification>(notificationsQuery.data).sort(
    (a, b) => (a.created_at < b.created_at ? 1 : -1),
  );
  const unreadCount = notifications.filter((n) => !n.read_at).length;

  /*
    Keep the officer report queue in step with its notifications (#2257).

    The realtime ping above carries no row, so it cannot say *which*
    notification arrived; once the list has refetched, the newest report
    notification can. When that changes, a report was filed and the queue's
    cached slices are stale — `staleTime` alone would leave an officer who
    opens Chat Admin within 30s of an earlier visit looking at a queue without
    the report they were paged about. Invalidation refetches a mounted queue
    at once and an unmounted one on its next mount, so this costs nothing for
    a member with no queue. Following the link invalidates again, below, for
    the report whose ping this tab never heard.
  */
  const newestReportNotification =
    notifications.find(isReportNotification)?.id ?? null;
  useEffect(() => {
    if (newestReportNotification) void invalidateReports();
  }, [newestReportNotification, invalidateReports]);

  async function handleMarkRead(notification: Notification) {
    if (notification.read_at) return;
    try {
      await markRead.mutateAsync(notification.id);
    } catch {
      // Silent — the mark-read button re-enables automatically since the
      // query invalidation will re-fetch. The user can retry by clicking.
    }
  }

  // One request (`POST /v1/notifications/read`), so it also reads rows past
  // the page this drawer shows. Until #3929 it sent one PATCH per row.
  function markAllRead() {
    markManyRead.mutate(undefined);
  }

  /*
    The drawer's chrome is a title and one icon (components.md § Chrome
    weight). Until 2026-11-05 it stacked a bell, the title, a gold count, a
    description, an "N total" line, Mark all read and Refresh above a list of
    bordered cards, each with its own Read or New badge. The count said what
    the dots already say, the description narrated the drawer to someone
    reading it, and Refresh did by hand what the realtime ping above does on
    its own. Mark all read stayed as an icon beside the close until 2026-11-09
    (#3929), when the owner asked for one that is obvious: it is worded, as
    Slack's and GitHub's are, and drawn only while something is unread.
  */
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col sm:max-w-md"
        aria-describedby={undefined}
      >
        <SheetHeader className="pr-40">
          <SheetTitle>Notifications</SheetTitle>
        </SheetHeader>
        {unreadCount > 0 ? (
          <div className="absolute right-12 top-2.5 flex items-center">
            <Button
              variant="link"
              size="sm"
              disabled={markManyRead.isPending || markRead.isPending}
              onClick={markAllRead}
            >
              Mark all read
            </Button>
          </div>
        ) : null}

        <div className="-mx-3 flex-1 overflow-y-auto px-3">
          {notificationsQuery.isPending ? (
            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading notifications...
            </div>
          ) : notificationsQuery.isError ? (
            // The drawer stays mounted between opens, so closing and
            // reopening it doesn't refetch: the retry has to live here, now
            // that the header has no Refresh (components.md § Chrome weight).
            <div className="grid justify-items-start gap-2 rounded-md border border-destructive/45 bg-destructive-tint p-3 text-sm text-destructive-text">
              Couldn&apos;t load notifications.
              <Button
                variant="secondary"
                size="sm"
                // A failed query stays in its error state while the retry
                // runs, so the button is the only thing that can say so.
                disabled={notificationsQuery.isFetching}
                onClick={() => void notificationsQuery.refetch()}
              >
                {notificationsQuery.isFetching ? (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                ) : null}
                Try again
              </Button>
            </div>
          ) : notifications.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              No notifications yet. Chapter activity, billing alerts, and point
              changes will appear here.
            </div>
          ) : (
            // A flat list: rows divided by hairlines, no card around each.
            // Unread is a dot and a bolder title, neutral like the chat list's
            // unread (foundations.md §5), not a gold card and a badge. Every row is transparent on the sheet's `--popover`, so
            // one hover serves both states: `--card-hover`, the neutral lift
            // above the ladder (`elevation-contrast.spec.ts`). The title and
            // body wrap rather than clip: nothing else on web shows a
            // notification's text, and most deep links open a list page. The
            // focus ring is drawn inset, because the list fills the scroll
            // area's width and its overflow would clip a ring drawn outside.
            <ul className="-mx-3 divide-y divide-border">
              {notifications.map((notification) => {
                const isRead = Boolean(notification.read_at);
                return (
                  <li key={notification.id}>
                    <Link
                      href={deepLinkFor(notification)}
                      onClick={() => {
                        if (isReportNotification(notification)) {
                          void invalidateReports();
                        }
                        void handleMarkRead(notification);
                        onOpenChange(false);
                      }}
                      className={cn(
                        "grid grid-cols-[8px_minmax(0,1fr)] gap-x-3 rounded-md border border-transparent px-3 py-3 transition hover:bg-card-hover",
                        FOCUS_RING,
                        "focus-visible:ring-inset",
                      )}
                    >
                      <span
                        aria-hidden="true"
                        data-unread-dot={isRead ? undefined : ""}
                        className={cn(
                          "mt-2 size-2 rounded-full",
                          isRead ? "bg-transparent" : "bg-foreground",
                        )}
                      />
                      <span className="flex min-w-0 items-baseline justify-between gap-3">
                        <span
                          className={cn(
                            "min-w-0 break-words text-sm",
                            isRead
                              ? "font-medium text-muted-foreground"
                              : "font-semibold text-foreground",
                          )}
                        >
                          {isRead ? null : (
                            <span className="sr-only">Unread: </span>
                          )}
                          {notification.title}
                        </span>{" "}
                        <span className="shrink-0 text-caption text-muted-foreground">
                          {formatRelativeDayTime(notification.created_at)}
                        </span>
                      </span>{" "}
                      {notification.body ? (
                        <span className="col-start-2 mt-0.5 break-words text-sm text-muted-foreground">
                          {notification.body}
                        </span>
                      ) : null}
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
