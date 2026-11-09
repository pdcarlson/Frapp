import { describeLoadFailure } from "@repo/hooks/error-copy";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useFocusEffect,
  useIsFocused,
  useLocalSearchParams,
  useRouter,
} from "expo-router";
import { useScreenBelow } from "@/lib/back-target";
import { goBackTo } from "@/lib/href";
import {
  Alert,
  FlatList,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
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
  otherMemberId,
  resolveAuthorAvatar,
  resolveAuthorLabel,
  resolveAuthorName,
  useActiveChapterId,
  useAuthorAvatars,
  useChannel,
  useChapterRoster,
  useMentionRoles,
  useChannelNotificationPreferences,
  useCurrentUser,
  claimViewedChannel,
  useMarkChannelRead,
  useMemberDisplayNames,
  usePermissionList,
  useRequestChatUploadUrl,
  useSetChannelNotificationLevel,
} from "@repo/hooks";
import { can, draftWithMention } from "@repo/validation";
import { SignetTokens } from "@repo/theme/signet";
import { BlockListNotice } from "@/components/chat/block-list-notice";
import { ChatComposer } from "@/components/chat/chat-composer";
import { NewPollSheet } from "@/components/chat/new-poll-sheet";
import { canCreatePoll } from "@/lib/chat/new-poll";
import { usePollsGate } from "@/lib/chat/use-polls-gate";
import {
  ImageViewer,
  ImageViewerContext,
  useImageViewer,
} from "@/components/chat/image-viewer";
import { JumpToLatestButton } from "@/components/chat/jump-to-latest-button";
import {
  MessageActionsSheet,
  type MessageActionsSheetHandle,
  type MessageActionsTarget,
} from "@/components/chat/message-actions-sheet";
import { groupReactions } from "@/components/chat/message-item";
import {
  NotificationLevelControl,
  NotificationLevelMenu,
  selectChannelNotificationLevel,
  useNotificationLevelMenu,
} from "@/components/chat/notification-level-control";
import { ThreadHistoryEdge } from "@/components/chat/thread-history-edge";
import { ThreadMessageRow } from "@/components/chat/thread-message-row";
import { MentionChipTargetsContext } from "@repo/hooks/mention-chips";
import { ThreadSkeleton } from "@/components/chat/thread-skeleton";
import { threadLayout } from "@/lib/chat/thread-layout";
import { ErrorState } from "@/components/state-block";
import { BackGlyph, CloseGlyph } from "@/components/control-glyphs";
import { IconButton } from "@/components/icon-button";
import {
  CHAT_PHOTO_LIMIT,
  pickChatPhotos,
  uploadChatPhoto,
} from "@/lib/chat/attachment-upload";
import {
  confirmUnblockMember,
  useBlockActions,
} from "@/lib/chat/block-actions";
import {
  copyableText,
  messageActionsFor,
  departedIn,
  noDepartedMembers,
  rosterMembership,
  withDeparted,
  type DepartedMembers,
} from "@repo/chat-core/message-actions";
import { useMaskedRefresh } from "@/lib/chat/masked-refresh";
import { useChatChannel } from "@/lib/chat/use-chat-channel";
import { writeLastChannel } from "@/lib/chat/last-channel";
import { useThreadBlockList } from "@/lib/chat/use-thread-block-list";
import {
  postRefusalHint,
  selectPostCapability,
  isDirectChannel,
  THREAD_HEADER_FALLBACK,
  threadChannel,
  threadTitleFor,
} from "@/lib/chat/channel-list";
import { ChannelStart } from "@/components/chat/channel-start";
import {
  ChannelMemberSheet,
  ChannelMembersButton,
} from "@/components/chat/channel-member-sheet";
import { MemberDetailSheet } from "@/components/directory/member-detail-sheet";
import { confirmClosePoll } from "@/lib/chat/confirm-close-poll";
import { confirmDeleteMessage } from "@/lib/chat/confirm-delete-message";
import { useComposerStaging } from "@/lib/chat/use-composer-staging";
import {
  FOLLOW_ARRIVALS_WITHIN,
  useJumpToLatest,
  type LatestRow,
} from "@/lib/chat/use-jump-to-latest";
import { useJumpToMessage } from "@/lib/chat/use-jump-to-message";
import { KeyboardAvoidingArea } from "@/lib/keyboard";
import { useConnection } from "@/lib/connection/use-connection";
import { useReportOpenChatTransport } from "@repo/hooks/open-chat-transport";
import { selectionHaptic } from "@/lib/haptics";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { useChapterBranding } from "@/lib/chapter-branding";

/** One object for the list's life: the native prop is diffed by identity. */
const MAINTAIN_POSITION = {
  minIndexForVisible: 0,
  // `useJumpToLatest` watches the same line: past it an arrival is unseen.
  autoscrollToTopThreshold: FOLLOW_ARRIVALS_WITHIN,
} as const;

/**
 * The typing line's line height. A caption has none of its own, so this gives
 * the caption and the blank that holds its place one line box. The slot takes
 * its height from that Text, not from this number: React Native scales a
 * Text's fontSize and lineHeight with the system text size (Dynamic Type,
 * Android font scale), and a fixed slot height would not, so a large-text
 * caption spilled onto the composer (iOS) or was cut off (Android).
 */
const TYPING_LINE_HEIGHT = 16;

/** Holds the typing line's place when nobody types: a line box, no glyphs. */
const TYPING_LINE_BLANK = "\u00a0";

/**
 * s05 — Chat thread.
 *
 * **This screen deliberately does not use `ScreenShell`.** The shell wraps its
 * children in a `ScrollView` (`components/screen-shell.tsx`), and a
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
 * Keyboard: `KeyboardAvoidingArea` from `lib/keyboard.tsx`, which picks the
 * avoiding view per platform and keyboard path. On Android the window does not
 * resize for the keyboard while the app-wide `KeyboardProvider` is active, so
 * the composer has to be moved up from here (#3346), and a screen must never
 * import the native package directly (ESLint `no-restricted-imports`).
 */
export default function ChatThreadScreen() {
  const { tokens } = useFrappTheme();
  const brand = useChapterBranding();
  const styles = createStyles(tokens);
  const router = useRouter();
  const below = useScreenBelow();

  // Params arrive as `string | string[]`; a repeated query key would otherwise
  // silently produce an array where a channel id is expected.
  const params = useLocalSearchParams<{
    channelId?: string | string[];
    landing?: string | string[];
  }>();
  const channelId = useMemo(() => {
    const raw = params.channelId;
    const value = Array.isArray(raw) ? raw[0] : raw;
    return typeof value === "string" && value.length > 0 ? value : null;
  }, [params.channelId]);
  // `landing` opens the launch jump with no slide (`app/(app)/_layout.tsx`).
  // Dropped once it has, so going back slides as from any other channel.
  const landing = params.landing !== undefined;
  useEffect(() => {
    if (landing) router.setParams({ landing: undefined });
  }, [landing, router]);

  // Channel-level metadata (#704) — mobile had no read-only/post gating of any
  // kind before this, unlike web's `chat-shell.tsx`. `can_post` already folds
  // in `is_read_only` for posting; `postRefusalHint` picks which disabled hint
  // applies (an archived Group DM, read-only-without-permission, or the alumni
  // restriction — the cases `spec/ui/design-system/writing.md` § Chat
  // documents). `isReadOnly` is also load-bearing for Reply: `can_post` is true in
  // #announcements for an `announcements:post` holder, yet nobody replies
  // there (`channelAllowsReplies`, #2775). `selectPostCapability` parses the payload defensively
  // the same way `selectChannels` does — `GET /v1/channels/{id}` infers as
  // `never` in the generated SDK.
  const channelQuery = useChannel(channelId ?? "");
  const postCapability = useMemo(
    () => selectPostCapability(channelQuery.data),
    [channelQuery.data],
  );
  const { isReadOnly: channelIsReadOnly, canPost: channelCanPost } =
    postCapability;

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
    sendInFlight,
    sendPoll,
    edit,
    remove,
    closePoll,
    react,
    unreact,
    act,
    photos,
    addPhotos,
    removePhoto,
    retryPhoto,
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
  const {
    nameFor,
    roleColorFor,
    avatarFor: memberAvatarFor,
    refetch: refetchRoster,
  } = roster;

  // `#name` for a channel, the other member for a DM (#2775).
  // The cached list is read, not subscribed to: the fallback must not start
  // a list fetch of its own from inside a thread.
  const queryClient = useQueryClient();
  // The open channel's row: the header title, its description, and the
  // channel start (`components/chat/channel-start.tsx`) all read it.
  // `isFetching` is a dependency although the resolver doesn't take it: the
  // list cache is read, not subscribed to, so a read settling is the cue to
  // look at a list that filled in meanwhile.
  const openChannel = useMemo(
    () =>
      threadChannel({
        row: channelQuery.data,
        list: queryClient.getQueryData(CHANNEL_LIST_KEY),
        channelId,
        viewerId,
        names: roster.byId,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
    [
      channelQuery.data,
      channelQuery.isFetching,
      queryClient,
      channelId,
      viewerId,
      roster.byId,
    ],
  );
  const headerTitle = threadTitleFor(openChannel, channelQuery.isFetching);
  const channelStart = useMemo(
    () =>
      openChannel ? (
        <ChannelStart
          type={openChannel.channel.type}
          channelName={openChannel.channel.name}
          displayName={openChannel.name}
          description={openChannel.channel.description}
          photoUrl={(() => {
            const memberId = otherMemberId(openChannel.channel, viewerId);
            return memberId ? memberAvatarFor(memberId) : null;
          })()}
        />
      ) : undefined,
    [openChannel, viewerId, memberAvatarFor],
  );
  const headerDescription =
    openChannel && !isDirectChannel(openChannel.channel)
      ? openChannel.channel.description
      : undefined;
  // `Message #general`, `Message Casey`, as s05 draws it. Plain `Message`
  // while the title is still blank or fell back, rather than `Message Thread`.
  const composerPlaceholder =
    headerTitle && headerTitle !== THREAD_HEADER_FALLBACK
      ? `Message ${headerTitle}`
      : "Message";

  // Delete on someone else's message (#2775). The server resolves the
  // permission in the message's own chapter; this only decides whether the
  // row is likely to succeed, as web's `canManageChannel` does.
  const permissionList = usePermissionList();
  const canManageChannel = can("channels:manage", permissionList);
  // The composer's + offers a poll to a member whose role creates them, in a
  // chapter with Polls on, in a channel they can post in (#3701). The Polls
  // read is the poll card's own (`usePollsGate`), failing closed while the
  // chapter is unread or unreadable.
  const { gate: pollsGate } = usePollsGate();
  const pollsAllowed =
    channelCanPost &&
    canCreatePoll({ permissions: permissionList, pollsGate });
  const canReplyHere = channelAllowsReplies({
    can_post: channelCanPost,
    is_read_only: channelIsReadOnly,
  });

  // Members a block attempt proved are not in this chapter (`DepartedMembers`).
  const chapterId = useActiveChapterId();
  const [departed, setDeparted] = useState<DepartedMembers>(() =>
    noDepartedMembers(chapterId),
  );
  const departedIds = departedIn(departed, chapterId);
  const markDeparted = useCallback(
    (userId: string) => {
      setDeparted((previous) => withDeparted(previous, chapterId, userId));
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
  //  - The thread stays mounted under a screen pushed over it (an event opened
  //    from a card) and while the app is in the background. A mount effect
  //    would not re-run when the member comes back to it, and a badge read
  //    meanwhile would stay stuck.
  //  - Messages arriving over realtime while the thread is open are read as they
  //    land, but the cursor was stamped before them. While the thread is focused
  //    and the app active, the activity handler bound app-wide re-stamps it once
  //    per burst (#3698, `useChatActivityHandler`, for the channel claimed
  //    below), so chat home's badge and the app badge never count what the
  //    member is reading. Stamping again on blur covers whatever that missed.
  //    Focus, not mount: this screen stays mounted under one pushed over it.
  const requestUploadUrl = useRequestChatUploadUrl();

  const markRead = useMarkChannelRead();
  const markReadMutate = markRead.mutate;
  useFocusEffect(
    useCallback(() => {
      if (!channelId) return;
      markReadMutate(channelId);
      const releaseViewed = claimViewedChannel(channelId);
      return () => {
        releaseViewed();
        markReadMutate(channelId);
      };
    }, [channelId, markReadMutate]),
  );
  // The channel the next launch opens (`lib/chat/last-channel.ts`). On focus,
  // like the read mark, for the read mark's reason.
  useFocusEffect(
    useCallback(() => {
      if (channelId && viewerId) {
        writeLastChannel(viewerId, chapterId, channelId);
      }
    }, [channelId, viewerId, chapterId]),
  );

  /**
   * Pick photos and stage them. The tray shows each one the moment the picker
   * closes; its upload runs in the background (`addPhotos` in
   * `use-chat-channel.ts`), so nothing here waits on the network.
   *
   * `isPicking` covers the system photo sheet only, so the attach control
   * cannot open a second picker on top of the first. A refused pick (photo
   * access) lands in `attachError`, which feeds the composer hint: there is no
   * toast on this platform, so a swallowed error would be invisible.
   */
  const [isPicking, setIsPicking] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  /**
   * Re-entry guard, a ref beside the state: two taps landing in one tick both
   * read the pre-commit state and both open a picker, and on Android the
   * second `launchImageLibraryAsync` rejects.
   */
  const pickingRef = useRef(false);
  /**
   * The channel this screen is currently showing. `channelId` changes in
   * place (a navigation that hands this screen new params doesn't remount it),
   * so a pick finishing after a switch must not stage into the new channel:
   * its uploads are minted under the old one, and `validateAttachmentInputs`
   * re-checks the path prefix server-side.
   */
  const attachChannelRef = useRef(channelId);
  useEffect(() => {
    attachChannelRef.current = channelId;
  }, [channelId]);

  const [attachResetChannelId, setAttachResetChannelId] = useState(channelId);
  if (attachResetChannelId !== channelId) {
    setAttachResetChannelId(channelId);
    if (attachError !== null) setAttachError(null);
    if (isPicking) setIsPicking(false);
  }

  const photoRoom = CHAT_PHOTO_LIMIT - photos.length;
  const handleAttach = useCallback(() => {
    if (pickingRef.current || !channelId || photoRoom < 1) return;
    pickingRef.current = true;
    const forChannelId = channelId;
    setAttachError(null);
    setIsPicking(true);
    void (async () => {
      try {
        const result = await pickChatPhotos(photoRoom);
        if (attachChannelRef.current !== forChannelId) return;
        if (result.status === "picked") {
          addPhotos(
            result.photos.map((photo) => ({
              previewUri: photo.previewUri,
              width: photo.width,
              height: photo.height,
              upload: () =>
                uploadChatPhoto(
                  forChannelId,
                  photo,
                  requestUploadUrl.mutateAsync,
                ),
            })),
          );
        } else if (result.status === "refused") {
          setAttachError(result.reason);
        }
      } finally {
        pickingRef.current = false;
        if (attachChannelRef.current === forChannelId) setIsPicking(false);
      }
    })();
  }, [addPhotos, channelId, photoRoom, requestUploadUrl.mutateAsync]);

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

  // A reply quote's tap scrolls to its parent (`lib/chat/use-jump-to-message.ts`).
  const {
    listRef,
    jumpToMessage,
    onScrollToIndexFailed: handleScrollToIndexFailed,
  } = useJumpToMessage<FlatList<ThreadRow>>(inverted, channelId);
  // The way back to the newest message after reading back through history,
  // and the notice that something new landed there, judged on the rows in
  // the order the list draws them.
  const latestRows = useMemo<LatestRow[]>(
    () =>
      inverted.map(({ message, visibility }) => ({
        id: message.client_message_id,
        own:
          message._status !== "confirmed" ||
          (viewerId !== null && message.sender_id === viewerId),
        silent: visibility === "tombstone" || message.is_deleted,
      })),
    [inverted, viewerId],
  );
  const latest = useJumpToLatest({
    listRef,
    rows: latestRows,
    channelKey: channelId,
  });
  const jumpToLatest = latest.jumpToLatest;

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
        start={channelStart}
      />
    ),
    [hasOlder, isLoadingOlder, olderError, handleLoadOlder, channelStart],
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

  // Each row's avatar photo, resolved the way web's timeline does it
  // (`resolveAuthorAvatar`): a member's own profile photo from the roster, or
  // an imported author's Discord avatar, whose signed URLs one batched read
  // fetches for the distinct paths in the window. A miss draws initials.
  const importedAvatars = useAuthorAvatars(channelId ?? undefined, messages);
  const avatarFor = useCallback(
    (message: ChatMessage) =>
      resolveAuthorAvatar(message, memberAvatarFor, importedAvatars.data),
    [memberAvatarFor, importedAvatars.data],
  );

  // A new message lands at the bottom, so a member who sends from deep in
  // history is taken there on the tap to see it go: `onSending` runs once the
  // composer has decided a message goes out, before `send` is awaited, which
  // online settles only after the server answers. Waiting for that moved the
  // reader a round-trip later, wherever they had scrolled to by then, and in
  // whichever channel was on screen. Nothing runs when the send settles, so a
  // switch in between can't scroll the next channel. A send that then queues
  // nothing (the outbox write failed) has cost them a jump they asked for by
  // tapping Send, and its hint below says why nothing went. An edit, a tap
  // while an earlier send is still on its way (which `send` would refuse), and
  // an empty draft don't move them at all: an edit's message is the one they
  // were reading.
  const followSend = useCallback(
    () => jumpToLatest({ animated: false }),
    [jumpToLatest],
  );
  // Who the composer's `@` offers. The same roster read `useMemberDisplayNames`
  // makes (one query key), so it costs no second request.
  const mentionRoster = useChapterRoster();
  // The roles it offers after the members, each saying whether this member
  // may ping it (the server's rule, so a pick never lands on nobody).
  const mentionRoles = useMentionRoles();
  const mentionChipTargets = useMemo(
    () => ({
      members: mentionRoster.data,
      roleNames: mentionRoles.data?.map((role) => role.name),
    }),
    [mentionRoster.data, mentionRoles.data],
  );
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
    hasAttachments: photos.length > 0,
    send,
    sendInFlight,
    edit,
    onSending: followSend,
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

  // A poll card's Close poll (#3794), asked first like Delete.
  const handleClosePoll = useCallback(
    (messageId: string) => confirmClosePoll(() => closePoll(messageId)),
    [closePoll],
  );

  // The menu's Mention: `@Name ` at the end of the draft, the body the `@`
  // picker would have written.
  const handleMention = useCallback(
    (messageId: string) => {
      const message = byId.get(messageId);
      if (!message) return;
      const name = resolveAuthorName(message, nameFor);
      const next = name ? draftWithMention(draft, name) : null;
      if (next !== null) handleChangeText(next);
    },
    [byId, draft, handleChangeText, nameFor],
  );

  // A reaction chip's tap and the actions sheet's quick row, through the same
  // optimistic calls; a refusal lands in the reaction banner. Each tap ticks
  // once (`spec/ui/mobile/README.md` § Native-feel rules), here where the
  // member acted, so a rollback or a re-render never does.
  const handleReact = useCallback(
    (messageId: string, emoji: string) => {
      selectionHaptic();
      void react(messageId, emoji);
    },
    [react],
  );
  const handleUnreact = useCallback(
    (messageId: string, emoji: string) => {
      selectionHaptic();
      void unreact(messageId, emoji);
    },
    [unreact],
  );

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
  // Who can read the channel (#3536). A 1:1 DM has no list: its two members
  // are already the header.
  const memberSheetRef = useRef<BottomSheetModal>(null);
  const showMemberList = !!openChannel && openChannel.channel.type !== "DM";
  // The sheet closes on a blur or a channel switch, for the mute menu's
  // reason below: this screen stays mounted, and the sheet draws through the
  // app's sheet provider, so left up it would sit over the next channel (a
  // push can switch it to a 1:1 DM, which has no list) or another tab.
  useFocusEffect(
    useCallback(() => {
      if (!channelId) return;
      return () => memberSheetRef.current?.dismiss();
    }, [channelId]),
  );
  useEffect(() => {
    if (!showMemberList) memberSheetRef.current?.dismiss();
  }, [showMemberList]);
  // A member's profile, opened by tapping their name, photo or an `@` chip:
  // the directory's sheet, so a profile reads the same from every door. It
  // closes on blur for the same reason the member list does.
  const profileSheetRef = useRef<BottomSheetModal>(null);
  // The New poll sheet (#3701). Mounted per channel (keyed below), so a draft
  // kept by a swipe never posts into another channel, and closed on blur like
  // the member list.
  const pollSheetRef = useRef<BottomSheetModal>(null);
  const openPollSheet = useCallback(() => {
    Keyboard.dismiss();
    pollSheetRef.current?.present();
  }, []);
  useFocusEffect(
    useCallback(() => {
      if (!channelId) return;
      return () => pollSheetRef.current?.dismiss();
    }, [channelId]),
  );
  const [profileTarget, setProfileTarget] = useState<{ userId: string } | null>(
    null,
  );
  const openProfile = useCallback((userId: string) => {
    Keyboard.dismiss();
    setProfileTarget({ userId });
    profileSheetRef.current?.present();
  }, []);
  useFocusEffect(
    useCallback(() => {
      if (!channelId) return;
      return () => profileSheetRef.current?.dismiss();
    }, [channelId]),
  );
  const [actionTarget, setActionTarget] = useState<Omit<
    MessageActionsTarget,
    "reactedWith"
  > | null>(null);
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
        copyText: copyableText(message),
        canReply: actions.canReply,
        canEdit: actions.canEdit,
        // Someone else's message from a real member, where the viewer can
        // post: the system actor and an imported author have nobody to ping.
        canMention:
          actions.canReport &&
          channelCanPost &&
          // An open edit owns the input; a mention would land in the hidden
          // draft instead.
          !staging.isEditing &&
          isBlockableSender(message.sender_id),
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
      staging.isEditing,
      viewerId,
    ],
  );

  // The viewer's reactions on the sheet's message, read from the cache on
  // every render rather than kept from the long-press: a rollback, or a
  // reaction from their other device, can change them while the sheet is
  // open, and the quick row's selected state and which way a tap goes must
  // follow.
  const sheetTarget = useMemo<MessageActionsTarget | null>(() => {
    if (!actionTarget) return null;
    const current = byId.get(actionTarget.messageId);
    const groups = current && viewerId ? groupReactions(current, viewerId) : [];
    return {
      ...actionTarget,
      reactedWith: groups
        .filter((group) => group.mine)
        .map((group) => group.emoji),
      messageEmojis: groups.map((group) => group.emoji),
    };
  }, [actionTarget, byId, viewerId]);

  // A message deleted while its sheet is open (by its sender, a moderator, or
  // the viewer on another device) closes the sheet. A deleted message offers
  // no actions at all (`messageActionsFor`), so the sheet never opens on one,
  // and its rows would otherwise stay live: a quick reaction would be written
  // to a message whose reactions the thread no longer draws (`MessageItem`
  // drops them), and Reply or Edit would stage against `[message deleted]`.
  // Gone from the cache counts the same. The report form, if the member has
  // moved on to it, stays: what they are reporting still happened.
  const sheetMessageGone = actionTarget
    ? (byId.get(actionTarget.messageId)?.is_deleted ?? true)
    : false;
  useEffect(() => {
    if (sheetMessageGone) actionsSheetRef.current?.dismiss();
  }, [sheetMessageGone]);

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
          roleColorFor={roleColorFor}
          avatarFor={avatarFor}
          replyParent={replyParent}
          blockState={blockState}
          onVote={(id, actionType, payload) =>
            void act(id, actionType, payload)
          }
          onClosePoll={handleClosePoll}
          onRetry={(id) => void retry(id)}
          onDiscard={(id) => void discard(id)}
          onReact={handleReact}
          onUnreact={handleUnreact}
          onOpenActions={openActions}
          onJumpToMessage={jumpToMessage}
          onOpenProfile={openProfile}
          onUnblock={handleUnblock}
          maskedRefresh={maskedRefresh}
          onReload={handleReload}
        />
      );
    },
    // `nameFor` belongs here: it changes identity when the roster resolves, and
    // omitting it leaves a stale closure rendering truncated ids until some
    // other dep happens to change. `roleColorFor` resolves off the same read.
    [
      viewerId,
      nameFor,
      roleColorFor,
      avatarFor,
      retry,
      discard,
      handleReact,
      handleUnreact,
      act,
      handleClosePoll,
      byId,
      layout,
      blockState,
      openActions,
      openProfile,
      jumpToMessage,
      handleUnblock,
      maskedRefresh,
      handleReload,
    ],
  );

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

  // The app-wide connection pill (`components/network-banner.tsx`) says what
  // this thread's realtime transport is doing, folded with the app's own
  // connection state, so the thread draws no connection band of its own
  // (`spec/ui/resilience/connection-state.md` § One indicator).
  //
  // Only while focused: this tab screen stays mounted after the member
  // leaves it, and a hidden thread's transport must not reach the pill on
  // Events or More, where "messages you send go out when you reconnect"
  // would promise a queue that isn't there.
  const threadFocused = useIsFocused();
  useReportOpenChatTransport(channelId && threadFocused ? connection : null);

  return (
    // Every edge: the tab layout draws no navigator header (#2485), so the
    // `‹ #name` bar below is the top of the screen.
    <SafeAreaView
      style={styles.safeArea}
      edges={["top", "left", "right", "bottom"]}
    >
      <KeyboardAvoidingArea
        style={styles.flex}
        // Everything the image viewer covers, out of the accessibility tree
        // while it is open, as the mute menu's wrapper below does for the
        // menu. Either avoiding view hands these to the View it renders.
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
          The Canvas draws a `‹` here (s05, canvas-screens.dc.html:163). It is
          the drawn twin of the iOS edge swipe and Android's back, which pop
          the thread off the stack (`spec/ui/mobile/navigation.md` § Going
          back).
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
              accessibilityLabel={`Back to ${below?.title.toLowerCase() ?? "chat"}`}
              hitSlop={12}
              // Pops the thread, as the edge swipe does, to whatever opened
              // it (Chat home, a member's card, a notification), and to Chat
              // home when nothing is under it (`lib/back-target.ts`).
              onPress={() => (below ? below.goBack() : goBackTo(router, "/"))}
              style={({ pressed }) => (pressed ? styles.pressed : null)}
            >
              <BackGlyph color={brand.accent} />
            </Pressable>
            {/*
              The description sits under the name on a phone: web's one-line
              "# name • description" has no room at this width.
            */}
            <View style={styles.headerText}>
              <Text
                accessibilityRole="header"
                numberOfLines={1}
                style={styles.headerName}
              >
                {headerTitle}
              </Text>
              {headerDescription ? (
                <Text numberOfLines={1} style={styles.headerDescription}>
                  {headerDescription}
                </Text>
              ) : null}
            </View>
            {channelId && showMemberList ? (
              <ChannelMembersButton
                onPress={() => memberSheetRef.current?.present()}
              />
            ) : null}
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
            // must not hide behind the loading skeleton while `/users/me` is
            // still in flight.
            // With a Retry: the channel query never refetches on its own
            // (`staleTime: Infinity`), so without one the member's only way
            // back was leaving the channel and returning.
            <View style={styles.stateBlock}>
              <ErrorState
                title="Couldn't load messages"
                body={describeLoadFailure(loadError)}
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
            // Message-shaped, at the bottom where the rows will land (§10).
            <ThreadSkeleton />
          ) : thread.rows.length === 0 && thread.heldCount === 0 ? (
            // Counted after the block list, held rows included: a channel whose
            // only messages are being held is not an empty channel, and the
            // notice above is what explains the gap.
            // Not an empty-state card: the channel's start, at the bottom
            // where its first message will land (`writing.md` § Chat
            // (dashboard), Channel start). It scrolls, so a long description
            // on a short screen (keyboard up) stays reachable. Until the
            // channel's row is known there is no name to welcome anyone to:
            // nothing while it is still being read, then the bare
            // start-of-history caption if the read found nothing.
            <ScrollView
              style={styles.flex}
              contentContainerStyle={styles.channelStartSlot}
              keyboardShouldPersistTaps="handled"
            >
              {channelStart ??
                (channelQuery.isFetching ? null : (
                  <ThreadHistoryEdge
                    hasOlder={false}
                    isLoadingOlder={false}
                    olderError={false}
                    onLoadOlder={handleLoadOlder}
                  />
                ))}
            </ScrollView>
          ) : (
            // The rows reach the image viewer through this, not through a
            // prop threaded down the row and its body.
            <ImageViewerContext.Provider value={imageViewer.open}>
              {/* Which `@`-tokens in the rows really pinged someone. */}
              <MentionChipTargetsContext.Provider value={mentionChipTargets}>
                {/* The list and the jump control over its corner. */}
                <View style={styles.flex}>
                  <FlatList
                    // One list per channel. The screen stays mounted across a
                    // switch, so a shared list kept the last channel's scroll
                    // offset and opened a cached channel mid-history, with no
                    // jump control to say so. A fresh list opens at offset 0,
                    // the newest message.
                    key={channelId ?? undefined}
                    ref={listRef}
                    onScrollToIndexFailed={handleScrollToIndexFailed}
                    data={inverted}
                    renderItem={renderItem}
                    // `client_message_id` is always present and is stable across
                    // the optimistic → confirmed transition, which the server id
                    // is not.
                    keyExtractor={(item) => item.message.client_message_id}
                    inverted
                    // A new message is inserted at index 0, the scroll origin of
                    // an inverted list, so without this every arrival moved what
                    // a member reading back through history was reading by a
                    // row. The native scroll view keeps the first visible row
                    // where it was (iOS, and Android's Fabric scroll view in RN
                    // 0.86, which this app runs) and, within
                    // `FOLLOW_ARRIVALS_WITHIN` of the newest message, scrolls on
                    // to show the arrival instead. Older pages append at the far
                    // end, which this never touches.
                    maintainVisibleContentPosition={MAINTAIN_POSITION}
                    onScroll={latest.onScroll}
                    onLayout={latest.onLayout}
                    // A tap on a reaction, link, photo, quote or Retry acts at
                    // once with the keyboard up; React Native's default spent
                    // that tap on dismissing the keyboard. Dragging the thread
                    // puts the keyboard away, as every messenger does, and so
                    // does a tap on a plain message (`MessageRowFrame`). A tap
                    // on a card's body doesn't (#3461): the card's own
                    // long-press Pressable takes it first.
                    // `on-drag` rather than iOS's `interactive`, on both: the
                    // avoiding view under the composer follows keyboard frame
                    // events, which an interactive drag only sends at its end,
                    // so the composer would hang in mid-air while the keyboard
                    // followed the finger down.
                    keyboardShouldPersistTaps="handled"
                    keyboardDismissMode="on-drag"
                    onEndReached={handleEndReached}
                    onEndReachedThreshold={0.5}
                    // An inverted list draws its footer at the top, above the
                    // oldest loaded row.
                    ListFooterComponent={historyEdge}
                    contentContainerStyle={styles.listContent}
                    style={styles.flex}
                  />
                  {latest.showsJump ? (
                    <JumpToLatestButton
                      hasNew={latest.hasNewBelow}
                      onPress={() => jumpToLatest()}
                    />
                  ) : null}
                </View>
              </MentionChipTargetsContext.Provider>
            </ImageViewerContext.Provider>
          )}

          {/*
          Always mounted, so someone starting or stopping typing moves nothing
          above it. The caption Text is always there too: when nobody types it
          holds a non-breaking space, so the line it reserves is the caption's
          own line box, scaled with the system text size like the words it
          stands in for. Empty, it is hidden from a screen reader rather than
          read as a blank element. It is not a live region, as it never was: a
          line that changes with every keystroke pause would talk over the
          thread.
          */}
          <View
            testID="typing-line"
            style={styles.typingSlot}
            accessibilityElementsHidden={shownTypingUsers.length === 0}
            importantForAccessibility={
              shownTypingUsers.length === 0 ? "no-hide-descendants" : "auto"
            }
          >
            <Text style={styles.typing} numberOfLines={1}>
              {shownTypingUsers.length === 0
                ? TYPING_LINE_BLANK
                : shownTypingUsers.length === 1
                  ? "Someone is typing…"
                  : `${shownTypingUsers.length} people are typing…`}
            </Text>
          </View>

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
              <IconButton
                label="Dismiss"
                onPress={reactionError ? clearReactionError : clearActionError}
              >
                <CloseGlyph color={tokens.color.text.mutedForeground} />
              </IconButton>
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
            mentionCandidates={mentionRoster.data}
            avatarFor={memberAvatarFor}
            mentionRoles={mentionRoles.data}
            placeholder={composerPlaceholder}
            // A send that never reached the outbox has no failed row to show
            // (nothing was queued), so this line is the only report of it.
            //
            // Offline is not said here: #501's "clearly labeled" half is the
            // app-wide pill, whose sentence carries the queue's promise while
            // a chat is open (`spec/ui/resilience/connection-state.md` § One
            // indicator). `lib/connection/state.ts` holds the rule for the
            // surfaces that have to block instead.
            disabledHint={
              attachError ??
              staging.editError ??
              sendError ??
              // `canSend` first. It is false until `ctx` resolves, and
              // `ChatComposer` keys `editable` on it. The channel-level
              // `can_post` gate (#704) comes next.
              (!canSend
                ? "Connecting to chat…"
                : !channelCanPost
                  ? postRefusalHint(postCapability)
                  : null)
            }
            hintTone={
              sendError || attachError || staging.editError ? "error" : "muted"
            }
            // An edit changes text only, so the staged photos and the attach
            // control stand aside until it is saved or cancelled.
            photos={staging.isEditing ? undefined : photos}
            onAttach={staging.isEditing ? undefined : handleAttach}
            // A poll is its own card, so it can't ride a reply or an edit:
            // the + offers it only with nothing staged.
            onCreatePoll={
              pollsAllowed && !staging.context ? openPollSheet : undefined
            }
            attachFull={photoRoom < 1}
            onRemovePhoto={removePhoto}
            onRetryPhoto={retryPhoto}
            isPicking={isPicking}
            // An upload is a live PUT with no outbox behind it, unlike a send —
            // so unlike the composer itself, the attach control does have to go
            // dark offline. It stays visible and states why rather than
            // disappearing.
            // Gates the control only. Offline, the member-facing reason is the
            // connection pill's sentence ("Photos and files need a
            // connection."), not a composer line, so the screen says offline
            // once (`connection-state.md` § One indicator). Other reasons ride
            // the single `disabledHint` above.
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
      </KeyboardAvoidingArea>
      <ChannelMemberSheet
        ref={memberSheetRef}
        channelId={channelId ?? null}
        onOpenProfile={openProfile}
      />
      <MemberDetailSheet
        ref={profileSheetRef}
        member={profileTarget}
        // Cleared on close, which is what tells a DM request still in flight
        // that the member backed out (the sheet's stale-DM guard).
        onDismiss={() => setProfileTarget(null)}
        openChannelId={channelId ?? null}
      />
      <NewPollSheet
        key={channelId ?? "none"}
        ref={pollSheetRef}
        onPost={sendPoll}
      />
      <MessageActionsSheet
        ref={actionsSheetRef}
        target={sheetTarget}
        onSenderDeparted={markDeparted}
        onReply={staging.startReply}
        onEdit={staging.startEdit}
        onDelete={handleDelete}
        onMention={handleMention}
        onReact={handleReact}
        onUnreact={handleUnreact}
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
    headerText: {
      flex: 1,
      minWidth: 0,
    },
    headerName: {
      ...typeRole(tokens.typography.role.title),
      color: tokens.color.text.foreground,
    },
    headerDescription: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    channelStartSlot: {
      flexGrow: 1,
      justifyContent: "flex-end",
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
