import { useCallback, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import { useIsFocused, useRouter } from "expo-router";
import {
  applyBlockList,
  tombstoneCanUnblock,
  visibleTypingUsers,
  type BlockState,
  type ThreadRow,
} from "@repo/chat-core/blocks";
import { channelAllowsThreadReplies } from "@repo/chat-core/message-actions";
import { typingLabel } from "@repo/chat-core/typing-label";
import type { ChatMessage } from "@repo/chat-core/types";
import {
  CHANNEL_LIST_KEY,
  useBlockedUserIds,
  useChannel,
  useMemberDisplayNames,
  useViewerUserId,
} from "@repo/hooks";
import { useReportOpenChatTransport } from "@repo/hooks/open-chat-transport";
import { SignetTokens } from "@repo/theme/signet";
import { BlockedMessageTombstone } from "@/components/chat/blocked-message-tombstone";
import { ChatComposer } from "@/components/chat/chat-composer";
import { MessageItem } from "@/components/chat/message-item";
import { ThreadSkeleton } from "@/components/chat/thread-skeleton";
import { BackGlyph } from "@/components/control-glyphs";
import { Chip } from "@/components/filter-chips";
import { ErrorState } from "@/components/state-block";
import { useScreenBelow } from "@/lib/back-target";
import { useChapterBranding } from "@/lib/chapter-branding";
import { useBlockClearance } from "@/lib/chat/block-clearance";
import {
  confirmUnblockMember,
  useBlockActions,
} from "@/lib/chat/block-actions";
import {
  selectPostCapability,
  threadChannel,
  threadTitleFor,
} from "@/lib/chat/channel-list";
import { threadLayout } from "@/lib/chat/thread-layout";
import { useMessageThread } from "@/lib/chat/use-message-thread";
import { useConnection } from "@/lib/connection/use-connection";
import { goBackTo } from "@/lib/href";
import { KeyboardAvoidingArea } from "@/lib/keyboard";
import { typeRole, useFrappTheme } from "@/lib/theme";

/** The typing line's line height, as s05's (`chat-thread.tsx`) says why. */
const TYPING_LINE_HEIGHT = 16;
/** Holds the typing line's place when nobody types: a line box, no glyphs. */
const TYPING_LINE_BLANK = " ";

/** Thread rows draw no reactions in slice 1, so nothing is there to tap. */
const NO_REACT = () => undefined;
const NO_IDS: ReadonlySet<string> = new Set();

/** The thread composer's line while offline: a reply has no outbox. */
export const THREAD_OFFLINE_HINT =
  "You're offline. You can reply once you're back online.";
/** The thread composer's line where the viewer can't reply. */
export const THREAD_NO_REPLY_HINT = "You can't reply in this channel.";

export interface MessageThreadScreenProps {
  channelId: string;
  rootId: string;
}

/**
 * A message thread, pushed over its channel (#3785,
 * `spec/behavior/chat/README.md` § Message threads): the parent at the top,
 * an "N replies" divider, the replies, Follow / Following, and a
 * "Reply in thread…" composer, with who is typing named over it.
 *
 * Opened from the parent's chip or the long-press sheet's Start thread, as
 * `/chat-thread?channelId=…&threadRootId=…`: the channel's own route, pushed
 * again with the root, so the stack's back gesture returns to the channel
 * and the frozen stack layout needs no new route (`spec/ui/mobile/navigation.md`
 * § Hotspot freeze). The channel stays mounted under it, which is what keeps
 * its realtime topic attached: this screen only listens on that topic
 * (`useMessageThread`), never subscribes or re-keys it (`realtime-resilience`
 * rules 1 and 2).
 *
 * The same `SafeAreaView` + `KeyboardAvoidingArea` frame as s05, so the
 * composer clears the keyboard the same way on both platforms.
 *
 * Slice 1's rows are lean, as web's panel's are (#4034): text, the delivery
 * line with Retry and Delete, no reactions, cards or long-press actions.
 */
export function MessageThreadScreen({
  channelId,
  rootId,
}: MessageThreadScreenProps) {
  const { tokens } = useFrappTheme();
  const brand = useChapterBranding();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const router = useRouter();
  const below = useScreenBelow();
  const queryClient = useQueryClient();

  const roster = useMemberDisplayNames();
  const { nameFor, roleColorFor } = roster;

  const channelQuery = useChannel(channelId);
  const postCapability = useMemo(
    () => selectPostCapability(channelQuery.data),
    [channelQuery.data],
  );
  const canReply = channelAllowsThreadReplies({
    can_post: postCapability.canPost,
    is_read_only: postCapability.isReadOnly,
  });

  // `users.id`, the column `sender_id` references (`use-chat-runtime.ts`).
  const viewerId = useViewerUserId();
  const thread = useMessageThread(channelId, rootId, viewerId);

  const openChannel = useMemo(
    () =>
      threadChannel({
        row: channelQuery.data,
        list: queryClient.getQueryData(CHANNEL_LIST_KEY),
        channelId,
        viewerId,
        names: roster.byId,
      }),
    [channelQuery.data, queryClient, channelId, viewerId, roster.byId],
  );
  const channelTitle = threadTitleFor(openChannel, channelQuery.isFetching);

  // The viewer's block list, as s05 applies it: a held row isn't drawn, a
  // blocked member's reply reads as a tombstone.
  const blockList = useBlockedUserIds();
  const clearance = useBlockClearance(viewerId);
  const blockState = useMemo<BlockState>(
    () => ({
      status: blockList.status,
      ids: blockList.ids,
      unblocked: blockList.unblocked,
      cleared: blockList.status === "ready" ? NO_IDS : clearance,
    }),
    [blockList.status, blockList.ids, blockList.unblocked, clearance],
  );
  const rootRow = useMemo<ThreadRow | null>(() => {
    if (!thread.root) return null;
    // The chip and reactions belong to the channel's view of the parent.
    const root: ChatMessage = { ...thread.root, thread: null, reactions: {} };
    return applyBlockList([root], blockState, viewerId).rows[0] ?? null;
  }, [thread.root, blockState, viewerId]);
  const rows = useMemo(
    () => applyBlockList(thread.messages, blockState, viewerId).rows,
    [thread.messages, blockState, viewerId],
  );
  const layout = useMemo(() => threadLayout(rows), [rows]);
  // Newest at the bottom: the list is inverted, as s05's is.
  const inverted = useMemo(() => [...rows].reverse(), [rows]);

  const typing = typingLabel(
    visibleTypingUsers(thread.typingUsers, blockState, viewerId),
    nameFor,
  );

  // The app-wide pill says the transport while this screen is up, as s05
  // does while it is (`spec/ui/resilience/connection-state.md` § One indicator).
  const focused = useIsFocused();
  useReportOpenChatTransport(focused ? thread.connection : null);

  const { writeBlockedReason } = useConnection();
  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const { send, emitTyping } = thread;
  const onChangeText = useCallback(
    (next: string) => {
      setDraft(next);
      if (next) emitTyping();
    },
    [emitTyping],
  );
  const onSend = useCallback(() => {
    const content = draft.trim();
    if (!content) return;
    setDraft("");
    setSendError(null);
    // A failure stays in the list, marked, with Retry and Delete (rule 6);
    // the line over the composer says why.
    void send(content).then(({ error }) => setSendError(error));
  }, [draft, send]);
  const onRetry = useCallback(
    (clientMessageId: string) => {
      const failed = thread.messages.find(
        (message) => message.client_message_id === clientMessageId,
      );
      if (!failed) return;
      setSendError(null);
      void send(failed.content, clientMessageId).then(({ error }) =>
        setSendError(error),
      );
    },
    [thread.messages, send],
  );

  const [followBusy, setFollowBusy] = useState(false);
  const following = thread.followState === "following";
  const { setFollow } = thread;
  const toggleFollow = useCallback(async () => {
    setFollowBusy(true);
    try {
      await setFollow(following ? "none" : "following");
    } catch (error) {
      Alert.alert(
        "Couldn't change this thread",
        error instanceof Error ? error.message : undefined,
      );
    } finally {
      setFollowBusy(false);
    }
  }, [following, setFollow]);

  const [olderError, setOlderError] = useState<string | null>(null);
  const { loadOlder } = thread;
  const onLoadOlder = useCallback(() => {
    setOlderError(null);
    void loadOlder().then(({ error }) => setOlderError(error));
  }, [loadOlder]);

  // Unblock from a tombstone, as s05 offers it; the thread is read again so
  // the member's replies come back unmasked.
  const { unblock } = useBlockActions();
  const { retryLoad } = thread;
  const onUnblock = useCallback(
    (userId: string) => {
      confirmUnblockMember({
        name: nameFor(userId),
        run: () => unblock(userId),
        onDone: retryLoad,
      });
    },
    [nameFor, unblock, retryLoad],
  );

  const renderRow = useCallback(
    (row: ThreadRow, startsRun: boolean, endsRun: boolean) => {
      if (!viewerId) return null;
      if (row.visibility === "tombstone") {
        const senderId = row.message.sender_id;
        return (
          <BlockedMessageTombstone
            channelId={channelId}
            senderName={senderId ? nameFor(senderId) : null}
            canUnblock={tombstoneCanUnblock(row.message, blockState)}
            onUnblock={() => {
              if (senderId) onUnblock(senderId);
            }}
            startsRun={startsRun}
          />
        );
      }
      return (
        <MessageItem
          message={row.message}
          viewerId={viewerId}
          nameFor={nameFor}
          roleColorFor={roleColorFor}
          startsRun={startsRun}
          endsRun={endsRun}
          onRetry={onRetry}
          onDiscard={thread.discard}
          onReact={NO_REACT}
          onUnreact={NO_REACT}
        />
      );
    },
    [
      viewerId,
      nameFor,
      roleColorFor,
      onRetry,
      thread.discard,
      channelId,
      blockState,
      onUnblock,
    ],
  );

  // The thread's own count while older replies are still unread here; the
  // rows held once they are all loaded (a live reply lands before the
  // parent's summary is read again). The viewer's unsent rows never count.
  const confirmedReplies = rows.filter(
    (row) => row.message._status === "confirmed",
  ).length;
  const replyCount = Math.max(
    confirmedReplies,
    thread.root?.thread?.reply_count ?? 0,
  );
  // Drawn at the top of the inverted list: the parent, then the divider.
  const head = rootRow ? (
    <View>
      {renderRow(rootRow, true, true)}
      <View style={styles.divider} accessibilityRole="header">
        <Text style={styles.dividerText}>
          {replyCount === 1 ? "1 reply" : `${replyCount} replies`}
        </Text>
        <View style={styles.dividerRule} />
      </View>
      {thread.hasOlder ? (
        <Pressable
          accessibilityRole="button"
          onPress={onLoadOlder}
          disabled={thread.isLoadingOlder}
          style={({ pressed }) => [
            styles.loadOlder,
            pressed ? styles.pressed : null,
          ]}
        >
          <Text style={[styles.loadOlderText, { color: brand.accent }]}>
            {thread.isLoadingOlder ? "Loading…" : "Load earlier replies"}
          </Text>
        </Pressable>
      ) : null}
      {olderError ? (
        <Text style={styles.errorLine} accessibilityLiveRegion="polite">
          {`Couldn't load earlier replies. ${olderError}`}
        </Text>
      ) : null}
    </View>
  ) : null;

  const body =
    thread.metaError || thread.repliesError ? (
      <View style={styles.state}>
        <ErrorState
          title="Couldn't load this thread"
          body="Check your connection and try again."
          onRetry={thread.retryLoad}
        />
      </View>
    ) : thread.isLoading || !rootRow || !viewerId ? (
      <ThreadSkeleton channelId={channelId} />
    ) : (
      <FlatList
        data={inverted}
        inverted
        keyExtractor={(row) => row.message.client_message_id}
        renderItem={({ item }) => {
          const placement = layout.get(item.message.client_message_id);
          return renderRow(
            item,
            placement?.startsRun ?? true,
            placement?.endsRun ?? true,
          );
        }}
        // Inverted, so the footer draws at the top, over the oldest reply.
        ListFooterComponent={head}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        // s05's choice and reason (`chat-thread.tsx`): `interactive` does
        // nothing on Android, and on iOS leaves the composer in mid-air.
        keyboardDismissMode="on-drag"
      />
    );

  return (
    <SafeAreaView
      style={styles.safeArea}
      edges={["top", "left", "right", "bottom"]}
    >
      <KeyboardAvoidingArea style={styles.flex}>
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Back to ${channelTitle}`}
            hitSlop={12}
            // Pops the thread back to its channel, as the edge swipe does.
            onPress={() => (below ? below.goBack() : goBackTo(router, "/"))}
            style={({ pressed }) => (pressed ? styles.pressed : null)}
          >
            <BackGlyph color={brand.accent} />
          </Pressable>
          <View style={styles.headerText}>
            <Text
              accessibilityRole="header"
              numberOfLines={1}
              style={styles.headerName}
            >
              Thread
            </Text>
            <Text numberOfLines={1} style={styles.headerChannel}>
              {channelTitle}
            </Text>
          </View>
          {thread.root ? (
            <Chip
              label={following ? "Following" : "Follow"}
              on={following}
              onPress={() => {
                if (!followBusy) void toggleFollow();
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: following, busy: followBusy }}
              accessibilityHint={
                following
                  ? "Stops notifications for this thread"
                  : "Notifies you of new replies"
              }
            />
          ) : null}
        </View>

        <View style={styles.flex}>{body}</View>

        {/* Not a live region, and the blank hidden, as s05's line is: one
            that changes with every pause would talk over the thread. */}
        <View
          testID="typing-line"
          style={styles.typingSlot}
          accessibilityElementsHidden={!typing}
          importantForAccessibility={typing ? "auto" : "no-hide-descendants"}
        >
          <Text style={styles.typing} numberOfLines={1}>
            {typing ?? TYPING_LINE_BLANK}
          </Text>
        </View>
        <ChatComposer
          value={draft}
          onChangeText={onChangeText}
          onSend={onSend}
          canSend={!!viewerId && canReply && !writeBlockedReason}
          placeholder="Reply in thread…"
          disabledHint={
            !canReply
              ? THREAD_NO_REPLY_HINT
              : writeBlockedReason
                ? THREAD_OFFLINE_HINT
                : sendError
          }
          hintTone={
            canReply && !writeBlockedReason && sendError ? "error" : "muted"
          }
        />
      </KeyboardAvoidingArea>
    </SafeAreaView>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: tokens.color.surface.background,
    },
    flex: {
      flex: 1,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
      paddingHorizontal: tokens.spacing.lg,
      paddingTop: tokens.spacing.sm,
      paddingBottom: tokens.spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: tokens.color.border.hairline,
    },
    headerText: {
      flex: 1,
      minWidth: 0,
    },
    headerName: {
      ...typeRole(tokens.typography.role.title),
      color: tokens.color.text.foreground,
    },
    headerChannel: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    listContent: {
      paddingVertical: tokens.spacing.sm,
    },
    divider: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
      paddingHorizontal: tokens.spacing.lg,
      paddingVertical: tokens.spacing.md,
    },
    dividerText: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    dividerRule: {
      flex: 1,
      height: 1,
      backgroundColor: tokens.color.border.hairline,
    },
    loadOlder: {
      alignSelf: "flex-start",
      paddingHorizontal: tokens.spacing.lg,
      paddingVertical: tokens.spacing.sm,
    },
    loadOlderText: {
      ...typeRole(tokens.typography.role.label),
    },
    errorLine: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructiveText,
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: tokens.spacing.sm,
    },
    state: {
      flex: 1,
      justifyContent: "center",
      padding: tokens.spacing.xl,
    },
    pressed: {
      opacity: 0.6,
    },
    typingSlot: {
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: tokens.spacing.xs,
    },
    typing: {
      ...typeRole({
        ...tokens.typography.role.caption,
        lineHeight: TYPING_LINE_HEIGHT,
      }),
      color: tokens.color.text.muted,
    },
  });
}
