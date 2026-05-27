/**
 * Edge Function: chat-react
 *
 * POST handler for adding a reaction / action to a chat message.
 * Validates via Zod, inserts into chat_message_actions with idempotent
 * dedupe: unique on (message_id, user_id, action_type).
 * Actor identity comes from auth.uid() — never the client payload.
 */

import { createClient } from "@supabase/supabase-js";
import { ChatMessageActionSchema } from "@repo/validation";
import { corsResponse, errorResponse, jsonResponse } from "../_shared/cors.ts";
import { assertMessageAccess, resolveAppUserId } from "../_shared/chat-authz.ts";

export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return corsResponse();
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  // ── Auth ─────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return errorResponse("Missing or invalid authorization header", 401);
  }
  const jwt = authHeader.slice(7);

  const serviceSupabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const anonSupabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: `Bearer ${jwt}` } } },
  );

  const { data: { user }, error: authError } = await anonSupabase.auth.getUser(jwt);
  if (authError || !user) {
    return errorResponse("Unauthorized", 401);
  }

  const userResolution = await resolveAppUserId(serviceSupabase, user.id);
  if (!userResolution.ok) {
    return errorResponse(userResolution.message, userResolution.status);
  }
  const userId = userResolution.userId;

  // ── Validate ──────────────────────────────────────────────────────────────
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse("Invalid JSON body");
  }

  const parsed = ChatMessageActionSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(parsed.error.issues.map((i) => i.message).join("; "));
  }

  const { message_id, action_type, payload } = parsed.data;

  // ── Authorize: caller must be able to read the message's channel ─────────
  // Resolved from a trusted lookup (message → channel → chapter → membership)
  // before the service-role write.
  const authz = await assertMessageAccess(serviceSupabase, userId, message_id);
  if (!authz.ok) {
    return errorResponse(authz.message, authz.status);
  }

  // ── Atomic idempotent insert (unique on message_id + user_id + action_type)
  // No read-then-insert pre-check: the unique index is the source of truth.
  //
  // Poll vote semantics (ADR-07): `action_type === "vote"` is an UPSERT — a
  // user changing their option updates the row's `payload` + `created_at` in
  // place rather than creating a second row. Emoji reactions
  // (`action_type` starting with `reaction:`) keep the 23505 → select-existing
  // dedup path so a duplicate emoji-react is a no-op.
  const VOTE_ACTION_TYPE = "vote";
  const isVote = action_type === VOTE_ACTION_TYPE;

  const { data: action, error: insertError } = await serviceSupabase
    .from("chat_message_actions")
    .insert({ message_id, user_id: userId, action_type, payload: payload ?? {} })
    .select("*")
    .single();

  if (insertError) {
    if ((insertError as { code?: string }).code === "23505") {
      if (isVote) {
        // Vote-change: overwrite payload + created_at on the existing row
        // keyed by the unique index. The shared row id stays stable so any
        // already-subscribed client can match the Realtime UPDATE.
        const { data: updated, error: updateError } = await serviceSupabase
          .from("chat_message_actions")
          .update({ payload: payload ?? {}, created_at: new Date().toISOString() })
          .eq("message_id", message_id)
          .eq("user_id", userId)
          .eq("action_type", action_type)
          .select("*")
          .single();
        if (updateError || !updated) {
          return errorResponse("Failed to update vote", 500);
        }
        return jsonResponse({ action: updated, deduplicated: false, updated: true });
      }
      const { data: deduped, error: dedupError } = await serviceSupabase
        .from("chat_message_actions")
        .select("*")
        .eq("message_id", message_id)
        .eq("user_id", userId)
        .eq("action_type", action_type)
        .single();
      if (dedupError || !deduped) {
        return errorResponse("Failed to record action", 500);
      }
      return jsonResponse({ action: deduped, deduplicated: true });
    }
    return errorResponse("Failed to record action", 500);
  }

  return jsonResponse({ action, deduplicated: false }, 201);
}

// Only bind a port when the file is the deployment entrypoint. Tests that
// `import { handler }` get the function without spawning a real server.
if (import.meta.main) {
  Deno.serve(handler);
}
