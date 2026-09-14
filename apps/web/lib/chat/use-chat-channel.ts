"use client";

/**
 * Component-facing facade for a single chat channel.
 *
 * This hook is the **only** thing chat UI components touch. It hides the
 * normalized cache, the supabase singleton, the realtime manager, and the
 * outbox so components stay dumb (arrays + callbacks).
 */

import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useFrappClient } from "@repo/hooks";
import { getRealtimeClient } from "@/lib/realtime/supabase-realtime";
import { useChannelDraft } from "./use-channel-draft";
import { useFrappUser } from "@/lib/auth/use-frapp-user";
import { useToast } from "@/hooks/use-toast";
import { asArray } from "@/lib/utils";
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
  mergePersistedRecorded,
  react as reactAction,
  retryOutboxRow,
  sendMessage,
  unreact as unreactAction,
  type ToastFn,
} from "@repo/chat-core/chat-client";
import { browserKeyValueStore, type OutboxAttachment } from "@repo/chat-core/adapters";
import type { ReplayRequest } from "@repo/chat-core/types";
import {
  dispatchSlashCommand,
  retryPointsDispatch,
  type DispatchResult,
  type ResolveMember,
} from "@repo/chat-core/dispatch";
import type { SlashCommand } from "@repo/chat-integrations";
import { createDexieOutboxStore, getOutboxRow } from "./offline-queue";
import { useChatOutboundScope } from "./chat-scope";
import { usePersistedChannelTail } from "./use-first-chunk-cache";

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
  /**
   * Replay an `unconfirmed` heavy-command row under its ORIGINAL idempotency
   * key (#1733) — not an outbox retry. `retry`/`discard` above operate on the
   * Dexie outbox, which heavy commands deliberately bypass
   * (`chat-client.ts`), so neither can reach one of these rows.
   *
   * Returns the dispatcher's `DispatchResult` for the same reason
   * `dispatchSlash` does: the caller toasts the outcome.
   */
  retryUnconfirmed: (replay: ReplayRequest) => Promise<DispatchResult>;
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

  /*
    Whose queue this channel reads and writes (#2226). The store is bound to the
    scope rather than being the module const it used to be, so every outbox
    operation this hook reaches — enqueue, retry, discard, the per-channel
    hydrate — can only address rows written by the signed-in member in the
    active chapter.
  */
  const scope = useChatOutboundScope();
  const outbox = useMemo(() => createDexieOutboxStore(scope), [scope]);

  const ctx = useMemo(
    () => ({
      queryClient,
      apiClient,
      supabase,
      userId,
      toast,
      track: track ?? undefined,
      outbox,
      kv: browserKeyValueStore,
    }),
    [queryClient, apiClient, supabase, userId, toast, track, outbox],
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
      const rows = asArray<RawChatMessage>(data);
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
      // Always re-merge recorded notices, even before `userId` resolves.
      // Notices carry their own sender id; gating on the queryFn closure's
      // `userId` let an in-flight first fetch (key does not include userId)
      // overwrite a later hydrate with a REST-only snapshot (#1789).
      cache = mergePersistedRecorded(cache, {
        channelId,
        userId: userId ?? undefined,
        kv: browserKeyValueStore,
      });
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

  /*
    Draft persistence lives in its own hook (#2176).

    It was inline here until the composer shell needed it to survive a channel
    that does not exist yet, which turned four lines of `useState` into a small
    state machine with an ordering hazard in it — and this hook takes eight
    dependencies, so nothing in that machine could be tested without standing up
    all eight. `use-channel-draft.ts` owns it and `use-channel-draft.spec.ts`
    tests it directly.
  */
  const { draft, setDraft, cancelPendingSave, clearAfterSend } =
    useChannelDraft(channelId);

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
      cancelPendingSave();
      await sendMessage(ctx, {
        channelId,
        content: content.trim(),
        replyToId: opts?.replyToId ?? null,
        attachments: opts?.attachments ?? null,
      });
      await clearAfterSend();
    },
    [cancelPendingSave, clearAfterSend, channelId, ctx],
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
      if (!scope) return;
      const row = await getOutboxRow(scope, clientMessageId);
      if (!row) return;
      await retryOutboxRow(ctx, row);
    },
    [ctx, scope],
  );

  const discard = useCallback(
    async (clientMessageId: string) => {
      if (!scope) return;
      const row = await getOutboxRow(scope, clientMessageId);
      if (!row) return;
      await discardOutboxRow(ctx, row);
    },
    [ctx, scope],
  );

  const retryUnconfirmed = useCallback(
    async (replay: ReplayRequest) => retryPointsDispatch(ctx, replay),
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

  /*
    Keep this channel's tail on disk so the next cold load paints it (`1s`'s
    "first chunk"). Driven off `dataUpdatedAt` rather than the message array so
    a realtime merge — which is a `setQueryData`, and so bumps that timestamp —
    refreshes the cache the same way the initial backfill does.
  */
  usePersistedChannelTail(channelId, messages, query.dataUpdatedAt);

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
    retryUnconfirmed,
    dispatchSlash,
    act,
  };
}
