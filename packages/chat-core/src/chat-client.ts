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
import type { ChatMessageFlag, MentionPick } from "@repo/validation";
import {
  isDefinitiveClientError,
  randomClientId,
  serverMessageOf,
  statusOf,
  type createFrappClient,
} from "@repo/api-sdk";
import {
  CHAT_MESSAGE_KINDS,
  chatMessagesKey,
  messageCacheKey,
  optimisticMessage,
  reactionActionType,
  type ChannelCache,
  type ChatMessageKind,
  type OutgoingGif,
  type RawChatMessage,
  type RawChatMessageAction,
  type ReplayRequest,
} from "./types";
import {
  applyActionUpdate,
  applyReactionInsert,
  emptyCache,
  locateRow,
  markFailed,
  type RowPlacement,
  mergeHeldServerRow,
  mergeServerRow,
  removeMessage,
  toggleReactionLocal,
  upsertOptimistic,
} from "./cache";
import {
  browserNetworkState,
  type KeyValueStore,
  type NetworkState,
  type OutboxAttachment,
  type OutboxRow,
  type OutboxStore,
} from "./adapters";
import {
  applyNotice,
  dropNotices,
  DURABLE_NOTICE_MARGIN_MS,
  findNotice,
  isNoticeExpired,
  mergePersistedNotices,
  persistNotice,
  readNotices,
  type HeavyCommandNotice,
} from "./heavy-command-notices";
import { memberFacingRefusal } from "./polls";
import { OUTBOX_ANALYTICS_EVENTS } from "./outbox-analytics";
import {
  OFFLINE_COPY,
  refusalCopy,
  STATUS_ERROR_COPY,
  TRY_AGAIN,
  type AnalyticsProperties,
} from "@repo/validation";

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
   * Dexie-backed store from `apps/web/lib/chat/offline-queue.ts`, built per
   * signed-in member by `createDexieOutboxStore(scope)` (#2226) so a context
   * can only ever address its own member's queue;
   * mobile brings its own. Required — silently dropping queued sends is the
   * failure this port exists to prevent (see `adapters.ts`).
   */
  outbox: OutboxStore;
  /** Connectivity probe. Omitted → the browser implementation. */
  net?: NetworkState;
  /**
   * Small string store for heavy-command rows the REST backfill will never
   * return: `recorded` (#1789) and `unconfirmed` with its replay handle
   * (#1909). See `heavy-command-notices.ts`. Omitted → `browserKeyValueStore`.
   * Web and mobile inject the same store into the realtime manager, which
   * evicts an entry when its card's echo arrives.
   */
  kv?: KeyValueStore;
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
   * events. Web and mobile supply the pseudonymous `track` from their
   * `AnalyticsContext`;
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

/**
 * `patchCache` for a row write: the thread's reply cache when the row is a
 * thread reply (`threadRootId`, #4034), else the channel's.
 */
function patchRowCache(
  qc: QueryClient,
  target: { channelId: string; threadRootId?: string | null },
  updater: (cache: ChannelCache) => ChannelCache,
): void {
  qc.setQueryData<ChannelCache>(
    messageCacheKey(target.channelId, target.threadRootId),
    (prev) => updater(prev ?? emptyCache()),
  );
}

/** Analytics must not fail a send or turn a committed write into `{ ok: false }`. */
function emitOutboxEvent(
  ctx: ChatActionContext,
  event: string,
  properties?: AnalyticsProperties,
): void {
  try {
    ctx.track?.(event, properties);
  } catch {
    // Swallow — `track` is fire-and-forget by contract.
  }
}

interface FunctionsErrorWithStatus extends Error {
  context?: { response?: { status?: number } | Response; status?: number };
  status?: number;
  /** openapi-fetch error envelope; `response.status` carries the HTTP code. */
  response?: { status?: number };
}

/**
 * The server's own message, wherever the failure carries it: on the value
 * itself (a thrown Error, or a body a `@repo/hooks` mutation rethrew) or on the
 * openapi-fetch envelope's nested `error` body. `null` when neither has one.
 */
function serverReasonOf(error: unknown): string | null {
  return (
    serverMessageOf(error) ??
    serverMessageOf((error as { error?: unknown } | null)?.error)
  );
}

/**
 * What a member reads for a chat call that failed (principles.md P2.3): the
 * polls-off row, then the shared refusal map in `@repo/validation`, then what
 * the status means. The server's own sentence never reaches the screen unless
 * the map rewrote it, so "Forbidden resource" or a class-validator line can't
 * land in a toast or a failed row's inline error.
 */
function chatRefusalCopy(
  reason: string | null,
  status: number | undefined,
): string {
  if (reason) {
    const pollsOff = memberFacingRefusal(reason);
    if (pollsOff !== reason) return pollsOff;
  }
  const mapped = refusalCopy({ status, message: reason });
  if (mapped) return mapped;
  if (status === undefined) return OFFLINE_COPY;
  return STATUS_ERROR_COPY[status] ?? TRY_AGAIN;
}

/**
 * Distinguishes terminal client errors (4xx — bad request / forbidden) from
 * transient ones (network, 5xx). 4xx → `failed` + toast; transient → keep the
 * message pending in the outbox for the reconnect flush.
 *
 * A 429 is terminal too, by choice (#3061). The outbox flushes on boot and
 * when a channel's connection goes live, not on a timer, so a throttled send
 * left pending would sit unsent while the member stays online. Failing it puts
 * the row's Retry in front of them, which resends the same
 * `client_message_id` once the minute is up. `sendMessage` titles that toast
 * `Message not sent` rather than `Message rejected` and reads it as
 * `RATE_LIMITED_COPY`, because the server refused the pace, not the message.
 * A flush that outruns the bucket fails each row past it the same way, each
 * with its own Retry. Stopping the flush at the first 429 would leave those
 * rows pending with nothing to resend them, which is the case this avoids.
 *
 * Handles three error shapes:
 *   - openapi-fetch `{ error, response }` rejected envelope (NestJS API)
 *   - generic `Error` with `status` / `context.response.status`
 *   - the parsed error body itself, which a `@repo/hooks` mutation rethrows
 *     (`if (error) throw error`) with the status on `statusCode` and a
 *     `message` that a validation failure sends as an array
 *
 * Exported so a chat surface outside the outbox reads an API failure the way
 * the send path does, instead of with a second copy of this split. The upload
 * surfaces reach it through `definitiveRefusalMessage` below (#2199).
 */
export function classifyChatError(error: unknown): {
  terminal: boolean;
  status?: number;
  message: string;
} {
  if (!error) return { terminal: false, message: "Unknown error" };
  const e = error as FunctionsErrorWithStatus;
  let status: number | undefined = statusOf(error);
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
  const message = chatRefusalCopy(serverReasonOf(error), status);
  const terminal =
    typeof status === "number" && isDefinitiveClientError(status);
  return { terminal, status, message };
}

/**
 * What a member reads for a 429. The API's throttler sends the same sentence
 * (`THROTTLED_MESSAGE`); `spec/ui/design-system/writing.md` § Rate limited
 * (global) owns the copy.
 */
export const RATE_LIMITED_COPY =
  "Too many requests in a short time. Wait a minute, then try again.";

/**
 * The server's reason for a definitive refusal, for a member to read, or
 * `null` when a retry could help.
 *
 * For a surface that shows the API's refusal and otherwise its own sentence:
 * the web composer and mobile's photo upload both read their upload-URL mint
 * through this, so one response can't read two ways (#2199). It is
 * `classifyChatError`'s terminal split with one exception: a 429 reads as
 * `RATE_LIMITED_COPY`, whatever its body says. Its remedy is waiting a full
 * minute (the throttler blocks a key for its whole 60s window), which a
 * caller's "in a moment" retry sentence understates, and an intermediary's 429
 * carries its own text. It is also `null` for a refusal with no message, so
 * the caller's sentence stands in for an empty line.
 *
 * Reads API bodies only. A thrown `Error` is `null` here, because what one
 * says is the surface's call: web shows its own Errors' text, while mobile's
 * are native networking failures in platform jargon.
 */
export function definitiveRefusalMessage(error: unknown): string | null {
  if (error instanceof Error) return null;
  const { terminal, status } = classifyChatError(error);
  if (status === 429) return RATE_LIMITED_COPY;
  if (!terminal) return null;
  const reason = serverReasonOf(error);
  return reason === null ? null : chatRefusalCopy(reason, status);
}

/**
 * Normalize an openapi-fetch `{ data, error }` response into the same
 * thrown-Error shape `classifyChatError` understands. NestJS error bodies look
 * like `{ statusCode, message, error }`; openapi-fetch exposes the raw
 * `Response` so we hang the status off the thrown error.
 */
function throwApiError(
  error: unknown,
  response: { status: number } | undefined,
  fallback: string,
): never {
  const msg = serverMessageOf(error) ?? fallback;
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
  /**
   * Claims still uploading when the member pressed Send (mobile's photo tray).
   * The optimistic row goes up at once, carrying `attachmentCount`; the
   * outbox write and the POST wait for this to resolve, and the claims it
   * resolves to are sent in place of `attachments`. A rejection leaves the
   * row in place, failed with the rejection's message, and rejects with
   * {@link AttachmentsNotReadyError}. Nothing is in the outbox yet, so the
   * caller owns Retry and Discard for that row: it sends again under the same
   * `clientMessageId`, or removes the row.
   *
   * Until it resolves the message lives only in memory: an app killed while
   * photos upload loses it. The window is the upload time of shrunk photos.
   */
  attachmentsReady?: Promise<OutboxAttachment[]> | null;
  /** How many files the optimistic row shows while `attachmentsReady` runs. */
  attachmentCount?: number;
  /**
   * A GIF from the picker (#4631). The message is the GIF: `content` is
   * empty and there are no attachments. The server checks its token, so only
   * a GIF the API's own search returned is accepted.
   */
  gif?: OutgoingGif | null;
  /**
   * The members the composer's `@` picker wrote into `content` (#3835), so a
   * picked `@Jane Doe` reaches her or nobody, never another member by name.
   */
  mentionPicks?: readonly MentionPick[] | null;
  /** Reuse a previously-generated id (outbox flush, idempotent retry). */
  clientMessageId?: string;
  /**
   * Leave the channel's saved composer draft alone. A send clears it because
   * the draft is normally what is being sent; these sends aren't: an outbox
   * retry or flush (the draft was cleared when the message was first sent,
   * and whatever is saved now is something newer the member is typing), and
   * a card posted from a sheet beside the composer, such as mobile's New poll
   * (#3701), which a typed-but-unsent message must outlive.
   */
  keepDraft?: boolean;
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
 * `sendMessage`'s `attachmentsReady` rejected. The optimistic row is still in
 * the cache, marked failed with this message; nothing was queued.
 */
export class AttachmentsNotReadyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttachmentsNotReadyError";
  }
}

/**
 * Outcome of {@link sendMessage} after the optimistic row is in the cache.
 *
 * Empty on the usual path (queued, posted, or a handled POST failure). A
 * `warning` means the server accepted the message and the cache already shows
 * it; only local outbox bookkeeping failed. Callers must not treat that as
 * `{ ok: false }` — a destructive toast invites a fresh `client_message_id`
 * and a duplicate card (#1718).
 */
export interface SendMessageResult {
  warning?: string;
}

/**
 * The server accepted the send; IndexedDB (or the outbox port) then failed
 * while dequeuing. Distinct from a never-sent fault, which still throws.
 */
export const POSTED_OUTBOX_WARNING =
  "The message was sent, but this device couldn't finish saving it. Don't send it again — check the channel first.";

/**
 * Optimistic send + idempotent invoke. Identity is sourced from `ctx.userId`
 * (the authenticated session) — never the client payload.
 *
 * Throws only when the message was **never sent** (`enqueue` failed after the
 * optimistic upsert). POST failures are handled here and resolve. A
 * post-commit `dequeue` fault resolves with {@link POSTED_OUTBOX_WARNING}
 * and does not `markFailed` the visible row.
 */
export async function sendMessage(
  ctx: ChatActionContext,
  args: SendMessageArgs,
): Promise<SendMessageResult> {
  if (!ctx.userId) {
    ctx.toast?.({
      title: "You're signed out",
      description: "Sign back in to send messages.",
      variant: "destructive",
    });
    return {};
  }
  const clientId = args.clientMessageId ?? randomClientId();

  // A prior attempt already merged the server row (POST ok, `dequeue` failed).
  // Do not upsert a second pending card; just finish bookkeeping. Flush and
  // hydrate would otherwise sit a client-keyed twin next to the real card.
  if (
    locateRow(
      ctx.queryClient.getQueryData<ChannelCache>(
        chatMessagesKey(args.channelId),
      ),
      clientId,
    ) === "confirmed"
  ) {
    try {
      await ctx.outbox.dequeue(clientId);
    } catch {
      return { warning: POSTED_OUTBOX_WARNING };
    }
    return {};
  }

  const optimistic = optimisticMessage({
    clientMessageId: clientId,
    channelId: args.channelId,
    senderId: ctx.userId,
    content: args.content,
    kind: args.kind,
    payload: args.payload,
    replyToId: args.replyToId ?? null,
    attachmentCount: args.attachmentCount ?? args.attachments?.length ?? 0,
    gif: args.gif ?? null,
  });

  patchCache(ctx.queryClient, args.channelId, (cache) =>
    upsertOptimistic(cache, optimistic),
  );

  // Draft clear is a Dexie drafts-table op that happens to sit on this
  // path, for a compose send only (`keepDraft`). Failing it must not fail a
  // send that can still enqueue. Before any wait for uploads below, so a
  // draft the member types meanwhile is never the one cleared.
  if (!args.keepDraft) {
    try {
      await ctx.outbox.clearDraft(args.channelId);
    } catch {
      // Best-effort.
    }
  }

  let attachments = args.attachments ?? null;
  if (args.attachmentsReady) {
    try {
      attachments = await args.attachmentsReady;
    } catch (err) {
      // The row stays, failed, with the reason: the caller holds what a
      // retry needs (no outbox row exists yet) and the member sees which
      // message didn't go, in whatever channel it was sent from.
      const reason =
        err instanceof Error && err.message
          ? err.message
          : "A photo didn't upload.";
      patchCache(ctx.queryClient, args.channelId, (cache) =>
        markFailed(cache, clientId, reason),
      );
      throw new AttachmentsNotReadyError(reason);
    }
  }

  const intent = {
    kind: args.kind ?? "text",
    payload: args.payload ?? null,
    replyToId: args.replyToId ?? null,
    attachments,
    gif: args.gif ?? null,
    mentionPicks: args.mentionPicks?.length ? [...args.mentionPicks] : null,
  } as const;

  let enqueued: OutboxRow;
  try {
    enqueued = await ctx.outbox.enqueue({
      clientId,
      channelId: args.channelId,
      body: args.content,
      ...intent,
    });
  } catch (err) {
    // No outbox row exists, so Retry/Discard would be no-ops. Remove the
    // optimistic card rather than leaving a failed phantom (#1718).
    patchCache(ctx.queryClient, args.channelId, (cache) =>
      removeMessage(cache, clientId),
    );
    throw err;
  }
  const attempts = args.priorAttempts ?? 0;
  emitOutboxEvent(ctx, OUTBOX_ANALYTICS_EVENTS.queued, {
    channel_id: args.channelId,
    attempts,
  });
  // Offline: the row is safely queued; the reconnect flush will POST it.
  if ((ctx.net ?? browserNetworkState).isOffline()) return {};

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
          attachments: attachments?.length
            ? attachments.map((attachment) => ({
                storage_path: attachment.storagePath,
                filename: attachment.filename,
                content_type: attachment.contentType,
                byte_size: attachment.byteSize ?? undefined,
                width: attachment.width ?? undefined,
                height: attachment.height ?? undefined,
                thumbhash: attachment.thumbhash ?? undefined,
                preview_storage_path:
                  attachment.previewStoragePath ?? undefined,
              }))
            : undefined,
          gif: args.gif
            ? {
                id: args.gif.id,
                title: args.gif.title || undefined,
                url: args.gif.url,
                width: args.gif.width,
                height: args.gif.height,
                token: args.gif.token,
              }
            : undefined,
          mention_picks: intent.mentionPicks ?? undefined,
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
  } catch (err) {
    const classified = classifyChatError(err);
    const { terminal, status } = classified;
    // Any 429 reads as the one-minute sentence: an intermediary's carries its
    // own text, and the row's Retry is the remedy either way.
    const throttled = status === 429;
    const message = throttled ? RATE_LIMITED_COPY : classified.message;
    if (terminal) {
      patchCache(ctx.queryClient, args.channelId, (cache) =>
        markFailed(cache, clientId, message),
      );
      // Toast before the Dexie write: a `markFailed` throw used to skip the
      // toast and then, once swallowed, look like success to slash dispatch.
      ctx.toast?.({
        title: throttled ? "Message not sent" : "Message rejected",
        description: message,
        variant: "destructive",
      });
      try {
        await ctx.outbox.markFailed(clientId, message);
        emitOutboxEvent(ctx, OUTBOX_ANALYTICS_EVENTS.failedTerminal, {
          channel_id: args.channelId,
          elapsed_ms: Date.now() - enqueued.queuedAt,
          attempts,
          status: status ?? null,
        });
      } catch {
        // Cache already shows failed. Do not rethrow.
      }
    } else {
      try {
        await ctx.outbox.bumpAttempt(clientId, message);
        emitOutboxEvent(ctx, OUTBOX_ANALYTICS_EVENTS.failedTransient, {
          channel_id: args.channelId,
          elapsed_ms: Date.now() - enqueued.queuedAt,
          attempts,
        });
      } catch {
        // Still pending in the cache; the row stays queued if bump failed.
      }
    }
    return {};
  }

  try {
    await ctx.outbox.dequeue(clientId);
  } catch {
    // The server row is already in the cache. `markFailed` would invite a
    // retry that mints a fresh id; leaving the outbox queued lets flush
    // replay the same `client_message_id` (server dedupes). `sendMessage`
    // short-circuits when that row is already `confirmed`, so the replay
    // does not upsert a twin.
    return { warning: POSTED_OUTBOX_WARNING };
  }
  emitOutboxEvent(ctx, OUTBOX_ANALYTICS_EVENTS.confirmed, {
    channel_id: args.channelId,
    elapsed_ms: Date.now() - enqueued.queuedAt,
    attempts,
  });
  return {};
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

/**
 * Remove a cache-only placeholder (e.g. when the heavy-command RPC fails), and
 * any persisted notice for it.
 *
 * A retry that resolves, or that is refused because its key is spent, clears
 * its row through here. Its stored replay handle has to go with it, or the next
 * rebuild restores a Retry for a request that is already settled (#1909).
 */
export function removeLocalPlaceholder(
  ctx: ChatActionContext,
  channelId: string,
  clientMessageId: string,
): void {
  patchCache(ctx.queryClient, channelId, (cache) =>
    removeMessage(cache, clientMessageId),
  );
  if (ctx.userId) dropNotices(channelId, ctx.userId, [clientMessageId], ctx.kv);
}

/**
 * The fields a terminal heavy-command row is persisted and redrawn from.
 *
 * The live row's content and timestamp win, so a restored row sits where the
 * placeholder sat. With no live row (the channel's cache was garbage-collected
 * while a retry was in flight), the viewer's stored notice for the same key
 * supplies them, and the caller's `content` is the last resort — never an empty
 * row stamped "now". `null` when there is no one to attribute the row to: no
 * viewer and no row to read a sender from.
 */
function terminalNoticeFields(
  ctx: ChatActionContext,
  existing: ChannelCache | undefined,
  args: {
    channelId: string;
    clientMessageId: string;
    note: string;
    content?: string;
  },
): Omit<HeavyCommandNotice, "status" | "replay"> | null {
  const current = existing?.byId[args.clientMessageId];
  const senderId = ctx.userId || current?.sender_id;
  if (!senderId) return null;
  const stored = ctx.userId
    ? findNotice(args.channelId, ctx.userId, args.clientMessageId, ctx.kv)
    : undefined;
  return {
    clientMessageId: args.clientMessageId,
    channelId: args.channelId,
    senderId,
    content: current?.content || stored?.content || args.content || "",
    note: args.note,
    createdAt:
      current?.created_at ?? stored?.createdAt ?? new Date().toISOString(),
  };
}

/** What keeping a terminal row achieved. */
export interface TerminalRowOutcome {
  /**
   * Where the row is afterwards. `"optimistic"`: on screen, keyed by its
   * client id. `"confirmed"`: the card's echo got there first, so the write is
   * not unknown at all. `"absent"`: nothing on screen to point at — no
   * channel cache to draw it in, or neither a viewer nor a placeholder row to
   * attribute it to.
   */
  placement: RowPlacement;
  /**
   * Whether copy may promise the row survives the next rebuild: the
   * reconnect that follows the outage, minutes away. `true` only when this
   * write landed on disk and, for an `unconfirmed` entry, at least
   * `DURABLE_NOTICE_MARGIN_MS` remains before its age bound. `false` promises
   * nothing either way. What any later rebuild restores, and for how long, is
   * the store's rule, stated once in `spec/behavior/chat/integrations.md`
   * § Slash command dispatch.
   */
  durable: boolean;
}

/**
 * Keep a terminal heavy-command row: persist it for the viewer, and draw it in
 * the channel's cache if that cache exists.
 *
 * Persisted only under a known viewer, because notices are filed per member
 * (`heavy-command-notices.ts`).
 *
 * Drawn only into a cache that already exists. With none (the channel query
 * was garbage-collected mid-request), seeding one here would hand the channel a
 * one-row cache that `staleTime: Infinity` never refetches; the notice on disk
 * restores the row on the next load instead.
 */
function keepTerminalRow(
  ctx: ChatActionContext,
  existing: ChannelCache | undefined,
  notice: HeavyCommandNotice,
): TerminalRowOutcome {
  const durable = ctx.userId
    ? persistNotice(notice, ctx.kv) &&
      !isNoticeExpired(notice, Date.now() + DURABLE_NOTICE_MARGIN_MS)
    : false;
  if (!existing) return { placement: "absent", durable };
  patchCache(ctx.queryClient, notice.channelId, (cache) =>
    applyNotice(cache, notice),
  );
  return { placement: "optimistic", durable };
}

/**
 * The card is already on screen under its server id, so there is no terminal
 * row to keep: drop any stored notice for the key rather than drawing a
 * "card missing" or "outcome unknown" row beside the card itself.
 */
function settleConfirmed(
  ctx: ChatActionContext,
  channelId: string,
  clientMessageId: string,
): TerminalRowOutcome {
  if (ctx.userId) dropNotices(channelId, ctx.userId, [clientMessageId], ctx.kv);
  return { placement: "confirmed", durable: false };
}

/**
 * Leave a heavy-command placeholder in place, flipped to `unconfirmed` and
 * carrying what an explicit retry would replay (#1733), and persist it so a
 * reconnect, a reload or a `gcTime` eviction can restore the row and its Retry
 * (#1909).
 *
 * The counterpart to {@link removeLocalPlaceholder}, and the right call
 * whenever the request's outcome is *unknown* rather than known-failed:
 * removing the placeholder there would erase the only trace of a write that may
 * have committed, and the officer's "retry" then becomes re-typing the command,
 * which mints a fresh key and double-grants.
 *
 * A placeholder that a REST rebuild already dropped (a reconnect refetch that
 * raced the request) is drawn again from `content`.
 *
 * Returns where the row is afterwards and whether copy may promise it survives
 * the next rebuild, because the caller's copy depends on both — see
 * {@link TerminalRowOutcome}. Treating a
 * `"confirmed"` row as "no row" once produced a never-dismissing "we couldn't
 * confirm" notice above a visibly successful card.
 */
export function markLocalUnconfirmed(
  ctx: ChatActionContext,
  replay: ReplayRequest,
  note: string,
  content?: string,
): TerminalRowOutcome {
  const existing = ctx.queryClient.getQueryData<ChannelCache>(
    chatMessagesKey(replay.channelId),
  );
  const placement = locateRow(existing, replay.clientMessageId);
  if (placement === "confirmed") {
    return settleConfirmed(ctx, replay.channelId, replay.clientMessageId);
  }

  const fields = terminalNoticeFields(ctx, existing, {
    channelId: replay.channelId,
    clientMessageId: replay.clientMessageId,
    note,
    content,
  });
  if (!fields) return { placement, durable: false };

  return keepTerminalRow(ctx, existing, {
    ...fields,
    status: "unconfirmed",
    replay,
  });
}

/**
 * Leave a heavy-command placeholder in place, flipped to `recorded` — the
 * write committed, the chat card did not (#1789).
 *
 * The counterpart to {@link removeLocalPlaceholder} on `card_posted: false`.
 * Removing the row there left only an evictable toast as evidence of an
 * append-only write, which is how a second `/points` / `/task` / `/event`
 * command gets typed. No `_replay`: Retry is the dangerous action. On a
 * `/points` replay this replaces the row's persisted `unconfirmed` notice —
 * unless the original card already landed while the replay was in flight, in
 * which case the card is the record and nothing is drawn beside it.
 */
export function markLocalRecorded(
  ctx: ChatActionContext,
  args: {
    channelId: string;
    clientMessageId: string;
    note: string;
    /** Used when the in-flight REST backfill already clobbered the placeholder. */
    content?: string;
  },
): void {
  const existing = ctx.queryClient.getQueryData<ChannelCache>(
    chatMessagesKey(args.channelId),
  );
  if (locateRow(existing, args.clientMessageId) === "confirmed") {
    settleConfirmed(ctx, args.channelId, args.clientMessageId);
    return;
  }
  const fields = terminalNoticeFields(ctx, existing, args);
  if (!fields) return;
  keepTerminalRow(ctx, existing, { ...fields, status: "recorded" });
}

export { mergePersistedNotices };

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
    gif: row.gif ?? null,
    mentionPicks: row.mentionPicks ?? null,
    clientMessageId: row.clientId,
    priorAttempts: row.attempts,
    keepDraft: true,
  };
}

/** Retry a failed/queued outbox row. Reuses the original clientId for idempotency. */
export async function retryOutboxRow(
  ctx: ChatActionContext,
  row: OutboxRow,
): Promise<void> {
  emitOutboxEvent(ctx, OUTBOX_ANALYTICS_EVENTS.retried, {
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
  emitOutboxEvent(ctx, OUTBOX_ANALYTICS_EVENTS.discarded, {
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
 * pending/failed messages so the composer reflects unsent work after a reload,
 * plus the viewer's persisted heavy-command rows (`recorded`, and `unconfirmed`
 * with its Retry — `heavy-command-notices.ts`).
 */
export async function hydrateOutboxIntoCache(
  ctx: ChatActionContext,
  channelId: string,
): Promise<void> {
  if (!ctx.userId) return;
  const rows = await ctx.outbox.listForChannel(channelId);
  const notices = readNotices(channelId, ctx.userId, ctx.kv);
  if (rows.length === 0 && notices.length === 0) return;
  patchCache(ctx.queryClient, channelId, (cache) => {
    let next = cache;
    for (const row of rows) {
      if (locateRow(next, row.clientId) === "confirmed") {
        continue;
      }
      const optimistic = optimisticMessage({
        clientMessageId: row.clientId,
        channelId: row.channelId,
        senderId: ctx.userId!,
        content: row.body,
        kind: coerceKind(row.kind),
        payload: row.payload ?? null,
        replyToId: row.replyToId ?? null,
        // So a queued photo or GIF redraws as itself after a reload, not as
        // an empty bubble.
        attachmentCount: row.attachments?.length ?? 0,
        gif: row.gif ?? null,
      });
      next = upsertOptimistic(next, optimistic);
      if (row.status === "failed") {
        // Through the same mapping as a live refusal: a row persisted before
        // the mapping existed still carries the guard's sentence to an officer.
        next = markFailed(
          next,
          row.clientId,
          memberFacingRefusal(row.lastError ?? "Send failed"),
        );
      }
    }
    return mergePersistedNotices(next, {
      channelId,
      viewerId: ctx.userId,
      kv: ctx.kv,
    });
  });
}

/**
 * Where a row write lands: `threadRootId` names the thread when the message is
 * one of its replies, which live in the thread's own cache (#4034). Omitted
 * (or `null`) for a channel message, a thread's parent included.
 */
interface RowTarget {
  channelId: string;
  threadRootId?: string | null;
}

export interface ReactArgs extends RowTarget {
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

  patchRowCache(ctx.queryClient, args, (cache) =>
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
      patchRowCache(ctx.queryClient, args, (cache) =>
        applyReactionInsert(cache, action),
      );
    }
  } catch (err) {
    patchRowCache(ctx.queryClient, args, (cache) =>
      toggleReactionLocal(
        cache,
        args.messageId,
        actionType,
        ctx.userId!,
        false,
      ),
    );
    const { message } = classifyChatError(err);
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

  patchRowCache(ctx.queryClient, args, (cache) =>
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
    patchRowCache(ctx.queryClient, args, (cache) =>
      toggleReactionLocal(cache, args.messageId, actionType, ctx.userId!, true),
    );
    const { message } = classifyChatError(err);
    ctx.toast?.({
      title: "Couldn't remove reaction",
      description: message,
      variant: "destructive",
    });
    ctx.onError?.({ title: "Couldn't remove reaction", description: message });
  }
}

/**
 * The shared body of the pessimistic row writes (edit, delete, close poll):
 * run the request, merge the row the server returns into a cache that holds
 * it (`mergeHeldServerRow`, so a write to a row the window no longer holds
 * never splices it back in, #2775, #2871), and on any failure toast it,
 * report it through `onError` with `title`, and rethrow. The merge is the
 * confirmation; a Realtime echo of the same row is a no-op. A context with no
 * viewer does nothing.
 */
async function writeHeldRow(
  ctx: ChatActionContext,
  target: RowTarget,
  title: string,
  request: () => Promise<{
    data?: unknown;
    error?: unknown;
    response?: { status: number };
  }>,
): Promise<void> {
  if (!ctx.userId) return;
  try {
    const { data, error, response } = await request();
    if (error || !data) throwApiError(error, response, title);
    patchRowCache(ctx.queryClient, target, (cache) =>
      mergeHeldServerRow(cache, data as RawChatMessage),
    );
  } catch (err) {
    const { message } = classifyChatError(err);
    ctx.toast?.({ title, description: message, variant: "destructive" });
    ctx.onError?.({ title, description: message });
    throw err;
  }
}

export interface EditMessageArgs extends RowTarget {
  messageId: string;
  content: string;
  /**
   * Members picked while editing (#3835). The ones the message was sent with
   * are kept by the server, so these are only the new ones.
   */
  mentionPicks?: readonly MentionPick[] | null;
}

/**
 * Edit a message's content (own messages only — enforced server-side).
 *
 * Not optimistic like `react`/`unreact`: the row the server returns is the
 * one canonical source for the new `content`/`edited_at`, and `mergeServerRow`
 * is already built to treat this as "a pin/edit UPDATE echo" (see its own
 * docstring) — the same merge a Realtime echo of this same edit would apply,
 * so a duplicate echo from Postgres Changes is a harmless no-op. Both merge
 * only into a cache that holds the row (`mergeHeldServerRow`): an edit of a
 * message the window no longer holds must not splice it back in out of
 * order, which would break older-page paging (#2775, #2871).
 */
export async function editMessage(
  ctx: ChatActionContext,
  args: EditMessageArgs,
): Promise<void> {
  await writeHeldRow(ctx, args, "Couldn't edit message", () =>
    ctx.apiClient.PATCH("/v1/channels/messages/{messageId}", {
      params: { path: { messageId: args.messageId } },
      body: {
        content: args.content,
        mention_picks: args.mentionPicks?.length
          ? [...args.mentionPicks]
          : undefined,
      },
    }),
  );
}

export interface SetMessageFlagArgs extends RowTarget {
  messageId: string;
  /** The flag to put on, or `null` to take the message's flag off. */
  flag: ChatMessageFlag | null;
}

/**
 * Put a flag on a message, replace it, or take it off (#3921). Who may is
 * the server's call (`canChangeMessageFlag`); the client offers the control
 * only where it should work (`canFlagMessage` in `./flags`).
 *
 * Not optimistic, like `editMessage`: the row the server returns carries the
 * flag, the flagger and the time, and merging it is both the confirmation and
 * the update. Everyone else's timeline draws it from the Realtime UPDATE
 * echo, which re-merges the same row as a no-op here. A lost race (someone
 * else changed the flag first) is a 409 the toast explains.
 */
export async function setMessageFlag(
  ctx: ChatActionContext,
  args: SetMessageFlagArgs,
): Promise<void> {
  const path = { params: { path: { messageId: args.messageId } } };
  const flag = args.flag;
  await writeHeldRow(
    ctx,
    args,
    flag ? "Couldn't flag message" : "Couldn't remove flag",
    () =>
      flag
        ? ctx.apiClient.PUT("/v1/channels/messages/{messageId}/flag", {
            ...path,
            body: { flag },
          })
        : ctx.apiClient.DELETE("/v1/channels/messages/{messageId}/flag", path),
  );
}

export interface DeleteMessageArgs extends RowTarget {
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
  await writeHeldRow(ctx, args, "Couldn't delete message", () =>
    ctx.apiClient.DELETE("/v1/channels/messages/{messageId}", {
      params: { path: { messageId: args.messageId } },
    }),
  );
}

export interface ClosePollArgs extends RowTarget {
  messageId: string;
}

/**
 * Close a chat-card poll early (#3794). Its creator or a `channels:manage`
 * holder only (#4046), and refused on a poll that is already closed or past
 * its deadline: the API enforces both
 * (`PollService.close`), the card only offers the control when it should work
 * (`canClosePoll` in `./polls`).
 *
 * Not optimistic, like `deleteMessage`: the server stamps `payload.closed_at`,
 * and the row it returns is merged as the confirmation, so the closer's card
 * draws closed even before the Realtime UPDATE every other client draws it
 * from. A duplicate echo of the same row is a no-op merge.
 */
export async function closePoll(
  ctx: ChatActionContext,
  args: ClosePollArgs,
): Promise<void> {
  await writeHeldRow(ctx, args, "Couldn't close poll", () =>
    ctx.apiClient.POST("/v1/polls/{messageId}/close", {
      params: { path: { messageId: args.messageId } },
    }),
  );
}

export interface CloseCardArgs extends RowTarget {
  messageId: string;
  /** Which card, for the failure toast's words. A sign-up when absent. */
  kind?: "signup" | "form";
}

/** The cards Close takes: a sign-up sheet and a form. */
export type ClosableCardKind = NonNullable<CloseCardArgs["kind"]>;

/**
 * Close a sign-up card (#3926 step 2) or a form card (step 3) early: its
 * creator or a `channels:manage` holder, refused on a card already closed or
 * past its end time (`ChatService.closeCard`); the card offers it only when it
 * should work (`canCloseSignup` in `./signups`, `canCloseForm` in `./forms`).
 * Not optimistic, as {@link closePoll} isn't: the stamped row the server
 * returns is merged as the confirmation.
 */
export async function closeCard(
  ctx: ChatActionContext,
  args: CloseCardArgs,
): Promise<void> {
  const title =
    args.kind === "form"
      ? "Couldn't close the form"
      : "Couldn't close sign-ups";
  await writeHeldRow(ctx, args, title, () =>
    ctx.apiClient.POST("/v1/channels/messages/{messageId}/close", {
      params: { path: { messageId: args.messageId } },
    }),
  );
}

/**
 * What a card action or a poll close needs when it is taken outside the
 * card's thread (the Activity page, #3897): no outbox, no optimistic row, and
 * no toast of its own, since the surface says what failed in its own words.
 */
export interface DetachedCardContext {
  queryClient: QueryClient;
  apiClient: FrappApiClient;
}

/**
 * Merge into the channel's cache only when that channel is already loaded.
 * `patchCache` seeds an empty cache for a channel that has none, which is
 * right inside a thread (the thread is about to fill it) and wrong from
 * outside one: it would leave a cache holding nothing for a channel the
 * member has not opened.
 */
function patchLoadedCache(
  qc: QueryClient,
  channelId: string,
  updater: (cache: ChannelCache) => ChannelCache,
): void {
  qc.setQueryData<ChannelCache>(chatMessagesKey(channelId), (prev) =>
    prev ? updater(prev) : prev,
  );
}

/**
 * {@link actOnCard}'s route and cache contract for a card drawn outside its
 * thread: the same `POST …/actions`, and the same merge of the answer into
 * the channel's cache (when the channel is loaded), so the thread shows the
 * vote the moment the member goes back to it rather than a stale tally. The
 * thread's cache never goes stale by itself, so skipping the merge would
 * leave it wrong until a reload.
 *
 * Throws on a refusal; the caller words the failure.
 */
export async function actOnDetachedCard(
  ctx: DetachedCardContext,
  args: CardActionArgs,
): Promise<void> {
  const { data, error, response } = await ctx.apiClient.POST(
    "/v1/channels/messages/{messageId}/actions",
    {
      params: { path: { messageId: args.messageId } },
      body: {
        action_type: args.actionType,
        // See `actOnCard` for the cast.
        payload: (args.payload ?? undefined) as unknown as undefined,
      },
    },
  );
  if (error || !data) throwApiError(error, response, "Couldn't record action");
  const body = data as { action?: RawChatMessageAction; updated?: boolean };
  if (body.action) {
    const action = body.action;
    patchLoadedCache(ctx.queryClient, args.channelId, (cache) =>
      body.updated
        ? applyActionUpdate(cache, action)
        : applyReactionInsert(cache, action),
    );
  }
}

/**
 * {@link closePoll} for a card drawn outside its thread: the same route, and
 * the closed row merged into the channel's cache when it is loaded. Returns
 * the row the server stamped. Throws on a refusal.
 */
export async function closeDetachedPoll(
  ctx: DetachedCardContext,
  args: ClosePollArgs,
): Promise<RawChatMessage> {
  const { data, error, response } = await ctx.apiClient.POST(
    "/v1/polls/{messageId}/close",
    { params: { path: { messageId: args.messageId } } },
  );
  if (error || !data) throwApiError(error, response, "Couldn't close poll");
  const row = data as RawChatMessage;
  patchLoadedCache(ctx.queryClient, args.channelId, (cache) =>
    mergeHeldServerRow(cache, row),
  );
  return row;
}

export interface CardActionArgs extends RowTarget {
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
      patchRowCache(ctx.queryClient, args, (cache) =>
        body.updated
          ? applyActionUpdate(cache, action)
          : applyReactionInsert(cache, action),
      );
    }
  } catch (err) {
    const { message } = classifyChatError(err);
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
