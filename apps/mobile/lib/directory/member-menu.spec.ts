import { ActionSheetIOS, Alert, Platform } from "react-native";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  confirmRemoveMember,
  memberMenuActions,
  showMemberMenu,
} from "./member-menu";

type AlertButton = { text?: string; style?: string; onPress?: () => void };

function lastAlert() {
  const call = vi.mocked(Alert.alert).mock.calls.at(-1)!;
  return { title: call[0], buttons: (call[2] ?? []) as AlertButton[] };
}

describe("memberMenuActions", () => {
  it("offers Block, then Remove where the API allows it", () => {
    expect(
      memberMenuActions({ canBlock: true, isBlocked: false, canRemove: true }),
    ).toEqual(["block", "remove"]);
  });

  it("offers Unblock for a member you blocked", () => {
    expect(
      memberMenuActions({ canBlock: true, isBlocked: true, canRemove: false }),
    ).toEqual(["unblock"]);
  });

  it("holds nothing on your own profile", () => {
    expect(
      memberMenuActions({
        canBlock: false,
        isBlocked: false,
        canRemove: false,
      }),
    ).toEqual([]);
  });
});

// The sheet's spec runs as iOS; Android draws the menu as a dialog.
describe("showMemberMenu on Android", () => {
  const os = Platform.OS;
  afterEach(() => {
    (Platform as { OS: string }).OS = os;
    vi.mocked(Alert.alert).mockClear();
    vi.mocked(ActionSheetIOS.showActionSheetWithOptions).mockClear();
  });

  it("lists each action, destructive ones marked, and runs the one tapped", () => {
    (Platform as { OS: string }).OS = "android";
    const onPick = vi.fn();
    showMemberMenu("Ada", ["block", "remove"], onPick);

    expect(ActionSheetIOS.showActionSheetWithOptions).not.toHaveBeenCalled();
    const { title, buttons } = lastAlert();
    expect(title).toBe("Ada");
    expect(buttons.map((b) => [b.text, b.style])).toEqual([
      ["Block Ada", "destructive"],
      ["Remove from chapter", "destructive"],
    ]);
    buttons[1]!.onPress!();
    expect(onPick).toHaveBeenCalledWith("remove");
  });

  it("opens nothing with nothing to offer", () => {
    (Platform as { OS: string }).OS = "android";
    showMemberMenu("Ada", [], vi.fn());
    expect(Alert.alert).not.toHaveBeenCalled();
  });
});

describe("confirmRemoveMember", () => {
  it("asks first, and removes only from its destructive button", () => {
    const run = vi.fn();
    confirmRemoveMember({ name: "Ada", run });
    const { title, buttons } = lastAlert();
    expect(title).toBe("Remove Ada from the chapter?");
    expect(run).not.toHaveBeenCalled();
    expect(buttons.map((b) => b.text)).toEqual([
      "Cancel",
      "Remove from chapter",
    ]);
    buttons[1]!.onPress!();
    expect(run).toHaveBeenCalledTimes(1);
  });
});
