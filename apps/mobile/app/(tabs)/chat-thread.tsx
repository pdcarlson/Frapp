import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  MASKED_RELOAD_FAILED_BODY,
  MASKED_RELOAD_FAILED_TITLE,
} from "@repo/chat-core/block-copy";
import {
  isBlockableSender,
  visibleTypingUsers,
  type ThreadRow,
} from "@repo/chat-core/blocks";
import { channelAllowsReplies } from "@repo/chat-core/message-actions";
import type { ChatMessage } from "@repo/chat-core/types";
import { useQueryClient } from "@tanstack/react-query";
import {
  CHANNEL_LIST_KEY,
  resolveAuthorLabel,
  resolveAuthorName,
  useActiveChapterId,
  useChannel,
  useChannelNotificationPreferences,
  useCurrentUser,
  useMarkChannelRead,
  useMemberDisplayNames,
  usePermissionList,
  useRequestChatUploadUrl,
  useSetChannelNotificationLevel,
} from "@repo/hooks";
import { can } from "@repo/validation";
import { SignetTokens } from "@repo/theme/signet";
import { BlockListNotice } from "@/components/chat/block-list-notice";
import { ChatComposer } from "@/components/chat/chat-composer";
import {
  ImageViewer,
  ImageViewerContext,
  useImageViewer,
} from "@/components/chat/image-viewer";
import {
  MessageActionsSheet,
  type MessageActionsSheetHandle,
  type MessageActionsTarget,
} from "@/components/chat/message-actions-sheet";
import {
  NotificationLevelControl,
  NotificationLevelMenu,
  selectChannelNotificationLevel,
  useNotificationLevelMenu,
} from "@/components/chat/notification-level-control";
import { ThreadHistoryEdge } from "@/components/chat/thread-history-edge";
import { ThreadMessageRow } from "@/components/chat/thread-message-row";
import { threadLayout } from "@/lib/chat/thread-layout";
import { ErrorState } from "@/components/state-block";
import { pickAndUploadPhoto } from "@/lib/chat/attachment-upload";
import {
  confirmUnblockMember,
  useBlockActions,
} from "@/lib/chat/block-actions";
import { messageActionsFor, rosterMembership } from "@/lib/chat/blocks";
import { useMaskedRefresh } from "@/lib/chat/masked-refresh";
import { useChatChannel } from "@/lib/chat/use-chat-channel";
import { useThreadBlockList } from "@/lib/chat/use-thread-block-list";
import {
  selectPostCapability,
  threadHeaderTitle,
} from "@/lib/chat/channel-list";
import { confirmDeleteMessage } from "@/lib/chat/confirm-delete-message";
import { useComposerStaging } from "@/lib/chat/use-composer-staging";
import { useJumpToMessage } from "@/lib/chat/use-jump-to-message";
import { getKeyboardPath } from "@/lib/keyboard";
import { useConnection } from "@/lib/connection/use-connection";
import { typeRole, useFrappTheme } from "@/lib/theme";

const NO_DEPARTED: ReadonlySet<string> = new Set();

/**
 * s05 — Chat thread.
 *
 * **This screen deliberately does not use `ScreenShell`.** The shell wraps its
 * children in a `ScrollView` (`components/screen-shell.tsx:33`), and a
 * `FlatList` nested in a `ScrollView` loses windowing entirely — every message
 * ever loaded would mount at once, which is precisely the thing a thread cannot
 * afford. `app/(auth)/chapter-picker.tsx` is the existing precedent for opting
 * out. The shell is frozen, so this is a hand-rolled `SafeAreaView` instead of a
 * shell change.
 *
 * The list is **inverted**: `selectMessages` returns ascending order, so the
 * data is reversed once and `inverted` pins the newest message to the bottom
 * without a scroll-to-end effect racing every insert.
 *
 * Keyboard: `react-native-keyboard-controller` does not run in Expo Go, so it
 * lives behind `lib/keyboard.tsx`. This reads `getKeyboardPath()` only to pick
 * the right *behavior*, and uses `KeyboardAvoidingView` either way — the guarded
 * `KeyboardProvider` is already mounted app-wide, and a screen must never import
 * the native package directly (ESLint `no-restricted-imports` enforces it).
 */
export default function ChatThreadScreen() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const router = useRouter();

  // Params arrive as `string | string[]`; a repeated query key would otherwise
  // silently produce an array where a channel id is expected.
  const params = useLocalSearchParams<{ channelId?: string | string[] }>();
  const channelId = useMemo(() => {
    const raw = params.channelId;
    const value = Array.isArray(raw) ? raw[0] : raw;
    return typeof value === "string" && value.length > 0 ? value : null;
  }, [params.channelId]);

  // Channel-level metadata (#704) — mobile had no read-only/post gating of any
  // kind before this, unlike web's `chat-shell.tsx`. `can_post` already folds
  // in `is_read_only` for posting; `isReadOnly` is read separately to pick
  // which of the two disabled hints applies (read-only-without-permission vs.
  // the alumni restriction — the two cases `spec/ui/design-system/writing.md`
  // § Chat documents), and it is load-bearing for Reply: `can_post` is true in
  // #announcements for an `announcements:post` holder, yet nobody replies
  // there (`channelAllowsReplies`, #2775). `selectPostCapability` parses the payload defensively
  // the same way `selectChannels` does — `GET /v1/channels/{id}` infers as
  // `never` in the generated SDK.
  const channelQuery = useChannel(channelId ?? "");
  const { isReadOnly: channelIsReadOnly, canPost: channelCanPost } = useMemo(
    () => selectPostCapability(channelQuery.data),
    [channelQuery.data],
  );

  const {
    messages,
    isLoading,
    loadError,
    reload,
    isReloading,
    hasOlder,
    isLoadingOlder,
    olderError,
    loadOlder,
    viewerId,
    canSend,
    send,
    edit,
    remove,
    react,
    unreact,
    act,
    attachments,
    addAttachment,
    removeAttachment,
    draft,
    setDraft,
    sendError,
    reactionError,
    clearReactionError,
    actionError,
    clearActionError,
    typingUsers,
    emitTyping,
    connection,
    retry,
    discard,
  } = useChatChannel(channelId);

  // `viewerId` is `null` both while `/v1/users/me` is in flight and after it
  // failed, and a row can't be drawn in either case (#2250): a row says whose
  // it is ("You" in the accent), and a null viewer reads every message as
  // someone else's. The query's own status tells the two apart, as on tasks.tsx.
  const viewerQuery = useCurrentUser();

  // One cached roster fetch per chapter names every author in the thread.
  // Resolving by `sender_id` is what makes it work for a message that arrived
  // over the live `postgres_changes` echo as well as one from the REST page — a
  // join on the message payload could only ever have covered the latter.
  const roster = useMemberDisplayNames();
  const { nameFor, refetch: refetchRoster } = roster;

  // `#name` for a channel, the other member for a DM (#2775).
  // The cached list is read, not subscribed to: the fallback must not start
  // a list fetch of its own from inside a thread.
  const queryClient = useQueryClient();
  const headerTitle = useMemo(
    () =>
      threadHeaderTitle({
        row: channelQuery.data,
        list: queryClient.getQueryData(CHANNEL_LIST_KEY),
        channelId,
        viewerId,
        names: roster.byId,
        isFetching: channelQuery.isFetching,
      }),
    [
      channelQuery.data,
      channelQuery.isFetching,
      queryClient,
      channelId,
      viewerId,
      roster.byId,
    ],
  );

  // Delete on someone else's message (#2775). The server resolves the
  // permission in the message's own chapter; this only decides whether the
  // row is likely to succeed, as web's `canManageChannel` does.
  const canManageChannel = can("channels:manage", usePermissionList());
  const canReplyHere = channelAllowsReplies({
    can_post: channelCanPost,
    is_read_only: channelIsReadOnly,
  });

  // Members a block attempt proved are not in this chapter (the API's 404
  // `Member not found`), kept per chapter because membership and blocks are.
  // That answer is the only positive evidence a sender left: a roster that
  // merely does not list someone may be stale, and the likeliest sender it
  // does not list yet is a brand-new member — exactly who Block is for.
  const chapterId = useActiveChapterId();
  const [departed, setDeparted] = useState<{
    chapterId: string | null;
    ids: ReadonlySet<string>;
  }>(() => ({ chapterId, ids: new Set() }));
  const departedIds =
    departed.chapterId === chapterId ? departed.ids : NO_DEPARTED;
  const markDeparted = useCallback(
    (userId: string) => {
      setDeparted((previous) => {
        const ids = new Set(
          previous.chapterId === chapterId ? previous.ids : [],
        );
        ids.add(userId);
        return { chapterId, ids };
      });
    },
    [chapterId],
  );

  // Whether a sender is a member: listed by the roster, known departed, or
  // unknown (`rosterMembership`). Only "known departed" withholds Block.
  const isMember = useMemo(
    () =>
      rosterMembership(
        {
          byId: roster.byId,
          isPending: roster.isPending,
          isError: roster.isError,
        },
        departedIds,
      ),
    [roster.byId, roster.isPending, roster.isError, departedIds],
  );

  // Opening a channel stamps the read cursor to server `now()`; there is no
  // mark-read-to-a-message API. Its invalidation of `["channels"]` refreshes the
  // s04 badges by prefix.
  //
  // This is a **focus** effect, not a mount effect, and it stamps on the way out
  // as well as the way in. Both halves are load-bearing:
  //
  //  - `chat-thread` is a `Tabs.Screen`, so React Navigation keeps it mounted
  //    after first focus. A mount effect keyed on `channelId` would never re-run
  //    when the member leaves to Chat and taps the same channel again, leaving
  //    its badge stuck until they visited some *other* channel.
  //  - Messages arriving over realtime while the thread is open are read as they
  //    land, but the cursor was stamped before them. Stamping again on blur
  //    covers that burst in one request, where re-stamping per message would be
  //    one POST per message.
  const requestUploadUrl = useRequestChatUploadUrl();

  const markRead = useMarkChannelRead();
  const markReadMutate = markRead.mutate;
  useFocusEffect(
    useCallback(() => {
      if (!channelId) return;
      markReadMutate(channelId);
      return () => markReadMutate(channelId);
    }, [channelId, markReadMutate]),
  );

  /**
   * Pick a photo, upload it, and stage the claim.
   *
   * `isUploading` is state rather than the mutation's own `isPending` because
   * the picker half runs before any mutation starts — the member is in the
   * system photo sheet, which is most of the wall-clock time, and an attach
   * button that stays live through it invites a second picker on top of the
   * first.
   *
   * Failures land in `attachError`, which feeds the composer hint. There is no
   * toast on this platform (chat-core's are no-ops here), so a swallowed error
   * would be completely invisible to the member.
   */
  const [isUploading, setIsUploading] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  /**
   * Re-entry guard, a ref rather than the `isUploading` state beside it.
   *
   * Same reason `sendingRef` is a ref in `use-chat-channel.ts`: two taps
   * landing in one tick both read the pre-commit state value and both open a
   * picker. On Android the second `launchImageLibraryAsync` rejects with an
   * already-in-progress error. The state flag still exists, because it is what
   * paints the spinner.
   */
  const uploadingRef = useRef(false);
  /**
   * The channel this screen is currently showing.
   *
   * `chat-thread` is a `Tabs.Screen` that React Navigation keeps mounted, so
   * `channelId` changes *in place* — the component does not remount. An upload
   * started in one channel can therefore resolve while another is on screen,
   * and the claim it produces is bound to the channel it was minted under
   * (`validateAttachmentInputs` re-checks the path prefix server-side). Staging
   * it into the wrong composer would produce a 400 the member can only escape
   * by discarding, since Retry replays the identical claim.
   */
  const attachChannelRef = useRef(channelId);
  useEffect(() => {
    attachChannelRef.current = channelId;
  }, [channelId]);

  // Attach state is per-channel, like the hook's own errors (#1431). Reset
  // inline during render rather than in an effect, matching that pattern.
  const [attachResetChannelId, setAttachResetChannelId] = useState(channelId);
  if (attachResetChannelId !== channelId) {
    setAttachResetChannelId(channelId);
    if (attachError !== null) setAttachError(null);
    // A spinner carried into the new channel would sit there disabled and
    // never clear: the in-flight upload resolves against the old channel and
    // is discarded below.
    if (isUploading) setIsUploading(false);
  }

  const handleAttach = useCallback(() => {
    // `channelId` is null until the route param resolves. The attach control
    // is already gated on `canSend`, which is false in that window, so this is
    // the belt to that braces rather than a reachable branch.
    if (uploadingRef.current || !channelId) return;
    uploadingRef.current = true;
    const forChannelId = channelId;
    setAttachError(null);
    setIsUploading(true);
    void (async () => {
      try {
        const result = await pickAndUploadPhoto(
          forChannelId,
          requestUploadUrl.mutateAsync,
        );
        // The member left this channel while the PUT was in flight. The bytes
        // are in the bucket under the old channel's prefix; abandoning the
        // claim leaves an unreferenced object (an orphan until #2197 sweeps
        // the `chat` bucket), which is the same trade the composer already
        // makes for a removed chip — and far better than staging a claim the
        // send would reject forever.
        if (attachChannelRef.current !== forChannelId) return;
        if (result.status === "attached") {
          addAttachment(result.attachment);
        } else if (result.status === "refused") {
          setAttachError(result.reason);
        }
      } finally {
        uploadingRef.current = false;
        if (attachChannelRef.current === forChannelId) setIsUploading(false);
      }
    })();
  }, [addAttachment, channelId, requestUploadUrl.mutateAsync]);

  const handleChangeText = useCallback(
    (next: string) => {
      setDraft(next);
      // The manager throttles to one broadcast per 3s, so this can ride every
      // keystroke without flooding the channel.
      emitTyping();
    },
    [setDraft, emitTyping],
  );

  // The viewer's block list, applied on top of the server's mask (#2257,
  // #2315). The server masks what it serves, but a row that arrived over the
  // live echo was never evaluated, so the thread decides per row from
  // provenance, this list and this session's clearances — see
  // `lib/chat/use-thread-block-list.ts`. Held rows are not rendered;
  // `BlockListNotice` says so.
  const { blockList, blockState, thread } = useThreadBlockList(
    messages,
    viewerId,
  );
  // A blocked member's `typing` broadcast still arrives; in a DM the indicator
  // would say they are writing to the viewer (#2496).
  const shownTypingUsers = visibleTypingUsers(
    typingUsers,
    blockState,
    viewerId,
  );

  // Inverted list wants newest first; the cache hands back oldest first.
  const inverted = useMemo(() => [...thread.rows].reverse(), [thread.rows]);
  // Where each run and each day starts (components.md §11 § Grouping), worked
  // out oldest first; `threadLayout` says why.
  const layout = useMemo(() => threadLayout(thread.rows), [thread.rows]);

  // Older history (#2772). The list is inverted, so its end is the top: reaching
  // it loads the next page, which is appended past the rows on screen and so
  // leaves them where they are. A failed read waits for Retry in the edge row
  // rather than re-firing on every scroll.
  const handleEndReached = useCallback(() => {
    if (!hasOlder || isLoadingOlder || olderError) return;
    void loadOlder();
  }, [hasOlder, isLoadingOlder, olderError, loadOlder]);
  const handleLoadOlder = useCallback(() => {
    void loadOlder();
  }, [loadOlder]);
  const historyEdge = useMemo(
    () => (
      <ThreadHistoryEdge
        hasOlder={hasOlder}
        isLoadingOlder={isLoadingOlder}
        olderError={olderError}
        onLoadOlder={handleLoadOlder}
      />
    ),
    [hasOlder, isLoadingOlder, olderError, handleLoadOlder],
  );

  // Parent lookup for reply quotes (#1727), built once per window rather
  // than scanned per row — same map web's timeline uses. Built over every
  // cached message, held and tombstoned ones included, so a reply can tell
  // "hidden by your block list" from "not loaded": `ThreadMessageRow`
  // classifies the parent and never hands a hidden one's words to the quote
  // (#2312 §1).
  const byId = useMemo(() => {
    const index = new Map<string, ChatMessage>();
    for (const message of messages) index.set(message.id, message);
    return index;
  }, [messages]);

  // A staged reply or an open edit (#2775), keyed by channel. Typing into the
  // draft still emits typing; typing into an edit does not, since nothing new
  // is on its way.
  const staging = useComposerStaging({
    channelId,
    viewerId,
    byId,
    nameFor,
    blockState,
    draft,
    setDraft: handleChangeText,
    send,
    edit,
  });
  const submitComposer = staging.submit;
  const handleSend = useCallback(() => {
    // Clear first: `attachError` sits ahead of `sendError` in the hint chain
    // below, and a stale photo-permission line would hide the one report that
    // a message never reached the outbox.
    setAttachError(null);
    submitComposer();
  }, [submitComposer]);

  const handleDelete = useCallback(
    (messageId: string) => confirmDeleteMessage(() => remove(messageId)),
    [remove],
  );

  // A reply quote's tap scrolls to its parent (`lib/chat/use-jump-to-message.ts`).
  const {
    listRef,
    jumpToMessage,
    onScrollToIndexFailed: handleScrollToIndexFailed,
  } = useJumpToMessage<FlatList<ThreadRow>>(inverted, channelId);

  const { unblock, reloadMaskedCopies } = useBlockActions();
  const handleUnblock = useCallback(
    (userId: string) => {
      confirmUnblockMember({
        name: nameFor(userId),
        run: () => unblock(userId),
      });
    },
    [nameFor, unblock],
  );

  // A stale tombstone's Reload (`refreshMaskedCopies` in `@repo/chat-core/blocks`). The tombstone
  // keeps offering it while the re-read keeps failing; the alert says a tap
  // that came back empty did not just do nothing.
  const maskedRefresh = useMaskedRefresh();
  const handleReload = useCallback(
    (userId: string) => {
      void reloadMaskedCopies(userId).then((landed) => {
        if (!landed) {
          Alert.alert(MASKED_RELOAD_FAILED_TITLE, MASKED_RELOAD_FAILED_BODY);
        }
      });
    },
    [reloadMaskedCopies],
  );

  // One sheet for the thread, retargeted per long-press — the same shape the
  // directory uses for its member sheet.
  const actionsSheetRef = useRef<MessageActionsSheetHandle>(null);
  const [actionTarget, setActionTarget] = useState<MessageActionsTarget | null>(
    null,
  );
  const openActions = useCallback(
    (message: ChatMessage) => {
      const actions = messageActionsFor(message, viewerId, {
        isMember,
        canReply: canReplyHere,
        canPost: channelCanPost,
        canManageChannel,
      });
      if (!actions.canOpen) return;
      // A sender the roster cannot vouch for most likely joined after it was
      // read. Block is offered regardless; re-reading the roster is what lets
      // the next long-press name them and say they stay in the directory.
      // TanStack dedupes onto a read already in flight.
      if (
        actions.canReport &&
        isBlockableSender(message.sender_id) &&
        isMember(message.sender_id) === null
      ) {
        refetchRoster();
      }
      setActionTarget({
        messageId: message.id,
        canReply: actions.canReply,
        canEdit: actions.canEdit,
        canDelete: actions.canDelete,
        canReport: actions.canReport,
        blockUserId: actions.canBlock ? message.sender_id : null,
        senderName: resolveAuthorName(message, nameFor),
        senderLabel: resolveAuthorLabel(message, nameFor, viewerId),
        sentAt: message.created_at,
        senderInDirectory:
          message.sender_id !== null && isMember(message.sender_id) === true,
      });
      actionsSheetRef.current?.present();
    },
    [
      canManageChannel,
      canReplyHere,
      channelCanPost,
      isMember,
      nameFor,
      refetchRoster,
      viewerId,
    ],
  );

  const renderItem = useCallback(
    ({ item }: { item: ThreadRow }) => {
      // Unreachable while the gate below withholds the list, and here so the
      // row's non-nullable `viewerId` is narrowed rather than asserted.
      if (!viewerId) return null;
      const replyParent = item.message.reply_to_id
        ? (byId.get(item.message.reply_to_id) ?? null)
        : undefined;
      const placement = layout.get(item.message.client_message_id);
      return (
        <ThreadMessageRow
          row={item}
          startsRun={placement?.startsRun ?? true}
          startsDay={placement?.startsDay ?? false}
          viewerId={viewerId}
          nameFor={nameFor}
          replyParent={replyParent}
          blockState={blockState}
          onVote={(id, actionType, payload) =>
            void act(id, actionType, payload)
          }
          onRetry={(id) => void retry(id)}
          onDiscard={(id) => void discard(id)}
          onReact={(id, emoji) => void react(id, emoji)}
          onUnreact={(id, emoji) => void unreact(id, emoji)}
          onOpenActions={openActions}
          onJumpToMessage={jumpToMessage}
          onUnblock={handleUnblock}
          maskedRefresh={maskedRefresh}
          onReload={handleReload}
        />
      );
    },
    // `nameFor` belongs here: it changes identity when the roster resolves, and
    // omitting it leaves a stale closure rendering truncated ids until some
    // other dep happens to change.
    [
      viewerId,
      nameFor,
      retry,
      discard,
      react,
      unreact,
      act,
      byId,
      layout,
      blockState,
      openActions,
      jumpToMessage,
      handleUnblock,
      maskedRefresh,
      handleReload,
    ],
  );

  const isOffline = connection === "offline";
  const { isOffline: appOffline, writeBlockedReason } = useConnection();

  const notificationPrefsQuery = useChannelNotificationPreferences();
  const setNotificationLevel = useSetChannelNotificationLevel();
  const notificationLevel = useMemo(
    () =>
      selectChannelNotificationLevel(notificationPrefsQuery.data, channelId),
    [notificationPrefsQuery.data, channelId],
  );
  const failedChannelId = setNotificationLevel.isError
    ? setNotificationLevel.variables?.channelId
    : undefined;
  // Scoped to the channel the failed write was for. Do not `reset()` when
  // `isError` flips true — that hid this alert on the channel that failed.

  // The mute trigger lives in the header, but its menu is drawn by
  // `NotificationLevelMenu` as the last child below, over the thread (#2033).
  // It hangs under the header, right-aligned with the trigger: the trigger's
  // frame is relative to the header, which spans the same width as the
  // overlay, so the header's width minus the trigger's right edge is the
  // overlay's `right`.
  const muteMenu = useNotificationLevelMenu({
    level: notificationLevel,
    disabled: !channelId,
    writeBlockedReason,
  });
  const [headerFrame, setHeaderFrame] = useState({ bottom: 0, width: 0 });
  const [muteTriggerRight, setMuteTriggerRight] = useState(0);
  // The open menu takes every tap on this screen, and the screen stays
  // mounted across a blur and a channel switch. Left open, it would come back
  // over the next channel and swallow that thread's taps.
  const closeMuteMenu = muteMenu.close;
  useFocusEffect(
    useCallback(() => {
      if (!channelId) return;
      return () => closeMuteMenu();
    }, [channelId, closeMuteMenu]),
  );

  // The image viewer (#2874) covers the whole thread and is drawn last, below.
  // It closes on a blur or a channel switch for the mute menu's reason: left
  // open, it would come back over the next channel.
  const imageViewer = useImageViewer();
  const closeImageViewer = imageViewer.close;
  useFocusEffect(
    useCallback(() => {
      if (!channelId) return;
      return () => closeImageViewer();
    }, [channelId, closeImageViewer]),
  );
  // It also closes when its message stops being drawn in full: deleted,
  // tombstoned or held by the block list, or gone from the thread. Reset
  // during render, so no frame draws an image the thread no longer shows.
  const viewedMessageId = imageViewer.target?.messageId;
  if (
    viewedMessageId &&
    !thread.rows.some(
      (row) =>
        row.message.id === viewedMessageId &&
        row.visibility === "visible" &&
        !row.message.is_deleted,
    )
  ) {
    closeImageViewer();
  }
  const imageViewerOpen = imageViewer.target !== null;

  /**
   * What the in-thread pill says, or `null` when it has nothing to add.
   *
   * `null` when the transport is live, and also when the transport is offline
   * while the global banner is already saying so — see the comment at the
   * render site.
   */
  const pillMessage =
    connection === "live"
      ? null
      : isOffline
        ? appOffline
          ? null
          : "Offline — messages will send when you reconnect"
        : connection === "polling"
          ? // Verbatim from spec/ui/resilience/message-delivery.md#receiving-messages-realtime, which declares this
            // string normative; `apps/web`'s reconnect pill carries the same
            // one. Polling is a working degraded mode, so calling it
            // "reconnecting" would report a live surface as broken.
            "Real-time updates paused. Polling for new messages."
          : "Reconnecting…";

  return (
    <SafeAreaView style={styles.safeArea} edges={["left", "right", "bottom"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        // `padding` is the correct iOS behavior; on Android the window already
        // resizes. The keyboard path only differs in how precisely the inset is
        // tracked, not in which behavior is right.
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        enabled={getKeyboardPath() === "fallback" || Platform.OS === "ios"}
        // Everything the image viewer covers, out of the accessibility tree
        // while it is open, as the mute menu's wrapper below does for the
        // menu. `KeyboardAvoidingView` hands these to the View it renders.
        collapsable={false}
        accessibilityElementsHidden={imageViewerOpen}
        importantForAccessibility={
          imageViewerOpen ? "no-hide-descendants" : "auto"
        }
      >
        {/*
          Everything the mute menu covers, out of the accessibility tree while
          the menu is up: its overlay's `accessibilityViewIsModal` is iOS-only,
          so without this TalkBack could reach the thread, and the composer's
          keyboard, under it. `collapsable={false}` keeps this one native view;
          otherwise toggling the two props re-parents the whole thread.
          spec/ui/mobile/patterns.md § Overlays.
        */}
        <View
          style={styles.flex}
          collapsable={false}
          accessibilityElementsHidden={muteMenu.visible}
          importantForAccessibility={
            muteMenu.visible ? "no-hide-descendants" : "auto"
          }
        >
          {/*
          The rewrite dropped the old screen's "Back to chat overview" link, and
          a tab-registered route gets no header back button of its own — on iOS
          that left no way out but the Chat tab. The Canvas draws a `‹` here
          (s05, canvas-screens.dc.html:163), so this is the specced affordance
          rather than a reinstated stopgap.
        */}
          <View
            style={styles.header}
            onLayout={(event) => {
              const { y, height, width } = event.nativeEvent.layout;
              setHeaderFrame({ bottom: y + height, width });
            }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back to chat"
              hitSlop={12}
              onPress={() => router.push("/")}
              style={({ pressed }) => (pressed ? styles.pressed : null)}
            >
              <Text style={styles.backChevron}>‹</Text>
            </Pressable>
            <Text
              accessibilityRole="header"
              numberOfLines={1}
              style={styles.headerTitle}
            >
              {headerTitle}
            </Text>
            {channelId ? (
              <NotificationLevelControl
                menu={muteMenu}
                onLayout={(event) => {
                  const { x, width } = event.nativeEvent.layout;
                  setMuteTriggerRight(x + width);
                }}
              />
            ) : null}
          </View>
          {channelId && failedChannelId === channelId ? (
            <Text accessibilityRole="alert" style={styles.saveError}>
              Notification level not saved
            </Text>
          ) : null}

          {/*
          Reconciled with the global banner rather than duplicating it (#998).
          The two answer different questions — this pill is the *realtime
          transport*, the banner is whether the API is reachable at all — but
          when both are saying "offline" they are one fact told twice, stacked
          on the same screen in two different sentences. So the pill yields its
          offline branch to the banner and keeps the two it alone can report.
          `polling` in particular must survive: it is a working degraded mode,
          and `spec/ui/resilience/message-delivery.md#receiving-messages-realtime` declares its string normative.
        */}
          {pillMessage ? (
            <View style={styles.connectionPill}>
              <Text style={styles.connectionText}>{pillMessage}</Text>
            </View>
          ) : null}

          {channelId ? (
            <BlockListNotice
              status={blockList.status}
              heldCount={thread.heldCount}
              onRetry={blockList.retry}
              isRetrying={blockList.isRetrying}
              isPaused={blockList.isPaused}
            />
          ) : null}

          {!channelId ? (
            <View style={styles.stateBlock}>
              <Text style={styles.stateTitle}>No channel selected</Text>
              <Text style={styles.stateBody}>
                Open a channel from Chat to see its messages.
              </Text>
            </View>
          ) : loadError ? (
            // Ahead of the identity gate, as on web (#2243): a failed read
            // must not hide behind "Loading messages…" while `/users/me` is
            // still in flight.
            // With a Retry: the channel query never refetches on its own
            // (`staleTime: Infinity`), so without one the member's only way
            // back was leaving the channel and returning.
            <View style={styles.stateBlock}>
              <ErrorState
                title="Couldn't load messages"
                body="Confirm your chapter access and retry."
                onRetry={reload}
                isRetrying={isReloading}
              />
            </View>
          ) : !viewerId && viewerQuery.isError ? (
            <View style={styles.stateBlock}>
              <ErrorState
                title="Couldn't load your account"
                body="Chat needs to know which messages are yours before it can show them."
                onRetry={() => void viewerQuery.refetch()}
                isRetrying={viewerQuery.isFetching}
              />
            </View>
          ) : isLoading || !viewerId ? (
            // An unresolved viewer is "not readable yet", the same as messages
            // still loading (#2250). Rendering rows now would paint the
            // member's own messages as incoming, then flip them when identity
            // lands; messages can arrive from cache well before `/users/me`.
            <View style={styles.stateBlock}>
              <ActivityIndicator color={tokens.color.text.muted} />
              <Text style={styles.stateBody}>Loading messages…</Text>
            </View>
          ) : thread.rows.length === 0 && thread.heldCount === 0 ? (
            // Counted after the block list, held rows included: a channel whose
            // only messages are being held is not an empty channel, and the
            // notice above is what explains the gap.
            <View style={styles.stateBlock}>
              <Text style={styles.stateTitle}>No messages yet</Text>
              <Text style={styles.stateBody}>
                Say something to start the conversation.
              </Text>
            </View>
          ) : (
            // The rows reach the image viewer through this, not through a
            // prop threaded down the row and its body.
            <ImageViewerContext.Provider value={imageViewer.open}>
              <FlatList
                ref={listRef}
                onScrollToIndexFailed={handleScrollToIndexFailed}
                data={inverted}
                renderItem={renderItem}
                // `client_message_id` is always present and is stable across the
                // optimistic → confirmed transition, which the server id is not.
                keyExtractor={(item) => item.message.client_message_id}
                inverted
                onEndReached={handleEndReached}
                onEndReachedThreshold={0.5}
                // An inverted list draws its footer at the top, above the oldest
                // loaded row.
                ListFooterComponent={historyEdge}
                contentContainerStyle={styles.listContent}
                style={styles.flex}
              />
            </ImageViewerContext.Provider>
          )}

          {shownTypingUsers.length > 0 ? (
            <Text style={styles.typing}>
              {shownTypingUsers.length === 1
                ? "Someone is typing…"
                : `${shownTypingUsers.length} people are typing…`}
            </Text>
          ) : null}

          {/*
          react/unreact and inline card actions (poll votes, #528) have no
          failed-row equivalent to render inline — chat-core's rollback of
          the optimistic state is silent — so this banner is the only report
          of a rejected reaction or vote (#999). `reactionError` takes
          priority since the two can't fire from the same tap; dismissible
          because, unlike `sendError`, there is nothing to retry or discard.
        */}
          {reactionError || actionError ? (
            <View
              style={styles.reactionErrorBanner}
              accessibilityLiveRegion="polite"
            >
              <Text style={styles.reactionErrorText}>
                {reactionError ?? actionError}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Dismiss"
                hitSlop={8}
                onPress={reactionError ? clearReactionError : clearActionError}
                style={({ pressed }) => (pressed ? styles.pressed : null)}
              >
                <Text style={styles.reactionErrorDismiss}>Dismiss</Text>
              </Pressable>
            </View>
          ) : null}

          {/*
          The composer stays enabled offline **on purpose**. `sendMessage`
          enqueues to the outbox and returns before it ever touches the network
          (`chat-client.ts` — "the row is safely queued; the reconnect flush
          will POST it"), and the runtime re-flushes on every reconnect. Gating
          the input on connectivity would make composing-while-offline
          impossible, which is the whole failure the outbox exists to prevent,
          and would contradict the banner directly above it.
        */}
          <ChatComposer
            value={staging.value}
            onChangeText={staging.onChangeText}
            onSend={handleSend}
            canSend={canSend && channelCanPost && !staging.isSavingEdit}
            context={staging.context}
            placeholder="Message"
            // A send that never reached the outbox has no failed row to show
            // (nothing was queued), so this line is the only report of it.
            //
            // The offline label is #501's "blocked **or clearly labeled**" half:
            // this surface has a queue, so it labels. `lib/connection/state.ts`
            // holds the rule for the surfaces that have to block instead.
            disabledHint={
              attachError ??
              staging.editError ??
              sendError ??
              // `canSend` first. It is false until `ctx` resolves, and
              // `ChatComposer` keys `editable` on it — so leading with the
              // offline branch promised "messages send when you reconnect" over
              // an input the member cannot type into, which is the one state
              // where nothing will be queued and nothing will send. The
              // channel-level `can_post` gate (#704) comes next, ahead of
              // offline: a channel the caller cannot post in stays not-postable
              // whether or not they're connected, so offline is not the more
              // relevant fact to lead with there.
              (!canSend
                ? "Connecting to chat…"
                : !channelCanPost
                  ? channelIsReadOnly
                    ? "This channel is read-only. Posting requires the announcements:post permission."
                    : "Alumni can read this channel but not post. Alumni may post in #alumni and direct messages."
                  : appOffline
                    ? "You're offline — messages send when you reconnect, but photos need a connection."
                    : null)
            }
            hintTone={
              sendError || attachError || staging.editError ? "error" : "muted"
            }
            // An edit changes text only, so the staged photos and the attach
            // control stand aside until it is saved or cancelled.
            attachments={staging.isEditing ? undefined : attachments}
            onAttach={staging.isEditing ? undefined : handleAttach}
            onRemoveAttachment={removeAttachment}
            isUploading={isUploading}
            // An upload is a live PUT with no outbox behind it, unlike a send —
            // so unlike the composer itself, the attach control does have to go
            // dark offline. It stays visible and states why rather than
            // disappearing.
            // Gates the control only; the member-facing reason rides the single
            // `disabledHint` above rather than competing with it for the one
            // hint slot. Two hints for one composer is how the offline case
            // ended up promising delivery for a photo that would not be sent.
            attachDisabledReason={
              !channelCanPost
                ? "You can't post in this channel."
                : appOffline
                  ? "offline"
                  : null
            }
          />
        </View>
        {/*
          Last, so it is above the header, the inverted list and the composer
          in paint order and in hit-testing (#2033). The menu used to hang off
          the header as an overflowing absolute child: it drew over the list,
          but its taps landed on the list.
        */}
        <NotificationLevelMenu
          menu={muteMenu}
          isSaving={setNotificationLevel.isPending}
          anchor={{
            top: headerFrame.bottom,
            right: Math.max(0, headerFrame.width - muteTriggerRight),
          }}
          onChange={(level) => {
            if (channelId) setNotificationLevel.mutate({ channelId, level });
          }}
        />
      </KeyboardAvoidingView>
      <MessageActionsSheet
        ref={actionsSheetRef}
        target={actionTarget}
        onSenderDeparted={markDeparted}
        onReply={staging.startReply}
        onEdit={staging.startEdit}
        onDelete={handleDelete}
      />
      {/*
        Last, so it is above the header, the thread, the composer and the mute
        menu in paint order and in hit-testing (#2033). The actions sheet
        before it draws through the app's sheet provider, not here.
      */}
      <ImageViewer viewer={imageViewer} />
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
    // No gap and no side padding: each row carries its own (16pt sides, 16
    // above a run and 2 above a follow-on), because the compact layout's
    // spacing is what tells one run from the next (components.md §11).
    listContent: {
      paddingVertical: tokens.spacing.sm,
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
    backChevron: {
      ...typeRole(tokens.typography.role.title),
      color: tokens.color.gold.askText,
      minWidth: tokens.spacing.md,
    },
    headerTitle: {
      flex: 1,
      ...typeRole(tokens.typography.role.title),
      color: tokens.color.text.foreground,
    },
    saveError: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructive,
      paddingHorizontal: tokens.spacing.lg,
      paddingVertical: tokens.spacing.sm,
    },
    pressed: {
      opacity: 0.6,
    },
    connectionPill: {
      paddingHorizontal: tokens.spacing.lg,
      paddingVertical: tokens.spacing.sm,
      backgroundColor: tokens.color.surface.surface1,
      borderBottomWidth: 1,
      borderBottomColor: tokens.color.border.hairline,
    },
    connectionText: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
      textAlign: "center",
    },
    typing: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: tokens.spacing.xs,
    },
    reactionErrorBanner: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: tokens.spacing.md,
      paddingHorizontal: tokens.spacing.lg,
      paddingVertical: tokens.spacing.sm,
      backgroundColor: tokens.color.surface.surface1,
      borderTopWidth: 1,
      borderTopColor: tokens.color.border.hairline,
    },
    reactionErrorText: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructive,
      flex: 1,
    },
    reactionErrorDismiss: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    stateBlock: {
      flex: 1,
      gap: tokens.spacing.sm,
      alignItems: "center",
      justifyContent: "center",
      padding: tokens.spacing.xl,
    },
    stateTitle: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    stateBody: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
      textAlign: "center",
    },
  });
}
