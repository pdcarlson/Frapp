/**
 * The copy a forward carries (#4864, `spec/behavior/chat/README.md`
 * § Forward): what the server snapshots, for the picker's preview on the
 * phone and on web.
 */

import { hiddenForwardedText, type BlockState } from "./blocks";
import type { ChatMessage, ForwardedFrom } from "./types";

/**
 * The copy a forward of `message` will carry, for the picker's preview: what
 * the server snapshots (`ChatService.forwardMessage`). A forward with no
 * comment passes its own copy on, so cards never nest; anything else is
 * copied as itself.
 */
export function forwardPreviewOf(
  message: Pick<
    ChatMessage,
    | "id"
    | "channel_id"
    | "sender_id"
    | "author_name"
    | "content"
    | "gif"
    | "attachment_count"
    | "created_at"
    | "forwarded_from"
  >,
): ForwardedFrom {
  const inner = message.forwarded_from;
  if (inner && message.content.trim().length === 0) return inner;
  return {
    message_id: message.id,
    channel_id: message.channel_id,
    sender_id: message.sender_id,
    author_name: message.author_name,
    content: message.content,
    gif: message.gif ?? null,
    attachment_count: message.attachment_count,
    created_at: message.created_at,
    deleted: false,
    sender_blocked: false,
  };
}

/** The message the picker forwards, as its preview draws it. */
export interface ForwardTarget {
  /** The original's server id, which the API forwards. */
  messageId: string;
  /** The copy the forward will carry (`forwardPreviewOf`). */
  preview: ForwardedFrom;
  /**
   * The block placeholder for a copy whose author the viewer blocked
   * (`hiddenForwardedText`), or `null` to draw it.
   */
  hidden: string | null;
}

/**
 * What a message menu hands the Forward picker for `message` (#4864), or
 * `undefined` where `messageActionsFor` says it can't be forwarded: the copy
 * it will carry, and the block placeholder when that copy is a forward's
 * whose author the viewer blocked.
 */
export function forwardTargetOf(
  message: Parameters<typeof forwardPreviewOf>[0] &
    Pick<ChatMessage, "_blockEvaluated">,
  canForward: boolean,
  blockState: BlockState,
  viewerId: string | null,
): ForwardTarget | undefined {
  if (!canForward) return undefined;
  const preview = forwardPreviewOf(message);
  return {
    messageId: message.id,
    preview,
    hidden: hiddenForwardedText(preview, message, blockState, viewerId),
  };
}
