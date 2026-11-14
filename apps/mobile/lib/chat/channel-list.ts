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
import { channelDescription } from "@repo/hooks/channel-start";
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
  /**
   * The channel's description (`chat_channels.description`), trimmed. Absent
   * when the row has none or it is blank, so the header and the channel start
   * draw no line for it.
   */
  description?: string;
  /**
   * Always formal (#3787): everyone sees the channel in the formal display.
   * Present, and `true`, only when the row says exactly `true`.
   */
  display_locked?: boolean;
  /** Who created the channel, who may set Always formal; absent when unrecorded. */
  created_by?: string;
  /**
   * The chapter's order for this channel inside its section (#4178), set by
   * an officer dragging it on web. Absent until its section is first
   * arranged, and then the section sorts A to Z as before
   * (`compareChannelOrder` in `@repo/hooks`).
   */
  display_order?: number;
  /**
   * The chapter's audit log (#3909), which takes no background (#4031).
   * Present, and `true`, only when the row says exactly `true`.
   */
  is_audit_log?: boolean;
  /**
   * Who can see and who can post (#3722): `null` is everyone (who can post:
   * everyone who can see it), a list names `tier:` and `role:` entries.
   * Absent when the row doesn't say, so the Edit channel sheet (#3702) never
   * mistakes an older API's row for "everyone".
   */
  who_can_see?: string[] | null;
  who_can_post?: string[] | null;
  /**
   * Whether the caller may post here (`ChatChannel.can_post`, which folds in
   * read-only, the Alumni rule and the audit log). Present only when the row
   * says a boolean, so an older API's row reads as before; the Forward picker
   * (#4864) offers a row unless this is `false`.
   */
  can_post?: boolean;
}

/**
 * A row from `GET /v1/channels/categories/list`, which the SDK types no more
 * usefully than the channel list. No `display_order`: the server returns the
 * rows already in render order, and s04 renders them as they come.
 */
export interface ChannelCategorySummary {
  id: string;
  name: string;
  /** The category's two answers, which a new or matching channel takes; as on `ChannelSummary`. */
  who_can_see?: string[] | null;
  who_can_post?: string[] | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

/**
 * A row's `who_can_see` or `who_can_post`: present (a list, or `null` for
 * everyone) only when the row carries the column.
 */
function accessLists(
  row: Record<string, unknown>,
): Pick<ChannelSummary, "who_can_see" | "who_can_post"> {
  const read = (value: unknown): string[] | null | undefined =>
    value === null
      ? null
      : Array.isArray(value)
        ? value.filter((entry): entry is string => typeof entry === "string")
        : undefined;
  const see = read(row.who_can_see);
  const post = read(row.who_can_post);
  return {
    ...(see !== undefined ? { who_can_see: see } : {}),
    ...(post !== undefined ? { who_can_post: post } : {}),
  };
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
        description:
          typeof row.description === "string"
            ? (channelDescription(row.description) ?? undefined)
            : undefined,
        // Present only when set, so a row from an API before #3787 reads
        // exactly as it did.
        ...(row.display_locked === true ? { display_locked: true } : {}),
        ...(typeof row.created_by === "string"
          ? { created_by: row.created_by }
          : {}),
        ...(typeof row.display_order === "number" &&
        Number.isFinite(row.display_order)
          ? { display_order: row.display_order }
          : {}),
        ...(row.is_audit_log === true ? { is_audit_log: true } : {}),
        ...(typeof row.can_post === "boolean"
          ? { can_post: row.can_post }
          : {}),
        ...accessLists(row),
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
    return [{ id, name, ...accessLists(row) }];
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
  /**
   * The channel is archived (#348): a Group DM everyone else left. Nobody can
   * post in one, President included. Web never sees one, because the channel
   * list leaves archived channels out, but this screen reads its channel by id
   * (`GET /v1/channels/{id}`), which still returns it to whoever can read it.
   */
  isArchived: boolean;
  /**
   * The chapter's audit log, `#chapter-audit` (#3909). Only Frapp posts
   * there, so the thread shows a line saying so in place of the composer.
   */
  isAuditLog: boolean;
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
  if (!isRecord(data)) {
    return {
      isReadOnly: false,
      canPost: true,
      isArchived: false,
      isAuditLog: false,
    };
  }
  const isAuditLog = data.is_audit_log === true;
  return {
    isReadOnly: data.is_read_only === true,
    // The server refuses every member post in the audit log; never offer one,
    // even from a row whose `can_post` is missing.
    canPost: isAuditLog
      ? false
      : typeof data.can_post === "boolean"
        ? data.can_post
        : true,
    isArchived:
      typeof data.archived_at === "string" && data.archived_at.length > 0,
    isAuditLog,
  };
}

/**
 * The composer's hint when the caller may not post here, or `null` when they
 * may. Copy: `spec/ui/design-system/writing.md` § Chat.
 *
 * Archived comes first, as it does in `canAccessChannel`: it refuses every
 * post, so neither of the other two explains it, and a frozen Group DM shown
 * the alumni sentence was #2199. Read-only and the alumni rule overlap: an
 * alumnus in a channel with a who-can-post list is shown the read-only
 * sentence, which `isReadOnly` can't tell apart (#3074). Since #3722 that
 * includes a members-only channel the Alumni role reads, whose list leaves
 * Alumni out.
 */
export function postRefusalHint(
  capability: ChannelPostCapability,
): string | null {
  if (capability.canPost) return null;
  if (capability.isArchived) {
    return "This conversation is archived because everyone else left. You can still read it.";
  }
  return capability.isReadOnly
    ? "This channel is read-only for your role."
    : "Alumni can read this channel but not post. Alumni may post in #alumni and direct messages.";
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
 *
 * Takes the row {@link threadChannel} resolved, so a screen that needs the
 * row too resolves it once.
 */
export function threadTitleFor(
  found: { channel: ChannelSummary; name: string } | null,
  isFetching: boolean,
): string {
  if (!found) return isFetching ? "" : THREAD_HEADER_FALLBACK;
  return isDirectChannel(found.channel) ? found.name : `#${found.name}`;
}

/**
 * The open thread's channel row and its display name (no `#`), resolved for
 * {@link threadTitleFor}: the channel's own read first,
 * then the cached list. `null` when neither has the row.
 */
export function threadChannel(input: {
  row: unknown;
  list: unknown;
  channelId: string | null;
  viewerId: string | null;
  names: DisplayNameMap;
}): { channel: ChannelSummary; name: string } | null {
  const { channelId } = input;
  const channel =
    selectChannels([input.row]).find((row) => row.id === channelId) ??
    selectChannels(input.list).find((row) => row.id === channelId);
  if (!channel) return null;
  return {
    channel,
    name: displayChannelName(channel, input.viewerId, input.names),
  };
}
