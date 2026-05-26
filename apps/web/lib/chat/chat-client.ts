"use client";

/**
 * Hot-path chat client — the single entry point for every chat WRITE.
 *
 * Plain async functions (not `useMutation`) so the same code path is callable
 * from the React composer, from imperative retry buttons, and from the Dexie
 * outbox flush loop that runs outside React after a reload.
 *
 * Each action: generate a client UUID → optimistic cache write → invoke the
 * hardened Edge Function (chat-send / chat-react) or RLS-protected delete →
 * reconcile by client UUID on success / rollback (4xx) or keep-pending (network).
 *
 * The "exactly once" property comes from one merge function — `mergeServerRow`
 * in `./cache` — being the only path that lets a server row reach the cache.
 * The Edge Function response and the Postgres Changes echo carry the same
 * `(client_message_id, id)` pair, so whichever arrives first wins and the
 * other is a no-op.
 */

import type { QueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  chatMessagesKey,
  optimisticMessage,
  reactionActionType,
  type ChannelCache,
  type ChatMessageKind,
  type RawChatMessage,
  type RawChatMessageAction,
} from "./types";
import {
  applyReactionInsert,
  emptyCache,
  markFailed,
  mergeServerRow,
  removeMessage,
  toggleReactionLocal,
  upsertOptimistic,
} from "./cache";
import {
  bumpOutboxAttempt,
  clearDraft,
  dequeueOutbox,
  enqueueOutbox,
  listOutboxForChannel,
  listQueuedOutbox,
  markOutboxFailed,
  requeueOutbox,
  type OutboxRow,
} from "./offline-queue";

export interface ToastFn {
  (input: { title: string; description?: string; variant?: "destructive" }): void;
}

export interface ChatActionContext {
  queryClient: QueryClient;
  supabase: SupabaseClient;
  /** App user id of the viewer. `null` is a hard guard: no writes without identity. */
  userId: string | null;
  toast?: ToastFn;
}

function patchCache(
  qc: QueryClient,
  channelId: string,
  updater: (cache: ChannelCache) => ChannelCache,
): void {
  qc.setQueryData<ChannelCache>(chatMessagesKey(channelId), (prev) =>
    updater(prev ?? emptyCache()),
  );
}

interface FunctionsErrorWithStatus extends Error {
  context?: { response?: { status?: number } | Response; status?: number };
  status?: number;
}

/**
 * Distinguishes terminal client errors (4xx — bad request / forbidden) from
 * transient ones (network, 5xx). 4xx → `failed` + toast; transient → keep the
 * message pending in the outbox for the reconnect flush.
 */
function classify(error: unknown): {
  terminal: boolean;
  status?: number;
  message: string;
} {
  if (!error) return { terminal: false, message: "Unknown error" };
  const e = error as FunctionsErrorWithStatus;
  let status: number | undefined =
    typeof e.status === "number" ? e.status : undefined;
  const ctx = e.context;
  if (ctx && typeof ctx === "object") {
    if ("status" in ctx && typeof ctx.status === "number") status = ctx.status;
    const resp = (ctx as { response?: Response | { status?: number } })
      .response;
    if (resp && typeof (resp as { status?: number }).status === "number") {
      status = (resp as { status?: number }).status;
    }
  }
  const message =
    typeof e.message === "string" && e.message.length > 0
      ? e.message
      : "Couldn't reach chat server";
  const terminal =
    typeof status === "number" && status >= 400 && status < 500;
  return { terminal, status, message };
}

export interface SendMessageArgs {
  channelId: string;
  content: string;
  kind?: ChatMessageKind;
  payload?: Record<string, unknown> | null;
  replyToId?: string | null;
  /** Reuse a previously-generated id (outbox flush, idempotent retry). */
  clientMessageId?: string;
}

/**
 * Optimistic send + idempotent invoke. Identity is sourced from `ctx.userId`
 * (the authenticated session) — never the client payload.
 */
export async function sendMessage(
  ctx: ChatActionContext,
  args: SendMessageArgs,
): Promise<void> {
  if (!ctx.userId) {
    ctx.toast?.({
      title: "You're signed out",
      description: "Sign back in to send messages.",
      variant: "destructive",
    });
    return;
  }
  const clientId = args.clientMessageId ?? crypto.randomUUID();
  const optimistic = optimisticMessage({
    clientMessageId: clientId,
    channelId: args.channelId,
    senderId: ctx.userId,
    content: args.content,
    kind: args.kind,
    payload: args.payload,
    replyToId: args.replyToId ?? null,
  });

  patchCache(ctx.queryClient, args.channelId, (cache) =>
    upsertOptimistic(cache, optimistic),
  );
  await clearDraft(args.channelId);

  const offline =
    typeof navigator !== "undefined" && navigator.onLine === false;
  if (offline) {
    await enqueueOutbox({
      clientId,
      channelId: args.channelId,
      body: args.content,
    });
    return;
  }

  await enqueueOutbox({
    clientId,
    channelId: args.channelId,
    body: args.content,
  });

  try {
    const { data, error } = await ctx.supabase.functions.invoke<{
      message: RawChatMessage;
      deduplicated?: boolean;
    }>("chat-send", {
      body: {
        client_message_id: clientId,
        channel_id: args.channelId,
        content: args.content,
        kind: args.kind ?? "text",
        payload: args.payload ?? undefined,
        reply_to_id: args.replyToId ?? undefined,
      },
    });
    if (error) throw error;
    if (!data?.message) {
      throw new Error("chat-send returned no message");
    }
    patchCache(ctx.queryClient, args.channelId, (cache) =>
      mergeServerRow(cache, data.message),
    );
    await dequeueOutbox(clientId);
  } catch (err) {
    const { terminal, message } = classify(err);
    if (terminal) {
      patchCache(ctx.queryClient, args.channelId, (cache) =>
        markFailed(cache, clientId, message),
      );
      await markOutboxFailed(clientId, message);
      ctx.toast?.({
        title: "Message rejected",
        description: message,
        variant: "destructive",
      });
    } else {
      await bumpOutboxAttempt(clientId, message);
    }
  }
}

/** Retry a failed/queued outbox row. Reuses the original clientId for idempotency. */
export async function retryOutboxRow(
  ctx: ChatActionContext,
  row: OutboxRow,
): Promise<void> {
  await requeueOutbox(row.clientId);
  await sendMessage(ctx, {
    channelId: row.channelId,
    content: row.body,
    clientMessageId: row.clientId,
  });
}

/** Drops a failed message from the cache and the outbox. */
export async function discardOutboxRow(
  ctx: ChatActionContext,
  row: OutboxRow,
): Promise<void> {
  patchCache(ctx.queryClient, row.channelId, (cache) =>
    removeMessage(cache, row.clientId),
  );
  await dequeueOutbox(row.clientId);
}

/**
 * Strictly sequential flush of the queued outbox (oldest first). Idempotent at
 * the server thanks to the partial unique index on `(channel_id, sender_id,
 * client_message_id)`.
 */
export async function flushOutbox(ctx: ChatActionContext): Promise<void> {
  if (!ctx.userId) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  const rows = await listQueuedOutbox();
  for (const row of rows) {
    await sendMessage(ctx, {
      channelId: row.channelId,
      content: row.body,
      clientMessageId: row.clientId,
    });
  }
}

/**
 * On boot, restore any persisted outbox rows for a channel into the cache as
 * pending/failed messages so the composer reflects unsent work after a reload.
 */
export async function hydrateOutboxIntoCache(
  ctx: ChatActionContext,
  channelId: string,
): Promise<void> {
  if (!ctx.userId) return;
  const rows = await listOutboxForChannel(channelId);
  if (rows.length === 0) return;
  patchCache(ctx.queryClient, channelId, (cache) => {
    let next = cache;
    for (const row of rows) {
      const optimistic = optimisticMessage({
        clientMessageId: row.clientId,
        channelId: row.channelId,
        senderId: ctx.userId!,
        content: row.body,
      });
      next = upsertOptimistic(next, optimistic);
      if (row.status === "failed") {
        next = markFailed(
          next,
          row.clientId,
          row.lastError ?? "Send failed",
        );
      }
    }
    return next;
  });
}

export interface ReactArgs {
  channelId: string;
  messageId: string;
  emoji: string;
}

/** Optimistic reaction add via the hardened chat-react Edge Function. */
export async function react(
  ctx: ChatActionContext,
  args: ReactArgs,
): Promise<void> {
  if (!ctx.userId) return;
  const actionType = reactionActionType(args.emoji);

  patchCache(ctx.queryClient, args.channelId, (cache) =>
    toggleReactionLocal(cache, args.messageId, actionType, ctx.userId!, true),
  );

  try {
    const { data, error } = await ctx.supabase.functions.invoke<{
      action: RawChatMessageAction;
      deduplicated?: boolean;
    }>("chat-react", {
      body: {
        message_id: args.messageId,
        action_type: actionType,
      },
    });
    if (error) throw error;
    if (data?.action) {
      patchCache(ctx.queryClient, args.channelId, (cache) =>
        applyReactionInsert(cache, data.action),
      );
    }
  } catch (err) {
    patchCache(ctx.queryClient, args.channelId, (cache) =>
      toggleReactionLocal(
        cache,
        args.messageId,
        actionType,
        ctx.userId!,
        false,
      ),
    );
    const { message } = classify(err);
    ctx.toast?.({
      title: "Couldn't react",
      description: message,
      variant: "destructive",
    });
  }
}

/**
 * Optimistic reaction remove. Reaches `chat_message_actions` directly under
 * RLS, which scopes deletes to the viewer's own rows — no Edge Function
 * change needed on top of the merged hardened set.
 */
export async function unreact(
  ctx: ChatActionContext,
  args: ReactArgs,
): Promise<void> {
  if (!ctx.userId) return;
  const actionType = reactionActionType(args.emoji);

  patchCache(ctx.queryClient, args.channelId, (cache) =>
    toggleReactionLocal(
      cache,
      args.messageId,
      actionType,
      ctx.userId!,
      false,
    ),
  );

  try {
    const { error } = await ctx.supabase
      .from("chat_message_actions")
      .delete()
      .match({
        message_id: args.messageId,
        user_id: ctx.userId,
        action_type: actionType,
      });
    if (error) throw error;
  } catch (err) {
    patchCache(ctx.queryClient, args.channelId, (cache) =>
      toggleReactionLocal(cache, args.messageId, actionType, ctx.userId!, true),
    );
    const { message } = classify(err);
    ctx.toast?.({
      title: "Couldn't remove reaction",
      description: message,
      variant: "destructive",
    });
  }
}

export interface CardActionArgs {
  channelId: string;
  messageId: string;
  actionType: string;
  payload?: Record<string, unknown>;
}

/**
 * Action plumbing for inline-card buttons (RSVP / Vote / Done …). The card
 * renderers themselves land in Chunk 05; the transport is the same hardened
 * chat-react Edge Function.
 */
export async function actOnCard(
  ctx: ChatActionContext,
  args: CardActionArgs,
): Promise<void> {
  if (!ctx.userId) return;
  try {
    const { data, error } = await ctx.supabase.functions.invoke<{
      action: RawChatMessageAction;
      deduplicated?: boolean;
    }>("chat-react", {
      body: {
        message_id: args.messageId,
        action_type: args.actionType,
        payload: args.payload ?? undefined,
      },
    });
    if (error) throw error;
    if (data?.action) {
      patchCache(ctx.queryClient, args.channelId, (cache) =>
        applyReactionInsert(cache, data.action),
      );
    }
  } catch (err) {
    const { message } = classify(err);
    ctx.toast?.({
      title: "Couldn't record action",
      description: message,
      variant: "destructive",
    });
  }
}
