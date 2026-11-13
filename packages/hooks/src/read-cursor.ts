/**
 * What keeps Mark unread (#3723) from being read straight back by a stamp
 * that lands after it. Its own module so `use-chat.ts` and `chat-activity.ts`,
 * which already import one way, can both reach it without a cycle.
 */

/**
 * Channels Mark unread is holding: the activity handler
 * (`createChatActivityHandler`) sends no read stamp for one, even one it
 * queued while the channel was still being viewed. A hold lasts until the
 * channel is next opened (`releaseChannelUnread`), whichever screen opens it:
 * the screen that held it has usually gone by then.
 */
const unreadHolds = new Set<string>();

/** Holds `channelId` unread until it is next opened. */
export function holdChannelUnread(channelId: string): void {
  unreadHolds.add(channelId);
}

/** Ends a hold: the channel is being viewed again. */
export function releaseChannelUnread(channelId: string): void {
  unreadHolds.delete(channelId);
}

/** Whether Mark unread is holding `channelId`. */
export function isChannelHeldUnread(channelId: string): boolean {
  return unreadHolds.has(channelId);
}

/** The activity handlers' latest round of read stamps. */
let activityStamping: Promise<void> = Promise.resolve();

/** Called by the activity handler as it starts a round. */
export function trackActivityStamping(round: Promise<void>): void {
  activityStamping = round;
}

/**
 * Settles once the activity handler's stamps already sent have landed, so
 * Mark unread can go after them.
 */
export function chatActivityStampsSettled(): Promise<void> {
  return activityStamping;
}
