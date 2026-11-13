import { can, isDirectChannel } from "@repo/validation";
import { isSystemChannel } from "./channel-start";
import { canHideConversation } from "./hide-conversation";

/**
 * One channel row's action menu, for both clients (owner, 2026-11-06): web
 * opens it on a right-click in the chat rail, mobile on a long press in the
 * channel list. This decides **which** actions a row offers and in what order;
 * each client draws its own menu and runs the actions itself.
 *
 * The rule the owner set: the menu is scoped to the member's permissions. A
 * member sees only what the server would let them do, so an officer row is
 * there only with `channels:manage`, the permission `PATCH` and
 * `DELETE /v1/channels/{id}` check. That part only hides what the server
 * would refuse anyway; it grants nothing.
 *
 * Leaving Edit and Delete off `#chapter-audit`, DMs and group DMs matches the
 * server: it refuses deleting or renaming the audit log (#3909), and refuses
 * every `PATCH` and the `DELETE` of a DM or group DM, which belong to their
 * members (#3633).
 */

/** The actions, in menu order. */
export type ChannelRowActionKey =
  | "mark-read"
  | "toggle-pin"
  | "notifications"
  | "copy-link"
  | "hide"
  | "edit"
  | "arrange"
  | "delete";

export const MARK_AS_READ_LABEL = "Mark as read";
export const CHANNEL_NOTIFICATIONS_LABEL = "Notifications";
export const COPY_CHANNEL_LINK_LABEL = "Copy link";
export const DELETE_CHANNEL_LABEL = "Delete channel";
/** Mobile's way into the chapter order (#3838); web drags in the rail itself. */
export const ARRANGE_CHANNELS_LABEL = "Arrange channels";

/** The permission behind Edit channel and Delete channel. */
export const MANAGE_CHANNELS_PERMISSION = "channels:manage";

/**
 * The short word for a channel's notification level, shown beside the menu's
 * Notifications row on both clients.
 */
export const CHANNEL_LEVEL_DETAIL = {
  all: "All",
  mentions: "Mentions",
  off: "Muted",
} as const satisfies Record<"all" | "mentions" | "off", string>;

export interface ChannelRowActionInput {
  channel: { type: string; name: string; hidden?: boolean | null };
  /** The row is unread by the server's counts. Unknown counts are `false`. */
  unread: boolean;
  /**
   * Whether the row is pinned, or `null` when this surface offers no pin
   * control (no sidebar arrangement loaded).
   */
  pinned: boolean | null;
  /** The member's flattened permissions; `undefined` while unknown (closed). */
  permissions: readonly string[] | null | undefined;
  /**
   * What this surface can do beyond the shared core. A phone has no address
   * bar a link would come from, so mobile leaves Copy link out; it edits a
   * channel in its own sheet (#3838) and arranges the list on its own screen.
   */
  surface: { copyLink: boolean; edit: boolean; arrange?: boolean };
}

export interface ChannelRowActionGroups {
  /** The member's own actions: read, pin, notifications, link, hide. */
  member: ChannelRowActionKey[];
  /** After a divider, the officer's: edit, arrange (mobile), then delete, last. */
  officer: ChannelRowActionKey[];
}

export function channelRowActions({
  channel,
  unread,
  pinned,
  permissions,
  surface,
}: ChannelRowActionInput): ChannelRowActionGroups {
  const member: ChannelRowActionKey[] = [];
  if (unread) member.push("mark-read");
  // A hidden DM offers no pin: hiding outranks pinning
  // (`spec/behavior/chat/README.md` § Sidebar arrangement).
  if (pinned !== null && !channel.hidden) member.push("toggle-pin");
  member.push("notifications");
  if (surface.copyLink) member.push("copy-link");
  if (canHideConversation(channel) && !channel.hidden) member.push("hide");

  const officer: ChannelRowActionKey[] = [];
  // A system channel (`#chapter-audit`, the audit log's mirror) offers no
  // Edit or Delete: deleting it by a stray right-click would take the
  // chapter's record with it. Chat settings can still reach it deliberately.
  const chapterChannel = !isDirectChannel(channel) && !isSystemChannel(channel);
  if (chapterChannel && can(MANAGE_CHANNELS_PERMISSION, permissions)) {
    if (surface.edit) officer.push("edit");
    // Mobile has no drag in the list itself, so it offers the Arrange
    // channels screen (#3838). Web drags rows in the rail.
    if (surface.arrange) officer.push("arrange");
    officer.push("delete");
  }
  return { member, officer };
}

/** The Delete channel confirmation, shared with Chat settings. */
export function deleteChannelConfirmTitle(name: string): string {
  return `Delete #${name}?`;
}
export const DELETE_CHANNEL_CONFIRM_BODY =
  "Every message, attachment, and pin in this channel is removed. This cannot be undone.";

/**
 * Deleting a channel asks for its name, typed exactly (Paul, #3838:
 * "deleting a channel should be harder"), the way GitHub asks before deleting
 * a repository. Both clients keep Delete disabled until it matches.
 */
export function deleteChannelTypeLabel(name: string): string {
  return `Type ${name} to confirm`;
}

/** Whether the typed text names the channel: exact, case and all. */
export function deleteChannelNameMatches(typed: string, name: string): boolean {
  return typed === name;
}
