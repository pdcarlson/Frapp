import { DELETED_MESSAGE_PLACEHOLDER } from "./reply-preview";
import type { ChatMessage } from "./types";

/**
 * Which of Reply, Edit and Delete a message offers, decided once for web and
 * mobile (#2775). They are the UX pre-filter that keeps a client from offering
 * a control that would fail. The server enforces ownership, `channels:manage`,
 * channel access and the read-only reply rule (`ChatService.editMessage` /
 * `deleteMessage` / `sendMessage`), but **not** the card and imported-row half
 * of `canEditMessage`: `editMessage` never reads `kind`, so that half is
 * client-side only until #2863. Two clients deriving these separately is how
 * one of them came to offer Edit on every imported row for a while (see
 * `isOwnMessage`).
 *
 * `spec/behavior/chat/README.md` § Reply threads and § Edit and delete own the
 * rules.
 */

/**
 * Kinds whose renderer is a card in the flow rather than a plain message.
 *
 * `isCardMessage` reads this list. Web's renderer switch
 * (`apps/web/components/chat/renderers/index.tsx`) is a second statement of it,
 * and `registry.spec.tsx` there fails if the two disagree, which is what keeps
 * a kind from being a card on screen and editable here. Mobile draws
 * only `poll` as a card today and every other kind as text, but a card's
 * body lives in `payload`, so its `content` is not the member's words to edit
 * whichever way a client happens to draw it.
 */
export const CARD_KINDS: ReadonlySet<string> = new Set([
  "poll",
  "announcement",
  "system_audit",
  "loading",
  "points",
  "task",
  "event",
  "dues",
  "hours",
  "rush",
]);

/**
 * Does this message render as a card in the flow rather than as plain text?
 *
 * Deletion does not enter into it: the kind alone decides, so a deleted card
 * keeps the chrome its kind gave it rather than reflowing the thread.
 */
export function isCardMessage(message: { kind?: string | null }): boolean {
  return CARD_KINDS.has(message.kind ?? "text");
}

/**
 * Whether the viewer sent this message.
 *
 * `sender_id` is null on an imported archive row, which names its author in
 * `author_name` instead. The sender is checked before the comparison so that
 * `null === null` can never make an authorless row "mine" whatever the viewer
 * id is: that combination fails open and offers Edit and Delete on every
 * imported message.
 */
export function isOwnMessage(
  message: Pick<ChatMessage, "sender_id">,
  viewerId: string | null,
): boolean {
  return !!message.sender_id && message.sender_id === viewerId;
}

/**
 * Whether any Reply, Edit or Delete may act on this row at all: it has a
 * server id (a pending or failed row carries only a client id the API has
 * never seen) and it is not already a tombstone.
 */
export function canActOnMessage(
  message: Pick<ChatMessage, "_status" | "is_deleted">,
): boolean {
  return message._status === "confirmed" && !message.is_deleted;
}

/**
 * Edit: your own message only, with no `channels:manage` override (unlike
 * delete), and only a plain-text bubble. A card has nothing to edit, and an
 * imported row is the archive's record of what someone said on Discord.
 *
 * Status is left to `canActOnMessage`, so web's inline editor can keep
 * reading this while a row it is editing changes under it. So is the
 * channel: an edit authorizes as a post, so each client also withholds Edit
 * where the channel's `can_post` is false, at the layer that holds the
 * channel row.
 */
export function canEditMessage(
  message: Pick<ChatMessage, "sender_id" | "kind">,
  viewerId: string | null,
): boolean {
  return (
    isOwnMessage(message, viewerId) &&
    message.kind !== "imported" &&
    !isCardMessage(message)
  );
}

/**
 * Delete: your own message, or any message when the viewer holds
 * `channels:manage`. The server resolves that permission in the message's own
 * chapter, after channel access is confirmed; the client only decides whether
 * the control is likely to succeed.
 */
export function canDeleteMessage(
  message: Pick<ChatMessage, "sender_id">,
  viewerId: string | null,
  canManageChannel: boolean,
): boolean {
  return isOwnMessage(message, viewerId) || canManageChannel;
}

/**
 * The id a reply to `message` should carry.
 *
 * "Replying to a reply references the root message (no deep nesting)." One
 * hop is enough, because every reply a client authors is already
 * root-normalized, so a parent's `reply_to_id` is itself a root. An imported
 * Discord chain deeper than that resolves to its own parent rather than its
 * true root: chasing it would need messages outside the loaded window.
 *
 * Client-side on purpose. The server validates only that `reply_to_id` names
 * a message in the same channel, because the Discord importer writes nested
 * reply targets and a server-side root rule would rewrite an imported
 * thread's real shape.
 */
export function replyTargetId(
  message: Pick<ChatMessage, "id" | "reply_to_id">,
): string {
  return message.reply_to_id ?? message.id;
}

/**
 * Whether a channel takes in-thread replies from this viewer. Both halves are
 * load-bearing:
 *
 * - `can_post` is false in read-only channels **and** for an alumnus in an
 *   ordinary channel (`spec/behavior/alumni.md`), who gets
 *   `is_read_only: false`. With no composer to stage into, Reply would be an
 *   inert control.
 * - `is_read_only` covers the other side: `can_post` is deliberately true in
 *   `#announcements` for an `announcements:post` holder, but announcement
 *   messages cannot be replied to in-thread whatever the permissions, and the
 *   server 400s such a send.
 *
 * `can_post` still unknown (`undefined`) reads as allowed; the server is the
 * enforcement.
 */
export function channelAllowsReplies(channel: {
  can_post?: boolean | null;
  is_read_only?: boolean | null;
}): boolean {
  return channel.can_post !== false && !channel.is_read_only;
}

/** The meta line's marker for a message edited since it was sent. */
export const EDITED_MARKER = "(edited)";

/**
 * Whether a row shows `EDITED_MARKER`: edited, and not since deleted.
 *
 * A soft delete leaves `edited_at` set (`ChatService.softDeleteMessage` clears
 * only the content), and "edited" on a tombstone describes words that are gone.
 */
export function showsEditedMarker(message: {
  edited_at?: string | null;
  is_deleted?: boolean | null;
}): boolean {
  return !!message.edited_at && !message.is_deleted;
}

/** The delete confirmation, one wording for both clients. */
export const DELETE_MESSAGE_CONFIRM_TITLE = "Delete this message?";
export const DELETE_MESSAGE_CONFIRM_BODY =
  "This can't be undone. Everyone in the channel will see " +
  `"${DELETED_MESSAGE_PLACEHOLDER}" in its place.`;
export const DELETE_MESSAGE_CONFIRM_LABEL = "Delete message";
