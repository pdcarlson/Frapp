import { MemberFacingError } from "@repo/hooks/error-copy";
import { Alert, type AlertButton } from "react-native";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLOSE_POLL_CONFIRM_BODY,
  CLOSE_POLL_CONFIRM_LABEL,
  CLOSE_POLL_CONFIRM_TITLE,
} from "@repo/chat-core/polls";
import { CLOSE_POLL_FAILED_TITLE, confirmClosePoll } from "./confirm-close-poll";

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

describe("confirmClosePoll (#3794)", () => {
  it("asks with the shared words and closes nothing until the destructive choice", () => {
    const close = vi.fn().mockResolvedValue(undefined);
    confirmClosePoll(close);
    expect(Alert.alert).toHaveBeenCalledWith(
      CLOSE_POLL_CONFIRM_TITLE,
      CLOSE_POLL_CONFIRM_BODY,
      expect.any(Array),
    );
    expect(close).not.toHaveBeenCalled();

    buttons()
      .find((button) => button.style === "cancel")
      ?.onPress?.();
    expect(close).not.toHaveBeenCalled();

    const confirm = buttons().find((button) => button.style === "destructive");
    expect(confirm?.text).toBe(CLOSE_POLL_CONFIRM_LABEL);
    confirm?.onPress?.();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("says why when the close fails", async () => {
    const close = vi
      .fn()
      .mockRejectedValue(new MemberFacingError("Poll is already closed"));
    confirmClosePoll(close);
    buttons()
      .find((button) => button.style === "destructive")
      ?.onPress?.();
    await flush();
    expect(Alert.alert).toHaveBeenLastCalledWith(
      CLOSE_POLL_FAILED_TITLE,
      "Poll is already closed",
    );
  });
});
