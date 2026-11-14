import { forwardRef, useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { BottomSheetModal, BottomSheetScrollView } from "@gorhom/bottom-sheet";
import {
  ALL_THREADS_EMPTY,
  ALL_THREADS_ERROR,
  ALL_THREADS_TITLE,
  resolveAuthorLabel,
  useMemberThreads,
  type MemberThread,
  type NameResolver,
} from "@repo/hooks";
import { replyPreviewText } from "@repo/chat-core/reply-preview";
import { forwardedFromOf } from "@repo/chat-core/types";
import { TOMBSTONE_TEXT } from "@repo/chat-core/block-copy";
import { SignetTokens } from "@repo/theme/signet";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { useChapterBranding } from "@/lib/chapter-branding";
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

type Message = MemberThread["root"];

function previewOf(message: Message): string {
  if ((message as { sender_blocked?: boolean }).sender_blocked === true) {
    return TOMBSTONE_TEXT;
  }
  return replyPreviewText({
    ...message,
    // A forward with no comment previews its copy (#4875).
    forwarded_from: forwardedFromOf(message.forwarded_from),
  });
}

/**
 * All threads (#4960), the phone's face of web's `AllThreadsPopover`: every
 * thread the member started, replied in or was mentioned in, across channels,
 * newest activity first. Slack's Threads view is the model: each row names
 * the channel, the parent and the latest reply, bold with a "2 new" while
 * there is something unread. A row opens the thread (`onOpen`); the sheet
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
  const brand = useChapterBranding();
  const query = useMemberThreads({ refetchOnMount: true });
  const rows = useMemo<ThreadRowModel[]>(
    () =>
      (query.data ?? []).map((thread) => ({
        key: thread.thread_root_id,
        channelId: thread.channel_id,
        rootId: thread.thread_root_id,
        channel: channelNameFor(thread.channel_id) ?? "Conversation",
        when: sentAtLabel(thread.last_reply_at ?? thread.root.created_at),
        unread: thread.unread_count,
        muted: thread.state === "muted",
        rootLine: `${resolveAuthorLabel(thread.root, nameFor, viewerId)}: ${previewOf(thread.root)}`,
        replyLine: thread.latest_reply
          ? `${resolveAuthorLabel(thread.latest_reply, nameFor, viewerId)}: ${previewOf(thread.latest_reply)}`
          : null,
        replies:
          thread.reply_count === 1 ? "1 reply" : `${thread.reply_count} replies`,
      })),
    [query.data, channelNameFor, nameFor, viewerId],
  );

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
            <Text
              style={[styles.channel, row.unread > 0 ? styles.unread : null]}
              numberOfLines={1}
            >
              {row.channel}
            </Text>
            {row.unread > 0 ? (
              <Text style={[styles.newCount, { color: brand.accent }]}>{`${row.unread} new`}</Text>
            ) : null}
          </View>
          <Text style={styles.meta} numberOfLines={1}>
            {row.rootLine}
          </Text>
          {row.replyLine ? (
            <Text
              style={[
                styles.preview,
                row.unread > 0 ? null : styles.readPreview,
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
      justifyContent: "space-between",
      gap: tokens.spacing.sm,
    },
    channel: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.mutedForeground,
      flexShrink: 1,
    },
    unread: {
      color: tokens.color.text.foreground,
    },
    newCount: {
      ...typeRole(tokens.typography.role.label),
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
