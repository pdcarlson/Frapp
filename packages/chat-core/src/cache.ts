/**
 * Pure, immutable operations on the normalized per-channel chat cache.
 *
 * Every function returns a new `ChannelCache` (never mutates) so React Query's
 * structural sharing and re-render detection work. `mergeServerRow` is the one
 * idempotent entry point shared by the Edge Function response, the Postgres
 * Changes echo, and the REST backfill — whichever arrives first wins and the
 * rest are no-ops, keyed simultaneously on `client_message_id` and server `id`.
 */

import {
  type ChannelCache,
  type ChatMessage,
  type RawChatMessage,
  type RawChatMessageAction,
  normalizeRow,
} from "./types";

export function emptyCache(): ChannelCache {
  return { byId: {}, order: [], actionIndex: {} };
}

function createdAtOf(cache: ChannelCache, key: string): string {
  return cache.byId[key]?.created_at ?? "";
}

/** Binary-searches `order` for the insert position keeping it ascending by created_at. */
function insertIndex(cache: ChannelCache, createdAt: string): number {
  const { order } = cache;
  let lo = 0;
  let hi = order.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (createdAtOf(cache, order[mid]!) <= createdAt) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Inserts an already-stored key into `order` at its sorted position. */
function withOrderedKey(cache: ChannelCache, key: string): string[] {
  if (cache.order.includes(key)) return cache.order;
  const at = insertIndex(cache, createdAtOf(cache, key));
  const next = cache.order.slice();
  next.splice(at, 0, key);
  return next;
}

/** Inserts/updates an optimistic message keyed by its client_message_id. */
export function upsertOptimistic(
  cache: ChannelCache,
  message: ChatMessage,
): ChannelCache {
  const key = message.client_message_id;
  const byId = { ...cache.byId, [key]: message };
  const base: ChannelCache = { ...cache, byId };
  return { ...base, order: withOrderedKey(base, key) };
}

/**
 * Idempotently merges a canonical server row. If an optimistic row with the
 * same `client_message_id` exists, it is replaced (its reactions carried over);
 * if the server id is already present, this is a harmless overwrite.
 */
export function mergeServerRow(
  cache: ChannelCache,
  row: RawChatMessage,
): ChannelCache {
  const incoming = normalizeRow(row);
  const serverKey = incoming.id;
  const clientKey = incoming.client_message_id;

  const byId = { ...cache.byId };
  let order = cache.order;

  // Carry reactions from whichever prior entry exists (server key wins).
  const prior = byId[serverKey] ?? byId[clientKey];
  const reactions = prior?.reactions ?? {};

  // Drop a distinct optimistic entry (key === client_message_id !== server id).
  if (clientKey !== serverKey && byId[clientKey]) {
    delete byId[clientKey];
    order = order.filter((k) => k !== clientKey);
  }

  byId[serverKey] = { ...incoming, reactions };
  const next: ChannelCache = { ...cache, byId, order };
  return { ...next, order: withOrderedKey(next, serverKey) };
}

/** Merges many rows (backfill / initial load). */
export function mergeServerRows(
  cache: ChannelCache,
  rows: RawChatMessage[],
): ChannelCache {
  return rows.reduce((acc, row) => mergeServerRow(acc, row), cache);
}

/** Marks an optimistic message as failed (4xx) so the UI can offer retry. */
export function markFailed(
  cache: ChannelCache,
  clientMessageId: string,
  error: string,
): ChannelCache {
  const existing = cache.byId[clientMessageId];
  if (!existing) return cache;
  return {
    ...cache,
    byId: {
      ...cache.byId,
      [clientMessageId]: { ...existing, _status: "failed", _error: error },
    },
  };
}

/** Removes a message by cache key (server id or client_message_id). */
export function removeMessage(cache: ChannelCache, key: string): ChannelCache {
  if (!cache.byId[key]) return cache;
  const byId = { ...cache.byId };
  delete byId[key];
  return { ...cache, byId, order: cache.order.filter((k) => k !== key) };
}

function dedupePush(list: string[] | undefined, userId: string): string[] {
  const base = list ?? [];
  return base.includes(userId) ? base : [...base, userId];
}

/** Optimistically toggles the viewer's reaction before the server confirms. */
export function toggleReactionLocal(
  cache: ChannelCache,
  messageId: string,
  actionType: string,
  userId: string,
  add: boolean,
): ChannelCache {
  const message = cache.byId[messageId];
  if (!message) return cache;
  const current = message.reactions[actionType] ?? [];
  let nextUsers: string[];
  if (add) {
    nextUsers = current.includes(userId) ? current : [...current, userId];
  } else {
    nextUsers = current.filter((id) => id !== userId);
  }
  const reactions = { ...message.reactions };
  if (nextUsers.length === 0) delete reactions[actionType];
  else reactions[actionType] = nextUsers;
  return {
    ...cache,
    byId: { ...cache.byId, [messageId]: { ...message, reactions } },
  };
}

/** Folds an inbound reaction (INSERT) into its message, idempotent by action id. */
export function applyReactionInsert(
  cache: ChannelCache,
  action: RawChatMessageAction,
): ChannelCache {
  if (cache.actionIndex[action.id]) return cache;
  const message = cache.byId[action.message_id];
  if (!message) return cache; // message not loaded — recovered on backfill
  const reactions = {
    ...message.reactions,
    [action.action_type]: dedupePush(
      message.reactions[action.action_type],
      action.user_id,
    ),
  };
  // Append the raw row so renderers that need the per-row `payload` (poll
  // card option tallies) can read it. Filter out any prior row with the
  // same id (shouldn't happen — guard against duplicate broadcasts).
  const actions = [
    ...message.actions.filter((a) => a.id !== action.id),
    action,
  ];
  return {
    ...cache,
    byId: {
      ...cache.byId,
      [action.message_id]: { ...message, reactions, actions },
    },
    actionIndex: {
      ...cache.actionIndex,
      [action.id]: {
        messageKey: action.message_id,
        actionType: action.action_type,
        userId: action.user_id,
      },
    },
  };
}

/**
 * Applies a vote-change UPSERT (ADR-07). The unique index on
 * `(message_id, user_id, action_type)` collapses any prior row for the
 * same (user, action_type) so the response carries `updated:true` and a
 * fresh payload. The cache replaces that row in place.
 */
export function applyActionUpdate(
  cache: ChannelCache,
  action: RawChatMessageAction,
): ChannelCache {
  const message = cache.byId[action.message_id];
  if (!message) return cache;
  const actions = message.actions.map((a) =>
    a.user_id === action.user_id && a.action_type === action.action_type
      ? action
      : a,
  );
  // Reactions map is keyed by action_type → user ids. Vote-change keeps the
  // same key + same user id, so the user-id list is unchanged; only the
  // per-row payload moves. No `reactions` mutation needed.
  return {
    ...cache,
    byId: {
      ...cache.byId,
      [action.message_id]: { ...message, actions },
    },
    actionIndex: {
      ...cache.actionIndex,
      [action.id]: {
        messageKey: action.message_id,
        actionType: action.action_type,
        userId: action.user_id,
      },
    },
  };
}

/**
 * Removes a reaction (DELETE) using the action-id index, since a Postgres
 * delete event only carries the row id under the default replica identity.
 */
export function applyReactionDelete(
  cache: ChannelCache,
  actionId: string,
): ChannelCache {
  const entry = cache.actionIndex[actionId];
  if (!entry) return cache;
  const actionIndex = { ...cache.actionIndex };
  delete actionIndex[actionId];

  const message = cache.byId[entry.messageKey];
  if (!message) return { ...cache, actionIndex };
  const current = message.reactions[entry.actionType] ?? [];
  const nextUsers = current.filter((id) => id !== entry.userId);
  const reactions = { ...message.reactions };
  if (nextUsers.length === 0) delete reactions[entry.actionType];
  else reactions[entry.actionType] = nextUsers;
  const actions = message.actions.filter((a) => a.id !== actionId);
  return {
    ...cache,
    byId: {
      ...cache.byId,
      [entry.messageKey]: { ...message, reactions, actions },
    },
    actionIndex,
  };
}

/** Records a server reaction id so a later realtime DELETE can resolve it. */
export function indexReactionAction(
  cache: ChannelCache,
  action: RawChatMessageAction,
): ChannelCache {
  return applyReactionInsert(cache, action);
}

/** Materializes the cache into a created_at-ascending message array for rendering. */
export function selectMessages(cache: ChannelCache | undefined): ChatMessage[] {
  if (!cache) return [];
  return cache.order
    .map((key) => cache.byId[key])
    .filter((m): m is ChatMessage => m != null);
}

/** Newest confirmed message id, for the reconnect last-seen cursor. */
export function lastConfirmedId(cache: ChannelCache | undefined): string | null {
  if (!cache) return null;
  for (let i = cache.order.length - 1; i >= 0; i--) {
    const message = cache.byId[cache.order[i]!];
    if (message && message._status === "confirmed") return message.id;
  }
  return null;
}
