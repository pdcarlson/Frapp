import AsyncStorage from "@react-native-async-storage/async-storage";
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { emptyCache, mergeServerRows } from "@repo/chat-core/cache";
import {
  chatMessagesKey,
  toRawRow,
  type ChannelCache,
  type ChatMessage,
  type RawChatMessage,
} from "@repo/chat-core/types";
import { CHANNEL_LIST_KEY, chatBlockKeys } from "@repo/hooks";

/**
 * What the phone keeps of chat between launches so a cold start (or the
 * reload an over-the-air update makes) paints the member's chat at once, and
 * the network reconciles underneath (#5768). The phone's counterpart of web's
 * first chunk (`apps/web/lib/chat/first-chunk-cache.ts`), whose header has the
 * long argument; its row in the cache table is `spec/ui/resilience/caching.md`.
 *
 * Without it every launch waited on the channel list, `/v1/users/me` and the
 * last channel's messages before the launch logo could lift, and the logo's
 * 4 s cap (`lib/launch/launch-gate.ts`) was where many opens ended.
 *
 * ## What it is not
 *
 * Not a query-cache persister. `caching.md` rules that out because a persister
 * restores keys that carry no identity (`["user","me"]`, `["settings"]`) to
 * whoever signs in next. This stores four named answers and nothing else, and
 * every one is filed under the **Supabase auth uid and chapter** it was read
 * under, read back only at the scope the live session names. There is no key
 * under which another member's or another chapter's copy can be read.
 *
 * ## What it holds
 *
 * - **`/v1/users/me`**, whole. Web keeps only the viewer's `users.id` and
 *   never seeds `["user","me"]`, because a partial profile there would be a
 *   worse bug than a slow one. The phone's chat runtime, chat home's launch
 *   jump and the thread all read `users.id` through `["user","me"]`
 *   (`useViewerUserId`), so the phone seeds the whole row instead of a part.
 *   It is the member's own row, on their own phone, under their own auth uid,
 *   and `users.id` never changes for an auth uid, so a write made under the
 *   seeded id is made under the id the live read would give.
 * - **The channel list** (`["channels"]`), exactly as the query holds it.
 * - **The block list read** (`chatBlockKeys.list`), so a cached row from a
 *   member blocked since it was written stays hidden until the live list
 *   lands: web's block floor (#2688). Stale only in the safe direction for
 *   rows already on it.
 * - **Message tails**: the newest {@link TAIL_MESSAGE_LIMIT} confirmed rows of
 *   the {@link TAIL_CHANNEL_LIMIT} channels most recently loaded, in the wire
 *   shape, rehydrated through `mergeServerRows`. Not pending, failed or
 *   notice rows (the outbox and the notice store own those), and not
 *   reactions.
 *
 * ## Seeding is a seed
 *
 * {@link seedFirstPaint} fills a key only while it is empty, with the copy's
 * own age as `updatedAt`, then invalidates it without cancelling a fetch in
 * flight, so whatever the server answers replaces it (web's `seedQuery`).
 *
 * ## Failure posture
 *
 * Every entry point swallows. A failure costs one ordinary cold launch.
 */

const PREFIX = "frapp.firstpaint.";

/** How many messages a tail keeps: the window a cold launch paints. */
export const TAIL_MESSAGE_LIMIT = 30;

/** How many channels keep a tail. The launch lands in the newest one. */
export const TAIL_CHANNEL_LIMIT = 3;

/**
 * How old a copy may be and still paint. The reconcile makes any age correct
 * within a second; this keeps a weeks-old timeline from painting as real, and
 * keeps an abandoned sign-in from holding chat on the phone for ever.
 */
export const FIRST_PAINT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The encoding of what is stored. A copy in any other is ignored and
 * replaced by the next write. Bump it whenever a stored shape's meaning
 * changes.
 */
export const FIRST_PAINT_FORMAT = 1;

export type FirstPaintPart = "me" | "channels" | "blocks" | "tails";

export interface StoredAnswer<T> {
  format: number;
  cachedAt: number;
  data: T;
}

export interface StoredTail {
  channelId: string;
  cachedAt: number;
  rows: RawChatMessage[];
}

export interface FirstPaint {
  me: StoredAnswer<unknown> | null;
  channels: StoredAnswer<unknown> | null;
  blocks: StoredAnswer<{ ids: string[] }> | null;
  tails: StoredTail[];
}

const EMPTY: FirstPaint = { me: null, channels: null, blocks: null, tails: [] };

/**
 * The scope's key for one part. Scoped like the unread memory
 * (`lib/chat/unread-memory.ts`): the auth uid, known as soon as the session is
 * restored, and the chapter, with a stable name for a token that names none.
 */
export function firstPaintKey(
  userId: string,
  chapterId: string | null,
  part: FirstPaintPart,
): string {
  return `${PREFIX}${userId}.${chapterId ?? "sole"}.${part}`;
}

function fresh(cachedAt: unknown, now: number): cachedAt is number {
  return (
    typeof cachedAt === "number" &&
    cachedAt <= now &&
    now - cachedAt < FIRST_PAINT_MAX_AGE_MS
  );
}

function asAnswer<T>(
  value: unknown,
  now: number,
  isData: (data: unknown) => data is T,
): StoredAnswer<T> | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<StoredAnswer<unknown>>;
  if (row.format !== FIRST_PAINT_FORMAT || !fresh(row.cachedAt, now)) {
    return null;
  }
  return isData(row.data)
    ? { format: row.format, cachedAt: row.cachedAt, data: row.data }
    : null;
}

function isObject(data: unknown): data is object {
  return !!data && typeof data === "object";
}

function isBlockIds(data: unknown): data is { ids: string[] } {
  return (
    isObject(data) &&
    Array.isArray((data as { ids?: unknown }).ids) &&
    (data as { ids: unknown[] }).ids.every((id) => typeof id === "string")
  );
}

function asTails(value: unknown, now: number): StoredTail[] {
  if (!value || typeof value !== "object") return [];
  const row = value as { format?: unknown; tails?: unknown };
  if (row.format !== FIRST_PAINT_FORMAT || !Array.isArray(row.tails)) return [];
  return row.tails.filter(
    (tail): tail is StoredTail =>
      isObject(tail) &&
      typeof (tail as StoredTail).channelId === "string" &&
      fresh((tail as StoredTail).cachedAt, now) &&
      Array.isArray((tail as StoredTail).rows),
  );
}

function parse(raw: string | null | undefined): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/** Everything kept for this member and chapter, or nothing. */
export async function readFirstPaint(
  userId: string,
  chapterId: string | null,
  now: number = Date.now(),
): Promise<FirstPaint> {
  try {
    const parts: FirstPaintPart[] = ["me", "channels", "blocks", "tails"];
    const rows = await AsyncStorage.multiGet(
      parts.map((part) => firstPaintKey(userId, chapterId, part)),
    );
    const [me, channels, blocks, tails] = rows.map(([, raw]) => parse(raw));
    return {
      me: asAnswer(me, now, isObject),
      channels: asAnswer(channels, now, Array.isArray),
      blocks: asAnswer(blocks, now, isBlockIds),
      tails: asTails(tails, now),
    };
  } catch {
    return EMPTY;
  }
}

/** Keeps one answer for the next launch. Best effort. */
export function writeFirstPaintAnswer(
  userId: string,
  chapterId: string | null,
  part: Exclude<FirstPaintPart, "tails">,
  data: unknown,
  cachedAt: number,
): void {
  const row: StoredAnswer<unknown> = {
    format: FIRST_PAINT_FORMAT,
    cachedAt,
    data,
  };
  AsyncStorage.setItem(
    firstPaintKey(userId, chapterId, part),
    JSON.stringify(row),
  ).catch(() => undefined);
}

/**
 * The tails list with `tail` first, at most {@link TAIL_CHANNEL_LIMIT}: the
 * channel loaded last is the one the next launch most likely lands in.
 */
export function withTail(
  tails: readonly StoredTail[],
  tail: StoredTail,
): StoredTail[] {
  return [
    tail,
    ...tails.filter((other) => other.channelId !== tail.channelId),
  ].slice(0, TAIL_CHANNEL_LIMIT);
}

export function writeFirstPaintTails(
  userId: string,
  chapterId: string | null,
  tails: readonly StoredTail[],
): void {
  AsyncStorage.setItem(
    firstPaintKey(userId, chapterId, "tails"),
    JSON.stringify({ format: FIRST_PAINT_FORMAT, tails }),
  ).catch(() => undefined);
}

/**
 * The confirmed tail of a timeline in the wire shape, newest
 * {@link TAIL_MESSAGE_LIMIT}. Every other status belongs to the outbox or the
 * notice store, which replay on top of whatever this seeds.
 */
export function toCacheableRows(
  messages: readonly ChatMessage[],
): RawChatMessage[] {
  return messages
    .filter((message) => message._status === "confirmed")
    .slice(-TAIL_MESSAGE_LIMIT)
    .map(toRawRow);
}

function hasServerRows(cache: ChannelCache | undefined): boolean {
  return (
    !!cache &&
    Object.values(cache.byId).some((message) => message._status === "confirmed")
  );
}

function seed(
  queryClient: QueryClient,
  queryKey: QueryKey,
  data: unknown,
  cachedAt: number,
): void {
  // The copy's own age, so it is born as old as it is.
  queryClient.setQueryData(queryKey, data, { updatedAt: cachedAt });
  // Stale at once, so the screen that reads it refetches; `cancelRefetch:
  // false` keeps a fetch already on its way rather than restarting it.
  void queryClient.invalidateQueries(
    { queryKey, exact: true },
    { cancelRefetch: false },
  );
}

/**
 * Fills the query cache from the kept copy wherever nothing is there yet. A
 * fetch that already answered outranks anything on disk.
 */
export function seedFirstPaint(
  queryClient: QueryClient,
  chapterId: string | null,
  kept: FirstPaint,
): void {
  if (kept.me && queryClient.getQueryData(["user", "me"]) === undefined) {
    seed(queryClient, ["user", "me"], kept.me.data, kept.me.cachedAt);
  }
  if (
    kept.channels &&
    queryClient.getQueryData(CHANNEL_LIST_KEY) === undefined
  ) {
    seed(
      queryClient,
      CHANNEL_LIST_KEY,
      kept.channels.data,
      kept.channels.cachedAt,
    );
  }
  if (kept.blocks && chapterId) {
    const key = chatBlockKeys.list(chapterId);
    if (queryClient.getQueryData(key) === undefined) {
      // `readSeq: 0`: no block change has been made in this process yet, so
      // every one this session confirms applies on top of the kept ids.
      seed(
        queryClient,
        key,
        { ids: kept.blocks.data.ids, readSeq: 0 },
        kept.blocks.cachedAt,
      );
    }
  }
  for (const tail of kept.tails) {
    const key = chatMessagesKey(tail.channelId);
    const existing = queryClient.getQueryData<ChannelCache>(key);
    if (hasServerRows(existing)) continue;
    // Merged onto what is there: the outbox's queued rows keep their place.
    seed(
      queryClient,
      key,
      mergeServerRows(existing ?? emptyCache(), tail.rows),
      tail.cachedAt,
    );
  }
}

/**
 * Drops every member's kept copy on this phone. Sign-out and an account swap
 * call it through `clearProductQueryCache`. Best effort.
 */
export function forgetFirstPaint(): void {
  void Promise.resolve()
    .then(() => AsyncStorage.getAllKeys())
    .then((keys) =>
      AsyncStorage.multiRemove(keys.filter((key) => key.startsWith(PREFIX))),
    )
    .catch(() => undefined);
}
