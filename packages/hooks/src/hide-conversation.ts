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
 */
export const HIDE_CONVERSATION_CONFIRM_BODY =
  "It leaves your list, and nothing in it is deleted. They aren't told. It comes back when there's something new in it, or when you message them.";

export const HIDE_CONVERSATION_CONFIRM_ACTION = "Hide";

export const HIDE_CONVERSATION_FAILED_TITLE = "Couldn't hide the conversation";

/** The same words the block failure uses: the write either landed or it didn't. */
export const HIDE_CONVERSATION_FAILED_BODY =
  "Nothing changed. Check your connection and try again.";
