import { matchMentionCandidate, SYSTEM_SENDER_ID } from "@repo/validation";
import type { ChatMessage } from "./types";

/**
 * Whose profile a chat row opens, shared by both clients (#3726): a sender's
 * name or photo, and an in-body `@` chip, each open the member profile sheet
 * by `users.id`. Mobile shipped it first; web draws the same answers.
 */

/**
 * The author whose profile a row's name and photo open, or `null` for a row
 * with no member behind it: Frapp's own posts, an imported archive message
 * whose author never joined (`sender_id` null), and a sender the roster no
 * longer lists (they left the chapter), whose profile read would only 404.
 */
export function authorProfileUserId(
  message: Pick<ChatMessage, "sender_id">,
  nameFor: (userId: string) => string | null,
): string | null {
  const senderId = message.sender_id;
  if (
    !senderId ||
    senderId === SYSTEM_SENDER_ID ||
    nameFor(senderId) === null
  ) {
    return null;
  }
  return senderId;
}

/**
 * Who a clicked `@handle` chip names: matched only against the members the
 * server resolved for this message (`chat_messages.mentions`), with the same
 * fail-closed tiers the API used, so a click never opens someone the message
 * didn't notify. A role mention (`@Brothers`) expands to its holders, and none
 * of them is named "Brothers", so it opens nothing.
 */
export function mentionedUserId(
  message: Pick<ChatMessage, "mentions">,
  handle: string,
  nameFor: (userId: string) => string | null,
): string | null {
  const candidates = message.mentions.flatMap((userId) => {
    const name = nameFor(userId);
    return name ? [{ user_id: userId, display_name: name }] : [];
  });
  const token = handle.replace(/^@/, "");
  // Exact tiers only would be stricter, but the chip is drawn from the same
  // tokenizer the API resolved, so the full ladder lands where the push did.
  return matchMentionCandidate(candidates, token)?.user_id ?? null;
}
