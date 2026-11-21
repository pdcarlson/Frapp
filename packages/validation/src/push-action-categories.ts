/**
 * Notification categories with action buttons: the iOS
 * `UNNotificationCategory` / Android action set a push names in its Expo
 * `categoryId`, and the phone registers at startup
 * (`apps/mobile/lib/notifications/push-actions.ts`). Not the preference
 * categories in `notification-categories.ts`, which are switches a member
 * turns off; these are which buttons a push carries.
 *
 * Shared because the API and the phone must spell it the same: a push naming
 * a category the phone never registered shows no buttons, and nothing says so.
 */

/**
 * The excuse push's Approve and Decline (#4686): sent with every "Sam can't
 * make Chapter meeting" push, whose `data` carries `excuseUserId` beside its
 * `target.eventId`.
 */
export const EXCUSE_PUSH_CATEGORY_ID = "event-excuse";
