/**
 * The Forward picker's destination rules and copy (#4864, #4907,
 * `spec/behavior/chat/README.md` § Forward): which conversations a forward can
 * go to, how the search narrows them, and what a failure says. Shared by the
 * phone's Forward to sheet and web's Forward dialog, so the two pickers offer
 * the same conversations and say the same things.
 */

import { statusOf } from "@repo/api-sdk";
import { isDirectChannel } from "@repo/validation";
import {
  directChannelDisplayName,
  type DirectChannelNameInput,
  type DisplayNameMap,
} from "./display-names";
import { normalizeDmSearchText } from "./dm-search";

/** The picker's title. */
export const FORWARD_SHEET_TITLE = "Forward to";
export const FORWARD_SEARCH_PLACEHOLDER = "Search channels and people";
export const FORWARD_COMMENT_PLACEHOLDER = "Add a message (optional)";
export const FORWARD_SEND_LABEL = "Send";
/** Said to a screen reader once the forward lands. */
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

/** What the picker reads off a channel-list row. */
export interface ForwardableChannel extends Omit<
  DirectChannelNameInput,
  "member_ids"
> {
  id: string;
  /** Web's list may leave it unset on a channel that isn't a DM. */
  member_ids?: readonly string[] | null;
  /** A DM the member hid from their list. */
  hidden?: boolean;
  can_post?: boolean;
  is_audit_log?: boolean;
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
  channels: readonly ForwardableChannel[],
  viewerId: string | null,
  names: DisplayNameMap,
): ForwardDestination[] {
  const postable = channels.filter(
    (channel) =>
      !channel.hidden && channel.can_post !== false && !channel.is_audit_log,
  );
  const rows = postable.map((channel) => {
    const direct = isDirectChannel(channel);
    const name = directChannelDisplayName(
      { ...channel, member_ids: [...(channel.member_ids ?? [])] },
      viewerId,
      names,
    );
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
