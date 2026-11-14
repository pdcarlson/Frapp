import { forwardRef, useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { BottomSheetModal, BottomSheetScrollView } from "@gorhom/bottom-sheet";
import {
  ALL_THREADS_EMPTY,
  ALL_THREADS_ERROR,
  ALL_THREADS_TITLE,
  resolveAuthorLabel,
  resolveAuthorName,
  useMemberThreads,
  type NameResolver,
} from "@repo/hooks";
import { memberThreadPreview } from "@repo/chat-core/threads";
import type { RawChatMessage } from "@repo/chat-core/types";
import { SignetTokens } from "@repo/theme/signet";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { describeLoadFailure } from "@repo/hooks/error-copy";
import { sentAtLabel } from "./message-actions-sheet";
import {
  ErrorState,
  SkeletonRegion,
  SkeletonText,
} from "@/components/state-block";
import {
  SheetBackToClose,
  SheetGrabber,
  SheetScrim,
  TallSheetHeader,
  useSheetBackgroundStyle,
  useSheetClose,
  useTallSheetProps,
  SHEET_STACK_BEHAVIOR,
} from "@/components/sheet-scaffold";

/** Where a row opens: the thread, over its channel. */
export interface ThreadTarget {
  channelId: string;
  rootId: string;
}

/**
 * All threads (#4960), the phone's face of web's `AllThreadsPopover`: every
 * thread the member started, replied in or was mentioned in, across channels,
 * newest activity first. Slack's Threads view is the model: each row names
 * the channel, the parent and the latest reply. Unread reads as a list in a
 * sheet does (components.md: a dot in the foreground and a bolder title,
 * never a New badge); the count is in the row's accessible name. Both lines
 * come from chat-core's `memberThreadPreview`, web's rule too. A row opens the thread (`onOpen`); the sheet
 * closes first, since the push is the confirmation.
 *
 * The read lives in {@link ThreadRows}, a child of the modal, so it re-reads
 * on every opening (gorhom mounts a modal's children only while presented),
 * on top of the minute-by-minute read behind the header button's badge.
 */
export const AllThreadsSheet = forwardRef<
  BottomSheetModal,
  {
    channelNameFor: (channelId: string) => string | null;
    nameFor: NameResolver;
    viewerId: string | null;
    onOpen: (target: ThreadTarget) => void;
  }
>(function AllThreadsSheet({ channelNameFor, nameFor, viewerId, onOpen }, ref) {
  const closeSheet = useSheetClose(ref);
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const backgroundStyle = useSheetBackgroundStyle();
  const tallSheet = useTallSheetProps();
  return (
    <BottomSheetModal
      ref={ref}
      stackBehavior={SHEET_STACK_BEHAVIOR}
      {...tallSheet}
      backgroundStyle={backgroundStyle}
      handleComponent={SheetGrabber}
      backdropComponent={SheetScrim}
    >
      <SheetBackToClose onClose={closeSheet} />
      <BottomSheetScrollView
        onAccessibilityEscape={closeSheet}
        style={styles.scroll}
        contentContainerStyle={styles.body}
        stickyHeaderIndices={[0]}
      >
        <View style={styles.stickyHeader}>
          <TallSheetHeader title={ALL_THREADS_TITLE} onClose={closeSheet} />
        </View>
        <ThreadRows
          channelNameFor={channelNameFor}
          nameFor={nameFor}
          viewerId={viewerId}
          onOpen={(target) => {
            closeSheet();
            onOpen(target);
          }}
        />
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
});

interface ThreadRowModel extends ThreadTarget {
  key: string;
  channel: string;
  when: string;
  unread: number;
  muted: boolean;
  rootLine: string;
  replyLine: string | null;
  replies: string;
}

export function ThreadRows({
  channelNameFor,
  nameFor,
  viewerId,
  onOpen,
}: {
  channelNameFor: (channelId: string) => string | null;
  nameFor: NameResolver;
  viewerId: string | null;
  onOpen: (target: ThreadTarget) => void;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const query = useMemberThreads({ refetchOnMount: true });
  const rows = useMemo<ThreadRowModel[]>(() => {
    const names = {
      nameOf: (id: string) =>
        resolveAuthorName({ sender_id: id, author_name: null }, nameFor),
      fallbackLabel: (id: string) =>
        resolveAuthorLabel({ sender_id: id, author_name: null }, nameFor, null),
    };
    return (query.data ?? []).map((thread) => {
      const preview = memberThreadPreview(
        thread.root as unknown as RawChatMessage,
        viewerId,
        names,
      );
      const rootAuthor = preview.root.sender_blocked
        ? null
        : resolveAuthorLabel(preview.root, nameFor, viewerId);
      return {
        key: thread.thread_root_id,
        channelId: thread.channel_id,
        rootId: thread.thread_root_id,
        channel: channelNameFor(thread.channel_id) ?? "Conversation",
        when: sentAtLabel(thread.last_reply_at ?? thread.root.created_at),
        unread: thread.unread_count,
        muted: thread.state === "muted",
        rootLine: rootAuthor
          ? `${rootAuthor}: ${preview.rootText}`
          : preview.rootText,
        replyLine: preview.reply
          ? preview.reply.name
            ? `${preview.reply.name}: ${preview.reply.text}`
            : preview.reply.text
          : null,
        replies:
          thread.reply_count === 1 ? "1 reply" : `${thread.reply_count} replies`,
      };
    });
  }, [query.data, channelNameFor, nameFor, viewerId]);

  if (query.isError && query.data === undefined) {
    return (
      <ErrorState
        title={ALL_THREADS_ERROR}
        body={describeLoadFailure(query.error)}
        onRetry={() => void query.refetch()}
        isRetrying={query.isFetching}
      />
    );
  }
  if (query.isPending) return <RowsSkeleton />;
  if (rows.length === 0) {
    return <Text style={styles.empty}>{ALL_THREADS_EMPTY}</Text>;
  }
  return (
    <View>
      {rows.map((row) => (
        <Pressable
          key={row.key}
          accessibilityRole="button"
          accessibilityLabel={`Thread in ${row.channel}${
            row.unread > 0 ? `, ${row.unread} new` : ""
          }`}
          accessibilityHint="Opens this thread."
          onPress={() => onOpen({ channelId: row.channelId, rootId: row.rootId })}
          style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
        >
          <View style={styles.metaLine}>
            {row.unread > 0 ? <View style={styles.unreadDot} /> : null}
            <Text
              style={[styles.channel, row.unread > 0 ? styles.unread : null]}
              numberOfLines={1}
            >
              {row.channel}
            </Text>
          </View>
          <Text style={styles.meta} numberOfLines={1}>
            {row.rootLine}
          </Text>
          {row.replyLine ? (
            <Text
              style={[
                styles.preview,
                row.unread > 0 ? styles.unreadPreview : styles.readPreview,
              ]}
              numberOfLines={2}
            >
              {row.replyLine}
            </Text>
          ) : null}
          <Text style={styles.meta} numberOfLines={1}>
            {`${row.replies} · ${row.when}${row.muted ? " · Muted" : ""}`}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function RowsSkeleton() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const { label, body } = tokens.typography.role;
  return (
    <SkeletonRegion label="Loading threads">
      {[0, 1, 2].map((index) => (
        <View key={index} style={styles.row}>
          <SkeletonText role={label} width="40%" />
          <SkeletonText role={body} width={index % 2 ? "70%" : "90%"} />
        </View>
      ))}
    </SkeletonRegion>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    scroll: {
      flex: 1,
    },
    body: {
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: tokens.spacing.xl,
    },
    stickyHeader: {
      backgroundColor: tokens.color.surface.popover,
    },
    row: {
      gap: tokens.spacing.xs,
      paddingVertical: tokens.spacing.md,
      minHeight: tokens.touch.minimum,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: tokens.color.border.hairline,
    },
    metaLine: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
    },
    unreadDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: tokens.color.text.foreground,
    },
    // A read row's title is the caption's regular weight; an unread one the
    // label's semibold, in the foreground: the "bolder title".
    channel: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
      flexShrink: 1,
    },
    unread: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    meta: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    preview: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    readPreview: {
      color: tokens.color.text.mutedForeground,
    },
    unreadPreview: {
      color: tokens.color.text.foreground,
    },
    empty: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
      paddingVertical: tokens.spacing.xl,
    },
    pressed: {
      opacity: 0.7,
    },
  });
}
