import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatBackground } from "@/components/chat/chat-background";
import {
  Alert,
  FlatList,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import { useQueryClient } from "@tanstack/react-query";
import { useIsFocused, useRouter } from "expo-router";
import {
  MASKED_RELOAD_FAILED_BODY,
  MASKED_RELOAD_FAILED_TITLE,
} from "@repo/chat-core/block-copy";
import {
  applyBlockList,
  isBlockableSender,
  visibleTypingUsers,
  withForwardedMasked,
  type BlockState,
  type ThreadRow,
} from "@repo/chat-core/blocks";
import { forwardTargetOf } from "@/lib/chat/forward";
import {
  channelAllowsThreadReplies,
  copyableText,
  departedIn,
  messageActionsFor,
  noDepartedMembers,
  rosterMembership,
  withDeparted,
  type DepartedMembers,
} from "@repo/chat-core/message-actions";
import { typingLabel } from "@repo/chat-core/typing-label";
import type { ChatMessage } from "@repo/chat-core/types";
import type { ClosableCardKind } from "@repo/chat-core/chat-client";
import {
  CHANNEL_LIST_KEY,
  resolveAuthorAvatar,
  gifToSend,
  resolveAuthorLabel,
  resolveAuthorName,
  useActiveChapterId,
  useAuthorAvatars,
  useBlockedUserIds,
  useChannel,
  useChapterRoster,
  useGifAvailability,
  useMemberDisplayNames,
  useMentionRoles,
  usePermissionList,
  useRosterCatchUp,
  useViewerUserId,
  type GifResult,
} from "@repo/hooks";
import { can } from "@repo/validation";
import { useReportOpenChatTransport } from "@repo/hooks/open-chat-transport";
import { SignetTokens } from "@repo/theme/signet";
import {
  ASK_COPY,
  CHAT_CATCH_UP_COPY,
  CHAT_CATCH_UP_MIN_MESSAGES,
  CHAT_CATCH_UP_OFFER_AT,
  chatCatchUpThreadOfferLine,
  replyAskRefusal,
  spacedMentionNames,
  type AskAccess,
  type ChatCatchUpPoint,
} from "@repo/validation";
import { CatchUpStrip, useCatchUp } from "@/components/chat/catch-up-sheet";
import { useAiSurfaces } from "@/lib/ai/availability";
import type { SendOptions } from "@/lib/chat/use-chat-channel";
import { useJumpToImportant } from "@/lib/chat/use-jump-to-important";
import { useJumpToMessage } from "@/lib/chat/use-jump-to-message";
import { ChatComposer } from "@/components/chat/chat-composer";
import { GifPickerSheet } from "@/components/chat/gif-picker-sheet";
import {
  MessageActionsSheet,
  type MessageActionsSheetHandle,
  type MessageActionsTarget,
} from "@/components/chat/message-actions-sheet";
import { groupReactions } from "@/components/chat/message-item";
import { ThreadMessageRow } from "@/components/chat/thread-message-row";
import { ThreadSkeleton } from "@/components/chat/thread-skeleton";
import { BackGlyph, CloseGlyph } from "@/components/control-glyphs";
import { IconButton } from "@/components/icon-button";
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
  isDirectChannel,
  selectPostCapability,
  threadChannel,
  threadTitleFor,
} from "@/lib/chat/channel-list";
import { confirmClosePoll } from "@/lib/chat/confirm-close-poll";
import { confirmCloseCard } from "@/lib/chat/confirm-close-card";
import {
  FormFillContext,
  FormFillPage,
  useFormFillHost,
} from "./form-fill-page";
import { confirmDeleteMessage } from "@/lib/chat/confirm-delete-message";
import { useMaskedRefresh } from "@/lib/chat/masked-refresh";
import { threadHeaderLines } from "@/lib/chat/thread-header";
import { threadLayout } from "@/lib/chat/thread-layout";
import { useComposerStaging } from "@/lib/chat/use-composer-staging";
import {
  useHeldChannelMessage,
  useMessageThread,
} from "@/lib/chat/use-message-thread";
import { useThreadRowWrites } from "@/lib/chat/use-thread-row-writes";
import { selectionHaptic } from "@/lib/haptics";
import { useSaveMessage } from "@/lib/chat/save-message";
import { useConnection } from "@/lib/connection/use-connection";
import { goBackTo } from "@/lib/href";
import { KeyboardAvoidingArea } from "@/lib/keyboard";
import { typeRole, useFrappTheme } from "@/lib/theme";

/** The typing line's line height, as s05's (`chat-thread.tsx`) says why. */
const TYPING_LINE_HEIGHT = 16;
/** Holds the typing line's place when nobody types: a line box, no glyphs. */
const TYPING_LINE_BLANK = " ";

const NO_IDS: ReadonlySet<string> = new Set();
/** The parent's placement: a run and a row of its own, no day line. */
const ROOT_PLACEMENT = { startsRun: true, endsRun: true, startsDay: false };

/** The thread composer's line while offline: a reply has no outbox. */
export const THREAD_OFFLINE_HINT =
  "You're offline. You can reply once you're back online.";
/** The thread composer's line where the viewer can't reply. */
export const THREAD_NO_REPLY_HINT = "You can't reply in this channel.";

export interface MessageThreadScreenProps {
  channelId: string;
  rootId: string;
  /**
   * A reply to open the thread on: the one a summary's line rests on
   * (#3946). Scrolled to once, when the replies are on screen.
   */
  focusMessageId?: string | null;
}

/**
 * A message thread, pushed over its channel (#3785,
 * `spec/behavior/chat/README.md` § Message threads): the parent at the top,
 * an "N replies" divider, the replies, Follow / Following, and a
 * "Reply in thread…" composer, with who is typing named over it.
 *
 * Opened from the parent's chip, the long-press sheet's Start thread, or a
 * thread reply's push or inbox row (`openNotificationTarget`, which stacks the
 * channel first, #4054), as
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
 * The parent and the replies are full rows (#4297, slice 5), as web's panel's
 * are since #4034: the timeline's own row (`ThreadMessageRow`), so cards,
 * reactions, quotes and tombstones draw as they do in the channel, and a
 * long-press opens the same actions sheet. Every write names its target
 * (`useThreadRowWrites`), so a reply's lands in this thread's cache. The sheet
 * offers what web's thread rows do: react, copy, Edit, Delete, Report and
 * Block; not Reply, Start thread, Mention or Important, which belong to the
 * channel's timeline.
 */
export function MessageThreadScreen({
  channelId,
  rootId,
  focusMessageId = null,
}: MessageThreadScreenProps) {
  const { tokens } = useFrappTheme();
  const brand = useChapterBranding();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const router = useRouter();
  const below = useScreenBelow();
  const queryClient = useQueryClient();

  const roster = useMemberDisplayNames();
  const {
    nameFor,
    typistLabelFor,
    roleColorFor,
    avatarFor: memberAvatarFor,
    refetch: refetchRoster,
  } = roster;

  const channelQuery = useChannel(channelId);
  const postCapability = useMemo(
    () => selectPostCapability(channelQuery.data),
    [channelQuery.data],
  );
  const canReply = channelAllowsThreadReplies({
    can_post: postCapability.canPost,
    is_read_only: postCapability.isReadOnly,
  });
  // Delete on someone else's message, as the channel offers it (#2775).
  const canManageChannel = can("channels:manage", usePermissionList());

  // `users.id`, the column `sender_id` references (`use-chat-runtime.ts`).
  const viewerId = useViewerUserId();
  const thread = useMessageThread(channelId, rootId, viewerId);
  // The parent as the channel under this screen holds it, live through the
  // channel's realtime; the thread's own read while it doesn't, as web's.
  const heldRoot = useHeldChannelMessage(channelId, rootId);
  const root = heldRoot ?? thread.root;
  // The message the parent quotes, as the channel holds it: the parent's own
  // quote draws it as the channel does, rather than "not loaded".
  const rootQuoted = useHeldChannelMessage(
    channelId,
    root?.reply_to_id ?? null,
  );
  const writes = useThreadRowWrites({
    channelId,
    rootId,
    parentHeld: !!heldRoot,
    refreshRoot: thread.refreshRoot,
  });

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
    if (!root) return null;
    // Its own card would repeat the divider below it.
    const parent: ChatMessage = { ...root, thread: null };
    return applyBlockList([parent], blockState, viewerId).rows[0] ?? null;
  }, [root, blockState, viewerId]);
  // Named by the parent's words over who wrote it and where (#4297).
  const header = threadHeaderLines({
    root: rootRow,
    viewerId,
    nameFor,
    channelTitle,
    blockState,
  });
  const rows = useMemo(
    () => applyBlockList(thread.messages, blockState, viewerId).rows,
    [thread.messages, blockState, viewerId],
  );
  // Newest at the bottom: the list is inverted, as s05's is.
  const layout = useMemo(() => threadLayout(rows), [rows]);

  const typing = typingLabel(
    visibleTypingUsers(thread.typingUsers, blockState, viewerId),
    typistLabelFor,
  );
  // A typist, replier or parent's author the roster doesn't hold yet is named
  // once it's re-read (#4493). The channel screen isn't mounted under this
  // one, so the parent is asked after here too.
  const namedRows = useMemo(
    () => (root ? [root, ...thread.messages] : thread.messages),
    [root, thread.messages],
  );
  useRosterCatchUp(thread.typingUsers, namedRows);

  // The app-wide pill says the transport while this screen is up, as s05
  // does while it is (`spec/ui/resilience/connection-state.md` § One indicator).
  const focused = useIsFocused();
  useReportOpenChatTransport(focused ? thread.connection : null);

  // Every message the screen draws, by id: the parent and the replies, for
  // the sheet and an edit. (A thread reply can't quote, so the only quote
  // here is the parent's, looked up in the channel's cache below.)
  const byId = useMemo(() => {
    const index = new Map<string, ChatMessage>();
    if (root) index.set(root.id, root);
    for (const message of thread.messages) index.set(message.id, message);
    return index;
  }, [root, thread.messages]);
  const shown = useMemo(() => [...byId.values()], [byId]);

  // Each row's photo, as the channel resolves it (`resolveAuthorAvatar`).
  const importedAvatars = useAuthorAvatars(channelId, shown);
  const avatarFor = useCallback(
    (message: ChatMessage) =>
      resolveAuthorAvatar(message, memberAvatarFor, importedAvatars.data),
    [memberAvatarFor, importedAvatars.data],
  );

  // A form card's page (#3926 step 3), over the thread as it is over the
  // channel (`useFormFillHost`): handed the card's live row, the parent or a
  // reply, and closed on a blur or when that row is deleted or held by the
  // block list.
  const hostRows = useMemo(
    () => (rootRow ? [rootRow, ...rows] : rows),
    [rootRow, rows],
  );
  const { state: formFill, message: filledRow } = useFormFillHost(
    hostRows,
    channelId,
  );
  const formFillOpen = formFill.messageId !== null;

  const { writeBlockedReason } = useConnection();
  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const { send, sendGif, retry, emitTyping } = thread;
  // `@Frapp` in a reply (#4713), for a member with Ask. Frapp answers in the
  // channel, for the asker alone, and a thread has no place to draw that. So
  // the reply is refused, not posted: a member who expects a private answer
  // must not find their question in the thread for everyone. Read as the
  // channel's composer reads it, with the chapter's spaced names, so
  // `@Jordan Frapp` is that member and not the handle.
  //
  // While it is not yet known whether this member has Ask, such a reply is
  // held with a line saying so, for the same reason.
  const surfaces = useAiSurfaces();
  const askAccess: AskAccess = surfaces.ask
    ? "yes"
    : surfaces.askAccess === "unknown"
      ? "unknown"
      : "no";
  const mentionRoster = useChapterRoster().data;
  const mentionRoles = useMentionRoles().data;
  const askRefusal = useMemo(() => {
    if (askAccess === "no") return null;
    const names = spacedMentionNames(
      mentionRoster ?? [],
      (mentionRoles ?? []).map((role) => role.name),
    );
    return (text: string) => replyAskRefusal(text, names, askAccess);
  }, [askAccess, mentionRoster, mentionRoles]);
  // The thread's send is optimistic: the row is in the list at once and a
  // failure stays there with Retry and Delete (rule 6), the line over the
  // composer saying why. So the composer clears on the tap.
  const sendReply = useCallback(
    (content: string, options?: SendOptions) => {
      const body = content.trim();
      if (!body) return Promise.resolve(false);
      const refusal = askRefusal?.(body) ?? null;
      if (refusal !== null) {
        // The words stay in the composer, to be moved to the channel.
        setSendError(refusal);
        return Promise.resolve(false);
      }
      setDraft("");
      setSendError(null);
      void send(body, undefined, options?.mentionPicks ?? undefined).then(
        ({ error }) => setSendError(error),
      );
      return Promise.resolve(true);
    },
    [send, askRefusal],
  );
  // A thread reply carries no files or cards, so the thread's + is the GIF
  // picker itself rather than the channel's sheet with one row in it
  // (#4657). A GIF is its own reply: the typed draft stays.
  const gifs = useGifAvailability();
  const gifSheetRef = useRef<BottomSheetModal>(null);
  const openGif = useCallback(() => {
    Keyboard.dismiss();
    gifSheetRef.current?.present();
  }, []);
  const pickGif = useCallback(
    (gif: GifResult) => {
      setSendError(null);
      void sendGif(gifToSend(gif, gifs.provider)).then(({ error }) =>
        setSendError(error),
      );
    },
    [sendGif, gifs.provider],
  );
  const { edit } = writes;
  // Edit opens in this composer, as it does in the channel's: the same strip,
  // the same unchanged-save and empty-save rules (`useComposerStaging`).
  const staging = useComposerStaging({
    channelId,
    viewerId,
    byId,
    nameFor,
    blockState,
    draft,
    setDraft,
    hasAttachments: false,
    send: sendReply,
    sendInFlight: () => false,
    edit,
  });
  const { onChangeText: stagingChangeText, isEditing } = staging;
  const onChangeText = useCallback(
    (next: string) => {
      stagingChangeText(next);
      // The refusal above is about the words as they were.
      setSendError((error) =>
        error === ASK_COPY.not_in_reply || error === ASK_COPY.ask_unknown
          ? null
          : error,
      );
      if (next.trim() && !isEditing) emitTyping();
    },
    [stagingChangeText, isEditing, emitTyping],
  );
  const onRetry = useCallback(
    (clientMessageId: string) => {
      setSendError(null);
      void retry(clientMessageId).then(({ error }) => setSendError(error));
    },
    [retry],
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

  const inverted = useMemo(() => [...rows].reverse(), [rows]);
  // A line of a summary opens its reply (#3946), paging earlier replies for
  // it when it isn't loaded, as the channel's jump does. The parent is not a
  // row: it heads the list, so its line scrolls to the top.
  const { listRef, jumpToMessage, onScrollToIndexFailed } = useJumpToMessage<
    FlatList<ThreadRow>
  >(inverted, rootId);
  const { jumpToImportant: jumpToReply } = useJumpToImportant({
    rows: inverted,
    resetKey: rootId,
    hasOlder: thread.hasOlder,
    isLoadingOlder: thread.isLoadingOlder,
    olderError: olderError !== null,
    loadOlder: onLoadOlder,
    jumpToMessage,
  });
  const openPoint = useCallback(
    (point: ChatCatchUpPoint) => {
      if (point.message_id === rootId) {
        listRef.current?.scrollToEnd({ animated: true });
        return;
      }
      jumpToReply(point.message_id);
    },
    [rootId, listRef, jumpToReply],
  );
  const listReady = !thread.isLoading && !!rootRow && !!viewerId;
  const focusedOn = useRef<string | null>(null);
  useEffect(() => {
    if (!listReady || !focusMessageId || focusedOn.current === focusMessageId) {
      return;
    }
    focusedOn.current = focusMessageId;
    if (focusMessageId !== rootId) jumpToReply(focusMessageId);
  }, [listReady, focusMessageId, rootId, jumpToReply]);

  // Catch me up on this thread (#3946), on the channel's terms: the server,
  // the president's switches and `ai:use` (`useAiSurfaces`), and never a DM,
  // a group DM or the audit log.
  const canCatchUp =
    useAiSurfaces().catchUp &&
    !!openChannel &&
    !isDirectChannel(openChannel.channel) &&
    !postCapability.isAuditLog;
  const catchUp = useCatchUp({ channelId, nameFor, onOpenPoint: openPoint });
  const startCatchUp = catchUp.start;
  const summarizeThread = useCallback(() => {
    startCatchUp({
      kind: "thread",
      channelId,
      channelName: openChannel?.channel.name ?? null,
      rootId,
    });
  }, [startCatchUp, channelId, openChannel, rootId]);
  const [offerDismissed, setOfferDismissed] = useState(false);

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

  // A stale tombstone's Reload, as the channel's (`refreshMaskedCopies`), and
  // the thread read again. That re-read is a backfill of newer replies and
  // the parent: a masked reply already held stays masked until the thread's
  // cache is dropped, on web too (#4451).
  const maskedRefresh = useMaskedRefresh();
  const { reloadMaskedCopies } = useBlockActions();
  const onReload = useCallback(
    (userId: string) => {
      void reloadMaskedCopies(userId).then((landed) => {
        retryLoad();
        if (!landed) {
          Alert.alert(MASKED_RELOAD_FAILED_TITLE, MASKED_RELOAD_FAILED_BODY);
        }
      });
    },
    [reloadMaskedCopies, retryLoad],
  );

  // A reaction chip's tap and the sheet's quick row tick once, here where the
  // member acted, as the channel's do.
  const { react, unreact, act, remove, closePoll, closeCard } = writes;
  const onReact = useCallback(
    (messageId: string, emoji: string) => {
      selectionHaptic();
      void react(messageId, emoji);
    },
    [react],
  );
  const onUnreact = useCallback(
    (messageId: string, emoji: string) => {
      selectionHaptic();
      void unreact(messageId, emoji);
    },
    [unreact],
  );
  const onVote = useCallback(
    (messageId: string, actionType: string, payload: Record<string, unknown>) =>
      void act(messageId, actionType, payload),
    [act],
  );
  const onClosePoll = useCallback(
    (messageId: string) => confirmClosePoll(() => closePoll(messageId)),
    [closePoll],
  );
  const onCloseCard = useCallback(
    (messageId: string, kind: ClosableCardKind) =>
      confirmCloseCard(kind, () => closeCard(messageId, kind)),
    [closeCard],
  );
  const onDelete = useCallback(
    (messageId: string) => confirmDeleteMessage(() => remove(messageId)),
    [remove],
  );

  // A quote's tap scrolls to the message it quotes when the thread holds it.
  const onJumpToMessage = useCallback(
    (messageId: string) => {
      if (messageId === rootId) {
        listRef.current?.scrollToEnd({ animated: true });
        return;
      }
      // Through the hook, so a reply outside the rendered window is reached
      // by its one retry, and an earlier jump's target can't be replayed.
      jumpToMessage(messageId);
    },
    [rootId, listRef, jumpToMessage],
  );

  // Members a block attempt proved are not in this chapter, as the channel
  // keeps them (`DepartedMembers`): only "known departed" withholds Block.
  const chapterId = useActiveChapterId();
  const [departed, setDeparted] = useState<DepartedMembers>(() =>
    noDepartedMembers(chapterId),
  );
  const departedIds = departedIn(departed, chapterId);
  const markDeparted = useCallback(
    (userId: string) =>
      setDeparted((previous) => withDeparted(previous, chapterId, userId)),
    [chapterId],
  );
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

  // One sheet, retargeted per long-press, as the channel's.
  const actionsSheetRef = useRef<MessageActionsSheetHandle>(null);
  const [actionTarget, setActionTarget] = useState<Omit<
    MessageActionsTarget,
    "reactedWith"
  > | null>(null);
  const openActions = useCallback(
    (message: ChatMessage) => {
      const actions = messageActionsFor(message, viewerId, {
        isMember,
        canReply: false,
        // The parent's Edit authorizes as a post, a reply's as a thread reply
        // (`ChatService.editMessage`), as web's panel gates them.
        canPost: message.id === rootId ? postCapability.canPost : canReply,
        canManageChannel,
      });
      if (!actions.canOpen) return;
      // As the channel's: a sender the roster can't vouch for most likely
      // joined after it was read.
      if (
        actions.canReport &&
        isBlockableSender(message.sender_id) &&
        isMember(message.sender_id) === null
      ) {
        refetchRoster();
      }
      setActionTarget({
        messageId: message.id,
        // As the channel's: a forward's copy only where the list clears it.
        copyText: copyableText(
          withForwardedMasked(message, blockState, viewerId),
        ),
        canReply: false,
        canStartThread: false,
        forward: forwardTargetOf(
          message,
          actions.canForward,
          blockState,
          viewerId,
        ),
        canEdit: actions.canEdit,
        canMention: false,
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
      viewerId,
      blockState,
      isMember,
      rootId,
      postCapability.canPost,
      canReply,
      canManageChannel,
      refetchRoster,
      nameFor,
    ],
  );
  // Save message on the root and on replies (#3723), as web's thread panel
  // offers it. Pin stays on the channel's sheet: no client pins a reply.
  const { savedIds, setSaved } = useSaveMessage();
  // The viewer's reactions on the sheet's message, and whether it is saved,
  // read live, as the channel's sheet reads them.
  const sheetTarget = useMemo<MessageActionsTarget | null>(() => {
    if (!actionTarget) return null;
    const current = byId.get(actionTarget.messageId);
    const groups = current && viewerId ? groupReactions(current, viewerId) : [];
    return {
      ...actionTarget,
      reactedWith: groups.filter((group) => group.mine).map((g) => g.emoji),
      messageEmojis: groups.map((group) => group.emoji),
      save: { saved: savedIds.has(actionTarget.messageId) },
    };
  }, [actionTarget, byId, viewerId, savedIds]);
  // Deleted, or gone, while its sheet is open: the sheet closes, as the
  // channel's does.
  const sheetMessageGone = actionTarget
    ? (byId.get(actionTarget.messageId)?.is_deleted ?? true)
    : false;
  useEffect(() => {
    if (sheetMessageGone) actionsSheetRef.current?.dismiss();
  }, [sheetMessageGone]);

  const renderRow = useCallback(
    (
      row: ThreadRow,
      placement: { startsRun: boolean; endsRun: boolean; startsDay: boolean },
    ) => {
      if (!viewerId) return null;
      const quotedId = row.message.reply_to_id;
      const replyParent = quotedId
        ? (byId.get(quotedId) ??
          (rootQuoted?.id === quotedId ? rootQuoted : null))
        : undefined;
      return (
        <ThreadMessageRow
          row={row}
          startsRun={placement.startsRun}
          endsRun={placement.endsRun}
          startsDay={placement.startsDay}
          viewerId={viewerId}
          nameFor={nameFor}
          roleColorFor={roleColorFor}
          avatarFor={avatarFor}
          replyParent={replyParent}
          blockState={blockState}
          onVote={onVote}
          onClosePoll={onClosePoll}
          onCloseCard={onCloseCard}
          onRetry={onRetry}
          onDiscard={thread.discard}
          onReact={onReact}
          onUnreact={onUnreact}
          onOpenActions={openActions}
          onJumpToMessage={onJumpToMessage}
          onUnblock={onUnblock}
          maskedRefresh={maskedRefresh}
          onReload={onReload}
          memberAvatarFor={memberAvatarFor}
        />
      );
    },
    [
      viewerId,
      byId,
      rootQuoted,
      nameFor,
      roleColorFor,
      avatarFor,
      blockState,
      onVote,
      onClosePoll,
      onCloseCard,
      onRetry,
      thread.discard,
      onReact,
      onUnreact,
      openActions,
      onJumpToMessage,
      onUnblock,
      maskedRefresh,
      onReload,
      memberAvatarFor,
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
  const canSummarize =
    canCatchUp && replyCount + 1 >= CHAT_CATCH_UP_MIN_MESSAGES;
  // A long thread opens at its newest reply, a screen or more below the
  // divider's action, so it is offered under the header too.
  // Drawn at the top of the inverted list: the parent, then the divider.
  const head = rootRow ? (
    <View>
      {renderRow(rootRow, ROOT_PLACEMENT)}
      <View style={styles.divider} accessibilityRole="header">
        <Text style={styles.dividerText}>
          {replyCount === 1 ? "1 reply" : `${replyCount} replies`}
        </Text>
        <View style={styles.dividerRule} />
        {/* Only for a thread long enough to be worth shortening. */}
        {canSummarize ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={CHAT_CATCH_UP_COPY.thread_action}
            hitSlop={12}
            onPress={summarizeThread}
            style={({ pressed }) => (pressed ? styles.pressed : null)}
          >
            <Text style={[styles.dividerAction, { color: brand.accent }]}>
              {CHAT_CATCH_UP_COPY.thread_action}
            </Text>
          </Pressable>
        ) : null}
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
        ref={listRef}
        onScrollToIndexFailed={onScrollToIndexFailed}
        data={inverted}
        inverted
        keyExtractor={(row) => row.message.client_message_id}
        renderItem={({ item }) =>
          renderRow(
            item,
            layout.get(item.message.client_message_id) ?? ROOT_PLACEMENT,
          )
        }
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
      {/* As s05's: rises by the keyboard less the bottom inset (#4010). The
          form page covers it, so it leaves the accessibility tree while the
          page is up (`spec/ui/mobile/patterns.md` § Overlays). */}
      <FormFillContext.Provider value={formFill.open}>
        <KeyboardAvoidingArea
          style={styles.flex}
          atScreenBottom
          collapsable={false}
          accessibilityElementsHidden={formFillOpen}
          importantForAccessibility={
            formFillOpen ? "no-hide-descendants" : "auto"
          }
        >
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
                {header.title}
              </Text>
              <Text numberOfLines={1} style={styles.headerChannel}>
                {header.subtitle}
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

          {catchUp.waiting ? (
            <CatchUpStrip
              line={CHAT_CATCH_UP_COPY.resume_line}
              action={CHAT_CATCH_UP_COPY.resume_action}
              onAction={catchUp.resume}
              onDismiss={catchUp.drop}
            />
          ) : canSummarize &&
            !catchUp.active &&
            !offerDismissed &&
            replyCount >= CHAT_CATCH_UP_OFFER_AT ? (
            <CatchUpStrip
              line={chatCatchUpThreadOfferLine(replyCount)}
              action={CHAT_CATCH_UP_COPY.thread_action}
              onAction={() => {
                setOfferDismissed(true);
                summarizeThread();
              }}
              onDismiss={() => setOfferDismissed(true)}
            />
          ) : null}

          <View style={styles.flex}>
            {/* The channel's chat background (#3973), as behind its list. */}
            <ChatBackground channelId={channelId} />
            {body}
          </View>

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
          {/* The channel's banner, for the channel's reason: a refused reaction
            or vote rolls back silently, so this is its only report (#999).
            Dismissible, as nothing is left to retry. */}
          {writes.reactionError || writes.actionError ? (
            <View
              style={styles.rowErrorBanner}
              accessibilityLiveRegion="polite"
            >
              <Text style={styles.rowErrorText}>
                {writes.reactionError ?? writes.actionError}
              </Text>
              <IconButton
                label="Dismiss"
                onPress={
                  writes.reactionError
                    ? writes.clearReactionError
                    : writes.clearActionError
                }
              >
                <CloseGlyph color={tokens.color.text.mutedForeground} />
              </IconButton>
            </View>
          ) : null}
          <ChatComposer
            value={staging.value}
            onChangeText={onChangeText}
            onSend={staging.submit}
            onPickMember={staging.addMentionPick}
            // Search needs the network, and the + isn't offered while editing.
            onOpenPlus={
              gifs.available && !staging.isEditing ? openGif : undefined
            }
            plusLabel="Send a GIF"
            plusDisabled={!!writeBlockedReason || !canReply}
            canSend={
              !!viewerId &&
              !writeBlockedReason &&
              // The composer keys its input's `editable` on this, so an emptied
              // edit stays typeable; it greys Save out itself, and the hint says
              // why (`useComposerStaging`).
              (staging.isEditing ? !staging.isSavingEdit : canReply)
            }
            placeholder={
              staging.isEditing ? "Edit message" : "Reply in thread…"
            }
            context={staging.context}
            disabledHint={
              staging.isEditing
                ? writeBlockedReason
                  ? THREAD_OFFLINE_HINT
                  : staging.editError
                : !canReply
                  ? THREAD_NO_REPLY_HINT
                  : writeBlockedReason
                    ? THREAD_OFFLINE_HINT
                    : sendError
            }
            hintTone={
              !writeBlockedReason &&
              (staging.isEditing
                ? !!staging.editError
                : canReply && !!sendError)
                ? "error"
                : "muted"
            }
          />
        </KeyboardAvoidingArea>
      </FormFillContext.Provider>
      {catchUp.sheets}
      {gifs.available ? (
        <GifPickerSheet
          key={`gif-${channelId}-${rootId}`}
          ref={gifSheetRef}
          provider={gifs.provider}
          onPick={pickGif}
        />
      ) : null}
      <MessageActionsSheet
        ref={actionsSheetRef}
        target={sheetTarget}
        nameFor={nameFor}
        viewerId={viewerId}
        onSenderDeparted={markDeparted}
        onEdit={staging.startEdit}
        onDelete={onDelete}
        onReact={onReact}
        onUnreact={onUnreact}
        onSetSaved={setSaved}
      />
      <FormFillPage state={formFill} message={filledRow} nameFor={nameFor} />
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
    dividerAction: {
      ...typeRole(tokens.typography.role.caption),
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
    rowErrorBanner: {
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
    rowErrorText: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructive,
      flex: 1,
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
