import {
  CLOSE_SIGNUP_CONFIRM_BODY,
  CLOSE_SIGNUP_CONFIRM_LABEL,
  CLOSE_SIGNUP_CONFIRM_TITLE,
} from "@repo/chat-core/signups";
import { confirmDestructive } from "./confirm-destructive";

/** The alert a failed close shows; the body is chat-core's classified reason. */
export const CLOSE_SIGNUP_FAILED_TITLE = "Couldn't close sign-ups";

/**
 * Close sign-ups asks first, in a native alert, with the words web's dialog
 * uses (#3926): closing stops every claim and can't be undone. Pessimistic,
 * as Close poll is (`confirmClosePoll`): the card draws closed when the
 * server row lands, and a failure gets an alert.
 */
export function confirmCloseSignup(close: () => Promise<void>): void {
  confirmDestructive(
    {
      title: CLOSE_SIGNUP_CONFIRM_TITLE,
      body: CLOSE_SIGNUP_CONFIRM_BODY,
      confirmLabel: CLOSE_SIGNUP_CONFIRM_LABEL,
      failedTitle: CLOSE_SIGNUP_FAILED_TITLE,
    },
    close,
  );
}
