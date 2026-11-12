import { useCallback, useRef, useState } from "react";
import {
  actOnCard,
  closePoll as closePollAction,
  deleteMessage,
  editMessage,
  react as reactAction,
  unreact as unreactAction,
} from "@repo/chat-core/chat-client";
import { MemberFacingError } from "@repo/hooks/error-copy";
import { withFailureMessage } from "./use-chat-channel";
import { useChatActionContext } from "./use-chat-runtime";

export interface ThreadRowWritesInput {
  channelId: string;
  rootId: string;
  /**
   * Whether the channel's cache holds the parent. While it does, the channel's
   * realtime keeps that copy current and the screen draws it; while it
   * doesn't, the parent is the thread's own read, which a write to it doesn't
   * patch, so it is read again once the write has settled.
   */
  parentHeld: boolean;
  refreshRoot: () => void;
}

export interface ThreadRowWrites {
  react: (messageId: string, emoji: string) => Promise<void>;
  unreact: (messageId: string, emoji: string) => Promise<void>;
  /** A card's action: a poll vote, an RSVP. */
  act: (
    messageId: string,
    actionType: string,
    payload?: Record<string, unknown>,
  ) => Promise<void>;
  /** Rejects with the member-facing reason, so the edit keeps its text. */
  edit: (messageId: string, content: string) => Promise<void>;
  /** Rejects with the member-facing reason, for the confirm's alert. */
  remove: (messageId: string) => Promise<void>;
  /** Rejects with the member-facing reason, for the confirm's alert. */
  closePoll: (messageId: string) => Promise<void>;
  /**
   * Why the latest reaction didn't land, or `null`; the channel's
   * `reactionError`, the same banner (`spec/ui/mobile/patterns.md` § Chat).
   */
  reactionError: string | null;
  clearReactionError: () => void;
  /** Why the latest card action (a vote, an RSVP) didn't land: `actionError`. */
  actionError: string | null;
  clearActionError: () => void;
}

/**
 * The writes an open thread's rows make (#4297, slice 5), web's
 * `ThreadRowWrites` (#4034) on the phone: every one names its target, so the
 * parent's write patches the channel's cache and a reply's patches this
 * thread's (`messageCacheKey` in `@repo/chat-core/types`), where the thread
 * screen reads it.
 *
 * Its own hook rather than `useChatChannel`'s writes, because that hook
 * subscribes the channel's realtime topic and runs the outbox flush, and the
 * channel screen under this one already does both: a second subscription on
 * the topic is what `realtime-resilience` rules 1 and 2 guard, and a second
 * flush POSTs every queued message twice. This only dispatches, through the
 * same chat-core actions and the runtime's `ctx` without its flush
 * (`useChatActionContext`). Its failures go to the channel's two sinks, kept
 * apart and guarded the same way (`reactWithErrorSink`, `actWithErrorSink`).
 */
export function useThreadRowWrites({
  channelId,
  rootId,
  parentHeld,
  refreshRoot,
}: ThreadRowWritesInput): ThreadRowWrites {
  const { ctx } = useChatActionContext();
  const [reactionError, setReactionError] = useState<string | null>(null);
  const clearReactionError = useCallback(() => setReactionError(null), []);
  const [actionError, setActionError] = useState<string | null>(null);
  const clearActionError = useCallback(() => setActionError(null), []);
  // A failure reports only while no later dispatch of its kind superseded
  // it, so a slow refusal never lands over a later success.
  const reactionGeneration = useRef(0);
  const actionGeneration = useRef(0);

  const targetOf = useCallback(
    (messageId: string) => (messageId === rootId ? null : rootId),
    [rootId],
  );
  // Settled, not sent: a read in the same tick could land before the write
  // commits. Read after a failure too, unlike web's panel: a refusal is often
  // the server knowing better (the parent deleted or closed elsewhere), and
  // the read says what it kept.
  const settle = useCallback(
    async (messageId: string, write: Promise<void>) => {
      if (messageId !== rootId || parentHeld) return write;
      try {
        await write;
      } finally {
        refreshRoot();
      }
    },
    [rootId, parentHeld, refreshRoot],
  );

  const reactionSink = useCallback(() => {
    const generation = ++reactionGeneration.current;
    setReactionError(null);
    return (input: { title: string; description?: string }) => {
      if (reactionGeneration.current === generation) {
        setReactionError(input.description ?? input.title);
      }
    };
  }, []);
  const actionSink = useCallback(() => {
    const generation = ++actionGeneration.current;
    setActionError(null);
    return (input: { title: string; description?: string }) => {
      if (actionGeneration.current === generation) {
        setActionError(input.description ?? input.title);
      }
    };
  }, []);

  const react = useCallback(
    async (messageId: string, emoji: string) => {
      if (!ctx) return;
      await settle(
        messageId,
        reactAction(
          { ...ctx, onError: reactionSink() },
          { channelId, messageId, emoji, threadRootId: targetOf(messageId) },
        ),
      );
    },
    [ctx, channelId, targetOf, settle, reactionSink],
  );

  const unreact = useCallback(
    async (messageId: string, emoji: string) => {
      if (!ctx) return;
      await settle(
        messageId,
        unreactAction(
          { ...ctx, onError: reactionSink() },
          { channelId, messageId, emoji, threadRootId: targetOf(messageId) },
        ),
      );
    },
    [ctx, channelId, targetOf, settle, reactionSink],
  );

  const act = useCallback(
    async (
      messageId: string,
      actionType: string,
      payload?: Record<string, unknown>,
    ) => {
      if (!ctx) return;
      await settle(
        messageId,
        actOnCard(
          { ...ctx, onError: actionSink() },
          {
            channelId,
            messageId,
            actionType,
            payload,
            threadRootId: targetOf(messageId),
          },
        ),
      );
    },
    [ctx, channelId, targetOf, settle, actionSink],
  );

  const edit = useCallback(
    async (messageId: string, content: string) => {
      const failure = "Couldn't edit message. Try again.";
      if (!ctx) throw new MemberFacingError(failure);
      await settle(
        messageId,
        withFailureMessage(
          (onError) =>
            editMessage(
              { ...ctx, onError },
              {
                channelId,
                messageId,
                content,
                threadRootId: targetOf(messageId),
              },
            ),
          failure,
        ),
      );
    },
    [ctx, channelId, targetOf, settle],
  );

  const remove = useCallback(
    async (messageId: string) => {
      const failure = "Couldn't delete message. Try again.";
      if (!ctx) throw new MemberFacingError(failure);
      await settle(
        messageId,
        withFailureMessage(
          (onError) =>
            deleteMessage(
              { ...ctx, onError },
              { channelId, messageId, threadRootId: targetOf(messageId) },
            ),
          failure,
        ),
      );
    },
    [ctx, channelId, targetOf, settle],
  );

  const closePoll = useCallback(
    async (messageId: string) => {
      const failure = "Couldn't close poll. Try again.";
      if (!ctx) throw new MemberFacingError(failure);
      await settle(
        messageId,
        withFailureMessage(
          (onError) =>
            closePollAction(
              { ...ctx, onError },
              { channelId, messageId, threadRootId: targetOf(messageId) },
            ),
          failure,
        ),
      );
    },
    [ctx, channelId, targetOf, settle],
  );

  return {
    react,
    unreact,
    act,
    edit,
    remove,
    closePoll,
    reactionError,
    clearReactionError,
    actionError,
    clearActionError,
  };
}
