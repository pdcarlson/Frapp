/**
 * Chat authorization helpers for the hot-path Edge Functions.
 *
 * The functions run with the service-role client (RLS bypassed), so they must
 * authorize every action themselves. These helpers resolve ownership from a
 * TRUSTED DB lookup (channel → chapter → membership, or message → channel →
 * chapter) and delegate the allow/deny decision to the shared
 * `canAccessChannel` predicate in `@repo/validation` — the SAME predicate the
 * NestJS chat + search services use, so the two layers cannot drift apart.
 */

import { canAccessChannel } from "@repo/validation";
import type { SupabaseClient } from "@supabase/supabase-js";

interface ChannelRow {
  id: string;
  chapter_id: string;
  type: string;
  member_ids: string[] | null;
  required_permissions: string[] | null;
}

export type ChannelAuthz =
  | { ok: true; channel: ChannelRow }
  | { ok: false; status: number; message: string };

/** Resolve the app-level user id from the Supabase auth uid (never the payload). */
export async function resolveAppUserId(
  client: SupabaseClient,
  authUid: string,
): Promise<string | null> {
  const { data } = await client
    .from("users")
    .select("id")
    .eq("supabase_auth_id", authUid)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

/** Authorize a user for a channel; 404 if the channel is unknown, 403 if denied. */
export async function assertChannelAccess(
  client: SupabaseClient,
  userId: string,
  channelId: string,
): Promise<ChannelAuthz> {
  const { data: channel } = await client
    .from("chat_channels")
    .select("id, chapter_id, type, member_ids, required_permissions")
    .eq("id", channelId)
    .maybeSingle();

  if (!channel) {
    return { ok: false, status: 404, message: "Channel not found" };
  }
  const ch = channel as ChannelRow;

  const { data: member } = await client
    .from("members")
    .select("role_ids")
    .eq("user_id", userId)
    .eq("chapter_id", ch.chapter_id)
    .maybeSingle();

  const isChapterMember = Boolean(member);

  let permissions: string[] = [];
  if (isChapterMember && ch.type === "ROLE_GATED") {
    const roleIds = (member as { role_ids: string[] | null }).role_ids ?? [];
    permissions = await effectivePermissions(client, roleIds);
  }

  const allowed = canAccessChannel({
    channel: {
      type: ch.type,
      member_ids: ch.member_ids,
      required_permissions: ch.required_permissions,
    },
    userId,
    isChapterMember,
    permissions,
  });

  if (!allowed) {
    return { ok: false, status: 403, message: "Forbidden" };
  }
  return { ok: true, channel: ch };
}

/** Authorize a user for a message by resolving message → channel → chapter. */
export async function assertMessageAccess(
  client: SupabaseClient,
  userId: string,
  messageId: string,
): Promise<ChannelAuthz> {
  const { data: message } = await client
    .from("chat_messages")
    .select("channel_id")
    .eq("id", messageId)
    .maybeSingle();

  if (!message) {
    return { ok: false, status: 404, message: "Message not found" };
  }
  return assertChannelAccess(
    client,
    userId,
    (message as { channel_id: string }).channel_id,
  );
}

async function effectivePermissions(
  client: SupabaseClient,
  roleIds: string[],
): Promise<string[]> {
  if (!roleIds.length) return [];
  const { data: roles } = await client
    .from("roles")
    .select("permissions")
    .in("id", roleIds);
  const set = new Set<string>();
  for (const role of (roles ?? []) as { permissions: string[] | null }[]) {
    for (const permission of role.permissions ?? []) set.add(permission);
  }
  return Array.from(set);
}
