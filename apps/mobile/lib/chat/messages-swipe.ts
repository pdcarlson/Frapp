/**
 * The swipe from Chat home to Messages (#3774; Shawn's account of what he and
 * Paul agreed, 2026-11-12): the finger slides right to left and Messages comes
 * in from the right edge, as Instagram's feed opens its messages. The
 * top-right Messages button stays, so a member who never finds the gesture,
 * or uses VoiceOver or TalkBack, still has one tap to it. Going back is the
 * stack's own swipe from the left edge, or the back row.
 *
 * Only a leftward slide starts it, so the left edge stays free for the system
 * back gesture on Android and for the side menu idea in #4047. A mostly
 * vertical move fails it, so the channel list still scrolls.
 */

/** Points left before the pan takes over; rightward never does. */
export const MESSAGES_SWIPE_ACTIVATE_X = -24;
/** Points up or down that hand the move to the list's scroll instead. */
export const MESSAGES_SWIPE_FAIL_Y = 14;

/** Far enough left to open Messages on release. */
const OPEN_DISTANCE = -80;
/** A shorter flick still opens it when it is quick. */
const FLICK_DISTANCE = -32;
const FLICK_VELOCITY = -500;

/** Whether a released pan opens Messages. */
export function opensMessages(end: {
  translationX: number;
  velocityX: number;
}): boolean {
  return (
    end.translationX <= OPEN_DISTANCE ||
    (end.translationX <= FLICK_DISTANCE && end.velocityX <= FLICK_VELOCITY)
  );
}
