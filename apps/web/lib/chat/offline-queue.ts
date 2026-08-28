"use client";

/**
 * Dexie-backed offline persistence for the chat composer.
 *
 * Two tables:
 *   - `drafts`     — one row per channel, persisted as the user types.
 *   - `outbox`     — queued messages awaiting a successful POST to the NestJS chat send endpoint.
 *
 * The hot path uses these so:
 *   - drafts survive a tab reload while a user is mid-compose,
 *   - messages composed while offline are kept and flushed in order on
 *     reconnect, and
 *   - a `4xx` failure surfaces inline with a Retry button rather than being
 *     silently lost.
 *
 * `clientId` (a UUID generated client-side and persisted here) doubles as the
 * `chat_messages.client_message_id`, which the Edge Function dedupes on — so
 * retries are idempotent end-to-end.
 */

import Dexie, { type Table } from "dexie";
// Row shapes are canonical on the `@repo/chat-core/adapters` port (OutboxStore).
import type {
  NewOutboxRow,
  OutboxRow,
  OutboxStore,
} from "@repo/chat-core/adapters";

export interface DraftRow {
  channelId: string;
  body: string;
  updatedAt: number;
}

class ChatDB extends Dexie {
  drafts!: Table<DraftRow, string>;
  outbox!: Table<OutboxRow, string>;

  constructor() {
    super("frapp-chat");
    this.version(1).stores({
      drafts: "channelId, updatedAt",
      outbox: "clientId, channelId, queuedAt, status",
    });
  }
}

let cached: ChatDB | null = null;

/**
 * Lazy singleton — `new Dexie()` opens an IndexedDB connection, which we can't
 * do during SSR. Server-side callers get a no-op stub.
 */
export function getChatDB(): ChatDB | null {
  if (typeof window === "undefined") return null;
  if (!cached) cached = new ChatDB();
  return cached;
}

export async function saveDraft(
  channelId: string,
  body: string,
): Promise<void> {
  const db = getChatDB();
  if (!db) return;
  if (body.length === 0) {
    await db.drafts.delete(channelId);
    return;
  }
  await db.drafts.put({ channelId, body, updatedAt: Date.now() });
}

export async function loadDraft(channelId: string): Promise<string> {
  const db = getChatDB();
  if (!db) return "";
  const row = await db.drafts.get(channelId);
  return row?.body ?? "";
}

export async function clearDraft(channelId: string): Promise<void> {
  const db = getChatDB();
  if (!db) return;
  await db.drafts.delete(channelId);
}

async function enqueueOutbox(row: NewOutboxRow): Promise<OutboxRow> {
  const db = getChatDB();
  const full: OutboxRow = {
    attempts: 0,
    status: "queued",
    queuedAt: Date.now(),
    ...row,
  };
  if (!db) return full;
  await db.outbox.put(full);
  return full;
}

async function markOutboxFailed(
  clientId: string,
  error: string,
): Promise<void> {
  const db = getChatDB();
  if (!db) return;
  const existing = await db.outbox.get(clientId);
  if (!existing) return;
  await db.outbox.put({
    ...existing,
    status: "failed",
    attempts: existing.attempts + 1,
    lastError: error,
  });
}

async function bumpOutboxAttempt(
  clientId: string,
  error: string,
): Promise<void> {
  const db = getChatDB();
  if (!db) return;
  const existing = await db.outbox.get(clientId);
  if (!existing) return;
  await db.outbox.put({
    ...existing,
    attempts: existing.attempts + 1,
    lastError: error,
  });
}

async function requeueOutbox(clientId: string): Promise<void> {
  const db = getChatDB();
  if (!db) return;
  const existing = await db.outbox.get(clientId);
  if (!existing) return;
  await db.outbox.put({ ...existing, status: "queued", lastError: undefined });
}

async function dequeueOutbox(clientId: string): Promise<void> {
  const db = getChatDB();
  if (!db) return;
  await db.outbox.delete(clientId);
}

/** All queued rows ordered FIFO — drives the in-order flush loop. */
async function listQueuedOutbox(): Promise<OutboxRow[]> {
  const db = getChatDB();
  if (!db) return [];
  return db.outbox.where("status").equals("queued").sortBy("queuedAt");
}

/** All outbox rows for a channel (queued + failed), used on boot to hydrate the cache. */
async function listOutboxForChannel(
  channelId: string,
): Promise<OutboxRow[]> {
  const db = getChatDB();
  if (!db) return [];
  return db.outbox.where("channelId").equals(channelId).sortBy("queuedAt");
}

export async function getOutboxRow(
  clientId: string,
): Promise<OutboxRow | undefined> {
  const db = getChatDB();
  if (!db) return undefined;
  return db.outbox.get(clientId);
}

/**
 * The web `OutboxStore`: the Dexie functions above, surfaced through the
 * `@repo/chat-core/adapters` `OutboxStore` port (`ChatActionContext.outbox`).
 * A module const so React callers can close over it without memoization.
 */
export const dexieOutboxStore: OutboxStore = {
  enqueue: enqueueOutbox,
  dequeue: dequeueOutbox,
  requeue: requeueOutbox,
  markFailed: markOutboxFailed,
  bumpAttempt: bumpOutboxAttempt,
  listQueued: listQueuedOutbox,
  listForChannel: listOutboxForChannel,
  clearDraft,
};
