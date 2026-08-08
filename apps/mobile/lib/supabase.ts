import {
  createClient,
  type SupabaseClient,
  type SupportedStorage,
} from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";

/**
 * SecureStore rejects values over 2048 bytes on Android, and a Supabase session
 * — access token carrying `custom_access_token_hook` claims, refresh token, and
 * the full user record — routinely exceeds that. Chunk at 600 JS characters so
 * even an all-multi-byte value stays under the limit (3 bytes/char worst case
 * = 1800 bytes).
 */
const CHUNK_SIZE = 600;

function chunkKey(key: string, index: number): string {
  return `${key}.${index}`;
}

async function readChunkCount(key: string): Promise<number> {
  const raw = await SecureStore.getItemAsync(key);
  if (raw === null) return 0;
  const count = Number.parseInt(raw, 10);
  return Number.isInteger(count) && count > 0 ? count : 0;
}

/**
 * Session storage for supabase-js.
 *
 * The base key holds the chunk *count*, not the value; the value lives in
 * `${key}.0 … ${key}.n-1`. There is no atomic multi-key write available, so the
 * count is zeroed before the chunks are rewritten: a crash mid-write then reads
 * back as "no session" (forcing a re-auth) rather than as a torn session that
 * would be parsed as real.
 */
const secureStoreAdapter: SupportedStorage = {
  async getItem(key: string): Promise<string | null> {
    try {
      const count = await readChunkCount(key);
      if (count === 0) return null;

      const chunks: string[] = [];
      for (let index = 0; index < count; index += 1) {
        const chunk = await SecureStore.getItemAsync(chunkKey(key, index));
        // A missing chunk means the write was interrupted. Treat the whole
        // value as absent rather than returning a truncated JSON blob.
        if (chunk === null) return null;
        chunks.push(chunk);
      }
      return chunks.join("");
    } catch {
      return null;
    }
  },

  async setItem(key: string, value: string): Promise<void> {
    const previousCount = await readChunkCount(key);

    const chunks: string[] = [];
    for (let offset = 0; offset < value.length; offset += CHUNK_SIZE) {
      chunks.push(value.slice(offset, offset + CHUNK_SIZE));
    }
    // An empty string still needs one chunk, or the count would read as "absent".
    if (chunks.length === 0) chunks.push("");

    await SecureStore.setItemAsync(key, "0");
    for (let index = 0; index < chunks.length; index += 1) {
      await SecureStore.setItemAsync(chunkKey(key, index), chunks[index]);
    }
    await SecureStore.setItemAsync(key, String(chunks.length));

    // Drop chunks left over from a longer previous value.
    for (let index = chunks.length; index < previousCount; index += 1) {
      await SecureStore.deleteItemAsync(chunkKey(key, index));
    }
  },

  async removeItem(key: string): Promise<void> {
    const count = await readChunkCount(key);
    await SecureStore.deleteItemAsync(key);
    for (let index = 0; index < count; index += 1) {
      await SecureStore.deleteItemAsync(chunkKey(key, index));
    }
  },
};

let cachedClient: SupabaseClient | null | undefined;

/**
 * True when both `EXPO_PUBLIC_SUPABASE_*` values are present.
 *
 * They are required to sign in but deliberately optional at boot: local
 * checkouts and CI run typecheck/tests without them, and `createClient` throws
 * on an empty URL, so construction is lazy and returns `null` instead.
 */
export function isSupabaseConfigured(): boolean {
  return supabaseUrl.length > 0 && supabaseAnonKey.length > 0;
}

/** The app-wide Supabase client, or `null` when the env vars are absent. */
export function getSupabaseClient(): SupabaseClient | null {
  if (cachedClient !== undefined) return cachedClient;

  if (!isSupabaseConfigured()) {
    cachedClient = null;
    return cachedClient;
  }

  cachedClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      storage: secureStoreAdapter,
      persistSession: true,
      autoRefreshToken: true,
      // Native apps never carry a session in a page URL. Magic-link callbacks
      // arrive as deep links and are exchanged explicitly in AuthSessionProvider.
      detectSessionInUrl: false,
    },
  });

  return cachedClient;
}

/** Test seam — drops the memoized client so env changes take effect. */
export function resetSupabaseClientForTests(): void {
  cachedClient = undefined;
}
