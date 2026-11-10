/**
 * The last `GET /v1/channels/unread` answer, kept on the phone so a cold start
 * has counts to show before the request answers (#4006). What reads it and
 * when: `unread-first-paint.ts`. Its row in the cache table:
 * `spec/ui/resilience/caching.md`.
 *
 * Apart from that file so `lib/query-client.ts` can forget it on sign-out
 * without importing `lib/auth-session.tsx`, which imports the query client.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ChannelUnreadCount } from "@repo/hooks";

const PREFIX = "frapp.chat.unread.";

/**
 * Scoped by the Supabase auth uid, which is known as soon as the session is
 * restored (`users.id` waits on `/v1/users/me`, one of the slow requests), and
 * by chapter, with a stable name for a token that carries none (a sole
 * membership the server resolves, a normal state: `lib/chat/last-channel.ts`).
 */
export function unreadMemoryKey(
  userId: string,
  chapterId: string | null,
): string {
  return `${PREFIX}${userId}.${chapterId ?? "sole"}`;
}

function isUnreadRow(value: unknown): value is ChannelUnreadCount {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.channel_id === "string" &&
    typeof row.unread_count === "number" &&
    typeof row.mention_count === "number"
  );
}

/** `value` as an unread answer, or `null` for anything that isn't one. */
export function asUnreadRows(value: unknown): ChannelUnreadCount[] | null {
  return Array.isArray(value) && value.every(isUnreadRow) ? value : null;
}

export async function readUnreadMemory(
  key: string,
): Promise<ChannelUnreadCount[] | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? asUnreadRows(JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

export function writeUnreadMemory(key: string, serialized: string): void {
  AsyncStorage.setItem(key, serialized).catch(() => {
    /* Best-effort: the next launch starts with no saved counts. */
  });
}

/**
 * Drops every saved answer on this phone. Sign-out and an account swap call it
 * through `clearProductQueryCache`, like the other things that outlive the
 * query cache, so the next sign-in starts with none. Best effort.
 */
export function forgetUnreadMemory(): void {
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
