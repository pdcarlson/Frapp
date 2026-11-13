/**
 * The Forward picker's pure parts (#4864, `spec/behavior/chat/README.md`
 * § Forward): what the copy will look like, which conversations it can go
 * to, how the search narrows them, and what a failure says.
 *
 * In `lib/` so they are testable apart from the sheet, as the rest of the
 * thread's logic is.
 */

import { statusOf } from "@repo/api-sdk";
import { hiddenForwardedText, type BlockState } from "@repo/chat-core/blocks";
import type { ChatMessage, ForwardedFrom } from "@repo/chat-core/types";
import { normalizeDmSearchText, type DisplayNameMap } from "@repo/hooks";
import {
  displayChannelName,
  isDirectChannel,
  listedChannels,
  type ChannelSummary,
} from "./channel-list";

/** The picker's title. */
export const FORWARD_SHEET_TITLE = "Forward to";
export const FORWARD_SEARCH_PLACEHOLDER = "Search channels and people";
export const FORWARD_COMMENT_PLACEHOLDER = "Add a message (optional)";
export const FORWARD_SEND_LABEL = "Send";
/** Said to VoiceOver and TalkBack once the forward lands. */
export const FORWARD_DONE_ANNOUNCEMENT = "Forwarded";
export const FORWARD_FAILED_TITLE = "Couldn't forward";
/** A refusal (403 / 404): the destination or the message is out of reach. */
export const FORWARD_UNAVAILABLE_BODY =
  "You can't forward this message there anymore. It may have been deleted, or you may no longer be able to post in that conversation.";
/** A 400: the API says this message can't be forwarded. */
export const FORWARD_REFUSED_BODY = "This message can't be forwarded.";
/** Anything else: no response, a 5xx. */
export const FORWARD_RETRY_BODY =
  "Something went wrong. Check your connection and try again.";
export const FORWARD_NO_MATCHES = "No channels or people match that search.";
export const FORWARD_NO_DESTINATIONS =
  "There's nowhere you can post right now.";

/**
 * What a failed forward says: whether trying again can help, the way
 * `reportFailureBody` reads a failed report.
 */
export function forwardFailureBody(error: unknown): string {
  const status = statusOf(error);
  if (status === 403 || status === 404) return FORWARD_UNAVAILABLE_BODY;
  if (status === 400) return FORWARD_REFUSED_BODY;
  return FORWARD_RETRY_BODY;
}

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

/** One conversation the picker offers. */
export interface ForwardDestination {
  id: string;
  /** `#general` for a channel, the other member (or the group) for a DM. */
  label: string;
  direct: boolean;
}

/**
 * Every conversation the viewer can post in, channels first in the list's
 * own order and then direct messages, each A to Z. The current channel is
 * offered too (as Discord does). A row whose `can_post` is false is left
 * out, and so is the audit log, which only Frapp posts in; so is a DM the
 * member hid from their list, as the Messages list leaves it out.
 */
export function forwardDestinations(
  channels: ChannelSummary[],
  viewerId: string | null,
  names: DisplayNameMap,
): ForwardDestination[] {
  const postable = listedChannels(channels).filter(
    (channel) => channel.can_post !== false && !channel.is_audit_log,
  );
  const rows = postable.map((channel) => {
    const direct = isDirectChannel(channel);
    const name = displayChannelName(channel, viewerId, names);
    return { id: channel.id, label: direct ? name : `#${name}`, direct };
  });
  const byLabel = (a: ForwardDestination, b: ForwardDestination) =>
    a.label.localeCompare(b.label);
  return [
    ...rows.filter((row) => !row.direct).sort(byLabel),
    ...rows.filter((row) => row.direct).sort(byLabel),
  ];
}

/**
 * The rows a search keeps: a label containing the query, accents, case and a
 * leading `#` ignored, so "gen" and "#gen" both find `#general`.
 */
export function filterForwardDestinations(
  rows: ForwardDestination[],
  query: string,
): ForwardDestination[] {
  const needle = normalizeDmSearchText(query.replace(/^\s*#/, ""));
  if (!needle) return rows;
  return rows.filter((row) =>
    normalizeDmSearchText(row.label.replace(/^#/, "")).includes(needle),
  );
}

/**
 * What the actions sheet hands the Forward picker for `message` (#4864), or
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
