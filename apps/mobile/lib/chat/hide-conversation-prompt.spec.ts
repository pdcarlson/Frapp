import { Alert } from "react-native";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HIDE_CONVERSATION_CONFIRM_BODY,
  HIDE_CONVERSATION_FAILED_BODY,
  HIDE_CONVERSATION_FAILED_TITLE,
} from "@repo/hooks";
import { confirmHideConversation } from "./hide-conversation-prompt";

function lastAlert() {
  const calls = vi.mocked(Alert.alert).mock.calls;
  return calls[calls.length - 1]!;
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("confirmHideConversation (#2303)", () => {
  afterEach(() => {
    vi.mocked(Alert.alert).mockClear();
  });

  it("names the member, says nothing is deleted, and runs nothing until confirmed", () => {
    const run = vi.fn().mockResolvedValue(undefined);
    confirmHideConversation({ name: "Alice Chen", run });

    const [title, body, buttons] = lastAlert();
    expect(title).toBe("Hide your conversation with Alice Chen?");
    expect(body).toBe(HIDE_CONVERSATION_CONFIRM_BODY);
    expect(body).toMatch(/nothing in it is deleted/);
    buttons!.find((button) => button.style === "cancel")?.onPress?.();
    expect(run).not.toHaveBeenCalled();
  });

  it("is not styled destructive: nothing is destroyed", () => {
    confirmHideConversation({ name: "Alice", run: vi.fn() });

    const confirm = lastAlert()[2]!.find((button) => button.text === "Hide");
    expect(confirm?.style).toBeUndefined();
  });

  it("runs the hide on confirm, and says nothing on success", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    confirmHideConversation({ name: "Alice", run });

    lastAlert()[2]!
      .find((button) => button.text === "Hide")
      ?.onPress?.();
    await flush();

    expect(run).toHaveBeenCalledTimes(1);
    expect(vi.mocked(Alert.alert)).toHaveBeenCalledTimes(1);
  });

  it("reports a failed hide", async () => {
    const run = vi.fn().mockRejectedValue(new Error("offline"));
    confirmHideConversation({ name: "Alice", run });

    lastAlert()[2]!
      .find((button) => button.text === "Hide")
      ?.onPress?.();
    await flush();

    expect(lastAlert().slice(0, 2)).toEqual([
      HIDE_CONVERSATION_FAILED_TITLE,
      HIDE_CONVERSATION_FAILED_BODY,
    ]);
  });
});
