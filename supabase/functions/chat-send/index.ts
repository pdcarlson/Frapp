/**
 * Edge Function: chat-send
 *
 * POST handler for sending a chat message on the hot path.
 * Validates via Zod, dedupes on client_message_id, broadcasts via Supabase
 * Realtime. Actor identity comes from auth.uid() — never the client payload.
 *
 * Idempotency: INSERT ... ON CONFLICT DO NOTHING RETURNING *.
 * If nothing returned (conflict), SELECT the existing row.
 * Guarantees exactly-once delivery for retried sends with the same
 * client_message_id.
 */

import { createClient } from "@supabase/supabase-js";
import { SendChatMessageSchema } from "@repo/validation";
import { corsResponse, errorResponse, jsonResponse } from "../_shared/cors.ts";
import { assertChannelAccess, resolveAppUserId } from "../_shared/chat-authz.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsResponse();
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  // ── Auth: resolve actor from JWT ─────────────────────────────────────────
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return errorResponse("Missing or invalid authorization header", 401);
  }
  const jwt = authHeader.slice(7);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: `Bearer ${jwt}` } } },
  );

  const { data: { user }, error: authError } = await supabase.auth.getUser(jwt);
  if (authError || !user) {
    return errorResponse("Unauthorized", 401);
  }

  // Resolve app-layer user id from supabase_auth_id
  const serviceSupabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const userResolution = await resolveAppUserId(serviceSupabase, user.id);
  if (!userResolution.ok) {
    return errorResponse(userResolution.message, userResolution.status);
  }
  const senderId = userResolution.userId;

  // ── Validate request body ────────────────────────────────────────────────
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse("Invalid JSON body");
  }

  const parsed = SendChatMessageSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(parsed.error.issues.map((i) => i.message).join("; "));
  }

  const { client_message_id, channel_id, content, kind, payload, reply_to_id } =
    parsed.data;

  // ── Authorize: caller must belong to the channel's chapter ───────────────
  // Resolved from a trusted DB lookup (channel → chapter → membership) before
  // any service-role write. Never trust the client-supplied channel_id alone.
  const authz = await assertChannelAccess(serviceSupabase, senderId, channel_id);
  if (!authz.ok) {
    return errorResponse(authz.message, authz.status);
  }

  // A reply may only target a message in the SAME channel (no cross-channel
  // / cross-chapter reply linking).
  if (reply_to_id) {
    const { data: replyTo, error: replyError } = await serviceSupabase
      .from("chat_messages")
      .select("channel_id")
      .eq("id", reply_to_id)
      .maybeSingle();
    if (replyError) {
      return errorResponse("Failed to validate reply target", 500);
    }
    if (
      !replyTo ||
      (replyTo as { channel_id: string }).channel_id !== channel_id
    ) {
      return errorResponse(
        "reply_to_id must reference a message in the same channel",
        400,
      );
    }
  }

  // ── Idempotent insert ────────────────────────────────────────────────────
  // ON CONFLICT DO NOTHING on the partial unique index:
  // (channel_id, sender_id, client_message_id) WHERE client_message_id IS NOT NULL
  const { data: inserted, error: insertError } = await serviceSupabase
    .from("chat_messages")
    .insert({
      channel_id,
      sender_id:         senderId,
      content,
      kind:              kind ?? "text",
      payload:           payload ?? null,
      client_message_id,
      reply_to_id:       reply_to_id ?? null,
    })
    .select("*")
    .returns<Record<string, unknown>[]>();

  if (insertError) {
    // Unique constraint violation (duplicate) → select the existing row
    const { data: existing, error: selectError } = await serviceSupabase
      .from("chat_messages")
      .select("*")
      .eq("channel_id", channel_id)
      .eq("sender_id", senderId)
      .eq("client_message_id", client_message_id)
      .single();

    if (selectError || !existing) {
      return errorResponse("Failed to persist message", 500);
    }

    return jsonResponse({ message: existing, deduplicated: true });
  }

  const message = inserted?.[0];
  if (!message) {
    // insert returned empty (ON CONFLICT DO NOTHING hit) — select existing
    const { data: existing, error: selectError } = await serviceSupabase
      .from("chat_messages")
      .select("*")
      .eq("channel_id", channel_id)
      .eq("sender_id", senderId)
      .eq("client_message_id", client_message_id)
      .single();

    if (selectError || !existing) {
      return errorResponse("Failed to persist message", 500);
    }

    return jsonResponse({ message: existing, deduplicated: true });
  }

  // ── Broadcast via Supabase Realtime ───────────────────────────────────────
  // Best-effort: broadcast failures do not fail the request.
  // Clients also receive the change via Postgres Changes subscription.
  try {
    const channel = serviceSupabase.channel(`chapter:${channel_id}`);
    await channel.send({
      type: "broadcast",
      event: "new_message",
      payload: message,
    });
    await serviceSupabase.removeChannel(channel);
  } catch (_broadcastError) {
    // Intentionally swallowed — Postgres Changes is the source of truth
  }

  return jsonResponse({ message, deduplicated: false }, 201);
});
