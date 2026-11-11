"use client";

import { useCallback, useMemo, useState, type KeyboardEvent } from "react";
import { ArrowLeft } from "lucide-react";
import {
  applyBlockList,
  classifyMessage,
  tombstoneCanUnblock,
  visibleTypingUsers,
  type BlockState,
} from "@repo/chat-core/blocks";
import { typingLabel } from "@repo/chat-core/typing-label";
import type { ChatMessage } from "@repo/chat-core/types";
import { resolveAuthorAvatar } from "@repo/hooks";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/lib/hooks/use-toast";
import { useTapRevealedMessage } from "@/lib/hooks/use-tap-revealed-message";
import { useNetwork } from "@/lib/providers/network-provider";
import { useMessageThread } from "@/lib/chat/use-message-thread";
import { cn } from "@/lib/utils";
import { PanelCloseButton } from "@/components/layout/tool-page-header";
import { BlockedMessageTombstone } from "./blocked-message-tombstone";
import { ChatBackground } from "./chat-background";
import {
  ImageViewer,
  ImageViewerProvider,
  useImageViewer,
} from "./image-viewer";
import { MessageItem } from "./message-item";
import { MessageTimeline, type MessageTimelineProps } from "./message-timeline";

/**
 * The row writes the shell's channel hook makes (`useChatChannel`), each
 * taking the thread a reply belongs to: `null` for the parent, which is a
 * channel message, and the root's id for a reply, whose row lives in the
 * thread's own cache (#4034). Delete and Close poll come already wrapped in
 * the shell's confirm.
 */
export interface ThreadRowWrites {
  react: (
    messageId: string,
    emoji: string,
    threadRootId: string | null,
  ) => Promise<void>;
  unreact: (
    messageId: string,
    emoji: string,
    threadRootId: string | null,
  ) => Promise<void>;
  /** Rejects on failure, so the row keeps its draft. */
  edit: (
    messageId: string,
    content: string,
    threadRootId: string | null,
  ) => Promise<void>;
  /** Settles once the member has answered the confirm and the write is done. */
  delete: (messageId: string, threadRootId: string | null) => Promise<void>;
  closePoll: (messageId: string, threadRootId: string | null) => Promise<void>;
  act: (
    messageId: string,
    actionType: string,
    payload: Record<string, unknown>,
    threadRootId: string | null,
  ) => Promise<void>;
}

export interface ThreadPanelProps extends Pick<
  MessageTimelineProps,
  | "nameFor"
  | "avatarFor"
  | "roleColorFor"
  | "onUnblock"
  | "onReloadMasked"
  | "maskedRefresh"
  | "bookmarkedMessageIds"
  | "onToggleBookmark"
  | "canManageChannel"
  | "onReport"
  | "onBlock"
  | "onOpenProfile"
  | "isMember"
> {
  channelId: string;
  channelName: string | null;
  rootId: string;
  viewerId: string | null;
  blockState: BlockState;
  /**
   * The parent as the open channel's cache holds it, or `null` when it is
   * outside the loaded window. Preferred over the thread read's copy, because
   * the channel's realtime keeps it current (reactions, edits, votes).
   */
  heldRoot: ChatMessage | null;
  writes: ThreadRowWrites;
  /** Whether the viewer may reply here (`can_post`, or a read-only channel's thread rule). */
  canReply: boolean;
  /**
   * Whether the viewer may post in the channel itself (`can_post`). The
   * parent's Edit authorizes as a post; a reply's as a thread reply, so it
   * follows `canReply` (`ChatService.editMessage`).
   */
  canPost: boolean;
  onClose: () => void;
  /**
   * Closes the whole chat panel (#4223): the channel header's X, which the
   * thread covers, so the thread carries its own. Only beside a tool page.
   */
  onClosePanel?: () => void;
  className?: string;
}

/**
 * A message thread (#3785, `spec/behavior/chat/README.md` § Message threads):
 * the parent at the top, a reply divider, the replies, Follow and a
 * "Reply in thread…" composer. Inside the docked chat it replaces the message
 * list and Back returns to it.
 *
 * The replies are the channel's own rows (#4034): `MessageTimeline` draws
 * them, so a reply carries everything a timeline row does (attachments,
 * cards, reactions, the edited marker, Edit and Delete, photos, a blocked
 * sender's tombstone with Unblock) in the channel's display, Bubbles and
 * Always formal included. The parent is a `MessageItem` in the timeline's
 * `header`, drawn from the first frame above whatever older replies remain
 * to page in, and it shares the list's tap-reveal state.
 */
export function ThreadPanel({
  channelId,
  channelName,
  rootId,
  viewerId,
  nameFor,
  avatarFor,
  roleColorFor,
  blockState,
  heldRoot,
  writes,
  onUnblock,
  onReloadMasked,
  maskedRefresh,
  bookmarkedMessageIds,
  onToggleBookmark,
  canManageChannel,
  onReport,
  onBlock,
  onOpenProfile,
  isMember,
  canReply,
  canPost,
  onClose,
  onClosePanel,
  className,
}: ThreadPanelProps) {
  const thread = useMessageThread(channelId, rootId, viewerId);
  const { toast } = useToast();
  const { isOffline } = useNetwork();
  const [draft, setDraft] = useState("");
  const [followBusy, setFollowBusy] = useState(false);
  const [olderError, setOlderError] = useState(false);

  // The channel's copy while it holds one: its realtime keeps the parent's
  // reactions, edits and reply count current.
  const root = heldRoot ?? thread.root;

  // The divider's count: the thread's own while older replies are still
  // unread here, the confirmed rows once they're all held. Unsent rows never
  // count (mobile's `message-thread-screen.tsx` reads it the same way).
  const shownReplies = Math.max(
    thread.messages.filter((m) => m._status === "confirmed").length,
    root?.thread?.reply_count ?? 0,
  );

  // Escape inside the panel returns to the channel, like Back, and goes no
  // further: the shell's own Escape (back to the channel list below `lg`)
  // must not also run. A reply being typed keeps it, as the composer does.
  function onPanelKey(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    if (event.nativeEvent.isComposing) return;
    const inReplyBox = event.target instanceof HTMLTextAreaElement;
    if (inReplyBox && draft.trim()) return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  }

  const typists = visibleTypingUsers(thread.typingUsers, blockState, viewerId);
  const typing = typingLabel(typists, nameFor);
  const following = thread.followState === "following";

  const notSent = useCallback(
    (error: string | null) => {
      if (!error) return;
      toast({
        title: "Reply not sent",
        description: error,
        variant: "destructive",
      });
    },
    [toast],
  );

  async function submit() {
    const content = draft.trim();
    if (!content) return;
    setDraft("");
    const { error } = await thread.send(content);
    notSent(error);
  }

  function onComposerKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      void submit();
    }
  }

  async function toggleFollow() {
    setFollowBusy(true);
    try {
      await thread.setFollow(following ? "none" : "following");
    } catch (error) {
      toast({
        title: "Couldn't change this thread",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    } finally {
      setFollowBusy(false);
    }
  }

  const { loadOlder, refreshRoot } = thread;
  const onLoadOlder = useCallback(() => {
    void loadOlder().then(({ error }) => setOlderError(!!error));
  }, [loadOlder]);

  // A write's target: the parent is a channel message, so its writes patch
  // the timeline's cache; a reply's patch this thread's cache.
  const targetOf = useCallback(
    (messageId: string) => (messageId === rootId ? null : rootId),
    [rootId],
  );
  // While the timeline doesn't hold the parent (it is outside the loaded
  // window), a write to it patches nothing the panel draws, so the parent is
  // read again once the write has settled. Settled, not sent: a read in the
  // same tick could land before the write commits. A failed write was already
  // toasted by its action, and the parent is unchanged.
  const parentUnheld = !heldRoot;
  const settle = useCallback(
    (messageId: string, write: Promise<void>) => {
      if (messageId !== rootId || !parentUnheld) return write;
      return write.then(refreshRoot, () => undefined);
    },
    [rootId, parentUnheld, refreshRoot],
  );
  const onReact = useCallback(
    (messageId: string, emoji: string) => {
      void settle(
        messageId,
        writes.react(messageId, emoji, targetOf(messageId)),
      );
    },
    [writes, targetOf, settle],
  );
  const onUnreact = useCallback(
    (messageId: string, emoji: string) => {
      void settle(
        messageId,
        writes.unreact(messageId, emoji, targetOf(messageId)),
      );
    },
    [writes, targetOf, settle],
  );
  const { edit } = writes;
  const editRow = useCallback(
    async (messageId: string, content: string) => {
      // Rejects on failure, so the row stays in edit mode with the draft.
      await edit(messageId, content, targetOf(messageId));
      if (messageId === rootId && parentUnheld) refreshRoot();
    },
    [edit, targetOf, rootId, parentUnheld, refreshRoot],
  );
  const onDelete = useCallback(
    (messageId: string) => {
      void settle(messageId, writes.delete(messageId, targetOf(messageId)));
    },
    [writes, targetOf, settle],
  );
  const onClosePoll = useCallback(
    (messageId: string) => {
      void settle(messageId, writes.closePoll(messageId, targetOf(messageId)));
    },
    [writes, targetOf, settle],
  );
  const onAct = useCallback(
    (
      messageId: string,
      actionType: string,
      payload: Record<string, unknown>,
    ) => {
      void settle(
        messageId,
        writes.act(messageId, actionType, payload, targetOf(messageId)),
      );
    },
    [writes, targetOf, settle],
  );
  const { retry, discard } = thread;
  const onRetry = useCallback(
    (clientMessageId: string) => {
      void retry(clientMessageId).then(({ error }) => notSent(error));
    },
    [retry, notSent],
  );

  // The replies as the block list leaves them; the shell's `blockState` is
  // the channel's, already settled, so this only classifies.
  const blockedReplies = useMemo(
    () => applyBlockList(thread.messages, blockState, viewerId),
    [thread.messages, blockState, viewerId],
  );
  // A quote lookup over every row the panel holds, the parent included.
  const lookup = useMemo(
    () => (root ? [root, ...thread.messages] : thread.messages),
    [root, thread.messages],
  );

  // One tap-reveal state for the parent and the replies, so tapping one row
  // closes the other's action bar (`components.md` § Per-message actions).
  // The parent's image viewer is its own: the timeline's closes on any image
  // that isn't one of its rows.
  const rootReveal = useTapRevealedMessage();
  const rootViewer = useImageViewer();
  const rootVisibility = root
    ? classifyMessage(root, blockState, viewerId)
    : "held";
  const rootStart =
    root && viewerId ? (
      <ImageViewerProvider value={rootViewer.open}>
        <div className="pb-1">
          <div role="list" aria-label="Thread parent">
            {rootVisibility === "visible" ? (
              <MessageItem
                // Its own chip would repeat the divider below it.
                message={{ ...root, thread: null }}
                viewerId={viewerId}
                blockState={blockState}
                showHeader
                nameFor={nameFor}
                avatarUrl={
                  resolveAuthorAvatar(root, avatarFor, undefined) ?? undefined
                }
                authorColor={
                  root.sender_id ? roleColorFor?.(root.sender_id) : null
                }
                onReact={onReact}
                onUnreact={onUnreact}
                onAct={onAct}
                onEdit={canPost ? editRow : undefined}
                onDelete={onDelete}
                onClosePoll={onClosePoll}
                isBookmarked={bookmarkedMessageIds?.has(root.id)}
                onToggleBookmark={onToggleBookmark}
                canManageChannel={canManageChannel}
                onReport={onReport}
                onBlock={onBlock}
                onOpenProfile={onOpenProfile}
                isMember={isMember}
                isTapRevealed={rootReveal.isRevealed(root)}
                onToggleTapReveal={() => rootReveal.toggle(root)}
              />
            ) : rootVisibility === "tombstone" ? (
              <BlockedMessageTombstone
                channelId={channelId}
                senderName={root.sender_id ? nameFor(root.sender_id) : null}
                canUnblock={tombstoneCanUnblock(root, blockState)}
                onUnblock={() => {
                  if (root.sender_id) onUnblock(root.sender_id);
                }}
                reload={
                  root.sender_id
                    ? (maskedRefresh.get(root.sender_id) ?? null)
                    : null
                }
                onReload={() => {
                  if (root.sender_id) onReloadMasked(root.sender_id);
                }}
                showHeader
              />
            ) : null}
          </div>
          <div
            className="mt-3 flex items-center gap-2 px-5 text-caption text-muted-foreground"
            role="separator"
          >
            <span>
              {shownReplies === 1 ? "1 reply" : `${shownReplies} replies`}
            </span>
            <span className="h-px flex-1 bg-border" />
          </div>
        </div>
      </ImageViewerProvider>
    ) : null;

  return (
    <section
      aria-label="Thread"
      // `isolate` + positioned: the channel's chat background (#3973) sits at
      // `-z-10` inside the panel, so a thread reads on the same background
      // as its channel while the panel still hides the timeline beneath.
      className={cn(
        "relative isolate flex min-h-0 flex-col bg-background",
        className,
      )}
      onKeyDown={onPanelKey}
    >
      <ChatBackground channelId={channelId} />
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-2">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Back to channel"
          title="Back to channel"
          onClick={onClose}
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        </Button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-body font-semibold">Thread</h2>
          {channelName ? (
            <p className="truncate text-caption text-muted-foreground">
              #{channelName}
            </p>
          ) : null}
        </div>
        {root ? (
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={following}
            disabled={followBusy}
            onClick={() => void toggleFollow()}
          >
            {following ? "Following" : "Follow"}
          </Button>
        ) : null}
        {onClosePanel ? (
          <PanelCloseButton
            label="Close chat"
            onClick={onClosePanel}
            className="mr-2"
          />
        ) : null}
      </header>

      <div className="min-h-0 flex-1 pb-2">
        <MessageTimeline
          channelId={channelId}
          messages={lookup}
          blockList={{ blockState, thread: blockedReplies }}
          onUnblock={onUnblock}
          onReloadMasked={onReloadMasked}
          maskedRefresh={maskedRefresh}
          viewerId={viewerId}
          nameFor={nameFor}
          avatarFor={avatarFor}
          roleColorFor={roleColorFor}
          isLoading={thread.isLoading || !root}
          loadError={thread.metaError ?? thread.repliesError ?? null}
          onRetryLoad={thread.retryLoad}
          hasOlder={thread.hasOlder}
          isLoadingOlder={thread.isLoadingOlder}
          olderError={olderError}
          onLoadOlder={onLoadOlder}
          // The parent heads the list from the first frame, whatever is
          // left to page in above the loaded replies.
          header={rootStart}
          tapRevealed={rootReveal}
          onReact={onReact}
          onUnreact={onUnreact}
          onRetry={onRetry}
          onDiscard={discard}
          onAct={onAct}
          onEdit={canReply ? editRow : undefined}
          onDelete={onDelete}
          onClosePoll={onClosePoll}
          bookmarkedMessageIds={bookmarkedMessageIds}
          onToggleBookmark={onToggleBookmark}
          canManageChannel={canManageChannel}
          onReport={onReport}
          onBlock={onBlock}
          onOpenProfile={onOpenProfile}
          isMember={isMember}
        />
      </div>
      <ImageViewer viewer={rootViewer} />

      {/* Always one line tall, like the channel's, so it never moves the reply box. */}
      <p
        data-testid="typing-line"
        aria-hidden={typing ? undefined : true}
        className="h-5 shrink-0 truncate px-4 text-caption leading-5 text-muted-foreground"
      >
        {typing}
      </p>
      <div className="shrink-0 border-t border-border p-3">
        {canReply ? (
          <>
            <Textarea
              aria-label="Reply in thread"
              placeholder="Reply in thread…"
              rows={2}
              value={draft}
              disabled={isOffline}
              onChange={(event) => {
                setDraft(event.target.value);
                if (event.target.value) thread.emitTyping();
              }}
              onKeyDown={onComposerKey}
            />
            {isOffline ? (
              <p className="mt-1 text-caption text-muted-foreground">
                You&apos;re offline. You can reply once you&apos;re back online.
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-caption text-muted-foreground">
            You can&apos;t reply in this channel.
          </p>
        )}
      </div>
    </section>
  );
}
