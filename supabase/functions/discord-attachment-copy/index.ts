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

// A safety net. Deno treats an unhandled rejection as fatal, which would take
// down the request and every other transfer in it. The one case seen, the hard
// deadline erroring a CDN body the runtime was piping into an upload (Deno
// 2.9.6, #2848's review), is fixed in `copyOne`, which detaches the deadline
// from the CDN body once the headers arrive. Anything else is logged, and the
// handler reports each item's outcome as usual.
addEventListener("unhandledrejection", (event) => {
  event.preventDefault();
  console.warn("discord-attachment-copy: unhandled rejection", event.reason);
});

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
