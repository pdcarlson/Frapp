import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import {
  useActiveChapterId,
  useMarkNotificationRead,
  useNotifications,
  useNowDate,
} from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { ScreenShell } from "@/components/screen-shell";
import { useRefetchAll } from "@/components/pull-to-refresh";
import { BACK_TO_CHAT } from "@/components/back-row";
import {
  listRowHint,
  SectionHeader,
  usePressFeedback,
} from "@/components/list-section";
import { NotificationsGlyph } from "@/components/more/more-glyphs";
import {
  EmptyState,
  ErrorState,
  NoChapterState,
  SkeletonLines,
} from "@/components/state-block";
import {
  type NotificationRow,
  selectNotificationGroups,
  selectUnreadIds,
} from "@/lib/more/notifications";
import { NOTIFICATION_FALLBACK_PATHNAME } from "@/lib/notifications/targets";
import { asRoute } from "@/lib/href";
import { typeRole, useFrappTheme } from "@/lib/theme";
import {
  type ChapterBranding,
  useChapterBranding,
} from "@/lib/chapter-branding";

/**
 * s14 — Notifications (`canvas-screens.dc.html:474`).
 *
 * In-app history, and the surface a push tap ultimately lands on. The push
 * runtime itself (permissions, tokens, cold-start taps) is
 * `lib/notifications/use-push-runtime.ts` and does not run in Expo Go at all —
 * nothing on this screen depends on it, which is why the history renders
 * identically with push switched off.
 *
 * ## The category label under each row is derived
 *
 * A notification row does not store its category: `NotificationService`
 * persists `data: payload.data ?? {}` and forwards `category` only to the push
 * provider for delivery telemetry. What the row does carry is the deep-link
 * target, so the label comes from `data.target.screen` — see `lib/more/notifications.ts`.
 *
 * ## "Mark all read" is a capped fan-out
 *
 * There is no bulk endpoint; `PATCH /v1/notifications/{id}/read` is per row, and
 * the API's write budget is a 60-second **count** — `{ttl: 60_000, limit: 30}`
 * per caller — not a concurrency limit, so serializing the calls would buy
 * nothing. They go out together, capped below that budget, and whatever is left
 * over is reported rather than silently dropped. Filed for a bulk endpoint.
 *
 * ## Tapping deep-links
 *
 * The row's destination is resolved by `lib/notifications/targets.ts` — the
 * same module the push handler uses for a tapped notification, so an in-app tap
 * and a push tap cannot disagree about where a payload points. A row whose
 * target this build does not recognize resolves to this screen, so it marks
 * itself read and stays put rather than navigating somewhere wrong.
 */
/**
 * Kept under the API's 30-writes-per-60s budget, with headroom for the reads
 * the same member is making elsewhere in the app.
 */
const MARK_ALL_BATCH = 25;

export default function NotificationsScreen() {
  const router = useRouter();
  const { tokens } = useFrappTheme();
  const brand = useChapterBranding();
  const styles = createStyles(tokens, brand);
  const chapterId = useActiveChapterId();

  const notificationsQuery = useNotifications();
  const refresh = useRefetchAll([notificationsQuery]);
  const markRead = useMarkNotificationRead();
  const [isMarkingAll, setIsMarkingAll] = useState(false);
  const [markAllNote, setMarkAllNote] = useState<string | null>(null);

  // `now` ticks rather than being read once inside the memo below: React
  // Query's structural sharing keeps the data reference stable when a refetch
  // returns identical rows, so a `new Date()` read inside the memo would
  // freeze the TODAY/EARLIER split at mount — a row from 11:47 PM would still
  // sit under TODAY at 12:10 AM on a tab screen that never unmounts.
  const now = useNowDate();

  const groups = useMemo(
    () => selectNotificationGroups(notificationsQuery.data, now),
    [notificationsQuery.data, now],
  );
  const unreadIds = useMemo(
    () => selectUnreadIds(notificationsQuery.data),
    [notificationsQuery.data],
  );

  async function markAllRead() {
    if (unreadIds.length === 0 || isMarkingAll) return;
    setIsMarkingAll(true);
    setMarkAllNote(null);
    const batch = unreadIds.slice(0, MARK_ALL_BATCH);
    try {
      // Concurrent, capped, and reported. Concurrency is free here — the budget
      // is a per-minute count, so pacing the calls would not raise the ceiling —
      // and it lets the per-write cache invalidations coalesce into a couple of
      // list refetches instead of one per row.
      const results = await Promise.allSettled(
        batch.map((id) => markRead.mutateAsync(id)),
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      const skipped = unreadIds.length - batch.length;
      if (failed + skipped > 0) {
        setMarkAllNote(
          `Marked ${batch.length - failed} of ${unreadIds.length}. Try again in a minute for the rest.`,
        );
      }
    } finally {
      setIsMarkingAll(false);
    }
  }

  function renderBody() {
    if (!chapterId) return <NoChapterState noun="your notifications" />;
    if (notificationsQuery.isPending) return <SkeletonLines lines={4} />;
    if (notificationsQuery.isError) {
      return (
        <ErrorState
          title="Couldn't load notifications"
          body="Your activity history couldn't reach the server."
          onRetry={() => void notificationsQuery.refetch()}
          isRetrying={notificationsQuery.isFetching}
        />
      );
    }
    if (groups.length === 0) {
      return (
        <EmptyState glyph={NotificationsGlyph} title="You're all caught up" />
      );
    }
    return groups.map((group) => (
      <View key={group.heading} style={styles.group}>
        <SectionHeader>{group.heading}</SectionHeader>
        {group.rows.map((row) => (
          <NotificationListRow
            key={row.id}
            row={row}
            onPress={() => {
              if (row.isUnread) markRead.mutate(row.id);
              // Resolves to this screen when the target is unrecognized, so
              // the tap marks the row read and stays put rather than pushing
              // the notification list on top of itself.
              if (row.href !== NOTIFICATION_FALLBACK_PATHNAME) {
                router.push(asRoute(row.href));
              }
            }}
          />
        ))}
      </View>
    ));
  }

  return (
    <ScreenShell
      back={BACK_TO_CHAT}
      title="Notifications"
      refresh={refresh}
      headerAction={
        unreadIds.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Mark all notifications read"
            accessibilityState={{ disabled: isMarkingAll }}
            disabled={isMarkingAll}
            hitSlop={tokens.spacing.sm}
            onPress={() => void markAllRead()}
          >
            <Text style={styles.headerAction}>
              {isMarkingAll ? "Marking…" : "Mark all read"}
            </Text>
          </Pressable>
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

/** Exported so a spec can render one row without the whole screen. */
export function NotificationListRow({
  row,
  onPress,
}: {
  row: NotificationRow;
  onPress: () => void;
}) {
  const { tokens } = useFrappTheme();
  const brand = useChapterBranding();
  const styles = createStyles(tokens, brand);
  const feedback = usePressFeedback();

  return (
    <Pressable
      accessibilityRole="button"
      // The Pressable is one node, so its texts aren't read on their own: the
      // label carries the body too, all of it, though the row shows two lines.
      // `listRowHint` joins them as sentences, the way a row's hint is.
      accessibilityLabel={
        row.body ? listRowHint(row.title, row.body) : row.title
      }
      accessibilityHint={row.isUnread ? "Marks this as read." : undefined}
      onPress={onPress}
      android_ripple={feedback.ripple}
      style={({ pressed }) => [styles.row, feedback.lift(pressed)]}
    >
      <View style={row.isUnread ? styles.dot : styles.dotSpacer} />
      <View style={styles.rowText}>
        <Text
          style={[styles.rowTitle, row.isUnread ? null : styles.rowTitleRead]}
        >
          {row.title}
        </Text>
        {row.body ? (
          <Text style={styles.rowBody} numberOfLines={2}>
            {row.body}
          </Text>
        ) : null}
        <Text style={styles.rowMeta}>
          {[row.categoryLabel, row.time].filter(Boolean).join(" · ")}
        </Text>
      </View>
    </Pressable>
  );
}

/**
 * The title and body's line height. The label role carries none, so the line
 * box was the font's own and the unread dot could only guess at its middle.
 * 20 is the 14pt label's natural line on the 4pt grid.
 */
const LINE_HEIGHT = 20;

function createStyles(tokens: SignetTokens, brand: ChapterBranding) {
  const DOT_SIZE = tokens.spacing.sm;
  return StyleSheet.create({
    headerAction: {
      ...typeRole(tokens.typography.role.label),
      color: brand.accent,
    },
    group: {
      gap: tokens.spacing.xs,
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
    // Centred on the title's first line, as drawn, however many lines the
    // title wraps to.
    dot: {
      width: DOT_SIZE,
      height: DOT_SIZE,
      borderRadius: DOT_SIZE / 2,
      marginTop: (LINE_HEIGHT - DOT_SIZE) / 2,
      backgroundColor: brand.accent,
    },
    dotSpacer: {
      width: DOT_SIZE,
    },
    // Title and body read as one sentence at one size, as s14 sets them, and
    // the meta line sits a step below.
    rowText: {
      flex: 1,
    },
    rowTitle: {
      ...typeRole(tokens.typography.role.label),
      lineHeight: LINE_HEIGHT,
      color: tokens.color.text.foreground,
    },
    // Read rows recede rather than disappear, as drawn: the title drops to the
    // body's tone, so the row reads as one quieter sentence. Colour, not
    // opacity, so the press lift behind it is as strong as any other row's.
    rowTitleRead: {
      color: tokens.color.text.mutedForeground,
    },
    // The title's size at regular weight. It used to be the body role (16),
    // larger than the 14pt title above it.
    rowBody: {
      ...typeRole({
        ...tokens.typography.role.label,
        weight: tokens.typography.weight.regular,
      }),
      lineHeight: LINE_HEIGHT,
      color: tokens.color.text.mutedForeground,
    },
    rowMeta: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
      marginTop: tokens.spacing.xs,
    },
  });
}
