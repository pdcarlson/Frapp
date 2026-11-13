import type { ClosableCardKind } from "@repo/chat-core/chat-client";
import {
  CLOSE_FORM_CONFIRM_BODY,
  CLOSE_FORM_CONFIRM_LABEL,
  CLOSE_FORM_CONFIRM_TITLE,
} from "@repo/chat-core/forms";
import {
  CLOSE_SIGNUP_CONFIRM_BODY,
  CLOSE_SIGNUP_CONFIRM_LABEL,
  CLOSE_SIGNUP_CONFIRM_TITLE,
} from "@repo/chat-core/signups";
import {
  confirmDestructive,
  type DestructiveConfirmCopy,
} from "./confirm-destructive";

/** The alert a failed close shows; the body is chat-core's classified reason. */
export const CLOSE_SIGNUP_FAILED_TITLE = "Couldn't close sign-ups";
export const CLOSE_FORM_FAILED_TITLE = "Couldn't close the form";

const COPY: Record<ClosableCardKind, DestructiveConfirmCopy> = {
  signup: {
    title: CLOSE_SIGNUP_CONFIRM_TITLE,
    body: CLOSE_SIGNUP_CONFIRM_BODY,
    confirmLabel: CLOSE_SIGNUP_CONFIRM_LABEL,
    failedTitle: CLOSE_SIGNUP_FAILED_TITLE,
  },
  form: {
    title: CLOSE_FORM_CONFIRM_TITLE,
    body: CLOSE_FORM_CONFIRM_BODY,
    confirmLabel: CLOSE_FORM_CONFIRM_LABEL,
    failedTitle: CLOSE_FORM_FAILED_TITLE,
  },
};

/**
 * Close sign-ups (#3926) and Close form (step 3) ask first, in a native
 * alert, with the words web's dialogs use: closing stops every claim or
 * answer and can't be undone. Pessimistic, as Close poll is
 * (`confirmClosePoll`): the card draws closed when the server row lands, and
 * a failure gets an alert.
 */
export function confirmCloseCard(
  kind: ClosableCardKind,
  close: () => Promise<void>,
): void {
  confirmDestructive(COPY[kind], close);
}
