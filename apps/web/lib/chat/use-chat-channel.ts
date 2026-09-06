"use client";

/**
 * Component-facing facade for a single chat channel.
 *
 * This hook is the **only** thing chat UI components touch. It hides the
 * normalized cache, the supabase singleton, the realtime manager, and the
 * outbox so components stay dumb (arrays + callbacks).
 */

import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useFrappClient } from "@repo/hooks";
import { getRealtimeClient } from "@/lib/realtime/supabase-realtime";
import { useFrappUser } from "@/lib/auth/use-frapp-user";
import { useToast } from "@/hooks/use-toast";
import { AnalyticsContext } from "@/lib/providers/analytics-provider";
import {
  chatMessagesKey,
  type ChannelCache,
  type ChatMessage,
  type RawChatMessage,
  type RawChatMessageAction,
} from "@repo/chat-core/types";
import {
  applyReactionInsert,
  emptyCache,
  mergeServerRows,
  selectMessages,
} from "@repo/chat-core/cache";
import { chatRealtime, type ConnectionStatus } from "@repo/chat-core/realtime-manager";
import {
  actOnCard,
  deleteMessage as deleteMessageAction,
  discardOutboxRow,
  editMessage as editMessageAction,
  flushOutbox,
  hydrateOutboxIntoCache,
  react as reactAction,
  retryOutboxRow,
  sendMessage,
  unreact as unreactAction,
  type ToastFn,
} from "@repo/chat-core/chat-client";
import type { OutboxAttachment } from "@repo/chat-core/adapters";
import {
  dispatchSlashCommand,
  type DispatchResult,
  type ResolveMember,
} from "@repo/chat-core/dispatch";
import type { SlashCommand } from "@repo/chat-integrations";
import {
  clearDraft,
  dexieOutboxStore,
  getOutboxRow,
  loadDraft,
  saveDraft,
} from "./offline-queue";

export interface UseChatChannelResult {
  messages: ChatMessage[];
  isLoading: boolean;
  loadError: Error | null;
  send: (
    content: string,
    opts?: { replyToId?: string | null; attachments?: OutboxAttachment[] },
  ) => Promise<void>;
  react: (messageId: string, emoji: string) => Promise<void>;
  unreact: (messageId: string, emoji: string) => Promise<void>;
  /** Own message only — enforced server-side. Rejects on failure; callers keep editing on error. */
  edit: (messageId: string, content: string) => Promise<void>;
  /** Own message, or any message with `channels:manage` (server-enforced). */
  delete: (messageId: string) => Promise<void>;
  draft: string;
  setDraft: (body: string) => void;
  typingUsers: string[];
  emitTyping: () => void;
  connection: ConnectionStatus;
  retry: (clientMessageId: string) => Promise<void>;
  discard: (clientMessageId: string) => Promise<void>;
  // Returns the dispatcher's own `DispatchResult` rather than a restated shape,
  // so a new outcome field (e.g. `warning`) reaches the composer instead of
  // being silently erased at this boundary.
  dispatchSlash: (
    command: SlashCommand,
    args: string,
    announcementsChannelId: string | null,
    resolveMember?: ResolveMember,
  ) => Promise<DispatchResult>;
  /** Card action invoker (Vote, RSVP, …). Goes through the NestJS chat actions endpoint (ADR-11). */
  act: (
    messageId: string,
    actionType: string,
    payload: Record<string, unknown>,
  ) => Promise<void>;
}

export function useChatChannel(channelId: string | null): UseChatChannelResult {
  const queryClient = useQueryClient();
  const apiClient = useFrappClient();
  const { userId } = useFrappUser();
  const { toast: rawToast } = useToast();
  const track = useContext(AnalyticsContext);
  const supabase = useMemo(() => getRealtimeClient(), []);

  const toast: ToastFn = useCallback(
    (input) =>
      rawToast({
        title: input.title,
        description: input.description,
        variant: input.variant,
      }),
    [rawToast],
  );

  const ctx = useMemo(
    // `dexieOutboxStore` is a module const, so it is not a dependency.
    () => ({
      queryClient,
      apiClient,
      supabase,
      userId,
      toast,
      track: track ?? undefined,
      outbox: dexieOutboxStore,
    }),
    [queryClient, apiClient, supabase, userId, toast, track],
  );

  // Initial load: REST backfill of the most recent messages + a single
  // batched select on `chat_message_actions` to hydrate reactions on those
  // messages so the timeline renders accurately on first paint.
  const query = useQuery<ChannelCache, Error>({
    queryKey: channelId ? chatMessagesKey(channelId) : ["chat", "none"],
    enabled: !!channelId,
    staleTime: Infinity,
    queryFn: async () => {
      if (!channelId) return emptyCache();
      const { data, error } = await apiClient.GET(
        "/v1/channels/{id}/messages",
        { params: { path: { id: channelId }, query: { limit: 50 } } },
      );
      if (error) throw error;
      const rows = Array.isArray(data) ? (data as RawChatMessage[]) : [];
      let cache = mergeServerRows(emptyCache(), rows);
      const messageIds = rows.map((row) => row.id).filter(Boolean);
      if (messageIds.length > 0) {
        const { data: actions } = await supabase
          .from("chat_message_actions")
          .select("*")
          .in("message_id", messageIds);
        if (actions) {
          // The canonical merge, not a local copy: it also appends each raw
          // row to `message.actions`, which the poll-card tallies read — a
          // local variant that skipped that step left reloaded polls at zero
          // votes until a live echo happened to re-deliver them.
          let mutated = cache;
          for (const action of actions as RawChatMessageAction[]) {
            mutated = applyReactionInsert(mutated, action);
          }
          cache = mutated;
        }
      }
      return cache;
    },
  });

  // Ref-counted subscription to the realtime manager. Cleans up when the
  // active channel changes or the component unmounts.
  useEffect(() => {
    if (!channelId) return;
    chatRealtime.subscribe(channelId);
    void hydrateOutboxIntoCache(ctx, channelId);
    return () => chatRealtime.unsubscribe(channelId);
  }, [channelId, ctx]);

  // Connection status pipe.
  const [connection, setConnection] = useState<ConnectionStatus>("live");
  useEffect(() => {
    const unsub = chatRealtime.subscribeStatus(setConnection);
    return unsub;
  }, []);

  // Typing users tick: re-read from the manager when its status pings change
  // (the manager bumps status listeners on typing membership changes too).
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  useEffect(() => {
    if (!channelId) return;
    const refresh = () =>
      setTypingUsers(chatRealtime.getTypingUsers(channelId));
    refresh();
    const unsub = chatRealtime.subscribeStatus(refresh);
    return unsub;
  }, [channelId]);

  // Draft persistence — load once per channel, debounce writes.
  const [draftState, setDraftState] = useState("");
  useEffect(() => {
    if (!channelId) return;
    let cancelled = false;
    loadDraft(channelId)
      .then((body) => {
        if (!cancelled) setDraftState(body);
      })
      .catch((err) => {
        // IndexedDB read can throw in private mode / quota issues — degrade
        // to an empty draft rather than crash the channel.
        console.warn("loadDraft failed", err);
      });
    return () => {
      cancelled = true;
    };
  }, [channelId]);
  const draft = channelId ? draftState : "";
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelDraftTimer = useCallback(() => {
    if (draftTimer.current) {
      clearTimeout(draftTimer.current);
      draftTimer.current = null;
    }
  }, []);
  const setDraft = useCallback(
    (body: string) => {
      setDraftState(body);
      if (!channelId) return;
      cancelDraftTimer();
      draftTimer.current = setTimeout(() => {
        void saveDraft(channelId, body);
      }, 400);
    },
    [channelId, cancelDraftTimer],
  );

  const send = useCallback(
    async (
      content: string,
      opts?: { replyToId?: string | null; attachments?: OutboxAttachment[] },
    ): Promise<void> => {
      // A message may be nothing but a file. Guarding on empty text alone would
      // silently drop an attachment-only send — the case the old
      // "append the filename into the body" composer could not produce, and the
      // first one a real attachment model makes possible.
      const hasAttachments = (opts?.attachments?.length ?? 0) > 0;
      if (!channelId) return;
      if (content.trim().length === 0 && !hasAttachments) return;
      // Cancel any in-flight debounced save before clearing so a stale draft
      // can't be re-persisted after the send.
      cancelDraftTimer();
      await sendMessage(ctx, {
        channelId,
        content: content.trim(),
        replyToId: opts?.replyToId ?? null,
        attachments: opts?.attachments ?? null,
      });
      setDraftState("");
      await clearDraft(channelId);
    },
    [cancelDraftTimer, channelId, ctx],
  );

  const reactCb = useCallback(
    async (messageId: string, emoji: string) => {
      if (!channelId) return;
      await reactAction(ctx, { channelId, messageId, emoji });
    },
    [channelId, ctx],
  );

  const unreactCb = useCallback(
    async (messageId: string, emoji: string) => {
      if (!channelId) return;
      await unreactAction(ctx, { channelId, messageId, emoji });
    },
    [channelId, ctx],
  );

  const editCb = useCallback(
    async (messageId: string, content: string) => {
      if (!channelId) return;
      await editMessageAction(ctx, { channelId, messageId, content });
    },
    [channelId, ctx],
  );

  const deleteCb = useCallback(
    async (messageId: string) => {
      if (!channelId) return;
      await deleteMessageAction(ctx, { channelId, messageId });
    },
    [channelId, ctx],
  );

  const emitTyping = useCallback(() => {
    if (!channelId || !userId) return;
    chatRealtime.emitTyping(channelId, userId);
  }, [channelId, userId]);

  const retry = useCallback(
    async (clientMessageId: string) => {
      const row = await getOutboxRow(clientMessageId);
      if (!row) return;
      await retryOutboxRow(ctx, row);
    },
    [ctx],
  );

  const discard = useCallback(
    async (clientMessageId: string) => {
      const row = await getOutboxRow(clientMessageId);
      if (!row) return;
      await discardOutboxRow(ctx, row);
    },
    [ctx],
  );

  const act = useCallback(
    async (
      messageId: string,
      actionType: string,
      payload: Record<string, unknown>,
    ) => {
      if (!channelId) return;
      await actOnCard(ctx, { channelId, messageId, actionType, payload });
    },
    [channelId, ctx],
  );

  const dispatchSlash = useCallback(
    async (
      command: SlashCommand,
      args: string,
      announcementsChannelId: string | null,
      resolveMember?: ResolveMember,
    ) => {
      if (!channelId) {
        return { ok: false, error: "No active channel" };
      }
      return dispatchSlashCommand(ctx, {
        command,
        args,
        channelId,
        announcementsChannelId,
        resolveMember,
      });
    },
    [channelId, ctx],
  );

  // Best-effort flush whenever the connection comes live for this channel.
  useEffect(() => {
    if (connection !== "live") return;
    void flushOutbox(ctx);
  }, [connection, ctx]);

  const messages = useMemo(() => selectMessages(query.data), [query.data]);

  return {
    messages,
    isLoading: query.isPending,
    loadError: query.error ?? null,
    send,
    react: reactCb,
    unreact: unreactCb,
    edit: editCb,
    delete: deleteCb,
    draft,
    setDraft,
    typingUsers,
    emitTyping,
    connection,
    retry,
    discard,
    dispatchSlash,
    act,
  };
}
