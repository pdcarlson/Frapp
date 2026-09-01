/**
 * Selectors behind the s04 channel list.
 *
 * These live in `lib/` rather than beside the screen for a hard reason: every
 * `.tsx` under `app/` is picked up by expo-router's `requireContext`, so a
 * `*.spec.tsx` placed next to a screen is bundled into the app. Doing that pulls
 * `vitest` — and through it Vite's module runner — into the Metro graph and the
 * iOS bundle **fails to build**, while `lint`, `check-types`, and `vitest` all
 * stay green. Screen-adjacent logic that wants a test belongs here.
 *
 * Everything below parses `unknown`: `GET /v1/channels` infers as `never` in the
 * generated SDK, so nothing upstream is type-checked against the real payload.
 */

import { directChannelDisplayName, type DisplayNameMap } from "@repo/hooks";

/** Minimal channel shape; the SDK response type is unusable. */
export interface ChannelSummary {
  id: string;
  name: string;
  type: string;
  /**
   * `users.id` of each participant, for resolving a DM's title.
   *
   * Required and normalized: `selectChannels` emits `[]` for a null or absent
   * column, so no consumer needs a `?? []`. DM, group-DM **and PRIVATE** rows
   * populate it server-side — PRIVATE seeds its creator (#1008) — so a non-empty
   * list does **not** imply a direct message; classify with `isDirectChannel`
   * (a `type` check), never with `member_ids.length`. After the channel-list
   * access filter landed, a visible row is one the caller can read, so the
   * participant ids on it are legitimately theirs to read.
   */
  member_ids: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

export function selectChannels(data: unknown): ChannelSummary[] {
  if (!Array.isArray(data)) return [];
  return data.filter(isRecord).flatMap((row) => {
    const id = row.id;
    const name = row.name;
    const type = row.type;
    if (typeof id !== "string" || typeof name !== "string") return [];
    const memberIds = Array.isArray(row.member_ids)
      ? row.member_ids.filter(
          (value): value is string => typeof value === "string",
        )
      : [];
    return [
      {
        id,
        name,
        type: typeof type === "string" ? type : "PUBLIC",
        member_ids: memberIds,
      },
    ];
  });
}

export function isDirectChannel(channel: ChannelSummary): boolean {
  return channel.type === "DM" || channel.type === "GROUP_DM";
}

/** Whether the caller may post in a channel right now, and why not (#704). */
export interface ChannelPostCapability {
  isReadOnly: boolean;
  /** From `ChatChannel.can_post` — already folds in the read-only gate. */
  canPost: boolean;
}

/**
 * Parses the single-channel payload the same defensive way `selectChannels`
 * parses the list — `GET /v1/channels/{id}` infers as `never` in the
 * generated SDK too. Defaults to `{ isReadOnly: false, canPost: true }` while
 * the row hasn't loaded yet, so the composer doesn't flash disabled during
 * the initial fetch; matches web's `canPost = true` default in
 * `composer.tsx`.
 */
export function selectPostCapability(data: unknown): ChannelPostCapability {
  if (!isRecord(data)) return { isReadOnly: false, canPost: true };
  return {
    isReadOnly: data.is_read_only === true,
    canPost: typeof data.can_post === "boolean" ? data.can_post : true,
  };
}

/**
 * DM channels are named by the server, not by a human: `dm-<uuidA>-<uuidB>` for
 * a pair and `group-dm-<epoch>` for a group (`chat.service.ts`). Those are
 * storage keys — rendered raw, every DM row reads as a wall of uuid.
 *
 * The rule itself lives in `@repo/hooks` so web resolves DM titles identically
 * rather than growing a second copy; this is the mobile-shaped entry point. Two
 * behaviours it preserves deliberately: a group DM a chapter actually titled
 * keeps its title, and a non-direct channel is never rewritten even if someone
 * named it like a DM.
 */
export function displayChannelName(
  channel: ChannelSummary,
  viewerId: string | null,
  names: DisplayNameMap,
): string {
  return directChannelDisplayName(channel, viewerId, names);
}

/** `channel_id` → counts, so a row lookup is O(1) rather than a scan per row. */
export function indexUnread(
  rows: { channel_id: string; unread_count: number; mention_count: number }[],
): Record<string, { unread: number; mentions: number }> {
  const index: Record<string, { unread: number; mentions: number }> = {};
  for (const row of rows) {
    index[row.channel_id] = {
      unread: row.unread_count,
      mentions: row.mention_count,
    };
  }
  return index;
}
