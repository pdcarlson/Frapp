import { SYSTEM_SENDER_ID } from "@repo/validation";
import { auditLineText, readSystemAuditPayload } from "./cards";
import { replyPreviewText } from "./reply-preview";
import type { ChatMessage, ChatMessageKind } from "./types";

/**
 * One channel's latest message as `GET /v1/channels/latest` serves it: what a
 * Chat home row needs for its preview line and its time, nothing more.
 * `content` is cut to 500 characters server-side, and `payload` is set only
 * on an audit line.
 */
export interface ChannelLatestMessage {
  channel_id: string;
  message_id: string;
  sender_id: string | null;
  author_name: string | null;
  content: string;
  kind: string;
  payload: Record<string, unknown> | null;
  attachment_count: number;
  created_at: string;
}

/**
 * Names a message's author for the preview. Callers pass `@repo/hooks`'
 * `resolveAuthorLabel` bound to their roster and viewer, so the preview names
 * people exactly as the thread does ("You" for the viewer).
 */
export type PreviewAuthorLabel = (author: {
  sender_id: string | null;
  author_name: string | null;
}) => string;

/** A name's first word, so a row reads "Jake: ..." the way Messages does. */
function firstName(label: string): string {
  return label.trim().split(/\s+/)[0] || label;
}

/**
 * The line under a channel's name on mobile Chat home (2026-11-06).
 *
 * - An audit line reads as the thread draws it: "Paul updated the chapter
 *   profile" (`auditLineText`).
 * - A server notice (a `system_audit` row with no payload, or anything from
 *   the system sender, like the chapter welcome) is its text alone, the way
 *   the thread shows it as a sentence from Frapp.
 * - Anything else is the sender's first name and the message's one-line text
 *   (`replyPreviewText`, which also names a file-only message or a card with
 *   no text): "Jake: I've got the van". The viewer's own reads "You: ...". A
 *   direct message drops the other person's name, since the row is already
 *   titled with it.
 */
export function channelPreviewLine(
  latest: ChannelLatestMessage,
  options: { isDirect: boolean; viewerId: string | null; authorLabel: PreviewAuthorLabel },
): string {
  const { isDirect, viewerId, authorLabel } = options;

  if (latest.kind === "system_audit") {
    // `readSystemAuditPayload` reads only `payload`; the cast is structural.
    const payload = readSystemAuditPayload(latest as unknown as ChatMessage);
    if (payload) {
      const { phrase } = auditLineText(payload);
      if (!payload.actor_user_id) return phrase;
      const actor = authorLabel({
        sender_id: payload.actor_user_id,
        author_name: null,
      });
      return `${firstName(actor)} ${phrase}`;
    }
  }

  const text = replyPreviewText({
    content: latest.content,
    attachment_count: latest.attachment_count,
    kind: latest.kind as ChatMessageKind,
  });

  if (latest.kind === "system_audit" || latest.sender_id === SYSTEM_SENDER_ID) {
    return text;
  }
  const own = viewerId !== null && latest.sender_id === viewerId;
  if (isDirect && !own) return text;
  return `${firstName(authorLabel(latest))}: ${text}`;
}
