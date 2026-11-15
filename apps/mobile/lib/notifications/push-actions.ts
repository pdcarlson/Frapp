/**
 * Action buttons on a push (#4686): the categories this build registers with
 * the OS, and what a press on one of their buttons asks the app to do.
 *
 * Pure, no React and no `expo-notifications`: `push.ts` registers the
 * categories, `use-push-runtime.ts` acts on a press, and this module is what
 * both read, so the specs can drive it without a device.
 *
 * ## The excuse push
 *
 * "Sam can't make Chapter meeting" carries Approve and Decline, as Slack's and
 * Teams' approval notifications let an approver answer from the banner, and
 * Gmail's lets a reader archive from it. The API names the category
 * (`EXCUSE_PUSH_CATEGORY_ID`, shared in `@repo/validation`) and puts the
 * sender's id beside the event's in `data`; a press is the same
 * `PATCH /v1/events/:eventId/excuses/:userId` the event page's buttons send.
 *
 * Both buttons open the app (`opensAppToForeground`). A background action
 * would need a headless JS task on Android and the app launched without UI on
 * iOS, neither of which this app has; opening also lands the officer on the
 * event, where the decision shows and can be changed if it was the wrong
 * button. Decline is marked destructive, so iOS draws it red.
 *
 * ## Expo Go
 *
 * `push.ts` loads no notifications module in Expo Go at all
 * (`isWebOrExpoGo`), so neither the category nor its buttons exist there.
 * They need a development build or TestFlight / Play internal testing.
 */
import { serverMessageOf, statusOf } from "@repo/api-sdk";
import { isRecord, str } from "../more/narrow";
import { EXCUSE_PUSH_CATEGORY_ID } from "@repo/validation";
import type {
  PushCategoryAction,
  PushNotificationResponse,
} from "./push-types";

export const EXCUSE_APPROVE_ACTION = "excuse-approve";
export const EXCUSE_DECLINE_ACTION = "excuse-decline";

/** Every category this build registers at startup, by id. */
export const PUSH_ACTION_CATEGORIES: ReadonlyArray<{
  id: string;
  actions: PushCategoryAction[];
}> = [
  {
    id: EXCUSE_PUSH_CATEGORY_ID,
    actions: [
      {
        identifier: EXCUSE_APPROVE_ACTION,
        buttonTitle: "Approve",
        options: { opensAppToForeground: true },
      },
      {
        identifier: EXCUSE_DECLINE_ACTION,
        buttonTitle: "Decline",
        options: { opensAppToForeground: true, isDestructive: true },
      },
    ],
  },
];

/** A press of Approve or Decline on an excuse push. */
export interface ExcuseDecisionAction {
  eventId: string;
  userId: string;
  decision: "APPROVED" | "DECLINED";
  /**
   * The chapter the excuse is in, from the push. The write goes out under
   * the phone's active chapter (`x-chapter-id`), so a press from another of
   * the officer's chapters can't be decided as it is. Null on a push from a
   * server before the field.
   */
  chapterId: string | null;
}

/**
 * The decision a response asks for, or null for a plain tap (Expo's default
 * action identifier) or a payload that names no event or sender, which an
 * older server's excuse push does: the press then opens the event like a tap.
 */
export function excuseDecisionFrom(
  response: PushNotificationResponse,
): ExcuseDecisionAction | null {
  const decision =
    response.actionIdentifier === EXCUSE_APPROVE_ACTION
      ? "APPROVED"
      : response.actionIdentifier === EXCUSE_DECLINE_ACTION
        ? "DECLINED"
        : null;
  if (!decision) return null;
  const data = response.notification.request.content.data;
  if (!isRecord(data)) return null;
  const eventId = isRecord(data.target) ? str(data.target, "eventId") : null;
  const userId = str(data, "excuseUserId");
  if (!eventId || !userId) return null;
  return { eventId, userId, decision, chapterId: str(data, "chapterId") };
}

/**
 * What an officer is told when a press didn't take.
 *
 * - **404**: the member withdrew the excuse, or checked in, which withdraws a
 *   pending one. Both delete the row, so `decide` finds nothing.
 * - **409**: someone decided it first, or the excuse can no longer be
 *   decided (the member checked in, an officer marked them absent, they left
 *   the chapter). The server's message says which.
 *
 * Neither is an error to fix, so both say the excuse was already handled.
 * Anything else (offline, a 403 for an officer who lost the permission)
 * points at the event page, which the press has already opened.
 */
export function excuseDecisionNotice(error: unknown): {
  title: string;
  body: string;
} {
  const status = statusOf(error);
  if (status === 404) {
    return {
      title: "Already handled",
      body: "This excuse was withdrawn, so there's nothing left to decide.",
    };
  }
  if (status === 409) {
    return {
      title: "Already handled",
      body: serverMessageOf(error) ?? "This excuse was already decided.",
    };
  }
  return {
    title: "Couldn't save that decision",
    body: "Approve or decline it here on the event instead.",
  };
}

/**
 * A press from another of the officer's chapters. Nothing is sent: the write
 * would go out under the active chapter and be refused there.
 */
export const EXCUSE_OTHER_CHAPTER_NOTICE = {
  title: "In another chapter",
  body: "Switch to that chapter, then approve or decline the excuse on its event.",
};

/**
 * Presses already acted on in this process, by notification id. iOS can hand
 * the press that launched the app to both the launch read and the response
 * listener; deciding twice would answer the second with a 409, and "Already
 * handled" for a decision the officer just made. Process-lifetime is enough:
 * a press is only ever delivered again within the launch it opened.
 */
const actedPresses = new Set<string>();

/** True the first time a press is seen, false for any repeat. */
export function claimActionPress(identifier: string): boolean {
  if (actedPresses.has(identifier)) return false;
  actedPresses.add(identifier);
  return true;
}
