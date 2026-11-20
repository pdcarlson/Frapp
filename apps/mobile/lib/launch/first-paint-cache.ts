import AsyncStorage from "@react-native-async-storage/async-storage";
import type { QueryClient } from "@tanstack/react-query";
import { emptyCache, mergeServerRows } from "@repo/chat-core/cache";
import {
  FIRST_CHUNK_CHANNEL_LIMIT,
  FIRST_CHUNK_MAX_AGE_MS,
  TAIL_ROW_FORMAT,
  hasServerRows,
  seedQuery,
} from "@repo/chat-core/first-chunk";
import {
  chatMessagesKey,
  type ChannelCache,
  type RawChatMessage,
} from "@repo/chat-core/types";
import { CHANNEL_LIST_KEY } from "@repo/hooks";
import { sessionStorageAdapter } from "@/lib/supabase";
import { holdBlockFloor } from "./kept-block-floor";

/**
 * What the phone keeps of chat between launches, so a cold start (or the
 * reload an over-the-air update makes) paints the member's chat at once and
 * the network reconciles underneath (#5768). The phone's counterpart of web's
 * first chunk (`apps/web/lib/chat/first-chunk-cache.ts`): the limits, the
 * tail encoding, the tail filter and the seed are shared with it
 * (`@repo/chat-core/first-chunk`). Its row in the cache table:
 * `spec/ui/resilience/caching.md`.
 *
 * Without it every launch waited on the channel list, `/v1/users/me` and the
 * last channel's messages before the launch logo could lift, and the logo's
 * 4 s cap (`lib/launch/launch-gate.ts`) was where many opens ended.
 *
 * ## What it is not
 *
 * Not a query-cache persister. `caching.md` rules that out because a persister
 * restores keys that carry no identity (`["user","me"]`, `["settings"]`) to
 * whoever signs in next. This keeps four named things and nothing else, each
 * filed under the **Supabase auth uid** it was read for (and the chapter, for
 * chapter-scoped ones), and reads them back only for the identity the live
 * session names.
 *
 * ## What it holds
 *
 * - **`/v1/users/me`, whole, in the keychain** (SecureStore, through the
 *   session's own chunked adapter). Web keeps only the viewer's `users.id`
 *   and never seeds `["user","me"]`, because a partial profile there would be
 *   a worse bug than a slow one; the phone's chat runtime, chat home's launch
 *   jump and the thread all read `users.id` through `["user","me"]`
 *   (`useViewerUserId`), so the phone keeps the whole row instead of a part.
 *   It holds personal details, which is why it is encrypted at rest like the
 *   sign-in itself (Paul, 2026-11-20). `users.id` never changes for an auth
 *   uid, so a write made under the seeded id is made under the id the live
 *   read gives.
 * - **The channel list** (`["channels"]`), exactly as the query holds it.
 * - **Message tails**: the newest confirmed rows of the last few channels the
 *   member opened, in the wire shape at {@link TAIL_ROW_FORMAT}, rehydrated
 *   through `mergeServerRows`.
 * - **The block list's floor**: the ids the last ready read named, never
 *   seeded into the block list's query (that would report a list nobody read
 *   as `ready`, `applyConfirmedBlockChange`'s warning in `@repo/hooks`), but
 *   unioned into the thread's block state until the live list has been read
 *   (`kept-block-floor.ts`, `use-thread-block-list.ts`), as web's floor is (#2688). Not aged, for
 *   web's reason: the tails it guards are rewritten fresh while keeping old
 *   verdicts, so a floor that expired first would un-hide them.
 *
 * ## Failure posture
 *
 * Every entry point swallows. A failure costs one ordinary cold launch.
 */

const PREFIX = "frapp.firstpaint.";

/** The keychain key for the profile: one per phone, tagged with its auth uid. */
export const ME_KEY = "frapp.firstpaint.me";

/**
 * The encoding of what is kept. A copy in any other is ignored and replaced
 * by the next write. Tails also carry `rowFormat`, the shared tail encoding.
 */
export const FIRST_PAINT_FORMAT = 2;

type ScopedPart = "channels" | "blocks" | "tails";

export interface KeptAnswer<T> {
  cachedAt: number;
  data: T;
}

export interface KeptTail {
  channelId: string;
  cachedAt: number;
  rowFormat: number;
  rows: RawChatMessage[];
}

export interface FirstPaint {
  me: KeptAnswer<object> | null;
  channels: KeptAnswer<unknown[]> | null;
  blockFloor: string[] | null;
  tails: KeptTail[];
}

const EMPTY: FirstPaint = {
  me: null,
  channels: null,
  blockFloor: null,
  tails: [],
};

/**
 * Bumped by {@link forgetFirstPaint}. A write captures it when its scope
 * starts and is dropped once it has moved, so a write still pending when the
 * member signs out can't put their copy back after the wipe.
 */
let generation = 0;

export function firstPaintGeneration(): number {
  return generation;
}

/**
 * The scope's key for one part: the auth uid, known as soon as the session is
 * restored, and the chapter, with a stable name for a token that names none
 * (the unread memory's scoping, `lib/chat/unread-memory.ts`).
 */
export function firstPaintKey(
  userId: string,
  chapterId: string | null,
  part: ScopedPart,
): string {
  return `${PREFIX}${userId}.${chapterId ?? "sole"}.${part}`;
}

function fresh(cachedAt: unknown, now: number): cachedAt is number {
  return (
    typeof cachedAt === "number" &&
    cachedAt <= now &&
    now - cachedAt <= FIRST_CHUNK_MAX_AGE_MS
  );
}

function parse(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function current(
  row: Record<string, unknown> | null,
): row is Record<string, unknown> {
  return row?.format === FIRST_PAINT_FORMAT;
}

function readMe(
  raw: string | null,
  userId: string,
  now: number,
): KeptAnswer<object> | null {
  const row = parse(raw);
  if (!current(row) || row.authUid !== userId || !fresh(row.cachedAt, now)) {
    return null;
  }
  const data = row.data;
  return data && typeof data === "object"
    ? { cachedAt: row.cachedAt, data }
    : null;
}

function readChannels(
  raw: string | null | undefined,
  now: number,
): KeptAnswer<unknown[]> | null {
  const row = parse(raw);
  if (!current(row) || !fresh(row.cachedAt, now) || !Array.isArray(row.data)) {
    return null;
  }
  return { cachedAt: row.cachedAt, data: row.data };
}

function readFloor(raw: string | null | undefined): string[] | null {
  const row = parse(raw);
  if (!current(row) || !Array.isArray(row.ids)) return null;
  return row.ids.every((id) => typeof id === "string")
    ? (row.ids as string[])
    : null;
}

function readTails(raw: string | null | undefined, now: number): KeptTail[] {
  const row = parse(raw);
  if (!current(row) || !Array.isArray(row.tails)) return [];
  return row.tails.filter(
    (tail): tail is KeptTail =>
      !!tail &&
      typeof tail === "object" &&
      typeof (tail as KeptTail).channelId === "string" &&
      (tail as KeptTail).rowFormat === TAIL_ROW_FORMAT &&
      fresh((tail as KeptTail).cachedAt, now) &&
      Array.isArray((tail as KeptTail).rows),
  );
}

/** Everything kept for this member and chapter, or nothing. */
export async function readFirstPaint(
  userId: string,
  chapterId: string | null,
  now: number = Date.now(),
): Promise<FirstPaint> {
  try {
    const parts: ScopedPart[] = ["channels", "blocks", "tails"];
    const [me, rows] = await Promise.all([
      sessionStorageAdapter.getItem(ME_KEY),
      AsyncStorage.multiGet(
        parts.map((part) => firstPaintKey(userId, chapterId, part)),
      ),
    ]);
    const [channels, blocks, tails] = rows.map(([, raw]) => raw);
    return {
      me: readMe(me, userId, now),
      channels: readChannels(channels, now),
      blockFloor: readFloor(blocks),
      tails: readTails(tails, now),
    };
  } catch {
    return EMPTY;
  }
}

/** One write of the scope that captured `writeGeneration`, or nothing. */
function write(writeGeneration: number, run: () => Promise<void>): void {
  if (writeGeneration !== generation) return;
  void run().catch(() => undefined);
}

export function writeKeptMe(
  writeGeneration: number,
  userId: string,
  data: unknown,
  cachedAt: number,
): void {
  write(writeGeneration, async () =>
    sessionStorageAdapter.setItem(
      ME_KEY,
      JSON.stringify({
        format: FIRST_PAINT_FORMAT,
        authUid: userId,
        cachedAt,
        data,
      }),
    ),
  );
}

export function writeKeptChannels(
  writeGeneration: number,
  userId: string,
  chapterId: string | null,
  data: unknown,
  cachedAt: number,
): void {
  write(writeGeneration, () =>
    AsyncStorage.setItem(
      firstPaintKey(userId, chapterId, "channels"),
      JSON.stringify({ format: FIRST_PAINT_FORMAT, cachedAt, data }),
    ),
  );
}

export function writeKeptBlockFloor(
  writeGeneration: number,
  userId: string,
  chapterId: string | null,
  ids: readonly string[],
): void {
  write(writeGeneration, () =>
    AsyncStorage.setItem(
      firstPaintKey(userId, chapterId, "blocks"),
      JSON.stringify({ format: FIRST_PAINT_FORMAT, ids }),
    ),
  );
}

export function writeKeptTails(
  writeGeneration: number,
  userId: string,
  chapterId: string | null,
  tails: readonly KeptTail[],
): void {
  write(writeGeneration, () =>
    AsyncStorage.setItem(
      firstPaintKey(userId, chapterId, "tails"),
      JSON.stringify({ format: FIRST_PAINT_FORMAT, tails }),
    ),
  );
}

/**
 * The tails with `tail` first, at most `FIRST_CHUNK_CHANNEL_LIMIT`: only
 * channels the member opened are written (read-aheads are not), and the one
 * opened last is the one the next launch most likely lands in.
 */
export function withTail(
  tails: readonly KeptTail[],
  tail: KeptTail,
): KeptTail[] {
  return [
    tail,
    ...tails.filter((other) => other.channelId !== tail.channelId),
  ].slice(0, FIRST_CHUNK_CHANNEL_LIMIT);
}

export function withoutTail(
  tails: readonly KeptTail[],
  channelId: string,
): KeptTail[] {
  return tails.filter((tail) => tail.channelId !== channelId);
}

/**
 * Fills the query cache from the kept copy wherever nothing is there yet,
 * with the copy's own age, marked stale so the server's answer replaces it
 * (`seedQuery`). A fetch that already answered outranks anything on disk.
 */
export function seedFirstPaint(
  queryClient: QueryClient,
  kept: FirstPaint,
): void {
  if (kept.me && queryClient.getQueryData(["user", "me"]) === undefined) {
    seedQuery(queryClient, ["user", "me"], kept.me.data, kept.me.cachedAt);
  }
  if (
    kept.channels &&
    queryClient.getQueryData(CHANNEL_LIST_KEY) === undefined
  ) {
    seedQuery(
      queryClient,
      CHANNEL_LIST_KEY,
      kept.channels.data,
      kept.channels.cachedAt,
    );
  }
  for (const tail of kept.tails) {
    const key = chatMessagesKey(tail.channelId);
    const existing = queryClient.getQueryData<ChannelCache>(key);
    if (hasServerRows(existing)) continue;
    // Merged onto what is there: the outbox's queued rows keep their place.
    seedQuery(
      queryClient,
      key,
      mergeServerRows(existing ?? emptyCache(), tail.rows),
      tail.cachedAt,
    );
  }
}

/**
 * Drops every member's kept copy on this phone. Sign-out and an account swap
 * call it through `clearProductQueryCache`, and the generation bump stops any
 * write still pending from the outgoing scope. Best effort.
 */
export function forgetFirstPaint(): void {
  generation += 1;
  holdBlockFloor(null);
  void Promise.resolve()
    .then(() => sessionStorageAdapter.removeItem(ME_KEY))
    .catch(() => undefined);
  void Promise.resolve()
    .then(() => AsyncStorage.getAllKeys())
    .then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith(PREFIX))
          .map((key) => AsyncStorage.removeItem(key)),
      ),
    )
    .catch(() => undefined);
}
