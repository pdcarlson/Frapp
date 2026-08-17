import { useMemo, useState } from "react";
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
 * ## "Mark all read" is a fan-out
 *
 * There is no bulk endpoint; `PATCH /v1/notifications/{id}/read` is per row. It
 * fans out over the unread rows currently loaded, which the query caps at 50.
 * Filed for a bulk endpoint.
 *
 * ## Tapping does not deep-link yet
 *
 * The payload's `target` names a screen and its params, but resolving one into
 * a route belongs with the push handler that also has to resolve a cold-start
 * tap (C7). Until then a tap marks the row read, which is the part that works
 * without push. TODO-DESIGN: deep-link on tap.
 */
export default function NotificationsScreen() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const chapterId = useActiveChapterId();

  const notificationsQuery = useNotifications();
  const markRead = useMarkNotificationRead();
  const [isMarkingAll, setIsMarkingAll] = useState(false);

  const groups = useMemo(
    () => selectNotificationGroups(notificationsQuery.data, new Date()),
    [notificationsQuery.data],
  );
  const unreadIds = useMemo(
    () => selectUnreadIds(notificationsQuery.data),
    [notificationsQuery.data],
  );

  async function markAllRead() {
    if (unreadIds.length === 0 || isMarkingAll) return;
    setIsMarkingAll(true);
    try {
      // Sequential rather than concurrent: this is a convenience action over at
      // most a screenful of rows, and firing 50 writes at once would trip the
      // API's throttle guard for no benefit the member can perceive.
      for (const id of unreadIds) {
        await markRead.mutateAsync(id).catch(() => undefined);
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
