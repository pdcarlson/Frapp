import { isBlockableSender } from "./blocks";
import { DELETED_MESSAGE_PLACEHOLDER } from "./reply-preview";
import type { ChatMessage } from "./types";

/**
 * Which of Reply, Edit and Delete a message offers, decided once for web and
 * mobile (#2775). They are the UX pre-filter that keeps a client from offering
 * a control that would fail. The server enforces ownership, `channels:manage`,
 * channel access and the read-only reply rule (`ChatService.editMessage` /
 * `deleteMessage` / `sendMessage`), and refuses to edit an imported row
 * (#2878) or any card (#2863). Two clients deriving these separately is how
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
 * a kind from being a card on screen and editable here. Mobile draws most
 * of these as cards too (`cardFor` in
 * `apps/mobile/components/chat/thread-message-row.tsx`) and the rest as text,
 * but a card's body lives in `payload`, so its `content` is not the member's
 * words to edit whichever way a client happens to draw it.
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
  "signup",
  "form",
  // An Ask Frapp answer posted to the channel (#4713): the Frapp sender's
  // row, with who asked and its sources in `payload`.
  "ask_answer",
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
 * delete), and only a plain-text message. A card has nothing to edit, and an
 * imported row is the archive's record of what someone said on Discord.
 *
 * Status is left to `canActOnMessage`, so web's inline editor can keep
 * reading this while a row it is editing changes under it. So is the
 * channel: an edit authorizes as a post, so each client also withholds Edit
 * where the channel's `can_post` is false, at the layer that holds the
 * channel row.
 */
export function canEditMessage(
  message: Pick<ChatMessage, "sender_id" | "kind" | "gif">,
  viewerId: string | null,
): boolean {
  return (
    isOwnMessage(message, viewerId) &&
    message.kind !== "imported" &&
    !isCardMessage(message) &&
    // A GIF message is the GIF, with no text to edit (#4631); the API
    // refuses the edit too.
    !message.gif
  );
}

/**
 * Whether the viewer posted this Ask Frapp answer to the channel (#4713).
 * The row is the Frapp sender's, so `isOwnMessage` is false for everyone;
 * the server writes who posted it in `payload.asked_by`, and no client can
 * send the kind.
 */
export function isOwnPostedAnswer(
  message: Partial<Pick<ChatMessage, "kind" | "payload">>,
  viewerId: string | null,
): boolean {
  return (
    !!viewerId &&
    message.kind === "ask_answer" &&
    message.payload?.asked_by === viewerId
  );
}

/**
 * Delete: your own message, an Ask Frapp answer you posted, or any message
 * when the viewer holds `channels:manage`. The server resolves that
 * permission in the message's own chapter, after channel access is
 * confirmed; the client only decides whether the control is likely to
 * succeed.
 */
export function canDeleteMessage(
  message: Pick<ChatMessage, "sender_id"> &
    Partial<Pick<ChatMessage, "kind" | "payload">>,
  viewerId: string | null,
  canManageChannel: boolean,
): boolean {
  return (
    isOwnMessage(message, viewerId) ||
    isOwnPostedAnswer(message, viewerId) ||
    canManageChannel
  );
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
 * Whether a channel takes in-thread (quote) replies from this viewer: exactly
 * when they may post there. A quote reply is a post (#3722), so `can_post`,
 * which the server derives from the same gate, decides; with no composer to
 * stage into, Reply would be an inert control. Before #3722 a read-only
 * channel refused every quote, its posters' included; `is_read_only` is still
 * accepted so callers need not change, and no longer read.
 *
 * `can_post` still unknown (`undefined`) reads as allowed; the server is the
 * enforcement.
 */
export function channelAllowsReplies(channel: {
  can_post?: boolean | null;
  is_read_only?: boolean | null;
}): boolean {
  return channel.can_post !== false;
}

/** The marker trailing a message edited since it was sent (§11 § What rides the row). */
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

/**
 * Which actions mobile's long-press sheet offers: React, Reply, Edit and
 * Delete above, and Report and Block (#2257). Moved here from the mobile app
 * when web gained Report and Block (#2687). Web's action bar gates Reply, Edit
 * and Delete on its own callbacks and reads only {@link canReportMessage} and
 * {@link canBlockSender}, which this composes, so the two clients still share
 * one Report and one Block rule.
 */
export interface MessageActions {
  /** Whether the long-press sheet opens at all. */
  canOpen: boolean;
  canReply: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canReport: boolean;
  canBlock: boolean;
}

const NO_ACTIONS: MessageActions = {
  canOpen: false,
  canReply: false,
  canEdit: false,
  canDelete: false,
  canReport: false,
  canBlock: false,
};

/** What the open channel and the viewer's permissions allow, beyond the row. */
export interface MessageActionsContext {
  isMember: MemberLookup;
  /** `channelAllowsReplies` for the open channel. */
  canReply: boolean;
  /** The channel's `can_post`: an edit authorizes as a post. */
  canPost: boolean;
  /** The viewer holds `channels:manage`. */
  canManageChannel: boolean;
}

/**
 * Whether a `users.id` is a member of the active chapter:
 *
 * - `true` — the loaded roster lists them.
 * - `false` — **positively known departed**: this session the API refused to
 *   block them as not a member (`isMemberNotFound` in `block-copy.ts`), and
 *   no roster read since lists them.
 * - `null` — nothing can be said. Covers a roster that has not loaded or
 *   failed, and a loaded one that does not list them — which is not evidence
 *   they left: the roster is cached, and the sender it is likeliest to miss is
 *   a member who joined after it was read.
 */
export type MemberLookup = (userId: string) => boolean | null;

const NO_ONE: ReadonlySet<string> = new Set();

/**
 * The members a block attempt proved are not in the chapter (the API's 404
 * `Member not found`), kept per chapter because membership and blocks are.
 * That answer is the only positive evidence a sender left: a roster that merely
 * does not list someone may be stale, and the likeliest sender it does not list
 * yet is a brand-new member, exactly who Block is for. Both clients hold one in
 * React state and read it through {@link departedIn}.
 */
export interface DepartedMembers {
  chapterId: string | null;
  ids: ReadonlySet<string>;
}

export function noDepartedMembers(chapterId: string | null): DepartedMembers {
  return { chapterId, ids: NO_ONE };
}

/** The ids known departed from `chapterId`; none once the chapter changed. */
export function departedIn(
  departed: DepartedMembers,
  chapterId: string | null,
): ReadonlySet<string> {
  return departed.chapterId === chapterId ? departed.ids : NO_ONE;
}

/** `departed` with `userId` added, starting over if the chapter changed. */
export function withDeparted(
  departed: DepartedMembers,
  chapterId: string | null,
  userId: string,
): DepartedMembers {
  const ids = new Set(departedIn(departed, chapterId));
  ids.add(userId);
  return { chapterId, ids };
}

export function rosterMembership(
  roster: {
    byId: Readonly<Record<string, string>>;
    isPending: boolean;
    isError: boolean;
  },
  departed: ReadonlySet<string> = NO_ONE,
): MemberLookup {
  const loaded = !roster.isPending && !roster.isError;
  return (userId) => {
    if (loaded && Object.prototype.hasOwnProperty.call(roster.byId, userId)) {
      return true;
    }
    return departed.has(userId) ? false : null;
  };
}

/**
 * Whether a message offers the actions sheet at all, which is what a row's
 * long-press is gated on. It needs no roster or channel: a confirmed,
 * undeleted row always offers something. Your own message offers Delete, and
 * anyone else's offers Report.
 */
export function canOpenMessageActions(
  message: Pick<ChatMessage, "_status" | "is_deleted">,
  viewerId: string | null,
): boolean {
  return viewerId !== null && canActOnMessage(message);
}

/**
 * Which actions a message offers.
 *
 * - **Confirmed, undeleted rows only.** A pending or failed row carries a
 *   client id the API has never seen, so any action on it would 404, and a
 *   deleted row already reads `[message deleted]`.
 * - **Reply** wherever the channel takes replies (`channelAllowsReplies`).
 * - **Edit** on your own plain-text message (`canEditMessage`), where you can
 *   still post.
 * - **Delete** on your own message, or anyone's with `channels:manage`.
 * - **Report and Block never on your own message.** There is nothing to
 *   report or block. On anyone else's, Report always shows: an imported row
 *   names its author in `author_name`, which the API snapshots into the report
 *   for exactly that.
 * - **Block needs a blockable sender not known to have left**: not the system
 *   actor, not an imported row nobody has linked (a linked one carries the
 *   member as its sender, #2878), and not someone `isMember` positively knows
 *   departed. A sender the cached roster does not list still gets Block: that
 *   is exactly what a brand-new member looks like, and App Review's block
 *   control must not vanish for them. If they did leave,
 *   `POST /v1/chat/blocks` answers 404 `Member not found` and the confirmation
 *   says so.
 *
 * A tombstoned row never reaches this: the thread renders it without the sheet.
 */
export function messageActionsFor(
  message: Pick<
    ChatMessage,
    "id" | "sender_id" | "kind" | "_status" | "is_deleted"
  > &
    Partial<Pick<ChatMessage, "payload">>,
  viewerId: string | null,
  context: MessageActionsContext,
): MessageActions {
  if (!canOpenMessageActions(message, viewerId)) return NO_ACTIONS;
  return {
    canOpen: true,
    canReply: context.canReply,
    canEdit: context.canPost && canEditMessage(message, viewerId),
    canDelete: canDeleteMessage(message, viewerId, context.canManageChannel),
    canReport: canReportMessage(message, viewerId),
    canBlock: canBlockSender(message, viewerId, context.isMember),
  };
}

/**
 * Report, on its own: anyone else's confirmed, undeleted message. The web
 * action bar asks this directly, since it gates Reply, Edit and Delete on its
 * own callbacks rather than on a {@link MessageActionsContext}.
 */
export function canReportMessage(
  message: Pick<ChatMessage, "sender_id" | "_status" | "is_deleted">,
  viewerId: string | null,
): boolean {
  return (
    canOpenMessageActions(message, viewerId) && !isOwnMessage(message, viewerId)
  );
}

/** Block, on its own: the rule {@link messageActionsFor} states. */
export function canBlockSender(
  message: Pick<ChatMessage, "sender_id" | "_status" | "is_deleted">,
  viewerId: string | null,
  isMember: MemberLookup,
): boolean {
  return (
    canReportMessage(message, viewerId) &&
    isBlockableSender(message.sender_id) &&
    isMember(message.sender_id) !== false
  );
}

/**
 * What "Copy text" puts on the clipboard for a message, or `null` when the
 * action should not show: a card (its words are drawn from structured data,
 * not a body), a deleted message, or a body that is only whitespace (a
 * photo-only message). The body is copied as the member wrote it, markdown and
 * `@handles` included, as Discord and iMessage copy what was typed rather than
 * how it was drawn.
 */
export function copyableText(
  message: Pick<ChatMessage, "content" | "kind" | "is_deleted">,
): string | null {
  if (message.is_deleted || isCardMessage(message)) return null;
  return message.content.trim() ? message.content : null;
}

/**
 * Whether a channel offers message threads (#3785): channels and group DMs,
 * read-only ones included; not a 1:1 DM (slice 1) and never the audit log.
 * The API's `channelAllowsThreads` is the rule; this mirrors it for the UI.
 */
export function channelAllowsThreads(channel: {
  type?: string | null;
  is_audit_log?: boolean | null;
}): boolean {
  return channel.type !== "DM" && channel.is_audit_log !== true;
}

/**
 * Whether a message offers **Start thread** (#3785), in a channel that offers
 * threads at all (`channelAllowsThreads`): not a reply inside a thread (a
 * thread can't hold one), not a parent that already has replies (its chip
 * opens that thread), and not a deleted or imported message. One rule for
 * web's action bar and mobile's long-press sheet.
 */
export function messageCanStartThread(message: {
  thread_root_id?: string | null;
  thread?: unknown;
  is_deleted: boolean;
  kind: string;
}): boolean {
  return (
    !message.thread_root_id &&
    !message.thread &&
    !message.is_deleted &&
    message.kind !== "imported"
  );
}

/**
 * Whether the viewer is offered a composer inside a thread (#3785). A
 * read-only channel refuses timeline posts but takes thread replies from any
 * member who can read it (`spec/behavior/chat/README.md` § Message threads),
 * so its `can_post: false` doesn't close the thread. The server still decides
 * (an alumnus in a read-only channel is refused there).
 */
export function channelAllowsThreadReplies(channel: {
  can_post?: boolean | null;
  is_read_only?: boolean | null;
}): boolean {
  return channel.can_post !== false || channel.is_read_only === true;
}
