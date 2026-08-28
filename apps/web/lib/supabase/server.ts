import { type CookieOptions, createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Read Supabase env vars at call time so that modules importing this file do
 * not crash in environments without production secrets (e.g. the CI
 * Playwright job). Throws a descriptive error only when the server client is
 * actually constructed without the required env.
 */
function getSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Supabase env vars missing. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to use the Supabase server client.",
    );
  }
  return { url, anonKey };
}

export async function createSupabaseServerClient() {
  const { url, anonKey } = getSupabaseEnv();
  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(
        cookiesToSet: {
          name: string;
          value: string;
          options: CookieOptions;
        }[],
      ) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Expected when called from a Server Component where cookies are read-only.
        }
      },
    },
  });
}
