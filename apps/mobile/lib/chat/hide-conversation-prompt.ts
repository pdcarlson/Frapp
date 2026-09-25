import { Alert } from "react-native";
import {
  HIDE_CONVERSATION_CONFIRM_ACTION,
  HIDE_CONVERSATION_CONFIRM_BODY,
  HIDE_CONVERSATION_FAILED_BODY,
  HIDE_CONVERSATION_FAILED_TITLE,
  hideConversationConfirmTitle,
} from "@repo/hooks";

/**
 * The "Hide conversation" confirmation for a 1:1 DM row (#2303).
 *
 * Asked rather than applied on a long press: the row simply vanishes into the
 * collapsed Hidden conversations group, where a member who did not mean to
 * would have to go looking for it. Not `destructive`-styled, because nothing
 * is destroyed — the body says so.
 *
 * `run` is awaited inside the alert's handler rather than fired through a
 * mutation's per-call `onError`, for the reason `confirmBlockMember` gives:
 * TanStack skips per-call callbacks once the observing component unmounts, and
 * a failure must still be reported.
 */
export function confirmHideConversation({
  name,
  run,
}: {
  /** The row's title: the other member's name. */
  name: string;
  run: () => Promise<unknown>;
}): void {
  Alert.alert(
    hideConversationConfirmTitle(name),
    HIDE_CONVERSATION_CONFIRM_BODY,
    [
      { text: "Cancel", style: "cancel" },
      {
        text: HIDE_CONVERSATION_CONFIRM_ACTION,
        onPress: () => {
          void (async () => {
            try {
              await run();
            } catch {
              Alert.alert(
                HIDE_CONVERSATION_FAILED_TITLE,
                HIDE_CONVERSATION_FAILED_BODY,
              );
            }
          })();
        },
      },
    ],
  );
}
