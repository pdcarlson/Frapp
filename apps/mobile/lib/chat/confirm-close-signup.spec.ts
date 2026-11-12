import { MemberFacingError } from "@repo/hooks/error-copy";
import { Alert, type AlertButton } from "react-native";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLOSE_SIGNUP_CONFIRM_BODY,
  CLOSE_SIGNUP_CONFIRM_LABEL,
  CLOSE_SIGNUP_CONFIRM_TITLE,
} from "@repo/chat-core/signups";
import {
  CLOSE_SIGNUP_FAILED_TITLE,
  confirmCloseSignup,
} from "./confirm-close-signup";

beforeEach(() => {
  vi.mocked(Alert.alert).mockClear();
});

/** The buttons of the most recent alert. */
function buttons(): AlertButton[] {
  const calls = vi.mocked(Alert.alert).mock.calls;
  return (calls[calls.length - 1]?.[2] ?? []) as AlertButton[];
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("confirmCloseSignup (#3926)", () => {
  it("asks with the shared words and closes nothing until the destructive choice", () => {
    const close = vi.fn().mockResolvedValue(undefined);
    confirmCloseSignup(close);
    expect(Alert.alert).toHaveBeenCalledWith(
      CLOSE_SIGNUP_CONFIRM_TITLE,
      CLOSE_SIGNUP_CONFIRM_BODY,
      expect.any(Array),
    );
    expect(close).not.toHaveBeenCalled();

    buttons()
      .find((button) => button.style === "cancel")
      ?.onPress?.();
    expect(close).not.toHaveBeenCalled();

    const confirm = buttons().find((button) => button.style === "destructive");
    expect(confirm?.text).toBe(CLOSE_SIGNUP_CONFIRM_LABEL);
    confirm?.onPress?.();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("says why when the close fails", async () => {
    const close = vi
      .fn()
      .mockRejectedValue(
        new MemberFacingError("Sign-ups for this have closed."),
      );
    confirmCloseSignup(close);
    buttons()
      .find((button) => button.style === "destructive")
      ?.onPress?.();
    await flush();
    expect(Alert.alert).toHaveBeenLastCalledWith(
      CLOSE_SIGNUP_FAILED_TITLE,
      "Sign-ups for this have closed.",
    );
  });
});
