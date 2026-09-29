import { Alert, type AlertButton } from "react-native";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DELETE_MESSAGE_CONFIRM_BODY,
  DELETE_MESSAGE_CONFIRM_LABEL,
  DELETE_MESSAGE_CONFIRM_TITLE,
} from "@repo/chat-core/message-actions";
import {
  confirmDeleteMessage,
  DELETE_MESSAGE_FAILED_TITLE,
} from "./confirm-delete-message";

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

describe("confirmDeleteMessage", () => {
  it("asks with the shared words and deletes nothing until the destructive choice", () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    confirmDeleteMessage(remove);
    expect(Alert.alert).toHaveBeenCalledWith(
      DELETE_MESSAGE_CONFIRM_TITLE,
      DELETE_MESSAGE_CONFIRM_BODY,
      expect.any(Array),
    );
    expect(remove).not.toHaveBeenCalled();

    const cancel = buttons().find((button) => button.style === "cancel");
    cancel?.onPress?.();
    expect(remove).not.toHaveBeenCalled();

    const destroy = buttons().find((button) => button.style === "destructive");
    expect(destroy?.text).toBe(DELETE_MESSAGE_CONFIRM_LABEL);
    destroy?.onPress?.();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("says why when the delete fails", async () => {
    const remove = vi
      .fn()
      .mockRejectedValue(new Error("You can only delete your own messages"));
    confirmDeleteMessage(remove);
    buttons()
      .find((button) => button.style === "destructive")
      ?.onPress?.();
    await flush();
    expect(Alert.alert).toHaveBeenLastCalledWith(
      DELETE_MESSAGE_FAILED_TITLE,
      "You can only delete your own messages",
    );
  });
});
