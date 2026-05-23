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

Deno.serve(async (req: Request) => {
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

  const { data: appUser } = await serviceSupabase
    .from("users")
    .select("id")
    .eq("supabase_auth_id", user.id)
    .single();

  if (!appUser) {
    return errorResponse("User not found", 404);
  }

  const userId: string = (appUser as { id: string }).id;

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

  // ── Idempotent upsert (unique on message_id + user_id + action_type) ─────
  // Use ON CONFLICT DO NOTHING — re-adding the same reaction is a no-op.
  const { data: existing } = await serviceSupabase
    .from("chat_message_actions")
    .select("*")
    .eq("message_id", message_id)
    .eq("user_id", userId)
    .eq("action_type", action_type)
    .maybeSingle();

  if (existing) {
    return jsonResponse({ action: existing, deduplicated: true });
  }

  const { data: action, error: insertError } = await serviceSupabase
    .from("chat_message_actions")
    .insert({ message_id, user_id: userId, action_type, payload: payload ?? {} })
    .select("*")
    .single();

  if (insertError) {
    return errorResponse("Failed to record action", 500);
  }

  return jsonResponse({ action, deduplicated: false }, 201);
});
