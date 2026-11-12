import { useCallback, useState } from "react";
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
import { useChatRuntime } from "./use-chat-runtime";

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
  /** Why the last reaction or card action didn't land, or `null`. */
  rowError: string | null;
}

/**
 * The writes an open thread's rows make (#4297, slice 5), web's
 * `ThreadRowWrites` (#4034) on the phone: every one names its target, so the
 * parent's write patches the channel's cache and a reply's patches this
 * thread's (`messageCacheKey` in `@repo/chat-core/types`), where the thread
 * screen reads it.
 *
 * Its own hook rather than `useChatChannel`'s writes, because that hook
 * subscribes the channel's realtime topic: the channel under this screen
 * already holds it, and a second subscriber on one topic is what
 * `realtime-resilience` rule 1 is about. This only dispatches, through the
 * same chat-core actions and the same runtime `ctx`.
 */
export function useThreadRowWrites({
  channelId,
  rootId,
  parentHeld,
  refreshRoot,
}: ThreadRowWritesInput): ThreadRowWrites {
  const { ctx } = useChatRuntime();
  const [rowError, setRowError] = useState<string | null>(null);

  const targetOf = useCallback(
    (messageId: string) => (messageId === rootId ? null : rootId),
    [rootId],
  );
  // Settled, not sent: a read in the same tick could land before the write
  // commits. A failed write left the parent as it was.
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

  const onRowError = useCallback(
    (input: { title: string; description?: string }) =>
      setRowError(input.description ?? input.title),
    [],
  );

  const react = useCallback(
    async (messageId: string, emoji: string) => {
      if (!ctx) return;
      setRowError(null);
      await settle(
        messageId,
        reactAction(
          { ...ctx, onError: onRowError },
          { channelId, messageId, emoji, threadRootId: targetOf(messageId) },
        ),
      );
    },
    [ctx, channelId, targetOf, settle, onRowError],
  );

  const unreact = useCallback(
    async (messageId: string, emoji: string) => {
      if (!ctx) return;
      setRowError(null);
      await settle(
        messageId,
        unreactAction(
          { ...ctx, onError: onRowError },
          { channelId, messageId, emoji, threadRootId: targetOf(messageId) },
        ),
      );
    },
    [ctx, channelId, targetOf, settle, onRowError],
  );

  const act = useCallback(
    async (
      messageId: string,
      actionType: string,
      payload?: Record<string, unknown>,
    ) => {
      if (!ctx) return;
      setRowError(null);
      await settle(
        messageId,
        actOnCard(
          { ...ctx, onError: onRowError },
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
    [ctx, channelId, targetOf, settle, onRowError],
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

  return { react, unreact, act, edit, remove, closePoll, rowError };
}
