/**
 * Entry point for the `discord-attachment-copy` Edge Function (#2848).
 *
 * Only wiring: the behaviour and its reasons live in `handler.ts`, which takes
 * its `fetch`, clock and environment as arguments so `handler.test.ts` can run
 * it without a network. Called by the API's `SupabaseArchiveMediaCopier`.
 *
 * `verify_jwt = false` in `supabase/config.toml`: the handler checks the
 * caller's service credential itself, because the platform's JWT check does
 * not understand the newer `sb_secret_…` keys.
 */
import { handleCopyRequest } from "./handler.ts";

Deno.serve(async (request) => {
  try {
    return await handleCopyRequest(request, {
      fetch,
      now: () => performance.now(),
      env: (name) => Deno.env.get(name),
    });
  } catch (error) {
    console.error("discord-attachment-copy failed", error);
    return new Response(
      JSON.stringify({ error: "The copy failed unexpectedly." }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }
});
