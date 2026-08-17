import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  useActiveChapterId,
  useMarkNotificationRead,
  useNotifications,
} from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { ScreenShell } from "@/components/screen-shell";
import { SectionHeader } from "@/components/list-section";
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
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * s14 — Notifications (`canvas-screens.dc.html:474`).
 *
 * In-app history only. Remote push — permissions, tokens, tap handling — is C7
 * and does not run in Expo Go at all, so nothing here depends on it.
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
 * ## Tapping does not deep-link yet
 *
 * The payload's `target` names a screen and its params, but resolving one into
 * a route belongs with the push handler that also has to resolve a cold-start
 * tap (C7). Until then a tap marks the row read, which is the part that works
 * without push. TODO-DESIGN: deep-link on tap.
 */
/**
 * Kept under the API's 30-writes-per-60s budget, with headroom for the reads
 * the same member is making elsewhere in the app.
 */
const MARK_ALL_BATCH = 25;

export default function NotificationsScreen() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const chapterId = useActiveChapterId();

  const notificationsQuery = useNotifications();
  const markRead = useMarkNotificationRead();
  const [isMarkingAll, setIsMarkingAll] = useState(false);
  const [markAllNote, setMarkAllNote] = useState<string | null>(null);

  // `now` is state, not a value captured inside the memo. React Query's
  // structural sharing keeps the data reference stable when a refetch returns
  // identical rows, so a `new Date()` read inside the memo would freeze the
  // TODAY/EARLIER split at mount — a row from 11:47 PM would still sit under
  // TODAY at 12:10 AM on a tab screen that never unmounts.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

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
        <EmptyState
          glyph="✓"
          title="You're all caught up"
          body="Chapter activity you're involved in shows up here."
        />
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
              if (!row.isUnread) return;
              markRead.mutate(row.id);
            }}
          />
        ))}
      </View>
    ));
  }

  return (
    <ScreenShell
      title="Notifications"
      subtitle="Recent chapter activity, and what you haven't read."
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
  const styles = createStyles(tokens);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={row.title}
      accessibilityHint={row.isUnread ? "Marks this as read." : undefined}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        row.isUnread ? null : styles.rowRead,
        pressed ? styles.pressed : null,
      ]}
    >
      <View style={row.isUnread ? styles.dot : styles.dotSpacer} />
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{row.title}</Text>
        {row.body ? <Text style={styles.rowBody}>{row.body}</Text> : null}
        <Text style={styles.rowMeta}>
          {[row.categoryLabel, row.time].filter(Boolean).join(" · ")}
        </Text>
      </View>
    </Pressable>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    headerAction: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.gold.askText,
    },
    group: {
      gap: tokens.spacing.xs,
    },
    markAllNote: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.warning,
      paddingHorizontal: tokens.spacing.xs,
    },
    row: {
      flexDirection: "row",
      gap: tokens.spacing.md,
      paddingVertical: tokens.spacing.md,
      minHeight: tokens.touch.minimum,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: tokens.color.border.hairline,
    },
    // Read rows recede rather than disappear, as drawn.
    rowRead: {
      opacity: 0.7,
    },
    dot: {
      width: tokens.spacing.sm,
      height: tokens.spacing.sm,
      borderRadius: tokens.spacing.xs,
      marginTop: tokens.spacing.sm,
      backgroundColor: tokens.color.gold.house,
    },
    dotSpacer: {
      width: tokens.spacing.sm,
    },
    rowText: {
      flex: 1,
      gap: tokens.spacing.xs,
    },
    rowTitle: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    rowBody: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
    },
    rowMeta: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
    pressed: {
      opacity: 0.6,
    },
  });
}
