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

/** The preview of a channel with no message yet, so every row is two lines. */
export const NO_MESSAGES_PREVIEW = "No messages yet";

/**
 * How the preview names people. Callers bind `@repo/hooks`' helpers to their
 * roster, so the preview names people as the thread does:
 *
 * - `nameOf`: the person's resolved name (`resolveAuthorName`), or `null`
 *   when the roster can't name them. Only a resolved name is cut to its first
 *   word.
 * - `fallbackLabel`: what the thread prints when there is no name
 *   (`resolveAuthorLabel` with no viewer, so "Member 2f4a1c" or "Unknown
 *   member"), shown whole so two unnamed people still read apart.
 */
export interface PreviewNames {
  nameOf: (author: PreviewAuthor) => string | null;
  fallbackLabel: (author: PreviewAuthor) => string;
}

export interface PreviewAuthor {
  sender_id: string | null;
  author_name: string | null;
}

/**
 * A name's first word, so a row reads "Jake: ..." the way Messages does. The
 * thread card's preview names its replier the same way (`threadPreviewParts`).
 */
export function firstName(label: string): string {
  return label.trim().split(/\s+/)[0] || label;
}

function shortLabel(author: PreviewAuthor, names: PreviewNames): string {
  const name = names.nameOf(author);
  return name ? firstName(name) : names.fallbackLabel(author);
}

/**
 * The line under a channel's name on mobile Chat home (2026-11-06).
 *
 * - An audit line reads as the thread draws it: "Paul updated the chapter
 *   profile" (`auditLineText`). The actor is named even when it is the
 *   viewer, as the thread's audit card does (`actorLabel`).
 * - A server notice (a `system_audit` row with no payload, or anything from
 *   the system sender, like the chapter welcome) is its text alone, the way
 *   the thread shows it as a sentence from Frapp.
 * - Anything else is the sender's first name and the message's one-line text
 *   (`replyPreviewText`, which also names a file-only message or a card with
 *   no text): "Jake: I've got the van". The viewer's own reads "You: ...". A
 *   1:1 DM drops the other person's name, since the row is already titled
 *   with it; a group DM keeps it, since the row names several people.
 */
export function channelPreviewLine(
  latest: ChannelLatestMessage,
  options: { isOneToOne: boolean; viewerId: string | null } & PreviewNames,
): string {
  const { isOneToOne, viewerId } = options;

  if (latest.kind === "system_audit") {
    // `readSystemAuditPayload` reads only `payload`; the cast is structural.
    const payload = readSystemAuditPayload(latest as unknown as ChatMessage);
    if (payload) {
      const { phrase } = auditLineText(payload);
      if (!payload.actor_user_id) return phrase;
      const actor = { sender_id: payload.actor_user_id, author_name: null };
      return `${shortLabel(actor, options)} ${phrase}`;
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
  if (own) return `You: ${text}`;
  if (isOneToOne) return text;
  return `${shortLabel(latest, options)}: ${text}`;
}
