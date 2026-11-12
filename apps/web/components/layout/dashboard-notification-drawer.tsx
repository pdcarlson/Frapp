"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Loader2 } from "lucide-react";
import {
  AI_SUGGESTIONS_NOTIFICATION_SCREEN,
  CHAT_REPORTS_NOTIFICATION_SCREEN,
  DISCORD_IMPORT_NOTIFICATION_SCREEN,
  useInvalidateChatReports,
  useMarkNotificationRead,
  useMarkNotificationScreensSeen,
  memberAvatarTint,
  useChapterRoster,
  useMarkNotificationsRead,
  useMemberDisplayNames,
  useNotifications,
  useNowDate,
} from "@repo/hooks";
import {
  NOTIFICATION_KIND_LABEL,
  NOTIFICATION_TILE_GLYPH,
  NOTIFICATION_TILE_HUE,
  isTileKind,
  notificationLook,
  notificationPreview,
  notificationTitle,
  notificationWhen,
  titleAroundName,
  type NotificationKind,
} from "@repo/hooks/notification-rows";
import { NAV_GLYPHS } from "@repo/theme/nav-glyphs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { NavGlyph } from "@/components/layout/nav-glyphs";
import {
  AnnouncementGlyph,
  DirectMessageGlyph,
} from "@/components/chat/chat-glyphs";
import { MENTION_CHIP } from "@/components/chat/chip";
import { Button } from "@/components/ui/button";
import { FOCUS_RING } from "@/components/ui/focus";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { asArray, cn, initials } from "@/lib/utils";
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
      /** "Minutes posted" (`meeting.service.ts`) names the minutes too. */
      meetingId?: string;
      taskId?: string;
      invoiceId?: string;
      /** "Suggested tasks to review" names what they were drawn from. */
      sourceType?: string;
      sourceId?: string;
    };
    priority?: "URGENT" | "NORMAL" | "SILENT";
    senderId?: string;
    memberUserId?: string;
    chatKind?: string;
    mentioned?: boolean;
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
      return target.meetingId ? `/meetings/${target.meetingId}` : "/events";
    case "points":
      return "/points";
    case "billing":
      return "/billing";
    case "tasks":
      return "/tasks";
    // Suggested tasks to review (#4313): on the minutes they came from, where
    // the action items are; from any other source, the board's Suggested list.
    // One drawn from last year's event (#3930) is reviewed on Events.
    case AI_SUGGESTIONS_NOTIFICATION_SCREEN:
      if (target.sourceType === "event") return "/events";
      return target.sourceType === "meeting" && target.sourceId
        ? `/meetings/${target.sourceId}`
        : "/tasks";
    case "service":
      return "/service";
    case "profile":
      return "/profile";
    // "Alex Smith joined" (`invite.service.ts`). It used to fall through to
    // Chat, which says nothing about a new member.
    case "members":
      return "/members";
    // The officer report queue (#2257): the API's new-report notification
    // targets it with a bare screen, and the queue sits last on Chat Admin.
    case CHAT_REPORTS_NOTIFICATION_SCREEN:
      return "/chat-admin#reported-messages";
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

  const notifications = useMemo(
    () =>
      asArray<Notification>(notificationsQuery.data).sort((a, b) =>
        a.created_at < b.created_at ? 1 : -1,
      ),
    [notificationsQuery.data],
  );
  const unreadCount = notifications.filter((n) => !n.read_at).length;

  // The roster every chat surface already reads (cached, `staleTime` 60s), for
  // each row's picture, name colour and mention chips. No read of its own.
  const roster = useChapterRoster();
  const rosterMembers = roster.data ?? null;
  const names = useMemberDisplayNames();
  // Ticks, so a drawer left open past midnight moves its rows to Earlier.
  const now = useNowDate();
  const groups = useMemo(
    () => groupByDay(notifications, now),
    [notifications, now],
  );

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
            // A flat list: rows divided by hairlines, no card around each,
            // grouped Today / Earlier as mobile s14 is (#4346). Unread is a
            // dot and a bolder title, neutral like the chat list's unread
            // (foundations.md §5), not a tinted card. Every row is
            // transparent on the sheet's `--popover`, so one hover serves
            // both states: `--card-hover`, the neutral lift above the ladder
            // (`elevation-contrast.spec.ts`). The focus ring is drawn inset,
            // because the list fills the scroll area's width and its overflow
            // would clip a ring drawn outside.
            <div className="-mx-3 grid gap-2">
              {groups.map((group) => (
                <section key={group.heading} aria-label={group.heading}>
                  <h3 className="px-3 pb-1 text-caption font-semibold uppercase tracking-[0.08em] text-muted">
                    {group.heading}
                  </h3>
                  <ul className="divide-y divide-border">
                    {group.rows.map((notification) => (
                      <li key={notification.id}>
                        <NotificationRow
                          notification={notification}
                          members={rosterMembers}
                          names={names}
                          onOpen={() => {
                            if (isReportNotification(notification)) {
                              void invalidateReports();
                            }
                            void handleMarkRead(notification);
                            onOpenChange(false);
                          }}
                        />
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

type TimedNotification = Notification & { time: string };
type DayGroup = { heading: string; rows: TimedNotification[] };

/**
 * Today / Earlier on the viewer's own calendar day, newest first in each, by
 * the same rule and with the same times as mobile s14 (`notificationWhen` in
 * `@repo/hooks/notification-rows`). An empty group is dropped, so nobody sees
 * a Today heading over nothing, and a row whose time doesn't parse is
 * dropped as mobile drops it.
 */
function groupByDay(rows: readonly Notification[], now: Date): DayGroup[] {
  const today: TimedNotification[] = [];
  const earlier: TimedNotification[] = [];
  for (const row of rows) {
    const when = notificationWhen(row.created_at, now);
    if (!when) continue;
    (when.isToday ? today : earlier).push({ ...row, time: when.time });
  }
  return [
    { heading: "Today", rows: today },
    { heading: "Earlier", rows: earlier },
  ].filter((group) => group.rows.length > 0);
}

type MemberNames = ReturnType<typeof useMemberDisplayNames>;

/**
 * One notification (#4346): the picture of who it is about with a badge for
 * its kind, or a tile where no person is behind it; the title with the
 * person's name in their colour; the preview with chat's mention chips; the
 * time. A row that mentions the viewer wears the @ badge in the chapter
 * accent, the colour chat lights a mention in, and is not tinted (Shawn's
 * pick, 2026-11-11: the list stays flat).
 */
function NotificationRow({
  notification,
  members,
  names,
  onOpen,
}: {
  notification: TimedNotification;
  members: readonly { user_id: string; display_name: string }[] | null;
  names: MemberNames;
  onOpen: () => void;
}) {
  const isRead = Boolean(notification.read_at);
  const look = notificationLook(notification);
  const personName = look.personId ? names.nameFor(look.personId) : null;
  const nameColor = look.personId ? names.roleColorFor(look.personId) : null;
  const shownTitle = notificationTitle(notification.title);
  const title = titleAroundName(shownTitle, personName);
  const preview = notificationPreview(notification.body, members);

  return (
    <Link
      href={deepLinkFor(notification)}
      onClick={onOpen}
      data-notification-kind={look.kind}
      className={cn(
        "grid grid-cols-[8px_36px_minmax(0,1fr)] gap-x-3 rounded-md border border-transparent px-3 py-3 transition hover:bg-card-hover",
        FOCUS_RING,
        "focus-visible:ring-inset",
      )}
    >
      <span
        aria-hidden="true"
        data-unread-dot={isRead ? undefined : ""}
        className={cn(
          "mt-[14px] size-2 rounded-full",
          isRead ? "bg-transparent" : "bg-foreground",
        )}
      />
      <NotificationPicture
        kind={look.kind}
        personId={look.personId}
        personName={personName}
        names={names}
      />
      <span className="grid min-w-0 gap-0.5">
        <span className="flex min-w-0 items-baseline justify-between gap-3">
          <span
            className={cn(
              "min-w-0 break-words text-sm",
              isRead
                ? "font-medium text-muted-foreground"
                : "font-semibold text-foreground",
            )}
          >
            {/* Spaces sit between the spans, not at their edges: a name is
                built from each element's text trimmed, so "Ryan" and
                " in #general" would be read as "Ryanin #general". */}
            <span className="sr-only">
              {isRead ? "" : "Unread: "}
              {NOTIFICATION_KIND_LABEL[look.kind]}.
            </span>{" "}
            {title ? (
              <>
                {title.before}
                <span
                  data-person-name=""
                  style={nameColor ? { color: nameColor } : undefined}
                >
                  {title.name}
                </span>
                {/^\s/.test(title.after) ? " " : null}
                <span className="font-medium text-muted-foreground">
                  {title.after.trimStart()}
                </span>
              </>
            ) : (
              shownTitle
            )}
          </span>{" "}
          <span className="shrink-0 text-caption text-muted-foreground tabular-nums">
            {notification.time}
          </span>
        </span>
        {preview.length > 0 ? (
          <span
            className={cn(
              "break-words text-sm",
              isRead ? "text-muted" : "text-muted-foreground",
            )}
          >
            {preview.map((segment, index) =>
              segment.mention ? (
                <mark key={index} data-mention="" className={MENTION_CHIP}>
                  {segment.text}
                </mark>
              ) : (
                <span key={index}>{segment.text}</span>
              ),
            )}
          </span>
        ) : null}
      </span>
    </Link>
  );
}

/**
 * The row's picture: the person's photo or tinted initials, as chat draws an
 * author, with a badge for the kind of notice; or, with no person behind it,
 * a tile in the kind's hue (`NOTIFICATION_TILE_HUE`). Decorative: the row's
 * hidden label says the kind in words.
 */
function NotificationPicture({
  kind,
  personId,
  personName,
  names,
}: {
  kind: NotificationKind;
  personId: string | null;
  personName: string | null;
  names: MemberNames;
}) {
  if (isTileKind(kind)) {
    // The initials avatar's paint (the hue at 18% over `--popover`), so a
    // tile and a person's picture sit at one strength.
    const paint = memberAvatarTint(NOTIFICATION_TILE_HUE[kind]);
    return (
      <span
        aria-hidden="true"
        data-notification-tile={kind}
        className="grid size-9 place-items-center rounded-[10px]"
        style={{ backgroundColor: paint.fill, color: paint.text }}
      >
        <NavGlyph
          paths={NAV_GLYPHS[NOTIFICATION_TILE_GLYPH[kind]]}
          className="size-5"
        />
      </span>
    );
  }
  const photo = personId ? names.avatarFor(personId) : null;
  const tint = personId ? names.avatarTintFor(personId) : null;
  return (
    <span aria-hidden="true" className="relative size-9">
      <Avatar className="size-9">
        {photo ? <AvatarImage src={photo} alt="" /> : null}
        <AvatarFallback tint={tint}>{initials(personName)}</AvatarFallback>
      </Avatar>
      <KindBadge kind={kind} />
    </span>
  );
}

const BADGE_TONE: Partial<Record<NotificationKind, string>> = {
  // The mention is the badge in gold: the in-body mention chip's fixed pair
  // (`components.md` § In-body mention chip), inverted so it reads at 18px.
  // Fixed, never the chapter accent, so a mention looks alike in every
  // chapter (`foundations.md` §5, as changed in #4346).
  mention: "bg-mention-chip-text text-mention-chip",
  join: "bg-success text-success-foreground",
};

function KindBadge({ kind }: { kind: NotificationKind }) {
  return (
    <span
      data-kind-badge={kind}
      className={cn(
        "absolute -bottom-1 -right-1 grid size-[18px] place-items-center rounded-full text-caption font-bold leading-none ring-2 ring-popover",
        BADGE_TONE[kind] ?? "bg-card-hover text-muted-foreground",
      )}
    >
      {kind === "mention" ? (
        "@"
      ) : kind === "channel" ? (
        "#"
      ) : kind === "join" ? (
        "+"
      ) : kind === "announcement" ? (
        <AnnouncementGlyph className="size-3" />
      ) : kind === "dm" ? (
        <DirectMessageGlyph className="size-3" />
      ) : (
        <NavGlyph paths={NAV_GLYPHS.chat} className="size-3" />
      )}
    </span>
  );
}
