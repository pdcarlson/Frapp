/**
 * Hot-path chat client — the single entry point for every chat WRITE.
 *
 * Plain async functions (not `useMutation`) so the same code path is callable
 * from the React composer, from imperative retry buttons, and from the
 * outbox flush loop that runs outside React after a reload.
 *
 * Each action: generate a client UUID → optimistic cache write → POST to the
 * NestJS chat controller (ADR-11 / #416) or RLS-protected delete → reconcile
 * by client UUID on success / rollback (4xx) or keep-pending (network).
 *
 * The "exactly once" property comes from one merge function — `mergeServerRow`
 * in `./cache` — being the only path that lets a server row reach the cache.
 * The API response and the Postgres Changes echo carry the same
 * `(client_message_id, id)` pair, so whichever arrives first wins and the
 * other is a no-op.
 */

import type { QueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { createFrappClient } from "@repo/api-sdk";
import {
  CHAT_MESSAGE_KINDS,
  chatMessagesKey,
  optimisticMessage,
  reactionActionType,
  type ChannelCache,
  type ChatMessageKind,
  type RawChatMessage,
  type RawChatMessageAction,
} from "./types";
import {
  applyActionUpdate,
  applyReactionInsert,
  emptyCache,
  markFailed,
  mergeServerRow,
  removeMessage,
  toggleReactionLocal,
  upsertOptimistic,
} from "./cache";
import {
  browserNetworkState,
  type NetworkState,
  type OutboxAttachment,
  type OutboxRow,
  type OutboxStore,
} from "./adapters";
import { randomClientId } from "./random-id";
import { OUTBOX_ANALYTICS_EVENTS } from "./outbox-analytics";
import type { AnalyticsProperties } from "@repo/validation";

export interface ToastFn {
  (input: {
    title: string;
    description?: string;
    variant?: "destructive";
  }): void;
}

/**
 * Platform-neutral error sink, for callers with no toast surface at all
 * (mobile — see `ChatActionContext.toast`). Unlike `toast`, this is not a
 * fire-and-forget notification: a caller that supplies it is expected to
 * hold the failure until the member can see and act on it (#999), so it
 * carries no `variant` — there is nothing else it would report.
 */
export interface ChatErrorFn {
  (input: { title: string; description?: string }): void;
}

export type FrappApiClient = ReturnType<typeof createFrappClient>;

export interface ChatActionContext {
  queryClient: QueryClient;
  /**
   * NestJS API client (ADR-11): the transport for chat-send and
   * chat-react. Replaces the retired Supabase Edge Function invokes.
   */
  apiClient: FrappApiClient;
  /**
   * Supabase client kept only for: (a) the RLS-protected
   * `chat_message_actions` DELETE in `unreact` (which needs the viewer's
   * JWT, not service-role), and (b) the Realtime / Postgres Changes
   * subscriptions wired elsewhere.
   */
  supabase: SupabaseClient;
  /** App user id of the viewer. `null` is a hard guard: no writes without identity. */
  userId: string | null;
  /**
   * Durable outbox (plus the hot-path draft clear). Web injects the
   * Dexie-backed `dexieOutboxStore` from `apps/web/lib/chat/offline-queue.ts`;
   * mobile brings its own. Required — silently dropping queued sends is the
   * failure this port exists to prevent (see `adapters.ts`).
   */
  outbox: OutboxStore;
  /** Connectivity probe. Omitted → the browser implementation. */
  net?: NetworkState;
  toast?: ToastFn;
  /**
   * Fires alongside `toast` (never instead of it) on a rejected `react` or
   * `unreact`. Web supplies `toast` and can leave this unset; mobile supplies
   * none of `toast` and must supply this, or those two failures stay silent
   * (#999) — its optimistic rollback is still correct either way, only the
   * explanation is missing.
   */
  onError?: ChatErrorFn;
  /**
   * Product analytics sink for the outbox lifecycle
   * (`spec/behavior/observability.md` § Outbox Telemetry) — omitted → no
   * events. Web supplies the pseudonymous `track` from `AnalyticsContext`;
   * fire-and-forget by the same contract that context documents. Properties
   * must be behavioral only — never pass `OutboxRow.body` or anything
   * content-derived (see `outbox-analytics.ts`).
   */
  track?: (event: string, properties?: AnalyticsProperties) => void;
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
  /** openapi-fetch error envelope; `response.status` carries the HTTP code. */
  response?: { status?: number };
}

function extractMessage(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const candidate = (value as { message?: unknown }).message;
  return typeof candidate === "string" && candidate.length > 0
    ? candidate
    : null;
}

/**
 * Distinguishes terminal client errors (4xx — bad request / forbidden) from
 * transient ones (network, 5xx). 4xx → `failed` + toast; transient → keep the
 * message pending in the outbox for the reconnect flush.
 *
 * Handles two error shapes:
 *   - openapi-fetch `{ error, response }` rejected envelope (NestJS API)
 *   - generic `Error` with `status` / `context.response.status`
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
  if (
    status === undefined &&
    e.response &&
    typeof e.response.status === "number"
  ) {
    status = e.response.status;
  }
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
    extractMessage(error) ??
    extractMessage((error as { error?: unknown }).error) ??
    "Couldn't reach chat server";
  const terminal = typeof status === "number" && status >= 400 && status < 500;
  return { terminal, status, message };
}

/**
 * Normalize an openapi-fetch `{ data, error }` response into the same
 * thrown-Error shape `classify` understands. NestJS error bodies look
 * like `{ statusCode, message, error }`; openapi-fetch exposes the raw
 * `Response` so we hang the status off the thrown error.
 */
function throwApiError(
  error: unknown,
  response: { status: number } | undefined,
  fallback: string,
): never {
  const msg = extractMessage(error) ?? fallback;
  const wrapped = new Error(msg) as FunctionsErrorWithStatus;
  if (response) wrapped.response = { status: response.status };
  wrapped.context = { status: response?.status, response };
  throw wrapped;
}

export interface SendMessageArgs {
  channelId: string;
  content: string;
  kind?: ChatMessageKind;
  payload?: Record<string, unknown> | null;
  replyToId?: string | null;
  /**
   * Files already uploaded to the `chat` bucket that this message claims. The
   * server re-checks every path against the prefix it minted, so this is a
   * claim, not an instruction.
   */
  attachments?: OutboxAttachment[] | null;
  /** Reuse a previously-generated id (outbox flush, idempotent retry). */
  clientMessageId?: string;
  /**
   * How many prior attempts have already failed for this message — for
   * analytics only. `ctx.outbox.enqueue`'s return value always reports
   * `attempts: 0` (every enqueue is a fresh `put`, including a retry's
   * re-enqueue of the same `clientId`), so a retry/flush resend passes the
   * outbox row's real count through here rather than reading the reset
   * value. Omitted (a first-time compose send) reads as `0`.
   */
  priorAttempts?: number;
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
  const clientId = args.clientMessageId ?? randomClientId();
  const optimistic = optimisticMessage({
    clientMessageId: clientId,
    channelId: args.channelId,
    senderId: ctx.userId,
    content: args.content,
    kind: args.kind,
    payload: args.payload,
    replyToId: args.replyToId ?? null,
    attachmentCount: args.attachments?.length ?? 0,
  });

  patchCache(ctx.queryClient, args.channelId, (cache) =>
    upsertOptimistic(cache, optimistic),
  );
  await ctx.outbox.clearDraft(args.channelId);

  const intent = {
    kind: args.kind ?? "text",
    payload: args.payload ?? null,
    replyToId: args.replyToId ?? null,
    attachments: args.attachments ?? null,
  } as const;

  const enqueued = await ctx.outbox.enqueue({
    clientId,
    channelId: args.channelId,
    body: args.content,
    ...intent,
  });
  const attempts = args.priorAttempts ?? 0;
  ctx.track?.(OUTBOX_ANALYTICS_EVENTS.queued, {
    channel_id: args.channelId,
    attempts,
  });
  // Offline: the row is safely queued; the reconnect flush will POST it.
  if ((ctx.net ?? browserNetworkState).isOffline()) return;

  try {
    const { data, error, response } = await ctx.apiClient.POST(
      "/v1/channels/{id}/messages",
      {
        params: { path: { id: args.channelId } },
        // `payload` is `object`/`Record<string, any>` in the OpenAPI schema;
        // openapi-typescript renders that as `{ [x: string]: undefined }` so
        // we cast through `unknown` to silence the structural mismatch
        // without losing checking on the rest of the body.
        body: {
          client_message_id: clientId,
          content: args.content,
          kind: args.kind ?? "text",
          payload: (args.payload ?? undefined) as unknown as undefined,
          reply_to_id: args.replyToId ?? undefined,
          attachments: args.attachments?.length
            ? args.attachments.map((attachment) => ({
                storage_path: attachment.storagePath,
                filename: attachment.filename,
                content_type: attachment.contentType,
                byte_size: attachment.byteSize ?? undefined,
              }))
            : undefined,
        },
      },
    );
    if (error || !data) {
      throwApiError(error, response, "Couldn't send message");
    }
    const message = (data as { message?: RawChatMessage }).message;
    if (!message) {
      throw new Error("chat send returned no message");
    }
    patchCache(ctx.queryClient, args.channelId, (cache) =>
      mergeServerRow(cache, message),
    );
    await ctx.outbox.dequeue(clientId);
    ctx.track?.(OUTBOX_ANALYTICS_EVENTS.confirmed, {
      channel_id: args.channelId,
      elapsed_ms: Date.now() - enqueued.queuedAt,
      attempts,
    });
  } catch (err) {
    const { terminal, status, message } = classify(err);
    if (terminal) {
      patchCache(ctx.queryClient, args.channelId, (cache) =>
        markFailed(cache, clientId, message),
      );
      await ctx.outbox.markFailed(clientId, message);
      ctx.track?.(OUTBOX_ANALYTICS_EVENTS.failedTerminal, {
        channel_id: args.channelId,
        elapsed_ms: Date.now() - enqueued.queuedAt,
        attempts,
        status: status ?? null,
      });
      ctx.toast?.({
        title: "Message rejected",
        description: message,
        variant: "destructive",
      });
    } else {
      await ctx.outbox.bumpAttempt(clientId, message);
      ctx.track?.(OUTBOX_ANALYTICS_EVENTS.failedTransient, {
        channel_id: args.channelId,
        elapsed_ms: Date.now() - enqueued.queuedAt,
        attempts,
      });
    }
  }
}

/**
 * Insert a cache-only optimistic placeholder for a heavy / server-originated
 * command (e.g. `/points`). Unlike `sendMessage`, it performs NO HTTP POST and
 * NO outbox enqueue: the server writes the authoritative row carrying the same
 * `client_message_id`, and the Realtime echo reconciles the placeholder in
 * place via `mergeServerRow`. The caller passes `clientMessageId` to the heavy
 * RPC and removes the placeholder on failure (`removeLocalPlaceholder`).
 */
export function insertLocalPlaceholder(
  ctx: ChatActionContext,
  args: { channelId: string; clientMessageId: string; content: string },
): void {
  if (!ctx.userId) return;
  const optimistic = optimisticMessage({
    clientMessageId: args.clientMessageId,
    channelId: args.channelId,
    senderId: ctx.userId,
    content: args.content,
    kind: "loading",
    payload: null,
    replyToId: null,
  });
  patchCache(ctx.queryClient, args.channelId, (cache) =>
    upsertOptimistic(cache, optimistic),
  );
}

/** Remove a cache-only placeholder (e.g. when the heavy-command RPC fails). */
export function removeLocalPlaceholder(
  ctx: ChatActionContext,
  channelId: string,
  clientMessageId: string,
): void {
  patchCache(ctx.queryClient, channelId, (cache) =>
    removeMessage(cache, clientMessageId),
  );
}

function coerceKind(kind: string | undefined): ChatMessageKind {
  return (CHAT_MESSAGE_KINDS.find((k) => k === kind) ??
    "text") as ChatMessageKind;
}

/** Reconstructs a full `SendMessageArgs` from a persisted outbox row. */
function sendArgsFromOutbox(row: OutboxRow): SendMessageArgs {
  return {
    channelId: row.channelId,
    content: row.body,
    kind: coerceKind(row.kind),
    payload: row.payload ?? null,
    replyToId: row.replyToId ?? null,
    attachments: row.attachments ?? null,
    clientMessageId: row.clientId,
    priorAttempts: row.attempts,
  };
}

/** Retry a failed/queued outbox row. Reuses the original clientId for idempotency. */
export async function retryOutboxRow(
  ctx: ChatActionContext,
  row: OutboxRow,
): Promise<void> {
  ctx.track?.(OUTBOX_ANALYTICS_EVENTS.retried, {
    channel_id: row.channelId,
    attempts: row.attempts,
  });
  await ctx.outbox.requeue(row.clientId);
  await sendMessage(ctx, sendArgsFromOutbox(row));
}

/** Drops a failed message from the cache and the outbox. */
export async function discardOutboxRow(
  ctx: ChatActionContext,
  row: OutboxRow,
): Promise<void> {
  patchCache(ctx.queryClient, row.channelId, (cache) =>
    removeMessage(cache, row.clientId),
  );
  await ctx.outbox.dequeue(row.clientId);
  ctx.track?.(OUTBOX_ANALYTICS_EVENTS.discarded, {
    channel_id: row.channelId,
    attempts: row.attempts,
  });
}

/**
 * Strictly sequential flush of the queued outbox (oldest first). Idempotent at
 * the server thanks to the partial unique index on `(channel_id, sender_id,
 * client_message_id)`.
 */
export async function flushOutbox(ctx: ChatActionContext): Promise<void> {
  if (!ctx.userId) return;
  if ((ctx.net ?? browserNetworkState).isOffline()) return;
  const rows = await ctx.outbox.listQueued();
  for (const row of rows) {
    await sendMessage(ctx, sendArgsFromOutbox(row));
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
  const rows = await ctx.outbox.listForChannel(channelId);
  if (rows.length === 0) return;
  patchCache(ctx.queryClient, channelId, (cache) => {
    let next = cache;
    for (const row of rows) {
      const optimistic = optimisticMessage({
        clientMessageId: row.clientId,
        channelId: row.channelId,
        senderId: ctx.userId!,
        content: row.body,
        kind: coerceKind(row.kind),
        payload: row.payload ?? null,
        replyToId: row.replyToId ?? null,
      });
      next = upsertOptimistic(next, optimistic);
      if (row.status === "failed") {
        next = markFailed(next, row.clientId, row.lastError ?? "Send failed");
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

/** Optimistic reaction add via the NestJS chat actions endpoint (ADR-11). */
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
    const { data, error, response } = await ctx.apiClient.POST(
      "/v1/channels/messages/{messageId}/actions",
      {
        params: { path: { messageId: args.messageId } },
        body: { action_type: actionType },
      },
    );
    if (error || !data) {
      throwApiError(error, response, "Couldn't react");
    }
    const action = (data as { action?: RawChatMessageAction }).action;
    if (action) {
      patchCache(ctx.queryClient, args.channelId, (cache) =>
        applyReactionInsert(cache, action),
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
    ctx.onError?.({ title: "Couldn't react", description: message });
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
    toggleReactionLocal(cache, args.messageId, actionType, ctx.userId!, false),
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
    ctx.onError?.({ title: "Couldn't remove reaction", description: message });
  }
}

export interface EditMessageArgs {
  channelId: string;
  messageId: string;
  content: string;
}

/**
 * Edit a message's content (own messages only — enforced server-side).
 *
 * Not optimistic like `react`/`unreact`: the row the server returns is the
 * one canonical source for the new `content`/`edited_at`, and `mergeServerRow`
 * is already built to treat this as "a pin/edit UPDATE echo" (see its own
 * docstring) — the same merge a Realtime echo of this same edit would apply,
 * so a duplicate echo from Postgres Changes is a harmless no-op.
 */
export async function editMessage(
  ctx: ChatActionContext,
  args: EditMessageArgs,
): Promise<void> {
  if (!ctx.userId) return;
  try {
    const { data, error, response } = await ctx.apiClient.PATCH(
      "/v1/channels/messages/{messageId}",
      {
        params: { path: { messageId: args.messageId } },
        body: { content: args.content },
      },
    );
    if (error) {
      throwApiError(error, response, "Couldn't edit message");
    }
    patchCache(ctx.queryClient, args.channelId, (cache) =>
      mergeServerRow(cache, data as unknown as RawChatMessage),
    );
  } catch (err) {
    const { message } = classify(err);
    ctx.toast?.({
      title: "Couldn't edit message",
      description: message,
      variant: "destructive",
    });
    ctx.onError?.({ title: "Couldn't edit message", description: message });
    throw err;
  }
}

export interface DeleteMessageArgs {
  channelId: string;
  messageId: string;
}

/**
 * Soft-delete a message (own message, or any in an accessible channel with
 * `channels:manage` — the permission check is server-side; the client's job
 * is only to offer the control when it's likely to succeed, see
 * `MessageItem`).
 *
 * Not optimistic, for the same reason as `editMessage`: the server response
 * already carries the final `content: '[message deleted]'` / `is_deleted:
 * true` row, so merging it is both the confirmation and the update.
 */
export async function deleteMessage(
  ctx: ChatActionContext,
  args: DeleteMessageArgs,
): Promise<void> {
  if (!ctx.userId) return;
  try {
    const { data, error, response } = await ctx.apiClient.DELETE(
      "/v1/channels/messages/{messageId}",
      { params: { path: { messageId: args.messageId } } },
    );
    if (error) {
      throwApiError(error, response, "Couldn't delete message");
    }
    patchCache(ctx.queryClient, args.channelId, (cache) =>
      mergeServerRow(cache, data as unknown as RawChatMessage),
    );
  } catch (err) {
    const { message } = classify(err);
    ctx.toast?.({
      title: "Couldn't delete message",
      description: message,
      variant: "destructive",
    });
    ctx.onError?.({ title: "Couldn't delete message", description: message });
    throw err;
  }
}

export interface CardActionArgs {
  channelId: string;
  messageId: string;
  actionType: string;
  payload?: Record<string, unknown>;
}

/**
 * Action plumbing for inline-card buttons (RSVP / Vote / Done …). The
 * transport is the NestJS chat actions endpoint (ADR-11). For vote-change
 * (ADR-07) the response sets `updated:true`, so the cache merges via
 * `applyActionUpdate` (replaces payload on the existing row) instead of
 * `applyReactionInsert` (which would shadow the prior row).
 */
export async function actOnCard(
  ctx: ChatActionContext,
  args: CardActionArgs,
): Promise<void> {
  if (!ctx.userId) return;
  try {
    const { data, error, response } = await ctx.apiClient.POST(
      "/v1/channels/messages/{messageId}/actions",
      {
        params: { path: { messageId: args.messageId } },
        body: {
          action_type: args.actionType,
          // `payload` is `object` in the OpenAPI schema; cast through
          // `unknown` to satisfy openapi-typescript's `Record<string,
          // undefined>` rendering.
          payload: (args.payload ?? undefined) as unknown as undefined,
        },
      },
    );
    if (error || !data) {
      throwApiError(error, response, "Couldn't record action");
    }
    const body = data as {
      action?: RawChatMessageAction;
      updated?: boolean;
    };
    if (body.action) {
      const action = body.action;
      patchCache(ctx.queryClient, args.channelId, (cache) =>
        body.updated
          ? applyActionUpdate(cache, action)
          : applyReactionInsert(cache, action),
      );
    }
  } catch (err) {
    const { message } = classify(err);
    ctx.toast?.({
      title: "Couldn't record action",
      description: message,
      variant: "destructive",
    });
    // Same platform-neutral sink `react`/`unreact` fire alongside `toast`
    // (#999) — a caller with no toast (mobile) has no other way to learn a
    // card action (e.g. a poll vote, #528) failed.
    ctx.onError?.({ title: "Couldn't record action", description: message });
  }
}
