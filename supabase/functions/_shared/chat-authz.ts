/**
 * Chat authorization helpers for the hot-path Edge Functions.
 *
 * The functions run with the service-role client (RLS bypassed), so they must
 * authorize every action themselves. These helpers resolve ownership from a
 * TRUSTED DB lookup (channel → chapter → membership, or message → channel →
 * chapter) and delegate the allow/deny decision to the shared
 * `canAccessChannel` predicate in `@repo/validation` — the SAME predicate the
 * NestJS chat + search services use, so the two layers cannot drift apart.
 *
 * Every DB lookup checks its error: a failed query must surface as a 500-style
 * authz failure, never be silently coerced into a 403/404 (which would mask
 * outages and return misleading responses).
 */

import { canAccessChannel, type ChannelOperation } from "@repo/validation";
import type { SupabaseClient } from "@supabase/supabase-js";

interface ChannelRow {
  id: string;
  chapter_id: string;
  type: string;
  name: string;
  member_ids: string[] | null;
  required_permissions: string[] | null;
  is_read_only: boolean | null;
}

export type ChannelAuthz =
  | { ok: true; channel: ChannelRow }
  | { ok: false; status: number; message: string };

export type UserResolution =
  | { ok: true; userId: string }
  | { ok: false; status: number; message: string };

const AUTHZ_FAILURE: { ok: false; status: number; message: string } = {
  ok: false,
  status: 500,
  message: "Authorization check failed",
};

/** Resolve the app-level user id from the Supabase auth uid (never the payload). */
export async function resolveAppUserId(
  client: SupabaseClient,
  authUid: string,
): Promise<UserResolution> {
  const { data, error } = await client
    .from("users")
    .select("id")
    .eq("supabase_auth_id", authUid)
    .maybeSingle();

  if (error) {
    console.error("chat-authz: users lookup failed", {
      authUid,
      error: error.message,
    });
    return AUTHZ_FAILURE;
  }

  const userId = (data as { id: string } | null)?.id;
  if (!userId) return { ok: false, status: 404, message: "User not found" };
  return { ok: true, userId };
}

/**
 * Authorize a user for a channel; 404 if unknown, 403 if denied, 500 on DB
 * error. `operation` defaults to "read" so existing call sites are
 * backward-compatible; pass "post" to additionally enforce the read-only /
 * `announcements:post` gate (Chunk 05). For "post" we always need to load
 * effective permissions so the gate can be evaluated, even on PUBLIC channels.
 */
export async function assertChannelAccess(
  client: SupabaseClient,
  userId: string,
  channelId: string,
  operation: ChannelOperation = "read",
): Promise<ChannelAuthz> {
  try {
    const { data: channel, error: channelError } = await client
      .from("chat_channels")
      .select(
        "id, chapter_id, type, name, member_ids, required_permissions, is_read_only",
      )
      .eq("id", channelId)
      .maybeSingle();
    if (channelError) throw channelError;
    if (!channel) {
      return { ok: false, status: 404, message: "Channel not found" };
    }
    const ch = channel as ChannelRow;

    const { data: member, error: memberError } = await client
      .from("members")
      .select("role_ids")
      .eq("user_id", userId)
      .eq("chapter_id", ch.chapter_id)
      .maybeSingle();
    if (memberError) throw memberError;

    const isChapterMember = Boolean(member);

    let permissions: string[] = [];
    const needsPermissions =
      isChapterMember &&
      (ch.type === "ROLE_GATED" || (operation === "post" && ch.is_read_only));
    if (needsPermissions) {
      const roleIds = (member as { role_ids: string[] | null }).role_ids ?? [];
      permissions = await effectivePermissions(client, roleIds, ch.chapter_id);
    }

    const allowed = canAccessChannel({
      channel: {
        type: ch.type,
        member_ids: ch.member_ids,
        required_permissions: ch.required_permissions,
        is_read_only: ch.is_read_only,
      },
      userId,
      isChapterMember,
      permissions,
      operation,
    });

    if (!allowed) {
      return { ok: false, status: 403, message: "Forbidden" };
    }
    return { ok: true, channel: ch };
  } catch (error) {
    console.error("chat-authz: channel access lookup failed", {
      channelId,
      userId,
      operation,
      error: error instanceof Error ? error.message : String(error),
    });
    return AUTHZ_FAILURE;
  }
}

/** Authorize a user for a message by resolving message → channel → chapter. */
export async function assertMessageAccess(
  client: SupabaseClient,
  userId: string,
  messageId: string,
): Promise<ChannelAuthz> {
  const { data: message, error } = await client
    .from("chat_messages")
    .select("channel_id")
    .eq("id", messageId)
    .maybeSingle();

  if (error) {
    console.error("chat-authz: message lookup failed", {
      messageId,
      error: error.message,
    });
    return AUTHZ_FAILURE;
  }
  if (!message) {
    return { ok: false, status: 404, message: "Message not found" };
  }
  return assertChannelAccess(
    client,
    userId,
    (message as { channel_id: string }).channel_id,
  );
}

/**
 * Effective permission strings for the caller's roles in a chapter. Constrained
 * to the chapter so a stray cross-chapter role id cannot leak permissions.
 * Throws on a DB error so the caller surfaces it as a 500 (never silently []).
 */
async function effectivePermissions(
  client: SupabaseClient,
  roleIds: string[],
  chapterId: string,
): Promise<string[]> {
  if (!roleIds.length) return [];
  const { data: roles, error } = await client
    .from("roles")
    .select("permissions")
    .eq("chapter_id", chapterId)
    .in("id", roleIds);
  if (error) throw error;
  const set = new Set<string>();
  for (const role of (roles ?? []) as { permissions: string[] | null }[]) {
    for (const permission of role.permissions ?? []) set.add(permission);
  }
  return Array.from(set);
}
