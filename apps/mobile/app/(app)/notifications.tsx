import { describeLoadFailure } from "@repo/hooks/error-copy";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import {
  memberAvatarTint,
  useActiveChapterId,
  useChapterRoster,
  useMarkNotificationRead,
  useMarkNotificationsRead,
  useMemberDisplayNames,
  useNotifications,
  useNowDate,
  useViewerUserId,
} from "@repo/hooks";
import {
  NOTIFICATION_KIND_LABEL,
  NOTIFICATION_TILE_GLYPH,
  NOTIFICATION_TILE_HUE,
  isTileKind,
  notificationLook,
  notificationPreview,
  notificationTitle,
  titleAroundName,
  type NotificationFilter,
  type NotificationKind,
} from "@repo/hooks/notification-rows";
import { NAV_GLYPHS } from "@repo/theme/nav-glyphs";
import { SignetTokens } from "@repo/theme/signet";
import { ScreenShell } from "@/components/screen-shell";
import { CheckAllGlyph } from "@/components/control-glyphs";
import { HeaderButton } from "@/components/header-button";
import { useRefetchAll } from "@/components/pull-to-refresh";
import { BACK_TO_CHAT } from "@/components/back-row";
import {
  listRowHint,
  SectionHeader,
  SectionHeaderSkeleton,
  usePressFeedback,
} from "@/components/list-section";
import {
  ErrorState,
  NoChapterState,
  SkeletonBlock,
  SkeletonRegion,
  SkeletonText,
} from "@/components/state-block";
import {
  type NotificationRow,
  selectNotificationGroups,
  selectUnreadIds,
} from "@/lib/more/notifications";
import {
  NOTIFICATION_FALLBACK_PATHNAME,
  openNotificationTarget,
} from "@/lib/notifications/targets";
import { avatarRadius, typeRole, useFrappTheme } from "@/lib/theme";
import { MemberAvatar } from "@/components/member-avatar";
import { NavGlyph } from "@/components/nav-glyph";
import { AnnouncementGlyph } from "@/components/chat/card-glyphs";
import { initialsFor } from "@/lib/chat/display-name";
import { useChapterBranding } from "@/lib/chapter-branding";
import { InlineNote } from "@/components/inline-note";
import { Segmented } from "@/components/segmented";
import { createUnreadDotStyles, unreadDotSize } from "@/components/unread-dot";

/**
 * s14 — Notifications (`canvas-screens.dc.html:474`).
 *
 * In-app history, and the surface a push tap ultimately lands on. The push
 * runtime itself (permissions, tokens, cold-start taps) is
 * `lib/notifications/use-push-runtime.ts` and does not run in Expo Go at all —
 * nothing on this screen depends on it, which is why the history renders
 * identically with push switched off.
 *
 * ## Each row says who and what (#4346)
 *
 * The picture, the kind's badge or tile, the name's colour and the mention
 * chips come from `@repo/hooks/notification-rows`, which the web drawer draws
 * from too, over the roster chat already caches. The category word that sat
 * under each row until then is the badge's spoken label now.
 *
 * ## "Mark all read" is one request
 *
 * `POST /v1/notifications/read` reads every unread row in the chapter at once
 * (#3929), rows past this screen's page included. Until then it was one
 * `PATCH` per row, capped at 25 to stay under the API's 30-writes-a-minute
 * budget, with a note asking the member to come back for the rest.
 *
 * ## Tapping deep-links
 *
 * The row's destination is resolved by `lib/notifications/targets.ts` — the
 * same module the push handler uses for a tapped notification, so an in-app tap
 * and a push tap cannot disagree about where a payload points. A row whose
 * target this build does not recognize resolves to this screen, so it marks
 * itself read and stays put rather than navigating somewhere wrong.
 */
export default function NotificationsScreen() {
  const router = useRouter();
  const { tokens } = useFrappTheme();
  const brand = useChapterBranding();
  const styles = createStyles(tokens);
  const chapterId = useActiveChapterId();

  const notificationsQuery = useNotifications();
  // The roster every chat screen already reads (cached, `staleTime` 60s), for
  // each row's picture, name colour and mention chips (#4346). No read of
  // its own on this path (#3728).
  const roster = useChapterRoster();
  const names = useMemberDisplayNames();
  const viewerId = useViewerUserId();
  const people = useMemo<NotificationPeople>(
    () => ({ viewerId, members: roster.data ?? null, names }),
    [viewerId, roster.data, names],
  );
  const refresh = useRefetchAll([notificationsQuery]);
  const markRead = useMarkNotificationRead();
  const markAll = useMarkNotificationsRead();
  const isMarkingAll = markAll.isPending;
  const [markAllNote, setMarkAllNote] = useState<string | null>(null);

  // `now` ticks rather than being read once inside the memo below: React
  // Query's structural sharing keeps the data reference stable when a refetch
  // returns identical rows, so a `new Date()` read inside the memo would
  // freeze the TODAY/EARLIER split at mount — a row from 11:47 PM would still
  // sit under TODAY at 12:10 AM on a screen left up overnight.
  const now = useNowDate();

  // Unread / All (#3948), as Slack's Activity and Discord's Inbox switch.
  // All by default, so a row read elsewhere doesn't seem to vanish.
  const [filter, setFilter] = useState<NotificationFilter>("all");

  const groups = useMemo(
    () => selectNotificationGroups(notificationsQuery.data, now, filter),
    [notificationsQuery.data, now, filter],
  );
  const unreadIds = useMemo(
    () => selectUnreadIds(notificationsQuery.data),
    [notificationsQuery.data],
  );

  function markAllRead() {
    if (unreadIds.length === 0 || isMarkingAll) return;
    setMarkAllNote(null);
    markAll.mutate(undefined, {
      onError: () =>
        setMarkAllNote(
          "Couldn't mark them read. Check your connection and try again.",
        ),
    });
  }

  function renderBody() {
    if (!chapterId) return <NoChapterState noun="your notifications" />;
    if (notificationsQuery.isPending) return <NotificationListSkeleton />;
    if (notificationsQuery.isError && notificationsQuery.data === undefined) {
      return (
        <ErrorState
          title="Couldn't load notifications"
          body={describeLoadFailure(notificationsQuery.error)}
          onRetry={() => void notificationsQuery.refetch()}
          isRetrying={notificationsQuery.isFetching}
        />
      );
    }
    const list =
      groups.length === 0 ? (
        <InlineNote>{"You're all caught up."}</InlineNote>
      ) : (
        groups.map((group) => (
          <View key={group.heading} style={styles.group}>
            <SectionHeader>{group.heading}</SectionHeader>
            {group.rows.map((row) => (
              <NotificationListRow
                key={row.id}
                row={row}
                people={people}
                onPress={() => {
                  // A conversation's entry is its newest row; opening the
                  // channel reads the rest on the server (notifications.md §
                  // How an in-app row is marked read).
                  if (row.isUnread) markRead.mutate(row.id);
                  // Resolves to this screen when the target is unrecognized,
                  // so the tap marks the row read and stays put rather than
                  // pushing the notification list on top of itself.
                  if (row.target.pathname !== NOTIFICATION_FALLBACK_PATHNAME) {
                    openNotificationTarget(router, row.target);
                  }
                }}
              />
            ))}
          </View>
        ))
      );
    // Unread / All (#3948) shows once there is something to switch between.
    if (groups.length === 0 && filter === "all") {
      return list;
    }
    return (
      <>
        <View style={styles.filter}>
          <Segmented
            accessibilityLabel="Show"
            options={FILTER_OPTIONS}
            value={filter}
            onChange={setFilter}
          />
        </View>
        {list}
      </>
    );
  }

  return (
    <ScreenShell
      back={BACK_TO_CHAT}
      title="Notifications"
      refresh={refresh}
      headerAction={
        unreadIds.length > 0 ? (
          // The double check, as web's drawer draws it (components.md §
          // Icon-only actions). A spinner while the write runs, in place of
          // the "Marking…" word it replaced.
          <HeaderButton
            label="Mark all notifications read"
            disabled={isMarkingAll}
            onPress={markAllRead}
          >
            {isMarkingAll ? (
              <ActivityIndicator size="small" color={brand.accent} />
            ) : (
              <CheckAllGlyph color={brand.accent} />
            )}
          </HeaderButton>
        ) : null
      }
    >
      {markAllNote ? (
        <Text style={styles.markAllNote}>{markAllNote}</Text>
      ) : null}
      {renderBody()}
    </ScreenShell>
  );
}

const FILTER_OPTIONS = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
] as const satisfies readonly { value: NotificationFilter; label: string }[];

/**
 * Who a row's people are: the viewer, for the mention test, and the roster,
 * for names, pictures and colours. Worked out once by the screen and handed
 * to every row, rather than each row building the roster's maps again.
 */
export interface NotificationPeople {
  viewerId: string | null;
  members: readonly { user_id: string; display_name: string }[] | null;
  names: Pick<
    ReturnType<typeof useMemberDisplayNames>,
    "nameFor" | "avatarFor" | "roleColorFor" | "avatarTintFor"
  > | null;
}

const NO_PEOPLE: NotificationPeople = {
  viewerId: null,
  members: null,
  names: null,
};

/**
 * One notification (#4346), drawn as the web drawer draws it: the picture of
 * who it is about with a badge for its kind, or a tile where no person is
 * behind it; the title with the person's name in their colour and the time
 * beside it; the preview with chat's mention chips. A row that mentions you
 * wears the @ badge in the chapter accent and is not tinted (Shawn's pick,
 * 2026-11-11). Exported so a spec can render one row without the screen.
 */
export function NotificationListRow({
  row,
  people = NO_PEOPLE,
  onPress,
}: {
  row: NotificationRow;
  people?: NotificationPeople;
  onPress: () => void;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const dotStyles = createUnreadDotStyles(tokens);
  const feedback = usePressFeedback();

  const look = notificationLook(row);
  const names = people.names;
  const personName =
    look.personId && names ? names.nameFor(look.personId) : null;
  const nameColor =
    look.personId && names ? names.roleColorFor(look.personId) : null;
  const shownTitle = notificationTitle(row.title);
  const title = titleAroundName(shownTitle, personName);
  const preview = notificationPreview(row.body, people.members);
  const previewText = preview.map((segment) => segment.text).join("");
  const kindLabel = NOTIFICATION_KIND_LABEL[look.kind];

  return (
    <Pressable
      accessibilityRole="button"
      // The Pressable is one node, so its texts aren't read on their own: the
      // label says the kind (the badge can't be seen), then the title and the
      // body, all of it, though the row shows two lines.
      accessibilityLabel={listRowHint(
        `${kindLabel}: ${shownTitle}`,
        previewText || undefined,
      )}
      accessibilityHint={row.isUnread ? "Marks this as read." : undefined}
      onPress={onPress}
      android_ripple={feedback.ripple}
      style={({ pressed }) => [styles.row, feedback.lift(pressed)]}
      testID={`notification-row-${look.kind}`}
    >
      <View
        style={
          row.isUnread ? [dotStyles.dot, styles.dotPlace] : dotStyles.spacer
        }
      />
      <NotificationPicture
        kind={look.kind}
        personId={look.personId}
        personName={personName}
        people={people}
      />
      <View style={styles.rowText}>
        <View style={styles.titleLine}>
          <Text
            style={[styles.rowTitle, row.isUnread ? null : styles.rowTitleRead]}
          >
            {title ? (
              <>
                {title.before}
                <Text style={nameColor ? { color: nameColor } : null}>
                  {title.name}
                </Text>
                <Text style={styles.rowTitleRest}>{title.after}</Text>
              </>
            ) : (
              shownTitle
            )}
          </Text>
          <Text style={styles.rowTime}>{row.time}</Text>
        </View>
        {preview.length > 0 ? (
          <Text
            style={[styles.rowBody, row.isUnread ? null : styles.rowBodyRead]}
            numberOfLines={2}
          >
            {preview.some((segment) => segment.mention)
              ? preview.map((segment, index) =>
                  segment.mention ? (
                    <Text key={index} style={styles.mentionChip}>
                      {segment.text}
                    </Text>
                  ) : (
                    segment.text
                  ),
                )
              : previewText}
          </Text>
        ) : null}
        {row.count ? <Text style={styles.rowCount}>{row.count}</Text> : null}
      </View>
    </Pressable>
  );
}

/** The row's picture: a person with a kind badge, or a kind's tile. */
function NotificationPicture({
  kind,
  personId,
  personName,
  people,
}: {
  kind: NotificationKind;
  personId: string | null;
  personName: string | null;
  people: NotificationPeople;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);

  if (isTileKind(kind)) {
    // The initials avatar's paint, so a tile and a picture sit at one
    // strength.
    const paint = memberAvatarTint(NOTIFICATION_TILE_HUE[kind]);
    return (
      <View
        style={[styles.tile, { backgroundColor: paint.fill }]}
        testID={`notification-tile-${kind}`}
      >
        <NavGlyph
          paths={NAV_GLYPHS[NOTIFICATION_TILE_GLYPH[kind]]}
          color={paint.text}
          size={TILE_GLYPH_SIZE}
        />
      </View>
    );
  }
  const names = people.names;
  return (
    <View style={styles.picture}>
      <MemberAvatar
        uri={personId && names ? names.avatarFor(personId) : null}
        initials={personName ? initialsFor(personName) : ""}
        size={PICTURE_SIZE}
        tint={personId && names ? names.avatarTintFor(personId) : null}
        style={styles.avatar}
        textStyle={styles.avatarText}
      />
      <KindBadge kind={kind} />
    </View>
  );
}

function KindBadge({ kind }: { kind: NotificationKind }) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  // The mention is the badge in gold: the in-body mention chip's fixed pair
  // (`components.md` § In-body mention chip), inverted so it reads at 18pt.
  // Fixed, never the chapter accent, so a mention looks alike in every
  // chapter (`foundations.md` §5, as changed in #4346). A join is the success
  // green.
  const tone =
    kind === "mention"
      ? {
          fill: tokens.color.semantic.mentionChipText,
          ink: tokens.color.semantic.mentionChip,
        }
      : kind === "join"
        ? {
            fill: tokens.color.semantic.success,
            ink: tokens.color.surface.background,
          }
        : {
            fill: tokens.color.surface.popover,
            ink: tokens.color.text.mutedForeground,
          };
  const mark =
    kind === "mention"
      ? "@"
      : kind === "channel"
        ? "#"
        : kind === "join"
          ? "+"
          : null;
  return (
    <View
      style={[styles.badge, { backgroundColor: tone.fill }]}
      testID={`notification-badge-${kind}`}
    >
      {mark ? (
        <Text style={[styles.badgeMark, { color: tone.ink }]}>{mark}</Text>
      ) : kind === "announcement" ? (
        <AnnouncementGlyph
          focused
          accent={tone.ink}
          muted={tone.ink}
          size={BADGE_GLYPH_SIZE}
        />
      ) : (
        <NavGlyph
          paths={NAV_GLYPHS.chat}
          color={tone.ink}
          size={BADGE_GLYPH_SIZE}
        />
      )}
    </View>
  );
}

/** Title widths, cycled, so the placeholder rows don't read as a grid. */
const SKELETON_TITLE_WIDTHS = ["62%", "48%", "70%", "54%"] as const;

/**
 * The list's loading state: a group caption over rows on
 * {@link NotificationListRow}'s own styles (the dot's column, the picture's
 * circle, the 20pt title and body lines), so the real list lands in place.
 * The dot column is left empty, as on a read row: which rows are unread isn't
 * known yet.
 *
 * Exported so `components/screen-skeletons.spec.tsx` can pin its shape.
 */
export function NotificationListSkeleton({ rows = 4 }: { rows?: number }) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const dotStyles = createUnreadDotStyles(tokens);
  const { label } = tokens.typography.role;

  return (
    <SkeletonRegion label="Loading notifications" style={styles.group}>
      <SectionHeaderSkeleton width="16%" />
      {Array.from({ length: rows }, (_, index) => (
        <View key={index} style={styles.row}>
          <View style={dotStyles.spacer} />
          <SkeletonBlock
            width={PICTURE_SIZE}
            height={PICTURE_SIZE}
            radius={avatarRadius(PICTURE_SIZE)}
          />
          <View style={styles.rowText}>
            <SkeletonText
              role={label}
              lineHeight={LINE_HEIGHT}
              width={
                SKELETON_TITLE_WIDTHS[index % SKELETON_TITLE_WIDTHS.length]!
              }
            />
            <SkeletonText role={label} lineHeight={LINE_HEIGHT} width="86%" />
          </View>
        </View>
      ))}
    </SkeletonRegion>
  );
}

/**
 * The title and body's line height. The label role carries none, so the line
 * box was the font's own and the unread dot could only guess at its middle.
 * 20 is the 14pt label's natural line on the 4pt grid.
 */
const LINE_HEIGHT = 20;

/** The picture's circle: a notice row is a step roomier than chat's 32. */
const PICTURE_SIZE = 36;
/** The kind badge on the picture's corner, and the glyph inside it. */
const BADGE_SIZE = 18;
const BADGE_GLYPH_SIZE = 11;
const TILE_GLYPH_SIZE = 20;

function createStyles(tokens: SignetTokens) {
  const DOT_SIZE = unreadDotSize(tokens);
  return StyleSheet.create({
    group: {
      gap: tokens.spacing.xs,
    },
    // Full width, as iOS's segmented filters sit: each segment is `flex: 1`,
    // so a track hugging its labels shrank and cut "Unread" to "Un…".
    filter: {
      alignSelf: "stretch",
      marginBottom: tokens.spacing.sm,
    },
    markAllNote: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.warning,
      paddingHorizontal: tokens.spacing.xs,
    },
    // Padded on both sides so the dot sits inset from the section caption, as
    // drawn, and the press lift clears the text. No radius: the hairline
    // under each row would meet a rounded corner.
    row: {
      flexDirection: "row",
      gap: tokens.spacing.md,
      paddingVertical: tokens.spacing.md,
      paddingHorizontal: tokens.spacing.sm,
      minHeight: tokens.touch.minimum,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: tokens.color.border.hairline,
    },
    // Centred on the picture, which the title's first line is centred on too.
    // The dot itself is the shared one (`components/unread-dot.ts`).
    dotPlace: {
      marginTop: (PICTURE_SIZE - DOT_SIZE) / 2,
    },
    picture: {
      width: PICTURE_SIZE,
      height: PICTURE_SIZE,
    },
    // Chat's author avatar (`message-item.tsx`), a step larger.
    avatar: {
      width: PICTURE_SIZE,
      height: PICTURE_SIZE,
      borderRadius: avatarRadius(PICTURE_SIZE),
      backgroundColor: tokens.color.surface.popover,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarText: {
      ...typeRole({
        ...tokens.typography.role.caption,
        weight: tokens.typography.weight.bold,
      }),
      color: tokens.color.text.mutedForeground,
    },
    // Rounded square, so a notice nobody sent never reads as a person.
    tile: {
      width: PICTURE_SIZE,
      height: PICTURE_SIZE,
      borderRadius: tokens.radius.control,
      alignItems: "center",
      justifyContent: "center",
    },
    // Ringed in the screen's own ground so it reads as sitting on the circle.
    badge: {
      position: "absolute",
      right: -tokens.spacing.xs,
      bottom: -tokens.spacing.xs,
      width: BADGE_SIZE + 4,
      height: BADGE_SIZE + 4,
      borderRadius: (BADGE_SIZE + 4) / 2,
      borderWidth: 2,
      borderColor: tokens.color.surface.background,
      alignItems: "center",
      justifyContent: "center",
    },
    badgeMark: {
      ...typeRole({
        ...tokens.typography.role.caption,
        weight: tokens.typography.weight.bold,
      }),
      lineHeight: BADGE_SIZE - 2,
    },
    rowText: {
      flex: 1,
      gap: 2,
    },
    titleLine: {
      flexDirection: "row",
      alignItems: "baseline",
      gap: tokens.spacing.sm,
      minHeight: LINE_HEIGHT,
    },
    rowTitle: {
      ...typeRole(tokens.typography.role.label),
      lineHeight: LINE_HEIGHT,
      color: tokens.color.text.foreground,
      flex: 1,
    },
    // Read rows recede rather than disappear, as drawn: the title drops to the
    // body's tone and to regular weight, so a read row reads quieter even
    // where a role colour keeps its name bright. Colour and weight, not
    // opacity, so the press lift behind it is as strong as any other row's.
    rowTitleRead: {
      ...typeRole({
        ...tokens.typography.role.label,
        weight: tokens.typography.weight.regular,
      }),
      lineHeight: LINE_HEIGHT,
      color: tokens.color.text.mutedForeground,
    },
    // "in #general", "joined": the part of the title that isn't the person.
    rowTitleRest: {
      color: tokens.color.text.mutedForeground,
    },
    rowTime: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
    rowCount: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    // The title's size at regular weight.
    rowBody: {
      ...typeRole({
        ...tokens.typography.role.label,
        weight: tokens.typography.weight.regular,
      }),
      lineHeight: LINE_HEIGHT,
      color: tokens.color.text.mutedForeground,
    },
    rowBodyRead: {
      color: tokens.color.text.muted,
    },
    // Chat's in-body mention chip (`message-markdown.tsx`), the fixed gold.
    mentionChip: {
      backgroundColor: tokens.color.semantic.mentionChip,
      color: tokens.color.semantic.mentionChipText,
    },
  });
}
