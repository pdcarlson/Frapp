/**
 * Copy and eligibility for hiding a 1:1 DM from your own list (#2303), shared
 * so mobile and web say the same thing. The behavior each string describes is
 * owned by `spec/behavior/chat/README.md` § Direct Messages; the strings are
 * rostered in `spec/ui/design-system/writing.md` § Hide a conversation.
 */

/**
 * Only a 1:1 DM can be hidden. A Group DM is *left* (the same route removes
 * the member instead), and a chapter channel has no exit at all.
 */
export function canHideConversation(channel: { type: string }): boolean {
  return channel.type === "DM";
}

/** The control's name, on the mobile row's accessibility action and the web menu row. */
export const HIDE_CONVERSATION_LABEL = "Hide conversation";

export function hideConversationConfirmTitle(name: string): string {
  return `Hide your conversation with ${name}?`;
}

/**
 * Says what does not happen as well as what does, because both are what a
 * member hiding a thread they are uneasy about will wonder: nothing is
 * deleted, the other member is not told, and it is not a block (it comes back
 * when there is something new in it).
 *
 * It names Hidden conversations, not "message them", as the way back: the
 * mobile app has no way to start a DM, so a promise to "message them" would
 * have nothing behind it there.
 */
export const HIDE_CONVERSATION_CONFIRM_BODY =
  "It leaves your list, and nothing in it is deleted. They aren't told. It comes back when there's something new in it, and you can open it from Hidden conversations anytime.";

/**
 * The collapsed group at the end of each client's list that holds the DMs a
 * member hid. Opening one from there brings it back to the list.
 */
export const HIDDEN_CONVERSATIONS_LABEL = "Hidden conversations";

/**
 * The other participant of a 1:1 DM, which `POST /v1/channels/dm` takes to
 * reopen it — and reopening is what clears a hide. `null` when the viewer is
 * unknown or the row does not list exactly one other member.
 */
export function otherMemberId(
  channel: { member_ids?: readonly string[] | null },
  viewerId: string | null,
): string | null {
  if (!viewerId) return null;
  const others = (channel.member_ids ?? []).filter((id) => id !== viewerId);
  return others.length === 1 ? others[0]! : null;
}

export const HIDE_CONVERSATION_CONFIRM_ACTION = "Hide";

export const HIDE_CONVERSATION_FAILED_TITLE = "Couldn't hide the conversation";

/** The same words the block failure uses: the write either landed or it didn't. */
export const HIDE_CONVERSATION_FAILED_BODY =
  "Nothing changed. Check your connection and try again.";
