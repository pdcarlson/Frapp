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
import { isDirectChannel as isDirectChannelType } from "@repo/validation";

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
  /**
   * The caller hid this 1:1 DM from their own list (#2303). The server still
   * returns the row, so a thread opened by id keeps resolving; only the list
   * leaves it out (`listedChannels`). `false` unless the row says exactly
   * `true`, so a server that predates the flag hides nothing.
   */
  hidden: boolean;
  /**
   * The chapter category this channel is filed under, or `null` for none.
   * An id naming a category the list doesn't carry is kept as-is;
   * `groupChannelsByCategory` sends that row to the default group.
   */
  category_id: string | null;
}

/**
 * A row from `GET /v1/channels/categories/list`, which the SDK types no more
 * usefully than the channel list. No `display_order`: the server returns the
 * rows already in render order, and s04 renders them as they come.
 */
export interface ChannelCategorySummary {
  id: string;
  name: string;
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
        hidden: row.hidden === true,
        category_id:
          typeof row.category_id === "string" ? row.category_id : null,
      },
    ];
  });
}

/**
 * Parses the categories list the way `selectChannels` parses channels. A row
 * with no usable id or name is dropped, and the rest keep their order.
 */
export function selectCategories(data: unknown): ChannelCategorySummary[] {
  if (!Array.isArray(data)) return [];
  return data.filter(isRecord).flatMap((row) => {
    const { id, name } = row;
    if (typeof id !== "string" || typeof name !== "string") return [];
    return [{ id, name }];
  });
}

/** The rows the chat list renders: everything but the DMs the member hid. */
export function listedChannels(channels: ChannelSummary[]): ChannelSummary[] {
  return channels.filter((channel) => !channel.hidden);
}

/** The DMs the member hid, for the list's Hidden conversations group. */
export function hiddenChannels(channels: ChannelSummary[]): ChannelSummary[] {
  return channels.filter((channel) => channel.hidden);
}

/**
 * The rule is `@repo/validation`'s, the one `groupChannelsByCategory` files
 * rows by, so the section a row lands in and how the row draws can't disagree.
 */
export function isDirectChannel(channel: ChannelSummary): boolean {
  return isDirectChannelType(channel);
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

/** What the s05 header says when it has no row to name the channel from. */
export const THREAD_HEADER_FALLBACK = "Thread";

/**
 * The s05 thread header (#2775): `#name` for a channel, the other member for a
 * DM, through the same `displayChannelName` the list uses, so a thread and its
 * row say the same thing.
 *
 * The name comes from the channel's own row (`GET /v1/channels/{id}`), or,
 * while that read hasn't landed, from the cached list row s04 drew the member
 * in from, parsed as defensively as the list. Neither is persisted, so an
 * offline cold start or a failed read may have no row at all: the header then
 * says `Thread`, as it did before it named anything. While a read is in flight
 * it stays empty, rather than flashing `Thread` for a moment.
 */
export function threadHeaderTitle(input: {
  /** The single-channel read's data. */
  row: unknown;
  /** The cached channel list, if any. */
  list: unknown;
  channelId: string | null;
  viewerId: string | null;
  names: DisplayNameMap;
  /** The single-channel read is fetching right now. */
  isFetching: boolean;
}): string {
  const { channelId } = input;
  const channel =
    selectChannels([input.row]).find((row) => row.id === channelId) ??
    selectChannels(input.list).find((row) => row.id === channelId);
  if (!channel) return input.isFetching ? "" : THREAD_HEADER_FALLBACK;
  const name = displayChannelName(channel, input.viewerId, input.names);
  return isDirectChannel(channel) ? name : `#${name}`;
}
