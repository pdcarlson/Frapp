"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowLeft } from "lucide-react";
import { formatTimeOfDay } from "@repo/formatting";
import {
  classifyMessage,
  visibleTypingUsers,
  type BlockState,
} from "@repo/chat-core/blocks";
import { typingLabel } from "@repo/chat-core/typing-label";
import { TOMBSTONE_TEXT } from "@repo/chat-core/block-copy";
import type { ChatMessage } from "@repo/chat-core/types";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/lib/hooks/use-toast";
import { useNetwork } from "@/lib/providers/network-provider";
import { useMessageThread } from "@/lib/chat/use-message-thread";
import { cn, initials } from "@/lib/utils";
import { TextRenderer } from "./renderers/text-renderer";

export interface ThreadPanelProps {
  channelId: string;
  channelName: string | null;
  rootId: string;
  viewerId: string | null;
  nameFor: (userId: string) => string | null;
  blockState: BlockState;
  /** Whether the viewer may reply here (`can_post`, or a read-only channel's thread rule). */
  canReply: boolean;
  onClose: () => void;
  className?: string;
}

/**
 * A message thread (#3785, `spec/behavior/chat/README.md` § Message threads):
 * the parent at the top, a reply divider, the replies, Follow and a
 * "Reply in thread…" composer. Inside the docked chat it replaces the message
 * list and Back returns to it.
 */
export function ThreadPanel({
  channelId,
  channelName,
  rootId,
  viewerId,
  nameFor,
  blockState,
  canReply,
  onClose,
  className,
}: ThreadPanelProps) {
  const thread = useMessageThread(channelId, rootId, viewerId);
  const { toast } = useToast();
  const { isOffline } = useNetwork();
  const [draft, setDraft] = useState("");
  const listEnd = useRef<HTMLDivElement | null>(null);
  const [followBusy, setFollowBusy] = useState(false);

  // Follow the newest reply into view as replies arrive.
  const replyCount = thread.messages.length;
  // The divider's count: the thread's own while older replies are still
  // unread here, the confirmed rows once they're all held. Unsent rows never
  // count (mobile's `message-thread-screen.tsx` reads it the same way).
  const shownReplies = Math.max(
    thread.messages.filter((m) => m._status === "confirmed").length,
    thread.root?.thread?.reply_count ?? 0,
  );
  useEffect(() => {
    listEnd.current?.scrollIntoView({ block: "end" });
  }, [replyCount]);

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

  async function submit() {
    const content = draft.trim();
    if (!content) return;
    setDraft("");
    const { error } = await thread.send(content);
    if (error) {
      toast({
        title: "Reply not sent",
        description: error,
        variant: "destructive",
      });
    }
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

  return (
    <section
      aria-label="Thread"
      className={cn("flex min-h-0 flex-col bg-background", className)}
      onKeyDown={onPanelKey}
    >
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
        {thread.root ? (
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
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {thread.metaError || thread.repliesError ? (
          <div className="space-y-2 text-body">
            <p>Couldn&apos;t load this thread.</p>
            <Button variant="secondary" size="sm" onClick={thread.retryLoad}>
              Try again
            </Button>
          </div>
        ) : thread.isLoading || !thread.root ? (
          <p className="text-caption text-muted-foreground">Loading thread…</p>
        ) : (
          <>
            <ThreadRow
              message={thread.root}
              nameFor={nameFor}
              viewerId={viewerId}
              blockState={blockState}
            />
            <div
              className="my-3 flex items-center gap-2 text-caption text-muted-foreground"
              role="separator"
            >
              <span>
                {shownReplies === 1 ? "1 reply" : `${shownReplies} replies`}
              </span>
              <span className="h-px flex-1 bg-border" />
            </div>
            {thread.hasOlder ? (
              <Button
                variant="ghost"
                size="sm"
                className="mb-2"
                disabled={thread.isLoadingOlder}
                onClick={() =>
                  void thread.loadOlder().then(({ error }) => {
                    if (error) {
                      toast({
                        title: "Couldn't load earlier replies",
                        description: error,
                        variant: "destructive",
                      });
                    }
                  })
                }
              >
                {thread.isLoadingOlder ? "Loading…" : "Load earlier replies"}
              </Button>
            ) : null}
            <ol className="space-y-3">
              {thread.messages.map((message) => (
                <li key={message.client_message_id}>
                  <ThreadRow
                    message={message}
                    nameFor={nameFor}
                    viewerId={viewerId}
                    blockState={blockState}
                    onRetry={() => {
                      void thread
                        .send(message.content, message.client_message_id)
                        .then(({ error }) => {
                          if (error) {
                            toast({
                              title: "Reply not sent",
                              description: error,
                              variant: "destructive",
                            });
                          }
                        });
                    }}
                    onDiscard={() => thread.discard(message.client_message_id)}
                  />
                </li>
              ))}
            </ol>
            <div ref={listEnd} />
          </>
        )}
      </div>

      {typing ? (
        <p className="shrink-0 px-4 pb-1 text-caption text-muted-foreground">
          {typing}
        </p>
      ) : null}
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

function ThreadRow({
  message,
  nameFor,
  viewerId,
  blockState,
  onRetry,
  onDiscard,
}: {
  message: ChatMessage;
  nameFor: (userId: string) => string | null;
  viewerId: string | null;
  blockState: BlockState;
  onRetry?: () => void;
  onDiscard?: () => void;
}) {
  const visibility = classifyMessage(message, blockState, viewerId);
  // A row the block list can't vouch for yet is not drawn (`classifyMessage`'s
  // held contract); it shows once the list answers.
  if (visibility === "held") return null;
  const name =
    (message.sender_id ? nameFor(message.sender_id) : null) ??
    message.author_name ??
    "Member";
  const failed = message._status === "failed";
  const pending = message._status === "pending";
  return (
    <article className="flex gap-3">
      <Avatar className="h-8 w-8 shrink-0">
        <AvatarFallback className="text-caption">
          {initials(name)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="flex items-baseline gap-2">
          <span className="truncate text-body font-semibold">{name}</span>
          <time
            className="shrink-0 text-caption text-muted-foreground"
            dateTime={message.created_at}
          >
            {formatTimeOfDay(message.created_at)}
          </time>
        </p>
        {visibility === "visible" ? (
          <TextRenderer message={message} muted={pending || failed} />
        ) : (
          <p className="text-body italic text-muted-foreground">
            {TOMBSTONE_TEXT}
          </p>
        )}
        {failed ? (
          <p className="mt-1 flex flex-wrap items-center gap-2 text-caption text-destructive">
            <span>Not sent{message._error ? `: ${message._error}` : ""}</span>
            {onRetry ? (
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0"
                onClick={onRetry}
              >
                Retry
              </Button>
            ) : null}
            {onDiscard ? (
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0"
                onClick={onDiscard}
              >
                Delete
              </Button>
            ) : null}
          </p>
        ) : null}
      </div>
    </article>
  );
}
