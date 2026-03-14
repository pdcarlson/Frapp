"use client";

import { AlertTriangle, Bell } from "lucide-react";
import { useNotifications } from "@repo/hooks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

type DashboardNotificationDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type NotificationRow = Record<string, unknown>;

const fallbackNotifications: NotificationRow[] = [
  {
    id: "preview-1",
    title: "Event reminder",
    body: "Chapter Meeting starts in one hour.",
    created_at: new Date().toISOString(),
    read_at: null,
  },
  {
    id: "preview-2",
    title: "Points awarded",
    body: "You received 10 points for attendance.",
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString(),
    read_at: null,
  },
  {
    id: "preview-3",
    title: "Invoice status updated",
    body: "Spring dues payment posted for one member.",
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 22).toISOString(),
    read_at: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
  },
];

function formatTime(value: unknown): string {
  if (typeof value !== "string") return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString();
}

export function DashboardNotificationDrawer({
  open,
  onOpenChange,
}: DashboardNotificationDrawerProps) {
  const notificationsQuery = useNotifications();
  const usingPreviewData = notificationsQuery.isError;
  const notifications = usingPreviewData
    ? fallbackNotifications
    : Array.isArray(notificationsQuery.data)
      ? (notificationsQuery.data as NotificationRow[])
      : [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Bell className="h-4 w-4" />
            Notifications
          </SheetTitle>
          <SheetDescription>Recent chapter activity and system alerts.</SheetDescription>
        </SheetHeader>

        {usingPreviewData ? (
          <div className="mt-5 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              Showing preview notifications. Sign in to load your live chapter updates.
            </div>
          </div>
        ) : null}

        <div className="mt-5 space-y-3">
          {notifications.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              No notifications yet.
            </div>
          ) : (
            notifications.map((notification) => {
              const title = String(notification.title ?? "Untitled notification");
              const body = String(notification.body ?? "");
              const isRead = Boolean(notification.read_at);

              return (
                <article
                  key={String(notification.id ?? `${title}-${body}`)}
                  className="rounded-md border border-border bg-card p-3"
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold">{title}</p>
                    <Badge variant={isRead ? "outline" : "secondary"}>
                      {isRead ? "Read" : "New"}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{body}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {formatTime(notification.created_at)}
                  </p>
                </article>
              );
            })
          )}
        </div>

        <Button
          variant="outline"
          className="mt-5 w-full"
          onClick={() => notificationsQuery.refetch()}
        >
          Refresh notifications
        </Button>
      </SheetContent>
    </Sheet>
  );
}
